"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireHouseSession } from "@/lib/session";
import { encryptBanking } from "@/lib/banking";

async function teamSession() {
  const session = await requireHouseSession();
  if (!session.isTeam) throw new Error("team only");
  return session;
}

export interface ReadingItem {
  event?: string | null;
  label?: string;
  qty?: number | null;
  unit_price?: number | null;
  total_ht?: number | null;
  vat_pct?: number | null;
  total_ttc?: number | null;
  page?: number | null;
}

export interface ReadingInstalment {
  label: string;
  amount: number;
  percentage?: number | null;
  due_date?: string | null;
  trigger?: string | null;
  refundable?: boolean;
  page?: number | null;
}

/**
 * Estelle's word on a reading: the selected parts of the proposal —
 * the committed total, the chosen sub-lines, the chosen instalments,
 * the banking details, the minimum-spend credit — enter the budget as
 * DRAFTS, each figure carrying its source document (C6, C7, G7).
 * What she does not select simply never lands.
 */
export async function acceptReading(input: {
  readingId: string;
  acceptLine: boolean;
  itemIdx: number[];
  scheduleIdx: number[];
  acceptBanking: boolean;
  acceptMinSpend: boolean;
}) {
  await teamSession();
  const supabase = await createClient();

  const { data: reading } = await supabase
    .from("document_readings")
    .select("*")
    .eq("id", input.readingId)
    .maybeSingle();
  if (!reading || reading.status !== "proposed") return { ok: false as const };
  const p = reading.payload as Record<string, unknown> & {
    currency?: string | null;
    total_amount?: number | null;
    total_ttc?: number | null;
    vendor_name?: string | null;
    label?: string;
    minimum_spend?: number | null;
    banking?: { account_name?: string | null; iban?: string | null; swift?: string | null; bank?: string | null } | null;
    items?: ReadingItem[];
    schedule?: ReadingInstalment[];
  };
  const weddingId = reading.wedding_id as string;
  const vendorId = reading.vendor_id as string | null;
  const currency = p.currency ?? "EUR";
  const total = p.total_amount ?? p.total_ttc ?? null;

  // ── The vendor's line: reworked if it exists, opened if not ──
  let lineId: string | null = null;
  if (vendorId) {
    const { data: line } = await supabase
      .from("budget_lines")
      .select("id")
      .eq("wedding_id", weddingId)
      .eq("vendor_id", vendorId)
      .is("parent_line_id", null)
      .limit(1)
      .maybeSingle();
    lineId = line?.id ?? null;
    if (!lineId && (input.acceptLine || input.itemIdx.length || input.scheduleIdx.length)) {
      const { count } = await supabase
        .from("budget_lines")
        .select("id", { count: "exact", head: true })
        .eq("wedding_id", weddingId);
      const { data: newLine } = await supabase
        .from("budget_lines")
        .insert({
          wedding_id: weddingId,
          vendor_id: vendorId,
          label: p.vendor_name ?? p.label ?? reading.label,
          committed: input.acceptLine ? total : null,
          status: "draft",
          sort: (count ?? 0) + 1
        })
        .select("id")
        .single();
      lineId = newLine?.id ?? null;
    } else if (lineId && input.acceptLine && total != null) {
      await supabase
        .from("budget_lines")
        .update({ committed: Math.round(Number(total)), committed_note: null, status: "draft" })
        .eq("id", lineId);
    }
  }

  // ── The chosen sub-lines, each carrying its source (C7) ──
  if (lineId && input.itemIdx.length && Array.isArray(p.items)) {
    const chosen = input.itemIdx
      .map((i) => p.items![i])
      .filter(Boolean);
    if (chosen.length) {
      await supabase.from("budget_line_items").delete().eq("budget_line_id", lineId);
      const rows = chosen.map((it, i) => ({
        wedding_id: weddingId,
        budget_line_id: lineId,
        event_label: it.event ?? null,
        label: it.label ?? "—",
        qty: it.qty ?? null,
        unit_price: it.unit_price ?? null,
        total_ht: it.total_ht ?? null,
        vat_pct: it.vat_pct ?? null,
        total_ttc: it.total_ttc ?? null,
        sort: i + 1
      }));
      let { error: itemsErr } = await supabase.from("budget_line_items").insert(
        rows.map((r, i) => ({
          ...r,
          source_document_id: reading.vendor_document_id,
          source_page: chosen[i].page ?? null
        }))
      );
      // Before migration 0013 the source columns are absent.
      if (itemsErr) ({ error: itemsErr } = await supabase.from("budget_line_items").insert(rows));
      if (!itemsErr) {
        const rollup = rows.reduce((s, r) => s + Number(r.total_ttc ?? r.total_ht ?? 0), 0);
        if (rollup > 0) {
          await supabase
            .from("budget_lines")
            .update({ committed: Math.round(rollup), committed_note: null, status: "draft" })
            .eq("id", lineId);
        }
      }
    }
  }

  // ── The chosen instalments, exactly as the document wrote them (G9) ──
  if (lineId && input.scheduleIdx.length && Array.isArray(p.schedule)) {
    await supabase
      .from("payments")
      .delete()
      .eq("budget_line_id", lineId)
      .is("paid_at", null)
      .like("label", `${reading.label} — %`);
    for (const idx of input.scheduleIdx) {
      const s = p.schedule[idx];
      // An instalment without a figure never lands — it stays flagged
      // in the reading for Estelle to enter by hand once known.
      if (!s || s.amount == null) continue;
      const suffix = !s.due_date && s.trigger ? ` (${s.trigger})` : "";
      const base = {
        wedding_id: weddingId,
        budget_line_id: lineId,
        label: `${reading.label} — ${s.label}${suffix}`,
        amount: s.amount,
        due_date: s.due_date ?? null
      };
      let { error: payErr } = await supabase.from("payments").insert({
        ...base,
        currency,
        amount_eur: currency === "EUR" ? s.amount : null,
        refundable: Boolean(s.refundable),
        source_document_id: reading.vendor_document_id
      });
      if (payErr) {
        ({ error: payErr } = await supabase.from("payments").insert({
          ...base,
          currency,
          amount_eur: currency === "EUR" ? s.amount : null,
          refundable: Boolean(s.refundable)
        }));
      }
      if (payErr) await supabase.from("payments").insert(base);
    }
  }

  // ── The minimum spend, carried as a negative credit line ──
  if (lineId && input.acceptMinSpend && p.minimum_spend) {
    const { data: existing } = await supabase
      .from("budget_lines")
      .select("id")
      .eq("parent_line_id", lineId)
      .eq("line_kind", "credit")
      .limit(1)
      .maybeSingle();
    const creditRow = {
      label: `LESS: minimum spend credit`,
      committed: -Math.abs(Number(p.minimum_spend)),
      status: "draft"
    };
    if (existing) {
      await supabase.from("budget_lines").update(creditRow).eq("id", existing.id);
    } else {
      const { count } = await supabase
        .from("budget_lines")
        .select("id", { count: "exact", head: true })
        .eq("wedding_id", weddingId);
      await supabase.from("budget_lines").insert({
        wedding_id: weddingId,
        vendor_id: vendorId,
        parent_line_id: lineId,
        line_kind: "credit",
        sort: (count ?? 0) + 1,
        ...creditRow
      });
    }
  }

  // ── The banking details — encrypted at rest, never displayed ──
  if (vendorId && input.acceptBanking && p.banking && (p.banking.iban || p.banking.swift)) {
    await supabase.from("vendor_banking").upsert(
      {
        vendor_id: vendorId,
        wedding_id: weddingId,
        enc: encryptBanking({
          holder: p.banking.account_name ?? undefined,
          iban: p.banking.iban ?? undefined,
          swift: p.banking.swift ?? undefined,
          bank: p.banking.bank ?? undefined
        }),
        updated_at: new Date().toISOString()
      },
      { onConflict: "vendor_id" }
    );
  }

  await supabase
    .from("document_readings")
    .update({ status: "accepted" })
    .eq("id", input.readingId);

  revalidatePath("/budget");
  revalidatePath("/vendors");
  return { ok: true as const };
}

/** A reading set aside — the paper stays filed, the budget untouched. */
export async function dismissReading(readingId: string) {
  await teamSession();
  const supabase = await createClient();
  await supabase
    .from("document_readings")
    .update({ status: "dismissed" })
    .eq("id", readingId);
  revalidatePath("/budget");
  return { ok: true as const };
}
