import { NextResponse } from "next/server";
import { gate, agentError } from "../_shared";
import { runAgent } from "@/lib/agents/run";

/** The hotel desk — hotelier correspondence in the industry's own terms. */
export async function POST(request: Request) {
  const g = await gate(true);
  if ("error" in g) return g.error;
  try {
    const { weddingId, instruction } = await request.json();
    const text = await runAgent({
      weddingId,
      agent: "hotel",
      maxTokens: 700,
      prompt: `Draft the hotel correspondence Estelle asks for: "${instruction}". Use the industry's own terms — courtesy blocks, attrition, cut-off dates, release clauses, comp ratios — ready to send from her inbox. Return only the letter.`
    });
    return NextResponse.json({ text });
  } catch (e) {
    return agentError(e);
  }
}
