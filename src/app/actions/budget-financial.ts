"use server";

import { createClient } from "@/lib/supabase/server";
import { requireHouseSession } from "@/lib/session";
import { logActivity } from "@/lib/activity";
import { revalidateRooms } from "@/lib/revalidate";
import { roundMoney, sumMoney, isSettledPayment, paymentSign } from "@/lib/money";
import type { Invoice } from "@/lib/types";
import { saveScope } from "./budget-scope";
import type { EnvelopeDraft } from "@/lib/templates";

/**
 * Budget — the financial records the totals are calculated from
 * (PRD Budget, 0027): payment lifecycle, invoices, allocations,
 * archives, scenarios, document links, publication versions.
 * Everything degrades gracefully before the migration runs.
 */

async function teamSession() {
  const session = await requireHouseSession();
  if (!session.isTeam) throw new Error("team only");
  return session;
}

/* ══════════ payments: the lifecycle ══════════ */

/**
 * The line's "paid" follows its settled movements — confirmed only,
 * refunds subtracting (§12). One computation for every caller.
 */
async function rollupLinePaid(supabase: Awaited<ReturnType<typeof createClient>>, lineId: string) {
  const { data: siblings } = await supabase
    .from("payments")
    .select("amount, amount_eur, paid_at, currency, status, kind")
    .eq("budget_line_id", lineId);
  const paid = sumMoney(
    (siblings ?? [])
      .filter((p) => isSettledPayment(p as { status?: string | null; paid_at?: string | null }))
      .map((p) => {
        const sign = paymentSign(p as { kind?: string | null });
        const eur = Number(
          (p as { amount_eur?: number | null }).amount_eur ??
            ((("currency" in p ? p.currency : "EUR") ?? "EUR") === "EUR" ? p.amount : 0)
        );
        return sign * eur;
      })
  );
  await supabase.from("budget_lines").update({ paid }).eq("id", lineId);
}

/**
 * A movement changes state — draft, expected, pending verification,
 * confirmed, rejected, reversed, refunded. Only Estelle's hand does
 * this; the agents may prepare, never confirm (§19). Journaled.
 */
export async function setPaymentStatus(paymentId: string, status: string) {
  const session = await teamSession();
  const supabase = await createClient();
  const { data: payment } = await supabase.from("payments").select("*").eq("id", paymentId).maybeSingle();
  if (!payment) return { ok: false as const };

  const patch: Record<string, unknown> = { status };
  // Confirmation stamps the settlement date; leaving the settled
  // states clears it — paid_at stays the pre-0027 truth underneath.
  if (status === "confirmed" && !payment.paid_at) patch.paid_at = new Date().toISOString().slice(0, 10);
  if (["draft", "expected", "pending_verification", "rejected"].includes(status)) patch.paid_at = null;

  const { error } = await supabase.from("payments").update(patch).eq("id", paymentId);
  if (error) return { ok: false as const, needsMigration: true };

  if (payment.budget_line_id) await rollupLinePaid(supabase, payment.budget_line_id);
  await logActivity(supabase, payment.wedding_id, session.profile.full_name, "payment_status", {
    paymentId,
    label: payment.label,
    from: (payment as { status?: string }).status ?? (payment.paid_at ? "confirmed" : "expected"),
    to: status
  });
  revalidateRooms("budget");
  return { ok: true as const };
}

/**
 * One settlement, spread by hand (or prepared by the agent, §12):
 * over invoices, lines, or a deposit. Replaces the payment's
 * previous allocation set. The sum may not exceed the movement.
 */
export async function allocatePayment(
  paymentId: string,
  allocations: { invoiceId?: string | null; budgetLineId?: string | null; kind: "invoice" | "line" | "deposit"; amount: number }[]
) {
  const session = await teamSession();
  const supabase = await createClient();
  const { data: payment } = await supabase.from("payments").select("*").eq("id", paymentId).maybeSingle();
  if (!payment) return { ok: false as const };
  const total = sumMoney(allocations.map((a) => a.amount));
  if (total > Number(payment.amount) + 0.005) return { ok: false as const, reason: "over" as const };

  const { error: delErr } = await supabase.from("payment_allocations").delete().eq("payment_id", paymentId);
  if (delErr) return { ok: false as const, needsMigration: true };
  if (allocations.length) {
    const { error } = await supabase.from("payment_allocations").insert(
      allocations.map((a) => ({
        wedding_id: payment.wedding_id,
        payment_id: paymentId,
        invoice_id: a.invoiceId ?? null,
        budget_line_id: a.budgetLineId ?? null,
        kind: a.kind,
        amount: roundMoney(a.amount)
      }))
    );
    if (error) return { ok: false as const, needsMigration: true };
  }
  await logActivity(supabase, payment.wedding_id, session.profile.full_name, "payment_allocated", {
    paymentId,
    label: payment.label,
    parts: allocations.length,
    total
  });
  revalidateRooms("budget");
  return { ok: true as const };
}

/* ══════════ invoices — records of account ══════════ */

/**
 * An invoice, a proposal, a commitment or a credit note enters as a
 * RECORD, never as a mere editable total (§6). HT + VAT is checked
 * against TTC and a gap is said, never silently absorbed.
 */
export async function saveInvoice(input: {
  id?: string;
  weddingId: string;
  vendorId?: string | null;
  budgetLineId?: string | null;
  documentId?: string | null;
  kind: Invoice["kind"];
  number?: string;
  label: string;
  issueDate?: string | null;
  dueDate?: string | null;
  amountHt?: number | null;
  vatAmount?: number | null;
  amountTtc?: number | null;
  currency?: string;
  status?: Invoice["status"];
  notes?: string;
}) {
  const session = await teamSession();
  const supabase = await createClient();
  const row = {
    wedding_id: input.weddingId,
    vendor_id: input.vendorId ?? null,
    budget_line_id: input.budgetLineId ?? null,
    document_id: input.documentId ?? null,
    kind: input.kind,
    number: input.number?.trim() || null,
    label: input.label.trim() || "—",
    issue_date: input.issueDate || null,
    due_date: input.dueDate || null,
    amount_ht: input.amountHt ?? null,
    vat_amount: input.vatAmount ?? null,
    amount_ttc: input.amountTtc ?? null,
    currency: input.currency || "EUR",
    status: input.status ?? "draft",
    notes: input.notes?.trim() || null
  };
  let id = input.id ?? null;
  let error;
  if (input.id) {
    ({ error } = await supabase.from("invoices").update(row).eq("id", input.id));
  } else {
    const { data: created, error: insErr } = await supabase
      .from("invoices")
      .insert({ ...row, created_by: session.profile.full_name })
      .select("id")
      .single();
    error = insErr;
    id = created?.id ?? null;
  }
  if (error) return { ok: false as const, needsMigration: true };

  // The identity HT + VAT = TTC, watched at last (audit §7) — a gap
  // is returned in words for the sheet to show; the record stands.
  let vatGap: number | null = null;
  if (row.amount_ht != null && row.vat_amount != null && row.amount_ttc != null) {
    const gap = roundMoney(Number(row.amount_ttc) - (Number(row.amount_ht) + Number(row.vat_amount)));
    if (Math.abs(gap) >= 0.01) vatGap = gap;
  }
  await logActivity(supabase, input.weddingId, session.profile.full_name, "invoice_saved", {
    invoiceId: id,
    kind: row.kind,
    label: row.label,
    ttc: row.amount_ttc,
    ...(vatGap != null ? { vatGap } : {})
  });
  revalidateRooms("budget");
  return { ok: true as const, id, vatGap };
}

/** A draft record may leave; an approved one is cancelled, kept. */
export async function removeInvoice(invoiceId: string) {
  const session = await teamSession();
  const supabase = await createClient();
  const { data: inv } = await supabase.from("invoices").select("*").eq("id", invoiceId).maybeSingle();
  if (!inv) return { ok: false as const };
  if (inv.status === "draft") {
    await supabase.from("invoices").delete().eq("id", invoiceId);
    await logActivity(supabase, inv.wedding_id, session.profile.full_name, "invoice_removed", {
      invoiceId, label: inv.label, kind: inv.kind
    });
  } else {
    await supabase.from("invoices").update({ status: "cancelled" }).eq("id", invoiceId);
    await logActivity(supabase, inv.wedding_id, session.profile.full_name, "invoice_cancelled", {
      invoiceId, label: inv.label, kind: inv.kind
    });
  }
  revalidateRooms("budget");
  return { ok: true as const };
}

/* ══════════ archive, never hard-delete (§18) ══════════ */

export async function setLineArchived(lineId: string, archived: boolean) {
  const session = await teamSession();
  const supabase = await createClient();
  const { data: line } = await supabase.from("budget_lines").select("wedding_id, label").eq("id", lineId).maybeSingle();
  const { error } = await supabase.from("budget_lines").update({ archived }).eq("id", lineId);
  if (error) return { ok: false as const, needsMigration: true };
  if (line) {
    await logActivity(supabase, line.wedding_id, session.profile.full_name, archived ? "line_archived" : "line_restored", {
      lineId, label: line.label
    });
  }
  revalidateRooms("budget");
  return { ok: true as const };
}

/* ══════════ the envelope's own gestures (§5) ══════════ */

export async function addEnvelope(weddingId: string, label: string) {
  await teamSession();
  const supabase = await createClient();
  const { count } = await supabase
    .from("budget_envelopes")
    .select("id", { count: "exact", head: true })
    .eq("wedding_id", weddingId);
  const { data: created, error } = await supabase
    .from("budget_envelopes")
    .insert({ wedding_id: weddingId, label: label.trim() || "—", percent: 0, sort: (count ?? 0) + 1 })
    .select("id")
    .single();
  revalidateRooms("budget");
  return { ok: !error, id: created?.id ?? null };
}

export async function duplicateEnvelope(envelopeId: string) {
  await teamSession();
  const supabase = await createClient();
  const { data: src } = await supabase.from("budget_envelopes").select("*").eq("id", envelopeId).maybeSingle();
  if (!src) return { ok: false as const };
  const row: Record<string, unknown> = {
    wedding_id: src.wedding_id,
    label: `${src.label} — ii`,
    percent: 0,
    sort: (src.sort ?? 0) + 1,
    priority: src.priority,
    locked: false,
    recommended_pct: src.recommended_pct
  };
  let { error } = await supabase.from("budget_envelopes").insert(row);
  if (error) {
    delete row.priority; delete row.locked; delete row.recommended_pct;
    ({ error } = await supabase.from("budget_envelopes").insert(row));
  }
  revalidateRooms("budget");
  return { ok: !error };
}

export async function setEnvelopeArchived(envelopeId: string, archived: boolean) {
  const session = await teamSession();
  const supabase = await createClient();
  const { data: env } = await supabase.from("budget_envelopes").select("wedding_id, label").eq("id", envelopeId).maybeSingle();
  const { error } = await supabase.from("budget_envelopes").update({ archived }).eq("id", envelopeId);
  if (error) return { ok: false as const, needsMigration: true };
  if (env) {
    await logActivity(supabase, env.wedding_id, session.profile.full_name, archived ? "envelope_archived" : "envelope_restored", {
      envelopeId, label: env.label
    });
  }
  revalidateRooms("budget");
  return { ok: true as const };
}

/* ══════════ scenarios (§5) ══════════ */

export async function saveScenario(weddingId: string, label: string, data: EnvelopeDraft[]) {
  const session = await teamSession();
  const supabase = await createClient();
  const { error } = await supabase.from("budget_scenarios").insert({
    wedding_id: weddingId,
    label: label.trim() || "—",
    data: data.map((d, i) => ({
      label: d.label,
      percent: Number(d.percent) || 0,
      recommended_pct: d.recommendedPct ?? null,
      priority: d.priority ?? "standard",
      locked: Boolean(d.locked),
      sort: i + 1
    })),
    created_by: session.profile.full_name
  });
  if (error) return { ok: false as const, needsMigration: true };
  await logActivity(supabase, weddingId, session.profile.full_name, "scenario_saved", { label });
  revalidateRooms("budget");
  return { ok: true as const };
}

export async function removeScenario(scenarioId: string) {
  await teamSession();
  const supabase = await createClient();
  await supabase.from("budget_scenarios").delete().eq("id", scenarioId);
  revalidateRooms("budget");
  return { ok: true as const };
}

/**
 * Estelle's word publishes a scenario over the live scope: existing
 * envelopes matched by name keep their id (and their lines); new ones
 * are born; the 100 % rule holds through saveScope itself.
 */
export async function publishScenario(scenarioId: string) {
  const session = await teamSession();
  const supabase = await createClient();
  const { data: sc } = await supabase.from("budget_scenarios").select("*").eq("id", scenarioId).maybeSingle();
  if (!sc) return { ok: false as const };
  const { data: envelopes } = await supabase
    .from("budget_envelopes")
    .select("id, label")
    .eq("wedding_id", sc.wedding_id);
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const byLabel = new Map((envelopes ?? []).map((e) => [norm(e.label), e.id]));
  const drafts: EnvelopeDraft[] = (sc.data as {
    label: string; percent: number; recommended_pct: number | null;
    priority: "high" | "standard"; locked: boolean; sort: number;
  }[]).map((d, i) => ({
    id: byLabel.get(norm(d.label)),
    label: d.label,
    percent: Number(d.percent) || 0,
    recommendedPct: d.recommended_pct,
    priority: d.priority,
    locked: d.locked,
    sort: d.sort ?? i + 1
  }));
  const r = await saveScope(sc.wedding_id, drafts);
  if (!r.ok) return r;
  await supabase
    .from("budget_scenarios")
    .update({ status: "published", published_at: new Date().toISOString() })
    .eq("id", scenarioId);
  await logActivity(supabase, sc.wedding_id, session.profile.full_name, "scenario_published", {
    scenarioId, label: sc.label
  });
  revalidateRooms("budget");
  return { ok: true as const };
}

/* ══════════ one paper, several records (§9) ══════════ */

export async function attachDocument(input: {
  weddingId: string;
  documentId: string;
  targetKind: "budget_line" | "invoice" | "payment";
  targetId: string;
}) {
  const session = await teamSession();
  const supabase = await createClient();
  const { error } = await supabase.from("financial_document_links").upsert(
    {
      wedding_id: input.weddingId,
      document_id: input.documentId,
      target_kind: input.targetKind,
      target_id: input.targetId
    },
    { onConflict: "document_id,target_kind,target_id" }
  );
  if (error) return { ok: false as const, needsMigration: true };
  await logActivity(supabase, input.weddingId, session.profile.full_name, "document_attached", {
    documentId: input.documentId, target: input.targetKind, targetId: input.targetId
  });
  revalidateRooms("budget");
  return { ok: true as const };
}

/** Detach is a relationship gesture — the paper itself never moves. */
export async function detachDocument(linkId: string) {
  const session = await teamSession();
  const supabase = await createClient();
  const { data: link } = await supabase.from("financial_document_links").select("*").eq("id", linkId).maybeSingle();
  await supabase.from("financial_document_links").delete().eq("id", linkId);
  if (link) {
    await logActivity(supabase, link.wedding_id, session.profile.full_name, "document_detached", {
      documentId: link.document_id, target: link.target_kind, targetId: link.target_id
    });
  }
  revalidateRooms("budget");
  return { ok: true as const };
}

/* ══════════ bulk gestures over selected lines (§8) ══════════ */

export async function bulkLines(
  weddingId: string,
  ids: string[],
  gesture:
    | { kind: "envelope"; envelopeId: string | null }
    | { kind: "vendor"; vendorId: string | null }
    | { kind: "archive"; archived: boolean }
    | { kind: "publish" }
    | { kind: "hide" }
) {
  const session = await teamSession();
  const supabase = await createClient();
  if (!ids.length) return { ok: false as const };
  let error = null;
  if (gesture.kind === "envelope") {
    ({ error } = await supabase
      .from("budget_lines")
      .update({ envelope_id: gesture.envelopeId, status: "draft" })
      .in("id", ids)
      .eq("wedding_id", weddingId));
  } else if (gesture.kind === "vendor") {
    ({ error } = await supabase
      .from("budget_lines")
      .update({ vendor_id: gesture.vendorId })
      .in("id", ids)
      .eq("wedding_id", weddingId));
  } else if (gesture.kind === "archive") {
    ({ error } = await supabase
      .from("budget_lines")
      .update({ archived: gesture.archived })
      .in("id", ids)
      .eq("wedding_id", weddingId));
    if (error) return { ok: false as const, needsMigration: true };
  } else if (gesture.kind === "publish") {
    ({ error } = await supabase
      .from("budget_lines")
      .update({ status: "published" })
      .in("id", ids)
      .eq("wedding_id", weddingId)
      .eq("status", "draft"));
  } else if (gesture.kind === "hide") {
    ({ error } = await supabase
      .from("budget_lines")
      .update({ status: "draft" })
      .in("id", ids)
      .eq("wedding_id", weddingId));
  }
  await logActivity(supabase, weddingId, session.profile.full_name, `lines_bulk_${gesture.kind}`, {
    count: ids.length,
    ...(gesture.kind === "envelope" ? { envelopeId: gesture.envelopeId } : {}),
    ...(gesture.kind === "vendor" ? { vendorId: gesture.vendorId } : {}),
    ...(gesture.kind === "archive" ? { archived: gesture.archived } : {})
  });
  revalidateRooms("budget");
  return { ok: !error };
}

/* ══════════ a line's history (§7) ══════════ */

export async function lineHistory(weddingId: string, lineId: string) {
  await teamSession();
  const supabase = await createClient();
  const { data } = await supabase
    .from("activity_log")
    .select("actor, action, detail, created_at")
    .eq("wedding_id", weddingId)
    .or(`detail->>lineId.eq.${lineId},detail->>from.eq.${lineId},detail->>to.eq.${lineId},detail->>invoiceId.eq.${lineId}`)
    .order("created_at", { ascending: false })
    .limit(40);
  return {
    ok: true as const,
    entries: (data ?? []) as { actor: string; action: string; detail: Record<string, unknown> | null; created_at: string }[]
  };
}

/* ══════════ import (§17) ══════════ */

export interface BudgetImportRow {
  action: "create" | "skip";
  label: string;
  envelope?: string;
  vendor?: string;
  budgeted?: number | null;
  committed?: number | null;
  paid?: number | null;
  notes?: string;
}

/**
 * CSV/XLSX rows become draft lines: envelopes are matched or born by
 * name; a vendor is matched by exact name against the canonical
 * records — NEVER created here (§9): an unmatched name is reported.
 */
export async function importBudgetLines(weddingId: string, rows: BudgetImportRow[]) {
  const session = await teamSession();
  const supabase = await createClient();
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const [{ data: envelopes }, { data: vendors }, { count }] = await Promise.all([
    supabase.from("budget_envelopes").select("id, label").eq("wedding_id", weddingId),
    supabase.from("vendors").select("id, name").eq("wedding_id", weddingId),
    supabase.from("budget_lines").select("id", { count: "exact", head: true }).eq("wedding_id", weddingId)
  ]);
  const envByLabel = new Map((envelopes ?? []).map((e) => [norm(e.label), e.id]));
  const vendorByName = new Map((vendors ?? []).map((v) => [norm(v.name), v.id]));

  let created = 0;
  let skipped = 0;
  const unmatchedVendors = new Set<string>();
  let sort = count ?? 0;

  for (const r of rows) {
    if (r.action !== "create" || !r.label.trim()) { skipped += 1; continue; }
    let envelopeId: string | null = null;
    if (r.envelope?.trim()) {
      envelopeId = envByLabel.get(norm(r.envelope)) ?? null;
      if (!envelopeId) {
        const { data: env } = await supabase
          .from("budget_envelopes")
          .insert({ wedding_id: weddingId, label: r.envelope.trim(), percent: 0, sort: envByLabel.size + 1 })
          .select("id")
          .single();
        envelopeId = env?.id ?? null;
        if (envelopeId) envByLabel.set(norm(r.envelope), envelopeId);
      }
    }
    let vendorId: string | null = null;
    if (r.vendor?.trim()) {
      vendorId = vendorByName.get(norm(r.vendor)) ?? null;
      if (!vendorId) unmatchedVendors.add(r.vendor.trim());
    }
    sort += 1;
    const { error } = await supabase.from("budget_lines").insert({
      wedding_id: weddingId,
      envelope_id: envelopeId,
      vendor_id: vendorId,
      label: r.label.trim(),
      budgeted: r.budgeted ?? null,
      committed: r.committed != null ? roundMoney(r.committed) : null,
      paid: r.paid != null ? roundMoney(r.paid) : 0,
      committed_note: r.notes?.trim() || null,
      status: "draft",
      sort
    });
    if (!error) created += 1; else skipped += 1;
  }

  await logActivity(supabase, weddingId, session.profile.full_name, "budget_import", {
    created, skipped, unmatchedVendors: [...unmatchedVendors]
  });
  revalidateRooms("budget");
  return { ok: true as const, created, skipped, unmatchedVendors: [...unmatchedVendors] };
}
