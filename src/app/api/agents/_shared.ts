import { NextResponse } from "next/server";
import { getHouseSession, type HouseSession } from "@/lib/session";

/** Common gate for agent routes. Team-only routes never answer clients. */
export async function gate(
  teamOnly: boolean
): Promise<{ session: HouseSession } | { error: NextResponse }> {
  const session = await getHouseSession();
  if (!session) {
    return { error: NextResponse.json({ error: "signed out" }, { status: 401 }) };
  }
  if (teamOnly && !session.isTeam) {
    return { error: NextResponse.json({ error: "team only" }, { status: 403 }) };
  }
  return { session };
}

export function agentError(e: unknown) {
  const message = e instanceof Error ? e.message : "agent failed";
  return NextResponse.json({ error: message }, { status: 500 });
}
