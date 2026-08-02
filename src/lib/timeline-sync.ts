import type { createClient } from "@/lib/supabase/server";

/**
 * The one door by which other modules touch the Timeline (PRD §11):
 * an event upserts ITS milestone — anchored by (source, source_id),
 * updated in place, never duplicated. The owning module stays the
 * source of truth; the Timeline merely reflects it. Silent before
 * migration 0029 — the caller's own work always stands.
 */
export async function syncModuleMilestone(
  supabase: Awaited<ReturnType<typeof createClient>>,
  input: {
    weddingId: string;
    /** ceremony · vendor · budget · communication · design · documents */
    source: string;
    sourceId: string;
    label: string;
    /** yyyy-mm-dd — any day; the frise groups by its month. */
    date: string;
    done?: boolean;
    module?: string;
    vendorId?: string | null;
    budgetLineId?: string | null;
    ceremonyId?: string | null;
    /** Milestones born from a module event stay DRAFT — the couple
        sees nothing until Estelle publishes the timeline. */
  }
) {
  try {
    const month = `${input.date.slice(0, 7)}-01`;
    const { data: anchor } = await supabase
      .from("milestone_ops")
      .select("milestone_id")
      .eq("wedding_id", input.weddingId)
      .eq("source", input.source)
      .eq("source_id", input.sourceId)
      .maybeSingle();

    if (anchor) {
      await supabase
        .from("timeline_milestones")
        .update({ month, label: input.label, done: Boolean(input.done) })
        .eq("id", anchor.milestone_id);
      await supabase
        .from("milestone_ops")
        .update({
          op_status: input.done ? "completed" : "planned",
          due_date: input.date,
          module: input.module ?? input.source,
          vendor_id: input.vendorId ?? null,
          budget_line_id: input.budgetLineId ?? null,
          ceremony_id: input.ceremonyId ?? null,
          updated_at: new Date().toISOString()
        })
        .eq("milestone_id", anchor.milestone_id);
      return anchor.milestone_id;
    }

    const { data: m, error } = await supabase
      .from("timeline_milestones")
      .insert({
        wedding_id: input.weddingId,
        month,
        label: input.label,
        done: Boolean(input.done),
        status: "draft",
        sort: 0
      })
      .select("id")
      .single();
    if (error || !m) return null;
    await supabase.from("milestone_ops").insert({
      milestone_id: m.id,
      wedding_id: input.weddingId,
      op_status: input.done ? "completed" : "planned",
      due_date: input.date,
      module: input.module ?? input.source,
      source: input.source,
      source_id: input.sourceId,
      vendor_id: input.vendorId ?? null,
      budget_line_id: input.budgetLineId ?? null,
      ceremony_id: input.ceremonyId ?? null
    });
    return m.id;
  } catch {
    // Pre-0029 there is no anchor table — the caller's work stands.
    return null;
  }
}
