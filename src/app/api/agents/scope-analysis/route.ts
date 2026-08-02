import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { gate, agentError } from "../_shared";
import { runAgent } from "@/lib/agents/run";

const READABLE = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);

/**
 * The scope reads a study: Estelle hands a budget analysis (a PDF she
 * drew up elsewhere, a contract, a proposal) and Madame sets it against
 * the envelopes — figures and words. Numbers compare allocated to what
 * the document commits; the words split in two: a note for the couple
 * in the house's voice and client language, and warnings with the
 * house's tricks for Estelle alone.
 */
export async function POST(request: Request) {
  const g = await gate(true);
  if ("error" in g) return g.error;
  try {
    const form = await request.formData();
    const weddingId = String(form.get("weddingId"));
    const file = form.get("file") as File | null;
    if (!file || !weddingId) return NextResponse.json({ error: "missing file" }, { status: 400 });
    if (!process.env.ANTHROPIC_API_KEY) {
      // Said plainly, never disguised as a difficult document.
      return NextResponse.json({
        rows: [],
        clientNote: "",
        warnings: [],
        tips: [],
        text:
          "The house's reading key is not set: add ANTHROPIC_API_KEY to the environment " +
          "(Netlify and .env.local) — no reading can run without it."
      });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const mediaType = READABLE.has(file.type) ? file.type : null;

    const supabase = await createClient();
    const [{ data: wedding }, { data: envelopes }] = await Promise.all([
      supabase.from("weddings").select("budget_total, couple_display_name").eq("id", weddingId).single(),
      supabase.from("budget_envelopes").select("label, percent, priority").eq("wedding_id", weddingId).order("sort")
    ]);
    const total = wedding?.budget_total ?? 0;

    const raw = await runAgent({
      weddingId,
      agent: "budget",
      maxTokens: 2500,
      documents: mediaType ? [{ mediaType, base64: buffer.toString("base64") }] : undefined,
      prompt:
        `${mediaType ? "Read the attached document (a budget analysis, contract or proposal Estelle hands to the scope)." : `A file named "${file.name}" was dropped (format unreadable inline).`}\n` +
        `The scope: total budget ${total || "not set"} EUR, envelopes ${JSON.stringify(envelopes)} (percent of total).\n` +
        `Set the document against the scope. Reply with STRICT JSON only: {` +
        `"rows": [{"envelope": string (an existing envelope label, or the document's own category), ` +
        `"allocated": number|null (envelope percent × total, EUR), "in_document": number|null (what the document commits or estimates, EUR), ` +
        `"variance": number|null (in_document − allocated), "flag": "over"|"tight"|"even"|"under"|null}], ` +
        `"client_note": string (3–4 sentences for the couple: what the figures say, in the house's voice and the CLIENT LANGUAGE, reassuring but truthful), ` +
        `"warnings": [string] (2–4 sharp internal warnings for Estelle, in HER language: overruns, missing posts, VAT traps, currency), ` +
        `"tips": [string] (2–4 of the house's tricks to keep the wedding beautiful within reach: where to reweigh, what to negotiate, what to let breathe), ` +
        `"summary": string (one sentence to Estelle)}`
    });

    const parsed = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ""));

    // The warnings and tricks are Estelle's alone — kept with her
    // internal budget notes, never visible to clients.
    const internal = [
      ...(parsed.warnings ?? []).map((w: string) => `⚠ ${w}`),
      ...(parsed.tips ?? []).map((t: string) => `— ${t}`)
    ].join("\n");
    if (internal) {
      await supabase.from("internal_budget_notes").insert({
        wedding_id: weddingId,
        body: `[Scope — ${file.name}]\n${internal}`
      });
    }

    return NextResponse.json({
      rows: parsed.rows ?? [],
      clientNote: parsed.client_note ?? "",
      warnings: parsed.warnings ?? [],
      tips: parsed.tips ?? [],
      text: parsed.summary ?? "Read."
    });
  } catch (e) {
    return agentError(e);
  }
}
