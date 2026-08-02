"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import type { WeddingEvent } from "@/lib/types";
import { MOMENT_KINDS, totalReferences, type MomentReferences } from "@/lib/moments";
import {
  deleteMomentIfUnused,
  linkMoment,
  momentLinkContext,
  momentReferences,
  reorderMoments,
  saveMoment,
  setMomentArchived,
  unlinkMoment,
  type MomentLinkModule
} from "@/app/actions/moments";

/**
 * The Wedding Moments registry desk (PRD Moments §4) — lives in The
 * Desk, team only. Every row IS the canonical wedding_events record:
 * renames keep the id, archives keep the history, delete exists only
 * for a moment nothing points at.
 */
export function MomentsDesk({ weddingId, moments }: { weddingId: string; moments: WeddingEvent[] }) {
  const t = useTranslations("moments");
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [edited, setEdited] = useState<Record<string, Partial<WeddingEvent>>>({});
  const [adding, setAdding] = useState({ name: "", date: "" });
  const [refsFor, setRefsFor] = useState<{ id: string; refs: MomentReferences } | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => startTransition(() => router.refresh());

  const rowOf = (m: WeddingEvent): WeddingEvent => ({ ...m, ...(edited[m.id] ?? {}) });
  const setRow = (id: string, patch: Partial<WeddingEvent>) =>
    setEdited((p) => ({ ...p, [id]: { ...(p[id] ?? {}), ...patch } }));

  const persist = async (m: WeddingEvent) => {
    const row = rowOf(m);
    setBusy(true);
    const r = await saveMoment({
      weddingId,
      id: m.id,
      name: row.name,
      eventDate: row.event_date ?? null,
      startTime: row.start_time ?? null,
      endTime: row.end_time ?? null,
      venue: row.venue ?? null,
      eventType: row.event_type ?? null,
      force: true // an edit of an existing row never asks the duplicate question
    });
    setBusy(false);
    if (r.ok) {
      setEdited((p) => { const n = { ...p }; delete n[m.id]; return n; });
      refresh();
    }
  };

  const add = async () => {
    if (!adding.name.trim()) return;
    setBusy(true);
    let r = await saveMoment({ weddingId, name: adding.name, eventDate: adding.date || null });
    if (!r.ok && r.reason === "duplicate") {
      // §15 — Use existing (do nothing), or create anyway.
      const anyway = window.confirm(t("dupAsk", { name: r.duplicate.name }));
      if (anyway) r = await saveMoment({ weddingId, name: adding.name, eventDate: adding.date || null, force: true });
    }
    setBusy(false);
    if (r.ok) { setAdding({ name: "", date: "" }); refresh(); }
  };

  const move = async (id: string, dir: -1 | 1) => {
    const ids = moments.map((m) => m.id);
    const i = ids.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await reorderMoments(weddingId, ids);
    refresh();
  };

  const showRefs = async (id: string) => {
    setRefsFor({ id, refs: await momentReferences(id) });
  };

  const del = async (m: WeddingEvent) => {
    const refs = await momentReferences(m.id);
    if (totalReferences(refs) > 0) {
      setRefsFor({ id: m.id, refs });
      window.alert(t("deleteRefused", { count: totalReferences(refs) }));
      return;
    }
    if (!window.confirm(t("deleteConfirm", { name: m.name }))) return;
    await deleteMomentIfUnused(weddingId, m.id);
    refresh();
  };

  const refLine = (refs: MomentReferences) =>
    (Object.entries(refs) as [keyof MomentReferences, number][])
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${n} ${t(`refs.${k}`)}`)
      .join(" · ") || t("refs.none");

  return (
    <div className="card team-only" id="moments-registry">
      <div className="eyebrow" style={{ marginBottom: 4 }}>{t("title")}</div>
      <p style={{ fontSize: 12.5, color: "var(--ink2)", margin: "0 0 10px" }}>{t("hint")}</p>
      {moments.map((m, i) => {
        const row = rowOf(m);
        const dirty = Boolean(edited[m.id]);
        return (
          <div key={m.id} style={{ borderTop: "1px solid var(--hair, #e5e0d0)", padding: "8px 0", opacity: m.archived ? 0.6 : 1 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ display: "inline-flex", gap: 2 }}>
                <button className="addnote" aria-label={t("up")} disabled={i === 0} onClick={() => void move(m.id, -1)}>↑</button>
                <button className="addnote" aria-label={t("down")} disabled={i === moments.length - 1} onClick={() => void move(m.id, 1)}>↓</button>
              </span>
              <input
                value={row.name}
                onChange={(e) => setRow(m.id, { name: e.target.value })}
                aria-label={t("name")}
                style={{ flex: 1, minWidth: 150, fontSize: 13.5 }}
              />
              <input
                type="date"
                value={row.event_date ?? ""}
                onChange={(e) => setRow(m.id, { event_date: e.target.value })}
                aria-label={t("date")}
                style={{ fontSize: 13 }}
              />
              <input
                type="time"
                value={row.start_time?.slice(0, 5) ?? ""}
                onChange={(e) => setRow(m.id, { start_time: e.target.value })}
                aria-label={t("start")}
                style={{ fontSize: 13, width: 92 }}
              />
              <select
                value={row.event_type ?? ""}
                onChange={(e) => setRow(m.id, { event_type: e.target.value })}
                aria-label={t("type")}
                style={{ fontSize: 13 }}
              >
                <option value="">{t("noType")}</option>
                {MOMENT_KINDS.map((k) => (
                  <option key={k} value={k}>{t(`kinds.${k}`)}</option>
                ))}
              </select>
              <input
                value={row.venue ?? ""}
                onChange={(e) => setRow(m.id, { venue: e.target.value })}
                placeholder={t("venuePh")}
                aria-label={t("venuePh")}
                style={{ fontSize: 13, width: 140 }}
              />
              {dirty && (
                <button className="btn sm" disabled={busy} onClick={() => void persist(m)}>{t("keep")}</button>
              )}
              <button className="addnote" onClick={() => void showRefs(m.id)}>{t("links")}</button>
              {m.archived ? (
                <button className="addnote" onClick={async () => { await setMomentArchived(weddingId, m.id, false); refresh(); }}>{t("restore")}</button>
              ) : (
                <button
                  className="addnote"
                  onClick={async () => {
                    const refs = await momentReferences(m.id);
                    if (!window.confirm(t("archiveConfirm", { name: m.name, links: refLine(refs) }))) return;
                    await setMomentArchived(weddingId, m.id, true);
                    refresh();
                  }}
                >
                  {t("archive")}
                </button>
              )}
              <button className="addnote" style={{ color: "var(--bronze)" }} onClick={() => void del(m)}>{t("delete")}</button>
            </div>
            {refsFor?.id === m.id && (
              <p style={{ fontSize: 12, color: "var(--ink2)", margin: "4px 0 0 34px" }}>{refLine(refsFor.refs)}</p>
            )}
          </div>
        );
      })}
      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <input
          value={adding.name}
          onChange={(e) => setAdding((p) => ({ ...p, name: e.target.value }))}
          onKeyDown={(e) => { if (e.key === "Enter") void add(); }}
          placeholder={t("addPh")}
          style={{ flex: 1, minWidth: 160, fontSize: 13.5 }}
        />
        <input
          type="date"
          value={adding.date}
          onChange={(e) => setAdding((p) => ({ ...p, date: e.target.value }))}
          aria-label={t("date")}
          style={{ fontSize: 13 }}
        />
        <button className="btn ghost sm" disabled={busy || !adding.name.trim()} onClick={() => void add()}>{t("add")}</button>
      </div>
    </div>
  );
}

/**
 * Related Wedding Moments — the shared picker (§8–§11). One line to
 * host in any team view; the moment stays a reference in
 * moment_links, never a copy.
 */
export function MomentLinks({
  weddingId,
  module,
  recordId
}: {
  weddingId: string;
  module: MomentLinkModule;
  recordId: string;
}) {
  const t = useTranslations("moments");
  const [ctx, setCtx] = useState<Awaited<ReturnType<typeof momentLinkContext>> | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => setCtx(await momentLinkContext(weddingId, module, recordId));
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [weddingId, module, recordId]);

  if (!ctx) return null;
  const nameOf = new Map(ctx.moments.map((m) => [m.id, m.name]));
  const linkedIds = new Set(ctx.links.map((l) => l.event_id));
  const free = ctx.moments.filter((m) => !linkedIds.has(m.id));

  return (
    <div className="team-only" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <span className="eyebrow" style={{ fontSize: 10.5 }}>{t("related")}</span>
      {ctx.links.map((l) => (
        <span key={l.id} className="tag" style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
          {nameOf.get(l.event_id) ?? "—"}
          <button
            className="addnote"
            aria-label={t("detach")}
            disabled={busy}
            onClick={async () => { setBusy(true); await unlinkMoment(l.id); await load(); setBusy(false); }}
          >
            ×
          </button>
        </span>
      ))}
      {free.length > 0 && (
        <select
          value=""
          aria-label={t("related")}
          disabled={busy}
          onChange={async (e) => {
            const id = e.target.value;
            if (!id) return;
            setBusy(true);
            const r = await linkMoment(weddingId, id, module, recordId);
            if (!r.ok && "needsMigration" in r) window.alert(t("needsMigration"));
            await load();
            setBusy(false);
          }}
          style={{ fontSize: 12.5 }}
        >
          <option value="">{t("attach")}</option>
          {free.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
      )}
    </div>
  );
}
