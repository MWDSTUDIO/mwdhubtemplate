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

export async function setVendorStage(
  vendorId: string,
  stage: "scouted" | "contacted" | "proposal" | "contracted"
) {
  await teamSession();
  const supabase = await createClient();
  const { data: vendor } = await supabase
    .from("vendors")
    .select("id, wedding_id, name")
    .eq("id", vendorId)
    .single();
  await supabase.from("vendors").update({ stage }).eq("id", vendorId);

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
