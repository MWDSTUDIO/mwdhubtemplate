import { NextResponse } from "next/server";
import { gate, agentError } from "../_shared";
import { runAgent } from "@/lib/agents/run";

/** Madame — the team's resident agent. Never answers a client session. */
export async function POST(request: Request) {
  const g = await gate(true);
  if ("error" in g) return g.error;
  try {
    const { weddingId, prompt } = await request.json();
    const text = await runAgent({ weddingId, agent: "madame", prompt, maxTokens: 700 });
    return NextResponse.json({ text });
  } catch (e) {
    return agentError(e);
  }
}
