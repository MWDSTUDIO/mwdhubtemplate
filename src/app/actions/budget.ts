"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireHouseSession } from "@/lib/session";
import { notifyCouple, sendHouseEmailToCouple } from "@/lib/notify";
import { logActivity } from "@/lib/activity";
import { revalidateRooms } from "@/lib/revalidate";
import { roundMoney, sumMoney, convertMoney, isCurrencyCode } from "@/lib/money";
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
  revalidateRooms("budget");
}

export async function publishEnvelopeNote(envelopeId: string) {
  const session = await teamSession();
  const supabase = await createClient();
  const { data: note } = await supabase
    .from("envelope_notes")
    .update({ status: "published" })
    .eq("envelope_id", envelopeId)
    .select("wedding_id")
    .maybeSingle();
  if (note) {
    await logActivity(supabase, note.wedding_id, session.profile.full_name, "publish_envelope_note", {
      envelopeId
    });
  }
  revalidateRooms("budget");
}

export async function saveInternalBudgetNote(weddingId: string, body: string) {
  await teamSession();
  const supabase = await createClient();
  await supabase.from("internal_budget_notes").insert({ wedding_id: weddingId, body });
  revalidateRooms("budget");
}

/**
 * Publish & notify the client: every draft line and envelope note goes
 * live in one word, the agent recomposes the house's analysis, and the
 * couple is notified. The client never sees work in progress.
 */
export async function publishBudget(weddingId: string) {
  const session = await teamSession();
  const supabase = await createClient();
  const { data: published } = await supabase.rpc("publish_budget", { p_wedding: weddingId });
  await logActivity(supabase, weddingId, session.profile.full_name, "publish_budget", {
    counts: { lines: published ?? 0 }
  });

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
  revalidateRooms("budget");
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

  revalidateRooms("budget");
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
  /** Three letters or nothing — the engagement's own denomination (§1.1). */
  currency?: string;
}) {
  await teamSession();
  const supabase = await createClient();
  const patch: Record<string, unknown> = {
    label: input.label.trim(),
    budgeted: input.budgeted,
    committed: input.committed != null ? roundMoney(input.committed) : null,
    paid: roundMoney(input.paid),
    next_payment_label: input.nextPaymentLabel.trim() || null,
    status: "draft"
  };
  if (input.currency && isCurrencyCode(input.currency.toUpperCase())) {
    patch.currency = input.currency.toUpperCase();
  }
  // The EUR equivalent follows the committed through its held rate —
  // an engagement conversion may refresh; a settled payment never
  // recomputes (§1.2, enforced by never touching payments here).
  const { data: existing } = await supabase
    .from("budget_lines")
    .select("*")
    .eq("id", input.id)
    .maybeSingle<Record<string, unknown>>();
  if (existing && "currency" in existing) {
    const cur = (patch.currency as string) ?? (existing.currency as string) ?? "EUR";
    if (cur === "EUR") {
      patch.committed_eur = patch.committed;
      patch.fx_rate_id = null;
    } else if (existing.fx_rate_id && patch.committed != null) {
      const { data: fx } = await supabase.from("fx_rates").select("rate").eq("id", existing.fx_rate_id).maybeSingle();
      patch.committed_eur = fx ? convertMoney(Number(patch.committed), Number(fx.rate)) : null;
    } else if (patch.currency && patch.currency !== existing.currency) {
      patch.committed_eur = null;
      patch.fx_rate_id = null;
    }
  }
  let { error } = await supabase.from("budget_lines").update(patch).eq("id", input.id);
  if (error) {
    // Pre-0017: the currency columns are absent — the figures still land.
    delete patch.currency;
    delete patch.committed_eur;
    delete patch.fx_rate_id;
    ({ error } = await supabase.from("budget_lines").update(patch).eq("id", input.id));
  }
  revalidateRooms("budget");
  return { ok: !error };
}

/**
 * Hold a rate (§1.2): pair, value, date, source — inserted in
 * fx_rates and referenced by the line, whose EUR equivalent is
 * computed once, traced, and shown beside the foreign amount.
 */
export async function setLineFxRate(
  lineId: string,
  weddingId: string,
  input: { rate: number; source: string; date?: string }
) {
  const session = await teamSession();
  const supabase = await createClient();
  if (!(input.rate > 0)) return { ok: false as const };
  const { data: line } = await supabase
    .from("budget_lines")
    .select("*")
    .eq("id", lineId)
    .maybeSingle<Record<string, unknown>>();
  if (!line || !("currency" in line)) return { ok: false as const, needsMigration: true };
  const currency = (line.currency as string) ?? "EUR";
  if (currency === "EUR") return { ok: false as const };
  const { data: fx, error: fxErr } = await supabase
    .from("fx_rates")
    .insert({
      wedding_id: weddingId,
      pair: `${currency}/EUR`,
      rate: input.rate,
      rate_date: input.date ?? new Date().toISOString().slice(0, 10),
      source: input.source.trim()
    })
    .select("id, rate")
    .single();
  if (fxErr || !fx) return { ok: false as const, needsMigration: true };
  const committed = line.committed != null ? Number(line.committed) : null;
  const { error } = await supabase
    .from("budget_lines")
    .update({
      fx_rate_id: fx.id,
      committed_eur: committed != null ? convertMoney(committed, Number(fx.rate)) : null
    })
    .eq("id", lineId);
  await logActivity(supabase, weddingId, session.profile.full_name, "fx_rate_held", {
    lineId,
    pair: `${currency}/EUR`,
    rate: input.rate,
    source: input.source.trim()
  });
  revalidateRooms("budget");
  return { ok: !error };
}

export async function deleteBudgetLine(id: string) {
  await teamSession();
  const supabase = await createClient();
  await supabase.from("budget_lines").delete().eq("id", id);
  revalidateRooms("budget");
  return { ok: true as const };
}

/**
 * Open a line by hand — the reference mode, that the automatic
 * reading merely assists (ajout-lignes brief). Returns the id so the
 * ledger can land the pen straight in the label cell.
 */
export async function addBudgetLine(
  weddingId: string,
  label: string,
  budgeted: number | null,
  opts?: { id?: string; envelopeId?: string | null; committed?: number | null; paid?: number | null }
) {
  await teamSession();
  const supabase = await createClient();
  const { count } = await supabase
    .from("budget_lines")
    .select("id", { count: "exact", head: true })
    .eq("wedding_id", weddingId);
  const { data: created, error } = await supabase
    .from("budget_lines")
    .insert({
      ...(opts?.id ? { id: opts.id } : {}),
      wedding_id: weddingId,
      label: label.trim(),
      budgeted,
      envelope_id: opts?.envelopeId ?? null,
      committed: opts?.committed ?? null,
      paid: opts?.paid ?? 0,
      status: "draft",
      sort: (count ?? 0) + 1
    })
    .select("id")
    .single();
  revalidateRooms("budget");
  return { ok: !error, id: created?.id ?? null };
}

/** A line changes envelope in place — never delete-and-recreate. */
export async function setLineEnvelope(lineId: string, envelopeId: string | null) {
  await teamSession();
  const supabase = await createClient();
  const { error } = await supabase
    .from("budget_lines")
    .update({ envelope_id: envelopeId, status: "draft" })
    .eq("id", lineId);
  revalidateRooms("budget");
  return { ok: !error };
}

/** Duplicate the active line — a vendor with several similar posts. */
export async function duplicateBudgetLine(lineId: string, newId?: string) {
  await teamSession();
  const supabase = await createClient();
  const { data: src } = await supabase.from("budget_lines").select("*").eq("id", lineId).single();
  if (!src) return { ok: false as const, id: null };
  const { data: created, error } = await supabase
    .from("budget_lines")
    .insert({
      ...(newId ? { id: newId } : {}),
      wedding_id: src.wedding_id,
      label: src.label,
      budgeted: src.budgeted,
      envelope_id: src.envelope_id,
      committed: src.committed,
      paid: 0,
      vendor_id: src.vendor_id,
      parent_line_id: src.parent_line_id,
      line_kind: src.line_kind,
      status: "draft",
      sort: (src.sort ?? 0) + 1
    })
    .select("id")
    .single();
  revalidateRooms("budget");
  return { ok: !error, id: created?.id ?? null };
}

/**
 * Undo of a deletion: the row returns with its own id, its sub-lines
 * with it. The ledger's Cmd+Z covers creations and deletions alike.
 */
export async function restoreBudgetLine(
  row: Record<string, unknown>,
  items: Record<string, unknown>[]
) {
  await teamSession();
  const supabase = await createClient();
  const { error } = await supabase.from("budget_lines").insert(row);
  if (!error && items.length) {
    await supabase.from("budget_line_items").insert(items);
  }
  revalidateRooms("budget");
  return { ok: !error };
}

/** Delete, handing back what was deleted so the gesture can be undone. */
export async function deleteBudgetLineWithUndo(id: string) {
  await teamSession();
  const supabase = await createClient();
  const [{ data: row }, { data: items }] = await Promise.all([
    supabase.from("budget_lines").select("*").eq("id", id).single(),
    supabase.from("budget_line_items").select("*").eq("budget_line_id", id)
  ]);
  if (!row) return { ok: false as const, row: null, items: [] };
  const { error } = await supabase.from("budget_lines").delete().eq("id", id);
  revalidateRooms("budget");
  return { ok: !error, row: row as Record<string, unknown>, items: (items ?? []) as Record<string, unknown>[] };
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
  const sum = sumMoney(rows.map((r) => Number(r.total_ttc ?? r.total_ht ?? 0)));
  if (sum > 0) {
    await supabase
      .from("budget_lines")
      .update({ committed: sum, committed_note: null, status: "draft" })
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
  /** Client-minted id for optimistic creation. */
  createId?: string;
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
  let id: string | null = input.id ?? null;
  if (input.id) {
    ({ error } = await supabase.from("budget_line_items").update(row).eq("id", input.id));
  } else {
    const { count } = await supabase
      .from("budget_line_items")
      .select("id", { count: "exact", head: true })
      .eq("budget_line_id", input.budgetLineId);
    const { data: created, error: insErr } = await supabase
      .from("budget_line_items")
      .insert({
        ...(input.createId ? { id: input.createId } : {}),
        wedding_id: input.weddingId,
        budget_line_id: input.budgetLineId,
        sort: (count ?? 0) + 1,
        ...row
      })
      .select("id")
      .single();
    error = insErr;
    id = created?.id ?? null;
  }
  if (!error) await rollupLine(input.budgetLineId);
  revalidateRooms("budget");
  return { ok: !error, id };
}

export async function deleteLineItem(id: string, budgetLineId: string) {
  await teamSession();
  const supabase = await createClient();
  await supabase.from("budget_line_items").delete().eq("id", id);
  await rollupLine(budgetLineId);
  revalidateRooms("budget");
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
  revalidateRooms("budget");
  return { ok: !error };
}

/** One press: the instalment is settled (date editable), totals follow. */
/**
 * An instalment corrected by hand — amount, date, label, method (G1).
 * No more delete-and-recreate: the schedule stays under Estelle's
 * hand at every moment.
 */
export async function updatePayment(
  paymentId: string,
  input: {
    label: string;
    amount: number;
    currency: string;
    amountEur: number | null;
    dueDate: string | null;
    method: string;
    payer: string;
  }
) {
  await teamSession();
  const supabase = await createClient();
  const base = {
    label: input.label.trim(),
    amount: input.amount,
    due_date: input.dueDate,
    method: input.method.trim() || null,
    payer: input.payer.trim() || null
  };
  let { error } = await supabase
    .from("payments")
    .update({
      ...base,
      currency: input.currency,
      amount_eur: input.currency === "EUR" ? input.amount : input.amountEur
    })
    .eq("id", paymentId);
  // Before migration 0011 the currency columns are absent.
  if (error) ({ error } = await supabase.from("payments").update(base).eq("id", paymentId));
  revalidateRooms("budget");
  return { ok: !error };
}

export async function markPaymentPaid(paymentId: string, paidAt: string | null) {
  const session = await teamSession();
  const supabase = await createClient();
  const { data: payment } = await supabase
    .from("payments")
    .select("*")
    .eq("id", paymentId)
    .single();
  await supabase.from("payments").update({ paid_at: paidAt }).eq("id", paymentId);

  // §1.3 — the realized exchange difference exists: when a foreign
  // instalment settles at an equivalent different from the line's
  // held rate, the difference is written to the journal as itself —
  // a line, never a rounding that disappears. Settled amounts are
  // never recomputed (§1.2); this only records what was realized.
  if (paidAt && payment && payment.currency && payment.currency !== "EUR" && payment.amount_eur != null) {
    try {
      const { data: line } = await supabase
        .from("budget_lines")
        .select("committed, committed_eur, currency, label")
        .eq("id", payment.budget_line_id)
        .maybeSingle<{ committed: number | null; committed_eur: number | null; currency?: string; label: string }>();
      if (line?.committed && line.committed_eur != null && line.currency === payment.currency) {
        const engagementRate = Number(line.committed_eur) / Number(line.committed);
        const gap = roundMoney(Number(payment.amount_eur) - Number(payment.amount) * engagementRate);
        if (Math.abs(gap) >= 1) {
          await logActivity(supabase, payment.wedding_id, session.profile.full_name, "fx_realized_gap", {
            paymentId,
            label: payment.label,
            currency: payment.currency,
            gapEur: gap
          });
        }
      }
    } catch {
      // The trace is a bonus; the settlement stands without it.
    }
  }

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
  revalidateRooms("budget");
  return { ok: true as const };
}

export async function updatePaymentFlags(
  paymentId: string,
  flags: { refundable?: boolean; reveal_banking?: boolean }
) {
  await teamSession();
  const supabase = await createClient();
  const { error } = await supabase.from("payments").update(flags).eq("id", paymentId);
  revalidateRooms("budget");
  // The Postgres lock (migration 0016): nothing reveals unverified
  // coordinates to the couple — surface it as a sentence, not a crash.
  if (error && `${error.message}`.includes("banking_not_verified")) {
    return { ok: false, reason: "banking_not_verified" as const };
  }
  return { ok: !error };
}

export async function deletePayment(paymentId: string) {
  await teamSession();
  const supabase = await createClient();
  await supabase.from("payments").delete().eq("id", paymentId);
  revalidateRooms("budget");
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
  revalidateRooms("budget");
  return { ok: true as const, emailed };
}
