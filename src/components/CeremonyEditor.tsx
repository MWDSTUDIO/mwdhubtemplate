"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import type { Ceremony } from "@/lib/types";
import { deleteCeremony, saveCeremony } from "@/app/actions/ceremonies";
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
  const [pending, startTransition] = useTransition();

  return (
    <div className="card team-only" style={{ borderColor: "var(--champagne)" }}>
      <div className="eyebrow" style={{ marginBottom: 14 }}>
        {ceremony ? t("editTitle") : t("addTitle")}
      </div>
      <div className="grid2" style={{ gap: 12 }}>
        <div className="field">
          <label className="eyebrow">{t("kind")}</label>
          <input
            list="ceremony-kinds"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            placeholder={t("kindPlaceholder")}
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
        <div className="field" style={{ gridColumn: "1 / -1" }}>
          <label className="eyebrow" style={{ display: "flex", alignItems: "center", gap: 10 }}>{t("notes")}<Dictate title={t("notes")} onText={(x) => setNotes((v) => (v ? v.trimEnd() + " " + x : x))} /></label>
          <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("notesPlaceholder")} />
        </div>
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
        <button
          className="btn"
          disabled={pending || !kind.trim()}
          onClick={() =>
            startTransition(async () => {
              await saveCeremony({ id: ceremony?.id, weddingId, kind, title, date, time, venue, officiant, notes });
              onClose();
            })
          }
        >
          {pending ? "…" : t("save")}
        </button>
        {ceremony && (
          <button
            className="btn ghost"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await deleteCeremony(ceremony.id);
                onClose();
              })
            }
          >
            {t("remove")}
          </button>
        )}
        <button className="btn ghost" onClick={onClose}>{t("cancel")}</button>
      </div>
    </div>
  );
}

export function CeremonyList({
  ceremonies,
  weddingId,
  isTeam
}: {
  ceremonies: Ceremony[];
  weddingId: string;
  isTeam: boolean;
}) {
  const t = useTranslations("ceremony");
  const [editing, setEditing] = useState<Ceremony | "new" | null>(null);

  return (
    <>
      {ceremonies.map((c) => (
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
        <CeremonyForm
          weddingId={weddingId}
          ceremony={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
