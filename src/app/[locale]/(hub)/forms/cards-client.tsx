"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import type { FormRow, FormCategory } from "@/lib/types";
import {
  CTA_KEYS,
  FORM_PROVIDERS,
  FORM_STATUSES,
  SUGGESTED_CATEGORIES,
  canDeleteDraft,
  canPublish,
  coupleCanSee,
  duplicateUrlOf,
  isDueSoon,
  isInAppForm,
  isOpenStatus,
  statusBucket,
  validUrl
} from "@/lib/forms";
import { MomentLinks } from "@/components/moments-desk";
import {
  deleteFormDraft,
  duplicateFormCard,
  formHistory,
  importFormCards,
  markFormChecked,
  parseFormsImport,
  removeFormCover,
  reorderForms,
  saveFormCard,
  saveFormCategory,
  setCategoryArchived,
  setFormArchived,
  setFormCategory,
  setFormClientVisible,
  setFormStatus,
  uploadFormCover,
  type FormCardInput
} from "@/app/actions/forms";

const statusKey = (s: string) =>
  s === "in_progress" ? "inProgress" : s === "to_come" ? "toCome" : s;

const HISTORY_ACTIONS = new Set([
  "card_created", "card_updated", "card_duplicated", "status_changed",
  "category_changed", "cover_changed", "cover_removed", "archived",
  "restored", "hidden_from_client", "shown_to_client"
]);

function StatusTag({ status, t }: { status: string; t: (k: string) => string }) {
  const bucket = statusBucket(status);
  const cls = bucket === "done" ? "tag ok" : bucket === "open" ? "tag wait" : bucket === "internal" ? "tag int" : "tag";
  return <span className={cls}>{t(`statuses.${statusKey(status)}`)}</span>;
}

/**
 * The team's card desk (PRD Forms) — gallery first, list at hand,
 * every visible action working. The couple never receives this
 * component; their gallery is rendered on the server.
 */
export function FormsDesk({
  weddingId,
  forms,
  categories,
  covers
}: {
  weddingId: string;
  forms: FormRow[];
  categories: FormCategory[];
  covers: Record<string, string>;
}) {
  const t = useTranslations("forms");
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [asClient, setAsClient] = useState(false);
  const [listView, setListView] = useState(false);
  const [drawer, setDrawer] = useState<FormRow | "new" | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [catsOpen, setCatsOpen] = useState(false);
  const dragId = useRef<string | null>(null);

  const refresh = () => startTransition(() => router.refresh());
  const today = new Date().toISOString().slice(0, 10);
  const catName = new Map(categories.map((c) => [c.id, c.name]));

  const visible = useMemo(() => {
    let list = forms;
    if (asClient) return list.filter(coupleCanSee);
    if (!showArchived) list = list.filter((f) => !f.archived);
    if (catFilter === "none") list = list.filter((f) => !f.category_id);
    else if (catFilter) list = list.filter((f) => f.category_id === catFilter);
    if (statusFilter === "dueSoon") list = list.filter((f) => isDueSoon(f, today));
    else if (statusFilter === "clientVisible") list = list.filter(coupleCanSee);
    else if (statusFilter === "open") list = list.filter((f) => isOpenStatus(f.status));
    else if (statusFilter) list = list.filter((f) => f.status === statusFilter);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((f) =>
        [f.title, f.internal_title, f.description, f.status, f.category_id ? catName.get(f.category_id) : ""]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q))
      );
    }
    return list;
  }, [forms, asClient, showArchived, catFilter, statusFilter, search, today]); // eslint-disable-line react-hooks/exhaustive-deps

  const move = async (form: FormRow, where: "up" | "down" | "top" | "bottom") => {
    const ids = forms.filter((f) => !f.archived).map((f) => f.id);
    const i = ids.indexOf(form.id);
    if (i < 0) return;
    ids.splice(i, 1);
    const j = where === "top" ? 0 : where === "bottom" ? ids.length : where === "up" ? Math.max(0, i - 1) : Math.min(ids.length, i + 1);
    ids.splice(j, 0, form.id);
    await reorderForms(weddingId, ids);
    refresh();
  };

  const onDrop = async (targetId: string) => {
    const from = dragId.current;
    dragId.current = null;
    if (!from || from === targetId) return;
    const ids = forms.filter((f) => !f.archived).map((f) => f.id);
    const i = ids.indexOf(from);
    const j = ids.indexOf(targetId);
    if (i < 0 || j < 0) return;
    ids.splice(i, 1);
    ids.splice(j, 0, from);
    await reorderForms(weddingId, ids);
    refresh();
  };

  const duplicate = async (form: FormRow) => {
    // §18 — the URL question is asked, never assumed.
    const keep = form.external_url
      ? window.confirm(t("cards.duplicateAsk"))
      : false;
    const r = await duplicateFormCard(form.id, keep ? "keep" : "blank");
    if (r.ok) refresh();
  };

  const del = async (form: FormRow) => {
    if (!window.confirm(t("cards.deleteConfirm"))) return;
    const r = await deleteFormDraft(form.id);
    if (!r.ok) window.alert(t("cards.deleteRefused"));
    refresh();
  };

  const archive = async (form: FormRow, on: boolean) => {
    if (on && !window.confirm(t("cards.archiveConfirm"))) return;
    await setFormArchived(form.id, on);
    refresh();
  };

  const openExternal = async (form: FormRow) => {
    if (!validUrl(form.external_url)) {
      window.alert(t("cards.badUrl"));
      return;
    }
    void markFormChecked(form.id);
    window.open(form.external_url!, "_blank", "noopener,noreferrer");
  };

  const moveToCategory = async (form: FormRow, categoryId: string) => {
    await setFormCategory(form.id, categoryId || null);
    refresh();
  };

  return (
    <>
      {/* ── the action bar (§9) ── */}
      <div className="card" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "12px 16px" }}>
        <button className="btn sm" onClick={() => setDrawer("new")}>{t("cards.add")}</button>
        <button className="btn ghost sm" onClick={() => setCatsOpen((v) => !v)}>{t("categories.manage")}</button>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("cards.search")}
          style={{ flex: 1, minWidth: 140, fontSize: 13.5 }}
          aria-label={t("cards.search")}
        />
        <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} aria-label={t("categories.title")} style={{ fontSize: 13 }}>
          <option value="">{t("filters.allCategories")}</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
          <option value="none">{t("filters.noCategory")}</option>
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label={t("filters.status")} style={{ fontSize: 13 }}>
          <option value="">{t("filters.all")}</option>
          <option value="open">{t("filters.open")}</option>
          <option value="dueSoon">{t("filters.dueSoon")}</option>
          <option value="clientVisible">{t("filters.clientVisible")}</option>
          {[...FORM_STATUSES, "awaiting", "completed", "to_come"].map((s) => (
            <option key={s} value={s}>{t(`statuses.${statusKey(s)}`)}</option>
          ))}
        </select>
        {(search || catFilter || statusFilter) && (
          <button className="addnote" onClick={() => { setSearch(""); setCatFilter(""); setStatusFilter(""); }}>
            {t("filters.clear")}
          </button>
        )}
        <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 12.5 }}>
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} style={{ width: "auto" }} />
          {t("filters.showArchived")}
        </label>
        <button className="addnote" onClick={() => setListView((v) => !v)}>
          {listView ? t("cards.viewCards") : t("cards.viewList")}
        </button>
        <button className="addnote" onClick={() => setAsClient((v) => !v)}>
          {asClient ? t("cards.leavePreview") : t("cards.previewClient")}
        </button>
        <details style={{ position: "relative" }}>
          <summary className="addnote" style={{ listStyle: "none", cursor: "pointer" }}>{t("export.title")}</summary>
          <div className="card" style={{ position: "absolute", right: 0, zIndex: 30, minWidth: 220, display: "grid", gap: 6, padding: 12 }}>
            {(["directory", "active", "client", "submitted", "archived"] as const).map((kind) => (
              <span key={kind} style={{ display: "flex", gap: 8, alignItems: "baseline", fontSize: 13 }}>
                <span style={{ flex: 1 }}>{t(`export.${kind}`)}</span>
                <a className="addnote" href={`/api/form-exports?wedding=${weddingId}&kind=${kind}&format=xlsx`}>XLSX</a>
                <a className="addnote" href={`/api/form-exports?wedding=${weddingId}&kind=${kind}&format=csv`}>CSV</a>
                <a className="addnote" href={`/api/form-exports?wedding=${weddingId}&kind=${kind}&format=pdf`}>PDF</a>
              </span>
            ))}
            <span style={{ display: "flex", gap: 8, alignItems: "baseline", fontSize: 13 }}>
              <span style={{ flex: 1 }}>{t("export.filtered")}</span>
              <a className="addnote" href={`/api/form-exports?wedding=${weddingId}&kind=filtered&format=xlsx&ids=${visible.map((f) => f.id).join(",")}`}>XLSX</a>
              <a className="addnote" href={`/api/form-exports?wedding=${weddingId}&kind=filtered&format=csv&ids=${visible.map((f) => f.id).join(",")}`}>CSV</a>
            </span>
            <button className="addnote" onClick={() => setImportOpen(true)} style={{ textAlign: "left" }}>{t("import.open")}</button>
          </div>
        </details>
      </div>

      {catsOpen && <CategoriesDesk weddingId={weddingId} categories={categories} onDone={refresh} />}

      {/* ── empty states (§26) ── */}
      {forms.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: 32 }}>
          <p style={{ fontSize: 14, color: "var(--ink2)" }}>{t("cards.empty")}</p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 12, flexWrap: "wrap" }}>
            <button className="btn sm" onClick={() => setDrawer("new")}>{t("cards.addFirst")}</button>
            <button className="btn ghost sm" onClick={() => setCatsOpen(true)}>{t("categories.create")}</button>
          </div>
        </div>
      ) : visible.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: 24 }}>
          <p style={{ fontSize: 13.5, color: "var(--ink2)" }}>{t("filters.noMatch")}</p>
          <button className="addnote" onClick={() => { setSearch(""); setCatFilter(""); setStatusFilter(""); setShowArchived(false); }}>
            {t("filters.clear")}
          </button>
        </div>
      ) : listView && !asClient ? (
        /* ── the compact team list (§9) ── */
        <div className="card">
          <table className="sheet-table">
            <thead>
              <tr>
                <th>{t("form")}</th>
                <th>{t("categories.title")}</th>
                <th>{t("filters.status")}</th>
                <th>{t("cards.dueTh")}</th>
                <th aria-label={t("cards.actions")} />
              </tr>
            </thead>
            <tbody>
              {visible.map((f) => (
                <tr key={f.id} style={f.archived ? { opacity: 0.55 } : undefined}>
                  <td>
                    {f.title}
                    {f.internal_title && <span style={{ color: "var(--ink2)", fontSize: 12 }}> · {f.internal_title}</span>}
                  </td>
                  <td>{f.category_id ? catName.get(f.category_id) : "—"}</td>
                  <td><StatusTag status={f.status} t={t} /></td>
                  <td>{f.due_date ?? f.due_label ?? "—"}</td>
                  <td style={{ textAlign: "right" }}>
                    <button className="addnote" onClick={() => setDrawer(f)}>{t("cards.edit")}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        /* ── the gallery ── */
        <div className="planches">
          {visible.map((f) => (
            <div
              key={f.id}
              style={{ position: "relative" }}
              draggable={!asClient}
              onDragStart={() => { dragId.current = f.id; }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => void onDrop(f.id)}
            >
              <div className="planche" style={{ cursor: "default" }}>
                {/* Archived cards dim their face, never their menu — an
                    opacity on the wrapper would trap the dropdown below
                    the neighbouring cards' stacking order. */}
                <div className="visu" style={f.archived ? { opacity: 0.55 } : undefined}>
                  {covers[f.id] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={covers[f.id]} alt="" style={f.cover_focal ? { objectPosition: f.cover_focal } : undefined} />
                  ) : (
                    <span>{f.title}</span>
                  )}
                </div>
                <div className="body">
                  <h3 style={f.archived ? { color: "var(--ink2)" } : undefined}>{f.title}</h3>
                  {(f.description || f.category_id) && (
                    <div className="sub">
                      {[f.category_id ? catName.get(f.category_id) : null, f.description].filter(Boolean).join(" · ")}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
                    <StatusTag status={f.status} t={t} />
                    {!asClient && f.client_visible === false && <span className="tag int">{t("cards.hiddenTag")}</span>}
                    {!asClient && isDueSoon(f, today) && <span className="tag wait">{t("filters.dueSoon")}</span>}
                    {(f.due_date ?? f.due_label) && (
                      <span style={{ fontSize: 12, color: "var(--ink2)" }}>{f.due_date ?? f.due_label}</span>
                    )}
                  </div>
                  {asClient && f.note_client && (
                    <p style={{ fontSize: 12.5, color: "var(--ink2)", margin: "6px 0 0" }}>{f.note_client}</p>
                  )}
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
                    {f.external_url ? (
                      <button className="btn sm" onClick={() => void openExternal(f)}>{t("cta.open")}</button>
                    ) : isInAppForm(f) ? (
                      <span style={{ fontSize: 12, color: "var(--ink2)" }}>{t("cards.inApp")}</span>
                    ) : (
                      !asClient && <span style={{ fontSize: 12, color: "var(--bronze)" }}>{t("cards.noUrl")}</span>
                    )}
                    {!asClient && (
                      <details style={{ position: "relative", marginLeft: "auto" }}>
                        <summary className="addnote" style={{ listStyle: "none", cursor: "pointer" }}>{t("cards.actions")}</summary>
                        <div className="card" style={{ position: "absolute", right: 0, zIndex: 20, minWidth: 210, display: "grid", gap: 4, padding: 10 }}>
                          <button className="addnote" style={{ textAlign: "left" }} onClick={() => setDrawer(f)}>{t("cards.edit")}</button>
                          {f.external_url && (
                            <button
                              className="addnote"
                              style={{ textAlign: "left" }}
                              onClick={() => { void navigator.clipboard?.writeText(f.external_url!); }}
                            >
                              {t("cards.copyLink")}
                            </button>
                          )}
                          <button className="addnote" style={{ textAlign: "left" }} onClick={() => void duplicate(f)}>{t("cards.duplicate")}</button>
                          {categories.length > 0 && (
                            <label style={{ fontSize: 12.5, display: "grid", gap: 3 }}>
                              {t("cards.moveCategory")}
                              <select
                                value={f.category_id ?? ""}
                                onChange={(e) => void moveToCategory(f, e.target.value)}
                                style={{ fontSize: 12.5 }}
                              >
                                <option value="">{t("filters.noCategory")}</option>
                                {categories.map((c) => (
                                  <option key={c.id} value={c.id}>{c.name}</option>
                                ))}
                              </select>
                            </label>
                          )}
                          <label style={{ fontSize: 12.5, display: "grid", gap: 3 }}>
                            {t("filters.status")}
                            <select
                              value={f.status}
                              onChange={async (e) => { await setFormStatus(f.id, e.target.value); refresh(); }}
                              style={{ fontSize: 12.5 }}
                            >
                              {[...FORM_STATUSES, ...(["awaiting", "completed", "to_come"].includes(f.status) ? [f.status] : [])].map((s) => (
                                <option key={s} value={s}>{t(`statuses.${statusKey(s)}`)}</option>
                              ))}
                            </select>
                          </label>
                          <button
                            className="addnote"
                            style={{ textAlign: "left" }}
                            onClick={async () => { await setFormClientVisible(f.id, f.client_visible === false); refresh(); }}
                          >
                            {f.client_visible === false ? t("cards.showClient") : t("cards.hideClient")}
                          </button>
                          <span style={{ display: "flex", gap: 6 }}>
                            <button className="addnote" aria-label={t("cards.moveUp")} onClick={() => void move(f, "up")}>↑</button>
                            <button className="addnote" aria-label={t("cards.moveDown")} onClick={() => void move(f, "down")}>↓</button>
                            <button className="addnote" onClick={() => void move(f, "top")}>{t("cards.moveTop")}</button>
                            <button className="addnote" onClick={() => void move(f, "bottom")}>{t("cards.moveBottom")}</button>
                          </span>
                          {f.archived ? (
                            <button className="addnote" style={{ textAlign: "left" }} onClick={() => void archive(f, false)}>{t("cards.restore")}</button>
                          ) : (
                            <button className="addnote" style={{ textAlign: "left" }} onClick={() => void archive(f, true)}>{t("cards.archive")}</button>
                          )}
                          {canDeleteDraft(f) && (
                            <button className="addnote" style={{ textAlign: "left", color: "var(--bronze)" }} onClick={() => void del(f)}>
                              {t("cards.deleteDraft")}
                            </button>
                          )}
                        </div>
                      </details>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {drawer && (
        <FormDrawer
          weddingId={weddingId}
          form={drawer === "new" ? null : drawer}
          forms={forms}
          categories={categories}
          onClose={(changed) => { setDrawer(null); if (changed) refresh(); }}
        />
      )}
      {importOpen && (
        <ImportWizard weddingId={weddingId} onClose={(changed) => { setImportOpen(false); if (changed) refresh(); }} />
      )}
    </>
  );
}

/* ── categories (§6) ─────────────────────────────────────────────── */

function CategoriesDesk({
  weddingId,
  categories,
  onDone
}: {
  weddingId: string;
  categories: FormCategory[];
  onDone: () => void;
}) {
  const t = useTranslations("forms.categories");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!name.trim()) return;
    setBusy(true);
    const r = await saveFormCategory({ weddingId, name });
    setBusy(false);
    if (!r.ok && "needsMigration" in r) window.alert(t("needsMigration"));
    setName("");
    onDone();
  };

  return (
    <div className="card team-only">
      <div className="eyebrow" style={{ marginBottom: 10 }}>{t("title")}</div>
      {categories.map((c) => (
        <div key={c.id} style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "3px 0", fontSize: 13.5 }}>
          <span style={{ flex: 1 }}>{c.name}</span>
          <button
            className="addnote"
            onClick={async () => {
              const next = window.prompt(t("rename"), c.name);
              if (next?.trim()) { await saveFormCategory({ weddingId, id: c.id, name: next }); onDone(); }
            }}
          >
            {t("edit")}
          </button>
          <button className="addnote" onClick={async () => { await setCategoryArchived(c.id, true); onDone(); }}>
            {t("archive")}
          </button>
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void add(); }}
          placeholder={t("placeholder")}
          list="mwd-cat-suggestions"
          style={{ flex: 1, fontSize: 13.5 }}
        />
        <datalist id="mwd-cat-suggestions">
          {SUGGESTED_CATEGORIES.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <button className="btn ghost sm" disabled={busy || !name.trim()} onClick={() => void add()}>{t("add")}</button>
      </div>
    </div>
  );
}

/* ── the drawer (§10) ────────────────────────────────────────────── */

function FormDrawer({
  weddingId,
  form,
  forms,
  categories,
  onClose
}: {
  weddingId: string;
  form: FormRow | null;
  forms: FormRow[];
  categories: FormCategory[];
  onClose: (changed: boolean) => void;
}) {
  const t = useTranslations("forms");
  const [f, setF] = useState<FormCardInput>({
    weddingId,
    id: form?.id,
    title: form?.title ?? "",
    internal_title: form?.internal_title ?? "",
    category_id: form?.category_id ?? "",
    description: form?.description ?? "",
    provider: form?.provider ?? "dubsado",
    external_url: form?.external_url ?? "",
    cta_label: form?.cta_label ?? "",
    client_visible: form?.client_visible !== false,
    due_date: form?.due_date ?? "",
    note_internal: form?.note_internal ?? "",
    note_client: form?.note_client ?? "",
    cover_focal: form?.cover_focal ?? ""
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [historyRows, setHistoryRows] = useState<Awaited<ReturnType<typeof formHistory>> | null>(null);
  const [madameBusy, setMadameBusy] = useState(false);
  const set = <K extends keyof FormCardInput>(k: K, v: FormCardInput[K]) => setF((p) => ({ ...p, [k]: v }));

  const dupe = duplicateUrlOf(forms, f.external_url, form?.id);

  const save = async (publish: boolean) => {
    setError("");
    const status = publish
      ? "shared"
      : form && !["draft", "ready"].includes(form.status)
        ? form.status
        : "draft";
    if (publish) {
      const judged = canPublish({ id: "", title: f.title, status, external_url: f.external_url, schema: form?.schema });
      if (!judged.ok) { setError(t(`drawer.err_${judged.reason}`)); return; }
    } else if (!f.title.trim()) { setError(t("drawer.err_title")); return; }
    if (f.external_url && !validUrl(f.external_url)) { setError(t("drawer.err_url")); return; }
    setBusy(true);
    const r = await saveFormCard({ ...f, category_id: f.category_id || null, status });
    setBusy(false);
    if (!r.ok) { setError(t(`drawer.err_${r.reason ?? "save"}`)); return; }
    onClose(true);
  };

  const cover = async (file: File) => {
    if (!form?.id) return;
    setBusy(true);
    const fd = new FormData();
    fd.set("file", file);
    const r = await uploadFormCover(form.id, fd);
    setBusy(false);
    if (!r.ok) setError(t("drawer.err_cover"));
    else onClose(true);
  };

  const askMadame = async () => {
    setMadameBusy(true);
    try {
      const res = await fetch("/api/agents/form", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          weddingId,
          title: f.title,
          description: f.description,
          url: f.external_url,
          categories: categories.map((c) => c.name)
        })
      });
      const data = (await res.json()) as { title?: string; category?: string; description?: string };
      if (data.description) set("description", data.description);
      if (data.title && !f.title.trim()) set("title", data.title);
      if (data.category) {
        const match = categories.find((c) => c.name.toLowerCase() === data.category!.toLowerCase());
        if (match) set("category_id", match.id);
      }
    } catch {
      setError(t("drawer.err_madame"));
    }
    setMadameBusy(false);
  };

  return (
    <aside
      className="card"
      style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: "min(430px, 96vw)", zIndex: 60, overflowY: "auto", borderRadius: 0, padding: 22 }}
      aria-label={t(form ? "drawer.editTitle" : "drawer.addTitle")}
    >
      <div className="eyebrow" style={{ marginBottom: 12 }}>{t(form ? "drawer.editTitle" : "drawer.addTitle")}</div>
      <div style={{ display: "grid", gap: 10 }}>
        <label style={{ display: "grid", gap: 3, fontSize: 12.5 }}>
          {t("drawer.title")}
          <input value={f.title} onChange={(e) => set("title", e.target.value)} style={{ fontSize: 13.5 }} />
        </label>
        <label style={{ display: "grid", gap: 3, fontSize: 12.5 }}>
          {t("drawer.internalTitle")}
          <input value={f.internal_title ?? ""} onChange={(e) => set("internal_title", e.target.value)} style={{ fontSize: 13.5 }} />
        </label>
        <label style={{ display: "grid", gap: 3, fontSize: 12.5 }}>
          {t("categories.title")}
          <select value={f.category_id ?? ""} onChange={(e) => set("category_id", e.target.value)} style={{ fontSize: 13.5 }}>
            <option value="">{t("filters.noCategory")}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        <label style={{ display: "grid", gap: 3, fontSize: 12.5 }}>
          {t("drawer.description")}
          <textarea value={f.description ?? ""} onChange={(e) => set("description", e.target.value)} rows={2} style={{ fontSize: 13.5 }} />
        </label>
        <label style={{ display: "grid", gap: 3, fontSize: 12.5 }}>
          {t("drawer.url")}
          <input value={f.external_url ?? ""} onChange={(e) => set("external_url", e.target.value)} placeholder="https://…" style={{ fontSize: 13.5 }} />
        </label>
        {dupe && <p style={{ fontSize: 12.5, color: "var(--bronze)", margin: 0 }}>{t("drawer.dupeUrl", { title: dupe.title })}</p>}
        <label style={{ display: "grid", gap: 3, fontSize: 12.5 }}>
          {t("drawer.provider")}
          <select value={f.provider ?? "dubsado"} onChange={(e) => set("provider", e.target.value)} style={{ fontSize: 13.5 }}>
            {FORM_PROVIDERS.map((p) => (
              <option key={p} value={p}>{t(`providers.${p}`)}</option>
            ))}
          </select>
        </label>
        <label style={{ display: "grid", gap: 3, fontSize: 12.5 }}>
          {t("drawer.cta")}
          <select value={f.cta_label ?? ""} onChange={(e) => set("cta_label", e.target.value)} style={{ fontSize: 13.5 }}>
            <option value="">{t("drawer.ctaAuto")}</option>
            {CTA_KEYS.map((k) => (
              <option key={k} value={k}>{t(`cta.${k}`)}</option>
            ))}
          </select>
        </label>
        <label style={{ display: "grid", gap: 3, fontSize: 12.5 }}>
          {t("drawer.due")}
          <input type="date" value={f.due_date ?? ""} onChange={(e) => set("due_date", e.target.value)} style={{ fontSize: 13.5 }} />
        </label>
        <label style={{ display: "inline-flex", gap: 8, alignItems: "center", fontSize: 12.5 }}>
          <input type="checkbox" checked={f.client_visible !== false} onChange={(e) => set("client_visible", e.target.checked)} style={{ width: "auto" }} />
          {t("drawer.clientVisible")}
        </label>
        <label style={{ display: "grid", gap: 3, fontSize: 12.5 }}>
          {t("drawer.noteClient")}
          <textarea value={f.note_client ?? ""} onChange={(e) => set("note_client", e.target.value)} rows={2} style={{ fontSize: 13.5 }} />
        </label>
        <label style={{ display: "grid", gap: 3, fontSize: 12.5 }}>
          {t("drawer.noteInternal")} <span className="tag int">{t("drawer.internalTag")}</span>
          <textarea value={f.note_internal ?? ""} onChange={(e) => set("note_internal", e.target.value)} rows={2} style={{ fontSize: 13.5 }} />
        </label>

        {form?.id && (
          <div style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 12.5 }}>{t("drawer.cover")}</span>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => { const file = e.target.files?.[0]; if (file) void cover(file); e.target.value = ""; }}
                style={{ fontSize: 12.5 }}
              />
              {form.cover_path && (
                <button className="addnote" onClick={async () => { await removeFormCover(form.id); onClose(true); }}>
                  {t("drawer.removeCover")}
                </button>
              )}
            </div>
            <label style={{ display: "grid", gap: 3, fontSize: 12.5 }}>
              {t("drawer.focal")}
              <select value={f.cover_focal ?? ""} onChange={(e) => set("cover_focal", e.target.value)} style={{ fontSize: 13 }}>
                <option value="">{t("drawer.focalCenter")}</option>
                <option value="center top">{t("drawer.focalTop")}</option>
                <option value="center bottom">{t("drawer.focalBottom")}</option>
                <option value="left center">{t("drawer.focalLeft")}</option>
                <option value="right center">{t("drawer.focalRight")}</option>
              </select>
            </label>
          </div>
        )}

        {form?.id && <MomentLinks weddingId={weddingId} module="form" recordId={form.id} />}

        <button className="addnote team-only" disabled={madameBusy} onClick={() => void askMadame()} style={{ textAlign: "left" }}>
          {madameBusy ? "…" : t("drawer.madame")}
        </button>

        {form?.id && (
          <button
            className="addnote"
            style={{ textAlign: "left" }}
            onClick={async () => setHistoryRows(historyRows ? null : await formHistory(form.id))}
          >
            {t("drawer.history")}
          </button>
        )}
        {historyRows && (
          <div style={{ fontSize: 12, color: "var(--ink2)", display: "grid", gap: 4 }}>
            {historyRows.length === 0 && <span>{t("drawer.historyEmpty")}</span>}
            {historyRows.map((h, i) => (
              <span key={i}>
                {h.created_at?.slice(0, 10)} · {h.actor} · {HISTORY_ACTIONS.has(h.action) ? t(`history.${h.action}`) : h.action}
              </span>
            ))}
          </div>
        )}

        {error && <p role="alert" style={{ color: "var(--bronze)", fontSize: 13, margin: 0 }}>{error}</p>}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
          <button className="btn sm" disabled={busy} onClick={() => void save(false)}>{t("drawer.saveDraft")}</button>
          <button className="btn sm" disabled={busy} onClick={() => void save(true)}>{t("drawer.savePublish")}</button>
          <button className="btn ghost sm" onClick={() => onClose(false)}>{t("drawer.cancel")}</button>
        </div>
      </div>
    </aside>
  );
}

/* ── import (§25) ────────────────────────────────────────────────── */

const IMPORT_FIELDS = ["title", "category", "description", "external_url", "provider", "status", "due_date"] as const;

function ImportWizard({ weddingId, onClose }: { weddingId: string; onClose: (changed: boolean) => void }) {
  const t = useTranslations("forms.import");
  const [rows, setRows] = useState<Record<string, string>[] | null>(null);
  const [columns, setColumns] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ imported: number; skipped: number } | null>(null);

  const parse = async (fd: FormData) => {
    setBusy(true);
    const r = await parseFormsImport(fd);
    setBusy(false);
    if (!r.ok) return;
    setRows(r.rows);
    setColumns(r.columns);
    const auto: Record<string, string> = {};
    for (const field of IMPORT_FIELDS) {
      const hit = r.columns.find((c) => c.toLowerCase().replace(/[^a-z]/g, "").includes(field.replace("_", "")));
      if (hit) auto[field] = hit;
    }
    setMapping(auto);
  };

  const run = async () => {
    if (!rows || !mapping.title) return;
    setBusy(true);
    const r = await importFormCards(
      weddingId,
      rows.map((row) => ({
        title: row[mapping.title] ?? "",
        category: mapping.category ? row[mapping.category] : undefined,
        description: mapping.description ? row[mapping.description] : undefined,
        external_url: mapping.external_url ? row[mapping.external_url] : undefined,
        provider: mapping.provider ? row[mapping.provider] : undefined,
        status: mapping.status ? row[mapping.status] : undefined,
        due_date: mapping.due_date ? row[mapping.due_date] : undefined
      }))
    );
    setBusy(false);
    if (r.ok) setResult({ imported: r.imported, skipped: r.skipped });
  };

  return (
    <aside
      className="card"
      style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: "min(430px, 96vw)", zIndex: 60, overflowY: "auto", borderRadius: 0, padding: 22 }}
      aria-label={t("title")}
    >
      <div className="eyebrow" style={{ marginBottom: 12 }}>{t("title")}</div>
      {result ? (
        <div style={{ display: "grid", gap: 10 }}>
          <p style={{ fontSize: 13.5 }}>{t("done", { imported: result.imported, skipped: result.skipped })}</p>
          <button className="btn sm" onClick={() => onClose(true)}>{t("close")}</button>
        </div>
      ) : !rows ? (
        <div style={{ display: "grid", gap: 10 }}>
          <p style={{ fontSize: 13, color: "var(--ink2)" }}>{t("hint")}</p>
          <input
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={(e) => { const file = e.target.files?.[0]; if (file) { const fd = new FormData(); fd.set("file", file); void parse(fd); } e.target.value = ""; }}
            style={{ fontSize: 13 }}
          />
          {busy && <span style={{ fontSize: 12.5 }}>…</span>}
          <button className="btn ghost sm" onClick={() => onClose(false)}>{t("cancel")}</button>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          <p style={{ fontSize: 13 }}>{t("preview", { count: rows.length })}</p>
          {IMPORT_FIELDS.map((field) => (
            <label key={field} style={{ display: "grid", gap: 3, fontSize: 12.5 }}>
              {t(`fields.${field}`)}
              <select
                value={mapping[field] ?? ""}
                onChange={(e) => setMapping((m) => ({ ...m, [field]: e.target.value }))}
                style={{ fontSize: 13 }}
              >
                <option value="">—</option>
                {columns.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </label>
          ))}
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn sm" disabled={busy || !mapping.title} onClick={() => void run()}>{t("confirm")}</button>
            <button className="btn ghost sm" onClick={() => onClose(false)}>{t("cancel")}</button>
          </div>
        </div>
      )}
    </aside>
  );
}
