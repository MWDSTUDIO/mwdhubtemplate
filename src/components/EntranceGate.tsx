"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

/**
 * The doors of the house. Hunter-green double door split by a champagne
 * hairline; plaque, staged copy, then the doors part in 1.9s.
 * Shown once per browser session; personalised per wedding.
 */
export function EntranceGate({
  coupleName,
  mediaUrl,
  plaqueUrl
}: {
  coupleName: string;
  mediaUrl?: string | null;
  plaqueUrl?: string | null;
}) {
  const t = useTranslations("gate");
  const [state, setState] = useState<"hidden" | "closed" | "open">("hidden");

  useEffect(() => {
    if (sessionStorage.getItem("mwd_entered")) return;
    setState("closed");
  }, []);

  if (state === "hidden") return null;

  const doorStyle = mediaUrl
    ? { backgroundImage: `linear-gradient(oklch(0.3178 0.0365 157.6 / 0.82), oklch(0.3178 0.0365 157.6 / 0.82)), url(${mediaUrl})` }
    : undefined;

  return (
    <div id="gate" className={state === "open" ? "open" : undefined} aria-hidden={state === "open"}>
      <div className="door l" style={doorStyle} />
      <div className="door r" style={doorStyle} />
      <div className="gate-c">
        {/* Plaque may be replaced per wedding from The Desk. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="plaque"
          src={plaqueUrl || "/brand/plaque.png"}
          alt="Madame Wedding Design"
        />
        <div className="motto serif">{t("motto")}</div>
        <div className="sub">{t("of", { couple: coupleName })}</div>
        <button
          className="enter"
          onClick={() => {
            sessionStorage.setItem("mwd_entered", "1");
            setState("open");
          }}
        >
          {t("enter")}
        </button>
      </div>
    </div>
  );
}
