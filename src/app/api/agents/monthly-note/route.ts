import { NextResponse } from "next/server";
import { gate, agentError } from "../_shared";
import { runAgent } from "@/lib/agents/run";

/**
 * "This month at the house" — one strike composes the whole card:
 * the month's note from Estelle's raw subjects, and one-line previews
 * for the three months that follow, drawn from the wedding's timeline.
 * Everything returns as a draft for Estelle's word.
 */
export async function POST(request: Request) {
  const g = await gate(true);
  if ("error" in g) return g.error;
  try {
    const { weddingId, subjects, month } = await request.json();
    const raw = await runAgent({
      weddingId,
      agent: "madame",
      maxTokens: 700,
      prompt:
        `Compose the "This month at the house" card for the clients, for the month ${month}.\n` +
        `Estelle's raw subjects: "${subjects}".\n` +
        `Also compose a one-line preview (8–14 words) for each of the three months that follow, ` +
        `drawn from the wedding's timeline in your context (milestones due those months); if the timeline is silent, ` +
        `preview what a house would naturally attend to then.\n` +
        `The note: one elegant paragraph, 45–70 words, first person plural, evocative but concrete, the voice of the house. ` +
        `Reply with STRICT JSON only: {"note": string, "previews": [{"month": "yyyy-mm", "text": string}, {"month": "yyyy-mm", "text": string}, {"month": "yyyy-mm", "text": string}]}`
    });
    const parsed = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, "")) as {
      note: string;
      previews: { month: string; text: string }[];
    };
    return NextResponse.json({ text: parsed.note, previews: parsed.previews ?? [] });
  } catch (e) {
    return agentError(e);
  }
}
