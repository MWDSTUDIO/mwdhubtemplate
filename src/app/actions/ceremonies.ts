"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireHouseSession } from "@/lib/session";

async function teamSession() {
  const session = await requireHouseSession();
  if (!session.isTeam) throw new Error("team only");
  return session;
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
}) {
  await teamSession();
  const supabase = await createClient();
  const row = {
    kind: input.kind.trim(),
    title: input.title.trim() || null,
    ceremony_date: input.date || null,
    start_time: input.time.trim() || null,
    venue: input.venue.trim() || null,
    officiant: input.officiant.trim() || null,
    notes: input.notes.trim() || null
  };
  let error;
  if (input.id) {
    ({ error } = await supabase.from("ceremonies").update(row).eq("id", input.id));
  } else {
    const { count } = await supabase
      .from("ceremonies")
      .select("id", { count: "exact", head: true })
      .eq("wedding_id", input.weddingId);
    ({ error } = await supabase
      .from("ceremonies")
      .insert({ wedding_id: input.weddingId, ...row, sort: (count ?? 0) + 1 }));
  }
  if (error) return { ok: false as const, message: error.message };
  revalidatePath("/ceremony");
  revalidatePath("/desk");
  return { ok: true as const };
}

export async function deleteCeremony(id: string) {
  await teamSession();
  const supabase = await createClient();
  await supabase.from("ceremonies").delete().eq("id", id);
  revalidatePath("/ceremony");
  revalidatePath("/desk");
}
