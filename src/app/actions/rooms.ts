"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireHouseSession } from "@/lib/session";
import { grantRoom } from "@/lib/rooms";

/**
 * Verify a room code (Teamwork shared code / Vault personal code).
 * The hash comparison happens in Postgres via a security-definer RPC;
 * eligibility (teamwork member / principal) is checked there too.
 * On success a signed, short-lived cookie remembers the verification.
 */
export async function verifyRoomCode(scope: "teamwork" | "vault", code: string) {
  const session = await requireHouseSession();
  if (scope === "teamwork" && !session.isTeamwork) return { ok: false };
  if (scope === "vault" && !session.isPrincipal) return { ok: false };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("verify_code", {
    p_scope: scope,
    p_code: code
  });
  if (error || data !== true) return { ok: false };

  await grantRoom(scope, session.userId);
  revalidatePath(scope === "teamwork" ? "/teamwork" : "/vault");
  return { ok: true };
}
