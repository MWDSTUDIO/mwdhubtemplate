"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import {
  getPublishState,
  publishSweep,
  unpublishSweep,
  type PublishState
} from "@/app/actions/publish-desk";

/**
 * The grouped publication (brief §2.3). One place that says exactly
 * what still awaits Estelle's word, one explicit recap of what will
 * become visible, one named confirmation — and the journal beneath,
 * with the way back.
 */
export function PublishDesk({ weddingId }: { weddingId: string }) {
  const t = useTranslations("publishDesk");
  const format = useFormatter();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<PublishState | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const [budget, setBudget] = useState(true);
  const [timeline, setTimeline] = useState(true);
  const [months, setMonths] = useState<string[]>([]);
  const [docIds, setDocIds] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();

  const load = useCallback(() => {
    getPublishState(weddingId)
      .then((s) => {
        setState(s);
        setMonths(s.months);
        setDocIds([]);
      })
      .catch(() => setState(null));
  }, [weddingId]);

  useEffect(() => {
    if (open) {
      setConfirming(false);
      setDone(null);
      setBudget(true);
      setTimeline(true);
      load();
    }
  }, [open, load]);

  // The same keys on every page: p opens the desk, Escape closes it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing =
        el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
      if (e.key === "Escape" && open) {
        setOpen(false);
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "p") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const monthLabel = (m: string) =>
    format.dateTime(new Date(`${m}-01T12:00:00`), { month: "long", year: "numeric" });

  if (!open) {
    return (
      <button className="lang team-only" onClick={() => setOpen(true)} title={`${t("title")} (p)`}>
        {t("open")}
      </button>
    );
  }

  const s = state;
  const nLines = s && budget ? s.budgetLines : 0;
  const nNotes = s && budget ? s.envelopeNotes : 0;
  const nMilestones = s && timeline ? s.milestones : 0;
  const nMonths = months.length;
  const nDocs = docIds.length;
  const total = nLines + nNotes + nMilestones + nMonths + nDocs;

  const recapParts = [
    nLines > 0 ? t("recapLines", { n: nLines }) : null,
    nNotes > 0 ? t("recapNotes", { n: nNotes }) : null,
    nMilestones > 0 ? t("recapMilestones", { n: nMilestones }) : null,
    nMonths > 0 ? t("recapMonths", { n: nMonths }) : null,
    nDocs > 0 ? t("recapDocs", { n: nDocs }) : null
  ].filter(Boolean);

  const go = () =>
    startTransition(async () => {
      const r = await publishSweep(weddingId, { budget, timeline, months, docIds });
      if (r.ok) {
        setDone(recapParts.join(" · "));
        setConfirming(false);
        load();
        router.refresh();
      }
    });

  const takeBack = (logId: string) =>
    startTransition(async () => {
      const r = await unpublishSweep(logId);
      if (r.ok) {
        setDone(null);
        load();
        router.refresh();
      }
    });

  const actionLabel = (action: string) => {
    switch (action) {
      case "publish_sweep": return t("journalSweep");
      case "unpublish_sweep": return t("journalUnpublish");
      case "publish_budget": return t("journalBudget");
      case "publish_timeline": return t("journalTimeline");
      case "publish_monthly_note": return t("journalMonthly");
      case "publish_envelope_note": return t("journalEnvelope");
      case "publish_document": return t("journalDocument");
      case "withdraw_document": return t("journalWithdraw");
      case "board_status": return t("journalBoard");
      case "fx_rate_held": return t("journalFxRate");
      case "fx_realized_gap": return t("journalFxGap");
      default: return action;
    }
  };

  return (
    <>
      <button className="lang team-only" onClick={() => setOpen(false)} title={`${t("title")} (p)`}>
        {t("open")}
      </button>
      <div className="deskPanel team-only" role="dialog" aria-label={t("title")}>
        <div className="hd">
          <div className="eyebrow">{t("title")}</div>
          <div style={{ fontSize: 13, marginTop: 3 }}>{t("tagline")}</div>
        </div>
        <div className="deskPanel-body">
          {!s && <p style={{ color: "var(--ink2)", fontSize: 13.5 }}>{t("loading")}</p>}

          {s && done && (
            <p className="ia-quote" style={{ fontSize: 15.5 }} aria-live="polite">
              {t("done")} {done && `— ${done}.`}
            </p>
          )}

          {s && !done && s.budgetLines + s.envelopeNotes + s.milestones + s.months.length === 0 &&
            s.docs.length === 0 && (
              <p className="serif" style={{ fontStyle: "italic", fontSize: 17, color: "var(--ink2)" }}>
                {t("nothing")}
              </p>
            )}

          {s && !done && (s.budgetLines + s.envelopeNotes + s.milestones + s.months.length > 0 || s.docs.length > 0) && (
            <>
              {(s.budgetLines > 0 || s.envelopeNotes > 0) && (
                <label className="deskRow">
                  <input
                    type="checkbox"
                    checked={budget}
                    onChange={(e) => setBudget(e.target.checked)}
                  />
                  <span>
                    {t("budgetRow", { lines: s.budgetLines, notes: s.envelopeNotes })}
                  </span>
                </label>
              )}
              {s.milestones > 0 && (
                <label className="deskRow">
                  <input
                    type="checkbox"
                    checked={timeline}
                    onChange={(e) => setTimeline(e.target.checked)}
                  />
                  <span>{t("timelineRow", { n: s.milestones })}</span>
                </label>
              )}
              {s.months.map((m) => (
                <label className="deskRow" key={m}>
                  <input
                    type="checkbox"
                    checked={months.includes(m)}
                    onChange={(e) =>
                      setMonths((v) => (e.target.checked ? [...v, m] : v.filter((x) => x !== m)))
                    }
                  />
                  <span>{t("monthRow", { month: monthLabel(m) })}</span>
                </label>
              ))}

              {s.docs.length > 0 && (
                <>
                  <div className="eyebrow" style={{ margin: "14px 0 4px" }}>{t("docsTitle")}</div>
                  <p style={{ fontSize: 12.5, color: "var(--ink2)", margin: "0 0 6px" }}>{t("docsHint")}</p>
                  {s.docs.map((d) => (
                    <label className="deskRow" key={d.id}>
                      <input
                        type="checkbox"
                        checked={docIds.includes(d.id)}
                        onChange={(e) =>
                          setDocIds((v) => (e.target.checked ? [...v, d.id] : v.filter((x) => x !== d.id)))
                        }
                      />
                      <span>{d.label}</span>
                    </label>
                  ))}
                </>
              )}

              {budget && s.homelessLines > 0 && (
                <p role="alert" style={{ fontSize: 12.5, color: "var(--bronze)", margin: "10px 0 0" }}>
                  {t("homelessWarn", { n: s.homelessLines })}
                </p>
              )}

              <hr className="hair" style={{ margin: "16px 0" }} />

              {!confirming && (
                <button className="btn" disabled={total === 0} onClick={() => setConfirming(true)}>
                  {t("review")}
                </button>
              )}
              {confirming && (
                <div className="deskConfirm">
                  <div className="eyebrow" style={{ color: "var(--bronze)" }}>{t("confirmTitle")}</div>
                  <p style={{ margin: "8px 0 12px", fontSize: 14.5 }}>
                    {recapParts.length > 0 ? recapParts.join(" · ") : t("nothing")}
                  </p>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <button className="btn" disabled={pending || total === 0} onClick={go}>
                      {pending ? "…" : t("confirm", { n: total })}
                    </button>
                    <button className="btn ghost" onClick={() => setConfirming(false)}>
                      {t("keepDraft")}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          <hr className="hair" style={{ margin: "18px 0 12px" }} />
          <div className="eyebrow">{t("journalTitle")}</div>
          {s && !s.journalAvailable && (
            <p style={{ fontSize: 12.5, color: "var(--bronze)", marginTop: 6 }}>{t("journalSoon")}</p>
          )}
          {s && s.journalAvailable && s.journal.length === 0 && (
            <p style={{ fontSize: 13, color: "var(--ink2)", marginTop: 6 }}>{t("journalEmpty")}</p>
          )}
          {s?.journalAvailable && s.journal.length > 0 && (
            <ul className="deskJournal">
              {s.journal.map((j) => (
                <li key={j.id}>
                  <span className="when num">
                    {format.dateTime(new Date(j.created_at), {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit"
                    })}
                  </span>
                  <span className="what">
                    {j.actor && <strong>{j.actor}</strong>} {actionLabel(j.action)}
                    {j.reverted_at && <em className="tag int" style={{ marginLeft: 6 }}>{t("reverted")}</em>}
                  </span>
                  {j.action === "publish_sweep" && !j.reverted_at && (
                    <button className="addnote" disabled={pending} onClick={() => takeBack(j.id)}>
                      {t("unpublish")}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
