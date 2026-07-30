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
