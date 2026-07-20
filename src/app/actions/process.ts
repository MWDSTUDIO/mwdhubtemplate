"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireHouseSession } from "@/lib/session";

async function teamSession() {
  const session = await requireHouseSession();
  if (!session.isTeam) throw new Error("team only");
  return session;
}

/**
 * The house's four acts stand for every wedding — until a wedding is
 * given movements of its own (requires migration 0010).
 */
export async function saveProcessStep(input: {
  id?: string;
  weddingId: string;
  title: string;
  body: string;
  sort: number;
}) {
  await teamSession();
  const supabase = await createClient();
  const row = { title: input.title.trim(), body: input.body.trim() || null, sort: input.sort };
  const { error } = input.id
    ? await supabase.from("process_steps").update(row).eq("id", input.id)
    : await supabase.from("process_steps").insert({ wedding_id: input.weddingId, ...row });
  if (error) return { ok: false as const, message: error.message };
  revalidatePath("/process");
  return { ok: true as const };
}

export async function deleteProcessStep(id: string) {
  await teamSession();
  const supabase = await createClient();
  await supabase.from("process_steps").delete().eq("id", id);
  revalidatePath("/process");
  return { ok: true as const };
}

/** Start from the house's four acts, then shape them for this wedding. */
export async function adoptDefaultProcess(
  weddingId: string,
  steps: { title: string; body: string }[]
) {
  await teamSession();
  const supabase = await createClient();
  const { error } = await supabase.from("process_steps").insert(
    steps.map((s, i) => ({ wedding_id: weddingId, title: s.title, body: s.body, sort: i + 1 }))
  );
  if (error) return { ok: false as const, message: error.message };
  revalidatePath("/process");
  return { ok: true as const };
}
