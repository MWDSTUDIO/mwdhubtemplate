"use client";

import React, { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import type { Guest, GuestPerson, PersonEventStatus, WeddingEvent } from "@/lib/types";
import {
  addPerson,
  addWeddingEvent,
  archiveWeddingEvent,
  bulkGrid,
  patchPerson,
  removePerson,
  setHouseholdEventStatus,
  setPersonEventStatus,
  updateWeddingEvent,
  type GridStatus,
  type EventFields
} from "@/app/actions/guests";

/**
 * The Grid (final prompt §A3, matched to the reference mock) — the
 * crossed view an organiser works with: households in rows (expandable
 * into persons), events in columns, and in each cell one person's word:
 * attending · pending · declined — "not invited" is an absence. A click
 * cycles a person; a household cell sets everyone; the feet keep the
 * running answer to "how many, and what do they eat". Under 700 px the
 * matrix bows out for one event at a time.
 */

const CYCLE: Record<GridStatus, GridStatus> = { pending: "attending", attending: "declined", declined: "pending" };

const norm = (s: PersonEventStatus["status"] | null | undefined): GridStatus | null =>
  s == null ? null : s === "invited" ? "pending" : s;

export function GuestGrid({
  weddingId,
  events,
  households,
  persons,
  statuses,
  onSaved,
  toast
}: {
  weddingId: string;
  events: WeddingEvent[];
  households: Guest[];
  persons: GuestPerson[];
  statuses: PersonEventStatus[];
  onSaved?: () => void;
  toast?: (m: string) => void;
}) {
  const t = useTranslations("guests.grid");
  const format = useMemo(() => new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }), []);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [pendOnly, setPendOnly] = useState(false);
  const [activeEv, setActiveEv] = useState(events[0]?.id ?? "");
  const [editing, setEditing] = useState<{ id: string; field: "full_name" | "dietary" } | null>(null);
  const [draft, setDraft] = useState("");
  const [eventForm, setEventForm] = useState<null | { id: string | null; f: EventFields }>(null);
  const tableRef = useRef<HTMLTableElement>(null);

  const live = useMemo(() => households.filter((g) => !g.archived), [households]);

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
    const m = new Map<string, GridStatus>();
    for (const s of statuses) {
      const v = norm(s.status);
      if (v) m.set(`${s.person_id}:${s.event_id}`, v);
    }
    return m;
  }, [statuses]);

  // The cell answers the hand at once — the server follows. Optimistic
  // overrides clear as soon as fresh statuses arrive from the refresh.
  const [overrides, setOverrides] = useState<Map<string, GridStatus | null>>(new Map());
  useEffect(() => { setOverrides(new Map()); }, [statuses]);
  const st = (personId: string, eventId: string): GridStatus | null => {
    const k = `${personId}:${eventId}`;
    return overrides.has(k) ? (overrides.get(k) ?? null) : statusMap.get(k) ?? null;
  };
  const override = (entries: [string, GridStatus | null][]) =>
    setOverrides((prev) => {
      const n = new Map(prev);
      for (const [k, v] of entries) n.set(k, v);
      return n;
    });

  const act = (fn: () => Promise<unknown>, note?: string) =>
    startTransition(async () => {
      await fn();
      router.refresh();
      onSaved?.();
      if (note) toast?.(note);
    });

  const householdLabel = (g: Guest) =>
    g.invitation_line || [g.title, g.first_names, g.surname].filter(Boolean).join(" ") || t("unnamedHousehold");

  const personName = (p: GuestPerson, g: Guest | undefined, idx: number) =>
    p.full_name ||
    (idx === 0 && g ? [g.first_names, g.surname].filter(Boolean).join(" ") : "") ||
    t(p.kind === "child" ? "unnamedChild" : "unnamedAdult");

  const dayLabel = (ev: WeddingEvent) =>
    ev.event_date ? format.format(new Date(ev.event_date + "T12:00:00")) : "—";

  /* The feet: the standing count of one column (mock's feet()). */
  const feet = (eventId: string) => {
    let a = 0, p = 0, d = 0, kids = 0;
    const diets = new Map<string, number>();
    for (const g of live) {
      const ps = byHousehold.get(g.id) ?? [];
      let anyAttending = false;
      let childPersons = 0;
      for (const person of ps) {
        const s = st(person.id, eventId);
        if (!s) continue;
        if (s === "attending") {
          if (person.kind === "child") { childPersons++; kids++; } else a++;
          anyAttending = true;
          const diet = (person.dietary ?? "").trim();
          if (diet) diets.set(diet, (diets.get(diet) ?? 0) + 1);
        } else if (s === "pending") p++;
        else d++;
      }
      // Households that only carry a children COUNT (no child rows yet)
      // still bring their children to the table.
      if (anyAttending && childPersons === 0) kids += g.party_children ?? 0;
    }
    return { a, p, d, kids, covers: a + kids, diets, inv: a + p + d };
  };

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return live.filter((g) => {
      const ps = byHousehold.get(g.id) ?? [];
      if (q && !householdLabel(g).toLowerCase().includes(q) && !ps.some((p) => (p.full_name ?? "").toLowerCase().includes(q))) return false;
      if (pendOnly && !ps.some((p) => events.some((e) => st(p.id, e.id) === "pending"))) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, byHousehold, search, pendOnly, statusMap, events]);

  /* ── cell gestures — the hand sees its move at once ── */
  const cycleP = (personId: string, eventId: string) => {
    const cur = st(personId, eventId);
    const next: GridStatus = cur ? CYCLE[cur] : "pending";
    override([[`${personId}:${eventId}`, next]]);
    act(() => setPersonEventStatus(weddingId, personId, eventId, next), cur ? undefined : t("toastInvitedOne"));
  };
  const cycleHH = (g: Guest, eventId: string) => {
    const ps = byHousehold.get(g.id) ?? [];
    const cur = ps.map((p) => st(p.id, eventId)).filter(Boolean) as GridStatus[];
    const next: GridStatus = !cur.length
      ? "pending"
      : cur.every((s) => s === cur[0]) ? CYCLE[cur[0]] : "attending";
    override(ps.map((p) => [`${p.id}:${eventId}`, next]));
    act(() => setHouseholdEventStatus(weddingId, g.id, eventId, next), cur.length ? undefined : t("toastInvited"));
  };

  /* Arrow keys walk the matrix, Enter presses — the Ledger's keyboard. */
  const onGridKey = (e: React.KeyboardEvent) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
    const el = e.target as HTMLElement;
    if (!el.dataset.r) return;
    e.preventDefault();
    const r = +el.dataset.r + (e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0);
    const c = +(el.dataset.c ?? 0) + (e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0);
    tableRef.current?.querySelector<HTMLElement>(`[data-r="${r}"][data-c="${c}"]`)?.focus();
  };

  const bulkAct = (action: Parameters<typeof bulkGrid>[2], note: string) =>
    act(async () => {
      await bulkGrid(weddingId, [...selected], action);
      setSelected(new Set());
    }, note);

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
    act(() => patchPerson(id, weddingId, field, draft));
  };

  const editable = (p: GuestPerson, field: "full_name" | "dietary", display: string) => {
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
          style={{ minWidth: 90, fontSize: 12.5, padding: "3px 5px", border: "1px solid var(--champagne)" }}
          aria-label={t(field === "full_name" ? "personName" : "personDietary")}
        />
      );
    }
    const empty = !((p as unknown as Record<string, unknown>)[field] as string | null);
    return (
      <button
        className="addnote"
        title={t("cellHint")}
        onClick={() => { setEditing({ id: p.id, field }); setDraft(((p as unknown as Record<string, unknown>)[field] as string | null) ?? ""); }}
        style={{ fontStyle: empty ? "italic" : undefined, color: empty ? "var(--ink2)" : undefined, padding: 0 }}
      >
        {display}
      </button>
    );
  };

  /* ── the event file, opened flat above the matrix ── */
  const blankEvent: EventFields = { name: "", eventDate: null, startTime: null, endTime: null, venue: null, dressCode: null, capacity: null, rsvpDeadline: null, notes: null };
  const openEventForm = (ev?: WeddingEvent) =>
    setEventForm(ev
      ? { id: ev.id, f: { name: ev.name, eventDate: ev.event_date, startTime: ev.start_time ?? null, endTime: ev.end_time ?? null, venue: ev.venue ?? null, dressCode: ev.dress_code ?? null, capacity: ev.capacity ?? null, rsvpDeadline: ev.rsvp_deadline ?? null, notes: ev.notes ?? null } }
      : { id: null, f: blankEvent });

  const cellStyle = (s: GridStatus | null): React.CSSProperties =>
    s === "attending" ? { color: "var(--hunter)", fontWeight: 500 }
      : s === "declined" ? { color: "var(--dec, #9c9483)", textDecoration: "line-through" }
      : s === "pending" ? { color: "var(--bronze)" }
      : { color: "var(--line)" };

  if (!events.length) {
    return (
      <div className="tcard" style={{ padding: "18px 20px" }}>
        <p style={{ fontSize: 13.5, color: "var(--ink2)", margin: "0 0 10px", fontStyle: "italic" }}>{t("noEvents")}</p>
        <button className="btn ghost sm" onClick={() => openEventForm()}>{t("addEvent")}</button>
        {eventForm && eventEditor()}
      </div>
    );
  }

  return (
    <div className="tcard">
      {/* ── toolrow ── */}
      <div className="toolrow">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("search")}
          aria-label={t("search")}
          style={{ minWidth: 200 }}
        />
        <button className="chip" aria-pressed={pendOnly} onClick={() => setPendOnly(!pendOnly)}>{t("noReplyYet")}</button>
        <span style={{ flex: 1 }} />
        <button className="btn ghost sm" onClick={() => openEventForm()}>{t("addEvent")}</button>
      </div>

      {eventForm && eventEditor()}

      {/* ── the serial hand ── */}
      {selected.size > 0 && (
        <div role="toolbar" aria-label={t("bulkTitle")} className="toolrow" style={{ background: "var(--parchment)" }}>
          <span style={{ fontSize: 12.5 }}>{t("bulkCount", { n: selected.size })}</span>
          <select defaultValue="" onChange={(e) => { if (e.target.value) bulkAct({ kind: "invite", eventId: e.target.value }, t("toastInvited")); e.target.value = ""; }} aria-label={t("bulkInvite")} style={{ fontSize: 12, padding: "4px 6px" }}>
            <option value="">{t("bulkInvite")}</option>
            {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
          </select>
          <select defaultValue="" onChange={(e) => { if (e.target.value) bulkAct({ kind: "withdraw", eventId: e.target.value }, t("toastWithdrawn")); e.target.value = ""; }} aria-label={t("bulkWithdraw")} style={{ fontSize: 12, padding: "4px 6px" }}>
            <option value="">{t("bulkWithdraw")}</option>
            {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
          </select>
          <select defaultValue="" onChange={(e) => { const [eventId, status] = e.target.value.split("|"); if (status) bulkAct({ kind: "status", eventId, status: status as GridStatus }, t("toastStatusSet")); e.target.value = ""; }} aria-label={t("bulkStatus")} style={{ fontSize: 12, padding: "4px 6px" }}>
            <option value="">{t("bulkStatus")}</option>
            {events.map((ev) => (
              <optgroup key={ev.id} label={ev.name}>
                {(["attending", "declined", "pending"] as GridStatus[]).map((s) => (
                  <option key={s} value={`${ev.id}|${s}`}>{t(`status_${s}`)}</option>
                ))}
              </optgroup>
            ))}
          </select>
          <button className="addnote" onClick={() => setSelected(new Set())}>{t("bulkClear")}</button>
        </div>
      )}

      {/* ── one event at a time, under 700 px ── */}
      <div className="mobilebar">
        <span className="smallcaps" style={{ color: "var(--ink2)", fontSize: 12, letterSpacing: ".14em", textTransform: "uppercase" }}>{t("eventWord")}</span>
        <select value={activeEv} onChange={(e) => setActiveEv(e.target.value)} aria-label={t("eventWord")} style={{ flex: 1 }}>
          {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.name} · {dayLabel(ev)}</option>)}
        </select>
      </div>

      {/* ── the matrix ── */}
      <div className="tscroll" onKeyDown={onGridKey}>
        <table ref={tableRef} className="grid-table" style={{ borderCollapse: "separate", borderSpacing: 0, width: "100%" }}>
          <thead>
            <tr>
              <th className="namecol" style={{ minWidth: 250 }}>{t("colHousehold")}</th>
              {events.map((ev) => (
                <th key={ev.id} className={`evc ${ev.id === activeEv ? "active" : ""}`}>
                  <button className="addnote" onClick={() => openEventForm(ev)} title={t("editEvent")} style={{ display: "block", width: "100%", textAlign: "center" }}>
                    <span style={{ display: "block", fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 500, textTransform: "none", letterSpacing: 0, color: "var(--hunter)" }}>{ev.name}</span>
                    <span style={{ fontSize: 11.5, color: "var(--ink2)", letterSpacing: ".08em" }}>{dayLabel(ev)}</span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((g, gi) => {
              const ps = byHousehold.get(g.id) ?? [];
              const open = expanded.has(g.id);
              const allSel = ps.length > 0 && ps.every((p) => selected.has(p.id));
              return (
                <React.Fragment key={g.id}>
                  <tr>
                    <td className="namecol">
                      <input
                        type="checkbox"
                        checked={allSel}
                        onChange={(e) => toggleSelect(ps.map((p) => p.id), e.target.checked)}
                        aria-label={t("selectHousehold")}
                        style={{ marginRight: 8 }}
                      />
                      <button
                        className="addnote caret"
                        onClick={() => setExpanded((prev) => { const n = new Set(prev); if (n.has(g.id)) n.delete(g.id); else n.add(g.id); return n; })}
                        aria-expanded={open}
                        aria-label={t("expand")}
                        style={{ color: "var(--bronze)", marginRight: 6 }}
                      >
                        {open ? "▾" : "▸"}
                      </button>
                      <span style={{ fontWeight: 500, color: "var(--hunter)" }}>{householdLabel(g)}</span>
                    </td>
                    {events.map((ev, ei) => {
                      const cur = ps.map((p) => st(p.id, ev.id)).filter(Boolean) as GridStatus[];
                      const a = cur.filter((s) => s === "attending").length;
                      const label = !cur.length ? "—"
                        : cur.every((s) => s === "declined") ? t("status_declined").toLowerCase()
                        : a === cur.length ? `${cur.length} ✓`
                        : a ? t("someOf", { a, n: cur.length })
                        : t("status_pending").toLowerCase();
                      const s: GridStatus | null = !cur.length ? null
                        : cur.every((x) => x === "declined") ? "declined" : a ? "attending" : "pending";
                      return (
                        <td key={ev.id} className={`evc ${ev.id === activeEv ? "active" : ""}`} style={{ textAlign: "center" }}>
                          <button
                            className="cellbtn"
                            data-r={gi * 100} data-c={ei}
                            onClick={() => cycleHH(g, ev.id)}
                            title={cur.length ? t("aggregateHint") : t("inviteHint")}
                            aria-label={`${householdLabel(g)} — ${ev.name} — ${cur.length ? label : t("status_none")}`}
                            style={{ ...cellStyle(s), width: "100%", minHeight: 32, fontVariantNumeric: "tabular-nums" }}
                          >
                            {label}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                  {open && ps.map((p, pi) => (
                    <tr key={p.id} className="pr" style={{ background: "var(--parchment)" }}>
                      <td className="namecol" style={{ background: "var(--parchment)", paddingLeft: 34 }}>
                        <input
                          type="checkbox"
                          checked={selected.has(p.id)}
                          onChange={(e) => toggleSelect([p.id], e.target.checked)}
                          aria-label={t("selectPerson")}
                          style={{ marginRight: 8 }}
                        />
                        {editable(p, "full_name", personName(p, g, pi))}
                        {p.kind === "child" && <span style={{ marginLeft: 6, fontSize: 11, color: "var(--ink2)" }}>{t("child")}{p.age != null ? ` · ${p.age}` : ""}</span>}
                        <span className="diet" style={{ fontSize: 12, color: "var(--bronze)", marginLeft: 8 }}>
                          {editable(p, "dietary", p.dietary ? `· ${p.dietary}` : t("addDietary"))}
                        </span>
                        <button
                          className="addnote"
                          disabled={pending}
                          style={{ marginLeft: 8, color: "var(--bronze)" }}
                          title={t("removePerson")}
                          aria-label={t("removePerson")}
                          onClick={() => { if (window.confirm(t("removePersonConfirm"))) act(() => removePerson(p.id, weddingId), t("toastPersonRemoved")); }}
                        >
                          ✕
                        </button>
                      </td>
                      {events.map((ev, ei) => {
                        const s = st(p.id, ev.id);
                        return (
                          <td key={ev.id} className={`evc ${ev.id === activeEv ? "active" : ""}`} style={{ textAlign: "center" }}>
                            <button
                              className="cellbtn"
                              data-r={gi * 100 + pi + 1} data-c={ei}
                              onClick={() => cycleP(p.id, ev.id)}
                              title={s ? t("cycleHint") : t("inviteOneHint")}
                              aria-label={`${personName(p, g, pi)} — ${ev.name} — ${s ? t(`status_${s}`) : t("status_none")}`}
                              style={{ ...cellStyle(s), width: "100%", minHeight: 30 }}
                            >
                              {s ? t(`status_${s}`) : "—"}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  {open && (
                    <tr className="pr" style={{ background: "var(--parchment)" }}>
                      <td className="namecol" style={{ background: "var(--parchment)", paddingLeft: 34 }} colSpan={1}>
                        <button className="addnote" disabled={pending} onClick={() => act(() => addPerson(weddingId, g.id), t("toastPersonAdded"))}>
                          + {t("addPerson")}
                        </button>
                        <button className="addnote" disabled={pending} style={{ marginLeft: 10 }} onClick={() => act(() => addPerson(weddingId, g.id, "child"), t("toastPersonAdded"))}>
                          + {t("addChild")}
                        </button>
                      </td>
                      {events.map((ev) => <td key={ev.id} className={`evc ${ev.id === activeEv ? "active" : ""}`} />)}
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
            {!visible.length && (
              <tr><td colSpan={events.length + 1} style={{ color: "var(--ink2)", fontStyle: "italic", padding: "14px 16px" }}>{t("emptyFilter")}</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td className="namecol" style={{ background: "var(--parchment)" }}>
                <span className="smallcaps" style={{ fontSize: 12, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--ink2)" }}>{t("theCount")}</span>
              </td>
              {events.map((ev) => {
                const f = feet(ev.id);
                const roll = [...f.diets].map(([k, v]) => `${k} ${v}`).join(" · ");
                return (
                  <td key={ev.id} className={`evc ${ev.id === activeEv ? "active" : ""}`}>
                    <b style={{ color: "var(--hunter)", fontWeight: 500 }}>{f.a}</b> {t("status_attending").toLowerCase()} · {f.p} {t("status_pending").toLowerCase()} · {f.d} {t("status_declined").toLowerCase()}
                    <br />
                    <b style={{ color: "var(--hunter)", fontWeight: 500 }}>{f.covers}</b> {t("coversWord")}
                    {roll && <span className="roll" style={{ display: "block", color: "var(--bronze)", fontSize: 12, marginTop: 3 }}>{roll}</span>}
                  </td>
                );
              })}
            </tr>
          </tfoot>
        </table>
      </div>

      {/* ── the legend ── */}
      <div className="toolrow" style={{ borderTop: "1px solid var(--line)", borderBottom: 0, fontSize: 13, color: "var(--ink2)" }}>
        <span>
          <span style={{ color: "var(--hunter)", fontWeight: 500 }}>{t("status_attending")}</span>
          {" · "}
          <span style={{ color: "var(--bronze)" }}>{t("status_pending")}</span>
          {" · "}
          <span style={{ color: "var(--dec, #9c9483)", textDecoration: "line-through" }}>{t("status_declined")}</span>
          {" · — "}{t("status_none").toLowerCase()}. {t("legend")}
        </span>
      </div>
    </div>
  );

  function eventEditor() {
    if (!eventForm) return null;
    const set = (k: keyof EventFields, v: string | number | null) =>
      setEventForm({ ...eventForm, f: { ...eventForm.f, [k]: v } });
    const F = eventForm.f;
    const input = (k: keyof EventFields, label: string, type = "text", width = 150) => (
      <label style={{ fontSize: 12, color: "var(--ink2)", display: "flex", flexDirection: "column", gap: 3 }}>
        {label}
        <input
          type={type}
          value={(F[k] as string | number | null) ?? ""}
          onChange={(e) => set(k, type === "number" ? (e.target.value === "" ? null : +e.target.value) : e.target.value)}
          style={{ width, fontSize: 13, padding: "5px 8px" }}
        />
      </label>
    );
    return (
      <div className="toolrow" style={{ alignItems: "flex-end", background: "var(--parchment)" }}>
        {input("name", t("evName"), "text", 170)}
        {input("eventDate", t("evDate"), "date", 150)}
        {input("startTime", t("evStart"), "time", 100)}
        {input("venue", t("evVenue"), "text", 170)}
        {input("dressCode", t("evDress"), "text", 130)}
        {input("capacity", t("evCapacity"), "number", 90)}
        {input("rsvpDeadline", t("evDeadline"), "date", 150)}
        <button
          className="btn sm"
          disabled={pending || !F.name.trim()}
          onClick={() =>
            act(async () => {
              if (eventForm.id) await updateWeddingEvent(weddingId, eventForm.id, F);
              else await addWeddingEvent(weddingId, F);
              setEventForm(null);
            }, eventForm.id ? t("toastEventSaved") : t("toastEventAdded"))
          }
        >
          {eventForm.id ? t("evSave") : t("evAdd")}
        </button>
        {eventForm.id && (
          <button
            className="btn ghost sm"
            disabled={pending}
            onClick={() => {
              if (!window.confirm(t("evArchiveConfirm"))) return;
              act(async () => {
                await archiveWeddingEvent(weddingId, eventForm.id as string, true);
                setEventForm(null);
              }, t("toastEventArchived"));
            }}
          >
            {t("evArchive")}
          </button>
        )}
        <button className="btn ghost sm" onClick={() => setEventForm(null)}>{t("evCancel")}</button>
      </div>
    );
  }
}
