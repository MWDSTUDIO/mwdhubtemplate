"use client";

import { useState, useTransition } from "react";
import { useFormatter, useTranslations } from "next-intl";
import type { Milestone } from "@/lib/types";
import { saveMilestone, deleteMilestone, publishTimeline } from "@/app/actions/timeline";
import { Dictate } from "@/components/Dictate";

/**
 * The frise — month by month. For the team it is correctable in place:
 * click a milestone to edit (text, month, done, remove) or instruct
 * Madame. Corrections stay draft until published; the client's frise
 * never moves before Estelle's word.
 */
export function Frise({
  milestones,
  weddingId,
  isTeam
}: {
  milestones: Milestone[];
  weddingId: string;
  isTeam: boolean;
}) {
  const t = useTranslations("timeline.frise");
  const tc = useTranslations("common");
  const format = useFormatter();
  const [editing, setEditing] = useState<Milestone | "new" | null>(null);
  const [instruct, setInstruct] = useState("");
  const [agentNote, setAgentNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  const hasDrafts = milestones.some((m) => m.status === "draft");

  async function letMadameCorrect() {
    const order = instruct.trim();
    if (!order || busy) return;
    setBusy(true);
    setAgentNote(null);
    try {
      const r = await fetch("/api/agents/timeline-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weddingId, instruction: order })
      });
      const d = await r.json();
      setAgentNote(d.text ?? t("agentFailed"));
      setInstruct("");
      startTransition(() => {});
    } catch {
      setAgentNote(t("agentFailed"));
    }
    setBusy(false);
  }

  return (
    <div className="card" style={{ padding: "10px 28px" }}>
      <div className="frise">
        <div className="frise-line" />
        <div className="frise-in">
          {milestones.map((m) => (
            <div key={m.id} className={`mo${m.done ? " done" : ""}`}>
              <span className="m">
                {format.dateTime(new Date(m.month), { month: "short", year: "2-digit" })}
                {isTeam && m.status === "draft" && (
                  <span className="tag int" style={{ marginLeft: 6 }}>{tc("draft")}</span>
                )}
              </span>
              {isTeam ? (
                <button className="edit" onClick={() => setEditing(m)}>
                  <p>{m.label}</p>
                </button>
              ) : (
                <p>{m.label}</p>
              )}
            </div>
          ))}
        </div>
      </div>

      {isTeam && (
        <div className="team-only" style={{ padding: "0 0 18px" }}>
          <hr className="hair" style={{ margin: "8px 0 16px" }} />
          <div className="eyebrow" style={{ marginBottom: 8 }}>
            {t("correct")} <span className="tag int">{tc("internal")}</span>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            <button className="btn ghost sm" onClick={() => setEditing("new")}>
              {t("add")}
            </button>
            {hasDrafts && (
              <button
                className="btn sm"
                onClick={() => startTransition(() => publishTimeline(weddingId))}
              >
                {t("publish")}
              </button>
            )}
          </div>
          <div className="assist" style={{ marginTop: 0 }}>
            <Dictate title={t("letMadame")} onText={(x) => setInstruct((v) => (v ? v.trimEnd() + " " + x : x))} />
            <input
              value={instruct}
              onChange={(e) => setInstruct(e.target.value)}
              placeholder={t("instructPlaceholder")}
              onKeyDown={(e) => e.key === "Enter" && letMadameCorrect()}
            />
            <button className="btn" onClick={letMadameCorrect} disabled={busy}>
              {busy ? "…" : t("letMadame")}
            </button>
          </div>
          {agentNote && (
            <p className="ia-quote" style={{ marginTop: 10 }} aria-live="polite">
              {agentNote}
            </p>
          )}
          <p style={{ fontSize: 12, color: "var(--ink2)", marginTop: 8 }}>{t("hint")}</p>
        </div>
      )}

      {editing && (
        <MilestoneDialog
          milestone={editing === "new" ? null : editing}
          weddingId={weddingId}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function MilestoneDialog({
  milestone,
  weddingId,
  onClose
}: {
  milestone: Milestone | null;
  weddingId: string;
  onClose: () => void;
}) {
  const t = useTranslations("timeline.frise");
  const [label, setLabel] = useState(milestone?.label ?? "");
  const [month, setMonth] = useState(milestone?.month?.slice(0, 7) ?? "");
  const [done, setDone] = useState(milestone?.done ?? false);
  const [pending, startTransition] = useTransition();

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "oklch(0.3178 0.0365 157.6 / 0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: "var(--z-gate)"
      }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{ width: 420, maxWidth: "92vw", marginBottom: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="eyebrow" style={{ marginBottom: 14 }}>
          {milestone ? t("editTitle") : t("add")}
        </div>
        <div className="field" style={{ marginBottom: 12 }}>
          <label className="eyebrow">{t("labelField")}</label>
          <input value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
        <div className="field" style={{ marginBottom: 12 }}>
          <label className="eyebrow">{t("monthField")}</label>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </div>
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
          <input
            type="checkbox"
            checked={done}
            onChange={(e) => setDone(e.target.checked)}
            style={{ width: "auto" }}
          />
          {t("doneField")}
        </label>
        <div style={{ display: "flex", gap: 10, marginTop: 18, flexWrap: "wrap" }}>
          <button
            className="btn"
            disabled={pending || !label || !month}
            onClick={() =>
              startTransition(async () => {
                await saveMilestone({ id: milestone?.id, weddingId, month, label, done });
                onClose();
              })
            }
          >
            {t("saveDraft")}
          </button>
          {milestone && (
            <button
              className="btn ghost"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await deleteMilestone(milestone.id);
                  onClose();
                })
              }
            >
              {t("remove")}
            </button>
          )}
          <button className="btn ghost" onClick={onClose}>
            {t("cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
