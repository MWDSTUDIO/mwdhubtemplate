"use client";

import React, { type ReactNode, useRef, useState, useTransition } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import type { BudgetLine } from "@/lib/types";
import {
  addBudgetLine,
  addLineViaMadame,
  deleteBudgetLine,
  publishBudget,
  saveEnvelopeNote,
  publishEnvelopeNote,
  saveInternalBudgetNote,
  updateBudgetLine
} from "@/app/actions/budget";
import { Dictate } from "@/components/Dictate";

export function BudgetTabs({ scope, mgmt }: { scope: ReactNode; mgmt: ReactNode }) {
  const t = useTranslations("budget");
  const [tab, setTab] = useState<"scope" | "mgmt">("scope");
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
    <>
      {answer && (
        <p className="ia-quote" style={{ marginTop: 14 }} aria-live="polite">
          &ldquo;{answer}&rdquo;
        </p>
      )}
      <div className="chat-in" style={{ border: "1px solid var(--line)", marginTop: 16, background: "#fff", alignItems: "center", paddingLeft: 8 }}>
        <Dictate title={t("ask")} onText={(x) => { if (inputRef.current) inputRef.current.value += x; }} />
        <input ref={inputRef} placeholder={t("placeholder")} onKeyDown={(e) => e.key === "Enter" && ask()} />
        <button className="btn" style={{ borderRadius: 0 }} onClick={ask} disabled={busy}>
          {busy ? "…" : t("ask")}
        </button>
      </div>
    </>
  );
}

/** The budget reads documents too — right where the analysis lives. */
export function BudgetDocDrop({ weddingId }: { weddingId: string }) {
  const t = useTranslations("budget.docs");
  const router = useRouter();
  const [summary, setSummary] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);

  async function handle(file: File) {
    if (busy) return;
    setBusy(true);
    setSummary(null);
    try {
      const form = new FormData();
      form.append("weddingId", weddingId);
      form.append("file", file);
      const r = await fetch("/api/agents/document", { method: "POST", body: form });
      const d = await r.json();
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
export function LinesTable({
  lines,
  weddingId,
  isTeam,
  nextByLine
}: {
  lines: BudgetLine[];
  weddingId: string;
  isTeam: boolean;
  nextByLine: Record<string, string>;
}) {
  const t = useTranslations("budget.mgmt");
  const tl = useTranslations("budget.lines");
  const tc = useTranslations("common");
  const format = useFormatter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addingOpen, setAddingOpen] = useState(false);

  const money = (n: number | null | undefined) =>
    n == null ? "—" : format.number(n, { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 14, flexWrap: "wrap", marginBottom: 14 }}>
        <div className="eyebrow">{t("lineByLine")}</div>
        {isTeam && (
          <button className="addnote team-only" onClick={() => setAddingOpen((v) => !v)}>
            {addingOpen ? tc("cancel") : tl("addLine")}
          </button>
        )}
      </div>
      {addingOpen && isTeam && (
        <AddLineRow
          weddingId={weddingId}
          onDone={() => setAddingOpen(false)}
        />
      )}
      <div style={{ overflowX: "auto" }}>
        <table className="sheet-table">
          <thead>
            <tr>
              <th>{t("line")}</th>
              <th>{t("budgeted")}</th>
              <th>{t("committed")}</th>
              <th>{t("paidCol")}</th>
              <th>{t("remainingCol")}</th>
              <th>{t("nextPayment")}</th>
              {isTeam && <th className="team-only" aria-label={tl("edit")} />}
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <React.Fragment key={line.id}>
                <tr>
                  <td>
                    {line.label}
                    {line.status === "draft" && (
                      <span className="tag int" style={{ marginLeft: 8 }}>{tc("draft")}</span>
                    )}
                  </td>
                  <td className="num">{money(line.budgeted)}</td>
                  <td className="num">{line.committed != null ? money(line.committed) : line.committed_note ?? "—"}</td>
                  <td className="num">{line.paid ? money(line.paid) : "—"}</td>
                  <td className="num">
                    {line.committed != null ? money(line.committed - line.paid) : "—"}
                  </td>
                  <td>{line.next_payment_label ?? nextByLine[line.id] ?? "—"}</td>
                  {isTeam && (
                    <td className="team-only">
                      <button
                        className="addnote"
                        onClick={() => setEditingId(editingId === line.id ? null : line.id)}
                      >
                        {editingId === line.id ? tc("close") : tl("edit")}
                      </button>
                    </td>
                  )}
                </tr>
                {editingId === line.id && (
                  <tr className="team-only">
                    <td colSpan={7} style={{ background: "var(--parchment)" }}>
                      <LineEditor line={line} onClose={() => setEditingId(null)} />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {isTeam && (
        <p className="team-only" style={{ fontSize: 11.5, color: "var(--ink2)", marginTop: 10 }}>{tl("hint")}</p>
      )}
    </div>
  );
}

const toNum = (s: string): number | null => {
  const digits = s.replace(/[^\d]/g, "");
  return digits ? Number(digits) : null;
};

function LineEditor({ line, onClose }: { line: BudgetLine; onClose: () => void }) {
  const tl = useTranslations("budget.lines");
  const tc = useTranslations("common");
  const [label, setLabel] = useState(line.label);
  const [budgeted, setBudgeted] = useState(line.budgeted?.toString() ?? "");
  const [committed, setCommitted] = useState(line.committed?.toString() ?? "");
  const [paid, setPaid] = useState(line.paid ? String(line.paid) : "");
  const [next, setNext] = useState(line.next_payment_label ?? "");
  const [pending, startTransition] = useTransition();

  const field = (labelKey: string, value: string, set: (v: string) => void, ph?: string) => (
    <div className="field" style={{ minWidth: 130, flex: 1 }}>
      <label className="eyebrow">{tl(labelKey)}</label>
      <input value={value} onChange={(e) => set(e.target.value)} placeholder={ph} />
    </div>
  );

  return (
    <div style={{ padding: "12px 6px" }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <div className="field" style={{ flex: 2, minWidth: 180 }}>
          <label className="eyebrow">{tl("label")}</label>
          <input value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
        {field("budgeted", budgeted, setBudgeted, "12 000")}
        {field("committed", committed, setCommitted, "12 500")}
        {field("paid", paid, setPaid, "4 000")}
        <div className="field" style={{ flex: 2, minWidth: 200 }}>
          <label className="eyebrow">{tl("nextPayment")}</label>
          <input value={next} onChange={(e) => setNext(e.target.value)} placeholder={tl("nextPh")} />
        </div>
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
        <button
          className="btn sm"
          disabled={pending || !label.trim()}
          onClick={() =>
            startTransition(async () => {
              await updateBudgetLine({
                id: line.id,
                label,
                budgeted: toNum(budgeted),
                committed: toNum(committed),
                paid: toNum(paid) ?? 0,
                nextPaymentLabel: next
              });
              onClose();
            })
          }
        >
          {pending ? "…" : tc("save")}
        </button>
        <button
          className="btn ghost sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              await deleteBudgetLine(line.id);
              onClose();
            })
          }
        >
          {tl("remove")}
        </button>
        <button className="btn ghost sm" onClick={onClose}>{tc("cancel")}</button>
      </div>
    </div>
  );
}

function AddLineRow({ weddingId, onDone }: { weddingId: string; onDone: () => void }) {
  const tl = useTranslations("budget.lines");
  const [label, setLabel] = useState("");
  const [budgeted, setBudgeted] = useState("");
  const [pending, startTransition] = useTransition();
  return (
    <div className="assist team-only" style={{ marginBottom: 14 }}>
      <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={tl("labelPh")} />
      <input
        value={budgeted}
        onChange={(e) => setBudgeted(e.target.value)}
        placeholder={tl("budgetedPh")}
        style={{ flex: "0 1 160px", minWidth: 120 }}
      />
      <button
        className="btn ghost"
        disabled={pending || !label.trim()}
        onClick={() =>
          startTransition(async () => {
            await addBudgetLine(weddingId, label, toNum(budgeted));
            setLabel("");
            setBudgeted("");
            onDone();
          })
        }
      >
        {pending ? "…" : tl("open")}
      </button>
    </div>
  );
}
