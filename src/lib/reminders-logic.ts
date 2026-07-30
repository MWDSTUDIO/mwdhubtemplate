/**
 * The programmable reminders — the pure part (notifications brief §1).
 * When does a reminder fall due, and what holds it back. No I/O here:
 * these rules are tested on their own (tests/reminders.test.mjs).
 */

export type ReminderChannel = "email" | "in_app" | "both";

export interface ReminderShape {
  offset_days: number | null;
  fixed_date: string | null; // YYYY-MM-DD
}

/** Calendar arithmetic in UTC — a date, never a clock. */
export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The day a reminder falls: its fixed date when it has one, otherwise
 * the instalment's due date shifted by the offset (negative = before,
 * positive = after). Null when there is nothing to anchor to.
 */
export function reminderTargetDate(
  r: ReminderShape,
  dueDate: string | null
): string | null {
  if (r.fixed_date) return r.fixed_date;
  if (r.offset_days == null || !dueDate) return null;
  return addDays(dueDate, r.offset_days);
}

/** Due today — or overdue and never sent: a missed day still speaks once. */
export function isDue(target: string | null, today: string): boolean {
  return target != null && target <= today;
}

/** The channels a reminder asks for, expanded. */
export function reminderChannels(channel: ReminderChannel): ("email" | "in_app")[] {
  return channel === "both" ? ["email", "in_app"] : [channel];
}

/**
 * Why a due reminder does not leave (brief §1, the non-negotiables):
 *   settled       — the instalment is paid; remaining reminders are
 *                   cancelled, not sent.
 *   draft_line    — never on a draft; the couple has not been given
 *                   this figure.
 *   banking       — the vendor's coordinates are not `verified`, or a
 *                   change awaits verification: all reminders suspend.
 */
export type ReminderHold = "settled" | "draft_line" | "banking" | null;

export function reminderHold(input: {
  paidAt: string | null;
  lineStatus: string | null; // null = no line attached
  bankingState: "verified" | "unverified" | "changed" | null; // null = no vendor attached
}): ReminderHold {
  if (input.paidAt) return "settled";
  if (input.lineStatus === "draft") return "draft_line";
  if (input.bankingState != null && input.bankingState !== "verified") return "banking";
  return null;
}

/** Same-day sends to one recipient group into one message (brief §1). */
export function groupKey(weddingId: string, day: string): string {
  return `${weddingId}:${day}`;
}
