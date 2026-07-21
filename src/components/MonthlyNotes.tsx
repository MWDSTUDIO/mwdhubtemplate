"use client";

import { useState, useTransition } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import type { MonthlyNote } from "@/lib/types";
import { removePreview, saveMonthlyComposition, savePreview } from "@/app/actions/timeline";
import { Dictate } from "@/components/Dictate";

/**
 * "This month at the house" — Estelle gives raw subjects, the agent
 * composes an elegant note in the house's voice; draft until her word,
 * with previews of the coming months.
 */
export function MonthlyNotes({
  weddingId,
  current,
  previews,
  isTeam
}: {
  weddingId: string;
  current: MonthlyNote | null;
  previews: MonthlyNote[];
  isTeam: boolean;
}) {
  const t = useTranslations("timeline.monthly");
  const tc = useTranslations("common");
  const format = useFormatter();
  const [subjects, setSubjects] = useState("");
  const [draft, setDraft] = useState<string | null>(null);
  const [draftPreviews, setDraftPreviews] = useState<{ month: string; text: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  // The card writes for the month we are living, previews follow it.
  const now = new Date();
  const nowKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  async function compose() {
    const s = subjects.trim();
    if (!s || busy) return;
    setBusy(true);
    try {
      const r = await fetch("/api/agents/monthly-note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weddingId, subjects: s, month: nowKey })
      });
      const d = await r.json();
      if (d.text) {
        setDraft(d.text);
        setDraftPreviews(Array.isArray(d.previews) ? d.previews : []);
      }
    } catch {
      setDraft(null);
    }
    setBusy(false);
  }

  const keep = (publish: boolean) =>
    startTransition(async () => {
      await saveMonthlyComposition({
        weddingId,
        month: nowKey,
        subjects,
        composed: draft ?? "",
        previews: draftPreviews,
        publish
      });
      setDraft(null);
      setDraftPreviews([]);
      setSubjects("");
      router.refresh();
    });

  const monthName = (iso: string) =>
    format.dateTime(new Date(iso), { month: "long" });

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
        <div className="eyebrow">
          {current
            ? t("title", { month: monthName(current.month) })
            : t("titleBare")}
        </div>
        {current?.status === "published" && <span className="tag ok">{tc("published")}</span>}
      </div>
      {current?.composed_text && (
        <p
          className="serif"
          style={{ fontSize: 19, fontStyle: "italic", lineHeight: 1.55, marginTop: 12 }}
        >
          &ldquo;{current.composed_text}&rdquo;
        </p>
      )}
      {previews.length > 0 && (
        <div className="grid3" style={{ marginTop: 16 }}>
          {previews.map((p) =>
            isTeam ? (
              <PreviewCard key={p.id} weddingId={weddingId} note={p} monthLabel={monthName(p.month)} />
            ) : (
              <div key={p.id} style={{ border: "1px solid var(--line)", padding: "14px 16px" }}>
                <div className="eyebrow">{monthName(p.month)}</div>
                <p style={{ fontSize: 12.5, marginTop: 6, color: "var(--ink2)" }}>{p.preview_text}</p>
              </div>
            )
          )}
        </div>
      )}

      {isTeam && (
        <div className="team-only" style={{ marginTop: 16 }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>
            {t("composeNext")} <span className="tag int">{tc("internal")}</span>
          </div>
          <div className="assist">
            <Dictate title={t("letAgentWrite")} onText={(x) => setSubjects((v) => (v ? v.trimEnd() + " " + x : x))} />
            <input
              value={subjects}
              onChange={(e) => setSubjects(e.target.value)}
              placeholder={t("subjectsPlaceholder")}
              onKeyDown={(e) => e.key === "Enter" && compose()}
            />
            <button className="btn" onClick={compose} disabled={busy}>
              {busy ? "…" : t("letAgentWrite")}
            </button>
          </div>
          {draft && (
            <>
              <p className="ia-quote" style={{ marginTop: 12 }} aria-live="polite">
                &ldquo;{draft}&rdquo;
              </p>
              {draftPreviews.length > 0 && (
                <div className="grid3" style={{ marginTop: 12 }}>
                  {draftPreviews.map((p, i) => (
                    <div key={p.month} style={{ border: "1px solid var(--line)", padding: "12px 14px", background: "var(--parchment)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                        <div className="eyebrow">{monthName(`${p.month}-01`)}</div>
                        <button
                          className="addnote"
                          aria-label={t("dropPreview", { month: monthName(`${p.month}-01`) })}
                          onClick={() => setDraftPreviews((list) => list.filter((_, j) => j !== i))}
                        >
                          ×
                        </button>
                      </div>
                      <textarea
                        rows={2}
                        value={p.text}
                        aria-label={monthName(`${p.month}-01`)}
                        onChange={(e) =>
                          setDraftPreviews((list) =>
                            list.map((x, j) => (j === i ? { ...x, text: e.target.value } : x))
                          )
                        }
                        style={{ width: "100%", marginTop: 6, fontSize: 12.5, padding: "6px 8px", border: "1px solid var(--line)", background: "#fff" }}
                      />
                    </div>
                  ))}
                </div>
              )}
              <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
                <button className="btn ghost sm" disabled={pending} onClick={() => keep(false)}>
                  {t("keepDraft")}
                </button>
                <button className="btn sm" disabled={pending} onClick={() => keep(true)}>
                  {t("publish")}
                </button>
              </div>
            </>
          )}
          <p style={{ fontSize: 12, color: "var(--ink2)", marginTop: 8 }}>{t("hint")}</p>
        </div>
      )}
    </div>
  );
}

/**
 * One preview, in the team's hand after the fact: rewrite it, keep it
 * as draft, publish it alone, or withdraw it — month by month.
 */
function PreviewCard({
  weddingId,
  note,
  monthLabel
}: {
  weddingId: string;
  note: MonthlyNote;
  monthLabel: string;
}) {
  const t = useTranslations("timeline.monthly");
  const tc = useTranslations("common");
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(note.preview_text ?? "");
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const monthKey = note.month.slice(0, 7);

  const act = (fn: () => Promise<unknown>) =>
    startTransition(async () => {
      await fn();
      setEditing(false);
      router.refresh();
    });

  return (
    <div style={{ border: "1px solid var(--line)", padding: "14px 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <div className="eyebrow">{monthLabel}</div>
        {note.status === "draft" && <span className="tag int">{tc("draft")}</span>}
      </div>
      {editing ? (
        <textarea
          rows={2}
          value={text}
          aria-label={monthLabel}
          onChange={(e) => setText(e.target.value)}
          style={{ width: "100%", marginTop: 6, fontSize: 12.5, padding: "6px 8px", border: "1px solid var(--champagne)" }}
        />
      ) : (
        <p style={{ fontSize: 12.5, marginTop: 6, color: "var(--ink2)" }}>{note.preview_text}</p>
      )}
      <div className="team-only" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
        {editing ? (
          <>
            <button
              className="addnote"
              disabled={pending || !text.trim()}
              onClick={() => act(() => savePreview({ weddingId, month: monthKey, text, publish: false }))}
            >
              {t("keepDraft")}
            </button>
            <button
              className="addnote"
              disabled={pending || !text.trim()}
              onClick={() => act(() => savePreview({ weddingId, month: monthKey, text, publish: true }))}
            >
              {t("publish")}
            </button>
            <button className="addnote" onClick={() => setEditing(false)}>{tc("cancel")}</button>
          </>
        ) : (
          <>
            <button className="addnote" onClick={() => setEditing(true)}>{tc("edit")}</button>
            {note.status === "draft" ? (
              <button
                className="addnote"
                disabled={pending}
                onClick={() => act(() => savePreview({ weddingId, month: monthKey, text: note.preview_text ?? "", publish: true }))}
              >
                {t("publish")}
              </button>
            ) : (
              <button
                className="addnote"
                disabled={pending}
                onClick={() => act(() => savePreview({ weddingId, month: monthKey, text: note.preview_text ?? "", publish: false }))}
              >
                {t("unpublish")}
              </button>
            )}
            <button
              className="addnote"
              disabled={pending}
              onClick={() => act(() => removePreview(weddingId, monthKey))}
            >
              {t("withdraw")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
