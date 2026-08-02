/**
 * Home's aggregations (PRD Home) — pure, testable, and OWNING nothing:
 * every figure is derived on the fly from the canonical modules'
 * rows. Never invented (§6): no data, no number.
 */

export const HOME_SECTIONS = [
  "pulse",
  "next_milestone",
  "month",
  "ceremony",
  "budget",
  "design",
  "vendors",
  "communication",
  "recent",
  "priorities"
] as const;
export type HomeSection = (typeof HOME_SECTIONS)[number];

export interface HomeConfig {
  hidden?: string[];
  order?: string[];
}

/** The configured section order — unknown keys ignored, missing ones
    appended in the house's default order. */
export function sectionOrder(config: HomeConfig): HomeSection[] {
  const wanted = (config.order ?? []).filter((s): s is HomeSection =>
    (HOME_SECTIONS as readonly string[]).includes(s)
  );
  return [...wanted, ...HOME_SECTIONS.filter((s) => !wanted.includes(s))];
}

export function isHidden(config: HomeConfig, section: HomeSection): boolean {
  return (config.hidden ?? []).includes(section);
}

export function timelineProgress(milestones: { done: boolean }[]): {
  done: number;
  total: number;
  pct: number;
} {
  const done = milestones.filter((m) => m.done).length;
  const total = milestones.length;
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

/** attending / declined / pending, from person-event statuses (the
    Communication module's own truth — 'invited' reads as pending). */
export function rsvpAggregate(statuses: string[]): {
  attending: number;
  declined: number;
  pending: number;
  total: number;
} {
  let attending = 0;
  let declined = 0;
  let pending = 0;
  for (const s of statuses) {
    if (s === "attending") attending += 1;
    else if (s === "declined") declined += 1;
    else pending += 1;
  }
  return { attending, declined, pending, total: statuses.length };
}

/** The vendor pipeline folded into the four counts Home speaks (§12). */
export function vendorBuckets(stages: string[]): {
  total: number;
  contracted: number;
  selected: number;
  inReview: number;
  awaiting: number;
} {
  const out = { total: stages.length, contracted: 0, selected: 0, inReview: 0, awaiting: 0 };
  for (const s of stages) {
    if (s === "contracted" || s === "completed") out.contracted += 1;
    else if (s === "selected" || s === "shortlisted") out.selected += 1;
    else if (s === "in_review" || s === "proposal_received" || s === "proposal") out.inReview += 1;
    else out.awaiting += 1;
  }
  return out;
}

/** The couple's calm sentence (§6) — chosen, never invented. */
export function clientSentenceKey(openAttentions: number): "calm" | "one" | "several" {
  if (openAttentions <= 0) return "calm";
  return openAttentions === 1 ? "one" : "several";
}

export interface PriorityInput {
  overdueMilestones: number;
  ceremonyBlockers: number;
  overduePayments: number;
  vendorsInReview: number;
  boardsAwaiting: number;
  formsOpen: number;
  attentionsAwaiting: number;
}

export interface Priority {
  key: keyof PriorityInput;
  count: number;
  href: string;
}

/** Team priorities (§16) — computed from the sources, linking back to
    them; nothing is stored, nothing duplicated. */
export function teamPriorities(input: PriorityInput): Priority[] {
  const map: [keyof PriorityInput, string][] = [
    ["overdueMilestones", "/timeline"],
    ["overduePayments", "/budget"],
    ["ceremonyBlockers", "/ceremony"],
    ["attentionsAwaiting", "/timeline"],
    ["vendorsInReview", "/vendors"],
    ["boardsAwaiting", "/design"],
    ["formsOpen", "/forms"]
  ];
  return map
    .filter(([k]) => input[k] > 0)
    .map(([k, href]) => ({ key: k, count: input[k], href }));
}
