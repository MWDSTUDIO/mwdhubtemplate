import { NextResponse } from "next/server";
import { gate, agentError } from "../_shared";
import { runAgent } from "@/lib/agents/run";

/** Compose the "This month at the house" note from Estelle's raw subjects. */
export async function POST(request: Request) {
  const g = await gate(true);
  if ("error" in g) return g.error;
  try {
    const { weddingId, subjects } = await request.json();
    const text = await runAgent({
      weddingId,
      agent: "madame",
      maxTokens: 300,
      prompt: `Compose the "This month at the house" note for the clients from these subjects: ${subjects}. One elegant paragraph, 45–70 words, first person plural, evocative but concrete, in the voice of the house. Return only the paragraph text, no quotes.`
    });
    return NextResponse.json({ text });
  } catch (e) {
    return agentError(e);
  }
}
