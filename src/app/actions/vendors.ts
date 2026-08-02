"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireHouseSession } from "@/lib/session";
import { revalidateRooms } from "@/lib/revalidate";
import { logActivity } from "@/lib/activity";
import { runAgent } from "@/lib/agents/run";

async function teamSession() {
  const session = await requireHouseSession();
  if (!session.isTeam) throw new Error("team only");
  return session;
}

export async function addVendor(weddingId: string, name: string, category: string) {
  await teamSession();
  const supabase = await createClient();
  await supabase.from("vendors").insert({ wedding_id: weddingId, name, category });
  revalidatePath("/vendors");
}

/**
 * The vendor's own card put under the hand: the métier stays editable
 * after creation, and the vendor takes a budget home (migration 0019)
 * — the category its new lines inherit. The métier and the budget
 * category remain two distinct notions, by Estelle's word.
 */
export async function updateVendorMeta(
  weddingId: string,
  vendorId: string,
  input: { category: string; envelopeId: string | null }
) {
  await teamSession();
  const supabase = await createClient();
  const category = input.category.trim();
  let envelopeSaved = true;
  let { error } = await supabase
    .from("vendors")
    .update({ ...(category ? { category } : {}), envelope_id: input.envelopeId })
    .eq("id", vendorId)
    .eq("wedding_id", weddingId);
  if (error) {
    // Before migration 0019 the column is absent — the métier still saves.
    envelopeSaved = false;
    ({ error } = await supabase
      .from("vendors")
      .update(category ? { category } : {})
      .eq("id", vendorId)
      .eq("wedding_id", weddingId));
  }
  revalidateRooms("budget");
  revalidatePath("/vendors");
  return { ok: !error, envelopeSaved };
}

/**
 * What would leave with this vendor — counted before anything moves,
 * so the confirmation names exactly what it destroys.
 */
export async function previewVendorDeletion(weddingId: string, vendorId: string) {
  await teamSession();
  const supabase = await createClient();
  const { data: vendor } = await supabase
    .from("vendors")
    .select("name")
    .eq("id", vendorId)
    .eq("wedding_id", weddingId)
    .maybeSingle();
  if (!vendor) return { ok: false as const };
  const { data: lineRows } = await supabase
    .from("budget_lines")
    .select("id")
    .eq("vendor_id", vendorId);
  const lineIds = (lineRows ?? []).map((l) => l.id);
  const [items, payments, papers, banking] = await Promise.all([
    lineIds.length
      ? supabase.from("budget_line_items").select("id", { count: "exact", head: true }).in("budget_line_id", lineIds)
      : Promise.resolve({ count: 0 }),
    lineIds.length
      ? supabase.from("payments").select("id", { count: "exact", head: true }).in("budget_line_id", lineIds)
      : Promise.resolve({ count: 0 }),
    supabase.from("vendor_documents").select("id", { count: "exact", head: true }).eq("vendor_id", vendorId),
    supabase.from("vendor_banking").select("vendor_id", { count: "exact", head: true }).eq("vendor_id", vendorId)
  ]);
  return {
    ok: true as const,
    name: vendor.name,
    lines: lineIds.length,
    items: items.count ?? 0,
    payments: payments.count ?? 0,
    papers: papers.count ?? 0,
    banking: (banking.count ?? 0) > 0
  };
}

/**
 * The vendor leaves the house for good — Estelle's explicit word, the
 * name retyped. Its financial lines leave WITH it (posts, instalments
 * and their reminders cascade), its papers and their originals, its
 * readings, its encrypted coordinates. The journal keeps the trace;
 * the data does not linger.
 */
export async function deleteVendor(weddingId: string, vendorId: string) {
  const session = await teamSession();
  const supabase = await createClient();
  const preview = await previewVendorDeletion(weddingId, vendorId);
  if (!preview.ok) return { ok: false as const };

  // The filed originals leave storage too — nothing lingers.
  const { data: paperRows } = await supabase
    .from("vendor_documents")
    .select("storage_path")
    .eq("vendor_id", vendorId);
  const paths = (paperRows ?? [])
    .map((d) => d.storage_path)
    .filter((sp): sp is string => Boolean(sp?.startsWith("internal/")))
    .map((sp) => sp.slice("internal/".length));
  if (paths.length) await supabase.storage.from("internal").remove(paths);

  const { data: lineRows } = await supabase
    .from("budget_lines")
    .select("id")
    .eq("vendor_id", vendorId);
  const lineIds = (lineRows ?? []).map((l) => l.id);
  if (lineIds.length) {
    // Nested credits first, then the lines — posts, instalments and
    // reminders cascade from them.
    await supabase.from("budget_lines").delete().in("parent_line_id", lineIds);
    await supabase.from("budget_lines").delete().eq("vendor_id", vendorId);
  }
  await supabase.from("document_readings").delete().eq("vendor_id", vendorId);
  // Banking, its history, the papers and the sheet note cascade here.
  const { error } = await supabase
    .from("vendors")
    .delete()
    .eq("id", vendorId)
    .eq("wedding_id", weddingId);
  if (error) return { ok: false as const };

  await logActivity(supabase, weddingId, session.profile.full_name, "vendor_deleted", {
    name: preview.name,
    lines: preview.lines,
    items: preview.items,
    payments: preview.payments,
    papers: preview.papers,
    banking: preview.banking
  });
  revalidateRooms("budget");
  revalidatePath("/vendors");
  return { ok: true as const };
}

const STAGE_DATE_COL: Record<string, string> = {
  contacted: "contacted_on",
  proposal_requested: "proposal_requested_on",
  proposal_received: "proposal_received_on",
  selected: "selected_on",
  contracted: "contracted_on"
};

export async function setVendorStage(vendorId: string, stage: VendorStage) {
  const session = await teamSession();
  const supabase = await createClient();
  const { data: vendor } = await supabase
    .from("vendors")
    .select("id, wedding_id, name, stage")
    .eq("id", vendorId)
    .single();
  const patch: Record<string, unknown> = { stage, last_activity_at: new Date().toISOString() };
  if (STAGE_DATE_COL[stage]) patch[STAGE_DATE_COL[stage]] = new Date().toISOString().slice(0, 10);
  if (stage === "completed") patch.completed = true;
  let { error } = await supabase.from("vendors").update(patch).eq("id", vendorId);
  if (error) {
    // Pre-0026: the stage alone still lands (legacy enum values only).
    await supabase.from("vendors").update({ stage }).eq("id", vendorId);
  }
  if (vendor) {
    await logActivity(supabase, vendor.wedding_id, session.profile.full_name, "vendor_stage", {
      vendor: vendor.name, from: vendor.stage, to: stage
    });
    // The Timeline reflects the relationship's turning points (PRD
    // Timeline §15) — one anchored milestone per vendor, updated in
    // place; Vendors stays the source of truth.
    if (["shortlisted", "contracted", "completed", "archived"].includes(stage)) {
      const { syncModuleMilestone } = await import("@/lib/timeline-sync");
      await syncModuleMilestone(supabase, {
        weddingId: vendor.wedding_id,
        source: "vendor",
        sourceId: vendorId,
        label: `${vendor.name} — ${stage}`,
        date: new Date().toISOString().slice(0, 10),
        done: stage === "contracted" || stage === "completed",
        module: "vendors",
        vendorId
      });
    }
  }

  // Booked is the act that opens the budget line — never by hand.
  // The line waits for its quote; Madame fills it when the document lands.
  if (stage === "contracted" && vendor) {
    const { data: line } = await supabase
      .from("budget_lines")
      .select("id")
      .eq("vendor_id", vendorId)
      .limit(1)
      .maybeSingle();
    if (!line) {
      const { count } = await supabase
        .from("budget_lines")
        .select("id", { count: "exact", head: true })
        .eq("wedding_id", vendor.wedding_id);
      await supabase.from("budget_lines").insert({
        wedding_id: vendor.wedding_id,
        vendor_id: vendorId,
        label: vendor.name,
        committed_note: "Awaiting quote",
        status: "draft",
        sort: (count ?? 0) + 1
      });
    }
  }
  revalidatePath("/vendors");
  revalidatePath("/budget");
}

/**
 * Vendor outreach: the agent drafts the email from the category
 * template in the house's voice; the send leaves from Estelle's inbox
 * through Netlify Forms.
 */
export async function draftOutreach(input: {
  weddingId: string;
  vendorId: string;
  template: "availability" | "proposal" | "negotiation" | "confirmation";
}) {
  await teamSession();
  const supabase = await createClient();
  const { data: vendor } = await supabase
    .from("vendors")
    .select("name, category")
    .eq("id", input.vendorId)
    .single();
  if (!vendor) return { ok: false as const };

  const text = await runAgent({
    weddingId: input.weddingId,
    agent: "madame",
    maxTokens: 600,
    prompt:
      `Draft the "${input.template}" outreach email to the vendor ${vendor.name} (category: ${vendor.category}), ` +
      `to be sent from Estelle's inbox. Professional, precise, in the house's voice; include the wedding's dates and ` +
      `destination, and what the house asks at this stage. Reply with STRICT JSON only: {"subject": string, "body": string}.`
  });

  try {
    const parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
    return { ok: true as const, subject: parsed.subject as string, body: parsed.body as string };
  } catch {
    return { ok: true as const, subject: `Madame Wedding Design — ${vendor.name}`, body: text };
  }
}

export async function sendOutreach(input: {
  weddingId: string;
  vendorId: string;
  template: string;
  to: string;
  subject: string;
  body: string;
}) {
  const session = await teamSession();
  const site = process.env.NEXT_PUBLIC_SITE_URL;

  // Netlify Forms endpoint — the statically registered vendor-outreach form.
  if (site) {
    await fetch(`${site}/vendor-outreach`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        "form-name": "vendor-outreach",
        wedding: input.weddingId,
        vendor: input.vendorId,
        category: input.template,
        template: input.template,
        to: input.to,
        reply_to: process.env.HOUSE_INBOX ?? "",
        subject: input.subject,
        body: input.body
      })
    }).catch(() => undefined);
  }

  const supabase = await createClient();
  await supabase.from("vendors").update({ stage: "contacted" }).eq("id", input.vendorId)
    .eq("stage", "scouted");
  void session;
  revalidatePath("/vendors");
  return { ok: true };
}

/**
 * The vendor sheet's note, under the language rule: Estelle's raw
 * words stay internal; Madame delivers the client-language version.
 */
export async function refineVendorNote(weddingId: string, vendorId: string, bodyRaw: string) {
  await teamSession();
  const supabase = await createClient();
  const { data: vendor } = await supabase.from("vendors").select("name, category").eq("id", vendorId).single();
  const text = await runAgent({
    weddingId,
    agent: "budget",
    maxTokens: 700,
    prompt:
      `Estelle's raw note for the client sheet of vendor "${vendor?.name}" (${vendor?.category}) — her own words, any language: "${bodyRaw}".\n` +
      `Compose the client-facing note from it: the house's voice, 2–3 sentences addressed to the couple, ` +
      `in the wedding's CLIENT LANGUAGE. Do not sign (the sheet signs "— Estelle"). Reply with the note text alone.`
  });
  return { ok: true as const, refined: text.trim() };
}

export async function saveVendorClientNote(input: {
  vendorId: string;
  weddingId: string;
  bodyRaw: string;
  body: string;
  publish: boolean;
}) {
  await teamSession();
  const supabase = await createClient();
  const { error } = await supabase.from("vendor_client_notes").upsert(
    {
      vendor_id: input.vendorId,
      wedding_id: input.weddingId,
      body_raw: input.bodyRaw.trim() || null,
      body: input.body.trim() || null,
      status: input.publish ? "published" : "draft",
      updated_at: new Date().toISOString()
    },
    { onConflict: "vendor_id" }
  );
  revalidatePath("/budget");
  return { ok: !error, needsMigration: Boolean(error) };
}

/**
 * A document entered twice can leave: the record goes, the filed
 * original goes with it. The budget lines and instalments it fed are
 * removed by hand where they live — nothing vanishes silently.
 */
export async function deleteVendorDocument(docId: string) {
  await teamSession();
  const supabase = await createClient();
  const { data: doc } = await supabase
    .from("vendor_documents")
    .select("storage_path")
    .eq("id", docId)
    .maybeSingle();
  if (doc?.storage_path) {
    const [bucket, ...rest] = doc.storage_path.split("/");
    await supabase.storage.from(bucket).remove([rest.join("/")]).catch(() => undefined);
  }
  await supabase.from("vendor_documents").delete().eq("id", docId);
  revalidatePath("/vendors");
  revalidatePath("/budget");
  return { ok: true as const };
}

/* ══════════ Vendors module (PRD, migration 0026) ═══════════════════ */

import type { VendorContactRole, VendorStage } from "@/lib/types";

async function teamOnlySession() {
  const session = await requireHouseSession();
  if (!session.isTeam) throw new Error("team only");
  return session;
}

const touchActivity = async (
  supabase: Awaited<ReturnType<typeof createClient>>,
  vendorId: string
) => {
  await supabase
    .from("vendors")
    .update({ last_activity_at: new Date().toISOString() })
    .eq("id", vendorId);
};

/* ── the permanent profile + the wedding relationship ── */

export interface VendorProfileFields {
  legalName: string;
  tradingName: string;
  category: string;
  country: string;
  city: string;
  languages: string;
  website: string;
  instagram: string;
  portfolioUrl: string;
  email: string;
  phone: string;
  whatsapp: string;
  timezone: string;
  vatNumber: string;
  rating: number | null;
  tags: string;
  registryNotes: string;
  /* relationship */
  role: string;
  leadPlanner: string;
  contactedOn: string;
  proposalRequestedOn: string;
  proposalReceivedOn: string;
  selectedOn: string;
  contractedOn: string;
  completed: boolean;
  relationshipNotes: string;
}

export async function saveVendorProfile(
  weddingId: string,
  vendorId: string,
  f: VendorProfileFields
) {
  await teamOnlySession();
  const supabase = await createClient();
  const { data: vendor } = await supabase
    .from("vendors")
    .select("id, registry_id")
    .eq("id", vendorId)
    .eq("wedding_id", weddingId)
    .single();
  if (!vendor) return { ok: false as const };

  const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
  if (vendor.registry_id) {
    await supabase
      .from("vendor_registry")
      .update({
        legal_name: f.legalName || "—",
        trading_name: f.tradingName || null,
        category: f.category,
        country: f.country || null,
        city: f.city || null,
        languages: list(f.languages),
        website: f.website || null,
        instagram: f.instagram || null,
        portfolio_url: f.portfolioUrl || null,
        email: f.email || null,
        phone: f.phone || null,
        whatsapp: f.whatsapp || null,
        timezone: f.timezone || null,
        vat_number: f.vatNumber || null,
        rating: f.rating,
        tags: list(f.tags),
        notes_internal: f.registryNotes || null
      })
      .eq("id", vendor.registry_id);
  }

  // The wedding row mirrors the display name/category (Budget reads them).
  const patch: Record<string, unknown> = {
    name: f.tradingName || f.legalName,
    category: f.category,
    role: f.role || null,
    lead_planner: f.leadPlanner || null,
    contacted_on: f.contactedOn || null,
    proposal_requested_on: f.proposalRequestedOn || null,
    proposal_received_on: f.proposalReceivedOn || null,
    selected_on: f.selectedOn || null,
    contracted_on: f.contractedOn || null,
    completed: f.completed,
    notes_internal: f.relationshipNotes || null,
    last_activity_at: new Date().toISOString()
  };
  let { error } = await supabase.from("vendors").update(patch).eq("id", vendorId);
  if (error) {
    // Pre-0026: only name and category exist.
    ({ error } = await supabase
      .from("vendors")
      .update({ name: f.tradingName || f.legalName, category: f.category })
      .eq("id", vendorId));
  }
  revalidatePath("/vendors");
  revalidatePath("/budget");
  return { ok: !error };
}

/* ── archive · restore · delete draft ── */

export async function setVendorArchived(weddingId: string, vendorId: string, archived: boolean) {
  const session = await teamOnlySession();
  const supabase = await createClient();
  const { error } = await supabase
    .from("vendors")
    .update({ archived, last_activity_at: new Date().toISOString() })
    .eq("id", vendorId)
    .eq("wedding_id", weddingId);
  if (!error) {
    await logActivity(supabase, weddingId, session.profile.full_name, archived ? "vendor_archived" : "vendor_restored", { vendorId });
  }
  revalidatePath("/vendors");
  return { ok: !error };
}

/** A draft vendor — no financial trace, no paper — may simply leave.
    Anything heavier goes through the departure ritual (deleteVendor). */
export async function deleteDraftVendor(weddingId: string, vendorId: string) {
  await teamOnlySession();
  const preview = await previewVendorDeletion(weddingId, vendorId);
  if (!preview.ok) return { ok: false as const, reason: "not_found" as const };
  const heavy = preview.lines + preview.items + preview.payments + preview.papers + (preview.banking ? 1 : 0);
  if (heavy > 0) return { ok: false as const, reason: "not_a_draft" as const };
  const supabase = await createClient();
  const { error } = await supabase.from("vendors").delete().eq("id", vendorId).eq("wedding_id", weddingId);
  revalidatePath("/vendors");
  return { ok: !error };
}

/* ── contacts ── */

export interface ContactFields {
  role: VendorContactRole;
  name: string;
  email: string;
  phone: string;
  whatsapp: string;
  notes: string;
}

export async function saveVendorContact(
  registryId: string,
  contactId: string | null,
  f: ContactFields
) {
  await teamOnlySession();
  const supabase = await createClient();
  const row = {
    contact_role: f.role,
    name: f.name,
    email: f.email || null,
    phone: f.phone || null,
    whatsapp: f.whatsapp || null,
    notes: f.notes || null
  };
  const { error } = contactId
    ? await supabase.from("vendor_contacts").update(row).eq("id", contactId)
    : await supabase.from("vendor_contacts").insert({ registry_id: registryId, ...row });
  revalidatePath("/vendors");
  return { ok: !error };
}

export async function removeVendorContact(contactId: string) {
  await teamOnlySession();
  const supabase = await createClient();
  const { error } = await supabase.from("vendor_contacts").delete().eq("id", contactId);
  revalidatePath("/vendors");
  return { ok: !error };
}

/* ── dated internal notes ── */

export async function addVendorNote(weddingId: string, vendorId: string, body: string) {
  const session = await teamOnlySession();
  const supabase = await createClient();
  const { error } = await supabase.from("vendor_notes").insert({
    wedding_id: weddingId,
    vendor_id: vendorId,
    author: session.profile.full_name,
    body: body.trim()
  });
  if (!error) await touchActivity(supabase, vendorId);
  revalidatePath("/vendors");
  return { ok: !error };
}

export async function removeVendorNote(noteId: string) {
  await teamOnlySession();
  const supabase = await createClient();
  const { error } = await supabase.from("vendor_notes").delete().eq("id", noteId);
  revalidatePath("/vendors");
  return { ok: !error };
}

/* ── duplicate detection · creation · merge ── */

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const domain = (email: string) => email.split("@")[1]?.toLowerCase() ?? "";

export async function findVendorDuplicates(probe: {
  name: string; email?: string; phone?: string; website?: string; instagram?: string; vat?: string;
}) {
  await teamOnlySession();
  const supabase = await createClient();
  const { data: registry, error } = await supabase
    .from("vendor_registry")
    .select("id, legal_name, trading_name, category, city, country, email, phone, website, instagram, vat_number");
  if (error) return { ok: true as const, matches: [] };
  const name = norm(probe.name);
  const dom = probe.email ? domain(probe.email) : "";
  const digits = (probe.phone ?? "").replace(/\D/g, "");
  const matches = (registry ?? []).filter((r) => {
    if (name && (norm(r.legal_name) === name || (r.trading_name && norm(r.trading_name) === name))) return true;
    if (dom && r.email && domain(r.email) === dom) return true;
    if (digits.length >= 8 && r.phone && r.phone.replace(/\D/g, "").endsWith(digits.slice(-8))) return true;
    if (probe.website && r.website && norm(r.website).replace(/https?:\/\/|www\./g, "") === norm(probe.website).replace(/https?:\/\/|www\./g, "")) return true;
    if (probe.instagram && r.instagram && norm(r.instagram).replace("@", "") === norm(probe.instagram).replace("@", "")) return true;
    if (probe.vat && r.vat_number && norm(r.vat_number) === norm(probe.vat)) return true;
    return false;
  });
  return { ok: true as const, matches: matches.slice(0, 5) };
}

/**
 * A vendor enters the wedding: a fresh registry profile, or a link to
 * an existing one (the duplicate dialog's "Open existing"). Never a
 * silent duplicate.
 */
export async function addVendorFull(
  weddingId: string,
  f: { name: string; category: string; email?: string; phone?: string; website?: string; instagram?: string },
  registryId?: string | null
) {
  const session = await teamOnlySession();
  const supabase = await createClient();
  let regId = registryId ?? null;
  if (!regId) {
    const { data: reg } = await supabase
      .from("vendor_registry")
      .insert({
        legal_name: f.name,
        category: f.category,
        email: f.email || null,
        phone: f.phone || null,
        website: f.website || null,
        instagram: f.instagram || null
      })
      .select("id")
      .single();
    regId = reg?.id ?? null;
  }
  let { data: vendor, error } = await supabase
    .from("vendors")
    .insert({ wedding_id: weddingId, name: f.name, category: f.category, stage: "scouted", registry_id: regId })
    .select("id")
    .single();
  if (error) {
    // Pre-0026: the plain row still lands.
    ({ data: vendor, error } = await supabase
      .from("vendors")
      .insert({ wedding_id: weddingId, name: f.name, category: f.category, stage: "scouted" })
      .select("id")
      .single());
  }
  if (!error) {
    await logActivity(supabase, weddingId, session.profile.full_name, "vendor_added", { name: f.name, linked: !!registryId });
  }
  revalidatePath("/vendors");
  return { ok: !error, id: vendor?.id as string | undefined };
}

/**
 * Merge two wedding-vendors: every reference repoints to the kept one
 * (budget lines, papers, readings, notes), then the double leaves.
 * Estelle's explicit gesture — never automatic.
 */
export async function mergeVendors(weddingId: string, keepId: string, mergeId: string) {
  const session = await teamOnlySession();
  if (keepId === mergeId) return { ok: false as const };
  const supabase = await createClient();
  const { data: pair } = await supabase
    .from("vendors")
    .select("id, name, registry_id")
    .in("id", [keepId, mergeId])
    .eq("wedding_id", weddingId);
  if ((pair ?? []).length !== 2) return { ok: false as const };
  const keep = pair!.find((v) => v.id === keepId)!;
  const gone = pair!.find((v) => v.id === mergeId)!;

  await supabase.from("budget_lines").update({ vendor_id: keepId }).eq("vendor_id", mergeId);
  await supabase.from("vendor_documents").update({ vendor_id: keepId }).eq("vendor_id", mergeId);
  await supabase.from("document_readings").update({ vendor_id: keepId }).eq("vendor_id", mergeId);
  await supabase.from("vendor_notes").update({ vendor_id: keepId }).eq("vendor_id", mergeId).then(() => {});
  // Banking: the kept vendor's coordinates stand; the double's leave with it.
  await supabase.from("vendors").delete().eq("id", mergeId);
  // Orphaned registry: contacts move to the kept profile, then it leaves.
  if (gone.registry_id && gone.registry_id !== keep.registry_id) {
    const { data: still } = await supabase
      .from("vendors").select("id").eq("registry_id", gone.registry_id).limit(1);
    if (!still?.length && keep.registry_id) {
      await supabase.from("vendor_contacts").update({ registry_id: keep.registry_id }).eq("registry_id", gone.registry_id);
      await supabase.from("vendor_registry").delete().eq("id", gone.registry_id);
    }
  }
  await logActivity(supabase, weddingId, session.profile.full_name, "vendor_merged", {
    kept: keep.name, merged: gone.name
  });
  revalidatePath("/vendors");
  revalidatePath("/budget");
  return { ok: true as const };
}

/* ── document metadata · attach · archive ── */

export async function updateVendorDocumentMeta(
  weddingId: string,
  docId: string,
  patch: { label?: string; type?: string; vendorId?: string; archived?: boolean }
) {
  await teamOnlySession();
  const supabase = await createClient();
  const row: Record<string, unknown> = {};
  if (patch.label !== undefined) row.label = patch.label;
  if (patch.type !== undefined) row.type = patch.type;
  if (patch.vendorId !== undefined) row.vendor_id = patch.vendorId;
  if (patch.archived !== undefined) row.archived = patch.archived;
  let { error } = await supabase
    .from("vendor_documents").update(row).eq("id", docId).eq("wedding_id", weddingId);
  if (error && patch.archived !== undefined) {
    // Pre-0026: no archived column — the rest still lands.
    delete row.archived;
    if (Object.keys(row).length) {
      ({ error } = await supabase
        .from("vendor_documents").update(row).eq("id", docId).eq("wedding_id", weddingId));
    }
  }
  if (!error && patch.vendorId) await touchActivity(supabase, patch.vendorId);
  revalidatePath("/vendors");
  return { ok: !error };
}

/* ── import (CSV/XLSX rows, reviewed) ── */

export interface VendorImportRow {
  action: "create" | "skip";
  registryId?: string | null;
  name: string;
  category: string;
  email?: string;
  phone?: string;
  website?: string;
  instagram?: string;
  city?: string;
  country?: string;
  notes?: string;
}

export async function importVendors(weddingId: string, rows: VendorImportRow[]) {
  const session = await teamOnlySession();
  const supabase = await createClient();
  let created = 0, linked = 0, skipped = 0;
  for (const r of rows) {
    if (r.action === "skip" || !r.name.trim()) { skipped++; continue; }
    const res = await addVendorFull(
      weddingId,
      { name: r.name, category: r.category || "", email: r.email, phone: r.phone, website: r.website, instagram: r.instagram },
      r.registryId ?? null
    );
    if (res.ok) {
      if (r.registryId) linked++; else created++;
      if ((r.city || r.country || r.notes) && res.id) {
        const { data: v } = await supabase.from("vendors").select("registry_id").eq("id", res.id).single();
        if (v?.registry_id) {
          await supabase.from("vendor_registry")
            .update({ city: r.city || null, country: r.country || null, notes_internal: r.notes || null })
            .eq("id", v.registry_id);
        }
      }
    }
  }
  await logActivity(supabase, weddingId, session.profile.full_name, "vendor_import", { created, linked, skipped });
  revalidatePath("/vendors");
  return { ok: true as const, created, linked, skipped };
}
