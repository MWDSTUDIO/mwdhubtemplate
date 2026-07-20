"use client";

import { useState, useTransition } from "react";
import { useFormatter, useTranslations } from "next-intl";
import type { MonthlyNote } from "@/lib/types";
import { saveMonthlyNoteDraft, publishMonthlyNote } from "@/app/actions/timeline";

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
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();

  const now = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const nextKey = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, "0")}`;

  async function compose() {
    const s = subjects.trim();
    if (!s || busy) return;
    setBusy(true);
    try {
      const r = await fetch("/api/agents/monthly-note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weddingId, subjects: s })
      });
      const d = await r.json();
      if (d.text) setDraft(d.text);
    } catch {
      setDraft(null);
    }
    setBusy(false);
  }

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
          {previews.map((p) => (
            <div key={p.id} style={{ border: "1px solid var(--line)", padding: "14px 16px" }}>
              <div className="eyebrow">{monthName(p.month)}</div>
              <p style={{ fontSize: 12.5, marginTop: 6, color: "var(--ink2)" }}>{p.preview_text}</p>
            </div>
          ))}
        </div>
      )}

      {isTeam && (
        <div className="team-only" style={{ marginTop: 16 }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>
            {t("composeNext")} <span className="tag int">{tc("internal")}</span>
          </div>
          <div className="assist">
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
              <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
                <button
                  className="btn ghost sm"
                  disabled={pending}
                  onClick={() =>
                    startTransition(() =>
                      saveMonthlyNoteDraft({ weddingId, month: nextKey, subjects, composed: draft })
                    )
                  }
                >
                  {t("keepDraft")}
                </button>
                <button
                  className="btn sm"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      await saveMonthlyNoteDraft({ weddingId, month: nextKey, subjects, composed: draft });
                      await publishMonthlyNote(weddingId, nextKey);
                      setDraft(null);
                      setSubjects("");
                    })
                  }
                >
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
