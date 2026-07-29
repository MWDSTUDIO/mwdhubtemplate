"use client";

import React, { useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import type { Guest, GuestEvent, WeddingEvent } from "@/lib/types";
import {
  addGuest,
  deleteGuest,
  setHouseholdRsvp,
  stationerReview,
  updateGuest
} from "@/app/actions/guests";
import { Dictate } from "@/components/Dictate";

const TITLES = [
  "Mr. and Mrs.", "Mrs.", "Mr.", "Ms.",
  "Doctor and Mrs.", "The Honourable", "Lord and Lady",
  "Monsieur et Madame", "Le Docteur et Madame", "Maître et Madame"
];

/** Add a guest household — master-stationer standard. */
export function AddGuestForm({
  weddingId,
  events,
  languages,
  aiSuggest = false
}: {
  weddingId: string;
  events: WeddingEvent[];
  languages: string[];
  /** The stationer's live suggestion — team hands only. */
  aiSuggest?: boolean;
}) {
  const t = useTranslations("guests.add");
  const [title, setTitle] = useState(TITLES[0]);
  const [names, setNames] = useState("");
  const [line, setLine] = useState("");
  const [lineTouched, setLineTouched] = useState(false);
  const [address, setAddress] = useState("");
  const [locale, setLocale] = useState(languages[0] ?? "en");
  const [travel, setTravel] = useState("");
  const [dietary, setDietary] = useState("");
  const [adults, setAdults] = useState("2");
  const [children, setChildren] = useState("0");
  const [selEvents, setSelEvents] = useState<string[]>(events.map((e) => e.id));
  const suggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pending, startTransition] = useTransition();

  // The house suggests the envelope line as the names are typed —
  // per stationery conventions, always editable.
  function scheduleSuggest(nextNames: string, nextTitle: string, nextLocale: string) {
    if (!aiSuggest || lineTouched) return;
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
        dietary,
        partyAdults: Number(adults) || 1,
        partyChildren: Number(children) || 0,
        eventIds: selEvents
      });
      if (r.ok) {
        setNames("");
        setLine("");
        setLineTouched(false);
        setAddress("");
        setTravel("");
        setDietary("");
        setAdults("2");
        setChildren("0");
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
          <span style={{ fontSize: 12.5, color: "var(--bronze)" }}>{t("lineHint")}</span>
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
          <label className="eyebrow" style={{ display: "flex", alignItems: "center", gap: 8 }}>{t("travelField")}<Dictate title={t("travelField")} onText={(x) => setTravel((v) => (v ? v.trimEnd() + " " + x : x))} /></label>
          <input value={travel} onChange={(e) => setTravel(e.target.value)} placeholder={t("travelPlaceholder")} />
        </div>
        <div className="field">
          <label className="eyebrow">{t("partyField")}</label>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="number"
              min={1}
              value={adults}
              onChange={(e) => setAdults(e.target.value)}
              aria-label={t("adults")}
              style={{ flex: "0 0 84px" }}
            />
            <span style={{ fontSize: 12.5, color: "var(--ink2)" }}>{t("adults")}</span>
            <input
              type="number"
              min={0}
              value={children}
              onChange={(e) => setChildren(e.target.value)}
              aria-label={t("children")}
              style={{ flex: "0 0 84px" }}
            />
            <span style={{ fontSize: 12.5, color: "var(--ink2)" }}>{t("children")}</span>
          </div>
        </div>
        <div className="field">
          <label className="eyebrow" style={{ display: "flex", alignItems: "center", gap: 8 }}>{t("dietaryField")}<Dictate title={t("dietaryField")} onText={(x) => setDietary((v) => (v ? v.trimEnd() + " " + x : x))} /></label>
          <input value={dietary} onChange={(e) => setDietary(e.target.value)} placeholder={t("dietaryPlaceholder")} />
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

const RSVP_CYCLE = { pending: "confirmed", confirmed: "declined", declined: "pending" } as const;

/**
 * The list itself — every household can be confirmed in one press
 * (by the house or by the couple), reworked in place, or removed.
 */
export function GuestList({
  weddingId,
  guests,
  events,
  links,
  canManage
}: {
  weddingId: string;
  guests: Guest[];
  events: WeddingEvent[];
  links: GuestEvent[];
  canManage: boolean;
}) {
  const t = useTranslations("guests");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const statusFor = (guest: Guest): "pending" | "confirmed" | "declined" => {
    // The household's own word (a phone call) stands first; otherwise
    // the events speak.
    if (guest.rsvp && guest.rsvp !== "pending") return guest.rsvp;
    const mine = links.filter((l) => l.guest_id === guest.id);
    if (mine.length && mine.every((l) => l.rsvp === "confirmed")) return "confirmed";
    if (mine.some((l) => l.rsvp === "declined")) return "declined";
    return "pending";
  };
  const eventsFor = (guestId: string) =>
    links
      .filter((l) => l.guest_id === guestId)
      .map((l) => events.find((e) => e.id === l.event_id)?.name)
      .filter(Boolean)
      .join(" · ");

  return (
    <div className="card">
      <div className="eyebrow" style={{ marginBottom: 14 }}>{t("theList")}</div>
      <div style={{ overflowX: "auto" }}>
        <table className="sheet-table">
          <thead>
            <tr>
              <th>{t("invitationLine")}</th>
              <th>{t("invitedTo")}</th>
              <th>{t("party")}</th>
              <th>{t("travel")}</th>
              <th>{t("status")}</th>
              {canManage && <th aria-label={t("edit")} />}
            </tr>
          </thead>
          <tbody>
            {guests.map((guest) => {
              const status = statusFor(guest);
              const label =
                status === "confirmed" ? t("confirmed") : status === "declined" ? t("declined") : t("awaitingReply");
              return (
                <React.Fragment key={guest.id}>
                  <tr>
                    <td className="serif" style={{ fontSize: 16 }}>
                      {guest.invitation_line}
                      {guest.dietary && (
                        <span style={{ display: "block", fontSize: 12.5, color: "var(--bronze)", fontFamily: "var(--font-ui)" }}>
                          {guest.dietary}
                        </span>
                      )}
                    </td>
                    <td>{eventsFor(guest.id) || "—"}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {t("partySummary", {
                        adults: guest.party_adults ?? 2,
                        children: guest.party_children ?? 0
                      })}
                    </td>
                    <td>{guest.travel ?? t("toArrange")}</td>
                    <td>
                      {canManage ? (
                        <button
                          type="button"
                          className={`tag${status === "confirmed" ? " ok" : status === "pending" ? " wait" : ""}`}
                          style={{ cursor: "pointer" }}
                          disabled={pending}
                          title={t("cycleHint")}
                          onClick={() =>
                            startTransition(async () => {
                              await setHouseholdRsvp(guest.id, RSVP_CYCLE[status]);
                            })
                          }
                        >
                          {label}
                        </button>
                      ) : (
                        <span className={`tag${status === "confirmed" ? " ok" : status === "pending" ? " wait" : ""}`}>
                          {label}
                        </span>
                      )}
                    </td>
                    {canManage && (
                      <td>
                        <button
                          className="addnote"
                          onClick={() => setEditingId(editingId === guest.id ? null : guest.id)}
                        >
                          {editingId === guest.id ? t("close") : t("edit")}
                        </button>
                      </td>
                    )}
                  </tr>
                  {editingId === guest.id && (
                    <tr>
                      <td colSpan={canManage ? 6 : 5} style={{ background: "var(--parchment)" }}>
                        <GuestEditor
                          weddingId={weddingId}
                          guest={guest}
                          events={events}
                          invited={links.filter((l) => l.guest_id === guest.id).map((l) => l.event_id)}
                          onClose={() => setEditingId(null)}
                        />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GuestEditor({
  weddingId,
  guest,
  events,
  invited,
  onClose
}: {
  weddingId: string;
  guest: Guest;
  events: WeddingEvent[];
  invited: string[];
  onClose: () => void;
}) {
  const t = useTranslations("guests");
  const ta = useTranslations("guests.add");
  const [title, setTitle] = useState(guest.title ?? "");
  const [names, setNames] = useState(
    [guest.first_names, guest.surname].filter(Boolean).join(" ")
  );
  const [line, setLine] = useState(guest.invitation_line ?? "");
  const [address, setAddress] = useState(guest.address ?? "");
  const [travel, setTravel] = useState(guest.travel ?? "");
  const [dietary, setDietary] = useState(guest.dietary ?? "");
  const [adults, setAdults] = useState(String(guest.party_adults ?? 2));
  const [children, setChildren] = useState(String(guest.party_children ?? 0));
  const [selEvents, setSelEvents] = useState<string[]>(invited);
  const [pending, startTransition] = useTransition();

  const toggleEvent = (id: string) =>
    setSelEvents((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));

  return (
    <div style={{ padding: "14px 6px", display: "grid", gap: 10 }}>
      <div className="grid2" style={{ gap: 10 }}>
        <div className="field">
          <label className="eyebrow">{ta("titleField")}</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="field">
          <label className="eyebrow">{ta("namesField")}</label>
          <input value={names} onChange={(e) => setNames(e.target.value)} />
        </div>
        <div className="field" style={{ gridColumn: "1 / -1" }}>
          <label className="eyebrow">{ta("lineField")}</label>
          <input value={line} onChange={(e) => setLine(e.target.value)} />
        </div>
        <div className="field">
          <label className="eyebrow">{ta("addressField")}</label>
          <input value={address} onChange={(e) => setAddress(e.target.value)} />
        </div>
        <div className="field">
          <label className="eyebrow" style={{ display: "flex", alignItems: "center", gap: 8 }}>{ta("travelField")}<Dictate title={ta("travelField")} onText={(x) => setTravel((v) => (v ? v.trimEnd() + " " + x : x))} /></label>
          <input value={travel} onChange={(e) => setTravel(e.target.value)} />
        </div>
        <div className="field">
          <label className="eyebrow">{ta("partyField")}</label>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="number" min={1} value={adults} onChange={(e) => setAdults(e.target.value)} aria-label={ta("adults")} style={{ flex: "0 0 84px" }} />
            <span style={{ fontSize: 12.5, color: "var(--ink2)" }}>{ta("adults")}</span>
            <input type="number" min={0} value={children} onChange={(e) => setChildren(e.target.value)} aria-label={ta("children")} style={{ flex: "0 0 84px" }} />
            <span style={{ fontSize: 12.5, color: "var(--ink2)" }}>{ta("children")}</span>
          </div>
        </div>
        <div className="field">
          <label className="eyebrow" style={{ display: "flex", alignItems: "center", gap: 8 }}>{ta("dietaryField")}<Dictate title={ta("dietaryField")} onText={(x) => setDietary((v) => (v ? v.trimEnd() + " " + x : x))} /></label>
          <input value={dietary} onChange={(e) => setDietary(e.target.value)} placeholder={ta("dietaryPlaceholder")} />
        </div>
        <div className="field">
          <label className="eyebrow">{ta("invitedField")}</label>
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
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button
          className="btn"
          disabled={pending || !names.trim()}
          onClick={() => {
            const surname = names.trim().split(/\s+/).slice(-1)[0] ?? "";
            startTransition(async () => {
              await updateGuest(guest.id, {
                weddingId,
                title,
                firstNames: names.trim(),
                surname,
                invitationLine: line,
                address,
                locale: guest.locale,
                travel,
                dietary,
                partyAdults: Number(adults) || 1,
                partyChildren: Number(children) || 0,
                eventIds: selEvents
              });
              onClose();
            });
          }}
        >
          {pending ? "…" : t("save")}
        </button>
        <button
          className="btn ghost"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              await deleteGuest(guest.id);
              onClose();
            })
          }
        >
          {t("remove")}
        </button>
        <button className="btn ghost" onClick={onClose}>{t("close")}</button>
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
    <div className="ia team-only">
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
