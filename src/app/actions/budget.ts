"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireHouseSession } from "@/lib/session";
import { notifyCouple, sendHouseEmailToCouple } from "@/lib/notify";
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

/**
 * The line-by-line, held by hand: every figure of a line can be
 * reworked in place. A touched line returns to draft — the client's
 * sheet never moves before Estelle publishes.
 */
export async function updateBudgetLine(input: {
  id: string;
  label: string;
  budgeted: number | null;
  committed: number | null;
  paid: number;
  nextPaymentLabel: string;
}) {
  await teamSession();
  const supabase = await createClient();
  const { error } = await supabase
    .from("budget_lines")
    .update({
      label: input.label.trim(),
      budgeted: input.budgeted,
      committed: input.committed,
      paid: input.paid,
      next_payment_label: input.nextPaymentLabel.trim() || null,
      status: "draft"
    })
    .eq("id", input.id);
  revalidatePath("/budget");
  return { ok: !error };
}

export async function deleteBudgetLine(id: string) {
  await teamSession();
  const supabase = await createClient();
  await supabase.from("budget_lines").delete().eq("id", id);
  revalidatePath("/budget");
  return { ok: true as const };
}

/** Open a line by hand — label and budget, the rest follows in time. */
export async function addBudgetLine(weddingId: string, label: string, budgeted: number | null) {
  await teamSession();
  const supabase = await createClient();
  const { count } = await supabase
    .from("budget_lines")
    .select("id", { count: "exact", head: true })
    .eq("wedding_id", weddingId);
  const { error } = await supabase.from("budget_lines").insert({
    wedding_id: weddingId,
    label: label.trim(),
    budgeted,
    status: "draft",
    sort: (count ?? 0) + 1
  });
  revalidatePath("/budget");
  return { ok: !error };
}

/* ══════════ Budget v2 — the quote's own lines, held by hand ══════════ */

/** After any touch, the sub-lines' sum rolls up into the line itself. */
async function rollupLine(lineId: string) {
  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("budget_line_items")
    .select("total_ht, total_ttc")
    .eq("budget_line_id", lineId);
  if (!rows?.length) return;
  const sum = rows.reduce((s, r) => s + Number(r.total_ttc ?? r.total_ht ?? 0), 0);
  if (sum > 0) {
    await supabase
      .from("budget_lines")
      .update({ committed: Math.round(sum), committed_note: null, status: "draft" })
      .eq("id", lineId);
  }
}

/**
 * A sub-line corrected by hand — no need to pass through the document
 * again. Missing totals compute themselves the way a sheet would:
 * HT from qty × unit price, TTC from HT and the VAT rate.
 */
export async function saveLineItem(input: {
  id?: string;
  weddingId: string;
  budgetLineId: string;
  eventLabel: string;
  label: string;
  qty: number | null;
  unitPrice: number | null;
  vatPct: number | null;
  totalHt: number | null;
  totalTtc: number | null;
}) {
  await teamSession();
  const supabase = await createClient();
  let ht = input.totalHt;
  if (ht == null && input.qty != null && input.unitPrice != null) {
    ht = Math.round(input.qty * input.unitPrice * 100) / 100;
  }
  let ttc = input.totalTtc;
  if (ttc == null && ht != null) {
    ttc = Math.round(ht * (1 + (input.vatPct ?? 0) / 100) * 100) / 100;
  }
  const row = {
    event_label: input.eventLabel.trim() || null,
    label: input.label.trim() || "—",
    qty: input.qty,
    unit_price: input.unitPrice,
    vat_pct: input.vatPct,
    total_ht: ht,
    total_ttc: ttc
  };
  let error;
  if (input.id) {
    ({ error } = await supabase.from("budget_line_items").update(row).eq("id", input.id));
  } else {
    const { count } = await supabase
      .from("budget_line_items")
      .select("id", { count: "exact", head: true })
      .eq("budget_line_id", input.budgetLineId);
    ({ error } = await supabase.from("budget_line_items").insert({
      wedding_id: input.weddingId,
      budget_line_id: input.budgetLineId,
      sort: (count ?? 0) + 1,
      ...row
    }));
  }
  if (!error) await rollupLine(input.budgetLineId);
  revalidatePath("/budget");
  return { ok: !error };
}

export async function deleteLineItem(id: string, budgetLineId: string) {
  await teamSession();
  const supabase = await createClient();
  await supabase.from("budget_line_items").delete().eq("id", id);
  await rollupLine(budgetLineId);
  revalidatePath("/budget");
  return { ok: true as const };
}

/* ══════════ Budget v2 — payments held by hand ══════════ */

export async function addPayment(input: {
  weddingId: string;
  budgetLineId: string | null;
  label: string;
  amount: number;
  currency: string;
  amountEur: number | null;
  dueDate: string | null;
  method: string;
  payer: string;
  refundable: boolean;
}) {
  await teamSession();
  const supabase = await createClient();
  const full: Record<string, unknown> = {
    wedding_id: input.weddingId,
    budget_line_id: input.budgetLineId,
    label: input.label.trim(),
    amount: input.amount,
    currency: input.currency || "EUR",
    amount_eur: input.amountEur,
    due_date: input.dueDate,
    method: input.method.trim() || null,
    payer: input.payer.trim() || null,
    refundable: input.refundable
  };
  let { error } = await supabase.from("payments").insert(full);
  if (error) {
    // Before migration 0011 the v2 columns are absent.
    ({ error } = await supabase.from("payments").insert({
      wedding_id: input.weddingId,
      budget_line_id: input.budgetLineId,
      label: input.label.trim(),
      amount: input.amount,
      due_date: input.dueDate
    }));
  }
  revalidatePath("/budget");
  return { ok: !error };
}

/** One press: the instalment is settled (date editable), totals follow. */
export async function markPaymentPaid(paymentId: string, paidAt: string | null) {
  await teamSession();
  const supabase = await createClient();
  const { data: payment } = await supabase
    .from("payments")
    .select("id, wedding_id, budget_line_id, amount, amount_eur")
    .eq("id", paymentId)
    .single();
  await supabase.from("payments").update({ paid_at: paidAt }).eq("id", paymentId);

  // The line's "paid" follows its settled instalments (EUR equivalent).
  if (payment?.budget_line_id) {
    const { data: siblings } = await supabase
      .from("payments")
      .select("amount, amount_eur, paid_at, currency")
      .eq("budget_line_id", payment.budget_line_id);
    const paid = (siblings ?? [])
      .filter((p) => p.paid_at)
      .reduce((s, p) => s + Number(p.amount_eur ?? (("currency" in p ? p.currency : "EUR") === "EUR" ? p.amount : 0)), 0);
    await supabase
      .from("budget_lines")
      .update({ paid })
      .eq("id", payment.budget_line_id);
  }
  revalidatePath("/budget");
  return { ok: true as const };
}

export async function updatePaymentFlags(
  paymentId: string,
  flags: { refundable?: boolean; reveal_banking?: boolean }
) {
  await teamSession();
  const supabase = await createClient();
  const { error } = await supabase.from("payments").update(flags).eq("id", paymentId);
  revalidatePath("/budget");
  return { ok: !error };
}

export async function deletePayment(paymentId: string) {
  await teamSession();
  const supabase = await createClient();
  await supabase.from("payments").delete().eq("id", paymentId);
  revalidatePath("/budget");
  return { ok: true as const };
}

/**
 * "Notify the client" on an instalment: Madame composes the word in
 * the client language; Estelle reads it before anything leaves.
 */
export async function composePaymentNotice(weddingId: string, paymentId: string) {
  await teamSession();
  const supabase = await createClient();
  const { data: p } = await supabase
    .from("payments")
    .select("*, budget_lines(label, vendor_id)")
    .eq("id", paymentId)
    .single();
  if (!p) return { ok: false as const };
  const text = await runAgent({
    weddingId,
    agent: "budget",
    maxTokens: 600,
    prompt:
      `Compose the short payment notice the house sends the couple ahead of an instalment — ` +
      `the house's voice, in the wedding's CLIENT LANGUAGE, 3–4 sentences, signed "— Estelle". ` +
      `Instalment: "${p.label}", amount ${p.amount} ${p.currency ?? "EUR"}, due ${p.due_date ?? "to be settled"}, ` +
      `method ${p.method ?? "bank transfer"}. Mention that banking details ` +
      `${p.reveal_banking ? "are shown in their Inner House budget page" : "will be shared separately"}. ` +
      `Reply with the notice text alone.`
  });
  return { ok: true as const, notice: text.trim() };
}

/** Estelle approved: in-app notice now; email when the house's box is wired. */
export async function sendPaymentNotice(weddingId: string, paymentId: string, notice: string) {
  await teamSession();
  const supabase = await createClient();
  const { data: p } = await supabase.from("payments").select("label, amount, currency, due_date").eq("id", paymentId).single();
  await notifyCouple(weddingId, {
    kind: "payment_notice",
    title: "A payment approaches",
    body: notice.length > 140 ? `${notice.slice(0, 140)}…` : notice,
    url: "/budget"
  });
  const emailed = await sendHouseEmailToCouple(weddingId, `A payment approaches — ${p?.label ?? ""}`, notice);
  await supabase.from("payments").update({ notified_at: new Date().toISOString() }).eq("id", paymentId);
  revalidatePath("/budget");
  return { ok: true as const, emailed };
}
