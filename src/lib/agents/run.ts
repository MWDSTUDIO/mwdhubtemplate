import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";

/**
 * All agents are "Madame" with a specialisation. They run server-side
 * only; the key never reaches a client. Context is the wedding brief
 * from The Desk plus the wedding's data — fetched with the CALLER'S
 * RLS-bound session, so a client-facing agent can physically only see
 * published, client-visible material.
 */

export const HOUSE_SYSTEM = `You are "Madame", the resident agent of Madame Wedding Design, a Parisian house of wedding planning and production. You are the finest event expert alive: producer, hospitality & event budget chief expert, master ceremonial stationer, hotel-desk negotiator. Voice of the house: warm, precise, understated; never the word "luxury". Client-facing texts speak in Estelle's name and may sign "— Estelle". Never reveal internal notes, margins, or methods — only their conclusions, phrased for the client. Nothing reaches a client before Estelle's word.
THE LANGUAGE RULE (absolute): every client-facing text you compose — notes, letters, emails, sheet notes — must be written in the wedding's CLIENT LANGUAGE stated in the context, whatever language Estelle typed her instructions in. Estelle's raw words are guidance, never the deliverable. Internal notes to Estelle follow the language she wrote in.`;

const SPECIALISATIONS: Record<string, string> = {
  madame:
    "You are speaking with the team inside the hub. Be brief and operative. When asked to change data, describe exactly what you would enter, always as a draft awaiting Estelle's word.",
  ask:
    "You are speaking with the clients. You only know their published material — never speculate about drafts, internal notes or the team's work in progress. Stay short, warm and concrete.",
  budget:
    "Specialisation: event budget chief expert — contracts, invoices, proposals, payment schedules, trajectory, opportunities, and gentle pedagogy. Client-facing words speak in Estelle's name.",
  stationer:
    "Specialisation: master ceremonial stationer — French, British and American usage; titles and honourifics, order of names, widowhood, divorce, unmarried couples, children on envelopes.",
  hotel:
    "Specialisation: hotel desk — courtesy blocks, attrition, cut-off dates, release clauses, comp ratios; write in the industry's own terms, ready to send from Estelle's inbox.",
  timeline:
    "Specialisation: timeline composer — production timelines in the manner of the great houses; every board, proof, tasting, contract and payment placed at its right month.",
  translate:
    "Specialisation: translation in the voice of the house. Preserve register and warmth; use honorific keigo in Japanese and a refined, natural tone in Simplified Chinese.",
  forms:
    "Specialisation: replies to client form submissions, pre-written for Estelle to approve — in the house's voice, addressed to the clients by first name."
};

export interface AgentInput {
  weddingId: string;
  agent: keyof typeof SPECIALISATIONS | string;
  prompt: string;
  maxTokens?: number;
  extraSystem?: string;
  documents?: { mediaType: string; base64: string }[];
}

/** Build the permanent context for a wedding, within the caller's rights. */
export async function agentContext(weddingId: string): Promise<string> {
  const supabase = await createClient();
  const [wedding, brief, events, ceremonies, milestones, attentions, lines, vendors, boards] =
    await Promise.all([
      supabase.from("weddings").select("*").eq("id", weddingId).maybeSingle(),
      supabase.from("wedding_briefs").select("body").eq("wedding_id", weddingId).maybeSingle(),
      supabase.from("wedding_events").select("name, event_date").eq("wedding_id", weddingId).order("sort"),
      supabase
        .from("ceremonies")
        .select("kind, title, ceremony_date, start_time, venue, officiant")
        .eq("wedding_id", weddingId)
        .order("sort"),
      supabase.from("timeline_milestones").select("month, label, done, status").eq("wedding_id", weddingId).order("month"),
      supabase.from("attentions").select("title, due_date, status").eq("wedding_id", weddingId),
      supabase
        .from("budget_lines")
        .select("label, budgeted, committed, committed_note, paid, next_payment_label, status")
        .eq("wedding_id", weddingId),
      supabase.from("vendors").select("name, category, stage").eq("wedding_id", weddingId),
      supabase.from("boards").select("type, title, status").eq("wedding_id", weddingId)
    ]);

  const w = wedding.data;
  const parts = [
    w &&
      `Wedding: ${w.couple_display_name} — ${w.destination}${w.venue ? `, ${w.venue}` : ""}, ${w.date_start ?? "dates tbc"} → ${w.date_end ?? ""}. CLIENT LANGUAGE: ${w.default_locale} (all client-facing text in this language). Languages: ${(w.languages ?? []).join("/")}. Total budget: ${w.budget_total ?? "n/a"}.`,
    brief.data?.body && `House brief (INTERNAL — never quote verbatim to clients):\n${brief.data.body}`,
    events.data?.length && `Events: ${events.data.map((e) => `${e.name} (${e.event_date ?? "tbc"})`).join(", ")}.`,
    ceremonies.data?.length &&
      `Ceremonies (the heart of the weekend): ${ceremonies.data
        .map(
          (c) =>
            `${c.title ?? c.kind} [${c.kind}] ${c.ceremony_date ?? "date tbc"}${c.start_time ? ` ${c.start_time}` : ""}${c.venue ? ` at ${c.venue}` : ""}${c.officiant ? `, officiant: ${c.officiant}` : ""}`
        )
        .join(" · ")}.`,
    milestones.data?.length &&
      `Timeline: ${milestones.data.map((m) => `${m.month.slice(0, 7)} ${m.label}${m.done ? " ✓" : ""}${m.status === "draft" ? " [draft]" : ""}`).join(" · ")}.`,
    attentions.data?.length &&
      `Client attentions: ${attentions.data.map((a) => `${a.title} (${a.status}${a.due_date ? `, due ${a.due_date}` : ""})`).join(" · ")}.`,
    lines.data?.length &&
      `Budget lines: ${lines.data
        .map(
          (l) =>
            `${l.label}: budgeted ${l.budgeted ?? "—"}, committed ${l.committed ?? l.committed_note ?? "—"}, paid ${l.paid}${l.next_payment_label ? `, next: ${l.next_payment_label}` : ""}${l.status === "draft" ? " [draft]" : ""}`
        )
        .join(" · ")}.`,
    vendors.data?.length && `Vendors: ${vendors.data.map((v) => `${v.name} (${v.category}, ${v.stage})`).join(" · ")}.`,
    boards.data?.length && `Design boards: ${boards.data.map((b) => `${b.title} [${b.status}]`).join(" · ")}.`,
    `Today: ${new Date().toISOString().slice(0, 10)}.`
  ].filter(Boolean);

  return parts.join("\n\n");
}

export async function runAgent(input: AgentInput): Promise<string> {
  const { text } = await runAgentFull(input);
  return text;
}

/** Same run, with the stop reason — callers parsing JSON need to know a truncation from a bad answer. */
export async function runAgentFull(
  input: AgentInput
): Promise<{ text: string; stopReason: string | null }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");
  const anthropic = new Anthropic({ apiKey });

  const context = await agentContext(input.weddingId);
  const system = [
    HOUSE_SYSTEM,
    SPECIALISATIONS[input.agent] ?? "",
    input.extraSystem ?? "",
    `Context:\n${context}`
  ]
    .filter(Boolean)
    .join("\n\n");

  const content: Anthropic.ContentBlockParam[] = [
    ...(input.documents ?? []).map((doc): Anthropic.ContentBlockParam => {
      if (doc.mediaType === "application/pdf") {
        return {
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: doc.base64 }
        };
      }
      return {
        type: "image",
        source: {
          type: "base64",
          media_type: doc.mediaType as "image/png" | "image/jpeg" | "image/webp" | "image/gif",
          data: doc.base64
        }
      };
    }),
    { type: "text", text: input.prompt }
  ];

  const response = await anthropic.messages.create({
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5",
    max_tokens: input.maxTokens ?? 900,
    system,
    messages: [{ role: "user", content }]
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  return { text, stopReason: response.stop_reason ?? null };
}
