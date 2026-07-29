"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireHouseSession } from "@/lib/session";
import { notifyCouple } from "@/lib/notify";
import { logActivity } from "@/lib/activity";
import { publishDocumentToCouple } from "@/app/actions/documents";
import { runAgent } from "@/lib/agents/run";

async function teamSession() {
  const session = await requireHouseSession();
  if (!session.isTeam) throw new Error("team only");
  return session;
}

export interface PublishState {
  budgetLines: number;
  envelopeNotes: number;
  milestones: number;
  /** yyyy-mm of monthly notes still in draft. */
  months: string[];
  /** Internal documents the house may choose to hand over — opt-in only. */
  docs: { id: string; label: string; category: string }[];
  journal: JournalEntry[];
  /** False until migration 0015 has been run. */
  journalAvailable: boolean;
}

export interface JournalEntry {
  id: string;
  actor: string;
  action: string;
  detail: Record<string, unknown>;
  reverted_at: string | null;
  created_at: string;
}

/**
 * Everything currently awaiting Estelle's word, counted fresh — the
 * grouped publication decides from this, never from stale props.
 */
export async function getPublishState(weddingId: string): Promise<PublishState> {
  await teamSession();
  const supabase = await createClient();

  const [linesRes, notesRes, milestonesRes, monthsRes, docsRes, journalRes] = await Promise.all([
    supabase
      .from("budget_lines")
      .select("id", { count: "exact", head: true })
      .eq("wedding_id", weddingId)
      .eq("status", "draft"),
    supabase
      .from("envelope_notes")
      .select("id", { count: "exact", head: true })
      .eq("wedding_id", weddingId)
      .eq("status", "draft"),
    supabase
      .from("timeline_milestones")
      .select("id", { count: "exact", head: true })
      .eq("wedding_id", weddingId)
      .eq("status", "draft"),
    supabase
      .from("monthly_notes")
      .select("month")
      .eq("wedding_id", weddingId)
      .eq("status", "draft")
      .order("month"),
    supabase
      .from("documents")
      .select("id, label, category")
      .eq("wedding_id", weddingId)
      .eq("internal", true)
      .order("created_at", { ascending: false }),
    supabase
      .from("activity_log")
      .select("id, actor, action, detail, reverted_at, created_at")
      .eq("wedding_id", weddingId)
      .order("created_at", { ascending: false })
      .limit(12)
  ]);

  return {
    budgetLines: linesRes.count ?? 0,
    envelopeNotes: notesRes.count ?? 0,
    milestones: milestonesRes.count ?? 0,
    months: (monthsRes.data ?? []).map((m) => String(m.month).slice(0, 7)),
    docs: (docsRes.data ?? []).map((d) => ({
      id: d.id,
      label: d.label,
      category: (d as { category?: string | null }).category ?? "practical"
    })),
    journal: (journalRes.data ?? []) as JournalEntry[],
    journalAvailable: !journalRes.error
  };
}

export interface SweepInput {
  budget: boolean;
  timeline: boolean;
  months: string[];
  docIds: string[];
}

/**
 * The grouped publication (brief §2.3): one confirmed gesture, an
 * explicit recap of what becomes visible, and a trace in the journal
 * precise enough to take the whole sweep back.
 */
export async function publishSweep(weddingId: string, input: SweepInput) {
  const session = await teamSession();
  const supabase = await createClient();

  // Collect ids BEFORE publishing — the journal must know exactly
  // which rows this sweep touched, or unpublishing would overreach.
  const detail: Record<string, unknown> = {};
  const counts = { lines: 0, notes: 0, milestones: 0, months: 0, docs: 0 };

  if (input.budget) {
    const [{ data: lines }, { data: notes }] = await Promise.all([
      supabase
        .from("budget_lines")
        .select("id")
        .eq("wedding_id", weddingId)
        .eq("status", "draft"),
      supabase
        .from("envelope_notes")
        .select("id")
        .eq("wedding_id", weddingId)
        .eq("status", "draft")
    ]);
    detail.lineIds = (lines ?? []).map((l) => l.id);
    detail.noteIds = (notes ?? []).map((n) => n.id);
    counts.lines = (lines ?? []).length;
    counts.notes = (notes ?? []).length;
    await supabase.rpc("publish_budget", { p_wedding: weddingId });
  }

  if (input.timeline) {
    const { data: ms } = await supabase
      .from("timeline_milestones")
      .select("id")
      .eq("wedding_id", weddingId)
      .eq("status", "draft");
    detail.milestoneIds = (ms ?? []).map((m) => m.id);
    counts.milestones = (ms ?? []).length;
    await supabase.rpc("publish_timeline", { p_wedding: weddingId });
  }

  if (input.months.length > 0) {
    const monthDates = input.months.map((m) => `${m}-01`);
    const { data: monthRows } = await supabase
      .from("monthly_notes")
      .select("id")
      .eq("wedding_id", weddingId)
      .eq("status", "draft")
      .in("month", monthDates);
    detail.monthNoteIds = (monthRows ?? []).map((m) => m.id);
    counts.months = (monthRows ?? []).length;
    await supabase
      .from("monthly_notes")
      .update({ status: "published" })
      .eq("wedding_id", weddingId)
      .eq("status", "draft")
      .in("month", monthDates);
  }

  if (input.docIds.length > 0) {
    // Documents are opt-in, one by one — internal material never
    // leaves the house in a blanket gesture. Each goes through the
    // same door as the manual gesture (the file must reach the
    // shared room, not merely flip a flag).
    const { data: docRows } = await supabase
      .from("documents")
      .select("id")
      .eq("wedding_id", weddingId)
      .eq("internal", true)
      .in("id", input.docIds);
    const published: string[] = [];
    for (const row of docRows ?? []) {
      const r = await publishDocumentToCouple(row.id, false);
      if (r.ok) published.push(row.id);
    }
    detail.docIds = published;
    counts.docs = published.length;
  }

  detail.counts = counts;
  const logId = await logActivity(
    supabase,
    weddingId,
    session.profile.full_name,
    "publish_sweep",
    detail
  );

  // One quiet word to the couple for the whole sweep — never one per object.
  const published = counts.lines + counts.notes + counts.milestones + counts.months + counts.docs;
  if (published > 0) {
    await notifyCouple(weddingId, {
      kind: "house_published",
      title: "The house has news for you",
      body: "New details await you in The Inner House.",
      url: "/"
    });
  }

  // The budget analysis recomposes over the now-published numbers —
  // a grace note; the publication stands without it.
  if (input.budget && counts.lines > 0) {
    try {
      const [{ data: lines }, { data: wedding }] = await Promise.all([
        supabase
          .from("budget_lines")
          .select("label, budgeted, committed, committed_note, paid, next_payment_label")
          .eq("wedding_id", weddingId)
          .eq("status", "published"),
        supabase
          .from("weddings")
          .select("budget_total, couple_display_name")
          .eq("id", weddingId)
          .single()
      ]);
      const text = await runAgent({
        weddingId,
        agent: "budget",
        prompt:
          `Compose the house's budget analysis for the clients (address them by their first names), ` +
          `from these published lines: ${JSON.stringify(lines)}. Total budget: ${wedding?.budget_total}. ` +
          `One warm, precise paragraph (70–110 words): where they stand (committed %, settled %), the next due date, ` +
          `and one quiet opportunity if the numbers show one. Sign "— Estelle". Return only the paragraph.`
      });
      await supabase
        .from("weddings")
        .update({ budget_analysis: text, budget_analysis_at: new Date().toISOString() })
        .eq("id", weddingId);
    } catch {
      // stands without it
    }
  }

  revalidatePath("/", "layout");
  return { ok: true as const, counts, logId };
}

/**
 * Take a sweep back (brief §2.3 — annulation possible). Only the rows
 * that very sweep published return to draft; anything published since,
 * by hand or by another sweep, stays untouched.
 */
export async function unpublishSweep(logId: string) {
  const session = await teamSession();
  const supabase = await createClient();

  const { data: entry } = await supabase
    .from("activity_log")
    .select("id, wedding_id, action, detail, reverted_at")
    .eq("id", logId)
    .single();
  if (!entry || entry.action !== "publish_sweep" || entry.reverted_at) {
    return { ok: false as const };
  }

  const d = (entry.detail ?? {}) as {
    lineIds?: string[];
    noteIds?: string[];
    milestoneIds?: string[];
    monthNoteIds?: string[];
    docIds?: string[];
  };

  if (d.lineIds?.length) {
    await supabase.from("budget_lines").update({ status: "draft" }).in("id", d.lineIds);
  }
  if (d.noteIds?.length) {
    await supabase.from("envelope_notes").update({ status: "draft" }).in("id", d.noteIds);
  }
  if (d.milestoneIds?.length) {
    await supabase.from("timeline_milestones").update({ status: "draft" }).in("id", d.milestoneIds);
  }
  if (d.monthNoteIds?.length) {
    await supabase.from("monthly_notes").update({ status: "draft" }).in("id", d.monthNoteIds);
  }
  if (d.docIds?.length) {
    await supabase.from("documents").update({ internal: true }).in("id", d.docIds);
  }

  await supabase
    .from("activity_log")
    .update({ reverted_at: new Date().toISOString() })
    .eq("id", logId);
  await logActivity(supabase, entry.wedding_id, session.profile.full_name, "unpublish_sweep", {
    of: logId
  });

  revalidatePath("/", "layout");
  return { ok: true as const };
}
