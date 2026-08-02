"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import type { DocumentRow } from "@/lib/types";
import { MomentLinks } from "@/components/moments-desk";
import {
  publishDocumentToCouple,
  removeDocument,
  withdrawDocument
} from "@/app/actions/documents";

const CATEGORY_ORDER = ["contracts", "proposals", "invoices", "design", "practical", "from_couple"];

const catOf = (d: DocumentRow) => {
  const c = d.category ?? "practical";
  return CATEGORY_ORDER.includes(c) ? c : "practical";
};

const extOf = (d: DocumentRow) => {
  const m = /\.([a-z0-9]{1,6})$/i.exec(d.storage_path ?? d.label);
  return m ? m[1].toUpperCase() : null;
};

const previewable = (d: DocumentRow) => {
  const e = (extOf(d) ?? "").toLowerCase();
  return ["pdf", "jpg", "jpeg", "png", "webp", "gif"].includes(e);
};

function sizeLabel(bytes: number | null | undefined): string | null {
  if (!bytes) return null;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Everything the house has placed in the couple's hands — grouped,
 * searchable, each paper one click from a true download. The couple
 * can also place a document in the house's hands; a person reads it,
 * never an agent.
 */
export function DocumentsRoom({
  documents,
  isTeam
}: {
  documents: DocumentRow[];
  isTeam: boolean;
}) {
  const t = useTranslations("documents");
  const format = useFormatter();
  const [needle, setNeedle] = useState("");
  const [preview, setPreview] = useState<DocumentRow | null>(null);

  const shared = documents.filter((d) => !d.internal);
  const filtered = useMemo(() => {
    const q = needle.trim().toLowerCase();
    return q ? shared.filter((d) => d.label.toLowerCase().includes(q)) : shared;
  }, [shared, needle]);

  const groups = CATEGORY_ORDER.map((c) => ({
    key: c,
    docs: filtered.filter((d) => catOf(d) === c)
  })).filter((g) => g.docs.length > 0);

  return (
    <>
      {shared.length > 0 && (
        <div className="field" style={{ maxWidth: 340, marginBottom: 18 }}>
          <label className="eyebrow" htmlFor="doc-search">{t("search")}</label>
          <input
            id="doc-search"
            value={needle}
            onChange={(e) => setNeedle(e.target.value)}
            placeholder={t("searchPh")}
          />
        </div>
      )}

      {shared.length === 0 && (
        <p className="lead" style={{ fontStyle: "italic" }}>{t("empty")}</p>
      )}

      {groups.map((g) => (
        <div className="card" key={g.key} style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div className="eyebrow">{t(`categories.${g.key}`)}</div>
            {g.docs.length > 1 && (
              <a className="addnote" href={`/api/documents/zip?category=${g.key}`}>
                {t("zipAll", { count: g.docs.length })}
              </a>
            )}
          </div>
          <ul className="doclist">
            {g.docs.map((d) => (
              <DocLine key={d.id} doc={d} isTeam={isTeam} onPreview={() => setPreview(d)} format={format} />
            ))}
          </ul>
        </div>
      ))}

      <TransmitBlock />

      {preview && (
        <div className="doc-viewer" role="dialog" aria-label={preview.label} onClick={() => setPreview(null)}>
          <div className="doc-viewer-frame" onClick={(e) => e.stopPropagation()}>
            <div className="doc-viewer-bar">
              <span style={{ fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{preview.label}</span>
              <span style={{ display: "flex", gap: 10, flexShrink: 0 }}>
                <a className="btn sm" href={`/api/documents/${preview.id}/download`}>{t("download")}</a>
                <button className="btn ghost sm" onClick={() => setPreview(null)}>{t("close")}</button>
              </span>
            </div>
            {(extOf(preview) ?? "").toLowerCase() === "pdf" ? (
              <iframe src={`/api/documents/${preview.id}/download?preview=1`} title={preview.label} />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/documents/${preview.id}/download?preview=1`} alt={preview.label} />
            )}
          </div>
        </div>
      )}
    </>
  );
}

function DocLine({
  doc,
  isTeam,
  onPreview,
  format
}: {
  doc: DocumentRow;
  isTeam: boolean;
  onPreview: () => void;
  format: ReturnType<typeof useFormatter>;
}) {
  const t = useTranslations("documents");
  const tm = useTranslations("moments");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [showMoments, setShowMoments] = useState(false);
  const ext = extOf(doc);
  const size = sizeLabel(doc.size_bytes);
  const date = doc.created_at
    ? format.dateTime(new Date(doc.created_at), { day: "numeric", month: "long", year: "numeric" })
    : null;

  return (
    <li className="docline">
      <a className="docline-main" href={`/api/documents/${doc.id}/download`}>
        <span className="docline-label">{doc.label}</span>
        <span className="docline-meta">
          {[ext, size, date && t("placed", { date })].filter(Boolean).join(" · ")}
        </span>
      </a>
      <span className="docline-actions">
        {previewable(doc) && (
          <button className="addnote" onClick={onPreview}>{t("preview")}</button>
        )}
        {isTeam && (
          <>
            <button className="addnote team-only" onClick={() => setShowMoments((v) => !v)}>
              {tm("related")}
            </button>
            <button
              className="addnote team-only"
              disabled={pending}
              onClick={() => {
                if (!window.confirm(t("withdrawConfirm", { label: doc.label }))) return;
                startTransition(async () => {
                  await withdrawDocument(doc.id);
                  router.refresh();
                });
              }}
            >
              {t("withdraw")}
            </button>
            <button
              className="addnote team-only"
              style={{ color: "var(--bronze)" }}
              disabled={pending}
              onClick={() => {
                if (!window.confirm(t("removeConfirm", { label: doc.label }))) return;
                startTransition(async () => {
                  await removeDocument(doc.id);
                  router.refresh();
                });
              }}
            >
              {t("remove")}
            </button>
          </>
        )}
      </span>
      {isTeam && showMoments && (
        <div style={{ width: "100%", padding: "4px 0 2px" }}>
          <MomentLinks weddingId={doc.wedding_id} module="document" recordId={doc.id} />
        </div>
      )}
    </li>
  );
}

/** The couple hands a paper to the house — stored, listed, the team told. */
function TransmitBlock() {
  const t = useTranslations("documents.transmit");
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState(false);

  async function handle(file: File) {
    setBusy(true);
    setDone(false);
    setFailed(false);
    try {
      const form = new FormData();
      form.append("file", file);
      const r = await fetch("/api/documents/transmit", { method: "POST", body: form });
      if (!r.ok) throw new Error("transmit");
      setDone(true);
      router.refresh();
    } catch {
      setFailed(true);
    }
    setBusy(false);
  }

  return (
    <div className="card" style={{ marginTop: 4 }}>
      <div className="eyebrow">{t("title")}</div>
      <p style={{ margin: "8px 0 12px", fontSize: 13.5, color: "var(--ink2)" }}>{t("blurb")}</p>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn ghost" disabled={busy} onClick={() => inputRef.current?.click()}>
          {busy ? "…" : t("choose")}
        </button>
        {done && <span style={{ fontSize: 12.5, color: "var(--bronze)" }}>{t("received")}</span>}
        {failed && <span style={{ fontSize: 12.5, color: "var(--bronze)" }}>{t("failed")}</span>}
      </div>
      <input
        ref={inputRef}
        type="file"
        hidden
        accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.xlsx,.xls,.csv,.docx,.doc,.txt"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handle(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

/** The internal register — team eyes, with the publish gesture per paper. */
export function InternalRegister({ documents }: { documents: DocumentRow[] }) {
  const t = useTranslations("documents");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  if (documents.length === 0) return null;

  return (
    <div className="card team-only" style={{ marginBottom: 14 }}>
      <div className="eyebrow">
        {t("internal")} <span className="tag int">{tc("internal")}</span>
      </div>
      <ul className="doclist">
        {documents.map((d) => (
          <li className="docline" key={d.id}>
            <a className="docline-main" href={`/api/documents/${d.id}/download`}>
              <span className="docline-label">{d.label}</span>
            </a>
            <span className="docline-actions">
              {d.storage_path && (
                <button
                  className="addnote"
                  disabled={pending && busyId === d.id}
                  onClick={() => {
                    if (!window.confirm(t("publishConfirm", { label: d.label }))) return;
                    setBusyId(d.id);
                    startTransition(async () => {
                      await publishDocumentToCouple(d.id, true);
                      setBusyId(null);
                      router.refresh();
                    });
                  }}
                >
                  {pending && busyId === d.id ? "…" : t("publish")}
                </button>
              )}
              <button
                className="addnote"
                style={{ color: "var(--bronze)" }}
                onClick={() => {
                  if (!window.confirm(t("removeConfirm", { label: d.label }))) return;
                  startTransition(async () => {
                    await removeDocument(d.id);
                    router.refresh();
                  });
                }}
              >
                {t("remove")}
              </button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
