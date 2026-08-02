"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireHouseSession } from "@/lib/session";
import { logActivity } from "@/lib/activity";
import { revalidateRooms } from "@/lib/revalidate";

/** Team guard for all timeline mutations — RLS enforces it again below. */
async function teamSession() {
  const session = await requireHouseSession();
  if (!session.isTeam) throw new Error("team only");
  return session;
}

export async function saveMilestone(input: {
  id?: string;
  weddingId: string;
  month: string; // yyyy-mm
  label: string;
  done: boolean;
  /** The operational side (0029) — lives in milestone_ops, team-only. */
  ops?: {
    opStatus?: string;
    priority?: string;
    owner?: string;
    description?: string;
    dueDate?: string;
    dependsOn?: string | null;
    module?: string | null;
    vendorId?: string | null;
    budgetLineId?: string | null;
    documentId?: string | null;
    ceremonyId?: string | null;
    noteInternal?: string;
  };
}) {
  const session = await teamSession();
  const supabase = await createClient();
  const month = `${input.month}-01`;
  // Completed follows the operational state, and the old flag follows
  // completed — one truth, two readers.
  const done = input.ops?.opStatus ? input.ops.opStatus === "completed" : input.done;
  let id = input.id ?? null;
  if (input.id) {
    await supabase
      .from("timeline_milestones")
      .update({ month, label: input.label, done, status: "draft" })
      .eq("id", input.id);
  } else {
    const { data: created } = await supabase
      .from("timeline_milestones")
      .insert({
        wedding_id: input.weddingId,
        month,
        label: input.label,
        done,
        status: "draft"
      })
      .select("id")
      .single();
    id = created?.id ?? null;
  }
  let opsSaved = true;
  if (id && input.ops) {
    const { error } = await supabase.from("milestone_ops").upsert({
      milestone_id: id,
      wedding_id: input.weddingId,
      op_status: input.ops.opStatus ?? (done ? "completed" : "planned"),
      priority: input.ops.priority ?? "standard",
      owner: input.ops.owner?.trim() || null,
      description: input.ops.description?.trim() || null,
      due_date: input.ops.dueDate || null,
      depends_on: input.ops.dependsOn ?? null,
      module: input.ops.module ?? null,
      vendor_id: input.ops.vendorId ?? null,
      budget_line_id: input.ops.budgetLineId ?? null,
      document_id: input.ops.documentId ?? null,
      ceremony_id: input.ops.ceremonyId ?? null,
      note_internal: input.ops.noteInternal?.trim() || null,
      updated_at: new Date().toISOString()
    });
    // Pre-0029 the operational table is absent — the milestone stands.
    if (error) opsSaved = false;
  }
  await logActivity(supabase, input.weddingId, session.profile.full_name, input.id ? "milestone_saved" : "milestone_created", {
    milestoneId: id, label: input.label, ...(input.ops?.opStatus ? { opStatus: input.ops.opStatus } : {})
  });
  revalidateRooms("", "timeline");
  return { ok: true as const, id, opsSaved };
}

export async function deleteMilestone(id: string) {
  const session = await teamSession();
  const supabase = await createClient();
  const { data: m } = await supabase.from("timeline_milestones").select("wedding_id, label").eq("id", id).maybeSingle();
  await supabase.from("timeline_milestones").delete().eq("id", id);
  if (m) {
    await logActivity(supabase, m.wedding_id, session.profile.full_name, "milestone_deleted", { milestoneId: id, label: m.label });
  }
  revalidateRooms("", "timeline");
}

/** The importer's door (§23): rows become draft milestones with their
    operational side; duplicates were left aside during review. */
export interface MilestoneImportRow {
  action: "create" | "skip";
  month: string; // yyyy-mm
  label: string;
  description?: string;
  owner?: string;
  due?: string;
  priority?: string;
}

export async function importMilestones(weddingId: string, rows: MilestoneImportRow[]) {
  const session = await teamSession();
  const supabase = await createClient();
  let created = 0;
  let skipped = 0;
  for (const r of rows) {
    if (r.action !== "create" || !r.label.trim() || !/^\d{4}-\d{2}$/.test(r.month)) { skipped += 1; continue; }
    const { data: m } = await supabase
      .from("timeline_milestones")
      .insert({ wedding_id: weddingId, month: `${r.month}-01`, label: r.label.trim(), done: false, status: "draft" })
      .select("id")
      .single();
    if (!m) { skipped += 1; continue; }
    created += 1;
    await supabase.from("milestone_ops").upsert({
      milestone_id: m.id,
      wedding_id: weddingId,
      op_status: "planned",
      priority: r.priority === "high" ? "high" : "standard",
      owner: r.owner?.trim() || null,
      description: r.description?.trim() || null,
      due_date: r.due || null
    });
  }
  await logActivity(supabase, weddingId, session.profile.full_name, "timeline_import", { created, skipped });
  revalidateRooms("", "timeline");
  return { ok: true as const, created, skipped };
}

/* ══════════ attentions, enhanced (§9) ══════════ */

export async function snoozeAttention(id: string, untilDays: number) {
  await teamSession();
  const supabase = await createClient();
  const until = new Date(Date.now() + untilDays * 86400000).toISOString().slice(0, 10);
  const { error } = await supabase.from("attentions").update({ snoozed_until: until }).eq("id", id);
  revalidatePath("/timeline");
  return { ok: !error, needsMigration: Boolean(error) };
}

export async function dismissAttention(id: string) {
  const session = await teamSession();
  const supabase = await createClient();
  const { data: a } = await supabase.from("attentions").select("wedding_id, title").eq("id", id).maybeSingle();
  const { error } = await supabase.from("attentions").update({ dismissed: true }).eq("id", id);
  if (!error && a) {
    await logActivity(supabase, a.wedding_id, session.profile.full_name, "attention_dismissed", { attentionId: id, title: a.title });
  }
  revalidatePath("/timeline");
  return { ok: !error, needsMigration: Boolean(error) };
}

/** The team resolves an attention on the couple's behalf. */
export async function resolveAttention(id: string) {
  await teamSession();
  const supabase = await createClient();
  await supabase.from("attentions").update({ status: "attended" }).eq("id", id);
  revalidatePath("/timeline");
  return { ok: true as const };
}

export async function publishTimeline(weddingId: string) {
  const session = await teamSession();
  const supabase = await createClient();
  const { data: published } = await supabase.rpc("publish_timeline", { p_wedding: weddingId });
  await logActivity(supabase, weddingId, session.profile.full_name, "publish_timeline", {
    counts: { milestones: published ?? 0 }
  });
  revalidateRooms("", "timeline");
}

export async function saveMonthlyNoteDraft(input: {
  weddingId: string;
  month: string; // yyyy-mm
  subjects: string;
  composed: string;
}) {
  await teamSession();
  const supabase = await createClient();
  await supabase.from("monthly_notes").upsert(
    {
      wedding_id: input.weddingId,
      month: `${input.month}-01`,
      subjects_raw: input.subjects,
      composed_text: input.composed,
      status: "draft"
    },
    { onConflict: "wedding_id,month" }
  );
  revalidatePath("/timeline");
}

export async function publishMonthlyNote(weddingId: string, month: string) {
  const session = await teamSession();
  const supabase = await createClient();
  await supabase
    .from("monthly_notes")
    .update({ status: "published" })
    .eq("wedding_id", weddingId)
    .eq("month", `${month}-01`);
  await logActivity(supabase, weddingId, session.profile.full_name, "publish_monthly_note", {
    month
  });
  revalidatePath("/timeline");
}

export async function entrustAttention(input: {
  weddingId: string;
  title: string;
  due?: string;
  status: "awaiting_word" | "at_leisure";
  link?: string;
  urgency?: "high" | "standard";
  owner?: string;
  module?: string;
}) {
  await teamSession();
  const supabase = await createClient();
  const row: Record<string, unknown> = {
    wedding_id: input.weddingId,
    title: input.title,
    due_date: input.due || null,
    status: input.status
  };
  if (input.link?.trim()) row.link_url = input.link.trim();
  // Enhanced fields ride along (0029) — shed gracefully before it.
  const enhanced = {
    ...(input.urgency ? { urgency: input.urgency } : {}),
    ...(input.owner?.trim() ? { owner: input.owner.trim() } : {}),
    ...(input.module?.trim() ? { module: input.module.trim() } : {})
  };
  let { error } = await supabase.from("attentions").insert({ ...row, ...enhanced });
  if (error && Object.keys(enhanced).length) {
    ({ error } = await supabase.from("attentions").insert(row));
  }
  // Before migration 0010 the column is absent — the attention stands,
  // its link folded into the title.
  if (error && row.link_url) {
    delete row.link_url;
    row.title = `${input.title} — ${input.link!.trim()}`;
    ({ error } = await supabase.from("attentions").insert(row));
  }
  revalidatePath("/timeline");
  return { ok: !error };
}

/** The couple marks an attention attended to (guarded by trigger + RLS). */
export async function settleAttention(id: string) {
  const supabase = await createClient();
  await supabase.from("attentions").update({ status: "attended" }).eq("id", id);
  revalidatePath("/timeline");
}

/**
 * The whole monthly card in one word: the month's note and the
 * previews of the three months that follow — drafts until published.
 */
export async function saveMonthlyComposition(input: {
  weddingId: string;
  month: string; // yyyy-mm
  subjects: string;
  composed: string;
  previews: { month: string; text: string }[];
  publish: boolean;
}) {
  await teamSession();
  const supabase = await createClient();
  const status = input.publish ? "published" : "draft";
  await supabase.from("monthly_notes").upsert(
    {
      wedding_id: input.weddingId,
      month: `${input.month}-01`,
      subjects_raw: input.subjects,
      composed_text: input.composed,
      status
    },
    { onConflict: "wedding_id,month" }
  );
  for (const p of input.previews) {
    if (!p.month || !p.text) continue;
    await supabase.from("monthly_notes").upsert(
      {
        wedding_id: input.weddingId,
        month: `${p.month}-01`,
        preview_text: p.text,
        status
      },
      { onConflict: "wedding_id,month" }
    );
  }
  revalidatePath("/timeline");
  return { ok: true as const };
}

/**
 * One preview, held by hand: Estelle rewrites it, keeps it as draft,
 * publishes it, or withdraws it — month by month, never all at once.
 */
export async function savePreview(input: {
  weddingId: string;
  month: string; // yyyy-mm
  text: string;
  publish: boolean;
}) {
  await teamSession();
  const supabase = await createClient();
  await supabase.from("monthly_notes").upsert(
    {
      wedding_id: input.weddingId,
      month: `${input.month}-01`,
      preview_text: input.text.trim(),
      status: input.publish ? "published" : "draft"
    },
    { onConflict: "wedding_id,month" }
  );
  revalidatePath("/timeline");
  return { ok: true as const };
}

export async function removePreview(weddingId: string, month: string) {
  await teamSession();
  const supabase = await createClient();
  const { data: row } = await supabase
    .from("monthly_notes")
    .select("id, composed_text")
    .eq("wedding_id", weddingId)
    .eq("month", `${month}-01`)
    .maybeSingle();
  if (!row) return { ok: true as const };
  if (row.composed_text) {
    // The month keeps its note; only the preview withdraws.
    await supabase.from("monthly_notes").update({ preview_text: null }).eq("id", row.id);
  } else {
    await supabase.from("monthly_notes").delete().eq("id", row.id);
  }
  revalidatePath("/timeline");
  return { ok: true as const };
}
