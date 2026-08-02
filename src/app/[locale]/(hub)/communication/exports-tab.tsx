"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { Guest, GuestPerson, PersonEventStatus, WeddingEvent } from "@/lib/types";

/**
 * The export centre (final prompt §B2) — each recipient receives
 * exactly what they need, nothing more. Counts are shown before the
 * click; the completeness eye (§B3) flags the holes and lets pass —
 * Estelle decides. The file itself is composed server-side from the
 * state at that instant, journaled, and unreachable from Client view.
 */

type Status = "attending" | "pending" | "declined";
const norm = (s: string): Status => (s === "invited" ? "pending" : (s as Status));

const CUSTOM_KEYS = [
  "line", "title", "first_names", "surname", "suffix", "email", "phone",
  "address", "city", "country", "locale", "side", "category", "vip",
  "adults", "children", "dietary", "travel", "wished"
];

export function ExportsTab({
  events,
  households,
  persons,
  statuses,
  toast,
  deltaReady
}: {
  events: WeddingEvent[];
  households: Guest[];
  persons: GuestPerson[];
  statuses: PersonEventStatus[];
  toast?: (m: string) => void;
  /** 0025 run: snapshots exist, the delta can be offered. */
  deltaReady?: boolean;
}) {
  const t = useTranslations("communication.exports");
  const [format, setFormat] = useState<"xlsx" | "csv">("xlsx");
  const [catererEv, setCatererEv] = useState(events[0]?.id ?? "");
  const [customFields, setCustomFields] = useState<Set<string>>(new Set(["line", "email", "city", "adults", "children"]));
  const [customEv, setCustomEv] = useState("");
  const [customWished, setCustomWished] = useState(false);
  // C1 · when did a file of each kind last leave the house?
  const [lastLeft, setLastLeft] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!deltaReady) return;
    fetch("/api/exports?kind=raw&meta=1")
      .then((r) => (r.ok ? r.json() : { last: {} }))
      .then((d) => setLastLeft(d.last ?? {}))
      .catch(() => {});
  }, [deltaReady]);

  const live = useMemo(() => households.filter((g) => !g.archived), [households]);
  const st = useMemo(() => {
    const m = new Map<string, Status>();
    for (const s of statuses) m.set(`${s.person_id}:${s.event_id}`, norm(s.status));
    return m;
  }, [statuses]);
  const byHH = useMemo(() => {
    const m = new Map<string, GuestPerson[]>();
    for (const p of persons) {
      const l = m.get(p.household_id) ?? [];
      l.push(p);
      m.set(p.household_id, l);
    }
    return m;
  }, [persons]);

  const anyPending = (g: Guest) =>
    (byHH.get(g.id) ?? []).some((p) => events.some((e) => st.get(`${p.id}:${e.id}`) === "pending"));
  const anyDeclined = (g: Guest) =>
    (byHH.get(g.id) ?? []).some((p) => events.some((e) => st.get(`${p.id}:${e.id}`) === "declined"));
  const missingAddress = live.filter((g) => !(g.address || g.city));
  const wishedNoNote = live.filter((g) => g.accommodation_wished && !g.travel);

  const catererCount = useMemo(() => {
    let n = 0;
    for (const g of live) for (const p of byHH.get(g.id) ?? []) if (st.get(`${p.id}:${catererEv}`)) n++;
    return n;
  }, [live, byHH, st, catererEv]);

  const customCount = useMemo(() => {
    let rows = live;
    if (customWished) rows = rows.filter((g) => g.accommodation_wished);
    if (customEv) rows = rows.filter((g) => (byHH.get(g.id) ?? []).some((p) => st.get(`${p.id}:${customEv}`)));
    return rows.length;
  }, [live, byHH, st, customEv, customWished]);

  const download = (kind: string, count: number, params: Record<string, string> = {}) => {
    if (!window.confirm(t("confirmLeave", { n: count }))) return;
    const q = new URLSearchParams({ kind, format, ...params });
    window.location.href = `/api/exports?${q.toString()}`;
    toast?.(t("toastLeft"));
    setLastLeft((prev) => ({ ...prev, [`${kind}${params.event ? ":" + params.event : ""}`]: new Date().toISOString() }));
  };
  const lastFor = (kind: string, event?: string) => lastLeft[`${kind}${event ? ":" + event : ""}`];

  const warn = (names: string[], key: string) =>
    names.length > 0 && (
      <p style={{ fontSize: 12.5, color: "var(--bronze)", margin: "4px 0 0" }}>
        {t(key, { n: names.length })} — {names.slice(0, 3).join(" · ")}{names.length > 3 ? " …" : ""}
      </p>
    );

  const card = (
    kind: string,
    count: number,
    extra?: React.ReactNode,
    warning?: React.ReactNode,
    params: Record<string, string> = {}
  ) => (
    <div style={{ background: "var(--white, #fffdf9)", border: "1px solid var(--line)", padding: "18px 20px", display: "flex", flexDirection: "column", gap: 8 }}>
      <h3 className="serif" style={{ fontWeight: 500, fontSize: 20, margin: 0 }}>{t(`${kind}Title`)}</h3>
      <p style={{ margin: 0, fontSize: 14, color: "var(--ink2)", flex: 1 }}>{t(`${kind}Blurb`)}</p>
      {extra}
      {warning}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn sm" onClick={() => download(kind, count, params)}>{t("download")}</button>
        {kind !== "template" && lastFor(kind, params.event) && (
          <button className="btn ghost sm" onClick={() => download(kind, count, { ...params, delta: "1" })} title={t("deltaHint")}>
            {t("downloadDelta")}
          </button>
        )}
        <span style={{ fontSize: 12.5, color: "var(--ink2)", fontVariantNumeric: "tabular-nums" }}>{t("rowCount", { n: count })}</span>
      </div>
      {kind !== "template" && lastFor(kind, params.event) && (
        <p style={{ fontSize: 12, color: "var(--ink2)", margin: 0 }}>
          {t("lastLeft", { date: new Date(lastFor(kind, params.event) as string).toLocaleDateString(undefined, { month: "short", day: "numeric" }) })}
        </p>
      )}
    </div>
  );

  const evSelect = (value: string, onChange: (v: string) => void, allowAll = false) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={t("eventWord")} style={{ padding: "5px 8px", border: "1px solid var(--line)", background: "#fff", fontSize: 12.5, alignSelf: "flex-start" }}>
      {allowAll && <option value="">{t("everyEvent")}</option>}
      {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
    </select>
  );

  return (
    <div>
      <div className="toolrow" style={{ border: "1px solid var(--line)", borderBottom: 0, background: "var(--white, #fffdf9)" }}>
        <span style={{ fontSize: 13, color: "var(--ink2)" }}>{t("lead")}</span>
        <span style={{ flex: 1 }} />
        <label style={{ display: "inline-flex", gap: 8, alignItems: "center", fontSize: 12.5, color: "var(--ink2)" }}>
          {t("formatWord")}
          <select value={format} onChange={(e) => setFormat(e.target.value as "xlsx" | "csv")} style={{ padding: "4px 6px", border: "1px solid var(--line)", background: "#fff", fontSize: 12.5 }} aria-label={t("formatWord")}>
            <option value="xlsx">XLSX</option>
            <option value="csv">CSV</option>
          </select>
        </label>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(290px, 1fr))", gap: 14, border: "1px solid var(--line)", borderTop: 0, padding: 16, background: "var(--parchment)" }}>
        {card("stationer", live.length, null, warn(missingAddress.map((g) => g.invitation_line ?? "—"), "warnNoAddress"))}
        {card("caterer", catererCount, evSelect(catererEv, setCatererEv), null, { event: catererEv })}
        {card("venue", events.length)}
        {card("rooming", live.filter((g) => g.accommodation_wished || g.travel).length, null, warn(wishedNoNote.map((g) => g.invitation_line ?? "—"), "warnWishedNoNote"))}
        {card("arrivals", live.filter((g) => g.travel).length)}
        {card("labels", live.length, null, warn(missingAddress.map((g) => g.invitation_line ?? "—"), "warnNoAddress"))}
        {card("pending", live.filter(anyPending).length)}
        {card("declined", live.filter(anyDeclined).length)}
        {card("raw", live.length)}
        {card(
          "custom",
          customCount,
          <div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 10px", margin: "2px 0 8px" }}>
              {CUSTOM_KEYS.map((k) => (
                <label key={k} style={{ display: "inline-flex", gap: 5, alignItems: "center", fontSize: 12 }}>
                  <input
                    type="checkbox"
                    checked={customFields.has(k)}
                    onChange={(e) =>
                      setCustomFields((prev) => {
                        const n = new Set(prev);
                        if (e.target.checked) n.add(k); else n.delete(k);
                        return n;
                      })
                    }
                  />
                  {t(`field_${k}`)}
                </label>
              ))}
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              {evSelect(customEv, setCustomEv, true)}
              <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 12.5 }}>
                <input type="checkbox" checked={customWished} onChange={(e) => setCustomWished(e.target.checked)} />
                {t("wishedOnly")}
              </label>
            </div>
          </div>,
          null,
          {
            fields: [...customFields].join(","),
            ...(customEv ? { event: customEv } : {}),
            ...(customWished ? { wished: "1" } : {})
          }
        )}
        {card("template", 1)}
      </div>
    </div>
  );
}
