"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireHouseSession } from "@/lib/session";
import { logActivity } from "@/lib/activity";
import { notifyCouple } from "@/lib/notify";
import { TEMPLATE_FLOW } from "@/lib/ceremony";
import type { CeremonyStatus } from "@/lib/types";

async function teamSession() {
  const session = await requireHouseSession();
  if (!session.isTeam) throw new Error("team only");
  return session;
}

const paths = () => {
  revalidatePath("/ceremony");
  revalidatePath("/desk");
  revalidatePath("/");
};

/**
 * Timeline stays the source of truth for milestones (§17): the
 * ceremony keeps ONE anchor there — updated in place, same id,
 * never duplicated. Silent pre-0028 (no milestone_id column).
 */
async function syncMilestone(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ceremonyId: string
) {
  try {
    const { data: c } = await supabase.from("ceremonies").select("*").eq("id", ceremonyId).maybeSingle();
    if (!c || !("milestone_id" in c) || !c.ceremony_date) return;
    const month = `${c.ceremony_date.slice(0, 7)}-01`;
    const label = `Ceremony — ${c.title || c.kind}`;
    const status = c.status === "published" || c.status === "completed" ? "published" : "draft";
    const done = c.status === "completed";
    if (c.milestone_id) {
      await supabase
        .from("timeline_milestones")
        .update({ month, label, status, done })
        .eq("id", c.milestone_id);
    } else {
      const { data: m } = await supabase
        .from("timeline_milestones")
        .insert({ wedding_id: c.wedding_id, month, label, status, done, sort: 0 })
        .select("id")
        .single();
      if (m) await supabase.from("ceremonies").update({ milestone_id: m.id }).eq("id", ceremonyId);
    }
    revalidatePath("/timeline");
  } catch {
    // The anchor is a grace note — the ceremony stands without it.
  }
}

export async function saveCeremony(input: {
  id?: string;
  weddingId: string;
  kind: string;
  title: string;
  date: string;
  time: string;
  venue: string;
  officiant: string;
  notes: string;
  durationMin?: number | null;
  planB?: string;
}) {
  const session = await teamSession();
  const supabase = await createClient();
  const row: Record<string, unknown> = {
    kind: input.kind.trim(),
    title: input.title.trim() || null,
    ceremony_date: input.date || null,
    start_time: input.time.trim() || null,
    venue: input.venue.trim() || null,
    officiant: input.officiant.trim() || null,
    notes: input.notes.trim() || null
  };
  const extra: Record<string, unknown> = {
    duration_min: input.durationMin ?? null,
    plan_b: input.planB?.trim() || null,
    updated_at: new Date().toISOString()
  };
  let error;
  let id = input.id ?? null;
  if (input.id) {
    // The journal keeps what moved — previous value, new value (§25).
    const { data: prev } = await supabase.from("ceremonies").select("*").eq("id", input.id).maybeSingle();
    ({ error } = await supabase.from("ceremonies").update({ ...row, ...extra }).eq("id", input.id));
    if (error) {
      // Pre-0028 the new columns are absent — the form still saves.
      ({ error } = await supabase.from("ceremonies").update(row).eq("id", input.id));
    }
    if (!error && prev) {
      const moved: Record<string, { from: unknown; to: unknown }> = {};
      for (const k of ["kind", "title", "ceremony_date", "start_time", "venue", "officiant"] as const) {
        if ((prev[k] ?? null) !== (row[k] ?? null)) moved[k] = { from: prev[k] ?? null, to: row[k] ?? null };
      }
      if (Object.keys(moved).length) {
        await logActivity(supabase, input.weddingId, session.profile.full_name, "ceremony_edited", {
          ceremonyId: input.id, moved
        });
      }
    }
  } else {
    const { count } = await supabase
      .from("ceremonies")
      .select("id", { count: "exact", head: true })
      .eq("wedding_id", input.weddingId);
    let created;
    ({ data: created, error } = await supabase
      .from("ceremonies")
      .insert({ wedding_id: input.weddingId, ...row, ...extra, status: "draft", sort: (count ?? 0) + 1 })
      .select("id")
      .single());
    if (error) {
      ({ data: created, error } = await supabase
        .from("ceremonies")
        .insert({ wedding_id: input.weddingId, ...row, sort: (count ?? 0) + 1 })
        .select("id")
        .single());
    }
    id = created?.id ?? null;
    if (!error) {
      await logActivity(supabase, input.weddingId, session.profile.full_name, "ceremony_created", {
        ceremonyId: id, kind: row.kind, title: row.title
      });
    }
  }
  if (error) return { ok: false as const, message: error.message };
  if (id) await syncMilestone(supabase, id);
  paths();
  return { ok: true as const, id };
}

/**
 * Delete is for drafts; an approved or published ceremony archives —
 * its history is never hard-deleted (§18/§25). Pre-0028 the old
 * gesture stands.
 */
export async function deleteCeremony(id: string) {
  const session = await teamSession();
  const supabase = await createClient();
  const { data: c } = await supabase.from("ceremonies").select("*").eq("id", id).maybeSingle();
  if (!c) return { ok: true as const, archived: false };
  const status = (c as { status?: string }).status;
  if (status && status !== "draft") {
    const { error } = await supabase.from("ceremonies").update({ archived: true }).eq("id", id);
    if (!error) {
      await logActivity(supabase, c.wedding_id, session.profile.full_name, "ceremony_archived", {
        ceremonyId: id, title: c.title ?? c.kind
      });
      paths();
      return { ok: true as const, archived: true };
    }
  }
  if (c.milestone_id) await supabase.from("timeline_milestones").delete().eq("id", c.milestone_id);
  await supabase.from("ceremonies").delete().eq("id", id);
  await logActivity(supabase, c.wedding_id, session.profile.full_name, "ceremony_deleted", {
    ceremonyId: id, title: c.title ?? c.kind
  });
  paths();
  return { ok: true as const, archived: false };
}

export async function setCeremonyArchived(id: string, archived: boolean) {
  const session = await teamSession();
  const supabase = await createClient();
  const { data: c } = await supabase.from("ceremonies").select("wedding_id, title, kind").eq("id", id).maybeSingle();
  const { error } = await supabase.from("ceremonies").update({ archived }).eq("id", id);
  if (error) return { ok: false as const, needsMigration: true };
  if (c) {
    await logActivity(supabase, c.wedding_id, session.profile.full_name, archived ? "ceremony_archived" : "ceremony_restored", {
      ceremonyId: id, title: c.title ?? c.kind
    });
  }
  paths();
  return { ok: true as const };
}

/**
 * The ceremony's state under Estelle's hand (§22): publishing keeps a
 * version of what the couple is being shown, and may notify them —
 * her explicit choice, never automatic.
 */
export async function setCeremonyStatus(id: string, status: CeremonyStatus, notify = false) {
  const session = await teamSession();
  const supabase = await createClient();
  const { data: c } = await supabase.from("ceremonies").select("*").eq("id", id).maybeSingle();
  if (!c) return { ok: false as const };
  const { error } = await supabase
    .from("ceremonies")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false as const, needsMigration: true };

  if (status === "published") {
    try {
      const [{ data: flow }, { data: participants }] = await Promise.all([
        supabase.from("ceremony_flow").select("*").eq("ceremony_id", id).eq("archived", false).order("sort"),
        supabase.from("ceremony_participants").select("*").eq("ceremony_id", id).order("sort")
      ]);
      await supabase.from("publication_versions").insert({
        wedding_id: c.wedding_id,
        kind: "ceremony",
        summary: { ceremonyId: id, title: c.title ?? c.kind },
        snapshot: {
          ceremony: {
            kind: c.kind, title: c.title, ceremony_date: c.ceremony_date, start_time: c.start_time,
            venue: c.venue, officiant: c.officiant, notes: c.notes, duration_min: (c as { duration_min?: number }).duration_min ?? null
          },
          flow: flow ?? [],
          participants: participants ?? []
        },
        created_by: session.profile.full_name
      });
    } catch {
      // Pre-0027 there is no register of versions — publication stands.
    }
    if (notify) {
      await notifyCouple(c.wedding_id, {
        kind: "ceremony_published",
        title: "Your ceremony was updated",
        body: "The house has published your ceremony page — it awaits you.",
        url: "/ceremony"
      });
    }
  }
  await logActivity(supabase, c.wedding_id, session.profile.full_name, "ceremony_status", {
    ceremonyId: id, from: (c as { status?: string }).status ?? "draft", to: status, notified: notify
  });
  await syncMilestone(supabase, id);
  paths();
  return { ok: true as const };
}

/**
 * The overview returns to its last published version (§22) — the
 * unpublished changes leave; the sections stay under the hand.
 */
export async function revertCeremonyToPublished(id: string) {
  const session = await teamSession();
  const supabase = await createClient();
  const { data: c } = await supabase.from("ceremonies").select("wedding_id").eq("id", id).maybeSingle();
  if (!c) return { ok: false as const };
  const { data: versions } = await supabase
    .from("publication_versions")
    .select("summary, snapshot, created_at")
    .eq("wedding_id", c.wedding_id)
    .eq("kind", "ceremony")
    .order("created_at", { ascending: false })
    .limit(30);
  const target = (versions ?? []).find(
    (v) =>
      (v.summary as { ceremonyId?: string } | null)?.ceremonyId === id &&
      Boolean((v.snapshot as { ceremony?: unknown } | null)?.ceremony)
  );
  if (!target) return { ok: false as const, reason: "no_version" as const };
  const snap = (target.snapshot as { ceremony: Record<string, unknown> }).ceremony;
  const { error } = await supabase
    .from("ceremonies")
    .update({
      kind: snap.kind, title: snap.title, ceremony_date: snap.ceremony_date, start_time: snap.start_time,
      venue: snap.venue, officiant: snap.officiant, notes: snap.notes,
      duration_min: snap.duration_min ?? null, updated_at: new Date().toISOString()
    })
    .eq("id", id);
  if (!error) {
    await logActivity(supabase, c.wedding_id, session.profile.full_name, "ceremony_reverted", { ceremonyId: id });
  }
  paths();
  return { ok: !error };
}

/** A twin ceremony, whole — sections included — born in draft (§23). */
export async function duplicateCeremony(id: string) {
  const session = await teamSession();
  const supabase = await createClient();
  const { data: src } = await supabase.from("ceremonies").select("*").eq("id", id).maybeSingle();
  if (!src) return { ok: false as const };
  const { count } = await supabase
    .from("ceremonies")
    .select("id", { count: "exact", head: true })
    .eq("wedding_id", src.wedding_id);
  const base: Record<string, unknown> = {
    wedding_id: src.wedding_id, kind: src.kind, title: src.title ? `${src.title} — ii` : null,
    ceremony_date: src.ceremony_date, start_time: src.start_time, venue: src.venue,
    officiant: src.officiant, notes: src.notes, sort: (count ?? 0) + 1
  };
  let { data: created, error } = await supabase
    .from("ceremonies")
    .insert({ ...base, status: "draft", duration_min: (src as { duration_min?: number }).duration_min ?? null, plan_b: (src as { plan_b?: string }).plan_b ?? null })
    .select("id")
    .single();
  if (error) {
    ({ data: created, error } = await supabase.from("ceremonies").insert(base).select("id").single());
  }
  if (error || !created) return { ok: false as const };

  // The sections follow — participants first, so the flow can repoint.
  try {
    const [{ data: parts }, { data: flow }, { data: music }, { data: readings }, { data: logistics }, { data: docs }] =
      await Promise.all([
        supabase.from("ceremony_participants").select("*").eq("ceremony_id", id).order("sort"),
        supabase.from("ceremony_flow").select("*").eq("ceremony_id", id).order("sort"),
        supabase.from("ceremony_music").select("*").eq("ceremony_id", id).order("sort"),
        supabase.from("ceremony_readings").select("*").eq("ceremony_id", id).order("sort"),
        supabase.from("ceremony_logistics").select("*").eq("ceremony_id", id).order("sort"),
        supabase.from("ceremony_documents").select("*").eq("ceremony_id", id)
      ]);
    const partMap = new Map<string, string>();
    for (const p of parts ?? []) {
      const { data: np } = await supabase
        .from("ceremony_participants")
        .insert({ wedding_id: p.wedding_id, ceremony_id: created.id, person_id: p.person_id, vendor_id: p.vendor_id, name: p.name, role: p.role, note_internal: p.note_internal, client_visible: p.client_visible, sort: p.sort })
        .select("id")
        .single();
      if (np) partMap.set(p.id, np.id);
    }
    const flowMap = new Map<string, string>();
    for (const f of flow ?? []) {
      const { data: nf } = await supabase
        .from("ceremony_flow")
        .insert({ wedding_id: f.wedding_id, ceremony_id: created.id, block_type: f.block_type, title: f.title, description: f.description, participant_id: f.participant_id ? partMap.get(f.participant_id) ?? null : null, duration_min: f.duration_min, note_internal: f.note_internal, note_client: f.note_client, archived: f.archived, sort: f.sort })
        .select("id")
        .single();
      if (nf) flowMap.set(f.id, nf.id);
    }
    for (const m of music ?? []) {
      await supabase.from("ceremony_music").insert({ wedding_id: m.wedding_id, ceremony_id: created.id, slot: m.slot, title: m.title, artist: m.artist, version: m.version, performer: m.performer, vendor_id: m.vendor_id, duration_min: m.duration_min, document_id: m.document_id, cue: m.cue, flow_id: m.flow_id ? flowMap.get(m.flow_id) ?? null : null, note_internal: m.note_internal, status: m.status, archived: m.archived, sort: m.sort });
    }
    for (const r of readings ?? []) {
      await supabase.from("ceremony_readings").insert({ wedding_id: r.wedding_id, ceremony_id: created.id, title: r.title, excerpt: r.excerpt, reader_participant_id: r.reader_participant_id ? partMap.get(r.reader_participant_id) ?? null : null, language: r.language, duration_min: r.duration_min, document_id: r.document_id, note_internal: r.note_internal, note_client: r.note_client, status: r.status, archived: r.archived, sort: r.sort });
    }
    for (const l of logistics ?? []) {
      await supabase.from("ceremony_logistics").insert({ wedding_id: l.wedding_id, ceremony_id: created.id, item: l.item, detail: l.detail, qty: l.qty, owner: l.owner, vendor_id: l.vendor_id, budget_line_id: l.budget_line_id, document_id: l.document_id, status: l.status, note_internal: l.note_internal, sort: l.sort });
    }
    for (const d of docs ?? []) {
      await supabase.from("ceremony_documents").insert({ wedding_id: d.wedding_id, ceremony_id: created.id, document_id: d.document_id, role: d.role });
    }
  } catch {
    // Pre-0028 the sections are absent — the overview twin stands.
  }
  await logActivity(supabase, src.wedding_id, session.profile.full_name, "ceremony_duplicated", {
    from: id, to: created.id
  });
  paths();
  return { ok: true as const, id: created.id };
}

/** A readiness mark — required, optional, not applicable (§16). */
export async function setCeremonyCheckMark(id: string, check: string, level: "required" | "optional" | "na") {
  await teamSession();
  const supabase = await createClient();
  const { data: c } = await supabase.from("ceremonies").select("checklist").eq("id", id).maybeSingle();
  if (!c) return { ok: false as const, needsMigration: true };
  const checklist = { ...((c.checklist as Record<string, string> | null) ?? {}), [check]: level };
  const { error } = await supabase.from("ceremonies").update({ checklist }).eq("id", id);
  paths();
  return { ok: !error, needsMigration: Boolean(error) };
}

/* ══════════ the sections — one shape of gesture each ══════════ */

type SectionTable =
  | "ceremony_participants"
  | "ceremony_flow"
  | "ceremony_music"
  | "ceremony_readings"
  | "ceremony_logistics";
const SECTION_TABLES: SectionTable[] = [
  "ceremony_participants", "ceremony_flow", "ceremony_music", "ceremony_readings", "ceremony_logistics"
];

/**
 * One save for every section row: insert or update, journal, silence
 * before 0028. The row arrives already shaped by the section's form.
 */
export async function saveCeremonyItem(input: {
  table: SectionTable;
  id?: string;
  weddingId: string;
  ceremonyId: string;
  row: Record<string, unknown>;
}) {
  const session = await teamSession();
  if (!SECTION_TABLES.includes(input.table)) return { ok: false as const };
  const supabase = await createClient();
  let error;
  let id = input.id ?? null;
  if (input.id) {
    ({ error } = await supabase.from(input.table).update(input.row).eq("id", input.id));
  } else {
    const { count } = await supabase
      .from(input.table)
      .select("id", { count: "exact", head: true })
      .eq("ceremony_id", input.ceremonyId);
    const { data: created, error: insErr } = await supabase
      .from(input.table)
      .insert({ wedding_id: input.weddingId, ceremony_id: input.ceremonyId, sort: (count ?? 0) + 1, ...input.row })
      .select("id")
      .single();
    error = insErr;
    id = created?.id ?? null;
  }
  if (error) return { ok: false as const, needsMigration: true };
  await logActivity(supabase, input.weddingId, session.profile.full_name, "ceremony_section_saved", {
    ceremonyId: input.ceremonyId, table: input.table, itemId: id
  });
  await supabase.from("ceremonies").update({ updated_at: new Date().toISOString() }).eq("id", input.ceremonyId);
  paths();
  return { ok: true as const, id };
}

/** Remove — or archive where the table knows how (§8/§10). */
export async function removeCeremonyItem(table: SectionTable, id: string, archive = false) {
  const session = await teamSession();
  if (!SECTION_TABLES.includes(table)) return { ok: false as const };
  const supabase = await createClient();
  const { data: item } = await supabase.from(table).select("*").eq("id", id).maybeSingle();
  if (!item) return { ok: true as const };
  if (archive && "archived" in item) {
    await supabase.from(table).update({ archived: !item.archived }).eq("id", id);
  } else {
    await supabase.from(table).delete().eq("id", id);
  }
  await logActivity(supabase, item.wedding_id, session.profile.full_name, archive ? "ceremony_item_archived" : "ceremony_item_removed", {
    ceremonyId: item.ceremony_id, table, itemId: id
  });
  paths();
  return { ok: true as const };
}

/** The order under the hand: the item trades places with its neighbour. */
export async function moveCeremonyItem(table: SectionTable, id: string, dir: -1 | 1) {
  await teamSession();
  if (!SECTION_TABLES.includes(table)) return { ok: false as const };
  const supabase = await createClient();
  const { data: item } = await supabase.from(table).select("id, ceremony_id, sort").eq("id", id).maybeSingle();
  if (!item) return { ok: false as const };
  const { data: all } = await supabase
    .from(table)
    .select("id, sort")
    .eq("ceremony_id", item.ceremony_id)
    .order("sort");
  const list = all ?? [];
  const i = list.findIndex((x) => x.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return { ok: false as const };
  await supabase.from(table).update({ sort: list[j].sort === list[i].sort ? list[i].sort + dir : list[j].sort }).eq("id", list[i].id);
  await supabase.from(table).update({ sort: list[i].sort }).eq("id", list[j].id);
  paths();
  return { ok: true as const };
}

/** A twin of a flow item or reading, right below the original. */
export async function duplicateCeremonyItem(table: SectionTable, id: string) {
  await teamSession();
  if (!SECTION_TABLES.includes(table)) return { ok: false as const };
  const supabase = await createClient();
  const { data: src } = await supabase.from(table).select("*").eq("id", id).maybeSingle();
  if (!src) return { ok: false as const };
  const { id: _id, created_at: _c, ...rest } = src as Record<string, unknown>;
  void _id; void _c;
  const { error } = await supabase.from(table).insert({ ...rest, sort: Number(src.sort ?? 0) + 1 });
  paths();
  return { ok: !error };
}

/** The house's classical flow, laid in one gesture (§5) — a start. */
export async function applyTemplateFlow(weddingId: string, ceremonyId: string) {
  const session = await teamSession();
  const supabase = await createClient();
  const { count } = await supabase
    .from("ceremony_flow")
    .select("id", { count: "exact", head: true })
    .eq("ceremony_id", ceremonyId);
  let sort = count ?? 0;
  for (const block of TEMPLATE_FLOW) {
    sort += 1;
    const { error } = await supabase.from("ceremony_flow").insert({
      wedding_id: weddingId, ceremony_id: ceremonyId, ...block, sort
    });
    if (error) return { ok: false as const, needsMigration: true };
  }
  await logActivity(supabase, weddingId, session.profile.full_name, "ceremony_template_applied", { ceremonyId });
  paths();
  return { ok: true as const };
}

/* ══════════ documents — linked, never copied (§11) ══════════ */

export async function linkCeremonyDocument(weddingId: string, ceremonyId: string, documentId: string, role: string) {
  const session = await teamSession();
  const supabase = await createClient();
  const { error } = await supabase.from("ceremony_documents").upsert(
    { wedding_id: weddingId, ceremony_id: ceremonyId, document_id: documentId, role },
    { onConflict: "ceremony_id,document_id" }
  );
  if (error) return { ok: false as const, needsMigration: true };
  await logActivity(supabase, weddingId, session.profile.full_name, "ceremony_doc_linked", {
    ceremonyId, documentId, role
  });
  paths();
  return { ok: true as const };
}

/** Detach leaves the source file untouched in its register (§11). */
export async function detachCeremonyDocument(linkId: string) {
  const session = await teamSession();
  const supabase = await createClient();
  const { data: link } = await supabase.from("ceremony_documents").select("*").eq("id", linkId).maybeSingle();
  await supabase.from("ceremony_documents").delete().eq("id", linkId);
  if (link) {
    await logActivity(supabase, link.wedding_id, session.profile.full_name, "ceremony_doc_detached", {
      ceremonyId: link.ceremony_id, documentId: link.document_id
    });
  }
  paths();
  return { ok: true as const };
}
