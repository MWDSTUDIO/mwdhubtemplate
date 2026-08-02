"use client";

import { useState, useTransition } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import type {
  Ceremony,
  CeremonyDocumentLink,
  CeremonyFlowItem,
  CeremonyLogistic,
  CeremonyMusic,
  CeremonyParticipant,
  CeremonyReading,
  CeremonyStatus
} from "@/lib/types";
import {
  deleteCeremony,
  duplicateCeremony,
  saveCeremony,
  setCeremonyArchived,
  setCeremonyStatus,
  revertCeremonyToPublished,
  applyTemplateFlow
} from "@/app/actions/ceremonies";
import { ceremonyReadiness, flowDuration } from "@/lib/ceremony";
import {
  CeremonyDocsDesk,
  CeremonyReadingsDesk,
  FlowDesk,
  LogisticsDesk,
  MadameCeremony,
  MusicDesk,
  ParticipantsDesk,
  ReadinessCard,
  Section,
  type DocumentOption,
  type LineOption,
  type PersonOption,
  type VendorOption
} from "@/components/ceremony-sections";
import { Dictate } from "@/components/Dictate";

/**
 * The ceremonial knowledge of the house — offered as suggestions,
 * never imposed: the kind stays free text.
 */
export const CEREMONY_KINDS = [
  "civil", "catholic", "protestant", "orthodox", "jewish", "laique",
  "interfaith", "hindu", "muslim", "buddhist", "shinto", "humanist",
  "vows", "blessing"
] as const;

const STATUSES: CeremonyStatus[] = ["draft", "ready_for_review", "approved", "published", "completed"];

export interface CeremonyBundle {
  ceremony: Ceremony;
  participants: CeremonyParticipant[];
  flow: CeremonyFlowItem[];
  music: CeremonyMusic[];
  readings: CeremonyReading[];
  logistics: CeremonyLogistic[];
  documents: CeremonyDocumentLink[];
  /** Overview fields that moved since the last published version (§22). */
  changed: string[];
}

export function CeremonyForm({
  weddingId,
  ceremony,
  onClose
}: {
  weddingId: string;
  ceremony: Ceremony | null;
  onClose: () => void;
}) {
  const t = useTranslations("ceremony.form");
  const tk = useTranslations("ceremony.kinds");
  const [kind, setKind] = useState(ceremony?.kind ?? "");
  const [title, setTitle] = useState(ceremony?.title ?? "");
  const [date, setDate] = useState(ceremony?.ceremony_date ?? "");
  const [time, setTime] = useState(ceremony?.start_time ?? "");
  const [venue, setVenue] = useState(ceremony?.venue ?? "");
  const [officiant, setOfficiant] = useState(ceremony?.officiant ?? "");
  const [notes, setNotes] = useState(ceremony?.notes ?? "");
  const [duration, setDuration] = useState(ceremony?.duration_min != null ? String(ceremony.duration_min) : "");
  const [planB, setPlanB] = useState(ceremony?.plan_b ?? "");
  const [failed, setFailed] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="card team-only" style={{ borderColor: "var(--champagne)" }}>
      <div className="eyebrow" style={{ marginBottom: 14 }}>
        {ceremony ? t("editTitle") : t("addTitle")}
      </div>
      <div className="grid2" style={{ gap: 12 }}>
        <div className="field">
          <label className="eyebrow">{t("kind")} *</label>
          <input
            list="ceremony-kinds"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            placeholder={t("kindPlaceholder")}
            aria-required="true"
            style={!kind.trim() ? { borderColor: "var(--bronze)" } : undefined}
          />
          <datalist id="ceremony-kinds">
            {CEREMONY_KINDS.map((k) => (
              <option key={k} value={tk(k)} />
            ))}
          </datalist>
        </div>
        <div className="field">
          <label className="eyebrow">{t("title")}</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("titlePlaceholder")} />
        </div>
        <div className="field">
          <label className="eyebrow">{t("dateTime")}</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} style={{ flex: "0 0 110px" }} />
          </div>
        </div>
        <div className="field">
          <label className="eyebrow">{t("venue")}</label>
          <input value={venue} onChange={(e) => setVenue(e.target.value)} placeholder={t("venuePlaceholder")} />
        </div>
        <div className="field">
          <label className="eyebrow">{t("officiant")}</label>
          <input value={officiant} onChange={(e) => setOfficiant(e.target.value)} placeholder={t("officiantPlaceholder")} />
        </div>
        <div className="field">
          <label className="eyebrow">{t("duration")}</label>
          <input
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            inputMode="numeric"
            placeholder={t("durationPlaceholder")}
          />
        </div>
        <div className="field" style={{ gridColumn: "1 / -1" }}>
          <label className="eyebrow">{t("planB")}</label>
          <input value={planB} onChange={(e) => setPlanB(e.target.value)} placeholder={t("planBPlaceholder")} />
        </div>
        <div className="field" style={{ gridColumn: "1 / -1" }}>
          <label className="eyebrow" style={{ display: "flex", alignItems: "center", gap: 10 }}>{t("notes")}<Dictate title={t("notes")} onText={(x) => setNotes((v) => (v ? v.trimEnd() + " " + x : x))} /></label>
          <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("notesPlaceholder")} />
        </div>
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
        <button
          className="btn"
          disabled={pending || !kind.trim()}
          title={!kind.trim() ? t("kindRequired") : undefined}
          onClick={() =>
            startTransition(async () => {
              const r = await saveCeremony({
                id: ceremony?.id, weddingId, kind, title, date, time, venue, officiant, notes,
                durationMin: duration.trim() === "" ? null : Number(duration.replace(/\D/g, "")) || 0,
                planB
              });
              if (r.ok) {
                onClose();
              } else {
                setFailed(r.message ?? "");
              }
            })
          }
        >
          {pending ? "…" : t("save")}
        </button>
        {ceremony && (
          <button
            className="btn ghost"
            disabled={pending}
            title={t("removeHint")}
            onClick={() =>
              startTransition(async () => {
                const r = await deleteCeremony(ceremony.id);
                if (r.archived) window.alert(t("archivedInstead"));
                onClose();
              })
            }
          >
            {t("remove")}
          </button>
        )}
        <button className="btn ghost" onClick={onClose}>{t("cancel")}</button>
      </div>
      {failed !== null && (
        <p role="alert" style={{ marginTop: 12, fontSize: 13, color: "var(--bronze)" }}>
          {t("saveFailed")}
          {failed && <span style={{ display: "block", fontSize: 12.5 }}>{failed}</span>}
        </p>
      )}
    </div>
  );
}

/** The couple's reading — published, approved, curated (§14). */
function ClientCeremony({
  bundle,
  people,
  vendors,
  documents
}: {
  bundle: CeremonyBundle;
  people: PersonOption[];
  vendors: VendorOption[];
  documents: DocumentOption[];
}) {
  const t = useTranslations("ceremony");
  const c = bundle.ceremony;
  const participants = bundle.participants.filter((p) => p.client_visible);
  const flow = bundle.flow.filter((f) => !f.archived);
  const readings = bundle.readings.filter((r) => r.status === "approved" && !r.archived);
  const music = bundle.music.filter((m) => m.status === "approved" && !m.archived);
  const docs = bundle.documents
    .map((l) => documents.find((d) => d.id === l.document_id))
    .filter((d): d is DocumentOption => Boolean(d && !d.internal));
  const partName = (p: CeremonyParticipant) =>
    p.name || people.find((x) => x.id === p.person_id)?.label || vendors.find((v) => v.id === p.vendor_id)?.name || null;
  const minutes = c.duration_min ?? (flowDuration(bundle.flow) || null);

  return (
    <>
      <hr className="hair" style={{ margin: "16px 0" }} />
      <div className="grid3">
        <div>
          <div className="eyebrow">{t("when")}</div>
          <p style={{ marginTop: 6, fontSize: 13.5 }}>
            {c.ceremony_date ?? t("toSettle")}
            {c.start_time ? ` · ${c.start_time}` : ""}
            {minutes ? ` · ${t("aboutMin", { min: minutes })}` : ""}
          </p>
        </div>
        <div>
          <div className="eyebrow">{t("where")}</div>
          <p style={{ marginTop: 6, fontSize: 13.5 }}>{c.venue ?? t("toSettle")}</p>
        </div>
        <div>
          <div className="eyebrow">{t("officiantLabel")}</div>
          <p style={{ marginTop: 6, fontSize: 13.5 }}>{c.officiant ?? t("toSettle")}</p>
        </div>
      </div>
      {participants.length > 0 && (
        <p style={{ marginTop: 12, fontSize: 13.5, color: "var(--ink2)" }}>
          {t("withNames", { names: participants.map((p) => partName(p)).filter(Boolean).join(" · ") })}
        </p>
      )}
      {flow.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div className="eyebrow">{t("clientFlowTitle")}</div>
          <div style={{ marginTop: 6 }}>
            {flow.map((f) => (
              <p key={f.id} style={{ fontSize: 13.5, margin: "3px 0" }}>
                {f.title}
                {f.note_client && <span style={{ color: "var(--ink2)" }}> — {f.note_client}</span>}
              </p>
            ))}
          </div>
        </div>
      )}
      {(readings.length > 0 || music.length > 0) && (
        <div style={{ marginTop: 14, display: "flex", gap: 28, flexWrap: "wrap" }}>
          {readings.length > 0 && (
            <div>
              <div className="eyebrow">{t("clientReadings")}</div>
              {readings.map((r) => (
                <p key={r.id} style={{ fontSize: 13.5, margin: "3px 0" }}>
                  {r.title}
                  {r.note_client && <span style={{ color: "var(--ink2)" }}> — {r.note_client}</span>}
                </p>
              ))}
            </div>
          )}
          {music.length > 0 && (
            <div>
              <div className="eyebrow">{t("clientMusic")}</div>
              {music.map((m) => (
                <p key={m.id} style={{ fontSize: 13.5, margin: "3px 0" }}>
                  {m.title}
                  {m.artist && <span style={{ color: "var(--ink2)" }}> — {m.artist}</span>}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
      {docs.length > 0 && (
        <p style={{ marginTop: 12, fontSize: 13, color: "var(--ink2)" }}>
          {t("clientDocs", { labels: docs.map((d) => d.label).join(" · ") })}
        </p>
      )}
      {c.notes && (
        <p className="serif" style={{ fontSize: 16.5, fontStyle: "italic", lineHeight: 1.6, marginTop: 16, color: "var(--ink2)" }}>
          &ldquo;{c.notes}&rdquo; — Estelle
        </p>
      )}
    </>
  );
}

export function CeremonyList({
  bundles,
  ceremonies,
  weddingId,
  isTeam,
  people = [],
  vendors = [],
  documents = [],
  lines = []
}: {
  bundles?: CeremonyBundle[];
  /** Legacy door (The Desk): the classic cards, untouched. */
  ceremonies?: Ceremony[];
  weddingId: string;
  isTeam: boolean;
  people?: PersonOption[];
  vendors?: VendorOption[];
  documents?: DocumentOption[];
  lines?: LineOption[];
}) {
  const t = useTranslations("ceremony");
  const format = useFormatter();
  const router = useRouter();
  const [editing, setEditing] = useState<Ceremony | "new" | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [pending, startTransition] = useTransition();

  // The Desk keeps its old reading: kind, name, when, where, hands.
  if (!bundles) {
    return (
      <>
        {(ceremonies ?? []).filter((c) => !c.archived).map((c) => (
          <div className="card" key={c.id}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
              <div>
                <div className="eyebrow">{c.kind}</div>
                <div className="serif" style={{ fontSize: 24, fontStyle: "italic", marginTop: 4 }}>
                  {c.title || t("untitled")}
                </div>
              </div>
              {isTeam && (
                <button className="addnote team-only" onClick={() => setEditing(c)}>
                  {t("edit")}
                </button>
              )}
            </div>
            <hr className="hair" style={{ margin: "16px 0" }} />
            <div className="grid3">
              <div>
                <div className="eyebrow">{t("when")}</div>
                <p style={{ marginTop: 6, fontSize: 13.5 }}>
                  {c.ceremony_date ?? t("toSettle")}
                  {c.start_time ? ` · ${c.start_time}` : ""}
                </p>
              </div>
              <div>
                <div className="eyebrow">{t("where")}</div>
                <p style={{ marginTop: 6, fontSize: 13.5 }}>{c.venue ?? t("toSettle")}</p>
              </div>
              <div>
                <div className="eyebrow">{t("officiantLabel")}</div>
                <p style={{ marginTop: 6, fontSize: 13.5 }}>{c.officiant ?? t("toSettle")}</p>
              </div>
            </div>
            {c.notes && (
              <p className="serif" style={{ fontSize: 16.5, fontStyle: "italic", lineHeight: 1.6, marginTop: 16, color: "var(--ink2)" }}>
                &ldquo;{c.notes}&rdquo;
              </p>
            )}
          </div>
        ))}
        {isTeam && editing === null && (
          <button className="btn ghost team-only" onClick={() => setEditing("new")}>
            {t("add")}
          </button>
        )}
        {editing !== null && (
          <CeremonyForm weddingId={weddingId} ceremony={editing === "new" ? null : editing} onClose={() => setEditing(null)} />
        )}
      </>
    );
  }

  const visible = bundles.filter((b) => showArchived || !b.ceremony.archived);
  const archivedCount = bundles.filter((b) => b.ceremony.archived).length;

  // The refined empty state (§5): create, template, duplicate.
  if (bundles.length === 0 && isTeam && editing === null) {
    return (
      <div className="card team-only" style={{ textAlign: "center", padding: "36px 28px" }}>
        <p className="serif" style={{ fontSize: 19, fontStyle: "italic", color: "var(--ink2)" }}>{t("empty")}</p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap", marginTop: 16 }}>
          <button className="btn" onClick={() => setEditing("new")}>{t("create")}</button>
          <button
            className="btn ghost"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const r = await saveCeremony({ weddingId, kind: t("templateKind"), title: "", date: "", time: "", venue: "", officiant: "", notes: "" });
                if (r.ok && r.id) await applyTemplateFlow(weddingId, r.id);
                router.refresh();
              })
            }
          >
            {pending ? "…" : t("fromTemplate")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {visible.map((b) => {
        const c = b.ceremony;
        const readiness = ceremonyReadiness(c, b);
        const minutes = c.duration_min ?? (flowDuration(b.flow) || null);
        const status = (c.status ?? "published") as CeremonyStatus;
        return (
          <div className="card" key={c.id} style={c.archived ? { opacity: 0.6 } : undefined}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
              <div>
                <div className="eyebrow">{c.kind}</div>
                <div className="serif" style={{ fontSize: 24, fontStyle: "italic", marginTop: 4 }}>
                  {c.title || t("untitled")}
                </div>
              </div>
              {isTeam && (
                <div className="team-only" style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                  <span className={`tag${status === "published" || status === "completed" ? " ok" : status === "draft" ? " int" : " wait"}`}>
                    {t(`status.${status}`)}
                  </span>
                  {c.archived && <span className="tag">{t("archivedTag")}</span>}
                  <button className="addnote" onClick={() => setEditing(c)}>{t("edit")}</button>
                  <button className="addnote" disabled={pending} onClick={() => startTransition(async () => { await duplicateCeremony(c.id); router.refresh(); })}>
                    {t("duplicate")}
                  </button>
                  <button
                    className="addnote"
                    disabled={pending}
                    onClick={() => startTransition(async () => { const r = await setCeremonyArchived(c.id, !c.archived); if (!r.ok) window.alert(t("needsMigration")); router.refresh(); })}
                  >
                    {c.archived ? t("restore") : t("archiveAction")}
                  </button>
                  <details style={{ position: "relative" }}>
                    <summary className="addnote" style={{ cursor: "pointer", listStyle: "none" }}>{t("export")} ▾</summary>
                    <div style={{ position: "absolute", right: 0, top: "120%", zIndex: 30, background: "#fff", border: "1px solid var(--line)", boxShadow: "0 10px 30px rgba(34,56,43,.14)", padding: "6px 0", minWidth: 220 }}>
                      {([
                        ["summary", "pdf"], ["script", "pdf"], ["brief", "pdf"], ["client", "pdf"],
                        ["flow", "xlsx"], ["participants", "xlsx"], ["music", "xlsx"], ["readings", "xlsx"], ["logistics", "xlsx"]
                      ] as const).map(([k, f]) => (
                        <a
                          key={k}
                          className="addnote"
                          style={{ display: "block", padding: "5px 14px", textDecoration: "none" }}
                          href={`/api/ceremony-exports?ceremonyId=${c.id}&kind=${k}&format=${f}`}
                          target={f === "pdf" ? "_blank" : undefined}
                          rel="noreferrer"
                        >
                          {t(`exports.${k}`)} · {f.toUpperCase()}
                        </a>
                      ))}
                    </div>
                  </details>
                </div>
              )}
            </div>

            {/* The compact summary (§5) — team's reading of where it stands. */}
            {isTeam && (
              <p className="team-only" style={{ fontSize: 12.5, color: "var(--ink2)", margin: "8px 0 0" }}>
                {[
                  c.ceremony_date ? `${c.ceremony_date}${c.start_time ? ` · ${c.start_time}` : ""}` : t("toSettle"),
                  c.venue ?? t("toSettle"),
                  c.officiant ?? t("toSettle"),
                  minutes ? t("aboutMin", { min: minutes }) : null,
                  t("readinessShort", { done: readiness.done, total: readiness.total }),
                  c.updated_at ? t("updated", { date: format.dateTime(new Date(c.updated_at), { day: "numeric", month: "short" }) }) : null
                ].filter(Boolean).join("  ·  ")}
              </p>
            )}

            {/* Publication (§22): what moved, then Estelle's word. */}
            {isTeam && !c.archived && (
              <div className="team-only" style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap", marginTop: 10 }}>
                {STATUSES.filter((s) => s !== status).map((s) => (
                  <button
                    key={s}
                    className="addnote"
                    disabled={pending}
                    onClick={() => startTransition(async () => { const r = await setCeremonyStatus(c.id, s); if (!r.ok) window.alert(t("needsMigration")); router.refresh(); })}
                  >
                    {t(`statusAction.${s}`)}
                  </button>
                ))}
                {status !== "published" && (
                  <button
                    className="addnote"
                    disabled={pending}
                    onClick={() => {
                      if (!window.confirm(t("publishNotifyConfirm"))) return;
                      startTransition(async () => { await setCeremonyStatus(c.id, "published", true); router.refresh(); });
                    }}
                  >
                    {t("publishNotify")}
                  </button>
                )}
                {b.changed.length > 0 && (
                  <span style={{ fontSize: 12.5, color: "var(--bronze)" }}>
                    {t("changedSince", { fields: b.changed.map((f) => t(`changedField.${f}`)).join(" · ") })}
                    {" "}
                    <button
                      className="addnote"
                      style={{ color: "var(--bronze)" }}
                      disabled={pending}
                      onClick={() => {
                        if (!window.confirm(t("revertConfirm"))) return;
                        startTransition(async () => { await revertCeremonyToPublished(c.id); router.refresh(); });
                      }}
                    >
                      {t("revert")}
                    </button>
                  </span>
                )}
              </div>
            )}

            {isTeam && !c.archived && <ReadinessCard ceremony={c} sections={b} />}

            {/* The desks (§6) — folded, team only. */}
            {isTeam && !c.archived && (
              <>
                <Section title={t("sections.participants.title")} count={b.participants.length}>
                  <ParticipantsDesk ceremony={c} items={b.participants} people={people} vendors={vendors} />
                </Section>
                <Section title={t("sections.flow.title")} count={b.flow.filter((f) => !f.archived).length} hint={minutes ? t("aboutMin", { min: minutes }) : undefined}>
                  <FlowDesk ceremony={c} items={b.flow} participants={b.participants} people={people} vendors={vendors} />
                </Section>
                <Section title={t("sections.music.title")} count={b.music.filter((m) => !m.archived).length}>
                  <MusicDesk ceremony={c} items={b.music} flow={b.flow} vendors={vendors} documents={documents} />
                </Section>
                <Section title={t("sections.readings.title")} count={b.readings.filter((r) => !r.archived).length}>
                  <CeremonyReadingsDesk ceremony={c} items={b.readings} participants={b.participants} people={people} vendors={vendors} documents={documents} />
                </Section>
                <Section title={t("sections.docs.title")} count={b.documents.length}>
                  <CeremonyDocsDesk ceremony={c} links={b.documents} documents={documents} />
                </Section>
                <Section title={t("sections.logistics.title")} count={b.logistics.length}>
                  <LogisticsDesk ceremony={c} items={b.logistics} vendors={vendors} lines={lines} />
                </Section>
                <Section title={t("madame.title")}>
                  <MadameCeremony ceremony={c} />
                </Section>
              </>
            )}

            {/* The couple's reading — and Estelle's Client view, identical. */}
            {isTeam ? (
              <div className="client-preview">
                {status === "published" ? (
                  <ClientCeremony bundle={b} people={people} vendors={vendors} documents={documents} />
                ) : (
                  <p style={{ fontSize: 13.5, color: "var(--ink2)", marginTop: 10 }}>{t("clientNothing")}</p>
                )}
              </div>
            ) : (
              <ClientCeremony bundle={b} people={people} vendors={vendors} documents={documents} />
            )}
          </div>
        );
      })}

      {isTeam && (
        <div className="team-only" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {editing === null && (
            <button className="btn ghost" onClick={() => setEditing("new")}>
              {t("add")}
            </button>
          )}
          {archivedCount > 0 && (
            <button className="btn ghost" onClick={() => setShowArchived((v) => !v)} aria-pressed={showArchived}>
              {showArchived ? t("hideArchived") : t("showArchivedCount", { count: archivedCount })}
            </button>
          )}
        </div>
      )}
      {editing !== null && (
        <CeremonyForm
          weddingId={weddingId}
          ceremony={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
