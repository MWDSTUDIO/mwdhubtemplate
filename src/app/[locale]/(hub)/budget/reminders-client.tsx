"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useFormatter, useTranslations } from "next-intl";
import type { Payment } from "@/lib/types";
import {
  approveReminderPreview,
  getRemindersState,
  previewReminderEmail,
  removeReminder,
  runRemindersNow,
  saveReminder,
  saveReminderDefaults,
  sendReminderNow,
  setBankingDisclosure,
  setSenderIdentity,
  type ReminderDefault,
  type ReminderRowUI,
  type RemindersState
} from "@/app/actions/reminders";
import { addDays } from "@/lib/reminders-logic";

/**
 * The reminders desk (notifications brief, Part I) — as many reminders
 * as the house wishes on each instalment, the wedding's default set,
 * what the letter carries, the mandatory first-send preview, and the
 * failures said aloud. Team-only; every lock lives server-side.
 */
export function RemindersDesk({
  weddingId,
  payments,
  lineLabels
}: {
  weddingId: string;
  payments: Payment[];
  lineLabels: Record<string, string>;
}) {
  const t = useTranslations("budget.reminders");
  const format = useFormatter();
  const [state, setState] = useState<RemindersState | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [tickWord, setTickWord] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const load = useCallback(() => {
    getRemindersState(weddingId).then(setState).catch(() => setState(null));
  }, [weddingId]);
  useEffect(load, [load]);

  const byPayment = useMemo(() => {
    const map = new Map<string, ReminderRowUI[]>();
    for (const r of state?.reminders ?? []) {
      map.set(r.payment_id, [...(map.get(r.payment_id) ?? []), r]);
    }
    return map;
  }, [state]);

  const sorted = useMemo(
    () =>
      [...payments].sort((a, b) =>
        (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999")
      ),
    [payments]
  );

  const day = (iso: string) =>
    format.dateTime(new Date(`${iso}T12:00:00`), { day: "numeric", month: "short", year: "numeric" });

  /** What has become of one reminder — the same words as the server's locks. */
  const stateOf = (r: ReminderRowUI, p: Payment): { word: string; tone: "ok" | "wait" | "hold" } => {
    if (r.sent_at) return { word: t("stateSent", { date: day(r.sent_at.slice(0, 10)) }), tone: "ok" };
    const lastSend = (state?.sends ?? []).find((s) => s.reminder_id === r.id);
    if (lastSend?.status === "abandoned") return { word: t("stateAbandoned"), tone: "hold" };
    if (p.paid_at) return { word: t("stateCancelled"), tone: "hold" };
    if (state?.lineStatusByPayment[p.id] === "draft") return { word: t("stateDraft"), tone: "hold" };
    const banking = state?.bankingByPayment[p.id];
    if (banking != null && banking !== "verified") return { word: t("stateBanking"), tone: "hold" };
    const target = r.fixed_date ?? (p.due_date && r.offset_days != null ? addDays(p.due_date, r.offset_days) : null);
    if (!target) return { word: t("stateNoAnchor"), tone: "wait" };
    return { word: t("stateAwaiting", { date: day(target) }), tone: "wait" };
  };

  const whenOf = (r: ReminderRowUI) =>
    r.fixed_date
      ? day(r.fixed_date)
      : r.offset_days != null
        ? r.offset_days <= 0
          ? `J−${-r.offset_days}`
          : `J+${r.offset_days}`
        : "—";

  const channelWord = (c: string) =>
    c === "email" ? t("chEmail") : c === "in_app" ? t("chApp") : t("chBoth");

  const outcomeWord = (o: string) => {
    switch (o) {
      case "sent":
      case "emailed":
      case "in_app":
        return t("outcomeSent");
      case "held_preview": return t("outcomeHeldPreview");
      case "held_gmail": return t("outcomeHeldGmail");
      case "banking": return t("stateBanking");
      case "draft_line": return t("stateDraft");
      case "settled": return t("stateCancelled");
      case "failed": return t("outcomeFailed");
      case "abandoned": return t("stateAbandoned");
      default: return t("outcomeProgrammed");
    }
  };

  const failures = (state?.sends ?? []).filter((s) => s.status !== "sent").slice(0, 6);

  if (!state) {
    return (
      <div className="card team-only">
        <div className="eyebrow">{t("title")}</div>
        <p style={{ color: "var(--ink2)", fontSize: 13.5 }}>{t("loading")}</p>
      </div>
    );
  }

  if (!state.available) {
    return (
      <div className="card team-only">
        <div className="eyebrow">{t("title")}</div>
        <p style={{ marginTop: 8, fontSize: 13, color: "var(--bronze)" }}>{t("needsMigration")}</p>
      </div>
    );
  }

  return (
    <div className="card team-only">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
        <div className="eyebrow">{t("title")}</div>
        <button
          className="addnote"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const s = await runRemindersNow(weddingId);
              setTickWord(
                t("tickResult", {
                  emails: s.emails,
                  inApp: s.inApp,
                  held: s.held.settled + s.held.draft + s.held.banking + s.held.preview + s.held.gmail,
                  failed: s.failed + s.abandoned
                })
              );
              load();
            })
          }
        >
          {pending ? "…" : t("runNow")}
        </button>
      </div>
      <p style={{ fontSize: 12.5, color: "var(--ink2)", margin: "4px 0 0" }}>{t("tagline")}</p>
      {tickWord && (
        <p role="status" style={{ fontSize: 12.5, color: "var(--bronze)", marginTop: 6 }}>{tickWord}</p>
      )}

      {/* ── failures, said aloud (brief §2 bis b) ─────────────────── */}
      {failures.length > 0 && (
        <div role="alert" style={{ marginTop: 12, padding: "10px 12px", border: "1px solid var(--bronze)", background: "var(--parchment)" }}>
          <div className="eyebrow" style={{ color: "var(--bronze)" }}>{t("failuresTitle")}</div>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 12.5 }}>
            {failures.map((s) => (
              <li key={s.id}>
                {payments.find((p) => p.id === s.payment_id)?.label ?? s.payment_id} — {day(s.sent_on)}
                {" · "}
                {s.status === "abandoned" ? t("failureAbandoned") : t("failureRetry")}
                {s.error && <span style={{ color: "var(--ink2)" }}> ({s.error})</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── per instalment ─────────────────────────────────────────── */}
      <div className="eyebrow" style={{ margin: "16px 0 4px" }}>{t("paymentsTitle")}</div>
      {sorted.length === 0 && (
        <p className="serif" style={{ fontStyle: "italic", color: "var(--ink2)" }}>{t("noneUnpaid")}</p>
      )}
      {sorted.map((p) => {
        const list = byPayment.get(p.id) ?? [];
        const open = openId === p.id;
        return (
          <div key={p.id} style={{ borderBottom: "1px solid var(--line)", padding: "8px 0" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
              <span style={{ flex: "1 1 240px" }}>
                {p.label}
                {p.budget_line_id && lineLabels[p.budget_line_id] && (
                  <span style={{ fontSize: 12, color: "var(--ink2)", marginLeft: 8 }}>
                    {lineLabels[p.budget_line_id]}
                  </span>
                )}
              </span>
              <span style={{ fontSize: 12.5, color: "var(--ink2)" }}>
                {p.due_date ? day(p.due_date) : "—"}
              </span>
              {p.paid_at && <span className="tag ok">{t("settledTag")}</span>}
              <span className="tag">{t("remindersCount", { count: list.length })}</span>
              <button className="addnote" onClick={() => setOpenId(open ? null : p.id)}>
                {open ? t("close") : t("manage")}
              </button>
            </div>
            {open && (
              <div style={{ marginTop: 8, paddingLeft: 6 }}>
                {list.map((r) => {
                  const s = stateOf(r, p);
                  return (
                    <div key={r.id} style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap", padding: "4px 0", fontSize: 13 }}>
                      <span className="num" style={{ minWidth: 52 }}>{whenOf(r)}</span>
                      <span className="tag">{channelWord(r.channel)}</span>
                      {r.label && <span style={{ color: "var(--ink2)" }}>{r.label}</span>}
                      <span
                        className={s.tone === "ok" ? "tag ok" : s.tone === "hold" ? "tag int" : "tag wait"}
                      >
                        {s.word}
                      </span>
                      {!r.sent_at && (
                        <button
                          className="addnote"
                          disabled={pending}
                          onClick={() =>
                            startTransition(async () => {
                              await removeReminder(r.id, weddingId);
                              load();
                            })
                          }
                        >
                          {t("remove")}
                        </button>
                      )}
                    </div>
                  );
                })}
                <AddReminderRow
                  weddingId={weddingId}
                  paymentId={p.id}
                  onDone={load}
                />
                {!p.paid_at && (
                  <SendNowButton weddingId={weddingId} paymentId={p.id} onDone={load} outcomeWord={outcomeWord} />
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* ── the wedding's default set ──────────────────────────────── */}
      <DefaultsEditor weddingId={weddingId} defaults={state.defaults} onSaved={load} />

      {/* ── the letter: disclosure, sender, preview ────────────────── */}
      <LetterSettings weddingId={weddingId} state={state} onSaved={load} />

      {/* ── the sending box ────────────────────────────────────────── */}
      <hr className="hair" style={{ margin: "16px 0 10px" }} />
      <div className="eyebrow">{t("boxTitle")}</div>
      <p style={{ fontSize: 12.5, color: state.gmailConfigured ? "var(--ink2)" : "var(--bronze)", margin: "6px 0 0" }}>
        {state.gmailConfigured ? t("gmailOk") : t("gmailMissing")}
      </p>
      <p style={{ fontSize: 12.5, color: "var(--ink2)", margin: "4px 0 0" }}>
        {state.emailEnabled ? t("schedulerOn") : t("schedulerDormant")}
      </p>
    </div>
  );
}

function AddReminderRow({
  weddingId,
  paymentId,
  onDone
}: {
  weddingId: string;
  paymentId: string;
  onDone: () => void;
}) {
  const t = useTranslations("budget.reminders");
  const [mode, setMode] = useState<"before" | "after" | "date">("before");
  const [days, setDays] = useState("30");
  const [date, setDate] = useState("");
  const [channel, setChannel] = useState<"email" | "in_app" | "both">("both");
  const [label, setLabel] = useState("");
  const [pending, startTransition] = useTransition();

  const n = Number(days);
  const valid = mode === "date" ? Boolean(date) : Number.isFinite(n) && days.trim() !== "";

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 6 }}>
      <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)} style={{ padding: "8px", border: "1px solid var(--line)", background: "#fff" }} aria-label={t("whenLabel")}>
        <option value="before">{t("daysBefore")}</option>
        <option value="after">{t("daysAfter")}</option>
        <option value="date">{t("onDate")}</option>
      </select>
      {mode === "date" ? (
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ flex: "0 0 150px" }} aria-label={t("onDate")} />
      ) : (
        <input
          value={days}
          onChange={(e) => setDays(e.target.value.replace(/[^\d]/g, ""))}
          style={{ flex: "0 0 60px", textAlign: "right" }}
          aria-label={mode === "before" ? t("daysBefore") : t("daysAfter")}
        />
      )}
      <select value={channel} onChange={(e) => setChannel(e.target.value as typeof channel)} style={{ padding: "8px", border: "1px solid var(--line)", background: "#fff" }} aria-label={t("channelLabel")}>
        <option value="both">{t("chBoth")}</option>
        <option value="email">{t("chEmail")}</option>
        <option value="in_app">{t("chApp")}</option>
      </select>
      <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("labelPh")} style={{ flex: "1 1 140px" }} />
      <button
        className="addnote"
        disabled={pending || !valid}
        onClick={() =>
          startTransition(async () => {
            await saveReminder({
              weddingId,
              paymentId,
              offsetDays: mode === "date" ? null : mode === "before" ? -n : n,
              fixedDate: mode === "date" ? date : null,
              channel,
              label
            });
            setLabel("");
            onDone();
          })
        }
      >
        {pending ? "…" : t("add")}
      </button>
    </div>
  );
}

function SendNowButton({
  weddingId,
  paymentId,
  onDone,
  outcomeWord
}: {
  weddingId: string;
  paymentId: string;
  onDone: () => void;
  outcomeWord: (o: string) => string;
}) {
  const t = useTranslations("budget.reminders");
  const [word, setWord] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div style={{ marginTop: 6 }}>
      <button
        className="addnote"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const r = await sendReminderNow(weddingId, paymentId);
            setWord(r.ok ? outcomeWord(r.outcome) : t("needsMigration"));
            onDone();
          })
        }
      >
        {pending ? "…" : t("sendNow")}
      </button>
      {word && <span role="status" style={{ fontSize: 12.5, color: "var(--bronze)", marginLeft: 8 }}>{word}</span>}
    </div>
  );
}

function DefaultsEditor({
  weddingId,
  defaults,
  onSaved
}: {
  weddingId: string;
  defaults: ReminderDefault[];
  onSaved: () => void;
}) {
  const t = useTranslations("budget.reminders");
  const [rows, setRows] = useState(
    defaults.map((d) => ({
      days: String(Math.abs(d.offset_days)),
      when: d.offset_days <= 0 ? "before" : "after",
      channel: d.channel,
      label: d.label ?? ""
    }))
  );
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const patch = (i: number, p: Partial<(typeof rows)[number]>) =>
    setRows((list) => list.map((r, j) => (j === i ? { ...r, ...p } : r)));

  return (
    <>
      <hr className="hair" style={{ margin: "16px 0 10px" }} />
      <div className="eyebrow">{t("defaultsTitle")}</div>
      <p style={{ fontSize: 12.5, color: "var(--ink2)", margin: "4px 0 6px" }}>{t("defaultsHint")}</p>
      {rows.map((r, i) => (
        <div key={i} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 6 }}>
          <input
            value={r.days}
            onChange={(e) => patch(i, { days: e.target.value.replace(/[^\d]/g, "") })}
            style={{ flex: "0 0 60px", textAlign: "right" }}
            aria-label={t("daysBefore")}
          />
          <select value={r.when} onChange={(e) => patch(i, { when: e.target.value })} style={{ padding: "8px", border: "1px solid var(--line)", background: "#fff" }} aria-label={t("whenLabel")}>
            <option value="before">{t("daysBefore")}</option>
            <option value="after">{t("daysAfter")}</option>
          </select>
          <select value={r.channel} onChange={(e) => patch(i, { channel: e.target.value as ReminderDefault["channel"] })} style={{ padding: "8px", border: "1px solid var(--line)", background: "#fff" }} aria-label={t("channelLabel")}>
            <option value="both">{t("chBoth")}</option>
            <option value="email">{t("chEmail")}</option>
            <option value="in_app">{t("chApp")}</option>
          </select>
          <input value={r.label} onChange={(e) => patch(i, { label: e.target.value })} placeholder={t("labelPh")} style={{ flex: "1 1 140px" }} />
          <button className="addnote" onClick={() => setRows((list) => list.filter((_, j) => j !== i))} aria-label={t("remove")} style={{ color: "var(--bronze)" }}>
            ×
          </button>
        </div>
      ))}
      <div style={{ display: "flex", gap: 10, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button className="addnote" onClick={() => setRows((list) => [...list, { days: "30", when: "before", channel: "both", label: "" }])}>
          + {t("addDefault")}
        </button>
        <button
          className="btn ghost sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              await saveReminderDefaults(
                weddingId,
                rows
                  .filter((r) => r.days.trim() !== "")
                  .map((r) => ({
                    offset_days: r.when === "before" ? -Number(r.days) : Number(r.days),
                    channel: r.channel,
                    ...(r.label.trim() ? { label: r.label.trim() } : {})
                  }))
              );
              setSaved(true);
              onSaved();
            })
          }
        >
          {pending ? "…" : t("saveDefaults")}
        </button>
        {saved && <span role="status" style={{ fontSize: 12.5, color: "var(--bronze)" }}>{t("defaultsSaved")}</span>}
      </div>
    </>
  );
}

function LetterSettings({
  weddingId,
  state,
  onSaved
}: {
  weddingId: string;
  state: RemindersState;
  onSaved: () => void;
}) {
  const t = useTranslations("budget.reminders");
  const format = useFormatter();
  const [senderName, setSenderName] = useState(state.senderName ?? "");
  const [replyTo, setReplyTo] = useState(state.replyTo ?? "");
  const [preview, setPreview] = useState<{ from: string; replyTo: string | null; subject: string; text: string } | null>(null);
  const [previewWord, setPreviewWord] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const levels: { key: "link" | "partial" | "full"; label: string; hint: string }[] = [
    { key: "link", label: t("dLink"), hint: t("dLinkHint") },
    { key: "partial", label: t("dPartial"), hint: t("dPartialHint") },
    { key: "full", label: t("dFull"), hint: t("dFullHint") }
  ];

  return (
    <>
      <hr className="hair" style={{ margin: "16px 0 10px" }} />
      <div className="eyebrow">{t("disclosureTitle")}</div>
      {levels.map((l) => (
        <label key={l.key} style={{ display: "flex", gap: 10, alignItems: "baseline", marginTop: 8, cursor: "pointer" }}>
          <input
            type="radio"
            name="disclosure"
            checked={state.disclosure === l.key}
            onChange={() =>
              startTransition(async () => {
                await setBankingDisclosure(weddingId, l.key);
                onSaved();
              })
            }
          />
          <span>
            <b style={{ fontWeight: 500 }}>{l.label}</b>
            <span style={{ display: "block", fontSize: 12.5, color: "var(--ink2)" }}>{l.hint}</span>
          </span>
        </label>
      ))}
      <p style={{ fontSize: 12, color: "var(--ink2)", marginTop: 8 }}>
        {t("disclosureNote")} {t("warningNote")}
      </p>

      <div className="eyebrow" style={{ marginTop: 14 }}>{t("senderTitle")}</div>
      <p style={{ fontSize: 12.5, color: "var(--ink2)", margin: "4px 0 6px" }}>{t("senderHint")}</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input value={senderName} onChange={(e) => setSenderName(e.target.value)} placeholder={t("senderNamePh")} style={{ flex: "1 1 220px" }} aria-label={t("senderName")} />
        <input value={replyTo} onChange={(e) => setReplyTo(e.target.value)} placeholder={t("replyToPh")} style={{ flex: "1 1 200px" }} aria-label={t("replyTo")} />
        <button
          className="btn ghost sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              await setSenderIdentity(weddingId, { senderName, replyTo });
              onSaved();
            })
          }
        >
          {pending ? "…" : t("saveSender")}
        </button>
      </div>

      <div className="eyebrow" style={{ marginTop: 14 }}>{t("previewTitle")}</div>
      <p style={{ fontSize: 12.5, color: "var(--ink2)", margin: "4px 0 6px" }}>{t("previewHint")}</p>
      {state.previewApprovedAt ? (
        <p style={{ fontSize: 12.5, color: "var(--hunter)" }} role="status">
          {t("approvedOn", {
            date: format.dateTime(new Date(state.previewApprovedAt), { day: "numeric", month: "long", year: "numeric" }),
            name: state.previewApprovedBy ?? ""
          })}
        </p>
      ) : (
        <button
          className="btn ghost sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const r = await previewReminderEmail(weddingId);
              if (r.ok) {
                setPreview({ from: r.from, replyTo: r.replyTo, subject: r.subject, text: r.text });
                setPreviewWord(null);
              } else {
                setPreview(null);
                setPreviewWord(r.reason === "no_payments" ? t("previewNoPayments") : t("needsMigration"));
              }
            })
          }
        >
          {pending ? "…" : t("previewShow")}
        </button>
      )}
      {previewWord && <p style={{ fontSize: 12.5, color: "var(--bronze)", marginTop: 6 }}>{previewWord}</p>}
      {preview && !state.previewApprovedAt && (
        <div style={{ marginTop: 10, padding: "12px 14px", border: "1px solid var(--champagne)", background: "var(--parchment)" }}>
          <p style={{ fontSize: 12.5, margin: 0 }}>
            <b style={{ fontWeight: 500 }}>{t("fromLabel")}</b> {preview.from}
            {preview.replyTo && (
              <>
                {" · "}
                <b style={{ fontWeight: 500 }}>{t("replyLabel")}</b> {preview.replyTo}
              </>
            )}
          </p>
          <p style={{ fontSize: 12.5, margin: "4px 0 8px" }}>
            <b style={{ fontWeight: 500 }}>{t("subjectLabel")}</b> {preview.subject}
          </p>
          <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 13.5, margin: 0 }}>{preview.text}</pre>
          <button
            className="btn sm"
            style={{ marginTop: 10 }}
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await approveReminderPreview(weddingId);
                setPreview(null);
                onSaved();
              })
            }
          >
            {t("approve")}
          </button>
        </div>
      )}
    </>
  );
}
