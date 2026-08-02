"use client";

import React, { useState, useTransition } from "react";
import { useTranslations, useFormatter } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import type {
  Correspondence, EventCountGiven, Guest, GuestChangeProposal,
  Milestone, Property, RoomAssignment, RoomBlock, WeddingEvent
} from "@/lib/types";
import {
  applyProposal, assignRoom, dismissProposal, patchAssignment,
  recordCountGiven, removeAssignment, removeBlock, removeCountGiven,
  removeProperty, removeRegisterLine, saveBlock, saveCommNote,
  saveProperty, saveRegisterLine, setPenDate,
  type BlockFields, type PropertyFields, type RegisterLineFields
} from "@/app/actions/communication";
import { HouseProse } from "@/lib/house-prose";

/**
 * Lot C — the great house's instruments: the correspondence register
 * under Estelle's hand and linked to the Timeline (C5), the recorded
 * count and its discrepancy alert (C2), the pen taken at her date
 * (C3), and accommodation deepened into properties, blocks and
 * assignments whose remaining count computes itself (C4).
 */

function useAct(onSaved?: () => void, toast?: (m: string) => void) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const act = (fn: () => Promise<unknown>, note?: string) =>
    startTransition(async () => {
      await fn();
      router.refresh();
      onSaved?.();
      if (note) toast?.(note);
    });
  return { pending, act };
}

const label = (text: string) => (
  <span style={{ display: "block", fontSize: 12, letterSpacing: ".14em", textTransform: "uppercase", fontWeight: 500, color: "var(--ink2)", margin: "10px 0 4px" }}>{text}</span>
);

/* ══════════ C5 · the correspondence register ══════════════════════ */

export function RegisterDesk({
  weddingId,
  letters,
  milestones,
  commNote,
  commNoteStatus,
  onSaved,
  toast
}: {
  weddingId: string;
  letters: Correspondence[];
  milestones: Milestone[];
  commNote: string | null;
  commNoteStatus: string;
  onSaved?: () => void;
  toast?: (m: string) => void;
}) {
  const t = useTranslations("communication.register");
  const format = useFormatter();
  const { pending, act } = useAct(onSaved, toast);
  const [editing, setEditing] = useState<null | { id: string | null; f: RegisterLineFields }>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState(commNote ?? "");

  const milestoneOf = (id: string | null | undefined) => milestones.find((m) => m.id === id) ?? null;
  const lineSent = (c: Correspondence) =>
    c.milestone_id ? !!milestoneOf(c.milestone_id)?.done : c.status === "sent";
  const stale = (c: Correspondence) =>
    !c.milestone_id && c.status !== "sent" && !c.scheduled_label;

  const open = (c?: Correspondence) =>
    setEditing(c
      ? { id: c.id, f: { title: c.title, kind: c.kind, scheduledLabel: c.scheduled_label ?? "", milestoneId: c.milestone_id ?? null, sent: c.status === "sent" } }
      : { id: null, f: { title: "", kind: "custom", scheduledLabel: "", milestoneId: null, sent: false } });

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
        <div className="eyebrow">{t("title")}</div>
        <button className="addnote" onClick={() => open()}>+ {t("addLine")}</button>
      </div>
      {letters.length === 0 && <p style={{ fontSize: 13, color: "var(--ink2)" }}>{t("empty")}</p>}
      <ul className="steps" style={{ marginTop: 6 }}>
        {letters.map((c) => {
          const m = milestoneOf(c.milestone_id);
          const sent = lineSent(c);
          return (
            <li key={c.id}>
              <span className="d">
                {sent
                  ? c.sent_at
                    ? t("sentOn", { date: format.dateTime(new Date(c.sent_at), { month: "short", day: "numeric", year: "numeric" }) })
                    : t("sent")
                  : c.scheduled_label ?? (m ? m.month : t("toCome"))}
              </span>
              <span>
                {c.title}
                {m && (
                  <em style={{ marginLeft: 8, fontSize: 12, color: sent ? "var(--hunter)" : "var(--ink2)", fontStyle: "normal" }}>
                    ⟡ {t("linkedTo", { label: m.label })}
                  </em>
                )}
                {stale(c) && (
                  <em style={{ marginLeft: 8, fontSize: 12, color: "var(--bronze)" }}>{t("toConfirm")}</em>
                )}
                <button className="addnote" style={{ marginLeft: 10 }} onClick={() => open(c)} aria-label={t("editLine")}>✎</button>
              </span>
            </li>
          );
        })}
      </ul>

      {editing && (
        <div style={{ marginTop: 12, padding: "12px 14px", background: "var(--parchment)", border: "1px solid var(--line)" }}>
          {label(t("lineTitle"))}
          <input value={editing.f.title} onChange={(e) => setEditing({ ...editing, f: { ...editing.f, title: e.target.value } })} style={{ width: "100%", fontSize: 14, padding: "6px 9px" }} />
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            <span style={{ flex: 1, minWidth: 170 }}>
              {label(t("whenLabel"))}
              <input value={editing.f.scheduledLabel} onChange={(e) => setEditing({ ...editing, f: { ...editing.f, scheduledLabel: e.target.value } })} placeholder={t("whenPlaceholder")} style={{ width: "100%", fontSize: 13.5, padding: "6px 9px" }} />
            </span>
            <span style={{ flex: 1, minWidth: 190 }}>
              {label(t("milestoneLabel"))}
              <select
                value={editing.f.milestoneId ?? ""}
                onChange={(e) => setEditing({ ...editing, f: { ...editing.f, milestoneId: e.target.value || null } })}
                style={{ width: "100%", fontSize: 13, padding: "6px 8px", background: "#fff", border: "1px solid var(--line)" }}
              >
                <option value="">{t("noMilestone")}</option>
                {milestones.map((m) => <option key={m.id} value={m.id}>{m.month} — {m.label}</option>)}
              </select>
            </span>
          </div>
          {!editing.f.milestoneId && (
            <label style={{ display: "inline-flex", gap: 7, alignItems: "center", fontSize: 13.5, marginTop: 10 }}>
              <input type="checkbox" checked={editing.f.sent} onChange={(e) => setEditing({ ...editing, f: { ...editing.f, sent: e.target.checked } })} />
              {t("markSent")}
            </label>
          )}
          {editing.f.milestoneId && (
            <p style={{ fontSize: 12.5, color: "var(--ink2)", margin: "8px 0 0" }}>{t("milestoneRule")}</p>
          )}
          <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
            <button className="btn sm" disabled={pending || !editing.f.title.trim()} onClick={() => act(async () => { await saveRegisterLine(weddingId, editing.id, editing.f); setEditing(null); }, t("toastSaved"))}>{t("keepLine")}</button>
            {editing.id && (
              <button className="btn ghost sm" disabled={pending} onClick={() => { if (window.confirm(t("removeConfirm"))) act(async () => { await removeRegisterLine(weddingId, editing.id as string); setEditing(null); }, t("toastRemoved")); }}>{t("removeLine")}</button>
            )}
            <button className="btn ghost sm" onClick={() => setEditing(null)}>{t("cancel")}</button>
          </div>
        </div>
      )}

      {/* the house's note — a draft until her word */}
      <div style={{ marginTop: 14, borderTop: "1px solid rgba(201,178,145,.28)", paddingTop: 10 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
          <span className="eyebrow" style={{ color: "var(--ink2)" }}>{t("noteTitle")}</span>
          {commNote && (
            <span className={`tag ${commNoteStatus === "published" ? "ok" : "int"}`}>
              {t(commNoteStatus === "published" ? "notePublished" : "noteDraft")}
            </span>
          )}
          <button className="addnote" onClick={() => { setNoteDraft(commNote ?? ""); setNoteOpen(!noteOpen); }}>
            {commNote ? t("noteEdit") : t("noteWrite")}
          </button>
        </div>
        {commNote && !noteOpen && <div style={{ marginTop: 6 }}><HouseProse text={commNote} size={14.5} /></div>}
        {noteOpen && (
          <div style={{ marginTop: 8 }}>
            <textarea value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} rows={4} style={{ width: "100%", fontSize: 13.5, padding: "9px 11px", border: "1px solid var(--champagne)", fontFamily: "inherit" }} aria-label={t("noteTitle")} />
            <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
              <button className="btn sm" disabled={pending} onClick={() => act(async () => { await saveCommNote(weddingId, noteDraft, true); setNoteOpen(false); }, t("toastNotePublished"))}>{t("notePublish")}</button>
              <button className="btn ghost sm" disabled={pending} onClick={() => act(async () => { await saveCommNote(weddingId, noteDraft, false); setNoteOpen(false); }, t("toastSaved"))}>{t("noteKeepDraft")}</button>
              <button className="btn ghost sm" onClick={() => setNoteOpen(false)}>{t("cancel")}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ══════════ C3 · the pen + the couple's proposals ═════════════════ */

export function PenDesk({
  weddingId,
  penFrom,
  weddingDate,
  proposals,
  households,
  onSaved,
  toast
}: {
  weddingId: string;
  penFrom: string | null;
  weddingDate: string | null;
  proposals: GuestChangeProposal[];
  households: Guest[];
  onSaved?: () => void;
  toast?: (m: string) => void;
}) {
  const t = useTranslations("communication.pen");
  const format = useFormatter();
  const { pending, act } = useAct(onSaved, toast);
  const [date, setDate] = useState(penFrom ?? "");

  const jMinus30 = weddingDate
    ? new Date(new Date(weddingDate + "T12:00:00").getTime() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10)
    : "";
  const active = !!penFrom && new Date(penFrom + "T00:00:00") <= new Date();
  const householdName = (id: string | null) => {
    const g = households.find((x) => x.id === id);
    return g ? g.invitation_line || [g.first_names, g.surname].filter(Boolean).join(" ") : t("newHousehold");
  };
  const describe = (p: GuestChangeProposal) => {
    if (p.kind === "add") return t("propAdd", { name: String((p.payload as { invitation_line?: string }).invitation_line ?? [((p.payload as Record<string, string>).first_names ?? ""), ((p.payload as Record<string, string>).surname ?? "")].filter(Boolean).join(" ")) });
    if (p.kind === "delete") return t("propDelete", { name: householdName(p.household_id) });
    if (p.kind === "rsvp") return t("propRsvp", { name: householdName(p.household_id), word: String((p.payload as { rsvp?: string }).rsvp ?? "") });
    return t("propUpdate", { name: householdName(p.household_id) });
  };

  return (
    <div className="card">
      <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap", marginBottom: 6 }}>
        <div className="eyebrow">{t("title")}</div>
        {active
          ? <span className="tag ok">{t("active", { date: format.dateTime(new Date(penFrom as string), { month: "short", day: "numeric" }) })}</span>
          : penFrom
            ? <span className="tag wait">{t("armed", { date: format.dateTime(new Date(penFrom), { month: "short", day: "numeric" }) })}</span>
            : <span className="tag int">{t("never")}</span>}
      </div>
      <p style={{ fontSize: 13, color: "var(--ink2)", margin: "0 0 10px" }}>{t("blurb")}</p>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label={t("dateLabel")} style={{ fontSize: 13, padding: "5px 8px" }} />
        {jMinus30 && date !== jMinus30 && (
          <button className="addnote" onClick={() => setDate(jMinus30)}>{t("suggest")}</button>
        )}
        <button className="btn ghost sm" disabled={pending || !date} onClick={() => act(() => setPenDate(weddingId, date), t("toastSet"))}>{t("set")}</button>
        {penFrom && (
          <button className="addnote" style={{ color: "var(--bronze)" }} disabled={pending} onClick={() => { setDate(""); act(() => setPenDate(weddingId, null), t("toastCleared")); }}>{t("clear")}</button>
        )}
      </div>

      {proposals.length > 0 && (
        <div style={{ marginTop: 12, borderTop: "1px solid rgba(201,178,145,.28)", paddingTop: 8 }}>
          <span className="eyebrow" style={{ color: "var(--bronze)" }}>{t("proposalsTitle", { n: proposals.length })}</span>
          {proposals.map((p) => (
            <div key={p.id} style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap", padding: "8px 0", borderBottom: "1px solid rgba(201,178,145,.2)" }}>
              <span style={{ fontSize: 13.5, flex: 1, minWidth: 220 }}>
                {describe(p)}
                <span style={{ fontSize: 12, color: "var(--ink2)", marginLeft: 8 }}>
                  {p.created_by} · {format.dateTime(new Date(p.created_at), { month: "short", day: "numeric" })}
                </span>
              </span>
              <button className="btn sm" disabled={pending} onClick={() => act(() => applyProposal(weddingId, p.id), t("toastApplied"))}>{t("apply")}</button>
              <button className="addnote" disabled={pending} onClick={() => act(() => dismissProposal(weddingId, p.id), t("toastDismissed"))}>{t("dismiss")}</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ══════════ C2 · the recorded count ═══════════════════════════════ */

export function CountsDesk({
  weddingId,
  events,
  counts,
  currentCovers,
  onSaved,
  toast
}: {
  weddingId: string;
  events: WeddingEvent[];
  counts: EventCountGiven[];
  currentCovers: Record<string, number>;
  onSaved?: () => void;
  toast?: (m: string) => void;
}) {
  const t = useTranslations("communication.counts");
  const format = useFormatter();
  const { pending, act } = useAct(onSaved, toast);
  const [eventId, setEventId] = useState(events[0]?.id ?? "");
  const [recipient, setRecipient] = useState("");
  const [figure, setFigure] = useState<number | "">("");

  const evName = (id: string) => events.find((e) => e.id === id)?.name ?? "—";

  return (
    <div style={{ background: "var(--white, #fffdf9)", border: "1px solid var(--line)", padding: "18px 20px", gridColumn: "1 / -1" }}>
      <h3 className="serif" style={{ fontWeight: 500, fontSize: 20, margin: 0 }}>{t("title")}</h3>
      <p style={{ margin: "4px 0 10px", fontSize: 14, color: "var(--ink2)" }}>{t("blurb")}</p>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
        <span>{label(t("eventLabel"))}
          <select value={eventId} onChange={(e) => { setEventId(e.target.value); setFigure(currentCovers[e.target.value] ?? ""); }} style={{ fontSize: 13, padding: "6px 8px", background: "#fff", border: "1px solid var(--line)" }}>
            {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
          </select>
        </span>
        <span>{label(t("recipientLabel"))}
          <input value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder={t("recipientPlaceholder")} style={{ fontSize: 13.5, padding: "6px 9px", minWidth: 170 }} />
        </span>
        <span>{label(t("figureLabel"))}
          <input type="number" value={figure} onChange={(e) => setFigure(e.target.value === "" ? "" : +e.target.value)} placeholder={String(currentCovers[eventId] ?? "")} style={{ fontSize: 13.5, padding: "6px 9px", width: 90 }} />
        </span>
        <button
          className="btn sm"
          disabled={pending || !recipient.trim() || figure === ""}
          onClick={() => act(async () => {
            await recordCountGiven(weddingId, eventId, recipient, figure as number, new Date().toISOString().slice(0, 10));
            setRecipient(""); setFigure("");
          }, t("toastRecorded"))}
        >
          {t("record")}
        </button>
        <span style={{ fontSize: 12.5, color: "var(--ink2)" }}>{t("nowCovers", { n: currentCovers[eventId] ?? 0 })}</span>
      </div>

      {counts.length > 0 && (
        <div style={{ marginTop: 12 }}>
          {counts.map((c) => {
            const now = currentCovers[c.event_id] ?? 0;
            const moved = now !== c.figure;
            return (
              <div key={c.id} style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap", padding: "7px 0", borderTop: "1px solid rgba(201,178,145,.2)" }}>
                <span style={{ fontSize: 13.5, flex: 1, minWidth: 260 }}>
                  {moved ? (
                    <strong style={{ color: "var(--bronze)", fontWeight: 500 }}>
                      {t("discrepancy", { event: evName(c.event_id), recipient: c.recipient, date: format.dateTime(new Date(c.given_on + "T12:00:00"), { month: "long", day: "numeric" }), figure: c.figure, now })}
                    </strong>
                  ) : (
                    t("standing", { event: evName(c.event_id), recipient: c.recipient, date: format.dateTime(new Date(c.given_on + "T12:00:00"), { month: "long", day: "numeric" }), figure: c.figure })
                  )}
                </span>
                <button className="addnote" style={{ color: "var(--bronze)" }} disabled={pending} onClick={() => { if (window.confirm(t("removeConfirm"))) act(() => removeCountGiven(weddingId, c.id), t("toastRemoved")); }}>✕</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ══════════ C4 · accommodation, deepened ══════════════════════════ */

const STATUSES: RoomAssignment["status"][] = ["not_requested", "requested", "reserved", "confirmed", "paid", "cancelled"];

export function PropertiesDesk({
  weddingId,
  properties,
  blocks,
  assignments,
  households,
  onSaved,
  toast
}: {
  weddingId: string;
  properties: Property[];
  blocks: RoomBlock[];
  assignments: RoomAssignment[];
  households: Guest[];
  onSaved?: () => void;
  toast?: (m: string) => void;
}) {
  const t = useTranslations("communication.stay");
  const { pending, act } = useAct(onSaved, toast);
  const [propForm, setPropForm] = useState<null | { id: string | null; f: PropertyFields }>(null);
  const [blockForm, setBlockForm] = useState<null | { propertyId: string; id: string | null; f: BlockFields }>(null);

  const live = households.filter((g) => !g.archived);
  const assignedIds = new Set(assignments.filter((a) => a.status !== "cancelled").map((a) => a.household_id));
  const householdName = (id: string) => {
    const g = households.find((x) => x.id === id);
    return g ? g.invitation_line || [g.first_names, g.surname].filter(Boolean).join(" ") : "—";
  };
  const remaining = (b: RoomBlock) =>
    b.allocated - assignments.filter((a) => a.block_id === b.id && a.status !== "cancelled").length;

  const blankProp: PropertyFields = { name: "", propertyType: "hotel", contactName: "", contactPhone: "", contactEmail: "", checkIn: "", checkOut: "", notes: "" };
  const blankBlock: BlockFields = { name: "", dateStart: "", dateEnd: "", bookingDeadline: "", bookingCode: "", bookingLink: "", rate: null, rateCurrency: "EUR", allocated: 0 };

  const inp = (v: string, set: (x: string) => void, lab: string, type = "text", width = 150) => (
    <span>{label(lab)}<input type={type} value={v} onChange={(e) => set(e.target.value)} style={{ fontSize: 13, padding: "5px 8px", width }} /></span>
  );

  return (
    <div className="card team-only">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
        <div className="eyebrow">{t("title")}</div>
        <button className="addnote" onClick={() => setPropForm({ id: null, f: blankProp })}>+ {t("addProperty")}</button>
      </div>
      <p style={{ fontSize: 13, color: "var(--ink2)", margin: "0 0 12px" }}>{t("blurb")}</p>

      {propForm && (
        <div className="toolrow" style={{ background: "var(--parchment)", alignItems: "flex-end", border: "1px solid var(--line)", marginBottom: 12 }}>
          {inp(propForm.f.name, (x) => setPropForm({ ...propForm, f: { ...propForm.f, name: x } }), t("propName"), "text", 170)}
          <span>{label(t("propType"))}
            <select value={propForm.f.propertyType} onChange={(e) => setPropForm({ ...propForm, f: { ...propForm.f, propertyType: e.target.value } })} style={{ fontSize: 13, padding: "5px 7px", background: "#fff", border: "1px solid var(--line)" }}>
              <option value="hotel">{t("typeHotel")}</option>
              <option value="villa">{t("typeVilla")}</option>
              <option value="residence">{t("typeResidence")}</option>
            </select>
          </span>
          {inp(propForm.f.contactName, (x) => setPropForm({ ...propForm, f: { ...propForm.f, contactName: x } }), t("propContact"), "text", 140)}
          {inp(propForm.f.contactEmail, (x) => setPropForm({ ...propForm, f: { ...propForm.f, contactEmail: x } }), t("propEmail"), "email", 170)}
          {inp(propForm.f.checkIn, (x) => setPropForm({ ...propForm, f: { ...propForm.f, checkIn: x } }), t("propCheckIn"), "text", 90)}
          {inp(propForm.f.checkOut, (x) => setPropForm({ ...propForm, f: { ...propForm.f, checkOut: x } }), t("propCheckOut"), "text", 90)}
          <button className="btn sm" disabled={pending || !propForm.f.name.trim()} onClick={() => act(async () => { await saveProperty(weddingId, propForm.id, propForm.f); setPropForm(null); }, t("toastSaved"))}>{t("keep")}</button>
          {propForm.id && (
            <button className="btn ghost sm" disabled={pending} onClick={() => { if (window.confirm(t("removePropertyConfirm"))) act(async () => { await removeProperty(weddingId, propForm.id as string); setPropForm(null); }, t("toastRemoved")); }}>{t("remove")}</button>
          )}
          <button className="btn ghost sm" onClick={() => setPropForm(null)}>{t("cancel")}</button>
        </div>
      )}

      {properties.map((p) => (
        <div key={p.id} style={{ border: "1px solid var(--line)", background: "var(--white, #fffdf9)", marginBottom: 14 }}>
          <header style={{ padding: "12px 18px", borderBottom: "1px solid var(--line)", display: "flex", gap: "6px 16px", alignItems: "baseline", flexWrap: "wrap" }}>
            <h3 className="serif" style={{ fontWeight: 500, fontSize: 20, margin: 0 }}>{p.name}</h3>
            <span style={{ fontSize: 12, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--ink2)" }}>{t(`type${p.property_type[0].toUpperCase()}${p.property_type.slice(1)}` as "typeHotel")}</span>
            {p.contact_name && <span style={{ fontSize: 12.5, color: "var(--ink2)" }}>{p.contact_name}{p.contact_email ? ` · ${p.contact_email}` : ""}</span>}
            {(p.check_in || p.check_out) && <span style={{ fontSize: 12.5, color: "var(--ink2)" }}>{t("checkWord", { in: p.check_in ?? "—", out: p.check_out ?? "—" })}</span>}
            <span style={{ flex: 1 }} />
            <button className="addnote" onClick={() => setPropForm({ id: p.id, f: { name: p.name, propertyType: p.property_type, contactName: p.contact_name ?? "", contactPhone: p.contact_phone ?? "", contactEmail: p.contact_email ?? "", checkIn: p.check_in ?? "", checkOut: p.check_out ?? "", notes: p.notes ?? "" } })}>✎</button>
            <button className="addnote" onClick={() => setBlockForm({ propertyId: p.id, id: null, f: blankBlock })}>+ {t("addBlock")}</button>
          </header>
          {blocks.filter((b) => b.property_id === p.id).map((b) => {
            const rem = remaining(b);
            return (
              <div key={b.id} style={{ padding: "10px 18px", borderBottom: "1px solid rgba(201,178,145,.28)", display: "flex", gap: "6px 18px", alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ minWidth: 180, fontWeight: 500, color: "var(--hunter)" }}>{b.name}</span>
                <span style={{ fontSize: 12.5, color: "var(--ink2)" }}>
                  {[b.date_start && b.date_end ? `${b.date_start} → ${b.date_end}` : null,
                    b.rate != null ? `${b.rate} ${b.rate_currency}` : null,
                    b.booking_code ? t("codeWord", { code: b.booking_code }) : null,
                    b.booking_deadline ? t("deadlineWord", { date: b.booking_deadline }) : null
                  ].filter(Boolean).join(" · ")}
                </span>
                <span style={{ fontSize: 13 }}>
                  {t("blockCounts", { alloc: b.allocated, assigned: b.allocated - rem })}
                  {" · "}
                  <b style={{ color: rem <= 1 ? "var(--bronze)" : "var(--hunter)", fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>{t("remaining", { n: rem })}</b>
                </span>
                <span style={{ flex: 1 }} />
                <select
                  defaultValue=""
                  disabled={pending || rem <= 0}
                  onChange={(e) => { if (e.target.value) act(() => assignRoom(weddingId, b.id, e.target.value), t("toastAssigned")); e.target.value = ""; }}
                  aria-label={t("assign")}
                  style={{ fontSize: 12, padding: "4px 6px", background: "#fff", border: "1px solid var(--line)", maxWidth: 220 }}
                >
                  <option value="">{rem > 0 ? t("assign") : t("full")}</option>
                  {live.filter((g) => !assignedIds.has(g.id)).map((g) => (
                    <option key={g.id} value={g.id}>{householdName(g.id)}</option>
                  ))}
                </select>
                <button className="addnote" onClick={() => setBlockForm({ propertyId: p.id, id: b.id, f: { name: b.name, dateStart: b.date_start ?? "", dateEnd: b.date_end ?? "", bookingDeadline: b.booking_deadline ?? "", bookingCode: b.booking_code ?? "", bookingLink: b.booking_link ?? "", rate: b.rate, rateCurrency: b.rate_currency, allocated: b.allocated } })} aria-label={t("editBlock")}>✎</button>
              </div>
            );
          })}
        </div>
      ))}

      {blockForm && (
        <div className="toolrow" style={{ background: "var(--parchment)", alignItems: "flex-end", border: "1px solid var(--line)", marginBottom: 12 }}>
          {inp(blockForm.f.name, (x) => setBlockForm({ ...blockForm, f: { ...blockForm.f, name: x } }), t("blockName"), "text", 180)}
          {inp(blockForm.f.dateStart, (x) => setBlockForm({ ...blockForm, f: { ...blockForm.f, dateStart: x } }), t("blockFrom"), "date", 140)}
          {inp(blockForm.f.dateEnd, (x) => setBlockForm({ ...blockForm, f: { ...blockForm.f, dateEnd: x } }), t("blockTo"), "date", 140)}
          {inp(blockForm.f.bookingDeadline, (x) => setBlockForm({ ...blockForm, f: { ...blockForm.f, bookingDeadline: x } }), t("blockDeadline"), "date", 140)}
          {inp(blockForm.f.bookingCode, (x) => setBlockForm({ ...blockForm, f: { ...blockForm.f, bookingCode: x } }), t("blockCode"), "text", 110)}
          <span>{label(t("blockRate"))}<input type="number" value={blockForm.f.rate ?? ""} onChange={(e) => setBlockForm({ ...blockForm, f: { ...blockForm.f, rate: e.target.value === "" ? null : +e.target.value } })} style={{ fontSize: 13, padding: "5px 8px", width: 90 }} /></span>
          <span>{label(t("blockAllocated"))}<input type="number" value={blockForm.f.allocated} onChange={(e) => setBlockForm({ ...blockForm, f: { ...blockForm.f, allocated: +e.target.value || 0 } })} style={{ fontSize: 13, padding: "5px 8px", width: 80 }} /></span>
          <button className="btn sm" disabled={pending || !blockForm.f.name.trim()} onClick={() => act(async () => { await saveBlock(weddingId, blockForm.propertyId, blockForm.id, blockForm.f); setBlockForm(null); }, t("toastSaved"))}>{t("keep")}</button>
          {blockForm.id && (
            <button className="btn ghost sm" disabled={pending} onClick={() => { if (window.confirm(t("removeBlockConfirm"))) act(async () => { await removeBlock(weddingId, blockForm.id as string); setBlockForm(null); }, t("toastRemoved")); }}>{t("remove")}</button>
          )}
          <button className="btn ghost sm" onClick={() => setBlockForm(null)}>{t("cancel")}</button>
        </div>
      )}

      {/* the rooming list — assignments under the hand */}
      <div className="eyebrow" style={{ margin: "14px 0 6px" }}>{t("roomingTitle")}</div>
      {assignments.length === 0 ? (
        <p style={{ fontSize: 13, color: "var(--ink2)", fontStyle: "italic" }}>{t("roomingEmpty")}</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="sheet-table" style={{ fontSize: 13 }}>
            <thead>
              <tr>
                <th>{t("colHousehold")}</th><th>{t("colBlock")}</th><th>{t("colRoom")}</th>
                <th>{t("colStatus")}</th><th>{t("colConfirmation")}</th><th aria-label={t("remove")} />
              </tr>
            </thead>
            <tbody>
              {assignments.map((a) => {
                const b = blocks.find((x) => x.id === a.block_id);
                const prop = properties.find((x) => x.id === b?.property_id);
                return (
                  <tr key={a.id}>
                    <td style={{ fontWeight: 500, color: "var(--hunter)" }}>{householdName(a.household_id)}</td>
                    <td>
                      <select value={a.block_id} disabled={pending} onChange={(e) => act(() => patchAssignment(weddingId, a.id, "block_id", e.target.value), t("toastTransferred"))} aria-label={t("colBlock")} style={{ fontSize: 12, padding: "3px 5px", background: "#fff", border: "1px solid var(--line)" }}>
                        {blocks.map((x) => {
                          const pr = properties.find((y) => y.id === x.property_id);
                          return <option key={x.id} value={x.id}>{pr?.name} — {x.name}</option>;
                        })}
                      </select>
                      {prop && <span style={{ display: "none" }}>{prop.name}</span>}
                    </td>
                    <td>
                      <input defaultValue={a.room_number ?? ""} placeholder={t("roomPlaceholder")} onBlur={(e) => { if (e.target.value !== (a.room_number ?? "")) act(() => patchAssignment(weddingId, a.id, "room_number", e.target.value)); }} style={{ fontSize: 12.5, padding: "3px 6px", width: 80, border: "1px solid var(--line)" }} aria-label={t("colRoom")} />
                    </td>
                    <td>
                      <select value={a.status} disabled={pending} onChange={(e) => act(() => patchAssignment(weddingId, a.id, "status", e.target.value))} aria-label={t("colStatus")} style={{ fontSize: 12, padding: "3px 5px", background: "#fff", border: "1px solid var(--line)" }}>
                        {STATUSES.map((s) => <option key={s} value={s}>{t(`st_${s}`)}</option>)}
                      </select>
                    </td>
                    <td>
                      <input defaultValue={a.confirmation_no ?? ""} placeholder="—" onBlur={(e) => { if (e.target.value !== (a.confirmation_no ?? "")) act(() => patchAssignment(weddingId, a.id, "confirmation_no", e.target.value)); }} style={{ fontSize: 12.5, padding: "3px 6px", width: 110, border: "1px solid var(--line)" }} aria-label={t("colConfirmation")} />
                    </td>
                    <td>
                      <button className="addnote" style={{ color: "var(--bronze)" }} disabled={pending} onClick={() => { if (window.confirm(t("removeAssignmentConfirm"))) act(() => removeAssignment(weddingId, a.id), t("toastRemoved")); }}>✕</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
