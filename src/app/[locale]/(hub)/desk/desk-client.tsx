"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import type { Wedding, WeddingEvent } from "@/lib/types";
import { composeTimeline, saveWedding } from "@/app/actions/desk";
import { Dictate } from "@/components/Dictate";

// Suggestions from the house's repertoire — never imposed: every event
// is a free label (rehearsal dinner des hommes, cocktail d'avant-dîner…).
const SUGGESTED_EVENTS = [
  "Welcome", "Welcome dinner", "Rehearsal", "Rehearsal dinner",
  "Cocktail", "Ceremony", "Wedding dinner", "Reception",
  "Brunch", "Farewell", "After party", "Pool day"
];
const LOCALES = ["en", "fr", "zh", "ja", "es"];

interface EventRow {
  name: string;
  date: string;
}

export function ClientSheet({
  wedding,
  events,
  brief
}: {
  wedding: Wedding | null;
  events: WeddingEvent[];
  brief: string;
}) {
  const t = useTranslations("desk");
  const [couple, setCouple] = useState(wedding?.couple_display_name ?? "");
  const [destination, setDestination] = useState(
    wedding ? `${wedding.destination}${wedding.venue ? ` — ${wedding.venue}` : ""}` : ""
  );
  const [dateStart, setDateStart] = useState(wedding?.date_start ?? "");
  const [dateEnd, setDateEnd] = useState(wedding?.date_end ?? "");
  const [locale, setLocale] = useState(wedding?.default_locale ?? "en");
  const [budget, setBudget] = useState(wedding?.budget_total?.toString() ?? "");
  const [eventRows, setEventRows] = useState<EventRow[]>(
    events.length
      ? events.map((e) => ({ name: e.name, date: e.event_date ?? "" }))
      : [{ name: "", date: "" }]
  );
  const [briefText, setBriefText] = useState(brief);
  const [creating, setCreating] = useState(!wedding);
  const [reading, setReading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const setRow = (i: number, patch: Partial<EventRow>) =>
    setEventRows((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function readProposal(file: File) {
    setReading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      if (wedding) form.append("weddingId", wedding.id);
      const r = await fetch("/api/agents/proposal-read", { method: "POST", body: form });
      const d = await r.json();
      const s = d.sheet;
      if (s) {
        if (s.couple_display_name) setCouple(s.couple_display_name);
        if (s.destination) setDestination(`${s.destination}${s.venue ? ` — ${s.venue}` : ""}`);
        if (s.date_start) setDateStart(s.date_start);
        if (s.date_end) setDateEnd(s.date_end);
        if (s.budget_total) setBudget(String(s.budget_total));
        if (Array.isArray(s.events) && s.events.length)
          setEventRows(s.events.map((name: string) => ({ name, date: "" })));
        if (s.brief_draft) setBriefText(s.brief_draft);
      }
    } catch {
      /* the sheet stays as typed */
    }
    setReading(false);
  }

  function submit() {
    const [dest, venue] = destination.split("—").map((x) => x.trim());
    const [a, b] = couple.split(/\s*&\s*|\s+and\s+/i);
    startTransition(async () => {
      const r = await saveWedding({
        id: creating ? undefined : wedding?.id,
        coupleDisplayName: couple,
        partnerA: a ?? couple,
        partnerB: b ?? "",
        destination: dest ?? destination,
        venue: venue ?? "",
        dateStart,
        dateEnd,
        defaultLocale: locale,
        languages: [...new Set([locale, "en"])],
        budgetTotal: budget ? Number(budget) : null,
        events: eventRows
          .map((r) => ({ name: r.name.trim(), date: r.date }))
          .filter((r) => r.name),
        brief: briefText
      });
      if (r.ok) {
        setSaved(true);
        setCreating(false);
      }
    });
  }

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 12 }}>
        <div className="eyebrow" style={{ marginBottom: 16 }}>{t("clientSetup")}</div>
        {wedding && (
          <button className="addnote" onClick={() => setCreating((v) => !v)}>
            {creating ? t("editExisting") : t("newWedding")}
          </button>
        )}
      </div>
      <div className="grid2" style={{ gap: 14 }}>
        <div className="field">
          <label className="eyebrow">{t("couple")}</label>
          <input value={couple} onChange={(e) => setCouple(e.target.value)} placeholder="Camille & Alexander" />
        </div>
        <div className="field">
          <label className="eyebrow">{t("destination")}</label>
          <input value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="Provence — Château" />
        </div>
        <div className="field">
          <label className="eyebrow">{t("dates")}</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)} />
            <input type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} />
          </div>
        </div>
        <div className="field" style={{ gridColumn: "1 / -1" }}>
          <label className="eyebrow">{t("events")}</label>
          <span style={{ display: "block", fontSize: 11.5, color: "var(--ink2)", margin: "2px 0 8px" }}>
            {t("eventsHint")}
          </span>
          {eventRows.map((row, i) => (
            <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <input
                list="event-suggestions"
                value={row.name}
                onChange={(e) => setRow(i, { name: e.target.value })}
                placeholder={t("eventNamePlaceholder")}
                style={{ flex: 1 }}
              />
              <input
                type="date"
                value={row.date}
                onChange={(e) => setRow(i, { date: e.target.value })}
                style={{ flex: "0 0 160px" }}
              />
              <button
                type="button"
                className="addnote"
                aria-label={t("removeEvent")}
                onClick={() => setEventRows((rows) => rows.filter((_, j) => j !== i))}
              >
                ×
              </button>
            </div>
          ))}
          <datalist id="event-suggestions">
            {SUGGESTED_EVENTS.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <button
            type="button"
            className="addnote"
            onClick={() => setEventRows((rows) => [...rows, { name: "", date: "" }])}
          >
            {t("addEvent")}
          </button>
        </div>
        <div className="field">
          <label className="eyebrow">{t("defaultLanguage")}</label>
          <select value={locale} onChange={(e) => setLocale(e.target.value)}>
            {LOCALES.map((l) => (
              <option key={l} value={l}>{l.toUpperCase()}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="eyebrow">{t("budgetTotal")}</label>
          <input type="number" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="720000" />
        </div>
        <div className="field" style={{ gridColumn: "1 / -1" }}>
          <label className="eyebrow" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {t("brief")}
            <Dictate title={t("dictate")} onText={(text) => setBriefText((v) => (v ? `${v.trimEnd()} ${text}` : text))} />
          </label>
          <textarea
            rows={5}
            value={briefText}
            onChange={(e) => setBriefText(e.target.value)}
            placeholder={t("briefPlaceholder")}
          />
          <span style={{ fontSize: 11.5, color: "var(--bronze)" }}>{t("briefHint")}</span>
        </div>
      </div>
      <div style={{ marginTop: 18, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn" onClick={submit} disabled={pending || !couple.trim()}>
          {pending ? "…" : creating ? t("createWedding") : t("saveSheet")}
        </button>
        <label className="btn ghost" style={{ cursor: "pointer" }}>
          {reading ? "…" : t("dropProposal")}
          <input
            type="file"
            hidden
            accept=".pdf,.png,.jpg,.jpeg"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void readProposal(f);
              e.target.value = "";
            }}
          />
        </label>
        {saved && <span style={{ fontSize: 12.5, color: "var(--bronze)" }}>{t("saved")}</span>}
      </div>
      <p style={{ fontSize: 12.5, color: "var(--ink2)", marginTop: 14 }}>{t("proposalHint")}</p>
    </div>
  );
}

export function TimelineComposer({ weddingId }: { weddingId: string }) {
  const t = useTranslations("desk.composer");
  const [result, setResult] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="ia">
      <div className="eyebrow">{t("title")}</div>
      <p style={{ marginTop: 8, fontSize: 13.5 }}>{t("blurb")}</p>
      <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button
          className="btn"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const r = await composeTimeline(weddingId);
              setResult(t("done", { count: r.count }) + (r.note ? ` — ${r.note}` : ""));
            })
          }
        >
          {pending ? t("composing") : t("compose")}
        </button>
        <a className="btn ghost" href="/timeline">
          {t("preview")}
        </a>
      </div>
      {result && (
        <p className="ia-quote" style={{ marginTop: 12 }} aria-live="polite">
          {result}
        </p>
      )}
    </div>
  );
}
