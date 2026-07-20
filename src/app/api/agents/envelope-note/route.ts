import { NextResponse } from "next/server";
import { gate, agentError } from "../_shared";
import { runAgent } from "@/lib/agents/run";

/** Compose an envelope's house note on Estelle's indications. */
export async function POST(request: Request) {
  const g = await gate(true);
  if ("error" in g) return g.error;
  try {
    const { weddingId, envelopeLabel, indications } = await request.json();
    const text = await runAgent({
      weddingId,
      agent: "budget",
      maxTokens: 300,
      prompt: `Write the house's note for the scope-budget envelope "${envelopeLabel}"${indications ? `, on Estelle's indications: ${indications}` : ""}. An elegant explanation of what this envelope holds and why the house invests there — 40–70 words, first person plural, no signature (it is added by the interface). Return only the note.`
    });
    return NextResponse.json({ text });
  } catch (e) {
    return agentError(e);
  }
}
