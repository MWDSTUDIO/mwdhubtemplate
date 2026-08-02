"use client";

import { useMemo, useState, useTransition } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import type { BudgetEnvelope, BudgetScenario, EnvelopeNote } from "@/lib/types";
import type { EnvelopeDraft } from "@/lib/templates";
import {
  adoptHouseEnvelopes,
  publishScopeAnalysis,
  refineEnvelopeNote,
  saveEnvelopeNoteV2,
  saveScope,
  scopeViaMadame
} from "@/app/actions/budget-scope";
import {
  publishScenario,
  removeScenario,
  saveScenario,
  setEnvelopeArchived
} from "@/app/actions/budget-financial";
import { Dictate } from "@/components/Dictate";

/**
 * The Scope studio — the couple's budget divided into the house's
 * envelopes. One truth, two readings: the team weighs percentages
 * here; the master view's committed figures look back at them.
 * The 100 % rule is absolute: over-allocation blocks the save.
 */
export function ScopeStudio({
  weddingId,
  total,
  envelopes,
  committedByEnvelope,
  beyondCommitted,
  notes,
  isTeam,
  scenarios = []
}: {
  weddingId: string;
  total: number;
  envelopes: BudgetEnvelope[];
  committedByEnvelope: Record<string, number>;
  /** Committed on lines without a category — named, never silent (axe 2). */
  beyondCommitted: number;
  notes: EnvelopeNote[];
  isTeam: boolean;
  scenarios?: BudgetScenario[];
}) {
  const t = useTranslations("budget.scopeStudio");
  const tc = useTranslations("common");
  const format = useFormatter();
  const router = useRouter();

  const archivedEnvelopes = envelopes.filter((e) => e.archived);
  const [drafts, setDrafts] = useState<EnvelopeDraft[]>(
    envelopes
      .filter((e) => !e.archived)
      .map((e, i) => ({
        id: e.id,
        label: e.label,
        percent: Number(e.percent ?? 0),
        recommendedPct: e.recommended_pct != null ? Number(e.recommended_pct) : null,
        priority: e.priority ?? "standard",
        locked: e.locked ?? false,
        sort: e.sort ?? i + 1
      }))
  );
  const [dirty, setDirty] = useState(false);
  const [madameNote, setMadameNote] = useState<string | null>(null);
  const [instruct, setInstruct] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();

  const money = (n: number) =>
    format.number(n, { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

  const totalPct = useMemo(
    () => Math.round(drafts.reduce((s, d) => s + (Number(d.percent) || 0), 0) * 10) / 10,
    [drafts]
  );
  const over = totalPct > 100.001;
  const unallocated = Math.max(0, Math.round((100 - totalPct) * 10) / 10);

  const committedFor = (id?: string) => (id ? committedByEnvelope[id] ?? 0 : 0);
  const noteFor = (id?: string) => notes.find((n) => n.envelope_id === id) ?? null;

  const patch = (i: number, p: Partial<EnvelopeDraft>) => {
    setDrafts((list) => list.map((d, j) => (j === i ? { ...d, ...p } : d)));
    setDirty(true);
  };

  /** Reduce the unlocked envelopes pro rata until the total sits at 100. */
  function rebalance() {
    const excess = totalPct - 100;
    if (excess <= 0) return;
    setDrafts((list) => {
      const unlockedSum = list.filter((d) => !d.locked).reduce((s, d) => s + d.percent, 0);
      if (unlockedSum <= 0) return list;
      return list.map((d) =>
        d.locked
          ? d
          : { ...d, percent: Math.max(0, Math.round((d.percent - (excess * d.percent) / unlockedSum) * 10) / 10) }
      );
    });
    setDirty(true);
  }

  /**
   * The real has spoken: engaged envelopes take the weight their
   * committed demands; the slack spreads over the unlocked others,
   * the High priorities first. A draft until Estelle saves.
   */
  function redistribute() {
    if (!total) return;
    setDrafts((list) => {
      const engaged = list.map((d) => ({ d, committed: committedFor(d.id) }));
      const fixed = engaged.map(({ d, committed }) =>
        committed > 0 ? Math.round(((committed / total) * 100) * 10) / 10 : null
      );
      const fixedSum = fixed.reduce<number>((s, f, i) => s + (f ?? (list[i].locked ? list[i].percent : 0)), 0);
      let slack = Math.max(0, 100 - fixedSum);
      const free = list.filter((d, i) => fixed[i] == null && !d.locked);
      const weight = (d: EnvelopeDraft) => (d.priority === "high" ? 1.5 : 1) * Math.max(d.percent, 1);
      const weightSum = free.reduce((s, d) => s + weight(d), 0);
      return list.map((d, i) => {
        if (fixed[i] != null) return { ...d, percent: fixed[i]! };
        if (d.locked) return d;
        const share = weightSum > 0 ? Math.round(((slack * weight(d)) / weightSum) * 10) / 10 : 0;
        return { ...d, percent: share };
      });
    });
    setDirty(true);
    setMadameNote(t("redistributed"));
  }

  async function letMadame() {
    const order = instruct.trim();
    if (!order || busy) return;
    setBusy(true);
    try {
      const r = await scopeViaMadame(weddingId, order, drafts);
      if (r.ok && r.envelopes.length) {
        setDrafts((prev) =>
          r.envelopes.map((e, i) => ({
            id: e.id ?? undefined,
            label: e.label,
            percent: Number(e.percent) || 0,
            // Madame reworks the forecast; the house's counsel stands.
            recommendedPct: prev.find((x) => x.id && x.id === e.id)?.recommendedPct ?? null,
            priority: e.priority === "high" ? "high" : "standard",
            locked: Boolean(e.locked),
            sort: i + 1
          }))
        );
        setDirty(true);
      }
      setMadameNote(r.note || null);
      setInstruct("");
    } catch {
      setMadameNote(t("madameFailed"));
    }
    setBusy(false);
  }

  if (!isTeam) {
    // The couple's reading — never a cold ledger. Three figures at the
    // head of the page, then each envelope as a small house page:
    // the counsel, the decision, the real (brief §4).
    const committedAll = envelopes.reduce((s, e) => s + committedFor(e.id), 0) + beyondCommitted;
    const stillToPlace = Math.max(0, total - committedAll);
    return (
      <div className="card">
        <div className="eyebrow" style={{ marginBottom: 14 }}>{t("clientTitle")}</div>
        {total > 0 && (
          <div className="scope-head">
            <div>
              <span className="scope-head-label">{t("headTotal")}</span>
              <span className="serif num scope-head-figure">{money(total)}</span>
            </div>
            <div>
              <span className="scope-head-label">{t("headCommitted")}</span>
              <span className="serif num scope-head-figure">{money(committedAll)}</span>
            </div>
            <div>
              <span className="scope-head-label">{t("headStillToPlace")}</span>
              <span className="serif num scope-head-figure">{money(stillToPlace)}</span>
            </div>
          </div>
        )}
        {envelopes.filter((e) => !e.archived).map((env) => {
          const note = noteFor(env.id);
          const forecastAmt = total > 0 && env.percent != null ? (env.percent / 100) * total : null;
          const recAmt =
            total > 0 && env.recommended_pct != null ? (Number(env.recommended_pct) / 100) * total : null;
          const committed = committedFor(env.id);
          const left = forecastAmt != null ? forecastAmt - committed : null;
          return (
            <div key={env.id} className="scope-envcard">
              <div className="serif" style={{ fontSize: 17 }}>{env.label}</div>
              {note?.status === "published" && note.body && (
                <div className="envnote" style={{ marginTop: 4 }}>&ldquo;{note.body}&rdquo; — Estelle</div>
              )}
              <div className="scope-levels">
                <div>
                  <span className="scope-level-label">{t("recommended")}</span>
                  <span className="num">
                    {env.recommended_pct != null ? `${env.recommended_pct} %` : "—"}
                    {recAmt != null && <span className="scope-level-amount">{money(recAmt)}</span>}
                  </span>
                </div>
                <div>
                  <span className="scope-level-label">{t("forecast")}</span>
                  <span className="num">
                    {env.percent != null ? `${env.percent} %` : "—"}
                    {forecastAmt != null && <span className="scope-level-amount">{money(forecastAmt)}</span>}
                  </span>
                </div>
                <div>
                  <span className="scope-level-label">{t("committedLevel")}</span>
                  <span className="num">
                    {committed > 0 ? money(committed) : <em style={{ color: "var(--ink2)" }}>{t("notYetPlaced")}</em>}
                  </span>
                </div>
              </div>
              {committed > 0 && left != null && left > 0.5 && (
                <p style={{ fontSize: 12.5, color: "var(--ink2)", margin: "6px 0 0" }}>
                  {t("stillToPlace", { amount: money(left) })}
                </p>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  if (drafts.length === 0) {
    return (
      <div className="card" style={{ textAlign: "center", padding: "40px 28px" }}>
        <p className="serif" style={{ fontSize: 20, fontStyle: "italic", color: "var(--ink2)" }}>
          {t("emptyTitle")}
        </p>
        <button
          className="btn"
          style={{ marginTop: 16 }}
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              await adoptHouseEnvelopes(weddingId);
              router.refresh();
            })
          }
        >
          {pending ? "…" : t("adopt")}
        </button>
      </div>
    );
  }

  return (
    <div className="team-only">
      {total === 0 && (
        <p role="status" style={{ fontSize: 13, color: "var(--bronze)", margin: "0 0 12px" }}>
          {t("noTotal")}
        </p>
      )}

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 14, flexWrap: "wrap", marginBottom: 6 }}>
          <div className="eyebrow">{t("title")}</div>
          <span className="serif num" style={{ fontSize: 22, color: over ? "var(--bronze)" : "var(--hunter)" }}>
            {totalPct} %
          </span>
        </div>
        {/* The names are hers — say so, where the scope is weighed. */}
        <p style={{ fontSize: 12.5, color: "var(--ink2)", margin: "0 0 10px" }}>{t("renameHint")}</p>
        {beyondCommitted > 0 && (
          <p role="alert" style={{ fontSize: 13, color: "var(--bronze)", margin: "0 0 12px" }}>
            {t("beyondAlert", { amount: money(beyondCommitted) })}
          </p>
        )}

        {over && (
          <p role="alert" style={{ fontSize: 13.5, color: "var(--bronze)", margin: "6px 0 10px" }}>
            {t("overError", { total: totalPct, excess: Math.round((totalPct - 100) * 10) / 10 })}{" "}
            <button className="addnote" onClick={rebalance} style={{ color: "var(--bronze)" }}>
              {t("rebalance")}
            </button>
          </p>
        )}
        {!over && unallocated > 0 && (
          <p role="status" style={{ fontSize: 13, color: "var(--ink2)", margin: "6px 0 10px" }}>
            {t("unallocated", { pct: unallocated, amount: money((unallocated / 100) * total) })}
          </p>
        )}

        {drafts.map((d, i) => {
          const committed = committedFor(d.id);
          const allocated = (Number(d.percent) / 100) * total;
          const variance = committed - allocated;
          const counselGap =
            d.recommendedPct != null ? Math.round((Number(d.percent) - Number(d.recommendedPct)) * 10) / 10 : null;
          const note = noteFor(d.id);
          return (
            <div key={d.id ?? `new-${i}`} style={{ borderTop: i > 0 ? "1px solid var(--line-soft, oklch(0.7749 0.0521 76.74 / 0.22))" : "none", padding: "14px 0" }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <input
                  className="scope-name"
                  value={d.label}
                  onChange={(e) => patch(i, { label: e.target.value })}
                  aria-label={t("envName")}
                  placeholder={t("envNamePh")}
                  title={t("renameHint")}
                  style={{ flex: "1 1 220px", fontSize: 14.5 }}
                />
                <label style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, color: "var(--ink2)" }}>
                  {t("recommendedShort")}
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    value={d.recommendedPct ?? ""}
                    onChange={(e) =>
                      patch(i, { recommendedPct: e.target.value === "" ? null : Number(e.target.value) })
                    }
                    aria-label={t("recommendedPct", { name: d.label })}
                    style={{ width: 68, textAlign: "right" }}
                  />
                </label>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, color: "var(--ink2)" }}>
                  {t("forecastShort")}
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    value={d.percent}
                    onChange={(e) => patch(i, { percent: Number(e.target.value) })}
                    aria-label={t("envPct", { name: d.label })}
                    style={{ width: 68, textAlign: "right", borderColor: over ? "var(--bronze)" : undefined }}
                  />
                </label>
                <span style={{ fontSize: 13, color: "var(--ink2)", minWidth: 92, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                  {total > 0 ? money(allocated) : "—"}
                </span>
                <button
                  type="button"
                  className={`tag${d.priority === "high" ? " ok" : ""}`}
                  style={{ cursor: "pointer" }}
                  title={t("priorityHint")}
                  aria-pressed={d.priority === "high"}
                  onClick={() => patch(i, { priority: d.priority === "high" ? "standard" : "high" })}
                >
                  {d.priority === "high" ? t("priorityHigh") : t("priorityStd")}
                </button>
                <button
                  type="button"
                  className="tag"
                  style={{ cursor: "pointer", opacity: d.locked ? 1 : 0.55 }}
                  title={t("lockHint")}
                  aria-pressed={d.locked}
                  onClick={() => patch(i, { locked: !d.locked })}
                >
                  {d.locked ? "🔒" : "🔓"}
                </button>
                {/* The envelope's own gestures (§5): order, double, archive. */}
                <span style={{ display: "inline-flex", gap: 2 }}>
                  <button
                    className="addnote"
                    aria-label={t("moveUp", { name: d.label })}
                    disabled={i === 0}
                    onClick={() => {
                      setDrafts((list) => {
                        const n = [...list];
                        [n[i - 1], n[i]] = [n[i], n[i - 1]];
                        return n;
                      });
                      setDirty(true);
                    }}
                  >
                    ↑
                  </button>
                  <button
                    className="addnote"
                    aria-label={t("moveDown", { name: d.label })}
                    disabled={i === drafts.length - 1}
                    onClick={() => {
                      setDrafts((list) => {
                        const n = [...list];
                        [n[i], n[i + 1]] = [n[i + 1], n[i]];
                        return n;
                      });
                      setDirty(true);
                    }}
                  >
                    ↓
                  </button>
                </span>
                <button
                  className="addnote"
                  title={t("duplicateHint")}
                  onClick={() => {
                    setDrafts((list) => [
                      ...list.slice(0, i + 1),
                      { label: `${d.label} — ii`, percent: 0, recommendedPct: d.recommendedPct, priority: d.priority, locked: false, sort: i + 2 },
                      ...list.slice(i + 1)
                    ]);
                    setDirty(true);
                  }}
                >
                  {t("duplicateEnv")}
                </button>
                {d.id && (
                  <button
                    className="addnote"
                    title={t("archiveHint")}
                    onClick={() => {
                      if (committedFor(d.id) > 0) {
                        window.alert(t("archiveBlocked", { amount: money(committedFor(d.id)) }));
                        return;
                      }
                      startTransition(async () => {
                        const r = await setEnvelopeArchived(d.id!, true);
                        if (!r.ok) window.alert(t("needsMigration"));
                        else setDrafts((list) => list.filter((_, j) => j !== i));
                        router.refresh();
                      });
                    }}
                  >
                    {t("archiveEnv")}
                  </button>
                )}
                <button
                  className="addnote"
                  onClick={() => {
                    setDrafts((list) => list.filter((_, j) => j !== i));
                    setDirty(true);
                  }}
                >
                  {t("removeEnv")}
                </button>
              </div>
              <input
                type="range"
                min={0}
                max={60}
                step={0.5}
                value={Math.min(60, d.percent)}
                onChange={(e) => patch(i, { percent: Number(e.target.value) })}
                aria-label={t("envPct", { name: d.label })}
                style={{ width: "100%", marginTop: 8, accentColor: "var(--hunter)" }}
              />
              {total > 0 && (
                <p style={{ fontSize: 12.5, marginTop: 6, color: Math.abs(variance) < 1 ? "var(--ink2)" : variance > 0 ? "var(--bronze)" : "var(--ink2)" }}>
                  {committed > 0 ? (
                    <>
                      {t("committedLine", { committed: money(committed) })}{" "}
                      {variance > 0.5
                        ? t("overForecast", { amount: money(variance) })
                        : variance < -0.5
                          ? t("stillToPlace", { amount: money(-variance) })
                          : t("onForecast")}
                    </>
                  ) : (
                    <em style={{ color: "var(--ink2)" }}>{t("notYetPlaced")}</em>
                  )}
                </p>
              )}
              {counselGap != null && Math.abs(counselGap) >= 3 && (
                <p style={{ fontSize: 12.5, marginTop: 4, color: "var(--bronze)" }}>
                  {t("counselGap", { gap: Math.abs(counselGap), dir: counselGap > 0 ? "+" : "−" })}
                </p>
              )}
              <ScopeNote
                weddingId={weddingId}
                envelopeId={d.id}
                envelopeLabel={d.label}
                note={note}
              />
            </div>
          );
        })}

        <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap", alignItems: "center" }}>
          <button
            className="btn ghost sm"
            onClick={() => {
              setDrafts((list) => [
                ...list,
                { label: "", percent: 0, recommendedPct: null, priority: "standard", locked: false, sort: list.length + 1 }
              ]);
              setDirty(true);
            }}
          >
            {t("addEnv")}
          </button>
          <button className="btn ghost sm" onClick={redistribute} disabled={total === 0}>
            {t("redistribute")}
          </button>
          <button
            className="btn sm"
            disabled={pending || over || !dirty}
            title={over ? t("saveBlocked") : undefined}
            onClick={() =>
              startTransition(async () => {
                const r = await saveScope(weddingId, drafts.filter((d) => d.label.trim()));
                if (r.ok) {
                  setDirty(false);
                  router.refresh();
                } else if (r.reason === "over") {
                  setMadameNote(t("overError", { total: r.total, excess: Math.round((r.total - 100) * 10) / 10 }));
                }
              })
            }
          >
            {pending ? "…" : t("saveScope")}
          </button>
          {dirty && !over && <span style={{ fontSize: 12, color: "var(--bronze)" }}>{tc("draft")}</span>}
        </div>

        {archivedEnvelopes.length > 0 && (
          <details style={{ marginTop: 12 }}>
            <summary className="addnote" style={{ cursor: "pointer" }}>
              {t("archivedList", { count: archivedEnvelopes.length })}
            </summary>
            {archivedEnvelopes.map((e) => (
              <div key={e.id} style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "5px 0", fontSize: 13.5, opacity: 0.75 }}>
                <span style={{ flex: 1 }}>{e.label}</span>
                <button
                  className="addnote"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      await setEnvelopeArchived(e.id, false);
                      router.refresh();
                    })
                  }
                >
                  {t("restoreEnv")}
                </button>
              </div>
            ))}
          </details>
        )}
      </div>

      <ScenariosDesk weddingId={weddingId} drafts={drafts} scenarios={scenarios} />

      <div className="ia team-only">
        <div className="eyebrow">
          {t("madameTitle")} <span className="tag int">{tc("internal")}</span>
        </div>
        <div className="assist">
          <Dictate title={t("madameGo")} onText={(x) => setInstruct((v) => (v ? v.trimEnd() + " " + x : x))} />
          <input
            value={instruct}
            onChange={(e) => setInstruct(e.target.value)}
            placeholder={t("madamePlaceholder")}
            onKeyDown={(e) => e.key === "Enter" && letMadame()}
          />
          <button className="btn" onClick={letMadame} disabled={busy}>
            {busy ? "…" : t("madameGo")}
          </button>
        </div>
        {madameNote && (
          <p className="ia-quote" style={{ marginTop: 10 }} aria-live="polite">
            {madameNote}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * The envelope's note, under the language rule: the raw word stays
 * internal; the refined one — client language — is what publishes.
 */
function ScopeNote({
  weddingId,
  envelopeId,
  envelopeLabel,
  note
}: {
  weddingId: string;
  envelopeId?: string;
  envelopeLabel: string;
  note: (EnvelopeNote & { body_raw?: string | null }) | null;
}) {
  const t = useTranslations("budget.scopeStudio.note");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [raw, setRaw] = useState(note?.body_raw ?? "");
  const [refined, setRefined] = useState(note?.body ?? "");
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  if (!envelopeId) return null;
  if (!open) {
    return (
      <button className="addnote" style={{ marginTop: 6 }} onClick={() => setOpen(true)}>
        {note?.body ? t("edit") : t("add")}
        {note?.status === "draft" && <span className="tag int" style={{ marginLeft: 6 }}>{tc("draft")}</span>}
      </button>
    );
  }

  async function refine() {
    if (!raw.trim() || busy) return;
    setBusy(true);
    try {
      const r = await refineEnvelopeNote(weddingId, envelopeLabel, raw.trim());
      if (r.ok) setRefined(r.refined);
    } catch {
      /* raw stands */
    }
    setBusy(false);
  }

  const save = (publish: boolean) =>
    startTransition(async () => {
      await saveEnvelopeNoteV2({
        envelopeId: envelopeId!,
        weddingId,
        bodyRaw: raw,
        body: refined || raw,
        publish
      });
      setOpen(false);
      router.refresh();
    });

  return (
    <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
      <div className="field">
        <label className="eyebrow" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {t("rawLabel")}
          <Dictate title={t("rawLabel")} onText={(x) => setRaw((v) => (v ? v.trimEnd() + " " + x : x))} />
        </label>
        <textarea rows={2} value={raw} onChange={(e) => setRaw(e.target.value)} placeholder={t("rawPlaceholder")} />
      </div>
      {refined && (
        <div style={{ background: "var(--parchment)", padding: "10px 14px" }}>
          <div className="eyebrow" style={{ marginBottom: 4 }}>{t("refinedLabel")}</div>
          <p className="serif" style={{ fontStyle: "italic", fontSize: 15.5 }}>&ldquo;{refined}&rdquo; — Estelle</p>
        </div>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="btn ghost sm" onClick={refine} disabled={busy || !raw.trim()}>
          {busy ? "…" : t("refine")}
        </button>
        <button className="btn ghost sm" disabled={pending || (!refined && !raw.trim())} onClick={() => save(false)}>
          {t("saveDraft")}
        </button>
        <button className="btn sm" disabled={pending || !refined} onClick={() => save(true)}>
          {t("publish")}
        </button>
        <button className="btn ghost sm" onClick={() => setOpen(false)}>{tc("cancel")}</button>
      </div>
    </div>
  );
}

/**
 * Scenarios (§5): the envelope set frozen under a name — compared
 * beside the live scope, and published over it only at Estelle's
 * word, through the same 100 % rule.
 */
function ScenariosDesk({
  weddingId,
  drafts,
  scenarios
}: {
  weddingId: string;
  drafts: EnvelopeDraft[];
  scenarios: BudgetScenario[];
}) {
  const t = useTranslations("budget.scopeStudio.scenarios");
  const tc = useTranslations("common");
  const router = useRouter();
  const [compareId, setCompareId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const comparing = scenarios.find((s) => s.id === compareId) ?? null;
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const compareRows = comparing
    ? (() => {
        const labels = new Map<string, { label: string; current: number | null; scenario: number | null }>();
        for (const d of drafts) labels.set(norm(d.label), { label: d.label, current: Number(d.percent) || 0, scenario: null });
        for (const s of comparing.data) {
          const k = norm(s.label);
          const row = labels.get(k);
          if (row) row.scenario = Number(s.percent) || 0;
          else labels.set(k, { label: s.label, current: null, scenario: Number(s.percent) || 0 });
        }
        return [...labels.values()];
      })()
    : [];

  return (
    <div className="card team-only" style={{ marginTop: 14 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <div className="eyebrow" style={{ marginRight: "auto" }}>{t("title")}</div>
        <button
          className="btn ghost sm"
          disabled={pending || drafts.length === 0}
          onClick={() => {
            const label = window.prompt(t("savePrompt"));
            if (!label?.trim()) return;
            startTransition(async () => {
              const r = await saveScenario(weddingId, label.trim(), drafts);
              if (!r.ok) window.alert(t("needsMigration"));
              router.refresh();
            });
          }}
        >
          {t("saveCurrent")}
        </button>
      </div>
      {scenarios.length === 0 && (
        <p style={{ fontSize: 13, color: "var(--ink2)", margin: "8px 0 0" }}>{t("empty")}</p>
      )}
      {scenarios.map((s) => (
        <div key={s.id} style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap", padding: "7px 0", borderTop: "1px solid rgba(201,178,145,.22)", marginTop: 6 }}>
          <strong style={{ fontSize: 13.5 }}>{s.label}</strong>
          {s.status === "published" ? <span className="tag ok">{t("published")}</span> : <span className="tag int">{tc("draft")}</span>}
          <span style={{ fontSize: 12, color: "var(--ink2)" }}>
            {t("meta", { n: s.data.length, total: Math.round(s.data.reduce((x, e) => x + (Number(e.percent) || 0), 0) * 10) / 10 })}
          </span>
          <span style={{ marginLeft: "auto", display: "inline-flex", gap: 10 }}>
            <button className="addnote" onClick={() => setCompareId(compareId === s.id ? null : s.id)} aria-pressed={compareId === s.id}>
              {compareId === s.id ? t("compareClose") : t("compare")}
            </button>
            <button
              className="addnote"
              disabled={pending}
              onClick={() => {
                if (!window.confirm(t("publishConfirm", { label: s.label }))) return;
                startTransition(async () => {
                  const r = await publishScenario(s.id);
                  if (!r.ok) window.alert("reason" in r && r.reason === "over" ? t("publishOver") : t("needsMigration"));
                  router.refresh();
                });
              }}
            >
              {t("publish")}
            </button>
            <button
              className="addnote"
              style={{ color: "var(--bronze)" }}
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await removeScenario(s.id);
                  if (compareId === s.id) setCompareId(null);
                  router.refresh();
                })
              }
            >
              {t("remove")}
            </button>
          </span>
        </div>
      ))}
      {comparing && (
        <div style={{ overflowX: "auto", marginTop: 10 }}>
          <table className="sheet-table" style={{ background: "#fff", fontSize: 13 }}>
            <thead>
              <tr>
                <th>{t("colEnvelope")}</th>
                <th className="num">{t("colCurrent")}</th>
                <th className="num">{comparing.label}</th>
                <th className="num">{t("colGap")}</th>
              </tr>
            </thead>
            <tbody>
              {compareRows.map((r, i) => {
                const gap = r.current != null && r.scenario != null ? Math.round((r.scenario - r.current) * 10) / 10 : null;
                return (
                  <tr key={i}>
                    <td>{r.label}</td>
                    <td className="num">{r.current != null ? `${r.current} %` : "—"}</td>
                    <td className="num">{r.scenario != null ? `${r.scenario} %` : "—"}</td>
                    <td className="num" style={{ color: gap ? "var(--bronze)" : "var(--ink2)" }}>
                      {gap != null ? `${gap > 0 ? "+" : ""}${gap} %` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

interface AnalysisRow {
  envelope: string;
  allocated: number | null;
  in_document: number | null;
  variance: number | null;
  flag: "over" | "tight" | "even" | "under" | null;
}

/**
 * The scope reads a study: a budget analysis, a contract, a proposal —
 * Madame sets it against the envelopes, in figures and in words.
 * The client note publishes at Estelle's word; warnings and the
 * house's tricks stay hers, filed with her internal notes.
 */
export function ScopeAnalysisDrop({ weddingId }: { weddingId: string }) {
  const t = useTranslations("budget.scopeStudio.analysis");
  const format = useFormatter();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<AnalysisRow[]>([]);
  const [clientNote, setClientNote] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [tips, setTips] = useState<string[]>([]);
  const [published, setPublished] = useState(false);
  const [pending, startTransition] = useTransition();

  const money = (n: number | null | undefined) =>
    n == null ? "—" : format.number(n, { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

  async function handle(file: File) {
    if (busy) return;
    setBusy(true);
    setRows([]);
    setClientNote("");
    setWarnings([]);
    setTips([]);
    setPublished(false);
    try {
      const form = new FormData();
      form.append("weddingId", weddingId);
      form.append("file", file);
      const r = await fetch("/api/agents/scope-analysis", { method: "POST", body: form });
      const d = await r.json();
      setRows(Array.isArray(d.rows) ? d.rows : []);
      setClientNote(d.clientNote ?? "");
      setWarnings(Array.isArray(d.warnings) ? d.warnings : []);
      setTips(Array.isArray(d.tips) ? d.tips : []);
    } catch {
      setClientNote("");
      setWarnings([t("failed")]);
    }
    setBusy(false);
  }

  const flagTag = (f: AnalysisRow["flag"]) =>
    f === "over" ? (
      <span className="tag alert" style={{ borderColor: "var(--bronze)", color: "var(--bronze)" }}>{t("flagOver")}</span>
    ) : f === "tight" ? (
      <span className="tag wait">{t("flagTight")}</span>
    ) : f === "under" ? (
      <span className="tag">{t("flagUnder")}</span>
    ) : f === "even" ? (
      <span className="tag ok">{t("flagEven")}</span>
    ) : null;

  return (
    <div className="ia team-only" style={{ marginTop: 14 }}>
      <div className="eyebrow">
        {t("title")} <span className="tag int">{t("internalTag")}</span>
      </div>
      <p style={{ marginTop: 8, fontSize: 13.5 }}>{t("blurb")}</p>
      <label className="btn ghost" style={{ cursor: "pointer", marginTop: 10, display: "inline-block" }}>
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

      {rows.length > 0 && (
        <div style={{ overflowX: "auto", marginTop: 14 }}>
          <table className="sheet-table" style={{ background: "#fff", fontSize: 13 }}>
            <thead>
              <tr>
                <th>{t("colEnvelope")}</th>
                <th className="num">{t("colAllocated")}</th>
                <th className="num">{t("colDocument")}</th>
                <th className="num">{t("colVariance")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>{r.envelope}</td>
                  <td className="num">{money(r.allocated)}</td>
                  <td className="num">{money(r.in_document)}</td>
                  <td className="num" style={{ color: (r.variance ?? 0) > 0 ? "var(--bronze)" : undefined }}>
                    {r.variance != null ? `${r.variance > 0 ? "+" : ""}${money(r.variance)}` : "—"}
                  </td>
                  <td>{flagTag(r.flag)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {clientNote && (
        <div style={{ marginTop: 14, background: "#fff", border: "1px solid var(--line)", padding: "14px 16px" }}>
          <div className="eyebrow" style={{ marginBottom: 6 }}>{t("clientNoteTitle")}</div>
          <p className="serif" style={{ fontStyle: "italic", fontSize: 16, lineHeight: 1.6 }}>
            &ldquo;{clientNote}&rdquo; — Estelle
          </p>
          <button
            className="btn sm"
            style={{ marginTop: 10 }}
            disabled={pending || published}
            onClick={() =>
              startTransition(async () => {
                await publishScopeAnalysis(weddingId, clientNote);
                setPublished(true);
                router.refresh();
              })
            }
          >
            {published ? t("publishedTag") : t("publishNote")}
          </button>
        </div>
      )}

      {(warnings.length > 0 || tips.length > 0) && (
        <div style={{ marginTop: 14 }}>
          <div className="eyebrow" style={{ marginBottom: 6 }}>
            {t("internalTitle")} <span className="tag int">{t("neverVisible")}</span>
          </div>
          {warnings.map((w, i) => (
            <p key={`w${i}`} style={{ fontSize: 13, color: "var(--bronze)", marginTop: 4 }}>⚠ {w}</p>
          ))}
          {tips.map((x, i) => (
            <p key={`t${i}`} style={{ fontSize: 13, color: "var(--ink2)", marginTop: 4 }}>— {x}</p>
          ))}
          <p style={{ fontSize: 12.5, color: "var(--ink2)", marginTop: 8 }}>{t("filedNote")}</p>
        </div>
      )}
    </div>
  );
}
