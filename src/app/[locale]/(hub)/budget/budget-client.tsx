"use client";

import React, { type ReactNode, useRef, useState, useTransition } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import type { BudgetLine } from "@/lib/types";
import {
  addLineViaMadame,
  publishBudget,
  saveEnvelopeNote,
  publishEnvelopeNote,
  saveInternalBudgetNote,
  updateBudgetLine,
  removeBudgetAnalysis,
  saveBudgetAnalysis
} from "@/app/actions/budget";
import { HouseProse } from "@/lib/house-prose";
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
