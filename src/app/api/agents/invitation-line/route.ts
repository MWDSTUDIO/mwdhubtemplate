import { NextResponse } from "next/server";
import { gate, agentError } from "../_shared";
import { runAgent } from "@/lib/agents/run";

/**
 * Suggest the invitation line per stationery conventions, as it will
 * appear on the envelope. Available to the couple building their list.
 */
export async function POST(request: Request) {
  const g = await gate(true);
  if ("error" in g) return g.error;
  try {
    const { weddingId, title, firstNames, surname, locale } = await request.json();
    const text = await runAgent({
      weddingId,
      agent: "stationer",
      maxTokens: 120,
      prompt: `Compose the envelope invitation line for: title "${title}", first names "${firstNames}", surname "${surname}", language of correspondence "${locale}". Follow master-stationer conventions for that language and title. Return ONLY the line, nothing else.`
    });
    return NextResponse.json({ text });
  } catch (e) {
    return agentError(e);
  }
}
