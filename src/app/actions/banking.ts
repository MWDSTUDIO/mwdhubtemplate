"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireHouseSession } from "@/lib/session";
import { notifyTeam } from "@/lib/notify";
import { logActivity } from "@/lib/activity";
import {
  encryptBanking,
  decryptProfile,
  bankingFingerprint,
  toProfile,
  type BankingDetails,
  type BankingProfile
} from "@/lib/banking";

async function teamSession() {
  const session = await requireHouseSession();
  if (!session.isTeam) throw new Error("team only");
  return session;
}

interface BankingRow {
  vendor_id: string;
  wedding_id: string;
  enc: string;
  corridor?: string | null;
  status?: string | null;
  fingerprint?: string | null;
  verified_by?: string | null;
  verified_at?: string | null;
  verification_method?: string | null;
  verification_contact?: string | null;
  pending_enc?: string | null;
  pending_fingerprint?: string | null;
  pending_corridor?: string | null;
  pending_read_at?: string | null;
}

/**
 * THE single door for writing coordinates (banking brief §6). Whether
 * they arrive from the reader or from Estelle's own hand:
 * - never a silent update of verified coordinates — a differing
 *   fingerprint parks the new reading in pending and raises a strong
 *   alert; the old coordinates stay in place;
 * - every replaced version goes to the history, forever;
 * - everything written lands as "read": only a voice on a number
 *   obtained OUTSIDE the document can make it "verified".
 */
async function writeBanking(
  weddingId: string,
  vendorId: string,
  profile: BankingProfile,
  actor: string,
  sourceDocumentId?: string | null
): Promise<{ ok: boolean; heldForVerification: boolean; needsMigration: boolean }> {
  const supabase = await createClient();
  const enc = encryptBanking(profile);
  const fingerprint = bankingFingerprint(profile);
  const corridor = profile.corridor ?? "unknown";

  const { data: existing } = await supabase
    .from("vendor_banking")
    .select("*")
    .eq("vendor_id", vendorId)
    .maybeSingle<BankingRow>();

  if (existing && existing.status === "verified" && existing.fingerprint && existing.fingerprint !== fingerprint) {
    // The number-one fraud signal (§6): a known vendor whose
    // "coordinates have changed". Nothing is overwritten; the new
    // reading waits beside the old, and the alert is loud.
    const { error } = await supabase
      .from("vendor_banking")
      .update({
        pending_enc: enc,
        pending_fingerprint: fingerprint,
        pending_corridor: corridor,
        pending_source_document_id: sourceDocumentId ?? null,
        pending_read_at: new Date().toISOString()
      })
      .eq("vendor_id", vendorId);
    if (error) return { ok: false, heldForVerification: false, needsMigration: true };
    await notifyTeam(weddingId, {
      kind: "banking_change_alert",
      title: "Banking coordinates differ — verify before anything moves",
      body: "A new reading for a verified vendor carries different account details. The old coordinates remain in force.",
      url: `/budget/vendor/${vendorId}`
    });
    await logActivity(supabase, weddingId, actor, "banking_change_alert", { vendorId });
    revalidatePath("/budget");
    return { ok: true, heldForVerification: true, needsMigration: false };
  }

  // Every version that held the truth is kept (§6) — silently absent
  // before migration 0016.
  if (existing) {
    await supabase.from("vendor_banking_history").insert({
      vendor_id: vendorId,
      wedding_id: weddingId,
      enc: existing.enc,
      fingerprint: existing.fingerprint ?? null,
      corridor: existing.corridor ?? null,
      status: existing.status ?? null,
      verified_by: existing.verified_by ?? null,
      verified_at: existing.verified_at ?? null,
      verification_method: existing.verification_method ?? null,
      verification_contact: existing.verification_contact ?? null
    });
  }

  const fullRow = {
    vendor_id: vendorId,
    wedding_id: weddingId,
    enc,
    corridor,
    status: "read",
    fingerprint,
    verified_by: null,
    verified_at: null,
    verification_method: null,
    verification_contact: null,
    source_document_id: sourceDocumentId ?? null,
    updated_at: new Date().toISOString()
  };
  let { error } = await supabase.from("vendor_banking").upsert(fullRow, { onConflict: "vendor_id" });
  if (error) {
    // Pre-0016: the blob still lands, unstructured, as before.
    ({ error } = await supabase.from("vendor_banking").upsert(
      { vendor_id: vendorId, wedding_id: weddingId, enc, updated_at: new Date().toISOString() },
      { onConflict: "vendor_id" }
    ));
    revalidatePath("/budget");
    return { ok: !error, heldForVerification: false, needsMigration: true };
  }
  await logActivity(supabase, weddingId, actor, "banking_read", { vendorId });
  revalidatePath("/budget");
  return { ok: true, heldForVerification: false, needsMigration: false };
}

/** Estelle's own hand — same door, same rules as the reader. */
export async function saveVendorBanking(
  vendorId: string,
  weddingId: string,
  details: BankingDetails
) {
  const session = await teamSession();
  const profile = toProfile(details)!;
  const r = await writeBanking(weddingId, vendorId, profile, session.profile.full_name);
  return { ok: r.ok, heldForVerification: r.heldForVerification, needsMigration: r.needsMigration };
}

/** The structured write used by the reading-acceptance screen. */
export async function acceptBankingReading(input: {
  readingId: string;
  vendorId: string;
  weddingId: string;
  blockIndex: number;
  /** Field paths accepted by Estelle, e.g. "account.iban", "bank.name". */
  accepted: string[];
}) {
  const session = await teamSession();
  const supabase = await createClient();
  const { data: reading } = await supabase
    .from("document_readings")
    .select("id, payload, vendor_document_id")
    .eq("id", input.readingId)
    .single();
  const payload = reading?.payload as {
    kind?: string;
    blocks?: Record<string, unknown>[];
  } | null;
  if (!payload || payload.kind !== "banking") return { ok: false as const };
  const block = payload.blocks?.[input.blockIndex] as
    | Record<string, Record<string, { value?: string | null }> | string | null>
    | undefined;
  if (!block) return { ok: false as const };

  // Only what Estelle accepted crosses — value by value, and only
  // values the deterministic net has not rejected (they are null).
  const accepted = new Set(input.accepted);
  const pick = (group: string): Record<string, string> => {
    const g = block[group];
    const out: Record<string, string> = {};
    if (g && typeof g === "object") {
      for (const [k, f] of Object.entries(g as Record<string, { value?: string | null }>)) {
        if (accepted.has(`${group}.${k}`) && f?.value) out[k] = f.value;
      }
    }
    return out;
  };

  const beneficiary = pick("beneficiary");
  const account = pick("account");
  const bank = pick("bank");
  const intermediary = pick("intermediary");
  const terms = pick("terms");
  if (Object.keys(account).length === 0) return { ok: false as const, empty: true };

  const profile: BankingProfile = {
    beneficiary,
    corridor: typeof block.corridor === "string" ? block.corridor : "unknown",
    account,
    bank,
    intermediary: Object.keys(intermediary).length ? intermediary : undefined,
    terms
  };

  const r = await writeBanking(
    input.weddingId,
    input.vendorId,
    profile,
    session.profile.full_name,
    reading?.vendor_document_id ?? null
  );
  if (r.ok) {
    await supabase.from("document_readings").update({ status: "accepted" }).eq("id", input.readingId);
  }
  revalidatePath("/budget");
  return { ok: r.ok, heldForVerification: r.heldForVerification };
}

export async function dismissBankingReading(readingId: string) {
  await teamSession();
  const supabase = await createClient();
  await supabase.from("document_readings").update({ status: "dismissed" }).eq("id", readingId);
  revalidatePath("/budget");
  return { ok: true as const };
}

/**
 * The out-of-band verification (§5) — a voice, on a number obtained
 * INDEPENDENTLY of the document: the paper contract's letterhead, the
 * vendor's site, a number the house already held. Never the number
 * printed beside the coordinates, never an email signature.
 */
export async function verifyVendorBanking(
  vendorId: string,
  weddingId: string,
  input: { method: "call" | "in_person"; contact: string }
) {
  const session = await teamSession();
  if (!input.contact.trim()) return { ok: false as const };
  const supabase = await createClient();
  const { error } = await supabase
    .from("vendor_banking")
    .update({
      status: "verified",
      verified_by: session.profile.full_name,
      verified_at: new Date().toISOString(),
      verification_method: input.method,
      verification_contact: input.contact.trim()
    })
    .eq("vendor_id", vendorId);
  if (error) return { ok: false as const, needsMigration: true };
  await logActivity(supabase, weddingId, session.profile.full_name, "banking_verified", {
    vendorId,
    method: input.method
  });
  revalidatePath("/budget");
  return { ok: true as const };
}

/**
 * A pending reading (differing coordinates) accepted after its OWN
 * complete out-of-band verification — the old version goes to the
 * history, never erased before its trace is kept.
 */
export async function verifyPendingBanking(
  vendorId: string,
  weddingId: string,
  input: { method: "call" | "in_person"; contact: string }
) {
  const session = await teamSession();
  if (!input.contact.trim()) return { ok: false as const };
  const supabase = await createClient();
  const { data: row } = await supabase
    .from("vendor_banking")
    .select("*")
    .eq("vendor_id", vendorId)
    .maybeSingle<BankingRow>();
  if (!row?.pending_enc) return { ok: false as const };

  await supabase.from("vendor_banking_history").insert({
    vendor_id: vendorId,
    wedding_id: weddingId,
    enc: row.enc,
    fingerprint: row.fingerprint ?? null,
    corridor: row.corridor ?? null,
    status: row.status ?? null,
    verified_by: row.verified_by ?? null,
    verified_at: row.verified_at ?? null,
    verification_method: row.verification_method ?? null,
    verification_contact: row.verification_contact ?? null
  });

  const { error } = await supabase
    .from("vendor_banking")
    .update({
      enc: row.pending_enc,
      fingerprint: row.pending_fingerprint,
      corridor: row.pending_corridor,
      source_document_id: (row as { pending_source_document_id?: string | null }).pending_source_document_id ?? null,
      status: "verified",
      verified_by: session.profile.full_name,
      verified_at: new Date().toISOString(),
      verification_method: input.method,
      verification_contact: input.contact.trim(),
      pending_enc: null,
      pending_fingerprint: null,
      pending_corridor: null,
      pending_source_document_id: null,
      pending_read_at: null,
      updated_at: new Date().toISOString()
    })
    .eq("vendor_id", vendorId);
  if (error) return { ok: false as const };
  await logActivity(supabase, weddingId, session.profile.full_name, "banking_change_accepted", {
    vendorId,
    method: input.method
  });
  revalidatePath("/budget");
  return { ok: true as const };
}

/** The differing reading judged wrong — dismissed, the old truth stands. */
export async function dismissPendingBanking(vendorId: string, weddingId: string) {
  const session = await teamSession();
  const supabase = await createClient();
  await supabase
    .from("vendor_banking")
    .update({
      pending_enc: null,
      pending_fingerprint: null,
      pending_corridor: null,
      pending_source_document_id: null,
      pending_read_at: null
    })
    .eq("vendor_id", vendorId);
  await logActivity(supabase, weddingId, session.profile.full_name, "banking_change_dismissed", {
    vendorId
  });
  revalidatePath("/budget");
  return { ok: true as const };
}

/**
 * Team reads back the clear details — their own eyes only, and every
 * clear-text consultation leaves a trace (§9): who, when, which
 * vendor. Never the coordinates themselves in any log.
 */
export async function readVendorBanking(vendorId: string) {
  const session = await teamSession();
  const supabase = await createClient();
  const { data } = await supabase
    .from("vendor_banking")
    .select("*")
    .eq("vendor_id", vendorId)
    .maybeSingle<BankingRow>();
  if (!data) return { ok: true as const, details: null, meta: null };
  await logActivity(supabase, data.wedding_id, session.profile.full_name, "banking_access", {
    vendorId
  });
  return {
    ok: true as const,
    details: decryptProfile(data.enc),
    pending: data.pending_enc ? decryptProfile(data.pending_enc) : null,
    meta: {
      status: data.status ?? "read",
      corridor: data.corridor ?? null,
      verified_by: data.verified_by ?? null,
      verified_at: data.verified_at ?? null,
      verification_method: data.verification_method ?? null,
      verification_contact: data.verification_contact ?? null,
      pending_read_at: data.pending_read_at ?? null
    }
  };
}
