"use client";

import { useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import type { WeddingEvent } from "@/lib/types";
import { addGuest, stationerReview } from "@/app/actions/guests";

const TITLES = [
  "Mr. and Mrs.", "Mrs.", "Mr.", "Ms.",
  "Doctor and Mrs.", "The Honourable", "Lord and Lady",
  "Monsieur et Madame", "Le Docteur et Madame", "Maître et Madame"
];

/** Add a guest household — master-stationer standard. */
export function AddGuestForm({
  weddingId,
  events,
  languages
}: {
  weddingId: string;
  events: WeddingEvent[];
  languages: string[];
}) {
  const t = useTranslations("guests.add");
  const [title, setTitle] = useState(TITLES[0]);
  const [names, setNames] = useState("");
  const [line, setLine] = useState("");
  const [lineTouched, setLineTouched] = useState(false);
  const [address, setAddress] = useState("");
  const [locale, setLocale] = useState(languages[0] ?? "en");
  const [travel, setTravel] = useState("");
  const [selEvents, setSelEvents] = useState<string[]>(events.map((e) => e.id));
  const suggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pending, startTransition] = useTransition();

  // The house suggests the envelope line as the names are typed —
  // per stationery conventions, always editable.
  function scheduleSuggest(nextNames: string, nextTitle: string, nextLocale: string) {
    if (lineTouched) return;
    if (suggestTimer.current) clearTimeout(suggestTimer.current);
    suggestTimer.current = setTimeout(async () => {
      const [firstNames, ...rest] = nextNames.trim().split(/\s+and\s+|\s+et\s+/i);
      const surname = nextNames.trim().split(/\s+/).slice(-1)[0] ?? "";
      if (!nextNames.trim()) return;
      try {
        const r = await fetch("/api/agents/invitation-line", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            weddingId,
            title: nextTitle,
            firstNames: firstNames + (rest.length ? ` and ${rest.join(" ")}` : ""),
            surname,
            locale: nextLocale
          })
        });
        const d = await r.json();
        if (d.text && !lineTouched) setLine(d.text);
      } catch {
        /* the fallback below stands */
      }
    }, 900);
    // Immediate conventional fallback while the agent thinks.
    const surname = nextNames.trim().split(/\s+/).slice(-1)[0] ?? "";
    const first = nextNames.trim().split(/\s+/)[0] ?? "";
    if (first && surname) setLine(`${nextTitle} ${first} ${surname}`);
  }

  const toggleEvent = (id: string) =>
    setSelEvents((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));

  function submit() {
    const [firstNames] = [names.trim()];
    const surname = names.trim().split(/\s+/).slice(-1)[0] ?? "";
    startTransition(async () => {
      const r = await addGuest({
        weddingId,
        title,
        firstNames,
        surname,
        invitationLine: line,
        address,
        locale,
        travel,
        eventIds: selEvents
      });
      if (r.ok) {
        setNames("");
        setLine("");
        setLineTouched(false);
        setAddress("");
        setTravel("");
      }
    });
  }

  return (
    <div className="card">
      <div className="eyebrow" style={{ marginBottom: 16 }}>{t("title")}</div>
      <div className="grid2" style={{ gap: 14 }}>
        <div className="field">
          <label className="eyebrow">{t("titleField")}</label>
          <select
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              scheduleSuggest(names, e.target.value, locale);
            }}
          >
            {TITLES.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="eyebrow">{t("namesField")}</label>
          <input
            value={names}
            onChange={(e) => {
              setNames(e.target.value);
              scheduleSuggest(e.target.value, title, locale);
            }}
            placeholder={t("namesPlaceholder")}
          />
        </div>
        <div className="field" style={{ gridColumn: "1 / -1" }}>
          <label className="eyebrow">{t("lineField")}</label>
          <input
            className="suggested"
            value={line}
            onChange={(e) => {
              setLine(e.target.value);
              setLineTouched(true);
            }}
          />
          <span style={{ fontSize: 11.5, color: "var(--bronze)" }}>{t("lineHint")}</span>
        </div>
        <div className="field">
          <label className="eyebrow">{t("addressField")}</label>
          <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder={t("addressPlaceholder")} />
        </div>
        <div className="field">
          <label className="eyebrow">{t("localeField")}</label>
          <select
            value={locale}
            onChange={(e) => {
              setLocale(e.target.value);
              scheduleSuggest(names, title, e.target.value);
            }}
          >
            {[...new Set([...languages, "en", "fr"])].map((l) => (
              <option key={l} value={l}>
                {t(`locales.${l}`, { fallback: l })}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="eyebrow">{t("invitedField")}</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", paddingTop: 4 }}>
            {events.map((event) => (
              <button
                key={event.id}
                type="button"
                className={`tag${selEvents.includes(event.id) ? " ok" : ""}`}
                style={{ cursor: "pointer" }}
                onClick={() => toggleEvent(event.id)}
                aria-pressed={selEvents.includes(event.id)}
              >
                {event.name}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label className="eyebrow">{t("travelField")}</label>
          <input value={travel} onChange={(e) => setTravel(e.target.value)} placeholder={t("travelPlaceholder")} />
        </div>
      </div>
      <div style={{ marginTop: 20 }}>
        <button className="btn" onClick={submit} disabled={pending || !names.trim()}>
          {pending ? "…" : t("submit")}
        </button>
      </div>
    </div>
  );
}

/** Team: run the stationer's eye over the whole list. */
export function StationerReview({ weddingId, latestFlag }: { weddingId: string; latestFlag: string | null }) {
  const t = useTranslations("guests.stationer");
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="ia">
      <div className="eyebrow">{t("title")}</div>
      <p style={{ marginTop: 8, fontSize: 13.5 }}>{t("blurb")}</p>
      {(latestFlag || note) && (
        <>
          <hr className="hair" />
          <p className="ia-quote" aria-live="polite">&ldquo;{note ?? latestFlag}&rdquo;</p>
        </>
      )}
      <div className="team-only" style={{ marginTop: 12 }}>
        <button
          className="btn ghost sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const r = await stationerReview(weddingId);
              setNote(r.note);
            })
          }
        >
          {pending ? "…" : t("run")}
        </button>
      </div>
    </div>
  );
}
