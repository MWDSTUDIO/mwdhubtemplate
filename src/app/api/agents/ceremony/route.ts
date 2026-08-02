import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { gate, agentError } from "../_shared";
import { runAgent } from "@/lib/agents/run";
import { ceremonyReadiness } from "@/lib/ceremony";

/**
 * Madame at the ceremony's side — Team View only (PRD §15). She
 * proposes a flow, reads the readiness, drafts notes; she never
 * publishes, never approves, never touches the data herself: every
 * proposal returns to Estelle's hand as a draft.
 */
export async function POST(request: Request) {
  const g = await gate(true);
  if ("error" in g) return g.error;
  try {
    const { weddingId, ceremonyId, mode, instruction } = (await request.json()) as {
      weddingId: string;
      ceremonyId: string;
      mode: "counsel" | "flow" | "clientNote";
      instruction?: string;
    };
    if (!weddingId || !ceremonyId) return NextResponse.json({ error: "missing" }, { status: 400 });

    const supabase = await createClient();
    const [{ data: c }, flowRes, partsRes, musicRes, readRes, logRes, docsRes] = await Promise.all([
      supabase.from("ceremonies").select("*").eq("id", ceremonyId).maybeSingle(),
      supabase.from("ceremony_flow").select("*").eq("ceremony_id", ceremonyId).order("sort"),
      supabase.from("ceremony_participants").select("*").eq("ceremony_id", ceremonyId).order("sort"),
      supabase.from("ceremony_music").select("*").eq("ceremony_id", ceremonyId).order("sort"),
      supabase.from("ceremony_readings").select("*").eq("ceremony_id", ceremonyId).order("sort"),
      supabase.from("ceremony_logistics").select("*").eq("ceremony_id", ceremonyId).order("sort"),
      supabase.from("ceremony_documents").select("*").eq("ceremony_id", ceremonyId)
    ]);
    if (!c) return NextResponse.json({ error: "not found" }, { status: 404 });

    const sections = {
      participants: (partsRes.data ?? []) as { id: string }[],
      flow: (flowRes.data ?? []) as { id: string; archived: boolean; duration_min: number | null }[],
      music: (musicRes.data ?? []) as { id: string; archived: boolean }[],
      readings: (readRes.data ?? []) as { id: string; archived: boolean }[],
      logistics: (logRes.data ?? []) as { id: string; status: "open" | "ready" | "not_required" }[],
      documents: (docsRes.data ?? []) as { id: string }[]
    };
    // Readiness stays deterministic (§16) — Madame reads it, never
    // invents it.
    const readiness = ceremonyReadiness(c, sections);

    const context =
      `Ceremony: ${JSON.stringify({ kind: c.kind, title: c.title, date: c.ceremony_date, time: c.start_time, venue: c.venue, officiant: c.officiant, duration_min: c.duration_min, plan_b: c.plan_b })}.\n` +
      `Flow: ${JSON.stringify(flowRes.data ?? [])}.\nParticipants: ${JSON.stringify(partsRes.data ?? [])}.\n` +
      `Music: ${JSON.stringify(musicRes.data ?? [])}.\nReadings: ${JSON.stringify(readRes.data ?? [])}.\n` +
      `Logistics: ${JSON.stringify(logRes.data ?? [])}.\n` +
      `Deterministic readiness (source of truth, do not recompute): ${JSON.stringify(readiness)}.\n`;

    if (mode === "flow") {
      const raw = await runAgent({
        weddingId,
        agent: "planner",
        maxTokens: 1500,
        prompt:
          context +
          (instruction ? `Estelle adds: "${instruction}".\n` : "") +
          `Propose a ceremony flow suited to this ceremony's kind and hour — a PROPOSAL for Estelle, nothing else. ` +
          `Reply with STRICT JSON only: {"blocks": [{"block_type": "seating"|"processional"|"welcome"|"opening"|"reading"|"ritual"|"vows"|"rings"|"signing"|"pronouncement"|"kiss"|"recessional"|"other", ` +
          `"title": string, "description": string|null, "duration_min": number}], "note": string (one sentence to Estelle)}`
      });
      const parsed = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, "")) as {
        blocks: { block_type: string; title: string; description: string | null; duration_min: number }[];
        note: string;
      };
      return NextResponse.json({ blocks: parsed.blocks ?? [], note: parsed.note ?? "", readiness });
    }

    if (mode === "clientNote") {
      const text = await runAgent({
        weddingId,
        agent: "planner",
        maxTokens: 600,
        prompt:
          context +
          `Draft the house's short note to the couple about this ceremony — the house's voice, in the wedding's ` +
          `CLIENT LANGUAGE, 2–4 sentences, warm and precise, no operational detail, signed nowhere. ` +
          `It is a DRAFT for Estelle's review; nothing reaches the couple without her. Reply with the note alone.`
      });
      return NextResponse.json({ text: text.trim(), readiness });
    }

    const text = await runAgent({
      weddingId,
      agent: "planner",
      maxTokens: 900,
      prompt:
        context +
        `Counsel Estelle on this ceremony's preparation — in HER language. Name what is missing (lean on the ` +
        `deterministic readiness), any timing frictions you see in the flow, and propose the 3–5 next actions, ` +
        `each one concrete. Short lines, no flattery. Reply with the counsel alone.`
    });
    return NextResponse.json({ text: text.trim(), readiness });
  } catch (e) {
    return agentError(e);
  }
}
