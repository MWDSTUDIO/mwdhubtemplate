"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

/** Teamwork: "Let the agent draft the call brief". */
export function CallBrief({
  weddingId,
  callPrepId,
  points
}: {
  weddingId: string;
  callPrepId: string | null;
  points: string[];
}) {
  const t = useTranslations("teamwork");
  const [brief, setBrief] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function draft() {
    if (busy) return;
    setBusy(true);
    try {
      const r = await fetch("/api/agents/call-brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weddingId, callPrepId, points })
      });
      const d = await r.json();
      setBrief(d.text ?? null);
    } catch {
      setBrief(null);
    }
    setBusy(false);
  }

  return (
    <>
      <hr className="hair" />
      <button className="btn ghost" style={{ padding: "9px 18px" }} onClick={draft} disabled={busy}>
        {busy ? "…" : t("draftBrief")}
      </button>
      {brief && (
        <p className="ia-quote" style={{ marginTop: 14, whiteSpace: "pre-wrap" }} aria-live="polite">
          {brief}
        </p>
      )}
    </>
  );
}
