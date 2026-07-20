"use client";

import { useState, useTransition } from "react";
import { useFormatter, useTranslations } from "next-intl";
import type { Attention } from "@/lib/types";
import { entrustAttention, settleAttention } from "@/app/actions/timeline";
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
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [status, setStatus] = useState<"awaiting_word" | "at_leisure">("at_leisure");
  const [pending, startTransition] = useTransition();

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
          <button
            className="btn"
            disabled={pending || !title.trim()}
            onClick={() =>
              startTransition(async () => {
                await entrustAttention({ weddingId, title: title.trim(), due, status });
                setTitle("");
                setDue("");
                setAdding(false);
              })
            }
          >
            {t("entrustGo")}
          </button>
        </div>
      )}
      <ul className="steps" style={{ marginTop: 12 }}>
        {attentions.map((a) => (
          <li key={a.id}>
            <span className="d">
              {a.status === "attended"
                ? t("settled")
                : a.due_date
                  ? format.dateTime(new Date(a.due_date), { month: "short", day: "numeric" })
                  : "—"}
            </span>
            <span style={a.status === "attended" ? { color: "var(--ink2)" } : undefined}>
              {a.title}
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
          </li>
        ))}
      </ul>
      <p style={{ fontSize: 12, color: "var(--ink2)", marginTop: 10 }}>{t("hint")}</p>
    </div>
  );
}
