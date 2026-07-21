"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import type { Vendor } from "@/lib/types";
import { addVendor, deleteVendorDocument, draftOutreach, sendOutreach, setVendorStage } from "@/app/actions/vendors";
import { Dictate } from "@/components/Dictate";

const STAGES = ["scouted", "contacted", "proposal", "contracted"] as const;
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
  const [pending, startTransition] = useTransition();
  return (
    <div className="assist team-only" style={{ marginTop: 16 }}>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("name")} />
      <input
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        placeholder={t("category")}
        style={{ flex: "0 1 180px", minWidth: 140 }}
      />
      <button
        className="btn ghost"
        disabled={pending || !name.trim() || !category.trim()}
        onClick={() =>
          startTransition(async () => {
            await addVendor(weddingId, name.trim(), category.trim());
            setName("");
            setCategory("");
          })
        }
      >
        {t("go")}
      </button>
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

/** A document chip the house can withdraw — duplicates leave politely. */
export function DocChip({ docId, typeLabel, label }: { docId: string; typeLabel: string; label: string }) {
  const t = useTranslations("vendors.docs");
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <span className="doc" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      {typeLabel} <em>{label}</em>
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
