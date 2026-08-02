"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import type { Milestone, MilestoneOps } from "@/lib/types";
import { saveMilestone, deleteMilestone, publishTimeline, importMilestones, type MilestoneImportRow } from "@/app/actions/timeline";
import { composeTimeline } from "@/app/actions/desk";
import { Dictate } from "@/components/Dictate";

/** The operational statuses a milestone can hold (0029, §7). */
const OP_STATUSES = ["draft", "planned", "waiting", "in_progress", "blocked", "ready", "completed", "archived"] as const;

export interface FrisePickers {
  vendors: { id: string; name: string }[];
  lines: { id: string; label: string }[];
  documents: { id: string; label: string }[];
  ceremonies: { id: string; label: string }[];
}

/**
 * The frise — month by month. For the team it is correctable in place:
 * click a milestone to edit (text, month, done, remove) or instruct
 * Madame. Corrections stay draft until published; the client's frise
 * never moves before Estelle's word. The operational side (status,
 * priority, owner, dependency, module links) rides in milestone_ops —
 * a team-only table the couple's API never carries.
 */
export function Frise({
  milestones,
  ops = {},
  pickers = { vendors: [], lines: [], documents: [], ceremonies: [] },
  weddingId,
  isTeam
}: {
  milestones: Milestone[];
  ops?: Record<string, MilestoneOps>;
  pickers?: FrisePickers;
  weddingId: string;
  isTeam: boolean;
}) {
  const t = useTranslations("timeline.frise");
  const tc = useTranslations("common");
  const format = useFormatter();
  const [editing, setEditing] = useState<Milestone | "new" | null>(null);
  const [instruct, setInstruct] = useState("");
  const [agentNote, setAgentNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [opFilter, setOpFilter] = useState("all");
  const [showArchived, setShowArchived] = useState(false);
  const [importing, setImporting] = useState(false);
  const [, startTransition] = useTransition();
  const router = useRouter();

  const hasDrafts = milestones.some((m) => m.status === "draft");
  const today = new Date().toISOString().slice(0, 10);

  const opOf = (m: Milestone): MilestoneOps["op_status"] =>
    ops[m.id]?.op_status ?? (m.done ? "completed" : "planned");
  const doneById = useMemo(() => new Map(milestones.map((m) => [m.id, m.done || opOf(m) === "completed"])), [milestones, ops]); // eslint-disable-line react-hooks/exhaustive-deps
  const isBlocked = (m: Milestone) => {
    const o = ops[m.id];
    if (!o) return false;
    if (o.op_status === "blocked") return true;
    return Boolean(o.depends_on && doneById.get(o.depends_on) === false && opOf(m) !== "completed" && opOf(m) !== "archived");
  };
  const isOverdue = (m: Milestone) => {
    const o = ops[m.id];
    const op = opOf(m);
    return Boolean(o?.due_date && o.due_date < today && op !== "completed" && op !== "archived");
  };

  // The team's working view (§6): archived rest aside, filters and
  // search narrow; the couple's frise stays exactly as it was.
  const shown = useMemo(() => {
    if (!isTeam) return milestones;
    let list = milestones.filter((m) => showArchived || opOf(m) !== "archived");
    if (opFilter === "overdue") list = list.filter(isOverdue);
    else if (opFilter === "blocked") list = list.filter(isBlocked);
    else if (opFilter !== "all") list = list.filter((m) => opOf(m) === opFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((m) => m.label.toLowerCase().includes(q) || (ops[m.id]?.owner ?? "").toLowerCase().includes(q));
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [milestones, ops, isTeam, search, opFilter, showArchived]);

  // The summary the backbone answers with (§5).
  const summary = useMemo(() => {
    const active = milestones.filter((m) => opOf(m) !== "archived");
    const completed = active.filter((m) => m.done || opOf(m) === "completed");
    const next = active.find((m) => !(m.done || opOf(m) === "completed"));
    const blockers = active.filter(isBlocked);
    const upcoming = active
      .filter((m) => ops[m.id]?.due_date && !(m.done || opOf(m) === "completed") && ops[m.id]!.due_date! >= today)
      .sort((a, b) => (ops[a.id]!.due_date! < ops[b.id]!.due_date! ? -1 : 1))
      .slice(0, 3);
    const overdue = active.filter(isOverdue);
    const recent = [...completed].slice(-3).reverse();
    return {
      pct: active.length ? Math.round((completed.length / active.length) * 100) : 0,
      next, blockers, upcoming, overdue, recent, total: active.length, done: completed.length
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [milestones, ops]);

  async function letMadameCorrect() {
    const order = instruct.trim();
    if (!order || busy) return;
    setBusy(true);
    setAgentNote(null);
    try {
      const r = await fetch("/api/agents/timeline-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weddingId, instruction: order })
      });
      const d = await r.json();
      setAgentNote(d.text ?? t("agentFailed"));
      setInstruct("");
      // The corrections just landed — the frise must show them at once.
      router.refresh();
    } catch {
      setAgentNote(t("agentFailed"));
    }
    setBusy(false);
  }

  // A wedding just set in motion has no frise yet — the house says so
  // gracefully, and the team may let Madame compose it on the spot.
  if (milestones.length === 0) {
    return (
      <div className="card" style={{ textAlign: "center", padding: "44px 28px" }}>
        <p className="serif" style={{ fontSize: 21, fontStyle: "italic", color: "var(--ink2)" }}>
          {t("empty")}
        </p>
        {isTeam && (
          <div className="team-only" style={{ marginTop: 18 }}>
            <button
              className="btn"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                startTransition(async () => {
                  try {
                    const r = await composeTimeline(weddingId);
                    setAgentNote(r.note ?? null);
                    router.refresh();
                  } catch {
                    setAgentNote(t("agentFailed"));
                  }
                  setBusy(false);
                });
              }}
            >
              {busy ? "…" : t("compose")}
            </button>
            {agentNote && (
              <p className="ia-quote" style={{ marginTop: 12 }} aria-live="polite">
                {agentNote}
              </p>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: "10px 28px" }}>
      {/* The backbone's answer (§5) — team's eyes alone. */}
      {isTeam && (
        <div className="team-only" style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "baseline", padding: "12px 0 4px", fontSize: 13 }}>
          <span className="eyebrow">{format.dateTime(new Date(), { month: "long", year: "numeric" })}</span>
          <strong style={{ color: "var(--hunter)" }}>{t("summary.progress", { pct: summary.pct, done: summary.done, total: summary.total })}</strong>
          {summary.next && (
            <span style={{ color: "var(--ink2)" }}>
              {t("summary.next")} : <strong style={{ color: "var(--hunter)" }}>{summary.next.label}</strong>
            </span>
          )}
          {summary.overdue.length > 0 && (
            <span style={{ color: "var(--bronze)", fontWeight: 500 }}>{t("summary.overdue", { count: summary.overdue.length })}</span>
          )}
          {summary.blockers.length > 0 && (
            <span style={{ color: "var(--bronze)" }}>{t("summary.blocked", { labels: summary.blockers.map((m) => m.label).slice(0, 3).join(" · ") })}</span>
          )}
          {summary.upcoming.length > 0 && (
            <span style={{ color: "var(--ink2)" }}>{t("summary.upcoming", { labels: summary.upcoming.map((m) => `${m.label} (${ops[m.id]?.due_date})`).join(" · ") })}</span>
          )}
          {summary.recent.length > 0 && (
            <span style={{ color: "var(--ink2)" }}>{t("summary.recent", { labels: summary.recent.map((m) => m.label).join(" · ") })}</span>
          )}
        </div>
      )}

      <div className="frise">
        <div className="frise-line" />
        <div className="frise-scrollhint" aria-hidden="true" />
        <div className="frise-in">
          {shown.map((m) => (
            <div key={m.id} className={`mo${m.done ? " done" : ""}`}>
              <span className="m">
                {format.dateTime(new Date(m.month), { month: "short", year: "2-digit" })}
              </span>
              {isTeam ? (
                <button className="edit" onClick={() => setEditing(m)}>
                  <p>{m.label}</p>
                </button>
              ) : (
                <p>{m.label}</p>
              )}
              {isTeam && (
                <span className="team-only" style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 7 }}>
                  {m.status === "draft" && <span className="tag int">{tc("draft")}</span>}
                  {ops[m.id]?.priority === "high" && opOf(m) !== "completed" && <span className="tag ok">{t("priorityHigh")}</span>}
                  {isOverdue(m) && <span className="tag alert" style={{ borderColor: "var(--bronze)", color: "var(--bronze)" }}>{t("overdue")}</span>}
                  {isBlocked(m) && <span className="tag wait">{t("blocked")}</span>}
                  {opOf(m) === "archived" && <span className="tag">{t("archivedTag")}</span>}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {isTeam && (
        <div className="team-only" style={{ padding: "0 0 18px" }}>
          <hr className="hair" style={{ margin: "8px 0 16px" }} />
          <div className="eyebrow" style={{ marginBottom: 8 }}>
            {t("correct")} <span className="tag int">{tc("internal")}</span>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10, alignItems: "center" }}>
            <button className="btn ghost sm" onClick={() => setEditing("new")}>
              {t("add")}
            </button>
            {hasDrafts && (
              <button
                className="btn sm"
                onClick={() => startTransition(() => publishTimeline(weddingId))}
              >
                {t("publish")}
              </button>
            )}
            <button className="btn ghost sm" onClick={() => setImporting(true)}>{t("importOpen")}</button>
            <details style={{ position: "relative" }}>
              <summary className="btn ghost sm" style={{ cursor: "pointer", listStyle: "none", display: "inline-block" }}>{t("exportShort")} ▾</summary>
              <div style={{ position: "absolute", top: "115%", left: 0, zIndex: 40, background: "#fff", border: "1px solid var(--line)", boxShadow: "0 10px 30px rgba(34,56,43,.14)", padding: "6px 0", minWidth: 230 }}>
                {([
                  ["timeline", "pdf"], ["letter", "pdf"], ["client", "pdf"],
                  ["checklist", "xlsx"], ["milestones", "csv"]
                ] as const).map(([k, f]) => (
                  <a key={k} className="addnote" style={{ display: "block", padding: "5px 14px", textDecoration: "none" }} href={`/api/timeline-exports?kind=${k}&format=${f}`} target={f === "pdf" ? "_blank" : undefined} rel="noreferrer">
                    {t(`exports.${k}`)} · {f.toUpperCase()}
                  </a>
                ))}
              </div>
            </details>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("searchPh")}
              aria-label={t("searchPh")}
              style={{ padding: "8px 10px", border: "1px solid var(--line)", fontSize: 12.5, minWidth: 150 }}
            />
            <select
              value={opFilter}
              onChange={(e) => setOpFilter(e.target.value)}
              aria-label={t("filter")}
              style={{ padding: "8px 10px", border: "1px solid var(--line)", background: "#fff", fontSize: 12.5 }}
            >
              <option value="all">{t("filterAll")}</option>
              <option value="overdue">{t("overdue")}</option>
              <option value="blocked">{t("blocked")}</option>
              {OP_STATUSES.map((s) => <option key={s} value={s}>{t(`op.${s}`)}</option>)}
            </select>
            {milestones.some((m) => opOf(m) === "archived") && (
              <button className="addnote" onClick={() => setShowArchived((v) => !v)} aria-pressed={showArchived}>
                {showArchived ? t("hideArchived") : t("showArchived")}
              </button>
            )}
          </div>
          <div className="assist" style={{ marginTop: 0 }}>
            <Dictate title={t("letMadame")} onText={(x) => setInstruct((v) => (v ? v.trimEnd() + " " + x : x))} />
            <input
              value={instruct}
              onChange={(e) => setInstruct(e.target.value)}
              placeholder={t("instructPlaceholder")}
              onKeyDown={(e) => e.key === "Enter" && letMadameCorrect()}
            />
            <button className="btn" onClick={letMadameCorrect} disabled={busy}>
              {busy ? "…" : t("letMadame")}
            </button>
          </div>
          {agentNote && (
            <p className="ia-quote" style={{ marginTop: 10 }} aria-live="polite">
              {agentNote}
            </p>
          )}
          <p style={{ fontSize: 12, color: "var(--ink2)", marginTop: 8 }}>{t("hint")}</p>
        </div>
      )}

      {editing && (
        <MilestoneDialog
          milestone={editing === "new" ? null : editing}
          existingOps={editing === "new" ? null : ops[editing.id] ?? null}
          others={milestones.filter((m) => editing === "new" || m.id !== editing.id)}
          pickers={pickers}
          weddingId={weddingId}
          onClose={() => setEditing(null)}
        />
      )}
      {importing && (
        <TimelineImport
          weddingId={weddingId}
          existingLabels={milestones.map((m) => m.label)}
          onClose={() => setImporting(false)}
        />
      )}
    </div>
  );
}

function MilestoneDialog({
  milestone,
  existingOps,
  others,
  pickers,
  weddingId,
  onClose
}: {
  milestone: Milestone | null;
  existingOps: MilestoneOps | null;
  others: Milestone[];
  pickers: FrisePickers;
  weddingId: string;
  onClose: () => void;
}) {
  const t = useTranslations("timeline.frise");
  const router = useRouter();
  const [label, setLabel] = useState(milestone?.label ?? "");
  const [month, setMonth] = useState(milestone?.month?.slice(0, 7) ?? "");
  const [done, setDone] = useState(milestone?.done ?? false);
  const [opStatus, setOpStatus] = useState(existingOps?.op_status ?? (milestone?.done ? "completed" : "planned"));
  const [priority, setPriority] = useState(existingOps?.priority ?? "standard");
  const [owner, setOwner] = useState(existingOps?.owner ?? "");
  const [description, setDescription] = useState(existingOps?.description ?? "");
  const [dueDate, setDueDate] = useState(existingOps?.due_date ?? "");
  const [dependsOn, setDependsOn] = useState(existingOps?.depends_on ?? "");
  const [vendorId, setVendorId] = useState(existingOps?.vendor_id ?? "");
  const [lineId, setLineId] = useState(existingOps?.budget_line_id ?? "");
  const [documentId, setDocumentId] = useState(existingOps?.document_id ?? "");
  const [ceremonyId, setCeremonyId] = useState(existingOps?.ceremony_id ?? "");
  const [noteInternal, setNoteInternal] = useState(existingOps?.note_internal ?? "");
  const [pending, startTransition] = useTransition();
  const labelRef = useRef<HTMLInputElement>(null);
  const selectS = { padding: "8px 10px", border: "1px solid var(--line)", background: "#fff", fontSize: 12.5 } as const;

  // The keys behave as everywhere in Team view: the pen lands ready,
  // Enter saves, Escape leaves without a trace (brief §2.8).
  useEffect(() => {
    labelRef.current?.focus();
  }, []);
  const save = () =>
    startTransition(async () => {
      const r = await saveMilestone({
        id: milestone?.id,
        weddingId,
        month,
        label,
        done,
        ops: {
          opStatus,
          priority,
          owner,
          description,
          dueDate,
          dependsOn: dependsOn || null,
          vendorId: vendorId || null,
          budgetLineId: lineId || null,
          documentId: documentId || null,
          ceremonyId: ceremonyId || null,
          noteInternal
        }
      });
      if (r.ok && !r.opsSaved) window.alert(t("opsNeedMigration"));
      router.refresh();
      onClose();
    });

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "oklch(0.3178 0.0365 157.6 / 0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: "var(--z-gate)"
      }}
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
        if (e.key === "Enter" && !pending && label && month && (e.target as HTMLElement).tagName === "INPUT") {
          e.preventDefault();
          save();
        }
      }}
    >
      <div
        className="card"
        style={{ width: 600, maxWidth: "94vw", maxHeight: "88vh", overflow: "auto", marginBottom: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="eyebrow" style={{ marginBottom: 14 }}>
          {milestone ? t("editTitle") : t("add")}
        </div>
        <div className="field" style={{ marginBottom: 12 }}>
          <label className="eyebrow">{t("labelField")}</label>
          <input ref={labelRef} value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
        <div className="field" style={{ marginBottom: 12 }}>
          <label className="eyebrow">{t("monthField")}</label>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </div>
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
          <input
            type="checkbox"
            checked={done}
            onChange={(e) => { setDone(e.target.checked); setOpStatus(e.target.checked ? "completed" : "planned"); }}
            style={{ width: "auto" }}
          />
          {t("doneField")}
        </label>

        {/* The operational side (0029) — team-only table underneath. */}
        <hr className="hair" style={{ margin: "14px 0 10px" }} />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select value={opStatus} onChange={(e) => { setOpStatus(e.target.value as typeof opStatus); setDone(e.target.value === "completed"); }} style={selectS} aria-label={t("opStatus")}>
            {OP_STATUSES.map((s) => <option key={s} value={s}>{t(`op.${s}`)}</option>)}
          </select>
          <select value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)} style={selectS} aria-label={t("priority")}>
            <option value="standard">{t("priorityStd")}</option>
            <option value="high">{t("priorityHigh")}</option>
          </select>
          <input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder={t("ownerPh")} style={{ ...selectS, background: undefined, width: 130 }} />
          <label style={{ fontSize: 12, color: "var(--ink2)", display: "inline-flex", gap: 6, alignItems: "center" }}>
            {t("dueField")}
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} style={{ ...selectS, background: undefined }} />
          </label>
        </div>
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("descriptionPh")} style={{ ...selectS, background: undefined, width: "100%", marginTop: 8 }} />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
          <select value={dependsOn} onChange={(e) => setDependsOn(e.target.value)} style={{ ...selectS, maxWidth: 260 }} aria-label={t("dependsOn")}>
            <option value="">{t("dependsOn")}</option>
            {others.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
          <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} style={selectS} aria-label={t("linkVendor")}>
            <option value="">{t("linkVendor")}</option>
            {pickers.vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
          <select value={lineId} onChange={(e) => setLineId(e.target.value)} style={selectS} aria-label={t("linkLine")}>
            <option value="">{t("linkLine")}</option>
            {pickers.lines.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
          <select value={documentId} onChange={(e) => setDocumentId(e.target.value)} style={selectS} aria-label={t("linkDocument")}>
            <option value="">{t("linkDocument")}</option>
            {pickers.documents.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
          </select>
          <select value={ceremonyId} onChange={(e) => setCeremonyId(e.target.value)} style={selectS} aria-label={t("linkCeremony")}>
            <option value="">{t("linkCeremony")}</option>
            {pickers.ceremonies.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </div>
        <input value={noteInternal} onChange={(e) => setNoteInternal(e.target.value)} placeholder={t("internalNotePh")} style={{ ...selectS, background: undefined, width: "100%", marginTop: 8 }} />

        <div style={{ display: "flex", gap: 10, marginTop: 18, flexWrap: "wrap" }}>
          <button className="btn" disabled={pending || !label || !month} onClick={save}>
            {t("saveDraft")}
          </button>
          {milestone && (
            <button
              className="btn ghost"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await deleteMilestone(milestone.id);
                  onClose();
                })
              }
            >
              {t("remove")}
            </button>
          )}
          <button className="btn ghost" onClick={onClose}>
            {t("cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Timeline import (§23) — CSV/XLSX or pasted rows: preview, column
 * mapping, duplicates against the frise, review, an honest report.
 */
const IMPORT_TARGETS = ["ignore", "month", "label", "description", "owner", "due", "priority"] as const;
type ImportTarget = (typeof IMPORT_TARGETS)[number];

function proposeTarget(header: string): ImportTarget {
  const h = header.toLowerCase();
  if (/(month|mois|date)/.test(h)) return "month";
  if (/(label|milestone|jalon|title|titre)/.test(h)) return "label";
  if (/(desc)/.test(h)) return "description";
  if (/(owner|responsable|who)/.test(h)) return "owner";
  if (/(due|échéance|echeance|deadline)/.test(h)) return "due";
  if (/(prior)/.test(h)) return "priority";
  return "ignore";
}
const normLabel = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

function TimelineImport({
  weddingId,
  existingLabels,
  onClose
}: {
  weddingId: string;
  existingLabels: string[];
  onClose: () => void;
}) {
  const t = useTranslations("timeline.importer");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [step, setStep] = useState<"source" | "map" | "review" | "done">("source");
  const [error, setError] = useState("");
  const [pasted, setPasted] = useState("");
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<ImportTarget[]>([]);
  const [review, setReview] = useState<MilestoneImportRow[]>([]);
  const [result, setResult] = useState<{ created: number; skipped: number } | null>(null);
  const known = new Set(existingLabels.map(normLabel));

  const parse = async (body: FormData | { text: string }) => {
    setError("");
    const res = await fetch("/api/imports/parse", {
      method: "POST",
      ...(body instanceof FormData
        ? { body }
        : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    });
    if (!res.ok) { setError(t("errUnreadable")); return; }
    const d = (await res.json()) as { columns: string[]; rows: string[][] };
    setColumns(d.columns);
    setRows(d.rows);
    setMapping(d.columns.map(proposeTarget));
    setStep("map");
  };

  const toReview = () => {
    const out: MilestoneImportRow[] = rows.map((raw) => {
      const f: Record<string, string> = {};
      raw.forEach((cell, i) => {
        const v = cell.trim();
        if (v && mapping[i] !== "ignore") f[mapping[i]] = v;
      });
      const month = (f.month ?? "").replace(/[^\d-]/g, "").slice(0, 7);
      const dup = f.label ? known.has(normLabel(f.label)) : false;
      return {
        action: f.label && /^\d{4}-\d{2}$/.test(month) && !dup ? "create" : "skip",
        month,
        label: f.label ?? "",
        description: f.description,
        owner: f.owner,
        due: /^\d{4}-\d{2}-\d{2}$/.test(f.due ?? "") ? f.due : undefined,
        priority: /high|haute/i.test(f.priority ?? "") ? "high" : "standard"
      };
    });
    setReview(out);
    setStep("review");
  };

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(34,56,43,.25)", zIndex: 40 }} aria-hidden />
      <aside aria-label={t("title")} style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: "min(640px, 100%)", background: "var(--white, #fffdf9)", borderLeft: "1px solid var(--line)", padding: "24px 26px", overflow: "auto", zIndex: 50, boxShadow: "-12px 0 40px rgba(34,56,43,.12)" }}>
        <p className="eyebrow" style={{ color: "var(--bronze)", margin: 0 }}>{t("title")}</p>
        {error && <p style={{ color: "var(--bronze)", fontSize: 13.5 }}>{error}</p>}

        {step === "source" && (
          <div style={{ marginTop: 12 }}>
            <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) { const fd = new FormData(); fd.set("file", f); void parse(fd); } e.target.value = ""; }} style={{ fontSize: 13.5 }} />
            <textarea value={pasted} onChange={(e) => setPasted(e.target.value)} rows={6} placeholder={t("pastePlaceholder")} style={{ width: "100%", marginTop: 12, fontSize: 13, padding: "9px 11px", border: "1px solid var(--line)", fontFamily: "inherit" }} />
            <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
              <button className="btn sm" disabled={!pasted.trim()} onClick={() => void parse({ text: pasted })}>{t("readPaste")}</button>
              <a className="btn ghost sm" href="/api/timeline-exports?kind=template&format=xlsx" style={{ textDecoration: "none" }}>{t("template")}</a>
              <button className="btn ghost sm" onClick={onClose}>{t("close")}</button>
            </div>
          </div>
        )}

        {step === "map" && (
          <div style={{ marginTop: 12 }}>
            <p style={{ fontSize: 13, color: "var(--ink2)" }}>{t("mapBlurb", { n: rows.length })}</p>
            <table className="sheet-table" style={{ fontSize: 12.5 }}>
              <tbody>
                {columns.map((c, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 500 }}>{c}</td>
                    <td style={{ color: "var(--ink2)", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{rows[0]?.[i]}</td>
                    <td>
                      <select value={mapping[i]} onChange={(e) => setMapping((prev) => prev.map((m, j) => (j === i ? (e.target.value as ImportTarget) : m)))} style={{ fontSize: 12, padding: "3px 5px", background: "#fff", border: "1px solid var(--line)" }}>
                        {IMPORT_TARGETS.map((x) => <option key={x} value={x}>{t(`target_${x}`)}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
              <button className="btn sm" onClick={toReview}>{t("toReview")}</button>
              <button className="btn ghost sm" onClick={() => setStep("source")}>{t("back")}</button>
            </div>
          </div>
        )}

        {step === "review" && (
          <div style={{ marginTop: 12 }}>
            <p style={{ fontSize: 13, color: "var(--ink2)" }}>{t("reviewBlurb")}</p>
            <div style={{ maxHeight: "56vh", overflow: "auto", border: "1px solid var(--line)" }}>
              {review.map((r, i) => (
                <div key={i} style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap", padding: "7px 12px", borderBottom: "1px solid rgba(201,178,145,.2)", background: r.action === "skip" ? "var(--parchment)" : undefined }}>
                  <select value={r.action} onChange={(e) => setReview((prev) => prev.map((x, j) => (j === i ? { ...x, action: e.target.value as "create" | "skip" } : x)))} style={{ fontSize: 12, padding: "3px 5px", background: "#fff", border: "1px solid var(--line)" }}>
                    <option value="create">{t("actionCreate")}</option>
                    <option value="skip">{t("actionSkip")}</option>
                  </select>
                  <span style={{ fontWeight: 500, color: "var(--hunter)" }}>{r.label || t("nameless")}</span>
                  <span style={{ fontSize: 12, color: "var(--ink2)" }}>{[r.month, r.owner, r.due].filter(Boolean).join(" · ")}</span>
                  {r.label && known.has(normLabel(r.label)) && <span style={{ fontSize: 12, color: "var(--bronze)" }}>{t("dupFlag")}</span>}
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 10, alignItems: "baseline" }}>
              <button
                className="btn sm"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const r = await importMilestones(weddingId, review);
                    if (r.ok) { setResult(r); setStep("done"); router.refresh(); }
                  })
                }
              >
                {pending ? "…" : t("integrate")}
              </button>
              <button className="btn ghost sm" onClick={() => setStep("map")}>{t("back")}</button>
            </div>
          </div>
        )}

        {step === "done" && result && (
          <div style={{ marginTop: 14 }}>
            <p style={{ fontSize: 14.5 }}>{t("done", { created: result.created, skipped: result.skipped })}</p>
            <button className="btn sm" onClick={onClose}>{t("close")}</button>
          </div>
        )}
      </aside>
    </>
  );
}
