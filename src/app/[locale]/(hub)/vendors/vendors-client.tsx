"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import dynamic from "next/dynamic";
import type { Vendor } from "@/lib/types";
import {
  addVendorFull, deleteVendorDocument, draftOutreach, findVendorDuplicates,
  sendOutreach, setVendorStage
} from "@/app/actions/vendors";
import { publishVendorDocToCouple } from "@/app/actions/documents";
import { Dictate } from "@/components/Dictate";

const STAGES = [
  "scouted", "contacted", "proposal_requested", "proposal_received",
  "in_review", "shortlisted", "selected", "contracted", "completed", "archived"
] as const;
const TEMPLATES = ["availability", "proposal", "negotiation", "confirmation"] as const;

export function StageSelect({ vendor }: { vendor: Vendor }) {
  const t = useTranslations("vendors.stages");
  const [pending, startTransition] = useTransition();
  return (
    <select
      value={vendor.stage}
      disabled={pending}
      onChange={(e) =>
        startTransition(() => setVendorStage(vendor.id, e.target.value as Vendor["stage"]))
      }
      style={{ padding: "6px 8px", border: "1px solid var(--line)", background: "#fff", fontSize: 12 }}
      aria-label={t("label")}
    >
      {vendor.stage === "proposal" && <option value="proposal">{t("proposal")}</option>}
      {STAGES.map((s) => (
        <option key={s} value={s}>
          {t(s)}
        </option>
      ))}
    </select>
  );
}

export function AddVendor({ weddingId }: { weddingId: string }) {
  const t = useTranslations("vendors.add");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [email, setEmail] = useState("");
  const [dupes, setDupes] = useState<null | { id: string; legal_name: string; trading_name: string | null; category: string; city: string | null; country: string | null }[]>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const create = (registryId?: string | null) =>
    startTransition(async () => {
      await addVendorFull(weddingId, { name: name.trim(), category: category.trim(), email: email.trim() || undefined }, registryId ?? null);
      setName(""); setCategory(""); setEmail(""); setDupes(null);
      router.refresh();
    });

  const check = () =>
    startTransition(async () => {
      const r = await findVendorDuplicates({ name: name.trim(), email: email.trim() || undefined });
      if (r.matches.length) setDupes(r.matches);
      else create();
    });

  return (
    <div className="team-only" style={{ marginTop: 16 }}>
      <div className="assist">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("name")} />
        <input
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder={t("category")}
          style={{ flex: "0 1 160px", minWidth: 130 }}
        />
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t("email")}
          style={{ flex: "0 1 200px", minWidth: 150 }}
        />
        <button
          className="btn ghost"
          disabled={pending || !name.trim() || !category.trim()}
          onClick={check}
        >
          {pending ? "…" : t("go")}
        </button>
      </div>
      {/* Possible existing vendor found — never a silent duplicate. */}
      {dupes && (
        <div role="alertdialog" aria-label={t("dupTitle")} style={{ marginTop: 10, padding: "12px 14px", border: "1px solid var(--bronze)", background: "var(--parchment)" }}>
          <p style={{ margin: "0 0 8px", fontSize: 13.5, color: "var(--bronze)", fontWeight: 500 }}>{t("dupTitle")}</p>
          {dupes.map((d) => (
            <div key={d.id} style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap", padding: "5px 0" }}>
              <span style={{ fontSize: 13.5 }}>
                {d.trading_name || d.legal_name}
                <span style={{ color: "var(--ink2)", fontSize: 12.5 }}> · {d.category}{d.city ? ` · ${d.city}` : ""}{d.country ? `, ${d.country}` : ""}</span>
              </span>
              <button className="addnote" disabled={pending} onClick={() => create(d.id)}>{t("dupLink")}</button>
            </div>
          ))}
          <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
            <button className="btn ghost sm" disabled={pending} onClick={() => create(null)}>{t("dupCreateAnyway")}</button>
            <button className="addnote" onClick={() => setDupes(null)}>{t("dupCancel")}</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Drop a vendor document — the agent reads, extracts and feeds the budget. */
export function VendorDocDrop({ weddingId, vendors }: { weddingId: string; vendors: Vendor[] }) {
  const t = useTranslations("vendors.docs");
  const [vendorId, setVendorId] = useState("");
  const [summary, setSummary] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function handle(file: File) {
    if (busy) return;
    setBusy(true);
    setSummary(null);
    try {
      const form = new FormData();
      form.append("weddingId", weddingId);
      if (vendorId) form.append("vendorId", vendorId);
      form.append("file", file);
      const r = await fetch("/api/agents/document", { method: "POST", body: form });
      const d = await r.json();
      setSummary(d.text ?? t("failed"));
      router.refresh();
    } catch {
      setSummary(t("failed"));
    }
    setBusy(false);
  }

  return (
    <div className="ia team-only" style={{ marginTop: 14 }}>
      <div className="eyebrow">{t("dropTitle")}</div>
      <div className="assist">
        <select
          value={vendorId}
          onChange={(e) => setVendorId(e.target.value)}
          style={{ padding: "12px 10px", border: "1px solid var(--line)", background: "#fff" }}
        >
          <option value="">{t("autoDetect")}</option>
          {vendors.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
        <label className="btn ghost" style={{ cursor: "pointer" }}>
          {busy ? "…" : t("choose")}
          <input
            type="file"
            hidden
            accept=".pdf,.png,.jpg,.jpeg"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handle(f);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      {summary && (
        <p className="ia-quote" style={{ marginTop: 12 }} aria-live="polite">
          {summary}
        </p>
      )}
    </div>
  );
}

/** New vendor request — template drafted by the agent, sent from Estelle's inbox. */
export function OutreachComposer({ weddingId, vendors }: { weddingId: string; vendors: Vendor[] }) {
  const t = useTranslations("vendors.outreach");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [vendorId, setVendorId] = useState(vendors[0]?.id ?? "");
  const [template, setTemplate] = useState<(typeof TEMPLATES)[number]>("availability");
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();

  async function draft() {
    if (!vendorId || busy) return;
    setBusy(true);
    const r = await draftOutreach({ weddingId, vendorId, template });
    if (r.ok) {
      setSubject(r.subject);
      setBody(r.body);
    }
    setBusy(false);
  }

  return (
    <div className="card team-only" style={{ marginTop: 14 }}>
      <div className="eyebrow">
        {t("title")} <span className="tag int">{tc("internal")}</span>
      </div>
      <p style={{ margin: "10px 0 16px", fontSize: 13.5 }}>{t("blurb")}</p>
      {!open ? (
        <button className="btn" onClick={() => setOpen(true)}>
          {t("new")}
        </button>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <select
              value={vendorId}
              onChange={(e) => setVendorId(e.target.value)}
              style={{ padding: "10px", border: "1px solid var(--line)", background: "#fff" }}
            >
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
            <select
              value={template}
              onChange={(e) => setTemplate(e.target.value as (typeof TEMPLATES)[number])}
              style={{ padding: "10px", border: "1px solid var(--line)", background: "#fff" }}
            >
              {TEMPLATES.map((tpl) => (
                <option key={tpl} value={tpl}>
                  {t(`templates.${tpl}`)}
                </option>
              ))}
            </select>
            <button className="btn ghost sm" onClick={draft} disabled={busy}>
              {busy ? "…" : t("letAgentDraft")}
            </button>
          </div>
          <input
            type="email"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder={t("to")}
            style={{ padding: "10px 12px", border: "1px solid var(--line)" }}
          />
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder={t("subject")}
            style={{ padding: "10px 12px", border: "1px solid var(--line)" }}
          />
          <div><Dictate title={t("body")} onText={(x) => setBody((v) => (v ? v.trimEnd() + " " + x : x))} /></div>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={7}
            placeholder={t("body")}
            style={{ padding: "10px 12px", border: "1px solid var(--line)", fontSize: 13.5 }}
          />
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button
              className="btn"
              disabled={pending || !to || !subject || !body}
              onClick={() =>
                startTransition(async () => {
                  await sendOutreach({ weddingId, vendorId, template, to, subject, body });
                  setSent(true);
                  setOpen(false);
                })
              }
            >
              {t("send")}
            </button>
            <button className="btn ghost" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </button>
            {sent && <span style={{ fontSize: 12.5, color: "var(--bronze)" }}>{t("sentNote")}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * A document chip the house can withdraw — duplicates leave politely —
 * or place in the couple's hands: the paper then appears on their
 * Documents page, at Estelle's gesture, never on its own.
 */
export function DocChip({
  docId,
  typeLabel,
  label,
  clientVisible
}: {
  docId: string;
  typeLabel: string;
  label: string;
  clientVisible?: boolean;
}) {
  const t = useTranslations("vendors.docs");
  const [pending, startTransition] = useTransition();
  const [placed, setPlaced] = useState(Boolean(clientVisible));
  const router = useRouter();
  return (
    <span className="doc" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      {typeLabel} <em>{label}</em>
      {placed ? (
        <span className="tag ok team-only">{t("placedTag")}</span>
      ) : (
        <button
          type="button"
          className="addnote team-only"
          disabled={pending}
          onClick={() => {
            if (!confirm(t("placeConfirm", { label }))) return;
            startTransition(async () => {
              const r = await publishVendorDocToCouple(docId, true);
              if (r.ok) setPlaced(true);
              router.refresh();
            });
          }}
        >
          {pending ? "…" : t("placeInHands")}
        </button>
      )}
      <button
        type="button"
        className="team-only"
        title={t("removeDoc")}
        aria-label={t("removeDoc")}
        disabled={pending}
        style={{ border: "none", background: "none", cursor: "pointer", color: "var(--bronze)", fontSize: 13, lineHeight: 1, padding: "0 2px" }}
        onClick={() => {
          if (!confirm(t("removeConfirm", { label }))) return;
          startTransition(async () => {
            await deleteVendorDocument(docId);
            router.refresh();
          });
        }}
      >
        ×
      </button>
    </span>
  );
}

/* ══════════ The vendors table under its action bar (PRD §4) ═══════ */

export interface VendorRow {
  vendor: Vendor;
  contact: string | null;
  docs: number;
  committed: number | null;
  paid: number | null;
  openActions: number;
  lastActivity: string | null;
}

export function VendorsBar({
  onToggleFilters,
  filtersOn,
  onImport,
  exportBase
}: {
  onToggleFilters: () => void;
  filtersOn: boolean;
  onImport: () => void;
  exportBase: string;
}) {
  const t = useTranslations("vendors.bar");
  return (
    <div className="toolrow team-only" style={{ border: "1px solid var(--line)", borderBottom: 0, background: "var(--white, #fffdf9)" }}>
      <a className="btn ghost sm" href="#vendor-add" style={{ textDecoration: "none" }}>{t("add")}</a>
      <button className="btn ghost sm" onClick={onImport}>{t("import")}</button>
      <a className="btn ghost sm" href="#vendor-drop" style={{ textDecoration: "none" }}>{t("upload")}</a>
      <details style={{ position: "relative" }}>
        <summary className="btn ghost sm" style={{ listStyle: "none", cursor: "pointer" }}>{t("export")}</summary>
        <div style={{ position: "absolute", zIndex: 20, background: "var(--white, #fffdf9)", border: "1px solid var(--line)", padding: 8, display: "grid", gap: 6, minWidth: 220 }}>
          {(["wedding", "all", "contacts", "history"] as const).map((k) => (
            <a key={k} className="addnote" href={`${exportBase}&kind=${k}`} style={{ textDecoration: "none" }}>
              {t(`kind_${k}`)}
            </a>
          ))}
          <a className="addnote" href={`${exportBase.replace("format=xlsx", "format=csv")}&kind=wedding`} style={{ textDecoration: "none" }}>
            {t("asCsv")}
          </a>
        </div>
      </details>
      <button className="chip" aria-pressed={filtersOn} onClick={onToggleFilters}>{t("filters")}</button>
    </div>
  );
}

export function VendorsTable({
  weddingId,
  rows,
  registrySnapshot,
  isTeam
}: {
  weddingId: string;
  rows: VendorRow[];
  registrySnapshot: { id: string; legal_name: string; trading_name: string | null; email: string | null }[];
  isTeam: boolean;
}) {
  const currency = (n: number) =>
    new Intl.NumberFormat(undefined, { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
  const t = useTranslations("vendors");
  const [filtersOn, setFiltersOn] = useState(false);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [stage, setStage] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [importing, setImporting] = useState(false);

  const cats = [...new Set(rows.map((r) => r.vendor.category).filter(Boolean))].sort();
  const shown = rows.filter((r) => {
    if (!showArchived && r.vendor.archived) return false;
    if (q && !r.vendor.name.toLowerCase().includes(q.toLowerCase())) return false;
    if (cat && r.vendor.category !== cat) return false;
    if (stage && r.vendor.stage !== stage) return false;
    return true;
  });

  const stageTag = (s: Vendor["stage"]) =>
    s === "contracted" || s === "completed" ? (
      <span className="tag ok">{t(`stages.${s === "contracted" ? "contracted" : "completed"}`)}</span>
    ) : s === "proposal" || s === "proposal_received" ? (
      <span className="tag wait">{t("stages.proposalReceived")}</span>
    ) : (
      <span className="tag">{t(`stages.${s}`)}</span>
    );

  return (
    <>
      {isTeam && (
        <VendorsBar
          filtersOn={filtersOn}
          onToggleFilters={() => setFiltersOn(!filtersOn)}
          onImport={() => setImporting(true)}
          exportBase="/api/vendor-exports?format=xlsx"
        />
      )}
      {isTeam && filtersOn && (
        <div className="toolrow team-only" style={{ border: "1px solid var(--line)", borderBottom: 0, background: "var(--parchment)" }}>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("bar.search")} aria-label={t("bar.search")} style={{ minWidth: 170 }} />
          <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label={t("category")} style={{ padding: "5px 7px", border: "1px solid var(--line)", background: "#fff", fontSize: 12.5 }}>
            <option value="">{t("bar.everyCategory")}</option>
            {cats.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={stage} onChange={(e) => setStage(e.target.value)} aria-label={t("pipeline")} style={{ padding: "5px 7px", border: "1px solid var(--line)", background: "#fff", fontSize: 12.5 }}>
            <option value="">{t("bar.everyStage")}</option>
            {STAGES.map((x) => <option key={x} value={x}>{t(`stages.${x}`)}</option>)}
          </select>
          <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 12.5 }}>
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            {t("bar.showArchived")}
          </label>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 12.5, color: "var(--ink2)" }}>{t("bar.shown", { n: shown.length })}</span>
        </div>
      )}
      <div style={{ overflowX: "auto", border: isTeam ? "1px solid var(--line)" : undefined }}>
        <table className="sheet-table">
          <thead>
            <tr>
              <th>{t("vendor")}</th>
              <th>{t("category")}</th>
              <th>{t("status")}</th>
              {isTeam && <th className="team-only">{t("cols.contact")}</th>}
              <th>{t("documents")}</th>
              {isTeam && <th className="team-only num">{t("cols.finance")}</th>}
              {isTeam && <th className="team-only">{t("cols.lastActivity")}</th>}
              {isTeam && <th className="team-only">{t("pipeline")}</th>}
            </tr>
          </thead>
          <tbody>
            {shown.map(({ vendor, contact, docs, committed, paid, lastActivity }) => (
              <tr key={vendor.id} style={vendor.archived ? { opacity: 0.55 } : undefined}>
                <td>
                  <Link
                    href={isTeam ? `/vendors/${vendor.id}` : `/budget/vendor/${vendor.id}`}
                    style={{ textDecoration: "underline", textUnderlineOffset: 3, textDecorationColor: "var(--champagne)" }}
                  >
                    {vendor.name}
                  </Link>
                  {vendor.archived && <span className="tag int" style={{ marginLeft: 8 }}>{t("bar.archivedTag")}</span>}
                </td>
                <td>{vendor.category}</td>
                <td>{stageTag(vendor.stage)}</td>
                {isTeam && <td className="team-only" style={{ fontSize: 12.5 }}>{contact ?? <span style={{ color: "var(--line)" }}>—</span>}</td>}
                <td style={{ fontSize: 12.5 }}>
                  {docs === 0 ? <span style={{ color: "var(--ink2)" }}>—</span> : t("cols.docsCount", { n: docs })}
                </td>
                {isTeam && (
                  <td className="team-only num" style={{ fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}>
                    {committed != null && committed > 0
                      ? t("cols.finSummary", { committed: currency(committed), paid: currency(paid ?? 0) })
                      : <span style={{ color: "var(--line)" }}>—</span>}
                  </td>
                )}
                {isTeam && (
                  <td className="team-only" style={{ fontSize: 12, color: "var(--ink2)" }}>
                    {lastActivity ? lastActivity.slice(0, 10) : "—"}
                  </td>
                )}
                {isTeam && (
                  <td className="team-only">
                    <StageSelect vendor={vendor} />
                  </td>
                )}
              </tr>
            ))}
            {shown.length === 0 && (
              <tr><td colSpan={isTeam ? 8 : 4} style={{ fontStyle: "italic", color: "var(--ink2)" }}>{t("bar.empty")}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {importing && <VendorImportLazy weddingId={weddingId} registry={registrySnapshot} onClose={() => setImporting(false)} />}
    </>
  );
}
const VendorImportLazy = dynamic(() => import("./vendor-import").then((m) => m.VendorImport), { ssr: false });
