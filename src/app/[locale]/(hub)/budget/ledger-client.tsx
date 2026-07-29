"use client";

import React, { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import type { BudgetEnvelope, BudgetLine, BudgetLineItem, EnvelopeNote, Payment } from "@/lib/types";
import { updateBudgetLine } from "@/app/actions/budget";

/**
 * Two readings of the same budget (brief §5): THE LEDGER — the rigour
 * of a spreadsheet without looking like one — and THE HOUSE BOOK — the
 * couple's reading, a card per envelope, everything breathing. One
 * truth underneath; the selector remembers each reader's preference.
 */

type ViewKind = "ledger" | "housebook";
type SortKey = "label" | "committed" | "paid" | "remaining" | null;

const money = (format: ReturnType<typeof useFormatter>, n: number | null | undefined) =>
  n == null ? "—" : format.number(n, { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

export function BudgetViews({
  lines,
  items,
  payments,
  envelopes,
  envelopeNotes,
  nextByLine,
  isTeam
}: {
  lines: BudgetLine[];
  items: BudgetLineItem[];
  payments: Payment[];
  envelopes: BudgetEnvelope[];
  envelopeNotes: EnvelopeNote[];
  nextByLine: Record<string, string>;
  isTeam: boolean;
}) {
  const t = useTranslations("budget.views");
  const defaultView: ViewKind = isTeam ? "ledger" : "housebook";
  const [view, setView] = useState<ViewKind>(defaultView);
  useEffect(() => {
    const saved = window.localStorage.getItem("mwd-budget-view") as ViewKind | null;
    if (saved === "ledger" || saved === "housebook") setView(saved);
  }, []);
  const pick = (v: ViewKind) => {
    setView(v);
    window.localStorage.setItem("mwd-budget-view", v);
  };

  return (
    <>
      <div style={{ display: "flex", gap: 4, marginBottom: 12 }} role="tablist" aria-label={t("switch")}>
        <button
          role="tab"
          aria-selected={view === "ledger"}
          className={`viewpick${view === "ledger" ? " on" : ""}`}
          onClick={() => pick("ledger")}
        >
          {t("ledger")}
        </button>
        <button
          role="tab"
          aria-selected={view === "housebook"}
          className={`viewpick${view === "housebook" ? " on" : ""}`}
          onClick={() => pick("housebook")}
        >
          {t("housebook")}
        </button>
      </div>
      {view === "ledger" ? (
        <Ledger
          lines={lines}
          items={items}
          envelopes={envelopes}
          nextByLine={nextByLine}
          isTeam={isTeam}
        />
      ) : (
        <HouseBook
          lines={lines}
          items={items}
          payments={payments}
          envelopes={envelopes}
          envelopeNotes={envelopeNotes}
          isTeam={isTeam}
        />
      )}
    </>
  );
}

/* ════════════════ VUE A — THE LEDGER ════════════════ */

interface Row {
  id: string;
  parentId: string | null;
  kind: string;
  envelopeId: string | null;
  vendorId: string | null;
  label: string;
  budgeted: number | null;
  currency: string;
  ht: number | null;
  vatPct: number | null;
  committed: number | null;
  committedNote: string | null;
  paid: number;
  next: string;
  status: string;
  draft: boolean;
}

const EDITABLE: Record<string, "label" | "committed" | "paid"> = {
  "1": "label",
  "5": "committed",
  "6": "paid"
};

function Ledger({
  lines,
  items,
  envelopes,
  nextByLine,
  isTeam
}: {
  lines: BudgetLine[];
  items: BudgetLineItem[];
  envelopes: BudgetEnvelope[];
  nextByLine: Record<string, string>;
  isTeam: boolean;
}) {
  const t = useTranslations("budget.views");
  const tm = useTranslations("budget.mgmt");
  const tmaster = useTranslations("budget.master");
  const format = useFormatter();
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [local, setLocal] = useState<Record<string, Partial<Row>>>({});
  const [editing, setEditing] = useState<{ id: string; col: string } | null>(null);
  const [editVal, setEditVal] = useState("");
  const [focus, setFocus] = useState<{ r: number; c: number }>({ r: 0, c: 1 });
  const [saved, setSaved] = useState<"idle" | "saving" | "saved">("idle");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: null, dir: 1 });
  const [statusFilter, setStatusFilter] = useState("all");
  const [dense, setDense] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const undoStack = useRef<{ id: string; field: "label" | "committed" | "paid"; prev: string | number | null }[]>([]);
  const redoStack = useRef<{ id: string; field: "label" | "committed" | "paid"; prev: string | number | null }[]>([]);
  const gridRef = useRef<HTMLTableElement>(null);

  const rows: Row[] = useMemo(
    () =>
      lines.map((l) => {
        const own = items.filter((it) => it.budget_line_id === l.id);
        const ht = own.length ? own.reduce((s, it) => s + Number(it.total_ht ?? 0), 0) : null;
        const vat = own.length
          ? (() => {
              const t1 = own.reduce((s, it) => s + Number(it.total_ttc ?? it.total_ht ?? 0), 0);
              return ht && t1 > ht ? Math.round(((t1 - ht) / ht) * 1000) / 10 : null;
            })()
          : null;
        const o = local[l.id] ?? {};
        const committed = (o.committed !== undefined ? o.committed : l.committed) as number | null;
        const paid = (o.paid !== undefined ? o.paid : l.paid ?? 0) as number;
        const status = l.committed_note
          ? "awaiting"
          : committed != null && committed - paid <= 0 && paid > 0
            ? "paid"
            : committed != null
              ? "committed"
              : "open";
        return {
          id: l.id,
          parentId: l.parent_line_id ?? null,
          kind: l.line_kind ?? "line",
          envelopeId: l.envelope_id ?? null,
          vendorId: l.vendor_id ?? null,
          label: (o.label !== undefined ? o.label : l.label) as string,
          budgeted: l.budgeted ?? null,
          currency: "EUR",
          ht,
          vatPct: vat,
          committed,
          committedNote: l.committed_note ?? null,
          paid,
          next: l.next_payment_label ?? nextByLine[l.id] ?? "",
          status,
          draft: l.status === "draft"
        };
      }),
    [lines, items, nextByLine, local]
  );

  // Envelope groups, sorted, filtered — children ride with their parent.
  const groups = useMemo(() => {
    let parents = rows.filter((r) => !r.parentId);
    if (statusFilter !== "all") parents = parents.filter((r) => r.status === statusFilter);
    if (sort.key) {
      const value = (r: Row): string | number => {
        if (sort.key === "label") return r.label;
        if (sort.key === "remaining") return (r.committed ?? 0) - r.paid;
        if (sort.key === "committed") return r.committed ?? 0;
        return r.paid;
      };
      parents = [...parents].sort((a, b) => {
        const va = value(a);
        const vb = value(b);
        if (typeof va === "string" && typeof vb === "string") return sort.dir * va.localeCompare(vb);
        return sort.dir * (Number(va) - Number(vb));
      });
    }
    const byEnv = new Map<string, Row[]>();
    for (const p of parents) {
      const k = p.envelopeId ?? "";
      byEnv.set(k, [...(byEnv.get(k) ?? []), p]);
    }
    const envLabel = (id: string) => envelopes.find((e) => e.id === id)?.label ?? t("noEnvelope");
    return [...byEnv.entries()]
      .sort((a, b) => envLabel(a[0]).localeCompare(envLabel(b[0])))
      .map(([envId, ps]) => ({
        envId,
        label: envId ? envLabel(envId) : t("noEnvelope"),
        parents: ps
      }));
  }, [rows, statusFilter, sort, envelopes, t]);

  // The flat visible row list, for keyboard geometry.
  const flat: Row[] = useMemo(() => {
    const out: Row[] = [];
    for (const g of groups) {
      if (collapsed.has(g.envId)) continue;
      for (const p of g.parents) {
        out.push(p);
        for (const c of rows.filter((r) => r.parentId === p.id)) out.push(c);
      }
    }
    return out;
  }, [groups, rows, collapsed]);

  const COLS = 9; // 0 status-chip col is not editable; 1 label … 8 next

  function persist(id: string, field: "label" | "committed" | "paid", value: string | number | null, recordUndo = true) {
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    const prev = row[field];
    if (prev === value) return;
    if (recordUndo) {
      undoStack.current.push({ id, field, prev: prev as string | number | null });
      redoStack.current = [];
    }
    setLocal((m) => ({ ...m, [id]: { ...m[id], [field]: value } }));
    setSaved("saving");
    startTransition(async () => {
      const fresh = { ...row, [field]: value };
      await updateBudgetLine({
        id,
        label: String(fresh.label),
        budgeted: fresh.budgeted ?? null,
        committed: fresh.committed != null ? Number(fresh.committed) : null,
        paid: Number(fresh.paid ?? 0),
        nextPaymentLabel: fresh.next ?? ""
      });
      setSaved("saved");
      router.refresh();
    });
  }

  function commitEdit(move: "down" | "right" | "stay" = "stay") {
    if (!editing) return;
    const field = EDITABLE[editing.col];
    if (field) {
      const value =
        field === "label" ? editVal : editVal.trim() === "" ? null : Number(editVal.replace(/[^\d.-]/g, "")) || 0;
      persist(editing.id, field, field === "paid" && value == null ? 0 : value);
    }
    setEditing(null);
    if (move === "down") setFocus((f) => ({ ...f, r: Math.min(flat.length - 1, f.r + 1) }));
    if (move === "right") setFocus((f) => ({ ...f, c: Math.min(COLS - 1, f.c + 1) }));
  }

  function beginEdit(r: number, c: number) {
    if (!isTeam) return;
    const row = flat[r];
    const field = EDITABLE[String(c)];
    if (!row || !field) return;
    setEditing({ id: row.id, col: String(c) });
    setEditVal(field === "label" ? row.label : row[field] != null ? String(row[field]) : "");
  }

  function onKey(e: React.KeyboardEvent) {
    if (editing) {
      if (e.key === "Enter") { e.preventDefault(); commitEdit("down"); }
      if (e.key === "Tab") { e.preventDefault(); commitEdit("right"); }
      if (e.key === "Escape") { setEditing(null); }
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      const stack = e.shiftKey ? redoStack.current : undoStack.current;
      const entry = stack.pop();
      if (entry) {
        const row = rows.find((r) => r.id === entry.id);
        if (row) {
          (e.shiftKey ? undoStack.current : redoStack.current).push({
            id: entry.id, field: entry.field, prev: row[entry.field] as string | number | null
          });
          persist(entry.id, entry.field, entry.prev, false);
        }
      }
      return;
    }
    const nav: Record<string, [number, number]> = {
      ArrowDown: [1, 0], ArrowUp: [-1, 0], ArrowRight: [0, 1], ArrowLeft: [0, -1]
    };
    if (nav[e.key]) {
      e.preventDefault();
      setFocus((f) => ({
        r: Math.max(0, Math.min(flat.length - 1, f.r + nav[e.key][0])),
        c: Math.max(1, Math.min(COLS - 1, f.c + nav[e.key][1]))
      }));
    }
    if (e.key === "Enter") { e.preventDefault(); beginEdit(focus.r, focus.c); }
    if (e.key === "Tab") { e.preventDefault(); setFocus((f) => ({ ...f, c: f.c >= COLS - 1 ? 1 : f.c + 1 })); }
  }

  /** Multi-cell paste from Excel or Sheets: TSV, anchored at the focus. */
  function onPaste(e: React.ClipboardEvent) {
    if (!isTeam || editing) return;
    const text = e.clipboardData.getData("text/plain");
    if (!text || (!text.includes("\t") && !text.includes("\n"))) return;
    e.preventDefault();
    const matrix = text.replace(/\r/g, "").split("\n").filter((l) => l.length).map((l) => l.split("\t"));
    const editCols = [1, 5, 6];
    const startCol = editCols.includes(focus.c) ? focus.c : 5;
    matrix.forEach((cells, dr) => {
      const row = flat[focus.r + dr];
      if (!row) return;
      cells.forEach((cell, dc) => {
        const col = startCol + dc;
        const field = EDITABLE[String(col)];
        if (!field) return;
        const value = field === "label" ? cell : cell.trim() === "" ? null : Number(cell.replace(/[^\d.-]/g, "")) || 0;
        persist(row.id, field, field === "paid" && value == null ? 0 : value);
      });
    });
  }

  async function exportSheet(kind: "csv" | "xlsx") {
    const header = [t("colLine"), t("colCurrency"), "HT", t("colVat"), "TTC", t("colPaid"), t("colRemaining"), t("colNext"), t("colStatus")];
    const data = flat.map((r) => [
      (r.parentId ? "  ↳ " : "") + r.label,
      r.currency,
      r.ht,
      r.vatPct != null ? `${r.vatPct}%` : null,
      r.committed,
      r.paid,
      r.committed != null ? r.committed - r.paid : null,
      r.next || null,
      t(`status.${r.status}`)
    ]);
    if (kind === "csv") {
      const csv = [header, ...data]
        .map((row) => row.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(";"))
        .join("\n");
      const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "budget-ledger.csv";
      a.click();
      return;
    }
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.aoa_to_sheet([header, ...data]);
    const n = data.length;
    // Totals row with live formulas — the sheet stays a sheet.
    XLSX.utils.sheet_add_aoa(ws, [[t("total"), null, null, null, null, null, null, null, null]], { origin: n + 1 });
    ws[XLSX.utils.encode_cell({ r: n + 1, c: 4 })] = { t: "n", f: `SUM(E2:E${n + 1})` };
    ws[XLSX.utils.encode_cell({ r: n + 1, c: 5 })] = { t: "n", f: `SUM(F2:F${n + 1})` };
    ws[XLSX.utils.encode_cell({ r: n + 1, c: 6 })] = { t: "n", f: `SUM(G2:G${n + 1})` };
    ws["!cols"] = [{ wch: 38 }, { wch: 6 }, { wch: 12 }, { wch: 8 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 22 }, { wch: 12 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Ledger");
    XLSX.writeFile(wb, "budget-ledger.xlsx");
  }

  const th = (label: string, key: SortKey, num = false) => (
    <th
      className={num ? "num" : undefined}
      style={{ cursor: key ? "pointer" : undefined, whiteSpace: "nowrap" }}
      onClick={key ? () => setSort((s) => ({ key, dir: s.key === key && s.dir === 1 ? -1 : 1 })) : undefined}
      aria-sort={key && sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : undefined}
    >
      {label}
      {key && sort.key === key ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
    </th>
  );

  const cell = (row: Row, ri: number, col: number, content: React.ReactNode, num = false) => {
    const isFocus = focus.r === ri && focus.c === col;
    const isEditing = editing && editing.id === row.id && editing.col === String(col);
    const editable = isTeam && EDITABLE[String(col)];
    return (
      <td
        className={`${num ? "num " : ""}${isFocus ? "cell-focus" : ""}`}
        style={editable ? { cursor: "text" } : undefined}
        onClick={() => { setFocus({ r: ri, c: col }); if (editable) beginEdit(ri, col); }}
      >
        {isEditing ? (
          <input
            autoFocus
            value={editVal}
            onChange={(e) => setEditVal(e.target.value)}
            onBlur={() => commitEdit()}
            style={{ width: "100%", border: "none", background: "transparent", font: "inherit", padding: 0, textAlign: num ? "right" : "left", outline: "none" }}
          />
        ) : (
          content
        )}
      </td>
    );
  };

  return (
    <div className="card">
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        <div className="eyebrow" style={{ marginRight: "auto" }}>{tm("lineByLine")}</div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ padding: "8px 10px", border: "1px solid var(--line)", background: "#fff", fontSize: 12.5 }} aria-label={t("filter")}>
          <option value="all">{t("status.all")}</option>
          <option value="committed">{t("status.committed")}</option>
          <option value="awaiting">{t("status.awaiting")}</option>
          <option value="paid">{t("status.paid")}</option>
          <option value="open">{t("status.open")}</option>
        </select>
        {isTeam && (
          <button className="addnote team-only" onClick={() => setDense((v) => !v)} aria-pressed={dense}>
            {dense ? t("comfortable") : t("compact")}
          </button>
        )}
        <button className="addnote" onClick={() => exportSheet("csv")}>CSV</button>
        <button className="addnote" onClick={() => exportSheet("xlsx")}>XLSX</button>
        {isTeam && (
          <span style={{ fontSize: 12.5, color: saved === "saving" ? "var(--bronze)" : "var(--ink2)" }} role="status" aria-live="polite">
            {saved === "saving" ? t("saving") : saved === "saved" ? t("savedNote") : ""}
          </span>
        )}
      </div>

      <div className="ledger-wrap" onKeyDown={onKey} onPaste={onPaste} tabIndex={0} role="grid" aria-label={tm("lineByLine")}>
        <table className={`sheet-table ledger${dense ? " dense" : ""}`} ref={gridRef}>
          <thead>
            <tr>
              <th aria-label={t("colStatus")} style={{ width: 24 }}></th>
              {th(t("colLine"), "label")}
              {th(t("colCurrency"), null)}
              {th("HT", null, true)}
              {th(t("colVat"), null, true)}
              {th("TTC", "committed", true)}
              {th(t("colPaid"), "paid", true)}
              {th(t("colRemaining"), "remaining", true)}
              {th(t("colNext"), null)}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const groupRows = g.parents.flatMap((p) => [p, ...rows.filter((r) => r.parentId === p.id)]);
              const sub = groupRows.reduce(
                (a, r) => ({ ttc: a.ttc + Number(r.committed ?? 0), paid: a.paid + Number(r.paid ?? 0) }),
                { ttc: 0, paid: 0 }
              );
              const isCollapsed = collapsed.has(g.envId);
              return (
                <React.Fragment key={g.envId || "none"}>
                  <tr className="ledger-group">
                    <td colSpan={5}>
                      <button
                        className="addnote"
                        onClick={() =>
                          setCollapsed((s) => {
                            const n = new Set(s);
                            if (n.has(g.envId)) n.delete(g.envId); else n.add(g.envId);
                            return n;
                          })
                        }
                        aria-expanded={!isCollapsed}
                      >
                        {isCollapsed ? "▸" : "▾"} {g.label}
                      </button>
                    </td>
                    <td className="num" style={{ fontWeight: 500 }}>{money(format, sub.ttc)}</td>
                    <td className="num">{money(format, sub.paid)}</td>
                    <td className="num">{money(format, sub.ttc - sub.paid)}</td>
                    <td></td>
                  </tr>
                  {!isCollapsed &&
                    groupRows.map((r) => {
                      const ri = flat.findIndex((f) => f.id === r.id);
                      return (
                        <tr key={r.id} style={r.parentId ? { color: "var(--ink2)", fontSize: "0.94em" } : undefined}>
                          <td>
                            {r.draft && <span className="tag int" title={t("status.draft")}>·</span>}
                          </td>
                          {cell(
                            r, ri, 1,
                            <>
                              {r.parentId && "↳ "}
                              {r.label}
                              {r.vendorId && !r.parentId && (
                                <Link className="addnote" style={{ marginLeft: 8, fontSize: 12 }} href={`/budget/vendor/${r.vendorId}`}>
                                  {tmaster("sheet")}
                                </Link>
                              )}
                            </>
                          )}
                          {cell(r, ri, 2, r.currency)}
                          {cell(r, ri, 3, r.ht != null ? money(format, r.ht) : "—", true)}
                          {cell(r, ri, 4, r.vatPct != null ? `${r.vatPct} %` : "—", true)}
                          {cell(r, ri, 5, r.committed != null ? money(format, r.committed) : r.committedNote ?? "—", true)}
                          {cell(r, ri, 6, r.paid ? money(format, r.paid) : "—", true)}
                          {cell(r, ri, 7, r.committed != null ? money(format, r.committed - r.paid) : "—", true)}
                          {cell(r, ri, 8, r.next || "—")}
                        </tr>
                      );
                    })}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {isTeam && <p className="team-only" style={{ fontSize: 12.5, color: "var(--ink2)", marginTop: 10 }}>{t("ledgerHint")}</p>}
    </div>
  );
}

/* ════════════════ VUE B — THE HOUSE BOOK ════════════════ */

function HouseBook({
  lines,
  items,
  payments,
  envelopes,
  envelopeNotes,
  isTeam
}: {
  lines: BudgetLine[];
  items: BudgetLineItem[];
  payments: Payment[];
  envelopes: BudgetEnvelope[];
  envelopeNotes: EnvelopeNote[];
  isTeam: boolean;
}) {
  const t = useTranslations("budget.views");
  const format = useFormatter();
  const [open, setOpen] = useState<string | null>(null);

  const groups = useMemo(() => {
    const parents = lines.filter((l) => !l.parent_line_id);
    const byEnv = new Map<string | null, BudgetLine[]>();
    for (const p of parents) byEnv.set(p.envelope_id ?? null, [...(byEnv.get(p.envelope_id ?? null) ?? []), p]);
    return [...byEnv.entries()].map(([envId, ps]) => {
      const env = envelopes.find((e) => e.id === envId) ?? null;
      const note = envelopeNotes.find((n) => n.envelope_id === envId && n.status === "published") ?? null;
      const kids = (p: BudgetLine) => lines.filter((l) => l.parent_line_id === p.id);
      const all = ps.flatMap((p) => [p, ...kids(p)]);
      const committed = all.reduce((s, l) => s + Number(l.committed ?? 0), 0);
      const paid = all.reduce((s, l) => s + Number(l.paid ?? 0), 0);
      return { env, note, parents: ps, committed, paid };
    });
  }, [lines, envelopes, envelopeNotes]);

  return (
    <div className="housebook">
      {groups.map((g, gi) => {
        const pct = g.committed > 0 ? Math.min(100, Math.round((g.paid / g.committed) * 100)) : 0;
        return (
          <div className="card hb-card" key={g.env?.id ?? `none-${gi}`}>
            <div className="serif" style={{ fontSize: 19 }}>{g.env?.label ?? t("noEnvelope")}</div>
            {g.note?.body && (
              <p className="envnote" style={{ marginTop: 4 }}>&ldquo;{g.note.body}&rdquo; — Estelle</p>
            )}
            <div className="serif num" style={{ fontSize: 26, marginTop: 10 }}>
              {g.committed > 0 ? money(format, g.committed) : <em style={{ fontSize: 16, color: "var(--ink2)" }}>{t("notYetPlaced")}</em>}
            </div>
            {g.committed > 0 && (
              <>
                <div className="hb-gauge" role="img" aria-label={t("gauge", { pct })}>
                  <span style={{ width: `${pct}%` }} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--ink2)", marginTop: 4 }}>
                  <span>{t("paidShort", { amount: money(format, g.paid) })}</span>
                  <span>{t("remainingShort", { amount: money(format, g.committed - g.paid) })}</span>
                </div>
              </>
            )}
            <div style={{ marginTop: 12 }}>
              {g.parents.map((p) => {
                const own = items.filter((it) => it.budget_line_id === p.id);
                const sched = payments.filter((x) => x.budget_line_id === p.id);
                const openable = own.length > 0 || sched.length > 0;
                const isOpen = open === p.id;
                return (
                  <div key={p.id} className="hb-line">
                    <button
                      className="hb-linehead"
                      onClick={() => openable && setOpen(isOpen ? null : p.id)}
                      aria-expanded={isOpen}
                      style={{ cursor: openable ? "pointer" : "default" }}
                    >
                      <span>
                        {p.label}
                        {isTeam && p.status === "draft" && <span className="tag int" style={{ marginLeft: 8 }}>{t("status.draft")}</span>}
                      </span>
                      <span className="num">
                        {p.committed != null ? money(format, p.committed) : p.committed_note ?? "—"}
                        {openable && <span style={{ marginLeft: 8, color: "var(--ink2)" }}>{isOpen ? "▾" : "▸"}</span>}
                      </span>
                    </button>
                    {isOpen && (
                      <div className="hb-detail">
                        {own.length > 0 && (
                          <div style={{ marginBottom: sched.length ? 10 : 0 }}>
                            {own.map((it) => (
                              <div key={it.id} className="hb-item">
                                <span>{it.event_label ? <em style={{ color: "var(--bronze)" }}>{it.event_label} · </em> : null}{it.label}</span>
                                <span className="num">{money(format, it.total_ttc ?? it.total_ht)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        {sched.length > 0 && (
                          <div>
                            <div className="eyebrow" style={{ marginBottom: 4 }}>{t("scheduleTitle")}</div>
                            {sched.map((x) => (
                              <div key={x.id} className="hb-item">
                                <span>
                                  {x.label}
                                  {x.paid_at && <span className="tag ok" style={{ marginLeft: 8 }}>{t("settled")}</span>}
                                </span>
                                <span className="num">
                                  {format.number(x.amount, { style: "currency", currency: x.currency || "EUR", maximumFractionDigits: 0 })}
                                  {x.due_date && (
                                    <span style={{ marginLeft: 8, color: "var(--ink2)", fontSize: 12 }}>
                                      {format.dateTime(new Date(x.due_date), { day: "numeric", month: "short", year: "numeric" })}
                                    </span>
                                  )}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
