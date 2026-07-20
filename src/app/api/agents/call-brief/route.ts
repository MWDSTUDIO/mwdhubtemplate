import { NextResponse } from "next/server";
import { getHouseSession } from "@/lib/session";
import { agentError } from "../_shared";
import { runAgent } from "@/lib/agents/run";
import { createClient } from "@/lib/supabase/server";

/** Teamwork: the agent drafts the call brief for Estelle & Jordane. */
export async function POST(request: Request) {
  const session = await getHouseSession();
  if (!session?.isTeamwork) {
    return NextResponse.json({ error: "teamwork only" }, { status: 403 });
  }
  try {
    const { weddingId, callPrepId, points } = await request.json();
    const text = await runAgent({
      weddingId,
      agent: "madame",
      maxTokens: 700,
      prompt:
        `Draft the call preparation brief for Estelle & Jordane ahead of the next client call. ` +
        `Points on the table: ${JSON.stringify(points)}. For each point: the recommendation, how to phrase it to the ` +
        `clients, and what to hold back for now. Crisp, internal, in the house's voice. Return only the brief.`
    });
    if (callPrepId) {
      const supabase = await createClient();
      await supabase.from("call_preparations").update({ brief: text }).eq("id", callPrepId);
    }
    return NextResponse.json({ text });
  } catch (e) {
    return agentError(e);
  }
}
