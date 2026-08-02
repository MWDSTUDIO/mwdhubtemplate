"use client";

import { useState, useTransition } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import type { Attention } from "@/lib/types";
import { dismissAttention, entrustAttention, resolveAttention, settleAttention, snoozeAttention } from "@/app/actions/timeline";
import { Dictate } from "@/components/Dictate";

/** Your attentions — never "tasks", never "pending". */
export function Attentions({
  attentions,
  weddingId,
  isTeam,
  isClient
}: {
  attentions: Attention[];
  weddingId: string;
  isTeam: boolean;
  isClient: boolean;
}) {
  const t = useTranslations("timeline.attentions");
  const format = useFormatter();
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [link, setLink] = useState("");
  const [status, setStatus] = useState<"awaiting_word" | "at_leisure">("at_leisure");
  const [urgency, setUrgency] = useState<"standard" | "high">("standard");
  const [showAside, setShowAside] = useState(false);
  const [pending, startTransition] = useTransition();

  // Dismissed and snoozed attentions rest aside (§9) — the couple
  // never sees them at all; the team may unfold them.
  const today = new Date().toISOString().slice(0, 10);
  const isAside = (a: Attention) => Boolean(a.dismissed) || Boolean(a.snoozed_until && a.snoozed_until > today);
  const shown = attentions.filter((a) => (isTeam && showAside ? true : !isAside(a)));
  const asideCount = attentions.filter(isAside).length;

  const statusTag = (s: Attention["status"]) =>
    s === "awaiting_word" ? (
      <span className="tag wait" style={{ marginLeft: "auto" }}>{t("awaiting")}</span>
    ) : s === "at_leisure" ? (
      <span className="tag" style={{ marginLeft: "auto" }}>{t("leisure")}</span>
    ) : (
      <span className="tag ok" style={{ marginLeft: "auto" }}>{t("attended")}</span>
    );

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
        <div className="eyebrow">{t("title")}</div>
        {isTeam && (
          <button className="btn ghost sm team-only" onClick={() => setAdding((v) => !v)}>
            {t("entrust")}
          </button>
        )}
      </div>
      {adding && (
        <div className="assist team-only">
          <Dictate title={t("entrust")} onText={(x) => setTitle((v) => (v ? v.trimEnd() + " " + x : x))} />
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("entrustPlaceholder")}
          />
          <input
            type="date"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            style={{ flex: "0 0 150px", minWidth: 150 }}
          />
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as typeof status)}
            style={{ padding: "12px 10px", border: "1px solid var(--line)", background: "#fff" }}
          >
            <option value="at_leisure">{t("leisure")}</option>
            <option value="awaiting_word">{t("awaiting")}</option>
          </select>
          <select
            value={urgency}
            onChange={(e) => setUrgency(e.target.value as typeof urgency)}
            aria-label={t("urgency")}
            style={{ padding: "12px 10px", border: "1px solid var(--line)", background: "#fff" }}
          >
            <option value="standard">{t("urgencyStandard")}</option>
            <option value="high">{t("urgencyHigh")}</option>
          </select>
          <button
            className="btn"
            disabled={pending || !title.trim()}
            onClick={() =>
              startTransition(async () => {
                await entrustAttention({ weddingId, title: title.trim(), due, status, link, urgency });
                setTitle("");
                setDue("");
                setLink("");
                setUrgency("standard");
                setAdding(false);
              })
            }
          >
            {t("entrustGo")}
          </button>
          <input
            type="url"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder={t("linkPlaceholder")}
            style={{ flexBasis: "100%" }}
          />
        </div>
      )}
      <ul className="steps" style={{ marginTop: 12 }}>
        {shown.map((a) => (
          <li key={a.id} style={isAside(a) ? { opacity: 0.55 } : undefined}>
            <span className="d">
              {a.status === "attended"
                ? t("settled")
                : a.due_date
                  ? format.dateTime(new Date(a.due_date), { month: "short", day: "numeric" })
                  : "—"}
            </span>
            <span style={a.status === "attended" ? { color: "var(--ink2)" } : undefined}>
              {a.title}
              {isTeam && a.urgency === "high" && a.status !== "attended" && (
                <span className="tag alert team-only" style={{ marginLeft: 8, borderColor: "var(--bronze)", color: "var(--bronze)" }}>{t("urgencyHigh")}</span>
              )}
              {isTeam && a.owner && (
                <span className="team-only" style={{ marginLeft: 8, fontSize: 12, color: "var(--ink2)" }}>{a.owner}</span>
              )}
              {a.link_url && (
                <a
                  href={a.link_url}
                  target="_blank"
                  rel="noreferrer"
                  style={{ marginLeft: 10, fontSize: 12, color: "var(--bronze)" }}
                >
                  {t("openLink")}
                </a>
              )}
            </span>
            {isClient && a.status !== "attended" ? (
              <button
                className="addnote"
                style={{ marginLeft: "auto" }}
                disabled={pending}
                onClick={() => startTransition(() => settleAttention(a.id))}
              >
                {t("markAttended")}
              </button>
            ) : (
              statusTag(a.status)
            )}
            {isTeam && a.status !== "attended" && (
              <span className="team-only" style={{ display: "inline-flex", gap: 8, marginLeft: 10 }}>
                <button
                  className="addnote"
                  title={t("resolveHint")}
                  disabled={pending}
                  onClick={() => startTransition(async () => { await resolveAttention(a.id); router.refresh(); })}
                >
                  {t("resolve")}
                </button>
                <button
                  className="addnote"
                  title={t("snoozeHint")}
                  disabled={pending}
                  onClick={() => startTransition(async () => { const r = await snoozeAttention(a.id, 7); if (r.needsMigration) window.alert(t("needsMigration")); router.refresh(); })}
                >
                  {t("snooze")}
                </button>
                {!a.dismissed && (
                  <button
                    className="addnote"
                    style={{ color: "var(--bronze)" }}
                    title={t("dismissHint")}
                    disabled={pending}
                    onClick={() => startTransition(async () => { const r = await dismissAttention(a.id); if (r.needsMigration) window.alert(t("needsMigration")); router.refresh(); })}
                  >
                    {t("dismiss")}
                  </button>
                )}
              </span>
            )}
          </li>
        ))}
      </ul>
      {isTeam && asideCount > 0 && (
        <button className="addnote team-only" style={{ marginTop: 6 }} onClick={() => setShowAside((v) => !v)} aria-pressed={showAside}>
          {showAside ? t("hideAside") : t("showAside", { count: asideCount })}
        </button>
      )}
      <p style={{ fontSize: 12, color: "var(--ink2)", marginTop: 10 }}>{t("hint")}</p>
    </div>
  );
}
