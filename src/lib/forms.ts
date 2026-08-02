/**
 * Forms (PRD Forms) — pure rules for the card library. The Inner
 * House presents and tracks the cards; Dubsado (or another external
 * provider) keeps the questionnaire and the answers. Nothing here
 * pretends to know completion the provider never told us (§21).
 */

/** New statuses (§8) joined by the legacy three, which stay valid. */
export const FORM_STATUSES = [
  "draft",
  "ready",
  "shared",
  "in_progress",
  "submitted",
  "updated"
] as const;

export const LEGACY_STATUSES = ["awaiting", "completed", "to_come"] as const;

export type FormStatus = (typeof FORM_STATUSES)[number] | (typeof LEGACY_STATUSES)[number];

export const FORM_PROVIDERS = ["dubsado", "google_forms", "typeform", "other"] as const;

export const CTA_KEYS = ["open", "begin", "continue", "review", "update"] as const;

/** §6 — suggestions only; the team types anything it likes. */
export const SUGGESTED_CATEGORIES = [
  "Ceremony",
  "Photography",
  "Cinematography",
  "Design",
  "Floral",
  "Reception",
  "Rehearsal Dinner",
  "Food & Beverage",
  "Entertainment",
  "Music",
  "Guest Experience",
  "Logistics",
  "Family",
  "Wedding Weekend",
  "Other"
] as const;

export interface FormCard {
  id: string;
  title: string;
  status: string;
  client_visible?: boolean | null;
  archived?: boolean | null;
  external_url?: string | null;
  due_date?: string | null;
  category_id?: string | null;
  sort?: number | null;
  schema?: unknown;
}

/** Display buckets — legacy values fold into the new vocabulary. */
export function statusBucket(status: string): "internal" | "open" | "done" | "upcoming" {
  if (status === "draft" || status === "ready") return "internal";
  if (status === "awaiting" || status === "shared" || status === "in_progress") return "open";
  if (status === "completed" || status === "submitted" || status === "updated") return "done";
  return "upcoming"; // to_come
}

/** Home's read-only summary counts these as awaiting completion. */
export function isOpenStatus(status: string): boolean {
  return statusBucket(status) === "open";
}

/** §15 — what the couple may see. Mirrors the RLS policy exactly. */
export function coupleCanSee(f: FormCard): boolean {
  return (
    f.client_visible !== false &&
    !f.archived &&
    f.status !== "draft" &&
    f.status !== "ready"
  );
}

/** A legacy in-app questionnaire — kept working, filled in the house. */
export function isInAppForm(f: FormCard): boolean {
  return !f.external_url && Array.isArray(f.schema) && f.schema.length > 0;
}

export function validUrl(url: string | null | undefined): boolean {
  if (!url?.trim()) return false;
  try {
    const u = new URL(url.trim());
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

/** §10 — publishing to the couple needs a working door to knock on. */
export function canPublish(f: FormCard): { ok: boolean; reason?: "title" | "url" } {
  if (!f.title?.trim()) return { ok: false, reason: "title" };
  if (!validUrl(f.external_url) && !isInAppForm(f)) return { ok: false, reason: "url" };
  return { ok: true };
}

/** §10 — the same external door on two cards deserves a warning. */
export function duplicateUrlOf(
  forms: FormCard[],
  url: string | null | undefined,
  excludeId?: string
): FormCard | null {
  const clean = url?.trim().replace(/\/+$/, "").toLowerCase();
  if (!clean) return null;
  return (
    forms.find(
      (f) =>
        f.id !== excludeId &&
        f.external_url?.trim().replace(/\/+$/, "").toLowerCase() === clean
    ) ?? null
  );
}

export function isDueSoon(f: FormCard, today: string, horizonDays = 7): boolean {
  if (!f.due_date || !isOpenStatus(f.status)) return false;
  const due = new Date(f.due_date).getTime();
  const now = new Date(today).getTime();
  return due >= now && due - now <= horizonDays * 86_400_000;
}

/** Deletion is reserved for cards the couple has never seen (§17). */
export function canDeleteDraft(f: FormCard & { shared_at?: string | null }): boolean {
  return f.status === "draft" && !f.shared_at;
}

export interface ImportRow {
  title: string;
  category?: string;
  description?: string;
  external_url?: string;
  provider?: string;
  status?: string;
  client_visible?: boolean;
  due_date?: string;
}

/** §25 — one imported line judged: kept, or refused with a reason. */
export function validateImportRow(row: ImportRow): { ok: true; row: ImportRow } | { ok: false; reason: "title" | "url" | "status" } {
  if (!row.title?.trim()) return { ok: false, reason: "title" };
  if (row.external_url && !validUrl(row.external_url)) return { ok: false, reason: "url" };
  const allStatuses = [...FORM_STATUSES, ...LEGACY_STATUSES] as string[];
  if (row.status && !allStatuses.includes(row.status)) return { ok: false, reason: "status" };
  return { ok: true, row: { ...row, title: row.title.trim() } };
}

/** Cards in their kept order: category sort first, then card sort. */
export function orderCards<T extends FormCard>(
  cards: T[],
  categories: { id: string; sort: number }[]
): T[] {
  const catSort = new Map(categories.map((c) => [c.id, c.sort]));
  return [...cards].sort((a, b) => {
    const ca = a.category_id ? (catSort.get(a.category_id) ?? 999) : 1000;
    const cb = b.category_id ? (catSort.get(b.category_id) ?? 999) : 1000;
    if (ca !== cb) return ca - cb;
    return (a.sort ?? 0) - (b.sort ?? 0);
  });
}
