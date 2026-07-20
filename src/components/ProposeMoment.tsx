"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { proposeMoment } from "@/app/actions/schedule";

const TIMES = [
  "09:00", "09:30", "10:00", "10:30", "11:00", "11:30",
  "14:00", "14:30", "15:00", "15:30", "16:00", "16:30",
  "17:00", "17:30", "18:00", "18:30"
];

/**
 * "Propose a moment" — an aesthetic month calendar (weekends softened),
 * a duration, and precise 30-minute slots shown in the client's time
 * zone, crossed with Estelle's Google Calendar: only her open slots
 * remain selectable.
 */
export function ProposeMoment({ weddingId, timezone }: { weddingId: string; timezone: string }) {
  const t = useTranslations("home.propose");
  const locale = useLocale();

  const today = useMemo(() => new Date(), []);
  const [monthOffset, setMonthOffset] = useState(1); // open on next month
  const [selDates, setSelDates] = useState<string[]>([]);
  const [duration, setDuration] = useState<30 | 60>(30);
  const [selSlots, setSelSlots] = useState<{ date: string; time: string }[]>([]);
  const [busyTimes, setBusyTimes] = useState<Record<string, string[]>>({});
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);

  const monthDate = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);
  const monthKey = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, "0")}`;
  const monthLabel = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(monthDate);
  const daysInMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();
  const firstWeekday = (monthDate.getDay() + 6) % 7; // Monday first

  const activeDate = selDates[selDates.length - 1] ?? null;

  // Only Estelle's free slots appear: fetch her busy windows per chosen day.
  useEffect(() => {
    if (!activeDate || busyTimes[activeDate]) return;
    fetch(`/api/schedule/busy?date=${activeDate}`)
      .then((r) => (r.ok ? r.json() : { busy: [] }))
      .then((d) => setBusyTimes((m) => ({ ...m, [activeDate]: d.busy ?? [] })))
      .catch(() => setBusyTimes((m) => ({ ...m, [activeDate]: [] })));
  }, [activeDate, busyTimes]);

  const toggleDate = (day: number) => {
    const iso = `${monthKey}-${String(day).padStart(2, "0")}`;
    setSelDates((list) =>
      list.includes(iso) ? list.filter((d) => d !== iso) : [...list, iso]
    );
  };

  const toggleSlot = (time: string) => {
    if (!activeDate) return;
    setSelSlots((list) => {
      const exists = list.some((s) => s.date === activeDate && s.time === time);
      return exists
        ? list.filter((s) => !(s.date === activeDate && s.time === time))
        : [...list, { date: activeDate, time }];
    });
  };

  async function send() {
    if (selSlots.length === 0 || sending) return;
    setSending(true);
    const r = await proposeMoment({ weddingId, durationMinutes: duration, slots: selSlots });
    setSending(false);
    if (r.ok) {
      setSent(true);
      setSelSlots([]);
      setSelDates([]);
    }
  }

  const clientTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return (
    <div className="card" style={{ marginTop: 18 }} id="propose">
      <div className="eyebrow">{t("title")}</div>
      <p style={{ fontSize: 13, color: "var(--ink2)", marginTop: 6 }}>{t("blurb")}</p>
      <div style={{ maxWidth: 420 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginTop: 14 }}>
          <div className="serif" style={{ fontSize: 18, flex: 1 }}>{monthLabel}</div>
          <button className="addnote" onClick={() => setMonthOffset((v) => Math.max(0, v - 1))} aria-label={t("prevMonth")}>←</button>
          <button className="addnote" onClick={() => setMonthOffset((v) => v + 1)} aria-label={t("nextMonth")}>→</button>
        </div>
        <div className="cal">
          {(t.raw("weekdays") as string[]).map((d, i) => (
            <b key={i}>{d}</b>
          ))}
          {Array.from({ length: firstWeekday }).map((_, i) => (
            <span key={`pad${i}`} className="off" />
          ))}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = i + 1;
            const iso = `${monthKey}-${String(day).padStart(2, "0")}`;
            const date = new Date(monthDate.getFullYear(), monthDate.getMonth(), day);
            const isPast = date < today;
            const weekend = date.getDay() === 0 || date.getDay() === 6;
            return (
              <button
                key={day}
                className={`${isPast ? "off" : ""}${selDates.includes(iso) ? " sel" : ""}${weekend && !selDates.includes(iso) ? " we" : ""}`}
                onClick={() => toggleDate(day)}
                disabled={isPast}
              >
                {day}
              </button>
            );
          })}
        </div>
        <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span className="eyebrow">{t("durationLabel")}</span>
          <div className="slots" style={{ marginTop: 0 }}>
            <button className={duration === 30 ? "sel" : undefined} onClick={() => setDuration(30)}>
              {t("min30")}
            </button>
            <button className={duration === 60 ? "sel" : undefined} onClick={() => setDuration(60)}>
              {t("hour1")}
            </button>
          </div>
        </div>
        {activeDate && (
          <>
            <div className="eyebrow" style={{ marginTop: 16 }}>
              {t("hoursLabel", { date: activeDate })}
            </div>
            <div className="slots">
              {TIMES.map((time) => {
                const taken = (busyTimes[activeDate] ?? []).includes(time);
                const on = selSlots.some((s) => s.date === activeDate && s.time === time);
                return (
                  <button
                    key={time}
                    className={on ? "sel" : undefined}
                    disabled={taken}
                    onClick={() => toggleSlot(time)}
                  >
                    {time}
                  </button>
                );
              })}
            </div>
          </>
        )}
        <p style={{ fontSize: 11.5, color: "var(--ink2)", marginTop: 10 }}>
          {t("tzNote", { tz: clientTz, houseTz: timezone })}
        </p>
        <div style={{ marginTop: 16, display: "flex", gap: 12, alignItems: "center" }}>
          <button className="btn" onClick={send} disabled={selSlots.length === 0 || sending}>
            {sending ? "…" : t("send")}
          </button>
          {sent && <span style={{ fontSize: 12.5, color: "var(--bronze)" }}>{t("sent")}</span>}
        </div>
      </div>
    </div>
  );
}
