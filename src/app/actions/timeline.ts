"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireHouseSession } from "@/lib/session";

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
  await teamSession();
  const supabase = await createClient();
  await supabase.rpc("publish_timeline", { p_wedding: weddingId });
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
  await teamSession();
  const supabase = await createClient();
  await supabase
    .from("monthly_notes")
    .update({ status: "published" })
    .eq("wedding_id", weddingId)
    .eq("month", `${month}-01`);
  revalidatePath("/timeline");
}

export async function entrustAttention(input: {
  weddingId: string;
  title: string;
  due?: string;
  status: "awaiting_word" | "at_leisure";
}) {
  await teamSession();
  const supabase = await createClient();
  await supabase.from("attentions").insert({
    wedding_id: input.weddingId,
    title: input.title,
    due_date: input.due || null,
    status: input.status
  });
  revalidatePath("/timeline");
}

/** The couple marks an attention attended to (guarded by trigger + RLS). */
export async function settleAttention(id: string) {
  const supabase = await createClient();
  await supabase.from("attentions").update({ status: "attended" }).eq("id", id);
  revalidatePath("/timeline");
}
