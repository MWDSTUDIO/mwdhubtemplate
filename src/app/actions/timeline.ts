"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireHouseSession } from "@/lib/session";
import { logActivity } from "@/lib/activity";

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
}) {
  await teamSession();
  const supabase = await createClient();
  const month = `${input.month}-01`;
  if (input.id) {
    await supabase
      .from("timeline_milestones")
      .update({ month, label: input.label, done: input.done, status: "draft" })
      .eq("id", input.id);
  } else {
    await supabase.from("timeline_milestones").insert({
      wedding_id: input.weddingId,
      month,
      label: input.label,
      done: input.done,
      status: "draft"
    });
  }
  revalidatePath("/", "layout");
}

export async function deleteMilestone(id: string) {
  await teamSession();
  const supabase = await createClient();
  await supabase.from("timeline_milestones").delete().eq("id", id);
  revalidatePath("/", "layout");
}

export async function publishTimeline(weddingId: string) {
  const session = await teamSession();
  const supabase = await createClient();
  const { data: published } = await supabase.rpc("publish_timeline", { p_wedding: weddingId });
  await logActivity(supabase, weddingId, session.profile.full_name, "publish_timeline", {
    counts: { milestones: published ?? 0 }
  });
  revalidatePath("/", "layout");
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
  let { error } = await supabase.from("attentions").insert(row);
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
