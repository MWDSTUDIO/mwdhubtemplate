"use client";

import React, { type ReactNode, useEffect, useRef, useState, useTransition } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import type { BudgetLine, Invoice } from "@/lib/types";
import {
  addLineViaMadame,
  publishBudget,
  saveEnvelopeNote,
  publishEnvelopeNote,
  saveInternalBudgetNote,
  updateBudgetLine,
  removeBudgetAnalysis,
  saveBudgetAnalysis,
  addBudgetLine,
  addPayment,
  setLineVendor
} from "@/app/actions/budget";
import { addEnvelope, saveInvoice } from "@/app/actions/budget-financial";
import { addVendorFull } from "@/app/actions/vendors";
import { HouseProse } from "@/lib/house-prose";
import { Dictate } from "@/components/Dictate";

export function BudgetTabs({ scope, mgmt }: { scope: ReactNode; mgmt: ReactNode }) {
  const t = useTranslations("budget");
  const [tab, setTab] = useState<"scope" | "mgmt">("scope");
  // The action bar (and only it) may steer the reader to a workspace —
  // "Upload financial document" lives on the management side.
  useEffect(() => {
    const onSteer = (e: Event) => {
      const dest = (e as CustomEvent<string>).detail;
      if (dest === "scope" || dest === "mgmt") setTab(dest);
    };
    window.addEventListener("mwd:budget-tab", onSteer);
    return () => window.removeEventListener("mwd:budget-tab", onSteer);
  }, []);
  return (
    <>
      <div className="tabs">
        <button className={tab === "scope" ? "on" : undefined} onClick={() => setTab("scope")}>
          {t("scopeTab")}
        </button>
        <button className={tab === "mgmt" ? "on" : undefined} onClick={() => setTab("mgmt")}>
          {t("mgmtTab")}
        </button>
      </div>
      <div style={{ display: tab === "scope" ? "block" : "none" }}>{scope}</div>
      <div style={{ display: tab === "mgmt" ? "block" : "none" }}>{mgmt}</div>
    </>
  );
}

/* ══════════ The global action bar (PRD §3) ══════════ */

type BarDrawer =
  | { kind: "line"; vendorId?: string }
  | { kind: "vendor" }
  | { kind: "record"; recordKind: Invoice["kind"] }
  | { kind: "pay"; mode: "installment" | "payment" | "refund" }
  | { kind: "note" }
  | null;

const drawerShell: React.CSSProperties = {
  position: "fixed", top: 0, right: 0, bottom: 0, width: "min(560px, 100%)",
  background: "var(--white, #fffdf9)", borderLeft: "1px solid var(--line)",
  padding: "24px 26px", overflow: "auto", zIndex: 50, boxShadow: "-12px 0 40px rgba(34,56,43,.12)"
};
const field: React.CSSProperties = { width: "100%", padding: "8px 10px", border: "1px solid var(--line)", fontSize: 13.5 };
const selectStyle: React.CSSProperties = { padding: "8px 10px", border: "1px solid var(--line)", background: "#fff", fontSize: 13 };

/**
 * One stable bar: Add · Upload financial document · Record payment ·
 * Export · Publish changes — nothing else permanent (§3). Every Add
 * entry lands in a focused drawer, never on the page itself (§2).
 */
export function BudgetActionBar({
  weddingId,
  draftCount,
  envelopes,
  vendors,
  lines
}: {
  weddingId: string;
  draftCount: number;
  envelopes: { id: string; label: string }[];
  vendors: { id: string; name: string; category?: string; stage?: string }[];
  lines: { id: string; label: string; vendor_id?: string | null }[];
}) {
  const t = useTranslations("budget.bar2");
  const router = useRouter();
  const [menu, setMenu] = useState<"none" | "add" | "export">("none");
  const [drawer, setDrawer] = useState<BarDrawer>(null);
  const [pending, startTransition] = useTransition();

  const steer = (dest: "scope" | "mgmt", anchor: string) => {
    window.dispatchEvent(new CustomEvent("mwd:budget-tab", { detail: dest }));
    requestAnimationFrame(() =>
      requestAnimationFrame(() => document.getElementById(anchor)?.scrollIntoView({ behavior: "smooth", block: "center" }))
    );
  };

  const addEntries: { key: string; go: () => void }[] = [
    { key: "category", go: () => { const l = window.prompt(t("categoryPrompt")); if (l?.trim()) startTransition(async () => { await addEnvelope(weddingId, l.trim()); router.refresh(); }); } },
    { key: "line", go: () => setDrawer({ kind: "line" }) },
    { key: "vendor", go: () => setDrawer({ kind: "vendor" }) },
    { key: "proposal", go: () => setDrawer({ kind: "record", recordKind: "proposal" }) },
    { key: "commitment", go: () => setDrawer({ kind: "record", recordKind: "commitment" }) },
    { key: "invoice", go: () => setDrawer({ kind: "record", recordKind: "invoice" }) },
    { key: "installment", go: () => setDrawer({ kind: "pay", mode: "installment" }) },
    { key: "payment", go: () => setDrawer({ kind: "pay", mode: "payment" }) },
    { key: "creditNote", go: () => setDrawer({ kind: "record", recordKind: "credit_note" }) },
    { key: "refund", go: () => setDrawer({ kind: "pay", mode: "refund" }) },
    { key: "note", go: () => setDrawer({ kind: "note" }) }
  ];

  const exportKinds: { key: string; formats: ("xlsx" | "csv" | "pdf")[] }[] = [
    { key: "complete", formats: ["xlsx", "pdf"] },
    { key: "scope", formats: ["xlsx", "csv"] },
    { key: "ledger", formats: ["xlsx", "csv"] },
    { key: "vendor-commitments", formats: ["xlsx", "csv"] },
    { key: "invoices", formats: ["xlsx", "csv"] },
    { key: "payments", formats: ["xlsx", "csv"] },
    { key: "schedule", formats: ["xlsx", "pdf"] },
    { key: "client", formats: ["xlsx", "pdf"] },
    { key: "housebook", formats: ["xlsx", "pdf"] },
    { key: "audit", formats: ["xlsx", "csv"] }
  ];

  return (
    <div className="team-only" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", margin: "0 0 14px", position: "relative" }}>
      <div style={{ position: "relative" }}>
        <button className="btn sm" aria-expanded={menu === "add"} onClick={() => setMenu(menu === "add" ? "none" : "add")}>
          {t("add")} ▾
        </button>
        {menu === "add" && (
          <div role="menu" style={{ position: "absolute", top: "110%", left: 0, zIndex: 40, background: "#fff", border: "1px solid var(--line)", boxShadow: "0 10px 30px rgba(34,56,43,.14)", minWidth: 230, padding: "6px 0" }}>
            {addEntries.map((e) => (
              <button
                key={e.key}
                role="menuitem"
                onClick={() => { setMenu("none"); e.go(); }}
                style={{ display: "block", width: "100%", textAlign: "left", padding: "7px 14px", background: "none", border: "none", fontSize: 13.5, cursor: "pointer", color: "var(--hunter)" }}
              >
                {t(`addMenu.${e.key}`)}
              </button>
            ))}
          </div>
        )}
      </div>
      <button className="btn ghost sm" onClick={() => steer("mgmt", "budget-doc-drop")}>{t("uploadDoc")}</button>
      <button className="btn ghost sm" onClick={() => setDrawer({ kind: "pay", mode: "payment" })}>{t("recordPayment")}</button>
      <div style={{ position: "relative" }}>
        <button className="btn ghost sm" aria-expanded={menu === "export"} onClick={() => setMenu(menu === "export" ? "none" : "export")}>
          {t("export")} ▾
        </button>
        {menu === "export" && (
          <div role="menu" style={{ position: "absolute", top: "110%", left: 0, zIndex: 40, background: "#fff", border: "1px solid var(--line)", boxShadow: "0 10px 30px rgba(34,56,43,.14)", minWidth: 300, padding: "6px 0", maxHeight: "60vh", overflow: "auto" }}>
            {exportKinds.map((k) => (
              <div key={k.key} style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "6px 14px" }}>
                <span style={{ flex: 1, fontSize: 13.5, color: "var(--hunter)" }}>{t(`exportMenu.${k.key}`)}</span>
                {k.formats.map((f) => (
                  <a key={f} className="addnote" style={{ textDecoration: "none" }} href={`/api/budget-exports?kind=${k.key}&format=${f}`} onClick={() => setMenu("none")} target={f === "pdf" ? "_blank" : undefined}>
                    {f.toUpperCase()}
                  </a>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
      <span style={{ marginLeft: "auto" }} />
      <button
        className="btn sm"
        disabled={pending || draftCount === 0}
        title={draftCount === 0 ? t("nothingToPublish") : undefined}
        onClick={() => startTransition(async () => { await publishBudget(weddingId); router.refresh(); })}
      >
        {pending ? "…" : draftCount > 0 ? t("publishCount", { count: draftCount }) : t("publish")}
      </button>

      {drawer && (
        <>
          <div onClick={() => setDrawer(null)} style={{ position: "fixed", inset: 0, background: "rgba(34,56,43,.25)", zIndex: 40 }} aria-hidden />
          {drawer.kind === "line" && (
            <AddLineDrawer weddingId={weddingId} envelopes={envelopes} vendors={vendors} vendorId={drawer.vendorId} onClose={() => setDrawer(null)} />
          )}
          {drawer.kind === "vendor" && (
            <VendorPickerDrawer
              weddingId={weddingId}
              vendors={vendors}
              onClose={() => setDrawer(null)}
              onAddLine={(vendorId) => setDrawer({ kind: "line", vendorId })}
            />
          )}
          {drawer.kind === "record" && (
            <RecordDrawer weddingId={weddingId} recordKind={drawer.recordKind} vendors={vendors} lines={lines} onClose={() => setDrawer(null)} />
          )}
          {drawer.kind === "pay" && (
            <PayDrawer weddingId={weddingId} mode={drawer.mode} lines={lines} onClose={() => setDrawer(null)} />
          )}
          {drawer.kind === "note" && <NoteDrawer weddingId={weddingId} onClose={() => setDrawer(null)} />}
        </>
      )}
    </div>
  );
}

function AddLineDrawer({
  weddingId, envelopes, vendors, vendorId, onClose
}: {
  weddingId: string;
  envelopes: { id: string; label: string }[];
  vendors: { id: string; name: string }[];
  vendorId?: string;
  onClose: () => void;
}) {
  const t = useTranslations("budget.bar2.lineDrawer");
  const tc = useTranslations("common");
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [envelopeId, setEnvelopeId] = useState("");
  const [vendor, setVendor] = useState(vendorId ?? "");
  const [budgeted, setBudgeted] = useState("");
  const [committed, setCommitted] = useState("");
  const [pending, startTransition] = useTransition();
  const num = (s: string) => (s.trim() === "" ? null : Number(s.replace(/[^\d.-]/g, "")) || 0);

  return (
    <aside aria-label={t("title")} style={drawerShell}>
      <p className="eyebrow" style={{ color: "var(--bronze)", margin: 0 }}>{t("title")}</p>
      <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
        <input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("labelPh")} style={field} />
        <select value={envelopeId} onChange={(e) => setEnvelopeId(e.target.value)} style={selectStyle} aria-label={t("envelope")}>
          <option value="">{t("noEnvelope")}</option>
          {envelopes.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
        </select>
        <select value={vendor} onChange={(e) => setVendor(e.target.value)} style={selectStyle} aria-label={t("vendor")}>
          <option value="">{t("noVendor")}</option>
          {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
        <div style={{ display: "flex", gap: 10 }}>
          <input value={budgeted} onChange={(e) => setBudgeted(e.target.value)} placeholder={t("budgetedPh")} inputMode="decimal" style={{ ...field, textAlign: "right" }} />
          <input value={committed} onChange={(e) => setCommitted(e.target.value)} placeholder={t("committedPh")} inputMode="decimal" style={{ ...field, textAlign: "right" }} />
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button
            className="btn sm"
            disabled={pending || !label.trim()}
            onClick={() =>
              startTransition(async () => {
                const r = await addBudgetLine(weddingId, label.trim(), num(budgeted), {
                  envelopeId: envelopeId || null,
                  committed: num(committed)
                });
                if (r.ok && r.id && vendor) await setLineVendor(r.id, vendor);
                router.refresh();
                onClose();
              })
            }
          >
            {pending ? "…" : t("open")}
          </button>
          <button className="btn ghost sm" onClick={onClose}>{tc("cancel")}</button>
        </div>
        <p style={{ fontSize: 12.5, color: "var(--ink2)" }}>{t("draftNote")}</p>
      </div>
    </aside>
  );
}

/**
 * Selecting a vendor searches the Vendors module (§3) — and creating
 * one goes THROUGH Vendors (canonical identity, §4), returning here
 * with the new record selected. Never a duplicate vendor.
 */
function VendorPickerDrawer({
  weddingId, vendors, onClose, onAddLine
}: {
  weddingId: string;
  vendors: { id: string; name: string; category?: string; stage?: string }[];
  onClose: () => void;
  onAddLine: (vendorId: string) => void;
}) {
  const t = useTranslations("budget.bar2.vendorPicker");
  const tc = useTranslations("common");
  const router = useRouter();
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [pending, startTransition] = useTransition();

  const hits = vendors.filter((v) => v.name.toLowerCase().includes(q.trim().toLowerCase()));
  const chosen = vendors.find((v) => v.id === picked) ?? null;

  return (
    <aside aria-label={t("title")} style={drawerShell}>
      <p className="eyebrow" style={{ color: "var(--bronze)", margin: 0 }}>{t("title")}</p>
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("searchPh")} style={{ ...field, marginTop: 14 }} />
      <div style={{ marginTop: 10, maxHeight: "40vh", overflow: "auto", border: "1px solid var(--line)" }}>
        {hits.map((v) => (
          <button
            key={v.id}
            onClick={() => setPicked(v.id)}
            style={{ display: "flex", gap: 10, width: "100%", textAlign: "left", padding: "8px 12px", background: picked === v.id ? "var(--parchment)" : "none", border: "none", borderBottom: "1px solid rgba(201,178,145,.2)", cursor: "pointer", alignItems: "baseline" }}
          >
            <span style={{ fontWeight: 500, color: "var(--hunter)" }}>{v.name}</span>
            <span style={{ fontSize: 12, color: "var(--ink2)" }}>{[v.category, v.stage].filter(Boolean).join(" · ")}</span>
          </button>
        ))}
        {hits.length === 0 && <p style={{ padding: "10px 12px", fontSize: 13, color: "var(--ink2)" }}>{t("none")}</p>}
      </div>
      {chosen && (
        <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
          <span style={{ fontSize: 13.5 }}>{t("picked", { name: chosen.name })}</span>
          <button className="btn sm" onClick={() => onAddLine(chosen.id)}>{t("addLineFor")}</button>
          <Link className="addnote" href={`/vendors/${chosen.id}`}>{t("viewProfile")}</Link>
          <Link className="addnote" href={`/budget/vendor/${chosen.id}`}>{t("openSheet")}</Link>
        </div>
      )}
      <hr className="hair" style={{ margin: "16px 0" }} />
      {!creating ? (
        <button className="btn ghost sm" onClick={() => { setCreating(true); setNewName(q); }}>{t("createInVendors")}</button>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          <p style={{ fontSize: 12.5, color: "var(--ink2)", margin: 0 }}>{t("createNote")}</p>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t("namePh")} style={field} />
          <input value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder={t("categoryPh")} style={field} />
          <div style={{ display: "flex", gap: 10 }}>
            <button
              className="btn sm"
              disabled={pending || !newName.trim()}
              onClick={() =>
                startTransition(async () => {
                  const r = await addVendorFull(weddingId, { name: newName.trim(), category: newCategory.trim() || "—" });
                  if (r.ok && r.id) {
                    setPicked(r.id);
                    setCreating(false);
                    router.refresh();
                    onAddLine(r.id);
                  }
                })
              }
            >
              {pending ? "…" : t("createGo")}
            </button>
            <button className="btn ghost sm" onClick={() => setCreating(false)}>{tc("cancel")}</button>
          </div>
        </div>
      )}
      <div style={{ marginTop: 16 }}>
        <button className="btn ghost sm" onClick={onClose}>{tc("close")}</button>
      </div>
    </aside>
  );
}

/** Proposal, commitment, invoice, credit note — records of account (§6). */
function RecordDrawer({
  weddingId, recordKind, vendors, lines, onClose
}: {
  weddingId: string;
  recordKind: Invoice["kind"];
  vendors: { id: string; name: string }[];
  lines: { id: string; label: string; vendor_id?: string | null }[];
  onClose: () => void;
}) {
  const t = useTranslations("budget.bar2.record");
  const tc = useTranslations("common");
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [number, setNumber] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [lineId, setLineId] = useState("");
  const [issue, setIssue] = useState("");
  const [due, setDue] = useState("");
  const [ht, setHt] = useState("");
  const [vat, setVat] = useState("");
  const [ttc, setTtc] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const num = (s: string) => (s.trim() === "" ? null : Number(s.replace(/[^\d.-]/g, "")) || 0);

  return (
    <aside aria-label={t(`title_${recordKind}`)} style={drawerShell}>
      <p className="eyebrow" style={{ color: "var(--bronze)", margin: 0 }}>{t(`title_${recordKind}`)}</p>
      <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
        <input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("labelPh")} style={field} />
        {recordKind === "invoice" && (
          <input value={number} onChange={(e) => setNumber(e.target.value)} placeholder={t("numberPh")} style={field} />
        )}
        <select value={vendorId} onChange={(e) => { setVendorId(e.target.value); const l = lines.find((x) => x.vendor_id === e.target.value); if (l) setLineId(l.id); }} style={selectStyle} aria-label={t("vendor")}>
          <option value="">{t("noVendor")}</option>
          {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
        <select value={lineId} onChange={(e) => setLineId(e.target.value)} style={selectStyle} aria-label={t("line")}>
          <option value="">{t("noLine")}</option>
          {lines.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
        </select>
        <div style={{ display: "flex", gap: 10 }}>
          <label style={{ flex: 1, fontSize: 12, color: "var(--ink2)" }}>
            {t("issue")}
            <input type="date" value={issue} onChange={(e) => setIssue(e.target.value)} style={field} />
          </label>
          <label style={{ flex: 1, fontSize: 12, color: "var(--ink2)" }}>
            {t("due")}
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)} style={field} />
          </label>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <input value={ht} onChange={(e) => setHt(e.target.value)} placeholder="HT" inputMode="decimal" style={{ ...field, textAlign: "right" }} />
          <input value={vat} onChange={(e) => setVat(e.target.value)} placeholder={t("vatPh")} inputMode="decimal" style={{ ...field, textAlign: "right" }} />
          <input value={ttc} onChange={(e) => setTtc(e.target.value)} placeholder="TTC" inputMode="decimal" style={{ ...field, textAlign: "right" }} />
        </div>
        {note && <p role="alert" style={{ fontSize: 12.5, color: "var(--bronze)", margin: 0 }}>{note}</p>}
        <div style={{ display: "flex", gap: 10 }}>
          <button
            className="btn sm"
            disabled={pending || !label.trim()}
            onClick={() =>
              startTransition(async () => {
                const r = await saveInvoice({
                  weddingId,
                  vendorId: vendorId || null,
                  budgetLineId: lineId || null,
                  kind: recordKind,
                  number,
                  label: label.trim(),
                  issueDate: issue || null,
                  dueDate: due || null,
                  amountHt: num(ht),
                  vatAmount: num(vat),
                  amountTtc: num(ttc)
                });
                if (!r.ok) { setNote(t("needsMigration")); return; }
                if (r.vatGap != null) { setNote(t("vatGap", { gap: r.vatGap })); return; }
                router.refresh();
                onClose();
              })
            }
          >
            {pending ? "…" : t("hold")}
          </button>
          {note && (
            <button className="btn ghost sm" onClick={() => { router.refresh(); onClose(); }}>{t("keepAnyway")}</button>
          )}
          <button className="btn ghost sm" onClick={onClose}>{tc("cancel")}</button>
        </div>
        <p style={{ fontSize: 12.5, color: "var(--ink2)" }}>{t("recordNote")}</p>
      </div>
    </aside>
  );
}

/** Installment (expected), recorded payment (confirmed), or refund. */
function PayDrawer({
  weddingId, mode, lines, onClose
}: {
  weddingId: string;
  mode: "installment" | "payment" | "refund";
  lines: { id: string; label: string }[];
  onClose: () => void;
}) {
  const t = useTranslations("budget.bar2.pay");
  const tc = useTranslations("common");
  const router = useRouter();
  const [lineId, setLineId] = useState("");
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("EUR");
  const [eur, setEur] = useState("");
  const [due, setDue] = useState("");
  const [method, setMethod] = useState("Bank transfer");
  const [reference, setReference] = useState("");
  const [pending, startTransition] = useTransition();
  const num = (s: string) => { const d = s.replace(/[^\d.]/g, ""); return d ? Number(d) : null; };

  return (
    <aside aria-label={t(`title_${mode}`)} style={drawerShell}>
      <p className="eyebrow" style={{ color: "var(--bronze)", margin: 0 }}>{t(`title_${mode}`)}</p>
      <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
        <select value={lineId} onChange={(e) => setLineId(e.target.value)} style={selectStyle} aria-label={t("line")}>
          <option value="">{t("noLine")}</option>
          {lines.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
        </select>
        <input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("labelPh")} style={field} />
        <div style={{ display: "flex", gap: 10 }}>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="8 000" inputMode="decimal" style={{ ...field, textAlign: "right" }} aria-label={t("amount")} />
          <select value={currency} onChange={(e) => setCurrency(e.target.value)} style={selectStyle} aria-label={t("currency")}>
            {["EUR", "USD", "GBP", "CHF"].map((c) => <option key={c}>{c}</option>)}
          </select>
          {currency !== "EUR" && (
            <input value={eur} onChange={(e) => setEur(e.target.value)} placeholder="≈ EUR" inputMode="decimal" style={{ ...field, textAlign: "right" }} />
          )}
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <label style={{ flex: 1, fontSize: 12, color: "var(--ink2)" }}>
            {mode === "installment" ? t("due") : t("settledOn")}
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)} style={field} />
          </label>
          <input value={method} onChange={(e) => setMethod(e.target.value)} placeholder={t("methodPh")} style={{ ...field, flex: 1, alignSelf: "end" }} />
        </div>
        {mode !== "installment" && (
          <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder={t("referencePh")} style={field} />
        )}
        <div style={{ display: "flex", gap: 10 }}>
          <button
            className="btn sm"
            disabled={pending || !label.trim() || !num(amount)}
            onClick={() =>
              startTransition(async () => {
                await addPayment({
                  weddingId,
                  budgetLineId: lineId || null,
                  label: label.trim(),
                  amount: num(amount)!,
                  currency,
                  amountEur: currency === "EUR" ? num(amount) : num(eur),
                  dueDate: due || null,
                  method,
                  payer: "",
                  refundable: false,
                  status: mode === "installment" ? "expected" : "confirmed",
                  kind: mode === "refund" ? "refund" : "payment",
                  reference
                });
                router.refresh();
                onClose();
              })
            }
          >
            {pending ? "…" : t("hold")}
          </button>
          <button className="btn ghost sm" onClick={onClose}>{tc("cancel")}</button>
        </div>
        <p style={{ fontSize: 12.5, color: "var(--ink2)" }}>{t(`note_${mode}`)}</p>
      </div>
    </aside>
  );
}

function NoteDrawer({ weddingId, onClose }: { weddingId: string; onClose: () => void }) {
  const t = useTranslations("budget.internal");
  const tc = useTranslations("common");
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();
  return (
    <aside aria-label={t("title")} style={drawerShell}>
      <p className="eyebrow" style={{ color: "var(--bronze)", margin: 0 }}>
        {t("title")} <span className="tag int">{t("neverVisible")}</span>
      </p>
      <textarea autoFocus value={body} onChange={(e) => setBody(e.target.value)} rows={5} placeholder={t("placeholder")} style={{ ...field, marginTop: 14, fontFamily: "inherit" }} />
      <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
        <button
          className="btn sm"
          disabled={pending || !body.trim()}
          onClick={() =>
            startTransition(async () => {
              await saveInternalBudgetNote(weddingId, body.trim());
              onClose();
            })
          }
        >
          {pending ? "…" : tc("save")}
        </button>
        <button className="btn ghost sm" onClick={onClose}>{tc("cancel")}</button>
      </div>
    </aside>
  );
}

/** Team: edit or compose (via Madame) an envelope's note, then publish. */
export function EnvelopeNoteEditor({
  envelopeId,
  weddingId,
  envelopeLabel,
  existing,
  status
}: {
  envelopeId: string;
  weddingId: string;
  envelopeLabel: string;
  existing: string | null;
  status: "draft" | "published" | null;
}) {
  const t = useTranslations("budget.notes");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState(existing ?? "");
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();

  async function compose() {
    setBusy(true);
    try {
      const r = await fetch("/api/agents/envelope-note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weddingId, envelopeLabel, indications: body })
      });
      const d = await r.json();
      if (d.text) setBody(d.text);
    } catch {
      /* leave as typed */
    }
    setBusy(false);
  }

  if (!open) {
    return (
      <button className="addnote team-only" style={{ marginLeft: 10 }} onClick={() => setOpen(true)}>
        {existing ? t("editNote") : t("addNote")}
        {status === "draft" && <span className="tag int" style={{ marginLeft: 6 }}>{tc("draft")}</span>}
      </button>
    );
  }

  return (
    <div className="team-only" style={{ flexBasis: "100%", margin: "10px 0" }}>
      <div style={{ marginBottom: 6 }}><Dictate title={t("letMadame")} onText={(x) => setBody((v) => (v ? v.trimEnd() + " " + x : x))} /></div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        style={{ width: "100%", padding: "10px 12px", border: "1px solid var(--champagne)", fontSize: 13.5 }}
        placeholder={t("placeholder")}
      />
      <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        <button className="btn ghost sm" onClick={compose} disabled={busy}>
          {busy ? "…" : t("letMadame")}
        </button>
        <button
          className="btn ghost sm"
          disabled={pending || !body.trim()}
          onClick={() =>
            startTransition(async () => {
              await saveEnvelopeNote(envelopeId, weddingId, body.trim());
              setOpen(false);
            })
          }
        >
          {t("saveDraft")}
        </button>
        <button
          className="btn sm"
          disabled={pending || !body.trim()}
          onClick={() =>
            startTransition(async () => {
              await saveEnvelopeNote(envelopeId, weddingId, body.trim());
              await publishEnvelopeNote(envelopeId);
              setOpen(false);
            })
          }
        >
          {t("publish")}
        </button>
        <button className="btn ghost sm" onClick={() => setOpen(false)}>
          {tc("cancel")}
        </button>
      </div>
    </div>
  );
}

/** "Add a line — via Madame", in the scope or the management view. */
export function MadameBudgetAdd({ weddingId }: { weddingId: string }) {
  const t = useTranslations("budget.madameAdd");
  const tc = useTranslations("common");
  const inputRef = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="ia team-only">
      <div className="eyebrow">
        {t("title")} <span className="tag int">{tc("internal")}</span>
      </div>
      <p style={{ marginTop: 8, fontSize: 13.5 }}>{t("blurb")}</p>
      <div className="assist">
        <Dictate title={t("go")} onText={(x) => { if (inputRef.current) inputRef.current.value += x; }} />
        <input ref={inputRef} placeholder={t("placeholder")} />
        <button
          className="btn"
          disabled={pending}
          onClick={() => {
            const instruction = inputRef.current?.value.trim();
            if (!instruction) return;
            startTransition(async () => {
              const r = await addLineViaMadame(weddingId, instruction);
              setNote(r.note ?? null);
              if (r.ok && inputRef.current) inputRef.current.value = "";
            });
          }}
        >
          {pending ? "…" : t("go")}
        </button>
      </div>
      {note && (
        <p className="ia-quote" style={{ marginTop: 12 }} aria-live="polite">
          &ldquo;{note}&rdquo; — <span style={{ fontStyle: "normal", fontSize: 12 }}>{t("draftNote")}</span>
        </p>
      )}
    </div>
  );
}

/** Draft bar — publish & notify the client in one word. */
export function PublishBar({ weddingId, draftCount }: { weddingId: string; draftCount: number }) {
  const t = useTranslations("budget");
  const tc = useTranslations("common");
  const [pending, startTransition] = useTransition();
  if (draftCount === 0) return null;
  return (
    <div className="draftbar team-only">
      <div>
        <span className="tag int">{t("draftBar")}</span>{" "}
        <span style={{ fontSize: 13, marginLeft: 8 }}>{t("draftCount", { count: draftCount })}</span>
      </div>
      <button className="btn" disabled={pending} onClick={() => startTransition(() => publishBudget(weddingId))}>
        {pending ? "…" : t("publishNotify")}
      </button>
      <span className="sr-only">{tc("draft")}</span>
    </div>
  );
}

/** The budget expert — clients ask, the house answers in Estelle's name. */
export function BudgetAsk({ weddingId }: { weddingId: string }) {
  const t = useTranslations("budget.ask");
  const inputRef = useRef<HTMLInputElement>(null);
  const [answer, setAnswer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function ask() {
    const q = inputRef.current?.value.trim();
    if (!q || busy) return;
    setBusy(true);
    try {
      const r = await fetch("/api/agents/budget-ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weddingId, prompt: q })
      });
      const d = await r.json();
      setAnswer(d.text ?? t("unreachable"));
    } catch {
      setAnswer(t("unreachable"));
    }
    setBusy(false);
  }

  return (
    <div className="team-only">
      {answer && (
        <div className="ia-quote" style={{ marginTop: 10 }}>
          <HouseProse text={answer} size={15} />
        </div>
      )}
      <div className="chat-in" style={{ border: "1px solid var(--line)", marginTop: 16, background: "#fff", alignItems: "center", paddingLeft: 8 }}>
        <Dictate title={t("ask")} onText={(x) => { if (inputRef.current) inputRef.current.value += x; }} />
        <input ref={inputRef} placeholder={t("placeholder")} onKeyDown={(e) => e.key === "Enter" && ask()} />
        <button className="btn" style={{ borderRadius: 0 }} onClick={ask} disabled={busy}>
          {busy ? "…" : t("ask")}
        </button>
      </div>
    </div>
  );
}

/** The budget reads documents too — right where the analysis lives.
    The vendor may be named before the drop (§9), and the same paper
    is never filed twice: its fingerprint is checked first. */
export function BudgetDocDrop({
  weddingId,
  vendors = []
}: {
  weddingId: string;
  vendors?: { id: string; name: string }[];
}) {
  const t = useTranslations("budget.docs");
  const router = useRouter();
  const [summary, setSummary] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [vendorId, setVendorId] = useState("");
  const [dup, setDup] = useState<{ file: File; label: string } | null>(null);

  async function handle(file: File, force = false) {
    if (busy) return;
    setBusy(true);
    setSummary(null);
    setDup(null);
    try {
      const form = new FormData();
      form.append("weddingId", weddingId);
      form.append("file", file);
      if (vendorId) form.append("vendorId", vendorId);
      if (force) form.append("force", "1");
      try {
        const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
        form.append("sha256", [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join(""));
      } catch {
        // No fingerprint — the reading proceeds without the check.
      }
      const r = await fetch("/api/agents/document", { method: "POST", body: form });
      const d = await r.json();
      if (d.duplicate) {
        setDup({ file, label: d.label ?? file.name });
        setBusy(false);
        return;
      }
      setSummary(d.text ?? t("failed"));
      // The line-by-line and the totals follow at once.
      router.refresh();
    } catch {
      setSummary(t("failed"));
    }
    setBusy(false);
  }

  return (
    <>
      <label
        className="btn ghost"
        style={{
          cursor: "pointer",
          marginTop: 12,
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          borderStyle: over ? "solid" : undefined,
          background: over ? "var(--parchment)" : undefined
        }}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) void handle(f);
        }}
      >
        {busy ? "…" : t("choose")}
        <input
          type="file"
          hidden
          accept=".pdf,.png,.jpg,.jpeg"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handle(f);
            e.target.value = "";
          }}
        />
      </label>
      {vendors.length > 0 && (
        <label style={{ display: "inline-flex", gap: 8, alignItems: "baseline", marginLeft: 12, fontSize: 12.5, color: "var(--ink2)" }}>
          {t("forVendor")}
          <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} style={{ padding: "6px 8px", border: "1px solid var(--line)", background: "#fff", fontSize: 12.5 }}>
            <option value="">{t("vendorAuto")}</option>
            {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </label>
      )}
      {dup && (
        <p className="ia-quote" style={{ marginTop: 12 }} role="alert">
          {t("duplicate", { label: dup.label })}{" "}
          <button className="addnote" onClick={() => void handle(dup.file, true)}>{t("readAnyway")}</button>{" "}
          <button className="addnote" onClick={() => setDup(null)}>{t("neverMind")}</button>
        </p>
      )}
      {summary && (
        <p className="ia-quote" style={{ marginTop: 12 }} aria-live="polite">
          {summary}
        </p>
      )}
    </>
  );
}

/** Behind the analysis — Estelle's notes, consulted but never revealed. */
export function InternalNotes({ weddingId, latest }: { weddingId: string; latest: string | null }) {
  const t = useTranslations("budget.internal");
  const tc = useTranslations("common");
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();

  return (
    <div className="ia team-only" style={{ marginTop: 14 }}>
      <div className="eyebrow">
        {t("title")} <span className="tag int">{t("neverVisible")}</span>
      </div>
      <p style={{ marginTop: 8, fontSize: 13.5 }}>{t("blurb")}</p>
      {latest && (
        <p style={{ marginTop: 10, fontSize: 13, color: "var(--ink2)" }}>
          {t("latest")}: {latest}
        </p>
      )}
      <div className="assist">
        <Dictate title={t("title")} onText={(x) => setBody((v) => (v ? v.trimEnd() + " " + x : x))} />
        <input
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={t("placeholder")}
        />
        <button
          className="btn ghost"
          disabled={pending || !body.trim()}
          onClick={() =>
            startTransition(async () => {
              await saveInternalBudgetNote(weddingId, body.trim());
              setBody("");
            })
          }
        >
          {tc("save")}
        </button>
      </div>
    </div>
  );
}

/**
 * The line-by-line, in the team's hands: press a line to rework every
 * figure, remove it, or open a new one by hand. Clients see the same
 * table, published lines only, untouchable.
 */

/* ══════════ The analysis, under Estelle's word (0022) ══════════ */

/**
 * The house's analysis is Estelle's text: the agent proposes a draft,
 * she reworks it with her layout (bold, italics, lists — pasted text
 * welcome), publishes it herself, or removes it. Rendered prose,
 * never raw asterisks in front of a couple.
 */
export function AnalysisDesk({
  weddingId,
  text,
  status
}: {
  weddingId: string;
  text: string | null;
  status: "draft" | "published";
}) {
  const t = useTranslations("budget.analysis");
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text ?? "");
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const [pending, startTransition] = useTransition();

  const wrap = (before: string, after = before) => {
    const el = areaRef.current;
    if (!el) return;
    const { selectionStart: a, selectionEnd: b, value } = el;
    const sel = value.slice(a, b) || t("toolbarPlaceholder");
    const next = value.slice(0, a) + before + sel + after + value.slice(b);
    setDraft(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(a + before.length, a + before.length + sel.length);
    });
  };
  const prefixLines = () => {
    const el = areaRef.current;
    if (!el) return;
    const { selectionStart: a, selectionEnd: b, value } = el;
    const start = value.lastIndexOf("\n", a - 1) + 1;
    const block = value.slice(start, b);
    const next = value.slice(0, start) + block.split("\n").map((l) => (l.trim() ? `- ${l.replace(/^- /, "")}` : l)).join("\n") + value.slice(b);
    setDraft(next);
    el.focus();
  };

  const save = (publish: boolean) =>
    startTransition(async () => {
      await saveBudgetAnalysis(weddingId, draft, publish);
      setEditing(false);
      router.refresh();
    });

  if (!editing) {
    return (
      <div>
        {text ? (
          <>
            <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap", margin: "6px 0" }}>
              {status === "draft" ? (
                <span className="tag int">{t("tagDraft")}</span>
              ) : (
                <span className="tag ok">{t("tagPublished")}</span>
              )}
            </div>
            <HouseProse text={text} size={16} />
          </>
        ) : (
          <p style={{ fontSize: 13.5, color: "var(--ink2)", margin: "8px 0" }}>{t("empty")}</p>
        )}
        <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
          <button className="addnote" onClick={() => { setDraft(text ?? ""); setEditing(true); }}>
            {text ? t("edit") : t("write")}
          </button>
          {text && status === "draft" && (
            <button className="addnote" disabled={pending} onClick={() => save(true)}>
              {t("publish")}
            </button>
          )}
          {text && (
            <button
              className="addnote"
              style={{ color: "var(--bronze)" }}
              disabled={pending}
              onClick={() => {
                if (!window.confirm(t("removeConfirm"))) return;
                startTransition(async () => {
                  await removeBudgetAnalysis(weddingId);
                  router.refresh();
                });
              }}
            >
              {t("remove")}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 8, margin: "8px 0 6px" }} role="toolbar" aria-label={t("toolbar")}>
        <button className="addnote" onClick={() => wrap("**")} title={t("bold")} style={{ fontWeight: 600 }}>B</button>
        <button className="addnote" onClick={() => wrap("*")} title={t("italic")} style={{ fontStyle: "italic" }}>I</button>
        <button className="addnote" onClick={prefixLines} title={t("list")}>• —</button>
      </div>
      <textarea
        ref={areaRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={9}
        style={{ width: "100%", padding: "12px 14px", border: "1px solid var(--champagne)", fontSize: 14, lineHeight: 1.6, fontFamily: "inherit" }}
        aria-label={t("edit")}
      />
      {draft.trim() && (
        <div style={{ marginTop: 10, padding: "12px 16px", background: "var(--parchment)", border: "1px solid var(--line-soft, rgba(201,178,145,.22))" }}>
          <div className="eyebrow" style={{ marginBottom: 6 }}>{t("previewTitle")}</div>
          <HouseProse text={draft} size={15.5} />
        </div>
      )}
      <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
        <button className="btn sm" disabled={pending} onClick={() => save(true)}>{pending ? "…" : t("publish")}</button>
        <button className="btn ghost sm" disabled={pending} onClick={() => save(false)}>{t("saveDraft")}</button>
        <button className="btn ghost sm" onClick={() => setEditing(false)}>{t("cancel")}</button>
      </div>
    </div>
  );
}
