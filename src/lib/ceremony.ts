import type {
  Ceremony,
  CeremonyFlowItem,
  CeremonyLogistic,
  CeremonyMusic,
  CeremonyParticipant,
  CeremonyReading
} from "./types";

/**
 * The ceremony's deterministic readiness (PRD §16) — actual
 * completion, never an interpretation. Pure, testable, shared by the
 * page, the exports and Madame's counsel.
 */

export const READINESS_CHECKS = [
  "kind",
  "title",
  "date",
  "time",
  "place",
  "officiant",
  "flow",
  "duration",
  "participants",
  "music",
  "readings",
  "documents",
  "logistics",
  "plan_b"
] as const;
export type ReadinessCheck = (typeof READINESS_CHECKS)[number];

/** The house's defaults: what blocks a ceremony, what merely counsels. */
const DEFAULT_LEVEL: Record<ReadinessCheck, "required" | "optional"> = {
  kind: "required",
  title: "required",
  date: "required",
  time: "required",
  place: "required",
  officiant: "required",
  flow: "required",
  duration: "required",
  participants: "required",
  music: "optional",
  readings: "optional",
  documents: "optional",
  logistics: "optional",
  plan_b: "optional"
};

export interface CeremonySections {
  participants: Pick<CeremonyParticipant, "id">[];
  flow: Pick<CeremonyFlowItem, "id" | "archived" | "duration_min">[];
  music: Pick<CeremonyMusic, "id" | "archived">[];
  readings: Pick<CeremonyReading, "id" | "archived">[];
  logistics: Pick<CeremonyLogistic, "id" | "status">[];
  documents: { id: string }[];
}

/** Estimated total, from the active flow items alone (§8). */
export function flowDuration(flow: Pick<CeremonyFlowItem, "archived" | "duration_min">[]): number {
  return flow.filter((f) => !f.archived).reduce((s, f) => s + Number(f.duration_min ?? 0), 0);
}

export function checkDone(
  check: ReadinessCheck,
  c: Pick<Ceremony, "kind" | "title" | "ceremony_date" | "start_time" | "venue" | "officiant" | "duration_min" | "plan_b">,
  s: CeremonySections
): boolean {
  const activeFlow = s.flow.filter((f) => !f.archived);
  switch (check) {
    case "kind": return Boolean(c.kind?.trim());
    case "title": return Boolean(c.title?.trim());
    case "date": return Boolean(c.ceremony_date);
    case "time": return Boolean(c.start_time?.trim());
    case "place": return Boolean(c.venue?.trim());
    case "officiant": return Boolean(c.officiant?.trim());
    case "flow": return activeFlow.length > 0;
    case "duration": return Boolean(c.duration_min) || flowDuration(s.flow) > 0;
    case "participants": return s.participants.length > 0;
    case "music": return s.music.some((m) => !m.archived);
    case "readings": return s.readings.some((r) => !r.archived);
    case "documents": return s.documents.length > 0;
    case "logistics": return s.logistics.length > 0 && s.logistics.every((l) => l.status !== "open");
    case "plan_b": return Boolean(c.plan_b?.trim());
  }
}

export interface Readiness {
  done: number;
  missing: number;
  /** Required checks still open — these block. */
  blocking: ReadinessCheck[];
  /** Optional checks still open — mere counsel. */
  counsel: ReadinessCheck[];
  /** Of the checks that count (not marked n/a). */
  total: number;
}

export function ceremonyReadiness(
  c: Pick<Ceremony, "kind" | "title" | "ceremony_date" | "start_time" | "venue" | "officiant" | "duration_min" | "plan_b" | "checklist">,
  s: CeremonySections
): Readiness {
  const marks = c.checklist ?? {};
  const blocking: ReadinessCheck[] = [];
  const counsel: ReadinessCheck[] = [];
  let done = 0;
  let total = 0;
  for (const check of READINESS_CHECKS) {
    const level = marks[check] ?? DEFAULT_LEVEL[check];
    if (level === "na") continue;
    total += 1;
    if (checkDone(check, c, s)) done += 1;
    else (level === "required" ? blocking : counsel).push(check);
  }
  return { done, missing: total - done, blocking, counsel, total };
}

/** The suggested flow blocks (§8) — offered, never imposed. */
export const FLOW_BLOCKS = [
  "seating",
  "processional",
  "welcome",
  "opening",
  "reading",
  "ritual",
  "vows",
  "rings",
  "signing",
  "pronouncement",
  "kiss",
  "recessional",
  "other"
] as const;

export const MUSIC_SLOTS = [
  "prelude",
  "processional",
  "entrance",
  "interlude",
  "signing",
  "ritual",
  "recessional",
  "postlude",
  "other"
] as const;

export const PARTICIPANT_ROLES = [
  "couple",
  "officiant",
  "parent",
  "wedding_party",
  "reader",
  "witness",
  "ring_bearer",
  "flower_child",
  "musician",
  "singer",
  "interpreter",
  "other"
] as const;

export const DOCUMENT_ROLES = [
  "script",
  "vows",
  "reading",
  "music_list",
  "officiant_brief",
  "licence",
  "legal",
  "seating_plan",
  "technical_plan",
  "rain_plan",
  "programme",
  "other"
] as const;

/** The house's template: a classical flow to start from (§5). */
export const TEMPLATE_FLOW: { block_type: string; title: string; duration_min: number }[] = [
  { block_type: "seating", title: "Guest seating", duration_min: 15 },
  { block_type: "processional", title: "Processional", duration_min: 5 },
  { block_type: "welcome", title: "Welcome", duration_min: 3 },
  { block_type: "opening", title: "Opening words", duration_min: 5 },
  { block_type: "reading", title: "First reading", duration_min: 4 },
  { block_type: "vows", title: "Vows", duration_min: 8 },
  { block_type: "rings", title: "Ring exchange", duration_min: 4 },
  { block_type: "signing", title: "Signing", duration_min: 6 },
  { block_type: "pronouncement", title: "Pronouncement", duration_min: 2 },
  { block_type: "kiss", title: "The kiss", duration_min: 1 },
  { block_type: "recessional", title: "Recessional", duration_min: 5 }
];
