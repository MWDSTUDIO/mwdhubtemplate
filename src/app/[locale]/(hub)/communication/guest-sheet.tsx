"use client";

import React, { useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import type { Guest, GuestEvent, WeddingEvent } from "@/lib/types";
import {
  bulkGuests,
  patchGuestField,
  quickAddHousehold,
  restoreGuest,
  setHouseholdRsvp,
  toggleGuestEvent,
  deleteGuest
} from "@/app/actions/guests";

/**
 * The guest sheet (communication brief §2.2) — the list worked like
 * the Ledger: a cell corrects in place at the keyboard, twenty rows
 * correct in one selection, a household is added in one gesture, and
 * Cmd+Z walks back edits, creations and departures alike. The house's
 * hand marks every row it touches; nothing overwrites it.
 */

type Field =
  | "title" | "first_names" | "surname" | "suffix" | "invitation_line"
  | "address" | "party_adults" | "party_children" | "dietary";

const FIELD_ORDER: Field[] = [
  "title", "first_names", "surname", "suffix", "invitation_line",
  "address", "party_adults", "party_children", "dietary"
];

type UndoEntry =
  | { kind: "edit"; id: string; field: Field; prev: string }
  | { kind: "create"; id: string }
  | { kind: "delete"; row: Record<string, unknown>; eventIds: string[] };

const fieldValue = (g: Guest, f: Field): string => {
  const v = (g as unknown as Record<string, unknown>)[f];
  return v == null ? "" : String(v);
};

export function GuestSheet({
  weddingId,
  guests,
  events,
  links
}: {
  weddingId: string;
  guests: Guest[];
  events: WeddingEvent[];
  links: GuestEvent[];
}) {
  const t = useTranslations("guests.sheet");
  const tg = useTranslations("guests");
  const router = useRouter();
  const [editing, setEditing] = useState<{ id: string; field: Field } | null>(null);
  const [draft, setDraft] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [eventsOpen, setEventsOpen] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const undoStack = useRef<UndoEntry[]>([]);
  const pendingFocus = useRef<string | null>(null);
  const provenanceReady = guests.some((g) => (g as { provenance?: string }).provenance !== undefined);

  // A newborn household takes the pen at once (brief: cursor in the
  // first field).
  useEffect(() => {
    if (pendingFocus.current && guests.some((g) => g.id === pendingFocus.current)) {
      const id = pendingFocus.current;
      pendingFocus.current = null;
      setEditing({ id, field: "title" });
      setDraft("");
    }
  }, [guests]);

  // Cmd/Ctrl+Z outside an input: edits, creations and departures walk back.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT";
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z" || typing) return;
      const entry = undoStack.current.pop();
      if (!entry) return;
      e.preventDefault();
      startTransition(async () => {
        if (entry.kind === "edit") {
          await patchGuestField(entry.id, weddingId, entry.field, entry.prev);
        } else if (entry.kind === "create") {
          await deleteGuest(entry.id);
        } else {
          await restoreGuest(weddingId, entry.row, entry.eventIds);
        }
        router.refresh();
      });
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [weddingId, router]);

  const commit = (moveTo?: Field | "nextRow") => {
    if (!editing) return;
    const g = guests.find((x) => x.id === editing.id);
    if (!g) { setEditing(null); return; }
    const prev = fieldValue(g, editing.field);
    const isNum = editing.field === "party_adults" || editing.field === "party_children";
    const value = isNum ? (draft.trim() === "" ? null : Number(draft.replace(/[^\d]/g, "") || 0)) : draft;
    const { id, field } = editing;
    if (String(value ?? "") !== prev) {
      undoStack.current.push({ kind: "edit", id, field, prev });
      startTransition(async () => {
        await patchGuestField(id, weddingId, field, value);
        router.refresh();
      });
    }
    if (moveTo && moveTo !== "nextRow") {
      const ng = guests.find((x) => x.id === id);
      setEditing({ id, field: moveTo });
      setDraft(ng ? fieldValue(ng, moveTo) : "");
    } else if (moveTo === "nextRow") {
      const idx = guests.findIndex((x) => x.id === id);
      const next = guests[idx + 1];
      if (next) {
        setEditing({ id: next.id, field });
        setDraft(fieldValue(next, field));
      } else setEditing(null);
    } else setEditing(null);
  };

  const statusFor = (guest: Guest): "pending" | "confirmed" | "declined" => {
    if (guest.rsvp && guest.rsvp !== "pending") return guest.rsvp;
    const mine = links.filter((l) => l.guest_id === guest.id);
    if (mine.length && mine.every((l) => l.rsvp === "confirmed")) return "confirmed";
    if (mine.some((l) => l.rsvp === "declined")) return "declined";
    return "pending";
  };

  const provenanceWord = (g: Guest) => {
    const p = (g as { provenance?: string }).provenance ?? "couple";
    const when = (g as { house_touched_at?: string | null }).house_touched_at;
    const base = p === "house" ? t("provHouse") : p === "import" ? t("provImport") : t("provCouple");
    return when ? `${base} · ${when.slice(0, 10)}` : base;
  };

  const cell = (g: Guest, f: Field, opts?: { serif?: boolean; num?: boolean; width?: number }) => {
    const isEditing = editing?.id === g.id && editing.field === f;
    if (isEditing) {
      return (
        <td key={f} style={{ minWidth: opts?.width }}>
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); commit("nextRow"); }
              else if (e.key === "Tab") {
                e.preventDefault();
                const i = FIELD_ORDER.indexOf(f);
                const next = FIELD_ORDER[(i + (e.shiftKey ? FIELD_ORDER.length - 1 : 1)) % FIELD_ORDER.length];
                commit(next);
              } else if (e.key === "Escape") setEditing(null);
            }}
            onBlur={() => commit()}
            style={{ width: "100%", minWidth: 60, fontSize: 13, padding: "4px 6px", border: "1px solid var(--champagne)" }}
            aria-label={t(`col_${f}`)}
          />
        </td>
      );
    }
    const v = fieldValue(g, f);
    return (
      <td
        key={f}
        className={opts?.num ? "num" : undefined}
        style={{ cursor: "text", minWidth: opts?.width, fontFamily: opts?.serif ? "var(--font-display)" : undefined, fontSize: opts?.serif ? 15.5 : undefined }}
        title={t("cellHint")}
        onClick={() => { setEditing({ id: g.id, field: f }); setDraft(v); setEventsOpen(null); }}
      >
        {v || <span style={{ color: "var(--line)" }}>—</span>}
      </td>
    );
  };

  const toggleAll = (on: boolean) =>
    setSelected(on ? new Set(guests.map((g) => g.id)) : new Set());

  const bulk = (action: Parameters<typeof bulkGuests>[2]) =>
    startTransition(async () => {
      if (action.kind === "delete") {
        // Departures walk back too: keep each row for Cmd+Z.
        for (const id of selected) {
          const g = guests.find((x) => x.id === id);
          if (g) {
            undoStack.current.push({
              kind: "delete",
              row: g as unknown as Record<string, unknown>,
              eventIds: links.filter((l) => l.guest_id === id).map((l) => l.event_id)
            });
          }
        }
      }
      await bulkGuests(weddingId, [...selected], action);
      setSelected(new Set());
      router.refresh();
    });

  return (
    <div className="card team-only">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
        <div className="eyebrow">{t("title")}</div>
        <span style={{ fontSize: 12, color: "var(--ink2)" }}>{t("hint")}</span>
      </div>

      {/* ── the serial hand: selection acts once, on many ── */}
      {selected.size > 0 && (
        <div role="toolbar" aria-label={t("bulkTitle")} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "8px 10px", background: "var(--parchment)", border: "1px solid var(--line)", marginBottom: 10 }}>
          <span style={{ fontSize: 12.5 }}>{t("bulkCount", { n: selected.size })}</span>
          <select defaultValue="" onChange={(e) => { if (e.target.value) bulk({ kind: "rsvp", rsvp: e.target.value as "pending" | "confirmed" | "declined" }); e.target.value = ""; }} style={{ padding: "4px 6px", border: "1px solid var(--line)", background: "#fff", fontSize: 12 }} aria-label={t("bulkRsvp")}>
            <option value="">{t("bulkRsvp")}</option>
            <option value="confirmed">{tg("confirmed")}</option>
            <option value="pending">{tg("awaitingReply")}</option>
            <option value="declined">{tg("declined")}</option>
          </select>
          <select defaultValue="" onChange={(e) => { if (e.target.value) bulk({ kind: "addEvent", eventId: e.target.value }); e.target.value = ""; }} style={{ padding: "4px 6px", border: "1px solid var(--line)", background: "#fff", fontSize: 12 }} aria-label={t("bulkAddEvent")}>
            <option value="">{t("bulkAddEvent")}</option>
            {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
          </select>
          <select defaultValue="" onChange={(e) => { if (e.target.value) bulk({ kind: "removeEvent", eventId: e.target.value }); e.target.value = ""; }} style={{ padding: "4px 6px", border: "1px solid var(--line)", background: "#fff", fontSize: 12 }} aria-label={t("bulkRemoveEvent")}>
            <option value="">{t("bulkRemoveEvent")}</option>
            {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
          </select>
          <button
            className="addnote"
            style={{ color: "var(--bronze)" }}
            disabled={pending}
            onClick={() => { if (window.confirm(t("bulkDeleteConfirm", { n: selected.size }))) bulk({ kind: "delete" }); }}
          >
            {t("bulkDelete")}
          </button>
          <button className="addnote" onClick={() => setSelected(new Set())}>{t("bulkClear")}</button>
        </div>
      )}

      <div style={{ overflowX: "auto" }}>
        <table className="sheet-table" style={{ fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ width: 26 }}>
                <input
                  type="checkbox"
                  checked={selected.size === guests.length && guests.length > 0}
                  onChange={(e) => toggleAll(e.target.checked)}
                  aria-label={t("selectAll")}
                />
              </th>
              <th>{t("col_title")}</th>
              <th>{t("col_first_names")}</th>
              <th>{t("col_surname")}</th>
              <th>{t("col_suffix")}</th>
              <th>{t("col_invitation_line")}</th>
              <th>{t("col_address")}</th>
              <th className="num">{t("col_party_adults")}</th>
              <th className="num">{t("col_party_children")}</th>
              <th>{t("col_dietary")}</th>
              <th>{t("col_status")}</th>
              <th>{t("col_events")}</th>
              <th aria-label={t("provenance")} />
            </tr>
          </thead>
          <tbody>
            {guests.map((g) => {
              const status = statusFor(g);
              const mine = links.filter((l) => l.guest_id === g.id).map((l) => l.event_id);
              return (
                <tr key={g.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(g.id)}
                      onChange={(e) =>
                        setSelected((prev) => {
                          const n = new Set(prev);
                          if (e.target.checked) n.add(g.id); else n.delete(g.id);
                          return n;
                        })
                      }
                      aria-label={t("selectRow")}
                    />
                  </td>
                  {cell(g, "title", { width: 60 })}
                  {cell(g, "first_names", { width: 110 })}
                  {cell(g, "surname", { width: 100 })}
                  {cell(g, "suffix", { width: 50 })}
                  {cell(g, "invitation_line", { serif: true, width: 200 })}
                  {cell(g, "address", { width: 160 })}
                  {cell(g, "party_adults", { num: true, width: 40 })}
                  {cell(g, "party_children", { num: true, width: 40 })}
                  {cell(g, "dietary", { width: 110 })}
                  <td>
                    <select
                      value={status}
                      disabled={pending}
                      onChange={(e) =>
                        startTransition(async () => {
                          await setHouseholdRsvp(g.id, e.target.value as "pending" | "confirmed" | "declined");
                          router.refresh();
                        })
                      }
                      style={{ padding: "3px 5px", border: "1px solid var(--line)", background: "#fff", fontSize: 12 }}
                      aria-label={t("col_status")}
                    >
                      <option value="pending">{tg("awaitingReply")}</option>
                      <option value="confirmed">{tg("confirmed")}</option>
                      <option value="declined">{tg("declined")}</option>
                    </select>
                  </td>
                  <td style={{ minWidth: 120 }}>
                    <button className="addnote" onClick={() => setEventsOpen(eventsOpen === g.id ? null : g.id)}>
                      {mine.length
                        ? events.filter((ev) => mine.includes(ev.id)).map((ev) => ev.name.split(" ")[0]).join(" · ")
                        : t("noEvents")}
                    </button>
                    {eventsOpen === g.id && (
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
                        {events.map((ev) => (
                          <label key={ev.id} style={{ display: "inline-flex", gap: 4, alignItems: "center", fontSize: 12 }}>
                            <input
                              type="checkbox"
                              checked={mine.includes(ev.id)}
                              onChange={(e) =>
                                startTransition(async () => {
                                  await toggleGuestEvent(g.id, weddingId, ev.id, e.target.checked);
                                  router.refresh();
                                })
                              }
                            />
                            {ev.name}
                          </label>
                        ))}
                      </div>
                    )}
                  </td>
                  <td>
                    {provenanceReady && (
                      <span
                        title={provenanceWord(g)}
                        aria-label={provenanceWord(g)}
                        style={{
                          display: "inline-block", width: 7, height: 7, borderRadius: "50%",
                          background:
                            ((g as { provenance?: string }).provenance ?? "couple") === "house"
                              ? "var(--bronze)"
                              : ((g as { provenance?: string }).provenance ?? "couple") === "import"
                                ? "var(--champagne)"
                                : "var(--ink2)"
                        }}
                      />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── "+ add a household": born at once, pen in the first field ── */}
      <button
        className="addnote"
        style={{ marginTop: 10 }}
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const id = crypto.randomUUID();
            const r = await quickAddHousehold(weddingId, id);
            if (r.ok && r.id) {
              undoStack.current.push({ kind: "create", id: r.id });
              pendingFocus.current = r.id;
            }
            router.refresh();
          })
        }
      >
        + {t("addHousehold")}
      </button>
    </div>
  );
}
