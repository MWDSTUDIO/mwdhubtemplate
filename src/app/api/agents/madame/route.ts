import { NextResponse } from "next/server";
import { gate, agentError } from "../_shared";
import { runAgent } from "@/lib/agents/run";

/** Madame — the team's resident agent. Never answers a client session. */
export async function POST(request: Request) {
  const g = await gate(true);
  if ("error" in g) return g.error;
  try {
    const { weddingId, prompt, room } = await request.json();
    // The page Estelle is standing on rides along, so "add it here"
    // or "publish this month's note" needs no preamble (brief §2.4).
    const framed =
      typeof room === "string" && room.length > 0 && room.length < 40
        ? `[Estelle is currently on the "${room}" page of the hub.] ${prompt}`
        : prompt;
    const text = await runAgent({ weddingId, agent: "madame", prompt: framed, maxTokens: 700 });
    return NextResponse.json({ text });
  } catch (e) {
    return agentError(e);
  }
}
