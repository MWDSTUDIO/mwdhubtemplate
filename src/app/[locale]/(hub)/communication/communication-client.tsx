"use client";

import { useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { openRoomingList } from "@/app/actions/communication";

export function OpenRoomingButton({ weddingId }: { weddingId: string }) {
  const t = useTranslations("communication.accommodation");
  const tc = useTranslations("common");
  const [pending, startTransition] = useTransition();
  return (
    <div className="team-only" style={{ marginTop: 14 }}>
      <button
        className="btn"
        disabled={pending}
        onClick={() => startTransition(() => openRoomingList(weddingId))}
      >
        {pending ? "…" : t("openRooming")}
      </button>{" "}
      <span className="tag int" style={{ marginLeft: 8 }}>
        {tc("internal")} — {t("yourGoOnly")}
      </span>
    </div>
  );
}

/** The hotel desk — the agent drafts hotelier letters on instruction. */
export function HotelDesk({ weddingId, sample }: { weddingId: string; sample: string }) {
  const t = useTranslations("communication.hotelDesk");
  const tc = useTranslations("common");
  const inputRef = useRef<HTMLInputElement>(null);
  const [letter, setLetter] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function draft() {
    const q = inputRef.current?.value.trim();
    if (!q || busy) return;
    setBusy(true);
    try {
      const r = await fetch("/api/agents/hotel-desk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weddingId, instruction: q })
      });
      const d = await r.json();
      setLetter(d.text ?? null);
    } catch {
      setLetter(null);
    }
    setBusy(false);
  }

  return (
    <div className="ia team-only">
      <div className="eyebrow">
        {t("title")} <span className="tag int">{tc("internal")}</span>
      </div>
      <p style={{ marginTop: 8, fontSize: 13.5 }}>{t("blurb")}</p>
      <hr className="hair" />
      <p className="ia-quote" style={{ whiteSpace: "pre-wrap" }} aria-live="polite">
        &ldquo;{letter ?? sample}&rdquo;
      </p>
      <div className="assist">
        <input ref={inputRef} placeholder={t("placeholder")} onKeyDown={(e) => e.key === "Enter" && draft()} />
        <button className="btn ghost" onClick={draft} disabled={busy}>
          {busy ? "…" : t("draft")}
        </button>
      </div>
    </div>
  );
}
