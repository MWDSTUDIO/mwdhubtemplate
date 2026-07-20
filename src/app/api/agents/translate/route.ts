import { NextResponse } from "next/server";
import { gate, agentError } from "../_shared";
import { runAgent } from "@/lib/agents/run";

/**
 * The translation agent — dynamic content (messages, monthly notes)
 * rendered in the reader's language, in the voice of the house.
 */
export async function POST(request: Request) {
  const g = await gate(false);
  if ("error" in g) return g.error;
  try {
    const { weddingId, text, target } = await request.json();
    const translated = await runAgent({
      weddingId,
      agent: "translate",
      maxTokens: Math.min(2000, text.length * 3 + 200),
      prompt: `Translate into ${target}, preserving the house's register (honorific keigo for Japanese, refined natural tone for Simplified Chinese). Return only the translation.\n\n${text}`
    });
    return NextResponse.json({ text: translated });
  } catch (e) {
    return agentError(e);
  }
}
