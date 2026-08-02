"use client";

import React, { useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import type { Guest, GuestPerson, PersonEventStatus, WeddingEvent } from "@/lib/types";
import {
  addPerson,
  bulkGrid,
  patchPerson,
  removePerson,
  setPersonEventStatus,
  type GridStatus
} from "@/app/actions/guests";

/**
 * The Grid (communication brief §2.5) — the crossed view an organiser
 * actually works with: households in rows, events in columns, and in
 * each cell one person's word — invited · confirmed · declined · no
 * reply — edited with a click that cycles, exactly the Ledger's
 * mechanic. Column feet keep the running answer to "how many at this
 * event, and what do they eat". On a small screen the matrix bows out
 * for a one-event view; never a crushed crosstab at 430 px.
 */

const CYCLE: (GridStatus | null)[] = ["invited", "confirmed", "declined", "no_reply", null];

const GLYPH: Record<GridStatus, { ch: string; color: string }> = {
  invited: { ch: "·", color: "var(--bronze)" },
  confirmed: { ch: "✓", color: "var(--hunter)" },
  declined: { ch: "✕", color: "var(--bronze)" },
  no_reply: { ch: "?", color: "var(--ink2)" }
};

export function GuestGrid({
  weddingId,
  events,
  households,
  persons,
  statuses
}: {
  weddingId: string;
  events: WeddingEvent[];
  households: Guest[];
  persons: GuestPerson[];
  statuses: PersonEventStatus[];
}) {
  const t = useTranslations("guests.grid");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"" | GridStatus | "no_reply_yet" | "changed">("");
  const [filterEvent, setFilterEvent] = useState("");
  const [mobileEvent, setMobileEvent] = useState(events[0]?.id ?? "");
  const [editing, setEditing] = useState<{ id: string; field: "full_name" | "dietary" } | null>(null);
  const [draft, setDraft] = useState("");

  const byHousehold = useMemo(() => {
    const m = new Map<string, GuestPerson[]>();
    for (const p of persons) {
      const list = m.get(p.household_id) ?? [];
      list.push(p);
      m.set(p.household_id, list);
    }
    for (const list of m.values()) list.sort((a, b) => a.sort - b.sort || (a.created_at ?? "").localeCompare(b.created_at ?? ""));
    return m;
  }, [persons]);

  const statusMap = useMemo(() => {
    const m = new Map<string, PersonEventStatus>();
    for (const s of statuses) m.set(`${s.person_id}:${s.event_id}`, s);
    return m;
  }, [statuses]);

  const st = (personId: string, eventId: string): GridStatus | null =>
    statusMap.get(`${personId}:${eventId}`)?.status ?? null;

  const personName = (p: GuestPerson, g: Guest | undefined, idx: number) =>
    p.full_name ||
    (idx === 0 && g ? [g.first_names, g.surname].filter(Boolean).join(" ") : "") ||
    t(p.kind === "child" ? "unnamedChild" : "unnamedAdult");

  const householdLabel = (g: Guest) =>
    g.invitation_line || [g.title, g.first_names, g.surname].filter(Boolean).join(" ") || t("unnamedHousehold");

  const recently = (iso: string | undefined) =>
    !!iso && Date.now() - new Date(iso).getTime() < 7 * 24 * 3600 * 1000;

  const matchesFilter = (p: GuestPerson): boolean => {
    if (!filter && !filterEvent) return true;
    const evs = filterEvent ? [filterEvent] : events.map((e) => e.id);
    return evs.some((ev) => {
      const s = statusMap.get(`${p.id}:${ev}`);
      if (!s) return false;
      if (!filter) return true;
      if (filter === "no_reply_yet") return s.status === "invited" || s.status === "no_reply";
      if (filter === "changed") return recently(s.updated_at);
      return s.status === filter;
    });
  };

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return households.filter((g) => {
      const ps = byHousehold.get(g.id) ?? [];
      const nameHit =
        !q ||
        householdLabel(g).toLowerCase().includes(q) ||
        ps.some((p) => (p.full_name ?? "").toLowerCase().includes(q));
      return nameHit && (!(filter || filterEvent) || ps.some(matchesFilter));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [households, byHousehold, search, filter, filterEvent, statusMap]);

  const cycle = (personId: string, eventId: string) => {
    const cur = st(personId, eventId);
    const next = CYCLE[(CYCLE.indexOf(cur) + 1) % CYCLE.length];
    startTransition(async () => {
      await setPersonEventStatus(weddingId, personId, eventId, next);
      router.refresh();
    });
  };

  const foot = (eventId: string) => {
    const invited = persons.filter((p) => st(p.id, eventId) !== null);
    const n = (s: GridStatus) => invited.filter((p) => st(p.id, eventId) === s).length;
    const confirmed = invited.filter((p) => st(p.id, eventId) === "confirmed");
    const adults = confirmed.filter((p) => p.kind !== "child").length;
    const children = confirmed.filter((p) => p.kind === "child").length;
    const diets = new Map<string, number>();
    for (const p of confirmed) {
      const d = (p.dietary ?? "").trim();
      if (d) diets.set(d, (diets.get(d) ?? 0) + 1);
    }
    return { confirmed: n("confirmed"), awaiting: n("invited") + n("no_reply"), declined: n("declined"), adults, children, covers: adults + children, diets };
  };

  const toggleSelect = (ids: string[], on: boolean) =>
    setSelected((prev) => {
      const n = new Set(prev);
      for (const id of ids) { if (on) n.add(id); else n.delete(id); }
      return n;
    });

  const commitEdit = () => {
    if (!editing) return;
    const { id, field } = editing;
    const p = persons.find((x) => x.id === id);
    const prev = p ? ((p as unknown as Record<string, unknown>)[field] as string | null) ?? "" : "";
    setEditing(null);
    if (draft === prev) return;
    startTransition(async () => {
      await patchPerson(id, weddingId, field, draft);
      router.refresh();
    });
  };

  const editable = (p: GuestPerson, field: "full_name" | "dietary", display: string, italicWhenEmpty = false) => {
    if (editing?.id === p.id && editing.field === field) {
      return (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commitEdit(); }
            else if (e.key === "Escape") setEditing(null);
          }}
          onBlur={commitEdit}
          style={{ width: "100%", minWidth: 70, fontSize: 12.5, padding: "3px 5px", border: "1px solid var(--champagne)" }}
          aria-label={t(field === "full_name" ? "personName" : "personDietary")}
        />
      );
    }
    const empty = !((p as unknown as Record<string, unknown>)[field] as string | null);
    return (
      <span
        role="button"
        tabIndex={0}
        title={t("cellHint")}
        onClick={() => { setEditing({ id: p.id, field }); setDraft(((p as unknown as Record<string, unknown>)[field] as string | null) ?? ""); }}
        onKeyDown={(e) => { if (e.key === "Enter") { setEditing({ id: p.id, field }); setDraft(((p as unknown as Record<string, unknown>)[field] as string | null) ?? ""); } }}
        style={{ cursor: "text", fontStyle: italicWhenEmpty && empty ? "italic" : undefined, color: empty ? "var(--ink2)" : undefined }}
      >
        {display}
      </span>
    );
  };

  const statusCell = (p: GuestPerson, eventId: string) => {
    const s = st(p.id, eventId);
    const label = s ? t(`status_${s}`) : t("status_none");
    return (
      <td key={eventId} style={{ textAlign: "center" }}>
        <button
          className="addnote"
          disabled={pending}
          onClick={() => cycle(p.id, eventId)}
          title={`${label} — ${t("cycleHint")}`}
          aria-label={`${label} — ${t("cycleHint")}`}
          style={{ minWidth: 30, fontSize: 14, color: s ? GLYPH[s].color : "var(--line)", fontWeight: s === "confirmed" ? 600 : 400 }}
        >
          {s ? GLYPH[s].ch : "—"}
        </button>
      </td>
    );
  };

  const bulkAct = (action: Parameters<typeof bulkGrid>[2]) =>
    startTransition(async () => {
      await bulkGrid(weddingId, [...selected], action);
      setSelected(new Set());
      router.refresh();
    });

  if (!events.length) return null;

  return (
    <div className="card team-only">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
        <div className="eyebrow">{t("title")}</div>
        <span style={{ fontSize: 12, color: "var(--ink2)" }}>{t("hint")}</span>
      </div>

      {/* ── filters: the two real questions of the last weeks ── */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("search")}
          aria-label={t("search")}
          style={{ padding: "5px 8px", border: "1px solid var(--line)", fontSize: 12.5, minWidth: 160 }}
        />
        <select value={filterEvent} onChange={(e) => setFilterEvent(e.target.value)} aria-label={t("filterEvent")} style={{ padding: "5px 6px", border: "1px solid var(--line)", background: "#fff", fontSize: 12 }}>
          <option value="">{t("filterEvent")}</option>
          {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
        </select>
        <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label={t("filterStatus")} style={{ padding: "5px 6px", border: "1px solid var(--line)", background: "#fff", fontSize: 12 }}>
          <option value="">{t("filterStatus")}</option>
          <option value="confirmed">{t("status_confirmed")}</option>
          <option value="declined">{t("status_declined")}</option>
          <option value="no_reply_yet">{t("noReplyYet")}</option>
          <option value="changed">{t("changedLately")}</option>
        </select>
        {(filter || filterEvent || search) && (
          <button className="addnote" onClick={() => { setFilter(""); setFilterEvent(""); setSearch(""); }}>{t("clearFilters")}</button>
        )}
      </div>

      {/* ── the serial hand ── */}
      {selected.size > 0 && (
        <div role="toolbar" aria-label={t("bulkTitle")} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "8px 10px", background: "var(--parchment)", border: "1px solid var(--line)", marginBottom: 10 }}>
          <span style={{ fontSize: 12.5 }}>{t("bulkCount", { n: selected.size })}</span>
          <select defaultValue="" onChange={(e) => { if (e.target.value) bulkAct({ kind: "invite", eventId: e.target.value }); e.target.value = ""; }} aria-label={t("bulkInvite")} style={{ padding: "4px 6px", border: "1px solid var(--line)", background: "#fff", fontSize: 12 }}>
            <option value="">{t("bulkInvite")}</option>
            {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
          </select>
          <select defaultValue="" onChange={(e) => { if (e.target.value) bulkAct({ kind: "withdraw", eventId: e.target.value }); e.target.value = ""; }} aria-label={t("bulkWithdraw")} style={{ padding: "4px 6px", border: "1px solid var(--line)", background: "#fff", fontSize: 12 }}>
            <option value="">{t("bulkWithdraw")}</option>
            {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
          </select>
          <select defaultValue="" onChange={(e) => { const [eventId, status] = e.target.value.split("|"); if (status) bulkAct({ kind: "status", eventId, status: status as GridStatus }); e.target.value = ""; }} aria-label={t("bulkStatus")} style={{ padding: "4px 6px", border: "1px solid var(--line)", background: "#fff", fontSize: 12 }}>
            <option value="">{t("bulkStatus")}</option>
            {events.map((ev) => (
              <optgroup key={ev.id} label={ev.name}>
                {(["confirmed", "declined", "no_reply", "invited"] as GridStatus[]).map((s) => (
                  <option key={s} value={`${ev.id}|${s}`}>{t(`status_${s}`)}</option>
                ))}
              </optgroup>
            ))}
          </select>
          <button className="addnote" onClick={() => setSelected(new Set())}>{t("bulkClear")}</button>
        </div>
      )}

      {/* ── the matrix (hidden on a small screen) ── */}
      <div className="gg-matrix" style={{ overflowX: "auto", maxHeight: 520, overflowY: "auto", border: "1px solid var(--line)" }}>
        <table className="sheet-table" style={{ fontSize: 12.5, borderCollapse: "separate", borderSpacing: 0 }}>
          <thead>
            <tr>
              <th style={{ position: "sticky", top: 0, left: 0, zIndex: 3, background: "var(--parchment)", minWidth: 210 }}>{t("colHousehold")}</th>
              {events.map((ev) => (
                <th key={ev.id} style={{ position: "sticky", top: 0, zIndex: 2, background: "var(--parchment)", textAlign: "center", minWidth: 72 }}>{ev.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((g) => {
              const ps = byHousehold.get(g.id) ?? [];
              const open = expanded.has(g.id);
              const allSel = ps.length > 0 && ps.every((p) => selected.has(p.id));
              return (
                <React.Fragment key={g.id}>
                  <tr>
                    <td style={{ position: "sticky", left: 0, zIndex: 1, background: "var(--paper, #fff)", whiteSpace: "nowrap" }}>
                      <input
                        type="checkbox"
                        checked={allSel}
                        onChange={(e) => toggleSelect(ps.map((p) => p.id), e.target.checked)}
                        aria-label={t("selectHousehold")}
                        style={{ marginRight: 6 }}
                      />
                      <button
                        className="addnote"
                        onClick={() => setExpanded((prev) => { const n = new Set(prev); if (n.has(g.id)) n.delete(g.id); else n.add(g.id); return n; })}
                        aria-expanded={open}
                        style={{ fontWeight: 500 }}
                      >
                        {open ? "▾" : "▸"} {householdLabel(g)}
                      </button>
                      <span style={{ marginLeft: 6, fontSize: 11, color: "var(--ink2)" }}>{t("personsCount", { n: ps.length })}</span>
                    </td>
                    {events.map((ev) => {
                      const invited = ps.filter((p) => st(p.id, ev.id) !== null);
                      const conf = invited.filter((p) => st(p.id, ev.id) === "confirmed").length;
                      return (
                        <td key={ev.id} style={{ textAlign: "center", color: invited.length === 0 ? "var(--line)" : conf === invited.length ? "var(--hunter)" : "var(--ink2)" }}>
                          {invited.length === 0 ? "—" : (
                            <button className="addnote" onClick={() => setExpanded((prev) => new Set(prev).add(g.id))} title={t("aggregateHint")} style={{ color: "inherit", fontVariantNumeric: "tabular-nums" }}>
                              {conf}/{invited.length}
                            </button>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                  {open && ps.map((p, idx) => (
                    <tr key={p.id} style={{ background: "var(--parchment)" }}>
                      <td style={{ position: "sticky", left: 0, zIndex: 1, background: "var(--parchment)", paddingLeft: 34, whiteSpace: "nowrap" }}>
                        <input
                          type="checkbox"
                          checked={selected.has(p.id)}
                          onChange={(e) => toggleSelect([p.id], e.target.checked)}
                          aria-label={t("selectPerson")}
                          style={{ marginRight: 6 }}
                        />
                        {editable(p, "full_name", personName(p, g, idx), true)}
                        <select
                          value={p.kind}
                          disabled={pending}
                          onChange={(e) => startTransition(async () => { await patchPerson(p.id, weddingId, "kind", e.target.value); router.refresh(); })}
                          aria-label={t("personKind")}
                          style={{ marginLeft: 8, padding: "2px 4px", border: "1px solid var(--line)", background: "#fff", fontSize: 11 }}
                        >
                          <option value="adult">{t("adult")}</option>
                          <option value="child">{t("child")}</option>
                        </select>
                        <span style={{ marginLeft: 8, fontSize: 11.5 }}>
                          {editable(p, "dietary", p.dietary || t("addDietary"), true)}
                        </span>
                        <button
                          className="addnote"
                          disabled={pending}
                          style={{ marginLeft: 8, color: "var(--bronze)" }}
                          title={t("removePerson")}
                          aria-label={t("removePerson")}
                          onClick={() => { if (window.confirm(t("removePersonConfirm"))) startTransition(async () => { await removePerson(p.id, weddingId); router.refresh(); }); }}
                        >
                          ✕
                        </button>
                      </td>
                      {events.map((ev) => statusCell(p, ev.id))}
                    </tr>
                  ))}
                  {open && (
                    <tr style={{ background: "var(--parchment)" }}>
                      <td colSpan={events.length + 1} style={{ position: "sticky", left: 0, paddingLeft: 34 }}>
                        <button
                          className="addnote"
                          disabled={pending}
                          onClick={() => startTransition(async () => { await addPerson(weddingId, g.id); router.refresh(); })}
                        >
                          + {t("addPerson")}
                        </button>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td style={{ position: "sticky", left: 0, bottom: 0, zIndex: 3, background: "var(--parchment)", fontSize: 11.5 }}>{t("footCounts")}</td>
              {events.map((ev) => {
                const f = foot(ev.id);
                return (
                  <td key={ev.id} style={{ position: "sticky", bottom: 0, zIndex: 2, background: "var(--parchment)", textAlign: "center", fontSize: 11.5, whiteSpace: "nowrap" }}>
                    <span style={{ color: "var(--hunter)", fontWeight: 600 }}>{f.confirmed}</span>
                    {" · "}
                    <span title={t("awaiting")}>{f.awaiting}</span>
                    {" · "}
                    <span style={{ color: "var(--bronze)" }}>{f.declined}</span>
                    <div style={{ color: "var(--ink2)" }}>{t("covers", { adults: f.adults, children: f.children })}</div>
                    {f.diets.size > 0 && (
                      <div style={{ color: "var(--ink2)", maxWidth: 130, whiteSpace: "normal" }}>
                        {[...f.diets].map(([d, n]) => `${d} ${n}`).join(" · ")}
                      </div>
                    )}
                  </td>
                );
              })}
            </tr>
          </tfoot>
        </table>
      </div>

      {/* ── one event at a time — the small-screen view ── */}
      <div className="gg-event">
        <select value={mobileEvent} onChange={(e) => setMobileEvent(e.target.value)} aria-label={t("filterEvent")} style={{ padding: "6px 8px", border: "1px solid var(--line)", background: "#fff", fontSize: 13, marginBottom: 10, width: "100%" }}>
          {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
        </select>
        {(() => {
          const f = foot(mobileEvent);
          return (
            <p style={{ fontSize: 12.5, color: "var(--ink2)", margin: "0 0 10px" }}>
              <span style={{ color: "var(--hunter)", fontWeight: 600 }}>{f.confirmed}</span> {t("status_confirmed").toLowerCase()} · {f.awaiting} {t("awaiting").toLowerCase()} · {f.declined} {t("status_declined").toLowerCase()} — {t("covers", { adults: f.adults, children: f.children })}
              {f.diets.size > 0 && <> — {[...f.diets].map(([d, n]) => `${d} ${n}`).join(" · ")}</>}
            </p>
          );
        })()}
        {visible.map((g) => {
          const ps = (byHousehold.get(g.id) ?? []).filter((p) => st(p.id, mobileEvent) !== null);
          if (!ps.length) return null;
          return (
            <div key={g.id} style={{ borderTop: "1px solid var(--line)", padding: "8px 0" }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{householdLabel(g)}</div>
              {ps.map((p, idx) => (
                <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "3px 0 3px 12px" }}>
                  <span style={{ fontSize: 12.5 }}>{personName(p, g, idx)}</span>
                  {statusCellInline(p, mobileEvent)}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );

  function statusCellInline(p: GuestPerson, eventId: string) {
    const s = st(p.id, eventId);
    const label = s ? t(`status_${s}`) : t("status_none");
    return (
      <button
        className="addnote"
        disabled={pending}
        onClick={() => cycle(p.id, eventId)}
        aria-label={`${label} — ${t("cycleHint")}`}
        style={{ fontSize: 13, color: s ? GLYPH[s].color : "var(--line)" }}
      >
        {s ? `${GLYPH[s].ch} ${label}` : "—"}
      </button>
    );
  }
}
