import { NextResponse } from "next/server";
import { gate, agentError } from "../_shared";
import { runAgent } from "@/lib/agents/run";
import { createClient } from "@/lib/supabase/server";

const READABLE = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);

/**
 * Drop the signed proposal on The Desk: the agent reads it and
 * pre-fills the client sheet — couple, destination, dates, events,
 * budget, and a first draft of the house brief.
 */
export async function POST(request: Request) {
  const g = await gate(true);
  if ("error" in g) return g.error;
  try {
    const form = await request.formData();
    const file = form.get("file") as File | null;
    const weddingId = form.get("weddingId") ? String(form.get("weddingId")) : null;
    if (!file || !READABLE.has(file.type)) {
      return NextResponse.json({ error: "unreadable file" }, { status: 400 });
    }
    const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");

    // A neutral context: this may be a brand-new couple with no wedding row yet.
    let contextWeddingId = weddingId;
    if (!contextWeddingId) {
      const supabase = await createClient();
      const { data } = await supabase.from("weddings").select("id").limit(1).maybeSingle();
      contextWeddingId = data?.id ?? "";
    }

    const raw = await runAgent({
      weddingId: contextWeddingId ?? "",
      agent: "madame",
      maxTokens: 1200,
      documents: [{ mediaType: file.type, base64 }],
      prompt:
        `Read this signed proposal and pre-fill the client sheet. Reply with STRICT JSON only: ` +
        `{"couple_display_name": string, "partner_a": string, "partner_b": string, "destination": string, ` +
        `"venue": string|null, "date_start": "yyyy-mm-dd"|null, "date_end": "yyyy-mm-dd"|null, ` +
        `"events": string[], "budget_total": number|null, ` +
        `"brief_draft": string (a first project brief in the house's voice: the couple, the story, constraints, partis pris — 80–140 words)}`
    });

    const parsed = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ""));
    return NextResponse.json({ sheet: parsed });
  } catch (e) {
    return agentError(e);
  }
}
