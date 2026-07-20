"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireHouseSession } from "@/lib/session";
import { notifyCouple } from "@/lib/notify";
import { runAgent } from "@/lib/agents/run";

async function teamSession() {
  const session = await requireHouseSession();
  if (!session.isTeam) throw new Error("team only");
  return session;
}

export async function saveEnvelopeNote(envelopeId: string, weddingId: string, body: string) {
  await teamSession();
  const supabase = await createClient();
  await supabase.from("envelope_notes").upsert({
    envelope_id: envelopeId,
    wedding_id: weddingId,
    body,
    status: "draft"
  });
  revalidatePath("/budget");
}

export async function publishEnvelopeNote(envelopeId: string) {
  await teamSession();
  const supabase = await createClient();
  await supabase
    .from("envelope_notes")
    .update({ status: "published" })
    .eq("envelope_id", envelopeId);
  revalidatePath("/budget");
}

export async function saveInternalBudgetNote(weddingId: string, body: string) {
  await teamSession();
  const supabase = await createClient();
  await supabase.from("internal_budget_notes").insert({ wedding_id: weddingId, body });
  revalidatePath("/budget");
}

/**
 * Publish & notify the client: every draft line and envelope note goes
 * live in one word, the agent recomposes the house's analysis, and the
 * couple is notified. The client never sees work in progress.
 */
export async function publishBudget(weddingId: string) {
  await teamSession();
  const supabase = await createClient();
  await supabase.rpc("publish_budget", { p_wedding: weddingId });

  // Recompose the house's analysis over the now-published numbers.
  try {
    const { data: lines } = await supabase
      .from("budget_lines")
      .select("label, budgeted, committed, committed_note, paid, next_payment_label")
      .eq("wedding_id", weddingId)
      .eq("status", "published");
    const { data: wedding } = await supabase
      .from("weddings")
      .select("budget_total, couple_display_name")
      .eq("id", weddingId)
      .single();
    const text = await runAgent({
      weddingId,
      agent: "budget",
      prompt:
        `Compose the house's budget analysis for the clients (address them by their first names), ` +
        `from these published lines: ${JSON.stringify(lines)}. Total budget: ${wedding?.budget_total}. ` +
        `One warm, precise paragraph (70–110 words): where they stand (committed %, settled %), the next due date, ` +
        `and one quiet opportunity if the numbers show one. Sign "— Estelle". Return only the paragraph.`
    });
    await supabase
      .from("weddings")
      .update({ budget_analysis: text, budget_analysis_at: new Date().toISOString() })
      .eq("id", weddingId);
  } catch {
    // The analysis is a grace note — publication stands without it.
  }

  await notifyCouple(weddingId, {
    kind: "budget_published",
    title: "Your budget was updated",
    body: "The house has published your budget — the analysis awaits you.",
    url: "/budget"
  });
  revalidatePath("/budget");
}

/**
 * "Add a line — via Madame": Estelle describes the line in her words;
 * the agent creates it, assigns its envelope, and writes the client
 * note in the house's voice. Draft until her word.
 */
export async function addLineViaMadame(weddingId: string, instruction: string) {
  await teamSession();
  const supabase = await createClient();
  const { data: envelopes } = await supabase
    .from("budget_envelopes")
    .select("id, label")
    .eq("wedding_id", weddingId)
    .order("sort");

  const raw = await runAgent({
    weddingId,
    agent: "budget",
    prompt:
      `Estelle instructs: "${instruction}". Create the budget line. Envelopes: ${JSON.stringify(envelopes)}. ` +
      `Reply with STRICT JSON only: {"label": string, "envelope_id": string|null (an existing envelope id, or null), ` +
      `"new_envelope_label": string|null (when no envelope fits), "budgeted": number|null, ` +
      `"client_note": string (an elegant client-facing explanation in the house's voice, <=60 words, no signature)}`
  });

  let parsed: {
    label: string;
    envelope_id: string | null;
    new_envelope_label: string | null;
    budgeted: number | null;
    client_note: string;
  };
  try {
    parsed = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    return { ok: false as const, note: raw };
  }

  let envelopeId = parsed.envelope_id;
  if (!envelopeId && parsed.new_envelope_label) {
    const { data: env } = await supabase
      .from("budget_envelopes")
      .insert({
        wedding_id: weddingId,
        label: parsed.new_envelope_label,
        sort: (envelopes?.length ?? 0) + 1
      })
      .select("id")
      .single();
    envelopeId = env?.id ?? null;
    if (envelopeId && parsed.client_note) {
      await supabase.from("envelope_notes").insert({
        envelope_id: envelopeId,
        wedding_id: weddingId,
        body: parsed.client_note,
        status: "draft"
      });
    }
  }

  await supabase.from("budget_lines").insert({
    wedding_id: weddingId,
    envelope_id: envelopeId,
    label: parsed.label,
    budgeted: parsed.budgeted,
    status: "draft",
    sort: 99
  });

  revalidatePath("/budget");
  return { ok: true as const, note: parsed.client_note };
}
