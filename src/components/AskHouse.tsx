"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Dictate } from "@/components/Dictate";

/**
 * "Ask the house" — the client-facing assistant. It only ever sees the
 * published material of this wedding (enforced server-side in the API
 * route, which queries with the caller's own RLS-bound session).
 */
export function AskHouse({ weddingId }: { weddingId: string }) {
  const t = useTranslations("home.ask");
  const [answer, setAnswer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function ask() {
    const q = inputRef.current?.value.trim();
    if (!q || busy) return;
    setBusy(true);
    setAnswer(null);
    try {
      const r = await fetch("/api/agents/ask", {
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
    // Team only, and marked so: the couple's experience never includes
    // an agent, and Client view must preview exactly what they see.
    <div className="ia team-only">
      <div className="eyebrow">{t("title")}</div>
      <p style={{ marginTop: 8, fontSize: 13.5 }}>{t("blurb")}</p>
      <div className="assist">
        <Dictate title={t("ask")} onText={(x) => { if (inputRef.current) inputRef.current.value += x; }} />
        <input ref={inputRef} placeholder={t("placeholder")} onKeyDown={(e) => e.key === "Enter" && ask()} />
        <button className="btn" onClick={ask} disabled={busy}>
          {busy ? "…" : t("ask")}
        </button>
        <a className="btn ghost" href="#propose">
          {t("scheduleCall")}
        </a>
      </div>
      {answer && (
        <p className="ia-quote" style={{ marginTop: 14 }} aria-live="polite">
          &ldquo;{answer}&rdquo;
        </p>
      )}
      <p style={{ fontSize: 12.5, color: "var(--ink2)", marginTop: 8 }}>{t("meetNote")}</p>
    </div>
  );
}
