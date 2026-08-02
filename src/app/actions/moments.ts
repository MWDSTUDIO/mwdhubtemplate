"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { requireHouseSession } from "@/lib/session";
import { logActivity } from "@/lib/activity";
import { findDuplicateMoment, canDeleteMoment, type Moment, type MomentReferences } from "@/lib/moments";

/**
 * The Wedding Moments registry (PRD Moments) — the Desk's
 * wedding_events rows, spoken to by id. Nothing here ever creates a
 * second registry: every gesture lands on the canonical table.
 */

async function teamSession() {
  const session = await requireHouseSession();
  if (!session.isTeam) throw new Error("team only");
  return session;
}

const count = async (supabase: SupabaseClient, table: string, col: string, id: string) => {
  try {
    const { count: n, error } = await supabase
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq(col, id);
    return error ? 0 : (n ?? 0);
  } catch {
    return 0;
  }
};

/** §16 — everything that points at a moment, named before any removal. */
export async function momentReferences(eventId: string): Promise<MomentReferences> {
  await teamSession();
  const supabase = await createClient();
  const [milestones, ceremonies, budgetLines, runSheets, guests, links] = await Promise.all([
    count(supabase, "milestone_ops", "event_id", eventId),
    count(supabase, "ceremonies", "event_id", eventId),
    count(supabase, "budget_lines", "event_id", eventId),
    count(supabase, "run_sheets", "event_id", eventId),
    count(supabase, "person_event_status", "event_id", eventId),
    count(supabase, "moment_links", "event_id", eventId)
  ]);
  return { milestones, ceremonies, budgetLines, runSheets, guests, links };
}

export interface MomentInput {
  weddingId: string;
  id?: string;
  name: string;
  eventDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  venue?: string | null;
  eventType?: string | null;
  /** §15 — set after the team saw the duplicate and chose to proceed. */
  force?: boolean;
}

/**
 * Create or refine a moment — by id, so a rename keeps every
 * reference. A possible duplicate is named first, never merged.
 */
export async function saveMoment(input: MomentInput) {
  const session = await teamSession();
  const supabase = await createClient();
  const name = input.name.trim();
  if (!name) return { ok: false as const, reason: "name" as const };

  if (!input.force) {
    const { data: existing } = await supabase
      .from("wedding_events")
      .select("id, name, event_date, event_type, archived, sort")
      .eq("wedding_id", input.weddingId);
    const dup = findDuplicateMoment(
      (existing ?? []) as Moment[],
      { name, date: input.eventDate, kind: input.eventType },
      input.id
    );
    if (dup) return { ok: false as const, reason: "duplicate" as const, duplicate: { id: dup.id, name: dup.name, date: dup.event_date } };
  }

  const fields: Record<string, unknown> = { name };
  if (input.eventDate !== undefined) fields.event_date = input.eventDate || null;
  if (input.startTime !== undefined) fields.start_time = input.startTime || null;
  if (input.endTime !== undefined) fields.end_time = input.endTime || null;
  if (input.venue !== undefined) fields.venue = input.venue || null;
  if (input.eventType !== undefined) fields.event_type = input.eventType || null;

  if (input.id) {
    let { error } = await supabase
      .from("wedding_events")
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq("id", input.id)
      .eq("wedding_id", input.weddingId);
    if (error) {
      // Pre-0024/0032 the file columns are thinner — the essentials land.
      ({ error } = await supabase
        .from("wedding_events")
        .update({ name, event_date: input.eventDate || null })
        .eq("id", input.id)
        .eq("wedding_id", input.weddingId));
    }
    if (error) return { ok: false as const, reason: "save" as const };
    await logActivity(supabase, input.weddingId, session.profile.full_name, "moment_updated", { name });
    revalidateMoments();
    return { ok: true as const, id: input.id };
  }

  const { data: last } = await supabase
    .from("wedding_events")
    .select("sort")
    .eq("wedding_id", input.weddingId)
    .order("sort", { ascending: false })
    .limit(1)
    .maybeSingle();
  let { data, error } = await supabase
    .from("wedding_events")
    .insert({ wedding_id: input.weddingId, sort: (last?.sort ?? 0) + 1, ...fields })
    .select("id")
    .single();
  if (error) {
    ({ data, error } = await supabase
      .from("wedding_events")
      .insert({ wedding_id: input.weddingId, sort: (last?.sort ?? 0) + 1, name, event_date: input.eventDate || null })
      .select("id")
      .single());
  }
  if (error || !data) return { ok: false as const, reason: "save" as const };
  await logActivity(supabase, input.weddingId, session.profile.full_name, "moment_created", { name });
  revalidateMoments();
  return { ok: true as const, id: data.id };
}

export async function setMomentArchived(weddingId: string, eventId: string, archived: boolean) {
  const session = await teamSession();
  const supabase = await createClient();
  const { error } = await supabase
    .from("wedding_events")
    .update({ archived })
    .eq("id", eventId)
    .eq("wedding_id", weddingId);
  if (error) return { ok: false as const };
  await logActivity(supabase, weddingId, session.profile.full_name, archived ? "moment_archived" : "moment_restored", {});
  revalidateMoments();
  return { ok: true as const };
}

/** §16 — delete is reserved for a moment nothing points at. */
export async function deleteMomentIfUnused(weddingId: string, eventId: string) {
  const session = await teamSession();
  const supabase = await createClient();
  const refs = await momentReferences(eventId);
  if (!canDeleteMoment(refs)) return { ok: false as const, reason: "referenced" as const, refs };
  const { error } = await supabase
    .from("wedding_events")
    .delete()
    .eq("id", eventId)
    .eq("wedding_id", weddingId);
  if (error) return { ok: false as const, reason: "save" as const };
  await logActivity(supabase, weddingId, session.profile.full_name, "moment_deleted", {});
  revalidateMoments();
  return { ok: true as const };
}

export async function reorderMoments(weddingId: string, orderedIds: string[]) {
  await teamSession();
  const supabase = await createClient();
  await Promise.all(
    orderedIds.map((id, i) =>
      supabase.from("wedding_events").update({ sort: i + 1 }).eq("id", id).eq("wedding_id", weddingId)
    )
  );
  revalidateMoments();
  return { ok: true as const };
}

/** The living registry, for any team picker. */
export async function listMoments(weddingId: string) {
  await teamSession();
  const supabase = await createClient();
  const { data } = await supabase
    .from("wedding_events")
    .select("id, name, event_date, sort, archived")
    .eq("wedding_id", weddingId)
    .order("sort");
  return ((data ?? []) as Moment[]).filter((m) => !m.archived);
}

/**
 * §6 — a ceremony without a moment: match when reliable, otherwise
 * one controlled creation. Never a silent duplicate.
 */
export async function createMomentFromCeremony(
  ceremonyId: string,
  mode: "detect" | "useExisting" | "createAnyway" = "detect"
) {
  const session = await teamSession();
  const supabase = await createClient();
  const { data: c } = await supabase
    .from("ceremonies")
    .select("id, wedding_id, kind, title, ceremony_date, start_time, venue")
    .eq("id", ceremonyId)
    .maybeSingle();
  if (!c) return { ok: false as const };
  const name = (c.title || c.kind || "Ceremony").trim();
  const { data: existing } = await supabase
    .from("wedding_events")
    .select("id, name, event_date, event_type, archived, sort")
    .eq("wedding_id", c.wedding_id);
  const dup = findDuplicateMoment((existing ?? []) as Moment[], {
    name,
    date: c.ceremony_date,
    kind: "ceremony"
  });
  if (dup && mode === "detect") {
    return { ok: false as const, reason: "duplicate" as const, duplicate: { id: dup.id, name: dup.name, date: dup.event_date } };
  }
  if (dup && mode === "useExisting") {
    await supabase.from("ceremonies").update({ event_id: dup.id }).eq("id", ceremonyId);
    revalidateMoments();
    return { ok: true as const, id: dup.id, linkedExisting: true };
  }
  const { data: last } = await supabase
    .from("wedding_events")
    .select("sort")
    .eq("wedding_id", c.wedding_id)
    .order("sort", { ascending: false })
    .limit(1)
    .maybeSingle();
  let { data: created, error } = await supabase
    .from("wedding_events")
    .insert({
      wedding_id: c.wedding_id,
      name,
      event_date: c.ceremony_date ?? null,
      start_time: c.start_time ?? null,
      venue: c.venue ?? null,
      event_type: "ceremony",
      sort: (last?.sort ?? 0) + 1
    })
    .select("id")
    .single();
  if (error) {
    ({ data: created, error } = await supabase
      .from("wedding_events")
      .insert({ wedding_id: c.wedding_id, name, event_date: c.ceremony_date ?? null, sort: (last?.sort ?? 0) + 1 })
      .select("id")
      .single());
  }
  if (error || !created) return { ok: false as const };
  await supabase.from("ceremonies").update({ event_id: created.id }).eq("id", ceremonyId);
  await logActivity(supabase, c.wedding_id, session.profile.full_name, "moment_created", { name, from: "ceremony" });
  revalidateMoments();
  return { ok: true as const, id: created.id };
}

/* ── single-link setters: a reference, never a copy ──────────────── */

export async function setCeremonyMoment(ceremonyId: string, eventId: string | null) {
  await teamSession();
  const supabase = await createClient();
  const { error } = await supabase.from("ceremonies").update({ event_id: eventId }).eq("id", ceremonyId);
  revalidatePath("/ceremony");
  return { ok: !error };
}

export async function setBudgetLineMoment(lineId: string, eventId: string | null) {
  await teamSession();
  const supabase = await createClient();
  const { error } = await supabase.from("budget_lines").update({ event_id: eventId }).eq("id", lineId);
  revalidatePath("/budget");
  return { ok: !error };
}

/* ── multi-links (§8–§11): vendors, documents, forms, boards ─────── */

export type MomentLinkModule = "vendor" | "document" | "form" | "board";

/** Everything a picker needs, in one round-trip. */
export async function momentLinkContext(weddingId: string, module: MomentLinkModule, recordId: string) {
  await teamSession();
  const supabase = await createClient();
  const [momentsRes, linksRes] = await Promise.all([
    supabase.from("wedding_events").select("id, name, event_date, sort, archived").eq("wedding_id", weddingId).order("sort"),
    supabase.from("moment_links").select("id, event_id").eq("module", module).eq("record_id", recordId)
  ]);
  return {
    moments: ((momentsRes.data ?? []) as Moment[]).filter((m) => !m.archived),
    links: (linksRes.data ?? []) as { id: string; event_id: string }[]
  };
}

export async function linkMoment(weddingId: string, eventId: string, module: MomentLinkModule, recordId: string) {
  await teamSession();
  const supabase = await createClient();
  const { error } = await supabase
    .from("moment_links")
    .upsert({ wedding_id: weddingId, event_id: eventId, module, record_id: recordId }, { onConflict: "event_id,module,record_id" });
  if (error) return { ok: false as const, needsMigration: true };
  revalidateMoments();
  return { ok: true as const };
}

/** §16 — Detach removes the relationship, never the moment. */
export async function unlinkMoment(linkId: string) {
  await teamSession();
  const supabase = await createClient();
  const { error } = await supabase.from("moment_links").delete().eq("id", linkId);
  revalidateMoments();
  return { ok: !error };
}

function revalidateMoments() {
  for (const p of ["/desk", "/timeline", "/ceremony", "/budget", "/vendors", "/documents", "/forms", "/design", "/communication", "/"]) {
    revalidatePath(p);
  }
}
