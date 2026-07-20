"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { adoptDefaultProcess, deleteProcessStep, saveProcessStep } from "@/app/actions/process";
import { Dictate } from "@/components/Dictate";

export interface ProcessStep {
  id: string;
  sort: number;
  title: string;
  body: string | null;
}

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

/**
 * The method, per wedding. The house's four acts stand until the team
 * gives this wedding movements of its own — then every act can be
 * reworded, added or removed, because no two weddings are alike.
 */
export function ProcessEditor({
  weddingId,
  steps,
  defaults,
  isTeam
}: {
  weddingId: string;
  steps: ProcessStep[];
  defaults: { title: string; body: string }[];
  isTeam: boolean;
}) {
  const t = useTranslations("process.editor");
  const [editing, setEditing] = useState<ProcessStep | "new" | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const shown: (ProcessStep | { id: null; sort: number; title: string; body: string })[] =
    steps.length > 0
      ? steps
      : defaults.map((d, i) => ({ id: null, sort: i + 1, title: d.title, body: d.body }));

  return (
    <>
      {shown.map((step, i) => (
        <div className="phase" key={step.id ?? i}>
          <div className="n serif">{ROMAN[i] ?? String(i + 1)}</div>
          <div style={{ flex: 1 }}>
            <strong>{step.title}</strong>
            <br />
            {step.body}
            {isTeam && step.id && (
              <div className="team-only" style={{ marginTop: 6 }}>
                <button className="addnote" onClick={() => setEditing(step as ProcessStep)}>
                  {t("edit")}
                </button>
              </div>
            )}
          </div>
        </div>
      ))}

      {isTeam && (
        <div className="team-only" style={{ marginTop: 22, display: "flex", gap: 10, flexWrap: "wrap" }}>
          {steps.length === 0 ? (
            <button
              className="btn ghost"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const r = await adoptDefaultProcess(weddingId, defaults);
                  if (!r.ok) setFailed(true);
                  else router.refresh();
                })
              }
            >
              {pending ? "…" : t("personalise")}
            </button>
          ) : (
            <button className="btn ghost" onClick={() => setEditing("new")}>
              {t("add")}
            </button>
          )}
        </div>
      )}
      {failed && (
        <p role="alert" style={{ marginTop: 10, fontSize: 13, color: "var(--bronze)" }}>
          {t("failed")}
        </p>
      )}

      {editing !== null && (
        <StepForm
          weddingId={weddingId}
          step={editing === "new" ? null : editing}
          nextSort={steps.length + 1}
          onClose={() => setEditing(null)}
          onFailed={() => setFailed(true)}
        />
      )}
    </>
  );
}

function StepForm({
  weddingId,
  step,
  nextSort,
  onClose,
  onFailed
}: {
  weddingId: string;
  step: ProcessStep | null;
  nextSort: number;
  onClose: () => void;
  onFailed: () => void;
}) {
  const t = useTranslations("process.editor");
  const [title, setTitle] = useState(step?.title ?? "");
  const [body, setBody] = useState(step?.body ?? "");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <div className="card team-only" style={{ marginTop: 16, borderColor: "var(--champagne)" }}>
      <div className="eyebrow" style={{ marginBottom: 12 }}>
        {step ? t("editTitle") : t("addTitle")}
      </div>
      <div style={{ display: "grid", gap: 10 }}>
        <div className="field">
          <label className="eyebrow">{t("stepTitle")}</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("titlePlaceholder")} />
        </div>
        <div className="field">
          <label className="eyebrow" style={{ display: "flex", alignItems: "center", gap: 8 }}>{t("stepBody")}<Dictate title={t("stepBody")} onText={(x) => setBody((v) => (v ? v.trimEnd() + " " + x : x))} /></label>
          <textarea rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder={t("bodyPlaceholder")} />
        </div>
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
        <button
          className="btn"
          disabled={pending || !title.trim()}
          onClick={() =>
            startTransition(async () => {
              const r = await saveProcessStep({
                id: step?.id,
                weddingId,
                title,
                body,
                sort: step?.sort ?? nextSort
              });
              if (r.ok) {
                router.refresh();
                onClose();
              } else {
                onFailed();
                onClose();
              }
            })
          }
        >
          {pending ? "…" : t("save")}
        </button>
        {step && (
          <button
            className="btn ghost"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await deleteProcessStep(step.id);
                router.refresh();
                onClose();
              })
            }
          >
            {t("remove")}
          </button>
        )}
        <button className="btn ghost" onClick={onClose}>{t("cancel")}</button>
      </div>
    </div>
  );
}
