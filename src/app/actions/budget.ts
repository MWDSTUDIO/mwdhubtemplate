"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireHouseSession } from "@/lib/session";
import { notifyCouple, sendHouseEmailToCouple } from "@/lib/notify";
import { logActivity } from "@/lib/activity";
import { revalidateRooms } from "@/lib/revalidate";
import { roundMoney, sumMoney, convertMoney, isCurrencyCode, isSettledPayment, paymentSign } from "@/lib/money";
import { applyReminderDefaults } from "@/lib/reminders";
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
  // What is about to reach the couple is kept as a version (0027) —
  // the drafts' state just before they go live.
  try {
    const { data: draftLines } = await supabase
      .from("budget_lines")
      .select("id, label, envelope_id, vendor_id, budgeted, committed, paid, status")
      .eq("wedding_id", weddingId)
      .eq("status", "draft");
    if (draftLines?.length) {
      await supabase.from("publication_versions").insert({
        wedding_id: weddingId,
        kind: "budget",
        summary: { lines: draftLines.length },
        snapshot: { lines: draftLines },
        created_by: session.profile.full_name
      });
    }
  } catch {
    // Pre-0027 there is no register of versions — publication stands.
  }

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
      .update({
        budget_analysis: text,
        budget_analysis_at: new Date().toISOString(),
        // The agent proposes; Estelle publishes (0022). Pre-0022 the
        // unknown column would fail the whole update — try, then fall.
        budget_analysis_status: "draft"
      })
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

/**
 * A line names its vendor in place (Estelle's ask, 2026-08-02): the
 * fiche link appears, the vendor's engagements read by category — and
 * a line without an envelope inherits the vendor's budget home (0019).
 * The published figures do not move, so the status stays as it is.
 */
export async function setLineVendor(lineId: string, vendorId: string | null) {
  await teamSession();
  const supabase = await createClient();
  const patch: Record<string, unknown> = { vendor_id: vendorId };
  if (vendorId) {
    const { data: line } = await supabase
      .from("budget_lines")
      .select("envelope_id")
      .eq("id", lineId)
      .maybeSingle();
    if (line && !line.envelope_id) {
      try {
        const { data: v } = await supabase
          .from("vendors")
          .select("envelope_id")
          .eq("id", vendorId)
          .maybeSingle();
        if (v?.envelope_id) patch.envelope_id = v.envelope_id;
      } catch {
        /* pre-0019: no home to inherit */
      }
    }
  }
  const { error } = await supabase.from("budget_lines").update(patch).eq("id", lineId);
  revalidateRooms("budget");
  return { ok: !error };
}

/**
 * One vendor, several categories (the La Baronne case): part of a line
 * moves out into a sibling line in another envelope — same vendor, the
 * chosen posts following, the committed split exactly, nothing lost.
 * Both sides return to draft: the couple never sees a half-made split.
 */
export async function splitBudgetLine(input: {
  lineId: string;
  weddingId: string;
  envelopeId: string | null;
  itemIds: string[];
  amount?: number | null;
  label?: string;
}) {
  const session = await teamSession();
  const supabase = await createClient();
  const { data: src } = await supabase
    .from("budget_lines")
    .select("*")
    .eq("id", input.lineId)
    .eq("wedding_id", input.weddingId)
    .single();
  if (!src) return { ok: false as const };

  let movedSum = 0;
  if (input.itemIds.length) {
    const { data: moved } = await supabase
      .from("budget_line_items")
      .select("total_ttc, total_ht")
      .in("id", input.itemIds)
      .eq("budget_line_id", input.lineId);
    movedSum = sumMoney((moved ?? []).map((it) => Number(it.total_ttc ?? it.total_ht ?? 0)));
  }
  const part = roundMoney(Number(input.amount ?? movedSum));
  if (!(part > 0)) return { ok: false as const };

  const { count } = await supabase
    .from("budget_lines")
    .select("id", { count: "exact", head: true })
    .eq("wedding_id", input.weddingId);
  const { data: created, error } = await supabase
    .from("budget_lines")
    .insert({
      wedding_id: input.weddingId,
      vendor_id: src.vendor_id,
      envelope_id: input.envelopeId,
      label: input.label?.trim() || src.label,
      budgeted: null,
      committed: part,
      status: "draft",
      sort: (count ?? 0) + 1
    })
    .select("id")
    .single();
  if (error || !created) return { ok: false as const };

  if (input.itemIds.length) {
    await supabase
      .from("budget_line_items")
      .update({ budget_line_id: created.id })
      .in("id", input.itemIds)
      .eq("budget_line_id", input.lineId);
  }
  await supabase
    .from("budget_lines")
    .update({
      committed: Math.max(0, roundMoney(Number(src.committed ?? 0) - part)),
      status: "draft"
    })
    .eq("id", input.lineId);

  await logActivity(supabase, input.weddingId, session.profile.full_name, "line_split", {
    from: input.lineId,
    to: created.id,
    amount: part,
    items: input.itemIds.length
  });
  revalidateRooms("budget");
  return { ok: true as const, id: created.id };
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
  /** The post's own category (0020) — undefined leaves it untouched,
      null makes it follow its line again. */
  envelopeId?: string | null;
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
  const row: Record<string, unknown> = {
    event_label: input.eventLabel.trim() || null,
    label: input.label.trim() || "—",
    qty: input.qty,
    unit_price: input.unitPrice,
    vat_pct: input.vatPct,
    total_ht: ht,
    total_ttc: ttc
  };
  if (input.envelopeId !== undefined) row.envelope_id = input.envelopeId;
  let envelopeSaved = true;
  let error;
  let id: string | null = input.id ?? null;
  if (input.id) {
    ({ error } = await supabase.from("budget_line_items").update(row).eq("id", input.id));
    if (error && input.envelopeId !== undefined) {
      // Before migration 0020 the column is absent — the rest saves.
      envelopeSaved = false;
      delete row.envelope_id;
      ({ error } = await supabase.from("budget_line_items").update(row).eq("id", input.id));
    }
  } else {
    const { count } = await supabase
      .from("budget_line_items")
      .select("id", { count: "exact", head: true })
      .eq("budget_line_id", input.budgetLineId);
    let { data: created, error: insErr } = await supabase
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
    if (insErr && input.envelopeId !== undefined) {
      envelopeSaved = false;
      delete row.envelope_id;
      ({ data: created, error: insErr } = await supabase
        .from("budget_line_items")
        .insert({
          ...(input.createId ? { id: input.createId } : {}),
          wedding_id: input.weddingId,
          budget_line_id: input.budgetLineId,
          sort: (count ?? 0) + 1,
          ...row
        })
        .select("id")
        .single());
    }
    error = insErr;
    id = created?.id ?? null;
  }
  if (!error) await rollupLine(input.budgetLineId);
  revalidateRooms("budget");
  return { ok: !error, id , envelopeSaved };
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
  /** The lifecycle (0027): expected by default; a recorded settlement
      arrives confirmed. Kind: payment, deposit, refund, credit note. */
  status?: string;
  kind?: string;
  reference?: string;
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
    refundable: input.refundable,
    ...(input.status ? { status: input.status } : {}),
    ...(input.kind ? { kind: input.kind } : {}),
    ...(input.reference?.trim() ? { reference: input.reference.trim() } : {}),
    ...(input.status === "confirmed" ? { paid_at: new Date().toISOString().slice(0, 10) } : {})
  };
  let inserted: { id: string } | null = null;
  let { data, error } = await supabase.from("payments").insert(full).select("id").single();
  inserted = data;
  if (error) {
    // Pre-0027 the lifecycle columns are absent — the movement lands.
    delete full.status;
    delete full.kind;
    delete full.reference;
    ({ data, error } = await supabase.from("payments").insert(full).select("id").single());
    inserted = data;
  }
  if (error) {
    // Before migration 0011 the v2 columns are absent.
    ({ data, error } = await supabase
      .from("payments")
      .insert({
        wedding_id: input.weddingId,
        budget_line_id: input.budgetLineId,
        label: input.label.trim(),
        amount: input.amount,
        due_date: input.dueDate
      })
      .select("id")
      .single());
    inserted = data;
  }
  // The wedding's default reminder set follows every new instalment
  // (notifications brief §1) — silent before migration 0018.
  if (inserted?.id) {
    const session = await requireHouseSession();
    await applyReminderDefaults(supabase, input.weddingId, inserted.id, session.profile.full_name);
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
  // Settling confirms; unsettling returns the movement to expected —
  // the lifecycle column follows the gesture (0027), silently before.
  const { error: withStatus } = await supabase
    .from("payments")
    .update({ paid_at: paidAt, status: paidAt ? "confirmed" : "expected" })
    .eq("id", paymentId);
  if (withStatus) {
    await supabase.from("payments").update({ paid_at: paidAt }).eq("id", paymentId);
  }

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

  // The line's "paid" follows its settled instalments (EUR
  // equivalent) — confirmed movements only, refunds subtracting (§12).
  if (payment?.budget_line_id) {
    const { data: siblings } = await supabase
      .from("payments")
      .select("*")
      .eq("budget_line_id", payment.budget_line_id);
    const paid = sumMoney(
      (siblings ?? [])
        .filter((p) => isSettledPayment(p))
        .map(
          (p) =>
            paymentSign(p) *
            Number(p.amount_eur ?? ((("currency" in p ? p.currency : "EUR") ?? "EUR") === "EUR" ? p.amount : 0))
        )
    );
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

/**
 * Delete is for drafts; a confirmed movement is REVERSED, kept (§18).
 * Pre-0027 the lifecycle is absent and the old gesture stands.
 */
export async function deletePayment(paymentId: string) {
  const session = await teamSession();
  const supabase = await createClient();
  const { data: p } = await supabase.from("payments").select("*").eq("id", paymentId).maybeSingle();
  if (!p) return { ok: true as const, reversed: false };
  const status = (p as { status?: string }).status;
  if (status === "confirmed" || status === "partially_refunded") {
    const { error } = await supabase.from("payments").update({ status: "reversed" }).eq("id", paymentId);
    if (!error) {
      await logActivity(supabase, p.wedding_id, session.profile.full_name, "payment_reversed", {
        paymentId, label: p.label, amount: p.amount
      });
      if (p.budget_line_id) {
        const { data: siblings } = await supabase.from("payments").select("*").eq("budget_line_id", p.budget_line_id);
        const paid = sumMoney(
          (siblings ?? [])
            .filter((x) => isSettledPayment(x))
            .map(
              (x) =>
                paymentSign(x) *
                Number(x.amount_eur ?? ((("currency" in x ? x.currency : "EUR") ?? "EUR") === "EUR" ? x.amount : 0))
            )
        );
        await supabase.from("budget_lines").update({ paid }).eq("id", p.budget_line_id);
      }
      revalidateRooms("budget");
      return { ok: true as const, reversed: true };
    }
  }
  await supabase.from("payments").delete().eq("id", paymentId);
  revalidateRooms("budget");
  return { ok: true as const, reversed: false };
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

/* ══════════ The house's analysis, under Estelle's word (0022) ══════ */

/**
 * Estelle's own pen on the analysis: save as draft while she works,
 * publish when it is the house's word, in her layout (bold, italics,
 * lists — rendered, never raw). Journaled either way.
 */
export async function saveBudgetAnalysis(
  weddingId: string,
  text: string,
  publish: boolean
) {
  const session = await teamSession();
  const supabase = await createClient();
  const patch: Record<string, unknown> = {
    budget_analysis: text.trim() || null,
    budget_analysis_at: new Date().toISOString(),
    budget_analysis_status: publish ? "published" : "draft"
  };
  let { error } = await supabase.from("weddings").update(patch).eq("id", weddingId);
  if (error) {
    // Pre-0022: no status column — the text still lands.
    delete patch.budget_analysis_status;
    ({ error } = await supabase.from("weddings").update(patch).eq("id", weddingId));
  }
  if (!error && publish) {
    await logActivity(supabase, weddingId, session.profile.full_name, "analysis_published", {});
  }
  revalidateRooms("budget");
  return { ok: !error };
}

/** The analysis leaves — her explicit gesture, kept in the journal. */
export async function removeBudgetAnalysis(weddingId: string) {
  const session = await teamSession();
  const supabase = await createClient();
  let { error } = await supabase
    .from("weddings")
    .update({ budget_analysis: null, budget_analysis_at: null, budget_analysis_status: "draft" })
    .eq("id", weddingId);
  if (error) {
    ({ error } = await supabase
      .from("weddings")
      .update({ budget_analysis: null, budget_analysis_at: null })
      .eq("id", weddingId));
  }
  if (!error) {
    await logActivity(supabase, weddingId, session.profile.full_name, "analysis_removed", {});
  }
  revalidateRooms("budget");
  return { ok: !error };
}
