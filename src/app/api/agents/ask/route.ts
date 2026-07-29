import { NextResponse } from "next/server";
import { gate, agentError } from "../_shared";
import { runAgent } from "@/lib/agents/run";

/**
 * "Ask the house" — client-facing. The context is fetched with the
 * caller's own RLS session: drafts and internal material are not
 * merely filtered, they are unreadable.
 */
export async function POST(request: Request) {
  const g = await gate(true);
  if ("error" in g) return g.error;
  try {
    const { weddingId, prompt } = await request.json();
    const text = await runAgent({ weddingId, agent: "ask", prompt, maxTokens: 450 });
    return NextResponse.json({ text });
  } catch (e) {
    return agentError(e);
  }
}
