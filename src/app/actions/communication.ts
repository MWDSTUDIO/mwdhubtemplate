"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireHouseSession } from "@/lib/session";
import { notifyCouple } from "@/lib/notify";

/** The rooming list opens on Estelle's action alone (RLS: principal). */
export async function openRoomingList(weddingId: string) {
  const session = await requireHouseSession();
  if (!session.isPrincipal) throw new Error("Estelle only");
  const supabase = await createClient();
  await supabase.from("rooming_list_state").upsert({
    wedding_id: weddingId,
    opened: true,
    opened_at: new Date().toISOString(),
    opened_by: session.userId
  });
  await notifyCouple(weddingId, {
    kind: "rooming_opened",
    title: "The rooming list is open",
    body: "The house has opened your rooming list.",
    url: "/communication"
  });
  revalidatePath("/communication");
}
