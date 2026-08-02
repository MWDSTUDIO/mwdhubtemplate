"use client";

import { useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { importVendors, type VendorImportRow } from "@/app/actions/vendors";

/**
 * Vendor import (PRD §10) — CSV/XLSX or pasted rows: preview, column
 * mapping proposed and corrected, duplicates against the registry,
 * review, confirm, results. Nothing enters unseen.
 */

const TARGETS = ["ignore", "name", "category", "email", "phone", "website", "instagram", "city", "country", "notes"] as const;
type Target = (typeof TARGETS)[number];

function propose(header: string): Target {
  const h = header.toLowerCase();
  if (/(name|nom|vendor|prestataire|société|societe|company)/.test(h)) return "name";
  if (/(categ|métier|metier|type)/.test(h)) return "category";
  if (/mail/.test(h)) return "email";
  if (/(phone|tél|tel)/.test(h)) return "phone";
  if (/(web|site|url)/.test(h)) return "website";
  if (/insta/.test(h)) return "instagram";
  if (/(city|ville)/.test(h)) return "city";
  if (/(country|pays)/.test(h)) return "country";
  return "notes";
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

export function VendorImport({
  weddingId,
  registry,
  onClose
}: {
  weddingId: string;
  registry: { id: string; legal_name: string; trading_name: string | null; email: string | null }[];
  onClose: () => void;
}) {
  const t = useTranslations("vendors.importer");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [step, setStep] = useState<"source" | "map" | "review" | "done">("source");
  const [error, setError] = useState("");
  const [pasted, setPasted] = useState("");
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Target[]>([]);
  const [review, setReview] = useState<VendorImportRow[]>([]);
  const [result, setResult] = useState<{ created: number; linked: number; skipped: number } | null>(null);

  const byName = useMemo(() => {
    const m = new Map<string, { id: string; label: string }>();
    for (const r of registry) {
      m.set(norm(r.legal_name), { id: r.id, label: r.trading_name || r.legal_name });
      if (r.trading_name) m.set(norm(r.trading_name), { id: r.id, label: r.trading_name });
    }
    return m;
  }, [registry]);

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
    setMapping(d.columns.map(propose));
    setStep("map");
  };

  const toReview = () => {
    const out: VendorImportRow[] = rows.map((raw) => {
      const f: Record<string, string> = {};
      const notes: string[] = [];
      raw.forEach((cell, i) => {
        const v = cell.trim();
        if (!v || mapping[i] === "ignore") return;
        if (mapping[i] === "notes") notes.push(`${columns[i]}: ${v}`);
        else f[mapping[i]] = v;
      });
      const dup = f.name ? byName.get(norm(f.name)) : undefined;
      return {
        action: f.name ? (dup ? "skip" : "create") : "skip",
        registryId: dup?.id ?? null,
        name: f.name ?? "",
        category: f.category ?? "",
        email: f.email,
        phone: f.phone,
        website: f.website,
        instagram: f.instagram,
        city: f.city,
        country: f.country,
        notes: notes.join(" · ") || undefined
      };
    });
    setReview(out);
    setStep("review");
  };

  const commit = () =>
    startTransition(async () => {
      const r = await importVendors(weddingId, review);
      if (r.ok) { setResult(r); setStep("done"); router.refresh(); }
    });

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
              <a className="btn ghost sm" href="/api/vendor-exports?kind=template&format=xlsx" style={{ textDecoration: "none" }}>{t("template")}</a>
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
                      <select value={mapping[i]} onChange={(e) => setMapping((prev) => prev.map((m, j) => (j === i ? (e.target.value as Target) : m)))} style={{ fontSize: 12, padding: "3px 5px", background: "#fff", border: "1px solid var(--line)" }}>
                        {TARGETS.map((x) => <option key={x} value={x}>{t(`target_${x}`)}</option>)}
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
                    <option value="create">{r.registryId ? t("actionLink") : t("actionCreate")}</option>
                    <option value="skip">{t("actionSkip")}</option>
                  </select>
                  <span style={{ fontWeight: 500, color: "var(--hunter)" }}>{r.name || t("nameless")}</span>
                  <span style={{ fontSize: 12, color: "var(--ink2)" }}>{[r.category, r.email, r.city].filter(Boolean).join(" · ")}</span>
                  {r.registryId && <span style={{ fontSize: 12, color: "var(--bronze)" }}>{t("dupFlag")}</span>}
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 10, alignItems: "baseline" }}>
              <button className="btn sm" disabled={pending} onClick={commit}>{pending ? "…" : t("integrate")}</button>
              <button className="btn ghost sm" onClick={() => setStep("map")}>{t("back")}</button>
              <span style={{ fontSize: 12.5, color: "var(--ink2)" }}>
                {t("counts", { create: review.filter((r) => r.action === "create").length, skip: review.filter((r) => r.action === "skip").length })}
              </span>
            </div>
          </div>
        )}

        {step === "done" && result && (
          <div style={{ marginTop: 14 }}>
            <p style={{ fontSize: 14.5 }}>{t("done", { created: result.created, linked: result.linked, skipped: result.skipped })}</p>
            <button className="btn sm" onClick={onClose}>{t("close")}</button>
          </div>
        )}
      </aside>
    </>
  );
}
