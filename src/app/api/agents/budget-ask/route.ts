import { NextResponse } from "next/server";
import { gate, agentError } from "../_shared";
import { runAgent } from "@/lib/agents/run";

/**
 * The budget expert, visible to the client, speaking in Estelle's name.
 * Internal notes and margins are unreadable in a client session (RLS);
 * for team sessions the system prompt still forbids revealing them.
 */
export async function POST(request: Request) {
  const g = await gate(false);
  if ("error" in g) return g.error;
  try {
    const { weddingId, prompt } = await request.json();
    const text = await runAgent({
      weddingId,
      agent: "budget",
      maxTokens: 500,
      prompt: `The clients ask about their budget: "${prompt}". Answer in Estelle's name, warm and precise, on the published numbers only. Sign "— Estelle" if the answer is more than one sentence.`
    });
    return NextResponse.json({ text });
  } catch (e) {
    return agentError(e);
  }
}
