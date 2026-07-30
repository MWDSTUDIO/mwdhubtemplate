/**
 * The rounding rule, written once and applied everywhere
 * (application-financière brief §1.4):
 * — two decimals for every monetary amount;
 * — round half AWAY FROM ZERO;
 * — rounding applies to display and to a stored computed total,
 *   never between two steps of a calculation;
 * — never sum already-rounded values: sum exact, round the result.
 *
 * Amounts live in numeric columns and JS numbers only carry them for
 * display/rollups — never convert a stored amount to float storage.
 */

export function roundMoney(n: number): number {
  // JS Math.round sends -0.5 toward zero; money does not. And binary
  // floats store 1.005 as 1.00499…: a relative epsilon (far below any
  // half-cent) restores the decimal intent before rounding.
  const scaled = Math.abs(n) * 100 + Math.max(Number.EPSILON, Math.abs(n) * 1e-9);
  return ((Math.sign(n) || 1) * Math.round(scaled)) / 100;
}

/** Sum exact values, round once at the end (§1.4). */
export function sumMoney(values: (number | null | undefined)[]): number {
  return roundMoney(values.reduce((s: number, v) => s + Number(v ?? 0), 0));
}

/** A traced conversion: amount × rate, rounded once. */
export function convertMoney(amount: number, rate: number): number {
  return roundMoney(amount * rate);
}

/** A currency code the house will hold: exactly three letters. */
export function isCurrencyCode(s: string): boolean {
  return /^[A-Z]{3}$/.test(s);
}

export interface EurLine {
  currency?: string | null;
  committed?: number | null;
  committed_eur?: number | null;
  paid?: number | null;
}

/**
 * The EUR value of a line for totals (§1.1): EUR lines stand as they
 * are; a foreign line counts through its TRACED equivalent, or not at
 * all — never silently mixed. `converted: false` means the line must
 * be shown apart until a rate is held.
 */
export function lineEurValues(l: EurLine): {
  converted: boolean;
  committedEur: number;
  paidEur: number;
} {
  const cur = l.currency ?? "EUR";
  const committed = Number(l.committed ?? 0);
  const paid = Number(l.paid ?? 0);
  if (cur === "EUR") return { converted: true, committedEur: committed, paidEur: paid };
  if (l.committed_eur != null && committed !== 0) {
    const rate = Number(l.committed_eur) / committed;
    return { converted: true, committedEur: Number(l.committed_eur), paidEur: convertMoney(paid, rate) };
  }
  if (committed === 0 && paid === 0) return { converted: true, committedEur: 0, paidEur: 0 };
  return { converted: false, committedEur: 0, paidEur: 0 };
}
