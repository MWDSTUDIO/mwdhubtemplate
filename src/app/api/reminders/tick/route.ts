import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runRemindersTick } from "@/lib/reminders";
import { gate } from "@/app/api/agents/_shared";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * The daily pass over programmable reminders (notifications brief §1).
 * Two doors, both narrow: the scheduler with its shared secret, or a
 * signed-in member of the house. Nobody else.
 */
export async function POST(req: Request) {
  const secret = process.env.REMINDERS_SECRET;
  const given = req.headers.get("x-reminders-secret");
  if (!secret || given !== secret) {
    const g = await gate(true);
    if ("error" in g) return g.error;
  }
  const summary = await runRemindersTick(createAdminClient());
  return NextResponse.json(summary);
}
