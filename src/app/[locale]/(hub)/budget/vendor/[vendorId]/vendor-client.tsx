"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { refineVendorNote, saveVendorClientNote } from "@/app/actions/vendors";
import { readVendorBanking, saveVendorBanking } from "@/app/actions/banking";
import { Dictate } from "@/components/Dictate";

/**
 * The sheet's note, under the language rule: Estelle's raw words stay
 * internal; the refined, client-language version is what publishes.
 */
export function VendorNoteEditor({
  weddingId,
  vendorId,
  initialRaw,
  initialBody,
  status
}: {
  weddingId: string;
  vendorId: string;
  initialRaw: string;
  initialBody: string;
  status: "draft" | "published" | null;
}) {
  const t = useTranslations("budget.fiche.note");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [raw, setRaw] = useState(initialRaw);
  const [refined, setRefined] = useState(initialBody);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  if (!open) {
    return (
      <button className="addnote team-only" onClick={() => setOpen(true)}>
        {initialBody ? t("edit") : t("add")}
        {status === "draft" && <span className="tag int" style={{ marginLeft: 6 }}>{tc("draft")}</span>}
      </button>
    );
  }

  async function refine() {
    if (!raw.trim() || busy) return;
    setBusy(true);
    try {
      const r = await refineVendorNote(weddingId, vendorId, raw.trim());
      if (r.ok) setRefined(r.refined);
    } catch {
      /* raw stands */
    }
    setBusy(false);
  }

  const save = (publish: boolean) =>
    startTransition(async () => {
      const r = await saveVendorClientNote({
        vendorId,
        weddingId,
        bodyRaw: raw,
        body: refined || raw,
        publish
      });
      if (r.needsMigration) setFailed(true);
      else {
        setOpen(false);
        router.refresh();
      }
    });

  return (
    <div className="team-only" style={{ display: "grid", gap: 8, marginTop: 8 }}>
      <div className="field">
        <label className="eyebrow" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {t("rawLabel")}
          <Dictate title={t("rawLabel")} onText={(x) => setRaw((v) => (v ? v.trimEnd() + " " + x : x))} />
        </label>
        <textarea rows={2} value={raw} onChange={(e) => setRaw(e.target.value)} placeholder={t("rawPlaceholder")} />
      </div>
      {refined && (
        <div style={{ background: "var(--parchment)", padding: "10px 14px" }}>
          <div className="eyebrow" style={{ marginBottom: 4 }}>{t("refinedLabel")}</div>
          <p className="serif" style={{ fontStyle: "italic", fontSize: 15.5 }}>&ldquo;{refined}&rdquo; — Estelle</p>
        </div>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="btn ghost sm" onClick={refine} disabled={busy || !raw.trim()}>
          {busy ? "…" : t("refine")}
        </button>
        <button className="btn ghost sm" disabled={pending} onClick={() => save(false)}>{t("saveDraft")}</button>
        <button className="btn sm" disabled={pending || !refined} onClick={() => save(true)}>{t("publish")}</button>
        <button className="btn ghost sm" onClick={() => setOpen(false)}>{tc("cancel")}</button>
      </div>
      {failed && <p role="alert" style={{ fontSize: 12.5, color: "var(--bronze)" }}>{t("needsMigration")}</p>}
    </div>
  );
}

/** Banking details — typed once, encrypted, revealed per instalment. */
export function BankingEditor({ weddingId, vendorId }: { weddingId: string; vendorId: string }) {
  const t = useTranslations("budget.fiche.banking");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [holder, setHolder] = useState("");
  const [iban, setIban] = useState("");
  const [swift, setSwift] = useState("");
  const [bank, setBank] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  async function openAndLoad() {
    setOpen(true);
    if (loaded) return;
    try {
      const r = await readVendorBanking(vendorId);
      if (r.details) {
        setHolder(r.details.holder ?? "");
        setIban(r.details.iban ?? "");
        setSwift(r.details.swift ?? "");
        setBank(r.details.bank ?? "");
      }
    } catch {
      /* empty slate */
    }
    setLoaded(true);
  }

  if (!open) {
    return (
      <button className="addnote team-only" onClick={openAndLoad}>
        {t("open")}
      </button>
    );
  }

  return (
    <div className="team-only" style={{ display: "grid", gap: 8, marginTop: 8, maxWidth: 520 }}>
      <p style={{ fontSize: 12.5, color: "var(--ink2)" }}>{t("hint")}</p>
      <input value={holder} onChange={(e) => setHolder(e.target.value)} placeholder={t("holder")} aria-label={t("holder")} />
      <input value={iban} onChange={(e) => setIban(e.target.value)} placeholder="FR76 3000 6000 0112 3456 7890 189" aria-label="IBAN" />
      <div style={{ display: "flex", gap: 8 }}>
        <input value={swift} onChange={(e) => setSwift(e.target.value)} placeholder="SWIFT / BIC" aria-label="SWIFT" style={{ flex: 1 }} />
        <input value={bank} onChange={(e) => setBank(e.target.value)} placeholder={t("bank")} aria-label={t("bank")} style={{ flex: 1 }} />
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button
          className="btn ghost sm"
          disabled={pending || !iban.trim()}
          onClick={() =>
            startTransition(async () => {
              const r = await saveVendorBanking(vendorId, weddingId, {
                holder: holder.trim() || undefined,
                iban: iban.trim(),
                swift: swift.trim() || undefined,
                bank: bank.trim() || undefined
              });
              setFailed(Boolean(r.needsMigration));
              setSaved(r.ok);
            })
          }
        >
          {pending ? "…" : tc("save")}
        </button>
        <button className="btn ghost sm" onClick={() => setOpen(false)}>{tc("close")}</button>
        {saved && <span className="tag ok">{t("saved")}</span>}
      </div>
      {failed && <p role="alert" style={{ fontSize: 12.5, color: "var(--bronze)" }}>{t("needsMigration")}</p>}
    </div>
  );
}
