"use client";

import { useState, useTransition } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { refineVendorNote, saveVendorClientNote, updateVendorMeta, deleteVendor, previewVendorDeletion } from "@/app/actions/vendors";
import {
  readVendorBanking,
  saveVendorBanking,
  verifyVendorBanking,
  verifyPendingBanking,
  dismissPendingBanking,
  acceptBankingReading,
  dismissBankingReading
} from "@/app/actions/banking";
import { ibanGroups } from "@/lib/banking-checks";
import { Dictate } from "@/components/Dictate";
import type { BudgetLineItem } from "@/lib/types";
import { deleteLineItem, saveLineItem } from "@/app/actions/budget";

/** A value the couple can carry away in one touch. */
export function CopyLine({ label, value, copyValue }: { label: string; value: string; copyValue: string }) {
  const [held, setHeld] = useState(false);
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
      <span>{label}&nbsp;: <span className="num">{value}</span></span>
      <button
        className="addnote"
        onClick={() => {
          void navigator.clipboard?.writeText(copyValue).then(() => {
            setHeld(true);
            setTimeout(() => setHeld(false), 1800);
          });
        }}
      >
        {held ? "✓" : "⧉"}
      </button>
    </div>
  );
}

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

interface BankingMeta {
  exists: boolean;
  status: string;
  verified_by: string | null;
  verified_at: string | null;
  verification_method: string | null;
  pending_read_at: string | null;
}

interface BankingReadingRow {
  id: string;
  label: string;
  created_at: string;
  payload: Record<string, unknown>;
}

type F = { value?: string | null; raw?: string | null; confidence?: number; page?: number | null };
interface ReadBlock {
  identifies?: string | null;
  corridor?: string;
  beneficiary?: Record<string, F>;
  account?: Record<string, F>;
  bank?: Record<string, F>;
  intermediary?: Record<string, F> | null;
  terms?: Record<string, F>;
  flagged?: { field: string; reason: string; quote?: string; position?: string | null }[];
}

/**
 * The banking desk of the vendor sheet (banking brief §3–§6): drop a
 * paper, review the reading field by field beside its raw print,
 * verify de vive voix, and never let a change slip in silently.
 */
export function BankingDesk({
  weddingId,
  vendorId,
  meta,
  readings
}: {
  weddingId: string;
  vendorId: string;
  meta: BankingMeta;
  readings: BankingReadingRow[];
}) {
  const t = useTranslations("budget.fiche.banking");
  const format = useFormatter();
  const router = useRouter();
  const [dropBusy, setDropBusy] = useState(false);
  const [dropNote, setDropNote] = useState<string | null>(null);

  async function readDocument(file: File) {
    if (dropBusy) return;
    setDropBusy(true);
    setDropNote(null);
    try {
      const form = new FormData();
      form.append("weddingId", weddingId);
      form.append("vendorId", vendorId);
      form.append("file", file);
      const r = await fetch("/api/agents/banking", { method: "POST", body: form });
      const d = await r.json();
      setDropNote(d.text ?? t("readFailed"));
      router.refresh();
    } catch {
      setDropNote(t("readFailed"));
    }
    setDropBusy(false);
  }

  const when = (iso: string | null) =>
    iso ? format.dateTime(new Date(iso), { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }) : "";

  return (
    <div className="team-only" style={{ display: "grid", gap: 12 }}>
      {/* The state, never ambiguous: read is not verified (§0). */}
      {meta.exists && meta.status === "verified" && (
        <p style={{ fontSize: 13.5, margin: 0 }}>
          <span className="tag ok">{t("statusVerified")}</span>{" "}
          {t("verifiedLine", {
            by: meta.verified_by ?? "—",
            when: when(meta.verified_at),
            method: meta.verification_method === "in_person" ? t("methodInPerson") : t("methodCall")
          })}
        </p>
      )}
      {meta.exists && meta.status !== "verified" && (
        <p style={{ fontSize: 13.5, margin: 0 }}>
          <span className="tag int">{t("statusRead")}</span> {t("readLine")}
        </p>
      )}

      {/* The number-one fraud signal — loud, never discreet (§6). */}
      {meta.pending_read_at && (
        <PendingAlert weddingId={weddingId} vendorId={vendorId} readAt={when(meta.pending_read_at)} />
      )}

      {readings.map((r) => (
        <BankingReading key={r.id} weddingId={weddingId} vendorId={vendorId} reading={r} />
      ))}

      {/* Verification de vive voix — on a number obtained OUTSIDE the
          document (§5). */}
      {meta.exists && meta.status !== "verified" && meta.status !== "none" && (
        <VerifyForm
          onVerify={(method, contact) => verifyVendorBanking(vendorId, weddingId, { method, contact })}
        />
      )}

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <label className="btn ghost sm" style={{ cursor: "pointer" }}>
          {dropBusy ? "…" : t("dropDoc")}
          <input
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.webp"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void readDocument(f);
              e.target.value = "";
            }}
          />
        </label>
        <BankingEditor weddingId={weddingId} vendorId={vendorId} />
      </div>
      {dropNote && (
        <p className="ia-quote" style={{ fontSize: 14.5 }} aria-live="polite">{dropNote}</p>
      )}
      <p style={{ fontSize: 12.5, color: "var(--ink2)", margin: 0 }}>{t("vaultNote")}</p>
    </div>
  );
}

function VerifyForm({
  onVerify,
  title
}: {
  onVerify: (method: "call" | "in_person", contact: string) => Promise<{ ok: boolean }>;
  title?: string;
}) {
  const t = useTranslations("budget.fiche.banking");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<"call" | "in_person">("call");
  const [contact, setContact] = useState("");
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button className="addnote" style={{ justifySelf: "start" }} onClick={() => setOpen(true)}>
        {title ?? t("verifyOpen")}
      </button>
    );
  }
  return (
    <div style={{ border: "1px dashed var(--champagne)", padding: "12px 14px", display: "grid", gap: 8 }}>
      <p style={{ fontSize: 13, margin: 0 }}>{t("verifyRule")}</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <select value={method} onChange={(e) => setMethod(e.target.value as "call" | "in_person")} style={{ padding: "8px 10px", border: "1px solid var(--line)" }}>
          <option value="call">{t("methodCall")}</option>
          <option value="in_person">{t("methodInPerson")}</option>
        </select>
        <input
          value={contact}
          onChange={(e) => setContact(e.target.value)}
          placeholder={t("contactPlaceholder")}
          style={{ flex: 1, minWidth: 220 }}
        />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          className="btn sm"
          disabled={pending || !contact.trim()}
          onClick={() =>
            startTransition(async () => {
              const r = await onVerify(method, contact.trim());
              if (r.ok) {
                setOpen(false);
                router.refresh();
              }
            })
          }
        >
          {pending ? "…" : t("verifyConfirm")}
        </button>
        <button className="btn ghost sm" onClick={() => setOpen(false)}>{t("verifyLater")}</button>
      </div>
    </div>
  );
}

function PendingAlert({ weddingId, vendorId, readAt }: { weddingId: string; vendorId: string; readAt: string }) {
  const t = useTranslations("budget.fiche.banking");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <div role="alert" style={{ border: "2px solid var(--bronze)", background: "oklch(0.478 0.0677 77.73 / 0.08)", padding: "14px 16px", display: "grid", gap: 8 }}>
      <div className="eyebrow" style={{ color: "var(--bronze)" }}>{t("pendingTitle")}</div>
      <p style={{ fontSize: 14, margin: 0 }}>{t("pendingBody", { when: readAt })}</p>
      <VerifyForm
        title={t("pendingVerify")}
        onVerify={(method, contact) => verifyPendingBanking(vendorId, weddingId, { method, contact })}
      />
      <button
        className="addnote"
        style={{ justifySelf: "start" }}
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            await dismissPendingBanking(vendorId, weddingId);
            router.refresh();
          })
        }
      >
        {t("pendingDismiss")}
      </button>
    </div>
  );
}

/**
 * The validation screen (§ execution 4): each block field by field —
 * normalised value, the raw print, confidence, page — accepted only
 * by Estelle's own tick. Rejected-by-checksum fields arrive empty and
 * flagged; they cannot be ticked into existence.
 */
function BankingReading({
  weddingId,
  vendorId,
  reading
}: {
  weddingId: string;
  vendorId: string;
  reading: BankingReadingRow;
}) {
  const t = useTranslations("budget.fiche.banking");
  const router = useRouter();
  const blocks = (reading.payload.blocks as ReadBlock[] | undefined) ?? [];
  const [blockIdx, setBlockIdx] = useState(0);
  const block = blocks[blockIdx];
  const [accepted, setAccepted] = useState<Set<string>>(() => {
    const s = new Set<string>();
    const b = blocks[0];
    if (b) {
      for (const group of ["beneficiary", "account", "bank", "intermediary", "terms"] as const) {
        const g = b[group];
        if (g && typeof g === "object") {
          for (const [k, f] of Object.entries(g)) {
            if (f?.value && (f.confidence ?? 0) >= 0.7) s.add(`${group}.${k}`);
          }
        }
      }
    }
    return s;
  });
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  if (!block) return null;

  const toggle = (path: string) =>
    setAccepted((v) => {
      const next = new Set(v);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const rows: { path: string; label: string; f: F }[] = [];
  for (const group of ["beneficiary", "account", "bank", "intermediary", "terms"] as const) {
    const g = block[group];
    if (g && typeof g === "object") {
      for (const [k, f] of Object.entries(g)) {
        if (f && (f.value || f.raw)) rows.push({ path: `${group}.${k}`, label: `${group}.${k}`, f });
      }
    }
  }

  return (
    <div className="card" style={{ marginBottom: 0, border: "1px solid var(--champagne)" }}>
      <div className="eyebrow" style={{ marginBottom: 8 }}>
        {t("readingTitle")} — {reading.label}
      </div>
      {blocks.length > 1 && (
        <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
          {blocks.map((b, i) => (
            <button key={i} className={`viewpick${i === blockIdx ? " on" : ""}`} onClick={() => setBlockIdx(i)}>
              {b.identifies || `${t("blockN", { n: i + 1 })}`}
            </button>
          ))}
        </div>
      )}
      <p style={{ fontSize: 13, color: "var(--ink2)", margin: "0 0 8px" }}>
        {t("corridorLine", { corridor: block.corridor ?? "unknown" })}
      </p>
      <div style={{ overflowX: "auto" }}>
        <table className="sheet-table">
          <thead>
            <tr>
              <th></th>
              <th>{t("colField")}</th>
              <th>{t("colValue")}</th>
              <th>{t("colRaw")}</th>
              <th className="num">{t("colConfidence")}</th>
              <th className="num">{t("colPage")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ path, f }) => (
              <tr key={path}>
                <td>
                  <input
                    type="checkbox"
                    style={{ width: "auto" }}
                    checked={accepted.has(path)}
                    disabled={!f.value}
                    onChange={() => toggle(path)}
                  />
                </td>
                <td style={{ fontSize: 13 }}>{path}</td>
                <td className="num" style={{ fontVariantNumeric: "tabular-nums" }}>
                  {f.value
                    ? path === "account.iban"
                      ? ibanGroups(f.value)
                      : f.value
                    : <em style={{ color: "var(--bronze)" }}>{t("rejected")}</em>}
                </td>
                <td style={{ fontSize: 12.5, color: "var(--ink2)" }}>{f.raw ?? ""}</td>
                <td className="num" style={{ color: (f.confidence ?? 0) < 0.7 ? "var(--bronze)" : undefined }}>
                  {f.confidence != null ? Math.round(f.confidence * 100) + " %" : ""}
                </td>
                <td className="num">{f.page ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(block.flagged?.length ?? 0) > 0 && (
        <div style={{ marginTop: 10 }}>
          <div className="eyebrow" style={{ color: "var(--bronze)", marginBottom: 4 }}>{t("flaggedTitle")}</div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {block.flagged!.map((fl, i) => (
              <li key={i} style={{ fontSize: 13 }}>
                <b>{fl.field}</b> — {fl.reason}
                {fl.position ? ` (${t("position")} ${fl.position})` : ""}
                {fl.quote ? <> : <em>&ldquo;{fl.quote}&rdquo;</em></> : null}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
        <button
          className="btn sm"
          disabled={pending || [...accepted].every((p) => !p.startsWith("account."))}
          onClick={() =>
            startTransition(async () => {
              const r = await acceptBankingReading({
                readingId: reading.id,
                vendorId,
                weddingId,
                blockIndex: blockIdx,
                accepted: [...accepted]
              });
              if (!r.ok) setNote(t("acceptFailed"));
              else {
                setNote(r.heldForVerification ? t("acceptHeld") : t("acceptDone"));
                router.refresh();
              }
            })
          }
        >
          {pending ? "…" : t("acceptSelection")}
        </button>
        <button
          className="btn ghost sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              await dismissBankingReading(reading.id);
              router.refresh();
            })
          }
        >
          {t("dismiss")}
        </button>
        {note && <span style={{ fontSize: 12.5, color: "var(--bronze)" }} role="status">{note}</span>}
      </div>
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
  const [held, setHeld] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  async function openAndLoad() {
    setOpen(true);
    if (loaded) return;
    try {
      const r = await readVendorBanking(vendorId);
      if (r.details) {
        setHolder(r.details.beneficiary?.legal_name ?? "");
        setIban(r.details.account?.iban ?? "");
        setSwift(r.details.account?.bic ?? "");
        setBank(r.details.bank?.name ?? "");
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
              setHeld(Boolean(r.heldForVerification));
              setSaved(r.ok);
              router.refresh();
            })
          }
        >
          {pending ? "…" : tc("save")}
        </button>
        <button className="btn ghost sm" onClick={() => setOpen(false)}>{tc("close")}</button>
        {saved && !held && <span className="tag ok">{t("saved")}</span>}
        {held && <span className="tag int">{t("heldTag")}</span>}
      </div>
      {held && <p role="alert" style={{ fontSize: 12.5, color: "var(--bronze)" }}>{t("acceptHeld")}</p>}
      {failed && <p role="alert" style={{ fontSize: 12.5, color: "var(--bronze)" }}>{t("needsMigration")}</p>}
    </div>
  );
}

/* ══════════ The quote's lines, under the hand again ══════════ */

interface ItemDraft {
  label: string;
  qty: string;
  unit: string;
  ht: string;
  vat: string;
  ttc: string;
  lineId: string;
  /** "" = the post follows its line's category (0020). */
  env: string;
}

const numOrNull = (s: string): number | null => {
  const n = Number(s.replace(/\s/g, "").replace(",", "."));
  return s.trim() === "" || !Number.isFinite(n) ? null : n;
};

/**
 * The vendor sheet's items — read by the couple, held by the team.
 * A reading fills them; a hand corrects, adds or removes them just as
 * freely (the rule born of bloc 4: a component never loses its
 * capabilities). HT computes from qty × unit, TTC from HT and VAT,
 * and the line's committed figure recomposes itself server-side.
 */
export function QuoteItems({
  weddingId,
  lines,
  items,
  isTeam,
  envelopes
}: {
  weddingId: string;
  lines: { id: string; label: string }[];
  items: BudgetLineItem[];
  isTeam: boolean;
  envelopes: { id: string; label: string }[];
}) {
  const t = useTranslations("budget.fiche");
  const tc = useTranslations("common");
  const format = useFormatter();
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addingIn, setAddingIn] = useState<string | null>(null); // event label
  const [newEvent, setNewEvent] = useState<string | null>(null); // null = closed
  const [word, setWord] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const money = (n: number | null | undefined) =>
    n == null ? "" : format.number(n, { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

  const groups = new Map<string, BudgetLineItem[]>();
  for (const it of items) {
    const k = it.event_label ?? t("noEvent");
    groups.set(k, [...(groups.get(k) ?? []), it]);
  }

  const save = (draft: ItemDraft, eventLabel: string, id?: string) =>
    startTransition(async () => {
      const r = await saveLineItem({
        id,
        weddingId,
        budgetLineId: draft.lineId,
        eventLabel,
        label: draft.label,
        qty: numOrNull(draft.qty),
        unitPrice: numOrNull(draft.unit),
        vatPct: numOrNull(draft.vat),
        totalHt: numOrNull(draft.ht),
        totalTtc: numOrNull(draft.ttc),
        envelopeId: draft.env || null
      });
      setWord("envelopeSaved" in r && r.envelopeSaved === false ? t("itemsCat0020") : null);
      setEditingId(null);
      setAddingIn(null);
      setNewEvent(null);
      router.refresh();
    });

  const remove = (it: BudgetLineItem) =>
    startTransition(async () => {
      await deleteLineItem(it.id, it.budget_line_id);
      router.refresh();
    });

  if (groups.size === 0 && !isTeam) {
    return (
      <div className="card">
        <p className="serif" style={{ fontStyle: "italic", color: "var(--ink2)" }}>{t("noItems")}</p>
      </div>
    );
  }

  return (
    <>
      {groups.size === 0 && (
        <div className="card">
          <p className="serif" style={{ fontStyle: "italic", color: "var(--ink2)" }}>{t("noItems")}</p>
        </div>
      )}
      {[...groups.entries()].map(([event, rows]) => (
        <div className="card" key={event}>
          <div className="eyebrow" style={{ color: "var(--bronze)", marginBottom: 10 }}>{event}</div>
          <div style={{ overflowX: "auto" }}>
            <table className="sheet-table">
              <thead>
                <tr>
                  <th>{t("item")}</th>
                  <th className="num">{t("qty")}</th>
                  <th className="num">{t("unit")}</th>
                  <th className="num">HT</th>
                  <th className="num">{t("vat")}</th>
                  <th className="num">TTC</th>
                  {isTeam && <th aria-label={tc("edit")} />}
                </tr>
              </thead>
              <tbody>
                {rows.map((it) =>
                  editingId === it.id ? (
                    <tr key={it.id} className="team-only">
                      <td colSpan={7}>
                        <ItemForm
                          lines={lines}
                          envelopes={envelopes}
                          initial={{
                            label: it.label,
                            qty: it.qty != null ? String(it.qty) : "",
                            unit: it.unit_price != null ? String(it.unit_price) : "",
                            ht: it.total_ht != null ? String(it.total_ht) : "",
                            vat: it.vat_pct != null ? String(it.vat_pct) : "",
                            ttc: it.total_ttc != null ? String(it.total_ttc) : "",
                            lineId: it.budget_line_id,
                            env: it.envelope_id ?? ""
                          }}
                          pending={pending}
                          onSave={(d) => save(d, it.event_label ?? "", it.id)}
                          onCancel={() => setEditingId(null)}
                        />
                      </td>
                    </tr>
                  ) : (
                    <tr key={it.id}>
                      <td>
                        {it.label}
                        {isTeam && it.envelope_id && (
                          <em className="team-only" style={{ color: "var(--bronze)", marginLeft: 6, fontSize: 11.5 }}>
                            → {envelopes.find((e2) => e2.id === it.envelope_id)?.label ?? ""}
                          </em>
                        )}
                      </td>
                      <td className="num">{it.qty ?? ""}</td>
                      <td className="num">{it.unit_price != null ? money(it.unit_price) : ""}</td>
                      <td className="num">{it.total_ht != null ? money(it.total_ht) : ""}</td>
                      <td className="num">{it.vat_pct != null ? `${it.vat_pct} %` : ""}</td>
                      <td className="num">{money(it.total_ttc ?? it.total_ht) || "—"}</td>
                      {isTeam && (
                        <td className="team-only" style={{ whiteSpace: "nowrap" }}>
                          <button className="addnote" onClick={() => { setEditingId(it.id); setAddingIn(null); }}>
                            {tc("edit")}
                          </button>{" "}
                          <button className="addnote" disabled={pending} onClick={() => remove(it)} style={{ color: "var(--bronze)" }}>
                            {t("itemsRemove")}
                          </button>
                        </td>
                      )}
                    </tr>
                  )
                )}
                <tr style={{ background: "var(--parchment)" }}>
                  <td>{t("subtotal")}</td>
                  <td colSpan={2}></td>
                  <td className="num">{money(rows.reduce((s, r) => s + Number(r.total_ht ?? 0), 0))}</td>
                  <td></td>
                  <td className="num"><b>{money(rows.reduce((s, r) => s + Number(r.total_ttc ?? r.total_ht ?? 0), 0))}</b></td>
                  {isTeam && <td />}
                </tr>
              </tbody>
            </table>
          </div>
          {isTeam && addingIn === event && (
            <div className="team-only" style={{ marginTop: 8 }}>
              <ItemForm
                lines={lines}
                envelopes={envelopes}
                pending={pending}
                onSave={(d) => save(d, event === t("noEvent") ? "" : event)}
                onCancel={() => setAddingIn(null)}
              />
            </div>
          )}
          {isTeam && addingIn !== event && (
            <button className="addnote team-only" style={{ marginTop: 8 }} onClick={() => { setAddingIn(event); setEditingId(null); setNewEvent(null); }}>
              + {t("itemsAdd")}
            </button>
          )}
        </div>
      ))}

      {isTeam && (
        <div className="card team-only">
          {newEvent === null ? (
            <button className="addnote" onClick={() => { setNewEvent(""); setAddingIn(null); setEditingId(null); }}>
              + {t("itemsAddEvent")}
            </button>
          ) : (
            <>
              <input
                value={newEvent}
                onChange={(e) => setNewEvent(e.target.value)}
                placeholder={t("itemsEventPh")}
                autoFocus
                style={{ marginBottom: 8, maxWidth: 340, display: "block" }}
                aria-label={t("itemsEventPh")}
              />
              <ItemForm
                lines={lines}
                envelopes={envelopes}
                pending={pending}
                onSave={(d) => save(d, newEvent)}
                onCancel={() => setNewEvent(null)}
              />
            </>
          )}
          <p style={{ fontSize: 12.5, color: "var(--ink2)", margin: "8px 0 0" }}>{t("itemsAuto")}</p>
          {word && <p role="status" style={{ fontSize: 12.5, color: "var(--bronze)", margin: "6px 0 0" }}>{word}</p>}
        </div>
      )}
    </>
  );
}

function ItemForm({
  lines,
  envelopes,
  initial,
  pending,
  onSave,
  onCancel
}: {
  lines: { id: string; label: string }[];
  envelopes: { id: string; label: string }[];
  initial?: ItemDraft;
  pending: boolean;
  onSave: (d: ItemDraft) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("budget.fiche");
  const tc = useTranslations("common");
  const [d, setD] = useState<ItemDraft>(
    initial ?? { label: "", qty: "", unit: "", ht: "", vat: "20", ttc: "", lineId: lines[0]?.id ?? "", env: "" }
  );
  const patch = (p: Partial<ItemDraft>) => setD((v) => ({ ...v, ...p }));

  // The sheet thinks with her: qty × unit → HT, HT × VAT → TTC —
  // shown as placeholders, never forced over a typed figure.
  const qty = numOrNull(d.qty);
  const unit = numOrNull(d.unit);
  const htAuto = qty != null && unit != null ? Math.round(qty * unit * 100) / 100 : null;
  const htShown = numOrNull(d.ht) ?? htAuto;
  const vat = numOrNull(d.vat) ?? 0;
  const ttcAuto = htShown != null ? Math.round(htShown * (1 + vat / 100) * 100) / 100 : null;

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", padding: "6px 0" }}>
      {lines.length > 1 && (
        <select value={d.lineId} onChange={(e) => patch({ lineId: e.target.value })} style={{ padding: "8px", border: "1px solid var(--line)", background: "#fff", maxWidth: 170 }} aria-label={t("itemsLine")}>
          {lines.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
        </select>
      )}
      <input value={d.label} onChange={(e) => patch({ label: e.target.value })} placeholder={t("item")} autoFocus={!initial} style={{ flex: "1 1 180px" }} aria-label={t("item")} />
      <input value={d.qty} onChange={(e) => patch({ qty: e.target.value })} placeholder={t("qty")} style={{ flex: "0 0 60px", textAlign: "right" }} aria-label={t("qty")} />
      <input value={d.unit} onChange={(e) => patch({ unit: e.target.value })} placeholder={t("unit")} style={{ flex: "0 0 84px", textAlign: "right" }} aria-label={t("unit")} />
      <input value={d.ht} onChange={(e) => patch({ ht: e.target.value })} placeholder={htAuto != null ? String(htAuto) : "HT"} style={{ flex: "0 0 90px", textAlign: "right" }} aria-label="HT" />
      <input value={d.vat} onChange={(e) => patch({ vat: e.target.value })} placeholder={t("vat")} style={{ flex: "0 0 56px", textAlign: "right" }} aria-label={t("vat")} />
      <input value={d.ttc} onChange={(e) => patch({ ttc: e.target.value })} placeholder={ttcAuto != null ? String(ttcAuto) : "TTC"} style={{ flex: "0 0 90px", textAlign: "right" }} aria-label="TTC" />
      {envelopes.length > 0 && (
        <select
          value={d.env}
          onChange={(e) => patch({ env: e.target.value })}
          aria-label={t("itemsCategory")}
          title={t("itemsCategory")}
          style={{ padding: "8px", border: "1px solid var(--line)", background: "#fff", fontSize: 12.5, maxWidth: 180 }}
        >
          <option value="">{t("itemsFollows")}</option>
          {envelopes.map((e2) => (
            <option key={e2.id} value={e2.id}>{e2.label}</option>
          ))}
        </select>
      )}
      <button className="btn ghost sm" disabled={pending || !d.label.trim() || !d.lineId} onClick={() => onSave(d)}>
        {pending ? "…" : tc("save")}
      </button>
      <button className="btn ghost sm" onClick={onCancel}>{tc("cancel")}</button>
    </div>
  );
}


/* ══════════ The vendor's card: métier and budget home ══════════ */

/**
 * Two distinct notions, by Estelle's word (2026-08-02): the métier
 * names the craft (Floral, Catering…) and stays editable after
 * creation; the budget category is where this vendor's engagements
 * live (migration 0019) — the home its new lines inherit.
 */
export function VendorMeta({
  weddingId,
  vendorId,
  category,
  envelopeId,
  envelopes
}: {
  weddingId: string;
  vendorId: string;
  category: string;
  envelopeId: string | null;
  envelopes: { id: string; label: string }[];
}) {
  const t = useTranslations("budget.fiche.meta");
  const router = useRouter();
  const [cat, setCat] = useState(category);
  const [env, setEnv] = useState(envelopeId ?? "");
  const [word, setWord] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="team-only" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", margin: "10px 0 4px" }}>
      <span className="eyebrow" style={{ marginRight: 4 }}>{t("title")}</span>
      <input
        value={cat}
        onChange={(e) => { setCat(e.target.value); setWord(null); }}
        aria-label={t("category")}
        style={{ flex: "0 1 160px", fontSize: 13 }}
      />
      <select
        value={env}
        onChange={(e) => { setEnv(e.target.value); setWord(null); }}
        aria-label={t("envelope")}
        style={{ padding: "8px", border: "1px solid var(--line)", background: "#fff", fontSize: 13, maxWidth: 220 }}
      >
        <option value="">{t("noEnvelope")}</option>
        {envelopes.map((e) => (
          <option key={e.id} value={e.id}>{e.label}</option>
        ))}
      </select>
      <button
        className="addnote"
        disabled={pending || !cat.trim()}
        onClick={() =>
          startTransition(async () => {
            const r = await updateVendorMeta(weddingId, vendorId, {
              category: cat,
              envelopeId: env || null
            });
            setWord(r.ok ? (r.envelopeSaved ? t("kept") : t("needs0019")) : null);
            router.refresh();
          })
        }
      >
        {pending ? "…" : t("keep")}
      </button>
      {word && <span role="status" style={{ fontSize: 12.5, color: "var(--bronze)" }}>{word}</span>}
      <span style={{ flexBasis: "100%", fontSize: 12, color: "var(--ink2)" }}>{t("hint")}</span>
    </div>
  );
}

/* ══════════ The vendor's papers, dropped where the vendor lives ══════ */

/**
 * A contract, a proposal, an invoice — dropped on the vendor's own
 * sheet (Estelle's ask: adding papers from the Vendors side was a
 * detour). Same reading door as everywhere: the analyst reads whole,
 * the reading lands as a proposal awaiting her word, the paper files
 * itself under this vendor.
 */
export function FicheDocDrop({ weddingId, vendorId }: { weddingId: string; vendorId: string }) {
  const t = useTranslations("budget.fiche.papers");
  const [word, setWord] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function handle(file: File) {
    if (busy) return;
    setBusy(true);
    setWord(t("reading"));
    try {
      const form = new FormData();
      form.append("weddingId", weddingId);
      form.append("vendorId", vendorId);
      form.append("file", file);
      const r = await fetch("/api/agents/document", { method: "POST", body: form });
      const d = await r.json();
      setWord(d.text ?? t("failed"));
      router.refresh();
    } catch {
      setWord(t("failed"));
    }
    setBusy(false);
  }

  return (
    <div style={{ marginTop: 10 }}>
      <label className="btn ghost sm" style={{ cursor: "pointer" }}>
        {busy ? "…" : t("drop")}
        <input
          type="file"
          hidden
          accept=".pdf,.png,.jpg,.jpeg,.webp"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handle(f);
            e.target.value = "";
          }}
        />
      </label>
      {word && (
        <p className="ia-quote" style={{ marginTop: 10, fontSize: 13.5 }} aria-live="polite">
          {word}
        </p>
      )}
    </div>
  );
}

/* ══════════ The vendor's departure — named, retyped, journaled ══════ */


/**
 * A destructive gesture wears the house's guards: the recap counts
 * exactly what leaves, the vendor's name is retyped by hand, and the
 * journal keeps the trace. Nothing here happens by accident.
 */
export function VendorDeparture({
  weddingId,
  vendorId,
  vendorName
}: {
  weddingId: string;
  vendorId: string;
  vendorName: string;
}) {
  const t = useTranslations("budget.fiche.departure");
  const router = useRouter();
  const [preview, setPreview] = useState<{
    lines: number; items: number; payments: number; papers: number; banking: boolean;
  } | null>(null);
  const [typed, setTyped] = useState("");
  const [pending, startTransition] = useTransition();

  if (!preview) {
    return (
      <div className="team-only" style={{ marginTop: 26, paddingTop: 14, borderTop: "1px solid var(--line)" }}>
        <button
          className="addnote"
          style={{ color: "var(--bronze)" }}
          onClick={() =>
            startTransition(async () => {
              const r = await previewVendorDeletion(weddingId, vendorId);
              if (r.ok) setPreview(r);
            })
          }
        >
          {pending ? "…" : t("open")}
        </button>
      </div>
    );
  }

  const recap = [
    preview.lines > 0 ? t("recapLines", { n: preview.lines }) : null,
    preview.items > 0 ? t("recapItems", { n: preview.items }) : null,
    preview.payments > 0 ? t("recapPayments", { n: preview.payments }) : null,
    preview.papers > 0 ? t("recapPapers", { n: preview.papers }) : null,
    preview.banking ? t("recapBanking") : null
  ].filter(Boolean);

  return (
    <div className="team-only" style={{ marginTop: 26, padding: "16px 18px", border: "1px solid var(--bronze)", background: "var(--parchment)" }}>
      <div className="eyebrow" style={{ color: "var(--bronze)" }}>{t("title")}</div>
      <p style={{ fontSize: 13.5, margin: "8px 0 4px" }}>
        {recap.length > 0 ? t("recapIntro") + " " + recap.join(" · ") + "." : t("recapNothing")}
      </p>
      <p style={{ fontSize: 12.5, color: "var(--ink2)", margin: "0 0 10px" }}>{t("finalNote")}</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={t("typePh", { name: vendorName })}
          aria-label={t("typePh", { name: vendorName })}
          style={{ flex: "1 1 240px", fontSize: 13 }}
        />
        <button
          className="btn sm"
          disabled={pending || typed.trim() !== vendorName}
          onClick={async () => {
            // The navigation leaves the transition: the gone page must
            // not swallow it with its own not-found rerender.
            const r = await deleteVendor(weddingId, vendorId);
            if (r.ok) {
              router.push("/vendors");
              router.refresh();
            }
          }}
        >
          {pending ? "…" : t("confirm")}
        </button>
        <button className="btn ghost sm" onClick={() => { setPreview(null); setTyped(""); }}>
          {t("keep")}
        </button>
      </div>
    </div>
  );
}
