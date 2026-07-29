"use client";

import React, { useMemo, useState, useTransition } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import type { BudgetLine, BudgetLineItem, BudgetRisk, Payment } from "@/lib/types";
import {
  addPayment,
  composePaymentNotice,
  deleteLineItem,
  deletePayment,
  markPaymentPaid,
  saveLineItem,
  sendPaymentNotice,
  updatePayment,
  updatePaymentFlags
} from "@/app/actions/budget";
import { deleteRisk, saveRisk } from "@/app/actions/budget-scope";
import { LineEditor } from "./budget-client";

const money = (format: ReturnType<typeof useFormatter>, n: number | null | undefined, currency = "EUR") =>
  n == null ? "—" : format.number(n, { style: "currency", currency, maximumFractionDigits: 0 });

/**
 * The master view — the Excel dashboard, alive. Parents carry their
 * nested credits (the CdB case) with a computed net balance; a line
 * holding its quote unfolds into sub-lines grouped by event.
 */
export function MasterTable({
  lines,
  items,
  weddingId,
  isTeam,
  nextByLine
}: {
  lines: BudgetLine[];
  items: BudgetLineItem[];
  weddingId: string;
  isTeam: boolean;
  nextByLine: Record<string, string>;
}) {
  const t = useTranslations("budget.mgmt");
  const tl = useTranslations("budget.lines");
  const tm = useTranslations("budget.master");
  const tc = useTranslations("common");
  const format = useFormatter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [unfoldedId, setUnfoldedId] = useState<string | null>(null);

  const parents = lines.filter((l) => !l.parent_line_id);
  const childrenOf = (id: string) => lines.filter((l) => l.parent_line_id === id);
  const itemsOf = (id: string) => items.filter((it) => it.budget_line_id === id);
  void weddingId;

  const row = (line: BudgetLine, child = false) => {
    const kids = child ? [] : childrenOf(line.id);
    const credits = kids.filter((k) => k.line_kind === "credit");
    const own = itemsOf(line.id);
    const pct =
      line.committed && line.committed > 0
        ? Math.min(100, Math.round(((line.paid ?? 0) / line.committed) * 100))
        : null;
    return (
      <React.Fragment key={line.id}>
        <tr style={child ? { color: "var(--ink2)", fontSize: 12.8 } : undefined}>
          <td style={child ? { paddingLeft: 30 } : undefined}>
            {child && "↳ "}
            {line.label}
            {line.status === "draft" && (
              <span className="tag int" style={{ marginLeft: 8 }}>{tc("draft")}</span>
            )}
            {(own.length > 0 || isTeam) && (
              <button
                className={own.length > 0 ? "addnote" : "addnote team-only"}
                style={{ marginLeft: 10 }}
                aria-expanded={unfoldedId === line.id}
                onClick={() => setUnfoldedId(unfoldedId === line.id ? null : line.id)}
              >
                {unfoldedId === line.id
                  ? tm("fold")
                  : own.length > 0
                    ? tm("unfold", { count: own.length })
                    : tm("itemsBtn")}
              </button>
            )}
          </td>
          <td className="num">{money(format, line.budgeted)}</td>
          <td className="num">{line.committed != null ? money(format, line.committed) : line.committed_note ?? "—"}</td>
          <td className="num">{line.paid ? money(format, line.paid) : "—"}</td>
          <td className="num">{line.committed != null ? money(format, line.committed - line.paid) : "—"}</td>
          <td>
            {pct != null && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 96 }}>
                <span aria-hidden style={{ flex: 1, height: 3, background: "var(--parchment)", minWidth: 44, position: "relative" }}>
                  <span style={{ position: "absolute", inset: `0 auto 0 0`, width: `${pct}%`, background: "var(--champagne)" }} />
                </span>
                <span style={{ fontSize: 12, fontVariantNumeric: "tabular-nums" }}>{pct} %</span>
              </span>
            )}
          </td>
          <td>{line.next_payment_label ?? nextByLine[line.id] ?? "—"}</td>
          {isTeam && (
            <td className="team-only" style={{ whiteSpace: "nowrap" }}>
              {!child && line.vendor_id && (
                <Link className="addnote" style={{ marginRight: 8 }} href={`/budget/vendor/${line.vendor_id}`}>
                  {tm("sheet")}
                </Link>
              )}
              <button className="addnote" onClick={() => setEditingId(editingId === line.id ? null : line.id)}>
                {editingId === line.id ? tc("close") : tl("edit")}
              </button>
            </td>
          )}
        </tr>
        {editingId === line.id && (
          <tr className="team-only">
            <td colSpan={8} style={{ background: "var(--parchment)" }}>
              <LineEditor line={line} onClose={() => setEditingId(null)} />
            </td>
          </tr>
        )}
        {unfoldedId === line.id && (own.length > 0 || isTeam) && (
          <tr>
            <td colSpan={8} style={{ padding: 0 }}>
              <SubLines items={own} weddingId={weddingId} budgetLineId={line.id} isTeam={isTeam} />
            </td>
          </tr>
        )}
        {kids.map((k) => row(k, true))}
        {credits.length > 0 && (
          <tr style={{ background: "oklch(0.7749 0.0521 76.74 / 0.10)" }}>
            <td>═ {tm("net", { label: line.label })}</td>
            <td className="num"></td>
            <td className="num">
              {money(format, (line.committed ?? 0) + credits.reduce((s, c) => s + (c.committed ?? 0), 0))}
            </td>
            <td className="num">{money(format, (line.paid ?? 0) + credits.reduce((s, c) => s + (c.paid ?? 0), 0))}</td>
            <td className="num">
              {money(
                format,
                (line.committed ?? 0) + credits.reduce((s, c) => s + (c.committed ?? 0), 0) -
                  ((line.paid ?? 0) + credits.reduce((s, c) => s + (c.paid ?? 0), 0))
              )}
            </td>
            <td></td>
            <td></td>
            {isTeam && <td className="team-only"></td>}
          </tr>
        )}
      </React.Fragment>
    );
  };

  return (
    <div className="card">
      <div className="eyebrow" style={{ marginBottom: 14 }}>{t("lineByLine")}</div>
      <div style={{ overflowX: "auto" }}>
        <table className="sheet-table">
          <thead>
            <tr>
              <th>{t("line")}</th>
              <th className="num">{t("budgeted")}</th>
              <th className="num">{t("committed")}</th>
              <th className="num">{t("paidCol")}</th>
              <th className="num">{t("remainingCol")}</th>
              <th>{tm("paidPct")}</th>
              <th>{t("nextPayment")}</th>
              {isTeam && <th className="team-only" aria-label={tl("edit")} />}
            </tr>
          </thead>
          <tbody>{parents.map((p) => row(p))}</tbody>
        </table>
      </div>
      {isTeam && (
        <p className="team-only" style={{ fontSize: 11.5, color: "var(--ink2)", marginTop: 10 }}>{tm("hint")}</p>
      )}
    </div>
  );
}

/** "1 234,56" the way a hand types it → a number, or null. */
const num = (v: string): number | null => {
  const n = Number(v.replace(/\s/g, "").replace(",", "."));
  return v.trim() === "" || Number.isNaN(n) ? null : n;
};

/**
 * A quote's own lines, grouped by event — subtotals roll up alone.
 * The team corrects any row by hand, sheet-style: no need to pass
 * through the document again. Clients read, never touch.
 */
function SubLines({
  items,
  weddingId,
  budgetLineId,
  isTeam
}: {
  items: BudgetLineItem[];
  weddingId: string;
  budgetLineId: string;
  isTeam: boolean;
}) {
  const tm = useTranslations("budget.master");
  const tc = useTranslations("common");
  const format = useFormatter();
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [pending, startTransition] = useTransition();
  const groups = useMemo(() => {
    const map = new Map<string, BudgetLineItem[]>();
    for (const it of items) {
      const k = it.event_label ?? tm("noEvent");
      map.set(k, [...(map.get(k) ?? []), it]);
    }
    return [...map.entries()];
  }, [items, tm]);

  const remove = (it: BudgetLineItem) => {
    if (!window.confirm(tm("removeItemConfirm"))) return;
    startTransition(async () => {
      await deleteLineItem(it.id, budgetLineId);
      router.refresh();
    });
  };

  return (
    <div style={{ background: "var(--parchment)", padding: "14px 18px" }}>
      {groups.map(([event, rows]) => (
        <div key={event} style={{ marginBottom: 12 }}>
          <div className="eyebrow" style={{ color: "var(--bronze)", margin: "4px 0 6px" }}>{event}</div>
          <table className="sheet-table" style={{ background: "#fff", fontSize: 12.8 }}>
            <tbody>
              {rows.map((it) =>
                editing === it.id ? (
                  <tr key={it.id} className="team-only">
                    <td colSpan={isTeam ? 6 : 5} style={{ background: "var(--parchment)" }}>
                      <ItemEditor
                        item={it}
                        weddingId={weddingId}
                        budgetLineId={budgetLineId}
                        onClose={() => setEditing(null)}
                      />
                    </td>
                  </tr>
                ) : (
                  <tr key={it.id}>
                    <td>{it.label}</td>
                    <td className="num">{it.qty != null ? `${it.qty} × ${money(format, it.unit_price)}` : ""}</td>
                    <td className="num">{it.total_ht != null ? `HT ${money(format, it.total_ht)}` : ""}</td>
                    <td className="num">{it.vat_pct != null ? `${tm("vat")} ${it.vat_pct} %` : ""}</td>
                    <td className="num">{money(format, it.total_ttc ?? it.total_ht)}</td>
                    {isTeam && (
                      <td className="team-only" style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                        <button className="addnote" onClick={() => setEditing(it.id)}>{tc("edit")}</button>
                        <button
                          className="addnote"
                          style={{ marginLeft: 8, color: "var(--bronze)" }}
                          disabled={pending}
                          onClick={() => remove(it)}
                        >
                          {tm("removeItem")}
                        </button>
                      </td>
                    )}
                  </tr>
                )
              )}
              <tr style={{ background: "var(--parchment)" }}>
                <td>{tm("subtotal")}</td>
                <td></td>
                <td className="num">{money(format, rows.reduce((s, r) => s + Number(r.total_ht ?? 0), 0))}</td>
                <td></td>
                <td className="num"><b>{money(format, rows.reduce((s, r) => s + Number(r.total_ttc ?? r.total_ht ?? 0), 0))}</b></td>
                {isTeam && <td className="team-only"></td>}
              </tr>
            </tbody>
          </table>
        </div>
      ))}
      {isTeam && (
        <div className="team-only" style={{ marginTop: 4 }}>
          {adding ? (
            <ItemEditor
              item={null}
              weddingId={weddingId}
              budgetLineId={budgetLineId}
              onClose={() => setAdding(false)}
            />
          ) : (
            <button className="addnote" onClick={() => setAdding(true)}>+ {tm("addItem")}</button>
          )}
        </div>
      )}
    </div>
  );
}

/** One sub-line under the hand — the sheet's own arithmetic fills the gaps. */
function ItemEditor({
  item,
  weddingId,
  budgetLineId,
  onClose
}: {
  item: BudgetLineItem | null;
  weddingId: string;
  budgetLineId: string;
  onClose: () => void;
}) {
  const tm = useTranslations("budget.master");
  const tc = useTranslations("common");
  const router = useRouter();
  const [event, setEvent] = useState(item?.event_label ?? "");
  const [label, setLabel] = useState(item?.label ?? "");
  const [qty, setQty] = useState(item?.qty?.toString() ?? "");
  const [unit, setUnit] = useState(item?.unit_price?.toString() ?? "");
  const [vat, setVat] = useState(item?.vat_pct?.toString() ?? "");
  const [ttc, setTtc] = useState(item?.total_ttc?.toString() ?? "");
  const [pending, startTransition] = useTransition();

  const field = (labelKey: string, value: string, set: (v: string) => void, width = 90, ph?: string) => (
    <div className="field" style={{ width, flex: "0 1 auto" }}>
      <label className="eyebrow">{tm(labelKey)}</label>
      <input value={value} onChange={(e) => set(e.target.value)} placeholder={ph} inputMode="decimal" />
    </div>
  );

  return (
    <div style={{ padding: "10px 4px" }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div className="field" style={{ flex: "1 1 150px" }}>
          <label className="eyebrow">{tm("itemEvent")}</label>
          <input value={event} onChange={(e) => setEvent(e.target.value)} placeholder={tm("noEvent")} />
        </div>
        <div className="field" style={{ flex: "2 1 200px" }}>
          <label className="eyebrow">{tm("itemLabel")}</label>
          <input value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
        {field("itemQty", qty, setQty, 70, "160")}
        {field("itemUnit", unit, setUnit, 90, "20")}
        {field("itemVat", vat, setVat, 70, "20")}
        {field("itemTtc", ttc, setTtc, 110)}
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button
          className="btn sm"
          disabled={pending || !label.trim()}
          onClick={() =>
            startTransition(async () => {
              await saveLineItem({
                id: item?.id,
                weddingId,
                budgetLineId,
                eventLabel: event,
                label,
                qty: num(qty),
                unitPrice: num(unit),
                vatPct: num(vat),
                // Qty × unit price recomputes HT; without them, the
                // document's own HT figure is left standing.
                totalHt: num(qty) != null && num(unit) != null ? null : (item?.total_ht ?? null),
                totalTtc: num(ttc)
              });
              onClose();
              router.refresh();
            })
          }
        >
          {tc("save")}
        </button>
        <button className="btn ghost sm" onClick={onClose}>{tc("cancel")}</button>
        <span style={{ fontSize: 11.5, color: "var(--ink2)" }}>{tm("autoHint")}</span>
      </div>
    </div>
  );
}

/**
 * The payment calendar — grouped by month, multi-currency, one press
 * to settle. The notify flow lets Madame compose in the client
 * language; Estelle reads every word before it leaves.
 */
export function PaymentsCalendar({
  payments,
  lineLabels,
  weddingId,
  lines,
  isTeam
}: {
  payments: Payment[];
  lineLabels: Record<string, string>;
  weddingId: string;
  lines: BudgetLine[];
  isTeam: boolean;
}) {
  const t = useTranslations("budget.cal");
  const tc = useTranslations("common");
  const format = useFormatter();
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ id: string; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const groups = useMemo(() => {
    const map = new Map<string, Payment[]>();
    for (const p of [...payments].sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"))) {
      const k = p.due_date ? p.due_date.slice(0, 7) : "tbc";
      map.set(k, [...(map.get(k) ?? []), p]);
    }
    return [...map.entries()];
  }, [payments]);

  async function notifyFlow(p: Payment) {
    setBusyId(p.id);
    try {
      const r = await composePaymentNotice(weddingId, p.id);
      if (r.ok) setNotice({ id: p.id, text: r.notice });
    } catch {
      /* stays silent */
    }
    setBusyId(null);
  }

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 14, flexWrap: "wrap", marginBottom: 8 }}>
        <div className="eyebrow">{t("title")}</div>
        {isTeam && (
          <span className="team-only" style={{ display: "inline-flex", gap: 12 }}>
            <button className="addnote" onClick={() => { setScheduling((v) => !v); setAdding(false); }}>
              {scheduling ? tc("cancel") : t("compose")}
            </button>
            <button className="addnote" onClick={() => { setAdding((v) => !v); setScheduling(false); }}>
              {adding ? tc("cancel") : t("add")}
            </button>
          </span>
        )}
      </div>
      {/* An instalment may pay a precise post: child lines stand too (G5). */}
      {adding && isTeam && (
        <AddPaymentRow weddingId={weddingId} lines={lines} onDone={() => setAdding(false)} />
      )}
      {scheduling && isTeam && (
        <ScheduleEditor weddingId={weddingId} lines={lines} onDone={() => setScheduling(false)} />
      )}
      {groups.length === 0 && (
        <p className="serif" style={{ fontStyle: "italic", color: "var(--ink2)", padding: "10px 0" }}>{t("empty")}</p>
      )}
      {groups.map(([month, rows]) => (
        <div key={month} style={{ marginTop: 12 }}>
          <div className="serif" style={{ fontStyle: "italic", fontSize: 18, margin: "6px 0" }}>
            {month === "tbc"
              ? t("toSettle")
              : format.dateTime(new Date(`${month}-01`), { month: "long", year: "numeric" })}
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="sheet-table">
              <tbody>
                {rows.map((p) => {
                  const eur = p.amount_eur != null && p.currency !== "EUR" ? money(format, p.amount_eur) : null;
                  return (
                    <React.Fragment key={p.id}>
                      <tr>
                        <td>
                          {p.label}
                          {p.budget_line_id && lineLabels[p.budget_line_id] && (
                            <span style={{ display: "block", fontSize: 11.5, color: "var(--ink2)" }}>
                              {lineLabels[p.budget_line_id]}
                            </span>
                          )}
                        </td>
                        <td className="num">
                          {money(format, p.amount, p.currency || "EUR")}
                          {eur && <span className="tag" style={{ marginLeft: 8 }}>≈ {eur}</span>}
                        </td>
                        <td>{p.due_date ? format.dateTime(new Date(p.due_date), { day: "numeric", month: "short" }) : "—"}</td>
                        <td>{p.method ?? "—"}</td>
                        <td style={{ fontSize: 12.5, color: "var(--ink2)" }}>{p.payer ?? ""}</td>
                        <td>
                          {p.refundable && <span className="tag">{t("refundable")}</span>}{" "}
                          {p.notified_at && <span className="tag int">{t("notified")}</span>}{" "}
                          {p.paid_at ? (
                            <span className="tag ok">{t("settled")}</span>
                          ) : (
                            <span className="tag wait">{t("upcoming")}</span>
                          )}
                        </td>
                        {isTeam && (
                          <td className="team-only" style={{ whiteSpace: "nowrap" }}>
                            <button
                              className="addnote"
                              onClick={() => setEditingId(editingId === p.id ? null : p.id)}
                            >
                              {editingId === p.id ? tc("close") : tc("edit")}
                            </button>{" "}
                            <button
                              className="addnote"
                              disabled={pending}
                              onClick={() =>
                                startTransition(async () => {
                                  await markPaymentPaid(p.id, p.paid_at ? null : new Date().toISOString().slice(0, 10));
                                  router.refresh();
                                })
                              }
                            >
                              {p.paid_at ? t("unsettle") : t("settle")}
                            </button>{" "}
                            <button className="addnote" disabled={busyId === p.id} onClick={() => notifyFlow(p)}>
                              {busyId === p.id ? "…" : t("notify")}
                            </button>{" "}
                            <button
                              className="addnote"
                              title={t("revealHint")}
                              aria-pressed={Boolean(p.reveal_banking)}
                              onClick={() =>
                                startTransition(async () => {
                                  await updatePaymentFlags(p.id, { reveal_banking: !p.reveal_banking });
                                  router.refresh();
                                })
                              }
                            >
                              {p.reveal_banking ? t("revealOn") : t("revealOff")}
                            </button>{" "}
                            <button
                              className="addnote"
                              onClick={() =>
                                startTransition(async () => {
                                  await deletePayment(p.id);
                                  router.refresh();
                                })
                              }
                            >
                              {t("remove")}
                            </button>
                          </td>
                        )}
                      </tr>
                      {editingId === p.id && (
                        <tr className="team-only">
                          <td colSpan={7} style={{ background: "var(--parchment)" }}>
                            <PaymentEditor payment={p} onClose={() => setEditingId(null)} />
                          </td>
                        </tr>
                      )}
                      {notice?.id === p.id && (
                        <tr className="team-only">
                          <td colSpan={7} style={{ background: "var(--parchment)" }}>
                            <div style={{ padding: "12px 8px" }}>
                              <div className="eyebrow" style={{ marginBottom: 6 }}>{t("noticeTitle")}</div>
                              <textarea
                                rows={4}
                                value={notice.text}
                                onChange={(e) => setNotice({ id: p.id, text: e.target.value })}
                                style={{ width: "100%", padding: "10px 12px", border: "1px solid var(--champagne)", fontSize: 13.5, fontFamily: "var(--font-display)", fontStyle: "italic" }}
                              />
                              <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                                <button
                                  className="btn sm"
                                  disabled={pending}
                                  onClick={() =>
                                    startTransition(async () => {
                                      const r = await sendPaymentNotice(weddingId, p.id, notice.text);
                                      setNotice(null);
                                      router.refresh();
                                      if (r.ok && !r.emailed) alert(t("noEmailYet"));
                                    })
                                  }
                                >
                                  {t("approveSend")}
                                </button>
                                <button className="btn ghost sm" onClick={() => setNotice(null)}>{tc("cancel")}</button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

const toNum = (s: string): number | null => {
  const d = s.replace(/[^\d]/g, "");
  return d ? Number(d) : null;
};

/** One instalment under the hand — corrected in place, never redone (G1/G6). */
function PaymentEditor({ payment, onClose }: { payment: Payment; onClose: () => void }) {
  const t = useTranslations("budget.cal");
  const tc = useTranslations("common");
  const router = useRouter();
  const [label, setLabel] = useState(payment.label);
  const [amount, setAmount] = useState(String(payment.amount ?? ""));
  const [currency, setCurrency] = useState(payment.currency ?? "EUR");
  const [eur, setEur] = useState(payment.amount_eur != null ? String(payment.amount_eur) : "");
  const [due, setDue] = useState(payment.due_date ?? "");
  const [method, setMethod] = useState(payment.method ?? "");
  const [payer, setPayer] = useState(payment.payer ?? "");
  const [pending, startTransition] = useTransition();

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", padding: "10px 6px" }}>
      <input value={label} onChange={(e) => setLabel(e.target.value)} style={{ flex: "1 1 200px" }} aria-label={t("labelPh")} />
      <input value={amount} onChange={(e) => setAmount(e.target.value)} style={{ flex: "0 0 100px", textAlign: "right" }} aria-label={t("amount")} />
      <select value={currency} onChange={(e) => setCurrency(e.target.value)} style={{ padding: "10px", border: "1px solid var(--line)", background: "#fff" }} aria-label={t("currency")}>
        {["EUR", "USD", "GBP", "CHF"].map((c) => <option key={c}>{c}</option>)}
      </select>
      {currency !== "EUR" && (
        <input value={eur} onChange={(e) => setEur(e.target.value)} placeholder={t("eurPh")} style={{ flex: "0 0 110px", textAlign: "right" }} aria-label={t("eurPh")} />
      )}
      <input type="date" value={due} onChange={(e) => setDue(e.target.value)} style={{ flex: "0 0 150px" }} aria-label={t("due")} />
      <input value={method} onChange={(e) => setMethod(e.target.value)} placeholder={t("methodPh")} style={{ flex: "0 0 130px" }} />
      <input value={payer} onChange={(e) => setPayer(e.target.value)} placeholder={t("payerPh")} style={{ flex: "0 0 120px" }} />
      <button
        className="btn sm"
        disabled={pending || !label.trim() || !toNum(amount)}
        onClick={() =>
          startTransition(async () => {
            await updatePayment(payment.id, {
              label,
              amount: toNum(amount)!,
              currency,
              amountEur: currency === "EUR" ? toNum(amount) : toNum(eur),
              dueDate: due || null,
              method,
              payer
            });
            onClose();
            router.refresh();
          })
        }
      >
        {tc("save")}
      </button>
      <button className="btn ghost sm" onClick={onClose}>{tc("cancel")}</button>
    </div>
  );
}

function AddPaymentRow({
  weddingId,
  lines,
  onDone
}: {
  weddingId: string;
  lines: BudgetLine[];
  onDone: () => void;
}) {
  const t = useTranslations("budget.cal");
  const [lineId, setLineId] = useState(lines[0]?.id ?? "");
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("EUR");
  const [eur, setEur] = useState("");
  const [due, setDue] = useState("");
  const [method, setMethod] = useState("Bank transfer");
  const [payer, setPayer] = useState("");
  const [refundable, setRefundable] = useState(false);
  const [added, setAdded] = useState(0);
  const labelRef = React.useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  void onDone;

  return (
    <div className="team-only" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", padding: "10px 0", borderBottom: "1px solid var(--line)" }}>
      <select value={lineId} onChange={(e) => setLineId(e.target.value)} style={{ padding: "10px", border: "1px solid var(--line)", background: "#fff", maxWidth: 180 }}>
        <option value="">{t("noLine")}</option>
        {lines.map((l) => (
          <option key={l.id} value={l.id}>{l.label}</option>
        ))}
      </select>
      <input ref={labelRef} value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("labelPh")} style={{ flex: "1 1 170px" }} />
      <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="8 000" style={{ flex: "0 0 90px", textAlign: "right" }} aria-label={t("amount")} />
      <select value={currency} onChange={(e) => setCurrency(e.target.value)} style={{ padding: "10px", border: "1px solid var(--line)", background: "#fff" }} aria-label={t("currency")}>
        {["EUR", "USD", "GBP", "CHF"].map((c) => <option key={c}>{c}</option>)}
      </select>
      {currency !== "EUR" && (
        <input value={eur} onChange={(e) => setEur(e.target.value)} placeholder={t("eurPh")} style={{ flex: "0 0 110px", textAlign: "right" }} aria-label={t("eurPh")} />
      )}
      <input type="date" value={due} onChange={(e) => setDue(e.target.value)} style={{ flex: "0 0 150px" }} aria-label={t("due")} />
      <input value={method} onChange={(e) => setMethod(e.target.value)} placeholder={t("methodPh")} style={{ flex: "0 0 130px" }} />
      <input value={payer} onChange={(e) => setPayer(e.target.value)} placeholder={t("payerPh")} style={{ flex: "0 0 130px" }} />
      <label style={{ fontSize: 12, display: "inline-flex", gap: 6, alignItems: "center" }}>
        <input type="checkbox" checked={refundable} onChange={(e) => setRefundable(e.target.checked)} />
        {t("refundable")}
      </label>
      <button
        className="btn ghost sm"
        disabled={pending || !label.trim() || !toNum(amount)}
        onClick={() =>
          startTransition(async () => {
            await addPayment({
              weddingId,
              budgetLineId: lineId || null,
              label,
              amount: toNum(amount)!,
              currency,
              amountEur: currency === "EUR" ? toNum(amount) : toNum(eur),
              dueDate: due || null,
              method,
              payer,
              refundable
            });
            router.refresh();
            // A 30/40/30 is three passes: the form stays open, cleared,
            // the pen back on the first field (G2).
            setLabel("");
            setAmount("");
            setEur("");
            setDue("");
            setRefundable(false);
            setAdded((n) => n + 1);
            labelRef.current?.focus();
          })
        }
      >
        {pending ? "…" : t("addGo")}
      </button>
      {added > 0 && (
        <span style={{ fontSize: 12, color: "var(--bronze)" }} role="status">
          {t("addedCount", { count: added })}
        </span>
      )}
    </div>
  );
}

/**
 * The schedule editor (G3): n instalments in one sitting for one line,
 * with 30/40/30 and 50/50 as mere shortcuts — never a template imposed.
 * The sum is watched against the committed figure and speaks plainly,
 * without ever blocking: Estelle decides (G4).
 */
export function ScheduleEditor({
  weddingId,
  lines,
  onDone
}: {
  weddingId: string;
  lines: BudgetLine[];
  onDone: () => void;
}) {
  const t = useTranslations("budget.cal");
  const tc = useTranslations("common");
  const format = useFormatter();
  const router = useRouter();
  const [lineId, setLineId] = useState(lines.find((l) => l.committed)?.id ?? lines[0]?.id ?? "");
  const [rows, setRows] = useState<{ label: string; amount: string; due: string }[]>([
    { label: "", amount: "", due: "" },
    { label: "", amount: "", due: "" }
  ]);
  const [pending, startTransition] = useTransition();

  const line = lines.find((l) => l.id === lineId);
  const committed = Number(line?.committed ?? 0);
  const sum = rows.reduce((s, r) => s + (toNum(r.amount) ?? 0), 0);
  const gap = committed - sum;

  const patch = (i: number, p: Partial<{ label: string; amount: string; due: string }>) =>
    setRows((list) => list.map((r, j) => (j === i ? { ...r, ...p } : r)));

  const applyTemplate = (parts: number[]) => {
    if (!committed) return;
    const labels = [t("tplDeposit"), t("tplSecond"), t("tplBalance")];
    setRows(
      parts.map((pct, i) => ({
        label: `${labels[Math.min(i, 2)]} ${pct}%`,
        amount: String(Math.round((committed * pct) / 100)),
        due: ""
      }))
    );
  };

  return (
    <div className="team-only" style={{ padding: "12px 0", borderBottom: "1px solid var(--line)" }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <select value={lineId} onChange={(e) => setLineId(e.target.value)} style={{ padding: "10px", border: "1px solid var(--line)", background: "#fff", maxWidth: 240 }}>
          {lines.map((l) => (
            <option key={l.id} value={l.id}>{l.parent_line_id ? `↳ ${l.label}` : l.label}</option>
          ))}
        </select>
        <span style={{ fontSize: 12.5, color: "var(--ink2)" }}>
          {committed ? t("committedIs", { amount: money(format, committed) }) : t("noCommitted")}
        </span>
        <button className="addnote" onClick={() => applyTemplate([30, 40, 30])} disabled={!committed}>30 / 40 / 30</button>
        <button className="addnote" onClick={() => applyTemplate([50, 50])} disabled={!committed}>50 / 50</button>
      </div>
      {rows.map((r, i) => (
        <div key={i} style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8, alignItems: "center" }}>
          <input value={r.label} onChange={(e) => patch(i, { label: e.target.value })} placeholder={t("labelPh")} style={{ flex: "1 1 200px" }} />
          <input value={r.amount} onChange={(e) => patch(i, { amount: e.target.value })} placeholder="8 000" style={{ flex: "0 0 100px", textAlign: "right" }} aria-label={t("amount")} />
          <input type="date" value={r.due} onChange={(e) => patch(i, { due: e.target.value })} style={{ flex: "0 0 150px" }} aria-label={t("due")} />
          <button
            className="addnote"
            onClick={() => setRows((list) => list.filter((_, j) => j !== i))}
            aria-label={t("remove")}
            style={{ color: "var(--bronze)" }}
          >
            ×
          </button>
        </div>
      ))}
      <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
        <button className="addnote" onClick={() => setRows((list) => [...list, { label: "", amount: "", due: "" }])}>
          + {t("addRow")}
        </button>
        <button
          className="btn sm"
          disabled={pending || !lineId || !rows.some((r) => r.label.trim() && toNum(r.amount))}
          onClick={() =>
            startTransition(async () => {
              for (const r of rows) {
                if (!r.label.trim() || !toNum(r.amount)) continue;
                await addPayment({
                  weddingId,
                  budgetLineId: lineId,
                  label: r.label,
                  amount: toNum(r.amount)!,
                  currency: "EUR",
                  amountEur: toNum(r.amount),
                  dueDate: r.due || null,
                  method: "Bank transfer",
                  payer: "",
                  refundable: false
                });
              }
              router.refresh();
              onDone();
            })
          }
        >
          {pending ? "…" : t("scheduleGo")}
        </button>
        {committed > 0 && sum > 0 && (
          <span style={{ fontSize: 12.5, color: Math.abs(gap) < 1 ? "var(--hunter)" : "var(--bronze)" }} role="status">
            {Math.abs(gap) < 1
              ? t("scheduleEven")
              : gap > 0
                ? t("notYetScheduled", { amount: money(format, gap) })
                : t("scheduledOver", { amount: money(format, -gap) })}
          </span>
        )}
      </div>
    </div>
  );
}

/** The risk buffer — exposure × probability, the reserve to hold. */
export function RiskBuffer({
  weddingId,
  risks,
  available
}: {
  weddingId: string;
  risks: BudgetRisk[];
  available: boolean;
}) {
  const t = useTranslations("budget.risks");
  const tc = useTranslations("common");
  const format = useFormatter();
  const router = useRouter();
  const [editing, setEditing] = useState<BudgetRisk | "new" | null>(null);
  const [pending, startTransition] = useTransition();

  const weighted = risks.reduce((s, r) => s + Number(r.exposure ?? 0) * Number(r.probability ?? 0), 0);
  const exposure = risks.reduce((s, r) => s + Number(r.exposure ?? 0), 0);

  return (
    <div className="ia team-only" style={{ marginTop: 14 }}>
      <div className="eyebrow">
        {t("title")} <span className="tag int">{t("neverVisible")}</span>
      </div>
      {!available && <p style={{ marginTop: 8, fontSize: 13, color: "var(--bronze)" }}>{t("needsMigration")}</p>}
      {risks.length > 0 && (
        <div style={{ overflowX: "auto", marginTop: 10 }}>
          <table className="sheet-table" style={{ fontSize: 13 }}>
            <thead>
              <tr>
                <th>{t("risk")}</th>
                <th className="num">{t("exposure")}</th>
                <th className="num">{t("probability")}</th>
                <th className="num">{t("weighted")}</th>
                <th>{t("owner")}</th>
                <th>{t("mitigation")}</th>
                <th aria-label={tc("edit")} />
              </tr>
            </thead>
            <tbody>
              {risks.map((r) => (
                <tr key={r.id}>
                  <td>{r.label}</td>
                  <td className="num">{money(format, r.exposure)}</td>
                  <td className="num">{r.probability != null ? `${Math.round(r.probability * 100)} %` : "—"}</td>
                  <td className="num">{money(format, Number(r.exposure ?? 0) * Number(r.probability ?? 0))}</td>
                  <td style={{ fontSize: 12 }}>{r.owner}</td>
                  <td style={{ fontSize: 12, color: "var(--ink2)" }}>{r.mitigation}</td>
                  <td>
                    <button className="addnote" onClick={() => setEditing(r)}>{tc("edit")}</button>
                  </td>
                </tr>
              ))}
              <tr style={{ background: "var(--parchment)" }}>
                <td>{t("total", { count: risks.length })}</td>
                <td className="num">{money(format, exposure)}</td>
                <td></td>
                <td className="num"><b>{money(format, weighted)}</b></td>
                <td colSpan={3}>{t("reserve", { low: money(format, Math.round(weighted * 0.8 / 500) * 500), high: money(format, Math.round(weighted * 1.1 / 500) * 500) })}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      {available && editing === null && (
        <button className="btn ghost sm" style={{ marginTop: 12 }} onClick={() => setEditing("new")}>
          {t("add")}
        </button>
      )}
      {editing !== null && (
        <RiskForm
          weddingId={weddingId}
          risk={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onRemove={(id) =>
            startTransition(async () => {
              await deleteRisk(id);
              setEditing(null);
              router.refresh();
            })
          }
          pending={pending}
        />
      )}
    </div>
  );
}

function RiskForm({
  weddingId,
  risk,
  onClose,
  onRemove,
  pending: removing
}: {
  weddingId: string;
  risk: BudgetRisk | null;
  onClose: () => void;
  onRemove: (id: string) => void;
  pending: boolean;
}) {
  const t = useTranslations("budget.risks");
  const tc = useTranslations("common");
  const [label, setLabel] = useState(risk?.label ?? "");
  const [exposure, setExposure] = useState(risk?.exposure?.toString() ?? "");
  const [prob, setProb] = useState(risk?.probability != null ? String(Math.round(risk.probability * 100)) : "");
  const [owner, setOwner] = useState(risk?.owner ?? "");
  const [mitigation, setMitigation] = useState(risk?.mitigation ?? "");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 12 }}>
      <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("risk")} style={{ flex: "1 1 200px" }} />
      <input value={exposure} onChange={(e) => setExposure(e.target.value)} placeholder={t("exposurePh")} style={{ flex: "0 0 110px", textAlign: "right" }} aria-label={t("exposure")} />
      <input value={prob} onChange={(e) => setProb(e.target.value)} placeholder="40" style={{ flex: "0 0 70px", textAlign: "right" }} aria-label={t("probability")} />
      <input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder={t("owner")} style={{ flex: "0 0 120px" }} />
      <input value={mitigation} onChange={(e) => setMitigation(e.target.value)} placeholder={t("mitigation")} style={{ flex: "1 1 200px" }} />
      <button
        className="btn ghost sm"
        disabled={pending || !label.trim()}
        onClick={() =>
          startTransition(async () => {
            await saveRisk({
              id: risk?.id,
              weddingId,
              label,
              exposure: toNum(exposure),
              probability: prob ? Number(prob) : null,
              owner,
              mitigation
            });
            router.refresh();
            onClose();
          })
        }
      >
        {pending ? "…" : tc("save")}
      </button>
      {risk && (
        <button className="btn ghost sm" disabled={removing} onClick={() => onRemove(risk.id)}>
          {t("remove")}
        </button>
      )}
      <button className="btn ghost sm" onClick={onClose}>{tc("cancel")}</button>
    </div>
  );
}
