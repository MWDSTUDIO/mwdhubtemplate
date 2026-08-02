"use client";

import React, { useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import type { Guest, WeddingEvent } from "@/lib/types";
import { importGuests, type ImportRowDecision } from "@/app/actions/guests";

/**
 * The import wizard (final prompt §B1) — a messy file becomes a clean
 * list, under Estelle's eyes at every step: upload or paste → mapping
 * proposed and corrected → normalisation and duplicates in review,
 * row by row → confirm → summary. Nothing enters the list unseen, and
 * no hand-corrected row is ever overwritten (a merge only fills what
 * is empty; a collision shows both versions and Estelle decides).
 */

const TITLES = [
  "Ms.", "Mr.", "Mrs.", "Miss", "Mx.", "Mr. and Mrs.", "Dr.", "The Doctors",
  "The Honorable", "The Reverend", "Rabbi", "Cantor", "Captain", "Colonel",
  "Monsieur et Madame", "Monsieur", "Madame", "Maître"
];
const SUFFIXES = ["Jr.", "Sr.", "II", "III", "IV"];

const TARGETS = [
  "ignore", "household", "title", "first_names", "surname", "suffix",
  "invitation_line", "email", "phone", "address", "address_line2", "city",
  "postal_code", "region", "country", "locale", "side", "relationship",
  "category", "adults", "children", "dietary", "travel",
  "accommodation_wished", "notes"
] as const;
type Target = (typeof TARGETS)[number] | `event:${string}`;

/** The app proposes the mapping; Estelle corrects it from a menu. */
function proposeTarget(header: string, events: WeddingEvent[]): Target {
  const h = header.toLowerCase().trim();
  const hit = (...words: string[]) => words.some((w) => h.includes(w));
  for (const ev of events) {
    if (h.includes(ev.name.toLowerCase())) return `event:${ev.id}`;
  }
  if (hit("invitation")) return "invitation_line";
  if (hit("household", "foyer", "famille", "family")) return "household";
  if (hit("civilit", "titre") || h === "title") return "title";
  if (hit("suffix", "suffixe")) return "suffix";
  if (hit("first", "prénom", "prenom")) return "first_names";
  if (hit("surname", "last name", "lastname", "nom de famille") || h === "nom" || h === "name") return h === "name" ? "household" : "surname";
  if (hit("mail")) return "email";
  if (hit("phone", "tél", "tel")) return "phone";
  if (hit("address 2", "adresse 2", "line 2", "ligne 2")) return "address_line2";
  if (hit("address", "adresse", "street", "rue")) return "address";
  if (hit("city", "ville")) return "city";
  if (hit("zip", "postcode", "postal", "cp")) return "postal_code";
  if (hit("region", "région", "state", "état")) return "region";
  if (hit("country", "pays")) return "country";
  if (hit("lang")) return "locale";
  if (hit("side", "côté", "cote")) return "side";
  if (hit("relation", "lien")) return "relationship";
  if (hit("categ")) return "category";
  if (hit("adult")) return "adults";
  if (hit("child", "enfant")) return "children";
  if (hit("diet", "régime", "regime", "allerg")) return "dietary";
  if (hit("travel", "voyage", "séjour", "sejour", "stay")) return "travel";
  if (hit("accommodation", "hébergement", "hebergement", "hotel", "hôtel")) return "accommodation_wished";
  if (hit("note")) return "notes";
  return "notes";
}

/** One name cell becomes title · first names · surname · suffix. */
function splitName(raw: string) {
  let s = raw.trim().replace(/\s+/g, " ");
  let title = "", suffix = "";
  for (const t of [...TITLES].sort((a, b) => b.length - a.length)) {
    if (s.toLowerCase().startsWith(t.toLowerCase() + " ")) { title = t; s = s.slice(t.length).trim(); break; }
  }
  const sufMatch = s.match(/,?\s+(Jr\.|Sr\.|II|III|IV)\.?$/i);
  if (sufMatch) {
    suffix = SUFFIXES.find((x) => x.toLowerCase().startsWith(sufMatch[1].toLowerCase().replace(".", ""))) ?? sufMatch[1];
    s = s.slice(0, sufMatch.index).replace(/,\s*$/, "").trim();
  }
  const words = s.split(" ");
  const surname = words.length > 1 ? words[words.length - 1] : "";
  const first = words.length > 1 ? words.slice(0, -1).join(" ") : s;
  return { title, first_names: first, surname, suffix };
}

const YES = /^(y|yes|oui|x|1|true|si|sí)$/i;

interface ReviewRow {
  decision: ImportRowDecision;
  flags: string[];
  collision: Guest | null;
  raw: string[];
}

export function ImportWizard({
  weddingId,
  events,
  households,
  onClose,
  onDone
}: {
  weddingId: string;
  events: WeddingEvent[];
  households: Guest[];
  onClose: () => void;
  onDone: (summary: { created: number; merged: number; skipped: number }) => void;
}) {
  const t = useTranslations("communication.importer");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [step, setStep] = useState<"source" | "map" | "review" | "confirm">("source");
  const [error, setError] = useState("");
  const [label, setLabel] = useState("");
  const [pasted, setPasted] = useState("");
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Target[]>([]);
  const [review, setReview] = useState<ReviewRow[]>([]);

  const existingByKey = useMemo(() => {
    const m = new Map<string, Guest>();
    for (const g of households.filter((x) => !x.archived)) {
      const line = (g.invitation_line ?? "").toLowerCase().replace(/\s+/g, " ").trim();
      if (line) m.set(`l:${line}`, g);
      const key = `${(g.surname ?? "").toLowerCase()}|${(g.first_names ?? "").toLowerCase()}`;
      if (key !== "|") m.set(`n:${key}`, g);
    }
    return m;
  }, [households]);

  /* ── step 1 → 2: parse ── */
  const parse = async (body: FormData | { text: string }) => {
    setError("");
    const res = await fetch("/api/imports/parse", {
      method: "POST",
      ...(body instanceof FormData
        ? { body }
        : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    });
    if (!res.ok) { setError(t(res.status === 422 ? "errUnreadable" : "errParse")); return; }
    const data = (await res.json()) as { columns: string[]; rows: string[][] };
    setColumns(data.columns);
    setRows(data.rows);
    setMapping(data.columns.map((c) => proposeTarget(c, events)));
    setStep("map");
  };

  /* ── step 2 → 3: normalise + collide ── */
  const toReview = () => {
    const out: ReviewRow[] = rows.map((raw) => {
      const fields: Record<string, string> = {};
      const eventInvites: string[] = [];
      let adults: number | undefined, children: number | undefined;
      const notes: string[] = [];
      raw.forEach((cell, i) => {
        const target = mapping[i];
        const v = cell.trim();
        if (!v || target === "ignore") return;
        if (target === "household") {
          const parts = splitName(v);
          for (const [k, val] of Object.entries(parts)) if (val && !fields[k]) fields[k] = val;
        } else if (target.startsWith("event:")) {
          if (YES.test(v)) eventInvites.push(target.slice(6));
        } else if (target === "adults") adults = parseInt(v) || undefined;
        else if (target === "children") children = parseInt(v) || undefined;
        else if (target === "accommodation_wished") fields.accommodation_wished = YES.test(v) ? "yes" : "";
        else if (target === "notes") notes.push(`${columns[i]}: ${v}`);
        else fields[target] = v;
      });
      if (notes.length) fields.notes_internal = notes.join(" · ");
      if (!fields.invitation_line) {
        const name = [fields.first_names, fields.surname].filter(Boolean).join(" ");
        if (name) fields.invitation_line = `${fields.title ? fields.title + " " : ""}${name}${fields.suffix ? ", " + fields.suffix : ""}`;
      }
      const flags: string[] = [];
      const nameless = !fields.first_names && !fields.surname && !fields.invitation_line;
      if (nameless) flags.push(t("flagNameless"));
      if (!fields.address && !fields.city) flags.push(t("flagNoAddress"));
      if (!fields.email) flags.push(t("flagNoEmail"));

      const key1 = `l:${(fields.invitation_line ?? "").toLowerCase().replace(/\s+/g, " ").trim()}`;
      const key2 = `n:${(fields.surname ?? "").toLowerCase()}|${(fields.first_names ?? "").toLowerCase()}`;
      const collision = existingByKey.get(key1) ?? existingByKey.get(key2) ?? null;
      const houseTouched = collision?.provenance === "house";
      if (collision) flags.push(houseTouched ? t("flagCollisionHouse") : t("flagCollision"));

      return {
        raw,
        flags,
        collision,
        decision: {
          action: nameless ? "skip" : collision ? (houseTouched ? "skip" : "merge") : "create",
          mergeInto: collision?.id ?? null,
          fields,
          adults,
          children,
          eventInvites
        }
      };
    });
    setReview(out);
    setStep("review");
  };

  const counts = useMemo(() => {
    const c = { create: 0, merge: 0, skip: 0, invites: 0 };
    for (const r of review) {
      c[r.decision.action]++;
      if (r.decision.action !== "skip") c.invites += r.decision.eventInvites.length;
    }
    return c;
  }, [review]);

  const setAction = (i: number, action: ImportRowDecision["action"]) =>
    setReview((prev) => prev.map((r, j) => (j === i ? { ...r, decision: { ...r.decision, action } } : r)));

  const commit = () =>
    startTransition(async () => {
      const r = await importGuests(
        weddingId,
        label || t("defaultLabel"),
        Object.fromEntries(columns.map((c, i) => [c, mapping[i]])),
        review.map((x) => x.decision)
      );
      if (r.ok) {
        router.refresh();
        onDone({ created: r.created, merged: r.merged, skipped: r.skipped });
      }
    });

  const lbl = (k: string) => (
    <span style={{ display: "block", fontSize: 12, letterSpacing: ".14em", textTransform: "uppercase", fontWeight: 500, color: "var(--ink2)", margin: "14px 0 5px" }}>{t(k)}</span>
  );

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(34,56,43,.25)", zIndex: 40 }} aria-hidden />
      <aside
        aria-label={t("title")}
        style={{
          position: "fixed", top: 0, right: 0, bottom: 0, width: "min(760px, 100%)",
          background: "var(--white, #fffdf9)", borderLeft: "1px solid var(--line)",
          padding: "24px 28px", overflow: "auto", zIndex: 50, boxShadow: "-12px 0 40px rgba(34,56,43,.12)"
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
          <p className="eyebrow" style={{ color: "var(--bronze)", margin: 0 }}>{t("title")}</p>
          <span style={{ fontSize: 12, color: "var(--ink2)" }}>
            {t(`step_${step}`)}
          </span>
        </div>
        {error && <p style={{ color: "var(--bronze)", fontSize: 13.5, marginTop: 10 }}>{error}</p>}

        {/* ── 1 · the source ── */}
        {step === "source" && (
          <div>
            <p style={{ fontSize: 13.5, color: "var(--ink2)", margin: "10px 0 0" }}>{t("sourceBlurb")}</p>
            {lbl("labelField")}
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("labelPlaceholder")} style={{ width: "100%", fontSize: 14, padding: "7px 10px" }} />
            {lbl("fileField")}
            <input
              type="file"
              accept=".xlsx,.xls,.csv,text/csv"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                if (!label) setLabel(f.name.replace(/\.(xlsx|xls|csv)$/i, ""));
                const fd = new FormData();
                fd.set("file", f);
                parse(fd);
              }}
              style={{ fontSize: 13.5 }}
            />
            {lbl("pasteField")}
            <textarea
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              rows={7}
              placeholder={t("pastePlaceholder")}
              style={{ width: "100%", fontSize: 13, padding: "9px 11px", border: "1px solid var(--line)", fontFamily: "inherit" }}
            />
            <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
              <button className="btn sm" disabled={!pasted.trim()} onClick={() => parse({ text: pasted })}>{t("readPaste")}</button>
              <a className="btn ghost sm" href="/api/exports?kind=template&format=xlsx" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
                {t("downloadTemplate")}
              </a>
              <button className="btn ghost sm" onClick={onClose}>{t("close")}</button>
            </div>
          </div>
        )}

        {/* ── 2 · the mapping ── */}
        {step === "map" && (
          <div>
            <p style={{ fontSize: 13.5, color: "var(--ink2)", margin: "10px 0 12px" }}>{t("mapBlurb", { n: rows.length })}</p>
            <table className="sheet-table" style={{ fontSize: 13 }}>
              <thead><tr><th>{t("mapColumn")}</th><th>{t("mapSample")}</th><th>{t("mapTarget")}</th></tr></thead>
              <tbody>
                {columns.map((c, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 500 }}>{c}</td>
                    <td style={{ color: "var(--ink2)", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {rows.slice(0, 2).map((r) => r[i]).filter(Boolean).join(" · ")}
                    </td>
                    <td>
                      <select
                        value={mapping[i]}
                        onChange={(e) => setMapping((prev) => prev.map((m, j) => (j === i ? (e.target.value as Target) : m)))}
                        style={{ padding: "4px 6px", border: "1px solid var(--line)", background: "#fff", fontSize: 12.5 }}
                        aria-label={t("mapTarget")}
                      >
                        {TARGETS.map((x) => <option key={x} value={x}>{t(`target_${x}`)}</option>)}
                        {events.map((ev) => <option key={ev.id} value={`event:${ev.id}`}>{t("targetEvent", { name: ev.name })}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ fontSize: 12.5, color: "var(--ink2)", marginTop: 8 }}>{t("mapNote")}</p>
            <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
              <button className="btn sm" onClick={toReview}>{t("toReview")}</button>
              <button className="btn ghost sm" onClick={() => setStep("source")}>{t("back")}</button>
            </div>
          </div>
        )}

        {/* ── 3 · the review — nothing enters unseen ── */}
        {step === "review" && (
          <div>
            <p style={{ fontSize: 13.5, color: "var(--ink2)", margin: "10px 0 12px" }}>{t("reviewBlurb")}</p>
            <div style={{ maxHeight: "56vh", overflow: "auto", border: "1px solid var(--line)" }}>
              {review.map((r, i) => (
                <div key={i} style={{ padding: "10px 14px", borderBottom: "1px solid rgba(201,178,145,.28)", background: r.decision.action === "skip" ? "var(--parchment)" : undefined }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                    <select
                      value={r.decision.action}
                      onChange={(e) => setAction(i, e.target.value as ImportRowDecision["action"])}
                      style={{ padding: "3px 5px", border: "1px solid var(--line)", background: "#fff", fontSize: 12 }}
                      aria-label={t("rowAction")}
                    >
                      <option value="create">{t("actionCreate")}</option>
                      {r.collision && <option value="merge">{t("actionMerge")}</option>}
                      <option value="skip">{t("actionSkip")}</option>
                    </select>
                    <span style={{ fontWeight: 500, color: "var(--hunter)" }}>{r.decision.fields.invitation_line || t("nameless")}</span>
                    <span style={{ fontSize: 12, color: "var(--ink2)" }}>
                      {[r.decision.fields.email, r.decision.fields.city, r.decision.eventInvites.length ? t("invitesCount", { n: r.decision.eventInvites.length }) : ""].filter(Boolean).join(" · ")}
                    </span>
                  </div>
                  {r.flags.length > 0 && (
                    <div style={{ fontSize: 12, color: "var(--bronze)", marginTop: 3 }}>{r.flags.join(" · ")}</div>
                  )}
                  {r.collision && (
                    <div style={{ fontSize: 12.5, marginTop: 4, paddingLeft: 8, borderLeft: "2px solid var(--champagne)" }}>
                      {t("existingRow")} <em>{r.collision.invitation_line || [r.collision.first_names, r.collision.surname].filter(Boolean).join(" ")}</em>
                      {r.collision.provenance === "house" && <strong style={{ color: "var(--bronze)" }}> — {t("houseCorrected")}</strong>}
                      <span style={{ color: "var(--ink2)" }}> · {t("mergeRule")}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 12, alignItems: "baseline", flexWrap: "wrap" }}>
              <button className="btn sm" onClick={() => setStep("confirm")}>{t("toConfirm")}</button>
              <button className="btn ghost sm" onClick={() => setStep("map")}>{t("back")}</button>
              <span style={{ fontSize: 12.5, color: "var(--ink2)" }}>
                {t("reviewCounts", { create: counts.create, merge: counts.merge, skip: counts.skip })}
              </span>
            </div>
          </div>
        )}

        {/* ── 4 · the confirmation ── */}
        {step === "confirm" && (
          <div>
            <p style={{ fontSize: 14.5, margin: "14px 0" }}>
              {t("confirmBlurb", { create: counts.create, merge: counts.merge, skip: counts.skip, invites: counts.invites })}
            </p>
            <p style={{ fontSize: 13, color: "var(--ink2)" }}>{t("confirmNote")}</p>
            <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
              <button className="btn sm" disabled={pending} onClick={commit}>{pending ? "…" : t("integrate")}</button>
              <button className="btn ghost sm" disabled={pending} onClick={() => setStep("review")}>{t("back")}</button>
            </div>
          </div>
        )}
      </aside>
    </>
  );
}
