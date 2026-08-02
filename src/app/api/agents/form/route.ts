import { NextResponse } from "next/server";
import { gate, agentError } from "../_shared";
import { runAgent } from "@/lib/agents/run";

/**
 * Madame at the form desk — Team View only (PRD §14). She suggests a
 * clearer title, a category, a short client-facing description; she
 * never publishes, never archives, never writes to the couple. Every
 * suggestion returns to the drawer for Estelle's hand to accept.
 */
export async function POST(request: Request) {
  const g = await gate(true);
  if ("error" in g) return g.error;
  try {
    const { weddingId, title, description, url, categories } = (await request.json()) as {
      weddingId: string;
      title?: string;
      description?: string;
      url?: string;
      categories?: string[];
    };
    if (!weddingId) return NextResponse.json({ error: "missing" }, { status: 400 });

    const raw = await runAgent({
      weddingId,
      agent: "madame",
      maxTokens: 300,
      prompt: [
        `A questionnaire card is being prepared in the Forms library.`,
        `Working title: ${title || "(none yet)"}.`,
        description ? `Current description: ${description}` : null,
        url ? `External link: ${url}` : null,
        categories?.length ? `Existing categories: ${categories.join(", ")}.` : null,
        `Return strict JSON only: {"title": "...", "category": "...", "description": "..."} —`,
        `title: a refined, elegant card title (keep the working title's intent);`,
        `category: the best match among the existing categories, or "" if none fits;`,
        `description: one client-facing sentence in the house's voice, warm and precise, no jargon, never the word "luxury".`
      ]
        .filter(Boolean)
        .join("\n")
    });
    const match = raw.match(/\{[\s\S]*\}/);
    const parsed = match ? (JSON.parse(match[0]) as { title?: string; category?: string; description?: string }) : {};
    return NextResponse.json({
      title: typeof parsed.title === "string" ? parsed.title.slice(0, 120) : undefined,
      category: typeof parsed.category === "string" ? parsed.category.slice(0, 60) : undefined,
      description: typeof parsed.description === "string" ? parsed.description.slice(0, 300) : undefined
    });
  } catch (e) {
    return agentError(e);
  }
}
