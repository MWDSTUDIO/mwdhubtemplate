/**
 * The budget's arithmetic, in one honest place (chiffres-visuels
 * brief). Every percentage shown to anyone must carry its named
 * denominator; every identity here is unit-tested — a broken one is
 * a data anomaly, said to the team and never to the couple (§6).
 */

export interface BudgetFigures {
  /** The couple's allotted budget. */
  total: number;
  /** Signed commitments — what the wedding really costs today. */
  committed: number;
  paid: number;
}

export interface BarModel {
  /** max(total, committed) — one scale serves both regimes (§3). */
  scale: number;
  paidPct: number;
  /** Committed, not yet paid. */
  stillToPayPct: number;
  /** Budget not yet committed (0 when overrun). */
  stillToEngagePct: number;
  /** Committed beyond the allotted budget (0 when within). */
  beyondPct: number;
  /** Where the allotted budget sits on the bar, 0–100. */
  markerPct: number;
  paid: number;
  stillToPay: number;
  stillToEngage: number;
  beyond: number;
}

export function barModel({ total, committed, paid }: BudgetFigures): BarModel {
  const safePaid = Math.max(0, Math.min(paid, committed));
  const stillToPay = Math.max(0, committed - safePaid);
  const stillToEngage = Math.max(0, total - committed);
  // With no allotted budget there is no line to cross — nothing is
  // "beyond", and the bar simply shows the committed whole.
  const beyond = total > 0 ? Math.max(0, committed - total) : 0;
  const scale = Math.max(total, committed, 1);
  const pct = (n: number) => (n / scale) * 100;
  return {
    scale,
    paidPct: pct(safePaid),
    stillToPayPct: pct(stillToPay),
    stillToEngagePct: pct(stillToEngage),
    beyondPct: pct(beyond),
    markerPct: pct(Math.min(total, scale)),
    paid: safePaid,
    stillToPay,
    stillToEngage,
    beyond
  };
}

/** A percentage whose denominator is the budget — null when unsayable. */
export function pctOfBudget(amount: number, total: number): number | null {
  if (!total || total <= 0) return null;
  return Math.round((amount / total) * 100);
}

/**
 * The three identities that must hold at all times (§6). A false one
 * is an anomaly of data, not a rounding — shown to the team alone.
 */
export function coherence(figures: BudgetFigures, envelopeSum: number) {
  const m = barModel(figures);
  const paidPlusDue = m.paid + m.stillToPay;
  const engagedPlusFree = figures.committed + m.stillToEngage;
  return {
    paidIdentity: Math.abs(paidPlusDue - Math.max(figures.committed, m.paid)) < 0.01,
    budgetIdentity:
      figures.committed >= figures.total ||
      Math.abs(engagedPlusFree - figures.total) < 0.01,
    envelopeIdentity: Math.abs(envelopeSum - figures.committed) < 1,
    envelopeGap: envelopeSum - figures.committed
  };
}

/* ══════════ Per-envelope committed, item overrides included (0020) ══ */

export interface EnvLineInput {
  id: string;
  envelope_id: string | null;
  parent_line_id?: string | null;
  /** EUR value per the fx rules (lineEurValues). */
  committedEur: number;
  converted: boolean;
}

export interface EnvItemInput {
  budget_line_id: string;
  /** Null — the default — follows the line's category (0020). */
  envelope_id?: string | null;
  ttc: number;
}

/**
 * One computation for every surface (scope, distribution, House Book):
 * lines count in their category; a post carrying its own category
 * (0020) moves its TTC there, the line keeping the rest. When the
 * moved posts exceed the line's committed (a divergence the ledger
 * already names), they scale down so the identity
 * Σ envelopes + beyond = Σ committed holds without exception.
 * Unconverted foreign lines stand apart entirely, overrides included.
 */
export function envelopeCommitted(
  lines: EnvLineInput[],
  items: EnvItemInput[]
): { byEnvelope: Record<string, number>; beyond: number } {
  const byEnvelope: Record<string, number> = {};
  let beyond = 0;
  const overridesByLine = new Map<string, EnvItemInput[]>();
  for (const it of items) {
    if (it.envelope_id) {
      overridesByLine.set(it.budget_line_id, [
        ...(overridesByLine.get(it.budget_line_id) ?? []),
        it
      ]);
    }
  }

  for (const l of lines) {
    if (!l.converted) continue;
    const isBeyondSource = !l.envelope_id && !l.parent_line_id;
    if (!l.envelope_id && !isBeyondSource) continue; // homeless child: as before
    const overrides = (overridesByLine.get(l.id) ?? []).filter(
      (it) => it.envelope_id !== l.envelope_id
    );
    const avail = Math.max(0, l.committedEur);
    const movedTotal = overrides.reduce((s, it) => s + Math.max(0, it.ttc), 0);
    const scale = movedTotal > avail && movedTotal > 0 ? avail / movedTotal : 1;
    let rest = l.committedEur;
    for (const it of overrides) {
      const amt = Math.max(0, it.ttc) * scale;
      byEnvelope[it.envelope_id!] = (byEnvelope[it.envelope_id!] ?? 0) + amt;
      rest -= amt;
    }
    if (l.envelope_id) {
      byEnvelope[l.envelope_id] = (byEnvelope[l.envelope_id] ?? 0) + rest;
    } else {
      beyond += rest;
    }
  }
  return { byEnvelope, beyond };
}
