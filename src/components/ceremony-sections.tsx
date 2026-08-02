"use client";

import React, { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import type {
  Ceremony,
  CeremonyDocumentLink,
  CeremonyFlowItem,
  CeremonyLogistic,
  CeremonyMusic,
  CeremonyParticipant,
  CeremonyReading
} from "@/lib/types";
import {
  ceremonyReadiness,
  flowDuration,
  FLOW_BLOCKS,
  MUSIC_SLOTS,
  PARTICIPANT_ROLES,
  DOCUMENT_ROLES,
  READINESS_CHECKS,
  type CeremonySections as SectionsShape
} from "@/lib/ceremony";
import {
  applyTemplateFlow,
  detachCeremonyDocument,
  duplicateCeremonyItem,
  linkCeremonyDocument,
  moveCeremonyItem,
  removeCeremonyItem,
  saveCeremonyItem,
  setCeremonyCheckMark
} from "@/app/actions/ceremonies";

/**
 * The ceremony's desks (PRD Ceremony §6–§12, §15, §16) — participants,
 * flow, music, readings, papers, logistics, readiness, and Madame.
 * Team View only; the couple's reading lives in CeremonyEditor.
 */

export interface PersonOption { id: string; label: string }
export interface VendorOption { id: string; name: string }
export interface DocumentOption { id: string; label: string; internal: boolean }
export interface LineOption { id: string; label: string }

const inputS: React.CSSProperties = { padding: "6px 8px", border: "1px solid var(--line)", fontSize: 12.5 };
const selectS: React.CSSProperties = { ...inputS, background: "#fff" };
const rowS: React.CSSProperties = { display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap", padding: "6px 0", borderTop: "1px solid rgba(201,178,145,.2)" };

function Arrows({ table, id }: { table: Parameters<typeof moveCeremonyItem>[0]; id: string }) {
  const router = useRouter();
  const [, start] = useTransition();
  const go = (dir: -1 | 1) => start(async () => { await moveCeremonyItem(table, id, dir); router.refresh(); });
  return (
    <span style={{ display: "inline-flex", gap: 2 }}>
      <button className="addnote" aria-label="↑" onClick={() => go(-1)}>↑</button>
      <button className="addnote" aria-label="↓" onClick={() => go(1)}>↓</button>
    </span>
  );
}

export function Section({ title, count, children, hint }: { title: string; count?: number; children: React.ReactNode; hint?: string }) {
  return (
    <details className="team-only" style={{ borderTop: "1px solid var(--line)", padding: "10px 0" }}>
      <summary className="eyebrow" style={{ cursor: "pointer", listStyle: "none", display: "flex", gap: 10, alignItems: "baseline" }}>
        <span>{title}</span>
        {count != null && <span className="tag">{count}</span>}
        {hint && <span style={{ fontSize: 12, color: "var(--ink2)", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>{hint}</span>}
      </summary>
      <div style={{ marginTop: 10 }}>{children}</div>
    </details>
  );
}

/* ══════════ participants (§7) ══════════ */

export function ParticipantsDesk({
  ceremony, items, people, vendors
}: {
  ceremony: Ceremony;
  items: CeremonyParticipant[];
  people: PersonOption[];
  vendors: VendorOption[];
}) {
  const t = useTranslations("ceremony.sections.participants");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [personId, setPersonId] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("other");

  const displayName = (p: CeremonyParticipant) =>
    p.name || people.find((x) => x.id === p.person_id)?.label || vendors.find((v) => v.id === p.vendor_id)?.name || "—";

  const add = () =>
    start(async () => {
      const r = await saveCeremonyItem({
        table: "ceremony_participants",
        weddingId: ceremony.wedding_id,
        ceremonyId: ceremony.id,
        row: { person_id: personId || null, vendor_id: vendorId || null, name: name.trim() || null, role }
      });
      if (!r.ok) window.alert(t("needsMigration"));
      setPersonId(""); setVendorId(""); setName("");
      router.refresh();
    });

  return (
    <>
      {items.map((p) => (
        <div key={p.id} style={rowS}>
          <Arrows table="ceremony_participants" id={p.id} />
          <strong style={{ fontSize: 13.5, color: "var(--hunter)" }}>{displayName(p)}</strong>
          <select
            value={p.role}
            onChange={(e) => start(async () => { await saveCeremonyItem({ table: "ceremony_participants", id: p.id, weddingId: ceremony.wedding_id, ceremonyId: ceremony.id, row: { role: e.target.value } }); router.refresh(); })}
            style={selectS}
            aria-label={t("role")}
          >
            {PARTICIPANT_ROLES.map((r) => <option key={r} value={r}>{t(`roles.${r}`)}</option>)}
          </select>
          <button
            className="addnote"
            aria-pressed={p.client_visible}
            title={t("visibleHint")}
            onClick={() => start(async () => { await saveCeremonyItem({ table: "ceremony_participants", id: p.id, weddingId: ceremony.wedding_id, ceremonyId: ceremony.id, row: { client_visible: !p.client_visible } }); router.refresh(); })}
          >
            {p.client_visible ? t("visible") : t("hidden")}
          </button>
          <input
            defaultValue={p.note_internal ?? ""}
            placeholder={t("notePh")}
            onBlur={(e) => { if (e.target.value !== (p.note_internal ?? "")) start(async () => { await saveCeremonyItem({ table: "ceremony_participants", id: p.id, weddingId: ceremony.wedding_id, ceremonyId: ceremony.id, row: { note_internal: e.target.value.trim() || null } }); router.refresh(); }); }}
            style={{ ...inputS, flex: 1, minWidth: 120 }}
          />
          <button className="addnote" style={{ color: "var(--bronze)" }} disabled={pending} onClick={() => start(async () => { await removeCeremonyItem("ceremony_participants", p.id); router.refresh(); })}>
            {t("remove")}
          </button>
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
        <select value={personId} onChange={(e) => { setPersonId(e.target.value); if (e.target.value) { setVendorId(""); setName(""); } }} style={selectS} aria-label={t("pickPerson")}>
          <option value="">{t("pickPerson")}</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        <select value={vendorId} onChange={(e) => { setVendorId(e.target.value); if (e.target.value) { setPersonId(""); setName(""); } }} style={selectS} aria-label={t("pickVendor")}>
          <option value="">{t("pickVendor")}</option>
          {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
        <input value={name} onChange={(e) => { setName(e.target.value); if (e.target.value) { setPersonId(""); setVendorId(""); } }} placeholder={t("externalPh")} style={{ ...inputS, minWidth: 140 }} />
        <select value={role} onChange={(e) => setRole(e.target.value)} style={selectS} aria-label={t("role")}>
          {PARTICIPANT_ROLES.map((r) => <option key={r} value={r}>{t(`roles.${r}`)}</option>)}
        </select>
        <button className="addnote" disabled={pending || (!personId && !vendorId && !name.trim())} onClick={add}>{t("add")}</button>
      </div>
      <p style={{ fontSize: 12, color: "var(--ink2)", margin: "6px 0 0" }}>{t("referenceNote")}</p>
    </>
  );
}

/* ══════════ the flow (§8) ══════════ */

export function FlowDesk({
  ceremony, items, participants, people, vendors
}: {
  ceremony: Ceremony;
  items: CeremonyFlowItem[];
  participants: CeremonyParticipant[];
  people: PersonOption[];
  vendors: VendorOption[];
}) {
  const t = useTranslations("ceremony.sections.flow");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [title, setTitle] = useState("");
  const [blockType, setBlockType] = useState("other");
  const [showArchived, setShowArchived] = useState(false);

  const partName = (id: string | null) => {
    const p = participants.find((x) => x.id === id);
    if (!p) return null;
    return p.name || people.find((x) => x.id === p.person_id)?.label || vendors.find((v) => v.id === p.vendor_id)?.name || "—";
  };
  const active = items.filter((f) => !f.archived);
  const shown = showArchived ? items : active;
  const total = flowDuration(items);

  const patch = (id: string, row: Record<string, unknown>) =>
    start(async () => { await saveCeremonyItem({ table: "ceremony_flow", id, weddingId: ceremony.wedding_id, ceremonyId: ceremony.id, row }); router.refresh(); });

  return (
    <>
      {items.length === 0 && (
        <button
          className="btn ghost sm"
          disabled={pending}
          onClick={() => start(async () => { const r = await applyTemplateFlow(ceremony.wedding_id, ceremony.id); if (!r.ok) window.alert(t("needsMigration")); router.refresh(); })}
        >
          {t("template")}
        </button>
      )}
      {shown.map((f) => (
        <div key={f.id} style={{ ...rowS, opacity: f.archived ? 0.55 : 1 }}>
          <Arrows table="ceremony_flow" id={f.id} />
          <select value={f.block_type} onChange={(e) => patch(f.id, { block_type: e.target.value })} style={selectS} aria-label={t("block")}>
            {FLOW_BLOCKS.map((b) => <option key={b} value={b}>{t(`blocks.${b}`)}</option>)}
          </select>
          <input defaultValue={f.title} onBlur={(e) => { if (e.target.value.trim() && e.target.value !== f.title) patch(f.id, { title: e.target.value.trim() }); }} style={{ ...inputS, flex: 1, minWidth: 130, fontWeight: 500 }} aria-label={t("titlePh")} />
          <input
            defaultValue={f.duration_min ?? ""}
            inputMode="numeric"
            placeholder="min"
            onBlur={(e) => { const v = e.target.value.trim() === "" ? null : Number(e.target.value.replace(/\D/g, "")) || 0; if (v !== (f.duration_min ?? null)) patch(f.id, { duration_min: v }); }}
            style={{ ...inputS, width: 52, textAlign: "right" }}
            aria-label={t("duration")}
          />
          <select value={f.participant_id ?? ""} onChange={(e) => patch(f.id, { participant_id: e.target.value || null })} style={selectS} aria-label={t("who")}>
            <option value="">{t("who")}</option>
            {participants.map((p) => <option key={p.id} value={p.id}>{partName(p.id)}</option>)}
          </select>
          <input defaultValue={f.note_client ?? ""} placeholder={t("clientNotePh")} onBlur={(e) => { if (e.target.value !== (f.note_client ?? "")) patch(f.id, { note_client: e.target.value.trim() || null }); }} style={{ ...inputS, flex: 1, minWidth: 110 }} />
          <input defaultValue={f.note_internal ?? ""} placeholder={t("internalPh")} onBlur={(e) => { if (e.target.value !== (f.note_internal ?? "")) patch(f.id, { note_internal: e.target.value.trim() || null }); }} style={{ ...inputS, flex: 1, minWidth: 110 }} />
          <button className="addnote" disabled={pending} title={t("duplicate")} onClick={() => start(async () => { await duplicateCeremonyItem("ceremony_flow", f.id); router.refresh(); })}>⧉</button>
          <button className="addnote" disabled={pending} onClick={() => start(async () => { await removeCeremonyItem("ceremony_flow", f.id, true); router.refresh(); })}>
            {f.archived ? t("restore") : t("archive")}
          </button>
          {f.archived && (
            <button className="addnote" style={{ color: "var(--bronze)" }} disabled={pending} onClick={() => start(async () => { await removeCeremonyItem("ceremony_flow", f.id); router.refresh(); })}>
              {t("remove")}
            </button>
          )}
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
        <select value={blockType} onChange={(e) => setBlockType(e.target.value)} style={selectS} aria-label={t("block")}>
          {FLOW_BLOCKS.map((b) => <option key={b} value={b}>{t(`blocks.${b}`)}</option>)}
        </select>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("titlePh")} style={{ ...inputS, minWidth: 160 }} onKeyDown={(e) => { if (e.key === "Enter" && title.trim()) { start(async () => { const r = await saveCeremonyItem({ table: "ceremony_flow", weddingId: ceremony.wedding_id, ceremonyId: ceremony.id, row: { block_type: blockType, title: title.trim() } }); if (!r.ok) window.alert(t("needsMigration")); setTitle(""); router.refresh(); }); } }} />
        <button
          className="addnote"
          disabled={pending || !title.trim()}
          onClick={() => start(async () => { const r = await saveCeremonyItem({ table: "ceremony_flow", weddingId: ceremony.wedding_id, ceremonyId: ceremony.id, row: { block_type: blockType, title: title.trim() } }); if (!r.ok) window.alert(t("needsMigration")); setTitle(""); router.refresh(); })}
        >
          {t("add")}
        </button>
        {items.some((f) => f.archived) && (
          <button className="addnote" onClick={() => setShowArchived((v) => !v)} aria-pressed={showArchived}>
            {showArchived ? t("hideArchived") : t("showArchived")}
          </button>
        )}
        <span style={{ marginLeft: "auto", fontSize: 12.5, color: "var(--ink2)" }}>
          {t("total", { min: total })}
        </span>
      </div>
    </>
  );
}

/* ══════════ music (§9) ══════════ */

export function MusicDesk({
  ceremony, items, flow, vendors, documents
}: {
  ceremony: Ceremony;
  items: CeremonyMusic[];
  flow: CeremonyFlowItem[];
  vendors: VendorOption[];
  documents: DocumentOption[];
}) {
  const t = useTranslations("ceremony.sections.music");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [slot, setSlot] = useState("prelude");
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");

  const patch = (id: string, row: Record<string, unknown>) =>
    start(async () => { await saveCeremonyItem({ table: "ceremony_music", id, weddingId: ceremony.wedding_id, ceremonyId: ceremony.id, row }); router.refresh(); });

  return (
    <>
      {items.filter((m) => !m.archived).map((m) => (
        <div key={m.id} style={rowS}>
          <Arrows table="ceremony_music" id={m.id} />
          <select value={m.slot} onChange={(e) => patch(m.id, { slot: e.target.value })} style={selectS} aria-label={t("slot")}>
            {MUSIC_SLOTS.map((s) => <option key={s} value={s}>{t(`slots.${s}`)}</option>)}
          </select>
          <strong style={{ fontSize: 13.5, color: "var(--hunter)" }}>{m.title}</strong>
          {m.artist && <span style={{ fontSize: 12.5, color: "var(--ink2)" }}>{m.artist}</span>}
          <select value={m.vendor_id ?? ""} onChange={(e) => patch(m.id, { vendor_id: e.target.value || null })} style={selectS} aria-label={t("performer")}>
            <option value="">{t("performer")}</option>
            {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
          <select value={m.flow_id ?? ""} onChange={(e) => patch(m.id, { flow_id: e.target.value || null })} style={selectS} aria-label={t("step")}>
            <option value="">{t("step")}</option>
            {flow.filter((f) => !f.archived).map((f) => <option key={f.id} value={f.id}>{f.title}</option>)}
          </select>
          <input defaultValue={m.cue ?? ""} placeholder={t("cuePh")} onBlur={(e) => { if (e.target.value !== (m.cue ?? "")) patch(m.id, { cue: e.target.value.trim() || null }); }} style={{ ...inputS, width: 110 }} />
          <select value={m.document_id ?? ""} onChange={(e) => patch(m.id, { document_id: e.target.value || null })} style={selectS} aria-label={t("file")}>
            <option value="">{t("file")}</option>
            {documents.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
          </select>
          <button className="addnote" aria-pressed={m.status === "approved"} onClick={() => patch(m.id, { status: m.status === "approved" ? "proposed" : "approved" })}>
            {m.status === "approved" ? t("approved") : t("approve")}
          </button>
          <button className="addnote" style={{ color: "var(--bronze)" }} disabled={pending} onClick={() => start(async () => { await removeCeremonyItem("ceremony_music", m.id); router.refresh(); })}>
            {t("remove")}
          </button>
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
        <select value={slot} onChange={(e) => setSlot(e.target.value)} style={selectS} aria-label={t("slot")}>
          {MUSIC_SLOTS.map((s) => <option key={s} value={s}>{t(`slots.${s}`)}</option>)}
        </select>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("titlePh")} style={{ ...inputS, minWidth: 150 }} />
        <input value={artist} onChange={(e) => setArtist(e.target.value)} placeholder={t("artistPh")} style={{ ...inputS, minWidth: 120 }} />
        <button
          className="addnote"
          disabled={pending || !title.trim()}
          onClick={() => start(async () => { const r = await saveCeremonyItem({ table: "ceremony_music", weddingId: ceremony.wedding_id, ceremonyId: ceremony.id, row: { slot, title: title.trim(), artist: artist.trim() || null } }); if (!r.ok) window.alert(t("needsMigration")); setTitle(""); setArtist(""); router.refresh(); })}
        >
          {t("add")}
        </button>
      </div>
      <p style={{ fontSize: 12, color: "var(--ink2)", margin: "6px 0 0" }}>{t("canonNote")}</p>
    </>
  );
}

/* ══════════ readings (§10) ══════════ */

export function CeremonyReadingsDesk({
  ceremony, items, participants, people, vendors, documents
}: {
  ceremony: Ceremony;
  items: CeremonyReading[];
  participants: CeremonyParticipant[];
  people: PersonOption[];
  vendors: VendorOption[];
  documents: DocumentOption[];
}) {
  const t = useTranslations("ceremony.sections.readings");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [title, setTitle] = useState("");

  const partName = (id: string | null) => {
    const p = participants.find((x) => x.id === id);
    if (!p) return null;
    return p.name || people.find((x) => x.id === p.person_id)?.label || vendors.find((v) => v.id === p.vendor_id)?.name || "—";
  };
  const patch = (id: string, row: Record<string, unknown>) =>
    start(async () => { await saveCeremonyItem({ table: "ceremony_readings", id, weddingId: ceremony.wedding_id, ceremonyId: ceremony.id, row }); router.refresh(); });

  return (
    <>
      {items.filter((r) => !r.archived).map((r) => (
        <div key={r.id} style={{ borderTop: "1px solid rgba(201,178,145,.2)", padding: "6px 0" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
            <Arrows table="ceremony_readings" id={r.id} />
            <strong style={{ fontSize: 13.5, color: "var(--hunter)" }}>{r.title}</strong>
            <select value={r.reader_participant_id ?? ""} onChange={(e) => patch(r.id, { reader_participant_id: e.target.value || null })} style={selectS} aria-label={t("reader")}>
              <option value="">{t("reader")}</option>
              {participants.map((p) => <option key={p.id} value={p.id}>{partName(p.id)}</option>)}
            </select>
            <input defaultValue={r.language ?? ""} placeholder={t("languagePh")} onBlur={(e) => { if (e.target.value !== (r.language ?? "")) patch(r.id, { language: e.target.value.trim() || null }); }} style={{ ...inputS, width: 70 }} />
            <input defaultValue={r.duration_min ?? ""} inputMode="numeric" placeholder="min" onBlur={(e) => { const v = e.target.value.trim() === "" ? null : Number(e.target.value.replace(/\D/g, "")) || 0; if (v !== (r.duration_min ?? null)) patch(r.id, { duration_min: v }); }} style={{ ...inputS, width: 52, textAlign: "right" }} aria-label="min" />
            <select value={r.document_id ?? ""} onChange={(e) => patch(r.id, { document_id: e.target.value || null })} style={selectS} aria-label={t("document")}>
              <option value="">{t("document")}</option>
              {documents.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
            </select>
            <button className="addnote" aria-pressed={r.status === "approved"} onClick={() => patch(r.id, { status: r.status === "approved" ? "proposed" : "approved" })}>
              {r.status === "approved" ? t("approved") : t("approve")}
            </button>
            <button className="addnote" title={t("duplicate")} disabled={pending} onClick={() => start(async () => { await duplicateCeremonyItem("ceremony_readings", r.id); router.refresh(); })}>⧉</button>
            <button className="addnote" style={{ color: "var(--bronze)" }} disabled={pending} onClick={() => start(async () => { await removeCeremonyItem("ceremony_readings", r.id); router.refresh(); })}>
              {t("remove")}
            </button>
          </div>
          <textarea
            defaultValue={r.excerpt ?? ""}
            placeholder={t("excerptPh")}
            rows={r.excerpt ? 2 : 1}
            onBlur={(e) => { if (e.target.value !== (r.excerpt ?? "")) patch(r.id, { excerpt: e.target.value.trim() || null }); }}
            style={{ ...inputS, width: "100%", marginTop: 6, fontFamily: "inherit" }}
          />
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("titlePh")} style={{ ...inputS, minWidth: 200 }} />
        <button
          className="addnote"
          disabled={pending || !title.trim()}
          onClick={() => start(async () => { const r = await saveCeremonyItem({ table: "ceremony_readings", weddingId: ceremony.wedding_id, ceremonyId: ceremony.id, row: { title: title.trim() } }); if (!r.ok) window.alert(t("needsMigration")); setTitle(""); router.refresh(); })}
        >
          {t("add")}
        </button>
      </div>
    </>
  );
}

/* ══════════ papers (§11) ══════════ */

export function CeremonyDocsDesk({
  ceremony, links, documents
}: {
  ceremony: Ceremony;
  links: CeremonyDocumentLink[];
  documents: DocumentOption[];
}) {
  const t = useTranslations("ceremony.sections.docs");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [docId, setDocId] = useState("");
  const [role, setRole] = useState("script");

  return (
    <>
      {links.map((l) => {
        const d = documents.find((x) => x.id === l.document_id);
        return (
          <div key={l.id} style={rowS}>
            <span className="tag int">{t(`roles.${DOCUMENT_ROLES.includes(l.role as (typeof DOCUMENT_ROLES)[number]) ? l.role : "other"}`)}</span>
            <span style={{ flex: 1, fontSize: 13.5 }}>{d?.label ?? t("gone")}</span>
            {d?.internal && <span className="tag">{t("internalTag")}</span>}
            <button className="addnote" disabled={pending} onClick={() => start(async () => { await detachCeremonyDocument(l.id); router.refresh(); })}>
              {t("detach")}
            </button>
          </div>
        );
      })}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
        <select value={docId} onChange={(e) => setDocId(e.target.value)} style={{ ...selectS, minWidth: 180 }} aria-label={t("pick")}>
          <option value="">{t("pick")}</option>
          {documents.filter((d) => !links.some((l) => l.document_id === d.id)).map((d) => (
            <option key={d.id} value={d.id}>{d.label}</option>
          ))}
        </select>
        <select value={role} onChange={(e) => setRole(e.target.value)} style={selectS} aria-label={t("rolePick")}>
          {DOCUMENT_ROLES.map((r) => <option key={r} value={r}>{t(`roles.${r}`)}</option>)}
        </select>
        <button
          className="addnote"
          disabled={pending || !docId}
          onClick={() => start(async () => { const r = await linkCeremonyDocument(ceremony.wedding_id, ceremony.id, docId, role); if (!r.ok) window.alert(t("needsMigration")); setDocId(""); router.refresh(); })}
        >
          {t("link")}
        </button>
      </div>
      <p style={{ fontSize: 12, color: "var(--ink2)", margin: "6px 0 0" }}>{t("canonNote")}</p>
    </>
  );
}

/* ══════════ logistics (§12) — internal ══════════ */

const LOGISTIC_SUGGESTIONS = ["chairs", "microphones", "lecterns", "sound", "power", "water", "shade", "umbrellas", "programmes", "signing_table", "accessibility", "transport"] as const;

export function LogisticsDesk({
  ceremony, items, vendors, lines
}: {
  ceremony: Ceremony;
  items: CeremonyLogistic[];
  vendors: VendorOption[];
  lines: LineOption[];
}) {
  const t = useTranslations("ceremony.sections.logistics");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [item, setItem] = useState("");

  const patch = (id: string, row: Record<string, unknown>) =>
    start(async () => { await saveCeremonyItem({ table: "ceremony_logistics", id, weddingId: ceremony.wedding_id, ceremonyId: ceremony.id, row }); router.refresh(); });
  const add = (label: string) =>
    start(async () => { const r = await saveCeremonyItem({ table: "ceremony_logistics", weddingId: ceremony.wedding_id, ceremonyId: ceremony.id, row: { item: label } }); if (!r.ok) window.alert(t("needsMigration")); setItem(""); router.refresh(); });

  return (
    <>
      {items.map((l) => (
        <div key={l.id} style={rowS}>
          <strong style={{ fontSize: 13.5, color: "var(--hunter)" }}>{l.item}</strong>
          <input defaultValue={l.qty ?? ""} inputMode="numeric" placeholder={t("qtyPh")} onBlur={(e) => { const v = e.target.value.trim() === "" ? null : Number(e.target.value.replace(/\D/g, "")) || 0; if (v !== (l.qty ?? null)) patch(l.id, { qty: v }); }} style={{ ...inputS, width: 56, textAlign: "right" }} />
          <input defaultValue={l.detail ?? ""} placeholder={t("detailPh")} onBlur={(e) => { if (e.target.value !== (l.detail ?? "")) patch(l.id, { detail: e.target.value.trim() || null }); }} style={{ ...inputS, flex: 1, minWidth: 110 }} />
          <input defaultValue={l.owner ?? ""} placeholder={t("ownerPh")} onBlur={(e) => { if (e.target.value !== (l.owner ?? "")) patch(l.id, { owner: e.target.value.trim() || null }); }} style={{ ...inputS, width: 100 }} />
          <select value={l.vendor_id ?? ""} onChange={(e) => patch(l.id, { vendor_id: e.target.value || null })} style={selectS} aria-label={t("vendor")}>
            <option value="">{t("vendor")}</option>
            {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
          <select value={l.budget_line_id ?? ""} onChange={(e) => patch(l.id, { budget_line_id: e.target.value || null })} style={selectS} aria-label={t("line")}>
            <option value="">{t("line")}</option>
            {lines.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
          </select>
          <span style={{ display: "inline-flex", gap: 4 }}>
            {(["open", "ready", "not_required"] as const).map((s) => (
              <button key={s} className={`tag${l.status === s ? (s === "ready" ? " ok" : " int") : ""}`} style={{ cursor: "pointer", opacity: l.status === s ? 1 : 0.5 }} aria-pressed={l.status === s} onClick={() => patch(l.id, { status: s })}>
                {t(`status.${s}`)}
              </button>
            ))}
          </span>
          <button className="addnote" style={{ color: "var(--bronze)" }} disabled={pending} onClick={() => start(async () => { await removeCeremonyItem("ceremony_logistics", l.id); router.refresh(); })}>
            ×
          </button>
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
        <input value={item} onChange={(e) => setItem(e.target.value)} placeholder={t("itemPh")} style={{ ...inputS, minWidth: 160 }} onKeyDown={(e) => { if (e.key === "Enter" && item.trim()) add(item.trim()); }} />
        <button className="addnote" disabled={pending || !item.trim()} onClick={() => add(item.trim())}>{t("add")}</button>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
        {LOGISTIC_SUGGESTIONS.filter((s) => !items.some((l) => l.item.toLowerCase() === t(`suggested.${s}`).toLowerCase())).map((s) => (
          <button key={s} className="tag" style={{ cursor: "pointer" }} disabled={pending} onClick={() => add(t(`suggested.${s}`))}>
            + {t(`suggested.${s}`)}
          </button>
        ))}
      </div>
    </>
  );
}

/* ══════════ readiness (§16) ══════════ */

export function ReadinessCard({ ceremony, sections }: { ceremony: Ceremony; sections: SectionsShape }) {
  const t = useTranslations("ceremony.readiness");
  const router = useRouter();
  const [, start] = useTransition();
  const r = ceremonyReadiness(ceremony, sections);
  const marks = ceremony.checklist ?? {};

  return (
    <div className="team-only" style={{ borderTop: "1px solid var(--line)", padding: "10px 0" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
        <span className="eyebrow">{t("title")}</span>
        <strong style={{ fontSize: 14, color: r.blocking.length ? "var(--bronze)" : "var(--hunter)" }}>
          {t("count", { done: r.done, total: r.total })}
        </strong>
        {r.blocking.length > 0 && (
          <span style={{ fontSize: 12.5, color: "var(--bronze)" }}>
            {t("blocking")} : {r.blocking.map((c) => t(`checks.${c}`)).join(" · ")}
          </span>
        )}
        {r.blocking.length === 0 && r.counsel.length > 0 && (
          <span style={{ fontSize: 12.5, color: "var(--ink2)" }}>
            {t("counsel")} : {r.counsel.map((c) => t(`checks.${c}`)).join(" · ")}
          </span>
        )}
        {r.blocking.length === 0 && r.counsel.length === 0 && <span className="tag ok">{t("allSet")}</span>}
      </div>
      <details style={{ marginTop: 6 }}>
        <summary className="addnote" style={{ cursor: "pointer" }}>{t("tune")}</summary>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
          {READINESS_CHECKS.map((c) => (
            <label key={c} style={{ fontSize: 12, color: "var(--ink2)", display: "inline-flex", gap: 5, alignItems: "baseline" }}>
              {t(`checks.${c}`)}
              <select
                value={marks[c] ?? "default"}
                onChange={(e) =>
                  start(async () => {
                    await setCeremonyCheckMark(ceremony.id, c, e.target.value as "required" | "optional" | "na");
                    router.refresh();
                  })
                }
                style={{ ...selectS, fontSize: 11.5, padding: "2px 4px" }}
              >
                <option value="default" disabled>{t("markDefault")}</option>
                <option value="required">{t("markRequired")}</option>
                <option value="optional">{t("markOptional")}</option>
                <option value="na">{t("markNa")}</option>
              </select>
            </label>
          ))}
        </div>
      </details>
    </div>
  );
}

/* ══════════ Madame — Team View only (§15) ══════════ */

export function MadameCeremony({ ceremony }: { ceremony: Ceremony }) {
  const t = useTranslations("ceremony.madame");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<{ block_type: string; title: string; description: string | null; duration_min: number }[] | null>(null);
  const [pending, start] = useTransition();

  async function ask(mode: "counsel" | "flow" | "clientNote") {
    if (busy) return;
    setBusy(true);
    setText(null);
    setBlocks(null);
    try {
      const r = await fetch("/api/agents/ceremony", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weddingId: ceremony.wedding_id, ceremonyId: ceremony.id, mode })
      });
      const d = await r.json();
      if (mode === "flow") { setBlocks(d.blocks ?? []); setText(d.note ?? null); }
      else setText(d.text ?? t("failed"));
    } catch {
      setText(t("failed"));
    }
    setBusy(false);
  }

  return (
    <div className="ia team-only" style={{ marginTop: 10 }}>
      <div className="eyebrow">
        {t("title")} <span className="tag int">{t("internalTag")}</span>
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
        <button className="btn ghost sm" disabled={busy} onClick={() => ask("counsel")}>{busy ? "…" : t("counsel")}</button>
        <button className="btn ghost sm" disabled={busy} onClick={() => ask("flow")}>{t("proposeFlow")}</button>
        <button className="btn ghost sm" disabled={busy} onClick={() => ask("clientNote")}>{t("draftNote")}</button>
      </div>
      {text && (
        <p className="ia-quote" style={{ marginTop: 10, whiteSpace: "pre-wrap" }} aria-live="polite">{text}</p>
      )}
      {blocks && blocks.length > 0 && (
        <div style={{ marginTop: 10 }}>
          {blocks.map((b, i) => (
            <p key={i} style={{ fontSize: 13, margin: "3px 0" }}>
              <strong>{b.title}</strong> · {b.duration_min} min{b.description ? ` — ${b.description}` : ""}
            </p>
          ))}
          <button
            className="btn sm"
            style={{ marginTop: 8 }}
            disabled={pending}
            onClick={() =>
              start(async () => {
                for (const b of blocks) {
                  await saveCeremonyItem({
                    table: "ceremony_flow",
                    weddingId: ceremony.wedding_id,
                    ceremonyId: ceremony.id,
                    row: { block_type: b.block_type, title: b.title, description: b.description, duration_min: b.duration_min }
                  });
                }
                setBlocks(null);
                router.refresh();
              })
            }
          >
            {pending ? "…" : t("layBlocks", { n: blocks.length })}
          </button>
          <span style={{ fontSize: 12.5, color: "var(--ink2)", marginLeft: 10 }}>{t("proposalNote")}</span>
        </div>
      )}
    </div>
  );
}
