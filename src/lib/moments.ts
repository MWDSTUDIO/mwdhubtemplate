/**
 * Wedding Moments (PRD Moments) — pure rules for the canonical
 * registry. The Desk's wedding_events rows ARE the registry: these
 * helpers never copy a moment, they only read, order, and judge.
 */

/** The canonical card IS the Desk's wedding_events row (0024 file). */
export interface Moment {
  id: string;
  wedding_id?: string;
  name: string;
  event_date: string | null;
  sort: number;
  start_time?: string | null;
  end_time?: string | null;
  venue?: string | null;
  event_type?: string | null;
  archived?: boolean | null;
}

/** §2 — type is optional, suggested, never a cage. */
export const MOMENT_KINDS = [
  "welcome",
  "rehearsal",
  "ceremony",
  "cocktail",
  "dinner",
  "reception",
  "brunch",
  "farewell",
  "other"
] as const;

/** The dropdowns speak only the living registry, in its kept order. */
export function activeMoments<T extends Moment>(moments: T[]): T[] {
  return moments
    .filter((m) => !m.archived)
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * §15 — a possible duplicate before a moment is born: same wedding,
 * similar name, or the same date with the same declared type. Never
 * merged, never deleted — only named, for the team to decide.
 */
export function findDuplicateMoment(
  moments: Moment[],
  candidate: { name: string; date?: string | null; kind?: string | null },
  excludeId?: string
): Moment | null {
  const name = norm(candidate.name);
  if (!name) return null;
  return (
    moments.find((m) => {
      if (m.id === excludeId || m.archived) return false;
      if (norm(m.name) === name) return true;
      if (
        candidate.date &&
        candidate.kind &&
        m.event_date === candidate.date &&
        m.event_type === candidate.kind
      )
        return true;
      return false;
    }) ?? null
  );
}

export interface MomentReferences {
  milestones: number;
  ceremonies: number;
  budgetLines: number;
  runSheets: number;
  guests: number;
  links: number;
}

export function totalReferences(refs: MomentReferences): number {
  return Object.values(refs).reduce((a, b) => a + b, 0);
}

/** §16 — delete is reserved for a moment nothing points at. */
export function canDeleteMoment(refs: MomentReferences): boolean {
  return totalReferences(refs) === 0;
}

/** §12 — Home's read-only sentence: the next moment on the calendar. */
export function nextMoment<T extends Moment>(moments: T[], today: string): T | null {
  return (
    activeMoments(moments)
      .filter((m) => m.event_date && m.event_date >= today)
      .sort((a, b) => (a.event_date! < b.event_date! ? -1 : 1))[0] ?? null
  );
}

/**
 * §17 — legacy text values (vendor quote items grouped by free event
 * labels) judged against the registry: mapped when exact, flagged
 * when ambiguous, left untouched when unknown. Never guessed.
 */
export function mapLegacyLabel(
  moments: Moment[],
  label: string
): { verdict: "mapped"; moment: Moment } | { verdict: "ambiguous"; candidates: Moment[] } | { verdict: "unmatched" } {
  const clean = norm(label);
  if (!clean) return { verdict: "unmatched" };
  const exact = moments.filter((m) => !m.archived && norm(m.name) === clean);
  if (exact.length === 1) return { verdict: "mapped", moment: exact[0] };
  if (exact.length > 1) return { verdict: "ambiguous", candidates: exact };
  const partial = moments.filter(
    (m) => !m.archived && (norm(m.name).includes(clean) || clean.includes(norm(m.name)))
  );
  if (partial.length === 1) return { verdict: "mapped", moment: partial[0] };
  if (partial.length > 1) return { verdict: "ambiguous", candidates: partial };
  return { verdict: "unmatched" };
}
