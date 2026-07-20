import { NextResponse } from "next/server";
import { gate, agentError } from "../_shared";
import { runAgent } from "@/lib/agents/run";

/**
 * Compose a board's concept from Estelle's indications: a three-word
 * evocative title and the concept paragraph — artistic but limpid,
 * a sensation more than a description.
 */
export async function POST(request: Request) {
  const g = await gate(true);
  if ("error" in g) return g.error;
  try {
    const { weddingId, boardTitle, indications } = await request.json();
    const raw = await runAgent({
      weddingId,
      agent: "madame",
      maxTokens: 500,
      prompt:
        `Compose the concept for the design board "${boardTitle}" from Estelle's indications: "${indications}". ` +
        `Reply with STRICT JSON only: {"title": string (EXACTLY three evocative words, capitalised, separated by ", " — ` +
        `e.g. "Gathered, Luminous, Unhurried"), "text": string (one concept paragraph, 55–85 words, the voice of the ` +
        `house — artistic but limpid, conveying a sensation, never a list; no signature)}`
    });
    const parsed = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ""));
    return NextResponse.json({ title: parsed.title, text: parsed.text });
  } catch (e) {
    return agentError(e);
  }
}
