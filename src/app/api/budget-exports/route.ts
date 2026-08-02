import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { createElement as h } from "react";
import { Document, Page, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { gate } from "../agents/_shared";
import { createClient } from "@/lib/supabase/server";
import { logActivity } from "@/lib/activity";
import { isSettledPayment, paymentSign, lineEurValues, sumMoney } from "@/lib/money";
import type { BudgetEnvelope, BudgetLine, EnvelopeNote, Invoice, Payment } from "@/lib/types";

export const runtime = "nodejs";

/**
 * Budget exports (PRD §16) — one workflow, real files, team only,
 * journaled. Kinds: complete, scope, ledger, selected, vendor-
 * commitments, invoices, payments, schedule, client, housebook,
 * audit, template. XLSX carries typed amounts and dates, filters,
 * widths and totals; PDF for the four house layouts.
 */

const HUNTER = "#22382B";
const CHAMPAGNE = "#c9b291";
const INK2 = "#6f6a5c";
const PARCHMENT = "#f2efe4";

type Cell = string | number | Date | null;

function sheetOf(rows: Cell[][], opts?: { totals?: number[]; widths?: number[] }) {
  const ws = XLSX.utils.aoa_to_sheet(rows, { cellDates: true });
  const n = rows.length;
  if (opts?.totals?.length && n > 1) {
    for (const c of opts.totals) {
      const col = XLSX.utils.encode_col(c);
      ws[XLSX.utils.encode_cell({ r: n, c })] = { t: "n", f: `SUM(${col}2:${col}${n})` };
    }
    ws[XLSX.utils.encode_cell({ r: n, c: 0 })] = { t: "s", v: "Total" };
    ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: n, c: rows[0].length - 1 } });
  }
  ws["!cols"] = (opts?.widths ?? rows[0].map(() => 14)).map((wch) => ({ wch }));
  ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(1, n - 1), c: rows[0].length - 1 } }) };
  return ws;
}

const d = (s: string | null | undefined) => (s ? new Date(s) : null);

export async function GET(request: Request) {
  const g = await gate(true);
  if ("error" in g) return g.error;
  const { session } = g;
  const wedding = session.wedding;
  if (!wedding) return NextResponse.json({ error: "no wedding" }, { status: 400 });

  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") ?? "complete";
  const format = url.searchParams.get("format") ?? "xlsx";
  const ids = (url.searchParams.get("ids") ?? "").split(",").filter(Boolean);
  const supabase = await createClient();

  const [{ data: envelopes }, { data: lines }, { data: payments }, { data: notes }, { data: vendors }, invoicesRes] =
    await Promise.all([
      supabase.from("budget_envelopes").select("*").eq("wedding_id", wedding.id).order("sort"),
      supabase.from("budget_lines").select("*").eq("wedding_id", wedding.id).order("sort"),
      supabase.from("payments").select("*").eq("wedding_id", wedding.id).order("due_date", { ascending: true, nullsFirst: false }),
      supabase.from("envelope_notes").select("*").eq("wedding_id", wedding.id),
      supabase.from("vendors").select("id, name, category, stage").eq("wedding_id", wedding.id),
      // Absent until migration 0027 — the workbook stands without it.
      supabase.from("invoices").select("*").eq("wedding_id", wedding.id).order("created_at")
    ]);

  const allEnvelopes = (envelopes ?? []) as BudgetEnvelope[];
  const allLines = (lines ?? []) as BudgetLine[];
  const allPayments = (payments ?? []) as Payment[];
  const allNotes = (notes ?? []) as EnvelopeNote[];
  const allInvoices = ((invoicesRes as { data: unknown }).data ?? []) as Invoice[];
  const vendorName = (id: string | null | undefined) => (vendors ?? []).find((v) => v.id === id)?.name ?? null;
  const envLabel = (id: string | null | undefined) => allEnvelopes.find((e) => e.id === id)?.label ?? "—";
  const total = wedding.budget_total ?? 0;

  const eurOf = (l: BudgetLine) => lineEurValues(l);

  const scopeRows = (): Cell[][] => [
    ["Envelope", "Recommended %", "Forecast %", "Forecast EUR", "Committed EUR", "Priority", "Locked", "Archived"],
    ...allEnvelopes.map((e) => {
      const committed = sumMoney(
        allLines.filter((l) => l.envelope_id === e.id && !l.parent_line_id && !l.archived).map((l) => eurOf(l).committedEur)
      );
      return [
        e.label,
        e.recommended_pct != null ? Number(e.recommended_pct) : null,
        e.percent != null ? Number(e.percent) : null,
        e.percent != null && total ? Math.round((Number(e.percent) / 100) * total) : null,
        committed,
        e.priority ?? "standard",
        e.locked ? "yes" : "",
        e.archived ? "yes" : ""
      ];
    })
  ];

  const ledgerRows = (subset?: Set<string>): Cell[][] => [
    ["Envelope", "Line", "Vendor", "Currency", "Budgeted", "Committed", "Committed EUR", "Paid EUR", "Remaining EUR", "Next", "Status", "Archived"],
    ...allLines
      .filter((l) => (subset ? subset.has(l.id) : true))
      .map((l) => {
        const v = eurOf(l);
        return [
          envLabel(l.envelope_id),
          (l.parent_line_id ? "  ↳ " : "") + l.label,
          vendorName(l.vendor_id),
          l.currency ?? "EUR",
          l.budgeted != null ? Number(l.budgeted) : null,
          l.committed != null ? Number(l.committed) : null,
          v.converted ? v.committedEur : null,
          v.converted ? v.paidEur : null,
          v.converted ? v.committedEur - v.paidEur : null,
          l.next_payment_label ?? null,
          l.status,
          l.archived ? "yes" : ""
        ];
      })
  ];

  const paymentRows = (onlyUpcoming = false): Cell[][] => [
    ["Line", "Label", "Kind", "Status", "Amount", "Currency", "EUR", "Due", "Settled on", "Method", "Payer", "Reference"],
    ...allPayments
      .filter((p) => (onlyUpcoming ? !isSettledPayment(p) && p.status !== "rejected" && p.status !== "reversed" : true))
      .map((p) => [
        p.budget_line_id ? allLines.find((l) => l.id === p.budget_line_id)?.label ?? null : null,
        p.label,
        p.kind ?? "payment",
        p.status ?? (p.paid_at ? "confirmed" : "expected"),
        Number(p.amount),
        p.currency ?? "EUR",
        p.amount_eur != null ? Number(p.amount_eur) : (p.currency ?? "EUR") === "EUR" ? Number(p.amount) : null,
        d(p.due_date),
        d(p.paid_at),
        p.method ?? null,
        p.payer ?? null,
        p.reference ?? null
      ])
  ];

  const invoiceRows = (): Cell[][] => [
    ["Kind", "Number", "Label", "Vendor", "Line", "Issue date", "Due date", "HT", "VAT", "TTC", "Currency", "Status"],
    ...allInvoices.map((i) => [
      i.kind,
      i.number,
      i.label,
      vendorName(i.vendor_id),
      i.budget_line_id ? allLines.find((l) => l.id === i.budget_line_id)?.label ?? null : null,
      d(i.issue_date),
      d(i.due_date),
      i.amount_ht != null ? Number(i.amount_ht) : null,
      i.vat_amount != null ? Number(i.vat_amount) : null,
      i.amount_ttc != null ? Number(i.amount_ttc) : null,
      i.currency,
      i.status
    ])
  ];

  const vendorCommitRows = (): Cell[][] => {
    const byVendor = new Map<string, { committed: number; paid: number }>();
    for (const l of allLines) {
      if (!l.vendor_id || l.archived) continue;
      const v = eurOf(l);
      const f = byVendor.get(l.vendor_id) ?? { committed: 0, paid: 0 };
      f.committed += v.converted ? v.committedEur : 0;
      f.paid += v.converted ? v.paidEur : 0;
      byVendor.set(l.vendor_id, f);
    }
    return [
      ["Vendor", "Category", "Stage", "Committed EUR", "Paid EUR", "Remaining EUR", "Next instalment", "Next due"],
      ...[...byVendor.entries()].map(([vid, f]) => {
        const v = (vendors ?? []).find((x) => x.id === vid);
        const lineIds = new Set(allLines.filter((l) => l.vendor_id === vid).map((l) => l.id));
        const next = allPayments.find((p) => p.budget_line_id && lineIds.has(p.budget_line_id) && !isSettledPayment(p));
        return [
          v?.name ?? "—",
          v?.category ?? null,
          v?.stage ?? null,
          Math.round(f.committed * 100) / 100,
          Math.round(f.paid * 100) / 100,
          Math.round((f.committed - f.paid) * 100) / 100,
          next?.label ?? null,
          d(next?.due_date ?? null)
        ];
      })
    ];
  };

  const clientRows = (): Cell[][] => [
    ["Envelope", "Line", "Committed", "Paid", "Remaining", "Next"],
    ...allLines
      .filter((l) => l.status === "published" && !l.archived)
      .map((l) => [
        envLabel(l.envelope_id),
        (l.parent_line_id ? "  ↳ " : "") + l.label,
        l.committed != null ? Number(l.committed) : null,
        Number(l.paid ?? 0),
        l.committed != null ? Number(l.committed) - Number(l.paid ?? 0) : null,
        l.next_payment_label ?? null
      ])
  ];

  const housebookRows = (): Cell[][] => [
    ["Envelope", "Note from the house", "Committed EUR", "Paid EUR", "Remaining EUR"],
    ...allEnvelopes
      .filter((e) => !e.archived)
      .map((e) => {
        const own = allLines.filter((l) => l.envelope_id === e.id && !l.parent_line_id && !l.archived);
        const committed = sumMoney(own.map((l) => eurOf(l).committedEur));
        const paid = sumMoney(own.map((l) => eurOf(l).paidEur));
        const note = allNotes.find((n) => n.envelope_id === e.id && n.status === "published");
        return [e.label, note?.body ?? null, committed, paid, committed - paid];
      })
  ];

  let auditRows: Cell[][] | null = null;
  if (kind === "audit" || kind === "complete") {
    const { data: log } = await supabase
      .from("activity_log")
      .select("created_at, actor, action, detail")
      .eq("wedding_id", wedding.id)
      .order("created_at", { ascending: false })
      .limit(500);
    auditRows = [
      ["Date", "Actor", "Action", "Detail"],
      ...(log ?? []).map((r) => [d(r.created_at), r.actor, r.action, r.detail ? JSON.stringify(r.detail) : null])
    ];
  }

  const templateRows: Cell[][] = [
    ["Envelope", "Line", "Vendor", "Budgeted", "Committed", "Paid", "Notes"],
    ["Reception", "Château rental", "Château de Vallery", 60000, 58000, 17400, "Buyout, three nights"]
  ];

  interface Built { name: string; sheets: { title: string; rows: Cell[][]; totals?: number[] }[] }
  const builds: Record<string, () => Built> = {
    scope: () => ({ name: "Scope budget", sheets: [{ title: "Scope", rows: scopeRows(), totals: [3, 4] }] }),
    ledger: () => ({ name: "Ledger", sheets: [{ title: "Ledger", rows: ledgerRows(), totals: [6, 7, 8] }] }),
    selected: () => ({ name: "Selected lines", sheets: [{ title: "Selected", rows: ledgerRows(new Set(ids)), totals: [6, 7, 8] }] }),
    "vendor-commitments": () => ({ name: "Vendor commitments", sheets: [{ title: "Vendors", rows: vendorCommitRows(), totals: [3, 4, 5] }] }),
    invoices: () => ({ name: "Invoices", sheets: [{ title: "Invoices", rows: invoiceRows(), totals: [7, 8, 9] }] }),
    payments: () => ({ name: "Payments", sheets: [{ title: "Payments", rows: paymentRows(), totals: [4, 6] }] }),
    schedule: () => ({ name: "Payment schedule", sheets: [{ title: "Schedule", rows: paymentRows(true), totals: [4, 6] }] }),
    client: () => ({ name: "Client budget", sheets: [{ title: "Budget", rows: clientRows(), totals: [2, 3, 4] }] }),
    housebook: () => ({ name: "House book", sheets: [{ title: "House book", rows: housebookRows(), totals: [2, 3, 4] }] }),
    audit: () => ({ name: "Audit history", sheets: [{ title: "Journal", rows: auditRows ?? [["Date", "Actor", "Action", "Detail"]] }] }),
    template: () => ({ name: "Budget import template", sheets: [{ title: "Template", rows: templateRows }] }),
    complete: () => ({
      name: "Complete budget",
      sheets: [
        { title: "Scope", rows: scopeRows(), totals: [3, 4] },
        { title: "Ledger", rows: ledgerRows(), totals: [6, 7, 8] },
        { title: "Payments", rows: paymentRows(), totals: [4, 6] },
        ...(allInvoices.length ? [{ title: "Invoices", rows: invoiceRows(), totals: [7, 8, 9] }] : []),
        { title: "Vendors", rows: vendorCommitRows(), totals: [3, 4, 5] },
        ...(auditRows ? [{ title: "Journal", rows: auditRows }] : [])
      ]
    })
  };
  const built = (builds[kind] ?? builds.complete)();

  const day = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const base = `${wedding.couple_display_name} — ${built.name} — ${day}`;
  await logActivity(supabase, wedding.id, session.profile.full_name, "budget_export", {
    kind,
    format,
    rows: built.sheets.reduce((s, x) => s + Math.max(0, x.rows.length - 1), 0),
    file: base
  });

  if (format === "csv") {
    const rows = built.sheets[0].rows;
    const csv = rows
      .map((r) =>
        r
          .map((c) => {
            const v = c instanceof Date ? c.toISOString().slice(0, 10) : c;
            return `"${String(v ?? "").replace(/"/g, '""')}"`;
          })
          .join(",")
      )
      .join("\r\n");
    return new NextResponse("﻿" + csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(base)}.csv`
      }
    });
  }

  if (format === "pdf") {
    const buffer = await renderBudgetPdf(kind, {
      couple: wedding.couple_display_name,
      destination: wedding.destination ?? "",
      total,
      envelopes: allEnvelopes,
      lines: allLines,
      payments: allPayments,
      notes: allNotes,
      vendorName,
      envLabel
    });
    const ascii = `MWD-${built.name}`.replace(/[^\x20-\x7E]/g, "-");
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${ascii}.pdf"; filename*=UTF-8''${encodeURIComponent(base)}.pdf`
      }
    });
  }

  const wb = XLSX.utils.book_new();
  for (const s of built.sheets) {
    XLSX.utils.book_append_sheet(wb, sheetOf(s.rows, { totals: s.totals }), s.title.slice(0, 28));
  }
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx", cellDates: true }) as Buffer;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(base)}.xlsx`
    }
  });
}

/* ══════════ the four PDF layouts (§16) ══════════ */

function renderBudgetPdf(
  kind: string,
  ctx: {
    couple: string;
    destination: string;
    total: number;
    envelopes: BudgetEnvelope[];
    lines: BudgetLine[];
    payments: Payment[];
    notes: EnvelopeNote[];
    vendorName: (id: string | null | undefined) => string | null;
    envLabel: (id: string | null | undefined) => string;
  }
) {
  const eur = (n: number | null | undefined) =>
    n == null ? "—" : `${new Intl.NumberFormat("en-IE", { maximumFractionDigits: 0 }).format(n)} €`;

  const clientOnly = kind === "client" || kind === "housebook";
  const lines = ctx.lines.filter((l) => !l.archived && (!clientOnly || l.status === "published"));
  const committed = sumMoney(lines.filter((l) => !l.parent_line_id).map((l) => lineEurValues(l).committedEur));
  const paid = sumMoney(lines.filter((l) => !l.parent_line_id).map((l) => lineEurValues(l).paidEur));

  const titleOf: Record<string, string> = {
    client: "Budget summary",
    schedule: "Payment schedule",
    housebook: "The house book",
    complete: "Internal budget report",
    ledger: "Internal budget report"
  };
  const title = titleOf[kind] ?? "Internal budget report";

  const cell = (txt: string, flex: number, align: "left" | "right" = "left", bold = false) =>
    h(Text, { style: { flex, textAlign: align, fontSize: 8.5, color: bold ? HUNTER : "#3a4a3f" } }, txt);

  const header = h(
    View,
    { style: { textAlign: "center", marginBottom: 18 } },
    h(Text, { style: { fontSize: 8, letterSpacing: 3, color: INK2, textTransform: "uppercase" } }, "MADAME WEDDING DESIGN"),
    h(Text, { style: { fontSize: 24, fontFamily: "Times-Italic", color: HUNTER, marginTop: 6 } }, title),
    h(Text, { style: { fontSize: 8.5, color: INK2, marginTop: 4 } }, `${ctx.couple}${ctx.destination ? ` · ${ctx.destination}` : ""}`)
  );

  const strip = h(
    View,
    { style: { flexDirection: "row", borderTop: `1 solid ${CHAMPAGNE}`, borderBottom: `1 solid ${CHAMPAGNE}`, paddingVertical: 8, marginBottom: 16 } },
    ...[
      ["TOTAL BUDGET", eur(ctx.total || null)],
      ["COMMITTED", eur(committed)],
      ["PAID", eur(paid)],
      ["REMAINING", eur(committed - paid)]
    ].map(([label, value]) =>
      h(
        View,
        { key: label, style: { flex: 1, textAlign: "center" } },
        h(Text, { style: { fontSize: 7, letterSpacing: 2, color: INK2 } }, label),
        h(Text, { style: { fontSize: 13, fontFamily: "Times-Roman", color: HUNTER, marginTop: 2 } }, value)
      )
    )
  );

  const footer = h(
    View,
    { style: { position: "absolute", bottom: 26, left: 46, right: 46, textAlign: "center", borderTop: `1 solid ${CHAMPAGNE}`, paddingTop: 8 } },
    h(Text, { style: { fontSize: 7, letterSpacing: 3, color: INK2 } }, "MADAME WEDDING DESIGN — A PARISIAN HOUSE OF WEDDING PLANNING AND PRODUCTION")
  );

  let body: unknown[];
  if (kind === "schedule") {
    const upcoming = ctx.payments.filter((p) => !isSettledPayment(p) && p.status !== "rejected" && p.status !== "reversed");
    const settled = ctx.payments.filter((p) => isSettledPayment(p));
    const rowsOf = (list: Payment[]) =>
      list.map((p) =>
        h(
          View,
          { key: p.id, style: { flexDirection: "row", borderBottom: `0.5 solid ${CHAMPAGNE}`, paddingVertical: 3 } },
          cell(p.label, 5),
          cell(ctx.lines.find((l) => l.id === p.budget_line_id)?.label ?? "", 4),
          cell(eur(Number(p.amount)), 2, "right"),
          cell(p.due_date ?? "—", 2, "right"),
          cell(isSettledPayment(p) ? "Settled" : "Upcoming", 2, "right")
        )
      );
    body = [
      h(Text, { key: "u", style: { fontSize: 7.5, letterSpacing: 2, color: "#8a6f45", textTransform: "uppercase", marginBottom: 4 } }, "UPCOMING"),
      ...rowsOf(upcoming),
      h(Text, { key: "s", style: { fontSize: 7.5, letterSpacing: 2, color: INK2, textTransform: "uppercase", marginTop: 12, marginBottom: 4 } }, "SETTLED"),
      ...rowsOf(settled)
    ];
  } else if (kind === "housebook") {
    body = ctx.envelopes
      .filter((e) => !e.archived)
      .map((e) => {
        const own = lines.filter((l) => l.envelope_id === e.id && !l.parent_line_id);
        const c = sumMoney(own.map((l) => lineEurValues(l).committedEur));
        const p = sumMoney(own.map((l) => lineEurValues(l).paidEur));
        const note = ctx.notes.find((n) => n.envelope_id === e.id && n.status === "published");
        return h(
          View,
          { key: e.id, style: { marginBottom: 14, backgroundColor: PARCHMENT, padding: 12 } },
          h(Text, { style: { fontSize: 13, fontFamily: "Times-Roman", color: HUNTER } }, e.label),
          note?.body
            ? h(Text, { style: { fontSize: 9, fontFamily: "Times-Italic", color: HUNTER, marginTop: 4, lineHeight: 1.5 } }, `“${note.body}” — Estelle`)
            : null,
          h(
            Text,
            { style: { fontSize: 9, color: INK2, marginTop: 6 } },
            `Committed ${eur(c)} · Paid ${eur(p)} · Remaining ${eur(c - p)}`
          )
        );
      });
  } else {
    // Internal report and client summary share the envelope tables —
    // the client's carries published figures alone, nothing internal.
    body = ctx.envelopes
      .filter((e) => !e.archived)
      .map((e) => {
        const own = lines.filter((l) => l.envelope_id === e.id && !l.parent_line_id);
        if (!own.length) return null;
        return h(
          View,
          { key: e.id, style: { marginBottom: 12 } },
          h(Text, { style: { fontSize: 7.5, letterSpacing: 2, color: "#8a6f45", textTransform: "uppercase", marginBottom: 4 } }, e.label),
          ...own.map((l) => {
            const v = lineEurValues(l);
            return h(
              View,
              { key: l.id, style: { flexDirection: "row", borderBottom: `0.5 solid ${CHAMPAGNE}`, paddingVertical: 3 } },
              cell(l.label + (kind !== "client" && l.status === "draft" ? "  · draft" : ""), 5),
              cell(ctx.vendorName(l.vendor_id) ?? "", 3),
              cell(l.budgeted != null && kind !== "client" ? eur(Number(l.budgeted)) : "", 2, "right"),
              cell(v.converted ? eur(v.committedEur) : `${eur(Number(l.committed ?? 0))} ${l.currency ?? ""}`, 2, "right"),
              cell(eur(v.paidEur), 2, "right"),
              cell(v.converted ? eur(v.committedEur - v.paidEur) : "—", 2, "right")
            );
          }),
          h(
            View,
            { style: { flexDirection: "row", backgroundColor: PARCHMENT, paddingVertical: 4, paddingHorizontal: 2 } },
            cell("Subtotal", 8, "left", true),
            cell("", 2),
            cell(eur(sumMoney(own.map((l) => lineEurValues(l).committedEur))), 2, "right", true),
            cell(eur(sumMoney(own.map((l) => lineEurValues(l).paidEur))), 2, "right", true),
            cell("", 2)
          )
        );
      })
      .filter(Boolean) as unknown[];
  }

  const doc = h(
    Document,
    {},
    h(
      Page,
      { size: "A4", style: { backgroundColor: "#fdfcf9", padding: 46, fontFamily: "Helvetica" } },
      header,
      strip,
      ...(body as Parameters<typeof h>[2][]),
      footer
    )
  );
  return renderToBuffer(doc);
}
