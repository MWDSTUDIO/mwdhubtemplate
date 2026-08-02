"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireHouseSession } from "@/lib/session";
import { logActivity } from "@/lib/activity";
import type { HomeConfig } from "@/lib/home";

/**
 * The only thing Home owns (PRD Home §3): its presentation. The team
 * arranges; the couple never configures. Silent before 0030.
 */
export async function saveHomeConfig(weddingId: string, config: HomeConfig) {
  const session = await requireHouseSession();
  if (!session.isTeam) throw new Error("team only");
  const supabase = await createClient();
  const clean: HomeConfig = {
    hidden: (config.hidden ?? []).slice(0, 20),
    order: (config.order ?? []).slice(0, 20)
  };
  const { error } = await supabase.from("weddings").update({ home_config: clean }).eq("id", weddingId);
  if (error) return { ok: false as const, needsMigration: true };
  await logActivity(supabase, weddingId, session.profile.full_name, "home_config_saved", {
    hidden: clean.hidden, order: clean.order
  });
  revalidatePath("/");
  return { ok: true as const };
}
