"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import type { Vendor, VendorContact, VendorContactRole, VendorDocument, VendorNote, VendorRegistry } from "@/lib/types";
import {
  addVendorNote, deleteDraftVendor, deleteVendorDocument, removeVendorContact,
  removeVendorNote, saveVendorContact, saveVendorProfile, setVendorArchived,
  updateVendorDocumentMeta, type VendorProfileFields
} from "@/app/actions/vendors";

/** The profile under the house's hand — every control does what it says. */

function useAct() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const act = (fn: () => Promise<unknown>) =>
    startTransition(async () => { await fn(); router.refresh(); });
  return { pending, act };
}

const lbl = (text: string) => (
  <span style={{ display: "block", fontSize: 12, letterSpacing: ".14em", textTransform: "uppercase", fontWeight: 500, color: "var(--ink2)", margin: "10px 0 4px" }}>{text}</span>
);

/* ── pipeline · archive · draft departure · contextual letters ── */

export function RelationshipActions({ weddingId, vendor }: { weddingId: string; vendor: Vendor }) {
  const t = useTranslations("vendors.profile");
  const { pending, act } = useAct();
  const router = useRouter();
  return (
    <div className="toolrow" style={{ border: "1px solid var(--line)", background: "var(--white, #fffdf9)", marginBottom: 16 }}>
      <Link className="addnote" href="/vendors" style={{ textDecoration: "none" }}>← {t("backToList")}</Link>
      <span style={{ flex: 1 }} />
      {(["proposal_request", "follow_up", "confirm_selection"] as const).map((k) => (
        <Link key={k} className="addnote" href={`/vendors?outreach=${vendor.id}`} style={{ textDecoration: "none" }} title={t("outreachHint")}>
          {t(`mail_${k}`)}
        </Link>
      ))}
      <button
        className="btn ghost sm"
        disabled={pending}
        onClick={() => act(() => setVendorArchived(weddingId, vendor.id, !vendor.archived))}
      >
        {vendor.archived ? t("restore") : t("archive")}
      </button>
      <button
        className="addnote"
        style={{ color: "var(--bronze)" }}
        disabled={pending}
        title={t("deleteDraftHint")}
        onClick={() => {
          if (!window.confirm(t("deleteDraftConfirm"))) return;
          act(async () => {
            const r = await deleteDraftVendor(weddingId, vendor.id);
            if (!r.ok && r.reason === "not_a_draft") window.alert(t("notADraft"));
            else router.push("/vendors");
          });
        }}
      >
        {t("deleteDraft")}
      </button>
    </div>
  );
}

/* ── identity + relationship, one form ── */

export function ProfileForm({
  weddingId,
  vendor,
  registry
}: {
  weddingId: string;
  vendor: Vendor;
  registry: VendorRegistry | null;
}) {
  const t = useTranslations("vendors.profile");
  const { pending, act } = useAct();
  const [saved, setSaved] = useState(false);
  const [f, setF] = useState<VendorProfileFields>({
    legalName: registry?.legal_name ?? vendor.name,
    tradingName: registry?.trading_name ?? "",
    category: vendor.category,
    country: registry?.country ?? "",
    city: registry?.city ?? "",
    languages: (registry?.languages ?? []).join(", "),
    website: registry?.website ?? "",
    instagram: registry?.instagram ?? "",
    portfolioUrl: registry?.portfolio_url ?? "",
    email: registry?.email ?? "",
    phone: registry?.phone ?? "",
    whatsapp: registry?.whatsapp ?? "",
    timezone: registry?.timezone ?? "",
    vatNumber: registry?.vat_number ?? "",
    rating: registry?.rating ?? null,
    tags: (registry?.tags ?? []).join(", "),
    registryNotes: registry?.notes_internal ?? "",
    role: vendor.role ?? "",
    leadPlanner: vendor.lead_planner ?? "",
    contactedOn: vendor.contacted_on ?? "",
    proposalRequestedOn: vendor.proposal_requested_on ?? "",
    proposalReceivedOn: vendor.proposal_received_on ?? "",
    selectedOn: vendor.selected_on ?? "",
    contractedOn: vendor.contracted_on ?? "",
    completed: vendor.completed ?? false,
    relationshipNotes: vendor.notes_internal ?? ""
  });
  const set = (k: keyof VendorProfileFields, v: string | number | boolean | null) =>
    setF((prev) => ({ ...prev, [k]: v }));
  const inp = (k: keyof VendorProfileFields, label: string, type = "text") => (
    <label style={{ display: "block" }}>
      {lbl(label)}
      <input type={type} value={String(f[k] ?? "")} onChange={(e) => set(k, e.target.value)} style={{ width: "100%", fontSize: 13.5, padding: "6px 9px" }} />
    </label>
  );

  return (
    <div className="card">
      <div className="eyebrow">{t("overviewTitle")}</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px" }}>
        {inp("legalName", t("legalName"))}
        {inp("tradingName", t("tradingName"))}
        {inp("category", t("category"))}
        {inp("country", t("country"))}
        {inp("city", t("city"))}
        {inp("languages", t("languages"))}
        {inp("website", t("website"))}
        {inp("instagram", t("instagram"))}
        {inp("portfolioUrl", t("portfolio"))}
        {inp("email", t("email"), "email")}
        {inp("phone", t("phone"))}
        {inp("whatsapp", t("whatsapp"))}
        {inp("timezone", t("timezone"))}
        {inp("vatNumber", t("vat"))}
        <label style={{ display: "block" }}>
          {lbl(t("rating"))}
          <select value={f.rating ?? ""} onChange={(e) => set("rating", e.target.value === "" ? null : +e.target.value)} style={{ width: "100%", fontSize: 13.5, padding: "6px 8px", background: "#fff", border: "1px solid var(--line)" }}>
            <option value="">—</option>
            {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{"★".repeat(n)}</option>)}
          </select>
        </label>
        {inp("tags", t("tags"))}
      </div>
      <label style={{ display: "block" }}>
        {lbl(t("registryNotes"))}
        <textarea value={f.registryNotes} onChange={(e) => set("registryNotes", e.target.value)} rows={2} style={{ width: "100%", fontSize: 13, padding: "7px 9px", border: "1px solid var(--line)", fontFamily: "inherit" }} />
      </label>

      <div className="eyebrow" style={{ marginTop: 16 }}>{t("relationshipTitle")}</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px" }}>
        {inp("role", t("role"))}
        {inp("leadPlanner", t("leadPlanner"))}
        {inp("contactedOn", t("contactedOn"), "date")}
        {inp("proposalRequestedOn", t("proposalRequestedOn"), "date")}
        {inp("proposalReceivedOn", t("proposalReceivedOn"), "date")}
        {inp("selectedOn", t("selectedOn"), "date")}
        {inp("contractedOn", t("contractedOn"), "date")}
        <label style={{ display: "inline-flex", gap: 7, alignItems: "center", fontSize: 13.5, marginTop: 26 }}>
          <input type="checkbox" checked={f.completed} onChange={(e) => set("completed", e.target.checked)} />
          {t("completed")}
        </label>
      </div>
      <label style={{ display: "block" }}>
        {lbl(t("relationshipNotes"))}
        <textarea value={f.relationshipNotes} onChange={(e) => set("relationshipNotes", e.target.value)} rows={2} style={{ width: "100%", fontSize: 13, padding: "7px 9px", border: "1px solid var(--line)", fontFamily: "inherit" }} />
      </label>

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12 }}>
        <button
          className="btn sm"
          disabled={pending || !f.legalName.trim()}
          onClick={() => act(async () => { await saveVendorProfile(weddingId, vendor.id, f); setSaved(true); window.setTimeout(() => setSaved(false), 2500); })}
        >
          {pending ? "…" : t("save")}
        </button>
        {saved && <span style={{ fontSize: 12.5, color: "var(--bronze)" }} role="status">{t("savedWord")}</span>}
      </div>
    </div>
  );
}

/* ── contacts ── */

const ROLES: VendorContactRole[] = ["main", "sales", "production", "accounts", "emergency", "other"];

export function ContactsDesk({ registryId, contacts }: { registryId: string; contacts: VendorContact[] }) {
  const t = useTranslations("vendors.profile");
  const { pending, act } = useAct();
  const blank = { role: "main" as VendorContactRole, name: "", email: "", phone: "", whatsapp: "", notes: "" };
  const [form, setForm] = useState<null | { id: string | null; f: typeof blank }>(null);

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
        <div className="eyebrow">{t("contactsTitle")}</div>
        <button className="addnote" onClick={() => setForm({ id: null, f: blank })}>+ {t("addContact")}</button>
      </div>
      {contacts.length === 0 && !form && <p style={{ fontSize: 13, color: "var(--ink2)", fontStyle: "italic" }}>{t("noContacts")}</p>}
      {contacts.map((c) => (
        <div key={c.id} style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap", padding: "6px 0", borderBottom: "1px solid rgba(201,178,145,.2)" }}>
          <span className="tag" style={{ fontSize: 11 }}>{t(`role_${c.contact_role}`)}</span>
          <span style={{ fontWeight: 500 }}>{c.name}</span>
          <span style={{ fontSize: 12.5, color: "var(--ink2)" }}>{[c.email, c.phone, c.whatsapp].filter(Boolean).join(" · ")}</span>
          <span style={{ flex: 1 }} />
          <button className="addnote" onClick={() => setForm({ id: c.id, f: { role: c.contact_role, name: c.name, email: c.email ?? "", phone: c.phone ?? "", whatsapp: c.whatsapp ?? "", notes: c.notes ?? "" } })}>✎</button>
          <button className="addnote" style={{ color: "var(--bronze)" }} disabled={pending} onClick={() => { if (window.confirm(t("removeContactConfirm"))) act(() => removeVendorContact(c.id)); }}>✕</button>
        </div>
      ))}
      {form && (
        <div style={{ marginTop: 10, padding: "10px 12px", background: "var(--parchment)", border: "1px solid var(--line)", display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label>{lbl(t("contactRole"))}
            <select value={form.f.role} onChange={(e) => setForm({ ...form, f: { ...form.f, role: e.target.value as VendorContactRole } })} style={{ fontSize: 13, padding: "5px 7px", background: "#fff", border: "1px solid var(--line)" }}>
              {ROLES.map((r) => <option key={r} value={r}>{t(`role_${r}`)}</option>)}
            </select>
          </label>
          <label>{lbl(t("contactName"))}<input value={form.f.name} onChange={(e) => setForm({ ...form, f: { ...form.f, name: e.target.value } })} style={{ fontSize: 13, padding: "5px 8px" }} /></label>
          <label>{lbl(t("email"))}<input type="email" value={form.f.email} onChange={(e) => setForm({ ...form, f: { ...form.f, email: e.target.value } })} style={{ fontSize: 13, padding: "5px 8px" }} /></label>
          <label>{lbl(t("phone"))}<input value={form.f.phone} onChange={(e) => setForm({ ...form, f: { ...form.f, phone: e.target.value } })} style={{ fontSize: 13, padding: "5px 8px", width: 120 }} /></label>
          <button className="btn sm" disabled={pending || !form.f.name.trim()} onClick={() => act(async () => { await saveVendorContact(registryId, form.id, form.f); setForm(null); })}>{t("keep")}</button>
          <button className="btn ghost sm" onClick={() => setForm(null)}>{t("cancel")}</button>
        </div>
      )}
    </div>
  );
}

/* ── dated internal notes ── */

export function NotesDesk({ weddingId, vendorId, notes }: { weddingId: string; vendorId: string; notes: VendorNote[] }) {
  const t = useTranslations("vendors.profile");
  const { pending, act } = useAct();
  const [body, setBody] = useState("");
  return (
    <div className="card">
      <div className="eyebrow" style={{ marginBottom: 6 }}>{t("notesTitle")}</div>
      <div style={{ display: "flex", gap: 8 }}>
        <input value={body} onChange={(e) => setBody(e.target.value)} placeholder={t("notePlaceholder")} style={{ flex: 1, fontSize: 13.5, padding: "7px 10px" }}
          onKeyDown={(e) => { if (e.key === "Enter" && body.trim()) { act(async () => { await addVendorNote(weddingId, vendorId, body); setBody(""); }); } }} />
        <button className="btn ghost sm" disabled={pending || !body.trim()} onClick={() => act(async () => { await addVendorNote(weddingId, vendorId, body); setBody(""); })}>{t("addNote")}</button>
      </div>
      {notes.map((n) => (
        <div key={n.id} style={{ padding: "8px 0", borderBottom: "1px solid rgba(201,178,145,.2)" }}>
          <div style={{ fontSize: 11.5, color: "var(--ink2)", letterSpacing: ".06em" }}>
            {n.author} · {n.created_at.slice(0, 10)}
            <button className="addnote" style={{ marginLeft: 8, color: "var(--bronze)" }} disabled={pending} onClick={() => { if (window.confirm(t("removeNoteConfirm"))) act(() => removeVendorNote(n.id)); }}>✕</button>
          </div>
          <p style={{ margin: "3px 0 0", fontSize: 13.5 }}>{n.body}</p>
        </div>
      ))}
    </div>
  );
}

/* ── papers: one canonical record, every action real ── */

const DOC_TYPES = ["proposal", "contract", "invoice", "insurance", "licence", "bank_details", "portfolio", "other"] as const;

export function DocumentsDesk({
  weddingId,
  vendorId,
  docs,
  signedUrls
}: {
  weddingId: string;
  vendorId: string;
  docs: VendorDocument[];
  signedUrls: Record<string, string>;
}) {
  const t = useTranslations("vendors.profile");
  const td = useTranslations("vendors.docTypes");
  const { pending, act } = useAct();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  const upload = async (file: File) => {
    setBusy("upload");
    try {
      const form = new FormData();
      form.append("weddingId", weddingId);
      form.append("vendorId", vendorId);
      form.append("file", file);
      await fetch("/api/agents/document", { method: "POST", body: form });
      router.refresh();
    } finally { setBusy(null); }
  };

  /* Re-read the same filed paper — no re-upload asked of anyone. */
  const reanalyse = async (d: VendorDocument) => {
    const url = signedUrls[d.id];
    if (!url) return;
    setBusy(d.id);
    try {
      const blob = await (await fetch(url)).blob();
      const form = new FormData();
      form.append("weddingId", weddingId);
      form.append("vendorId", vendorId);
      form.append("file", new File([blob], d.label || "document.pdf", { type: blob.type || "application/pdf" }));
      await fetch("/api/agents/document", { method: "POST", body: form });
      router.refresh();
    } finally { setBusy(null); }
  };

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8, gap: 10, flexWrap: "wrap" }}>
        <div className="eyebrow">{t("docsTitle")}</div>
        <label className="btn ghost sm" style={{ cursor: "pointer" }}>
          {busy === "upload" ? "…" : t("uploadDoc")}
          <input type="file" hidden accept=".pdf,.png,.jpg,.jpeg" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
        </label>
      </div>
      {docs.length === 0 && <p style={{ fontSize: 13, color: "var(--ink2)", fontStyle: "italic" }}>{t("noDocs")}</p>}
      {docs.map((d) => (
        <div key={d.id} style={{ padding: "8px 0", borderBottom: "1px solid rgba(201,178,145,.2)", opacity: d.archived ? 0.55 : 1 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <select
              value={d.type}
              disabled={pending}
              onChange={(e) => act(() => updateVendorDocumentMeta(weddingId, d.id, { type: e.target.value }))}
              aria-label={t("docType")}
              style={{ fontSize: 11.5, padding: "3px 5px", background: "#fff", border: "1px solid var(--line)" }}
            >
              {DOC_TYPES.map((x) => <option key={x} value={x}>{td(x)}</option>)}
            </select>
            <input
              defaultValue={d.label}
              aria-label={t("docLabel")}
              onBlur={(e) => { if (e.target.value !== d.label) act(() => updateVendorDocumentMeta(weddingId, d.id, { label: e.target.value })); }}
              style={{ flex: 1, minWidth: 140, fontSize: 13, padding: "4px 7px", border: "1px solid transparent" }}
            />
            {signedUrls[d.id] && (
              <a className="addnote" href={signedUrls[d.id]} target="_blank" rel="noreferrer">{t("download")}</a>
            )}
            <button className="addnote" disabled={busy === d.id || !signedUrls[d.id]} onClick={() => void reanalyse(d)} title={t("reanalyseHint")}>
              {busy === d.id ? "…" : t("reanalyse")}
            </button>
            <button className="addnote" disabled={pending} onClick={() => act(() => updateVendorDocumentMeta(weddingId, d.id, { archived: !d.archived }))}>
              {d.archived ? t("restore") : t("archive")}
            </button>
            <button className="addnote" style={{ color: "var(--bronze)" }} disabled={pending} onClick={() => { if (window.confirm(t("removeDocConfirm", { label: d.label }))) act(() => deleteVendorDocument(d.id)); }}>✕</button>
          </div>
        </div>
      ))}
      <p style={{ fontSize: 12, color: "var(--ink2)", margin: "10px 0 0" }}>{t("docsNote")}</p>
    </div>
  );
}
