"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireHouseSession } from "@/lib/session";
import { logActivity } from "@/lib/activity";
import { revalidateRooms } from "@/lib/revalidate";
import { gmailReady } from "@/lib/gmail";
import { decryptProfile } from "@/lib/banking";
import {
  composeReminderLetter,
  remindersEmailEnabled,
  runRemindersTick,
  siteUrl,
  vendorBankingStates,
  type BankingState,
  type Disclosure,
  type LetterPayment,
  type TickSummary
} from "@/lib/reminders";

/**
 * The reminders desk (notifications brief, Part I) — every gesture
 * team-only, every lock server-side, graceful before migration 0018.
 */

async function teamSession() {
  const session = await requireHouseSession();
  if (!session.isTeam) throw new Error("team only");
  return session;
}

export interface ReminderRowUI {
  id: string;
  payment_id: string;
  offset_days: number | null;
  fixed_date: string | null;
  channel: "email" | "in_app" | "both";
  label: string | null;
  sent_at: string | null;
  created_by: string;
}

export interface SendRowUI {
  id: string;
  reminder_id: string;
  payment_id: string;
  channel: string;
  recipient: string;
  sent_on: string;
  status: "sent" | "failed" | "abandoned";
  attempt: number;
  error: string | null;
  subject: string | null;
  created_at: string;
}

export interface ReminderDefault {
  offset_days: number;
  channel: "email" | "in_app" | "both";
  label?: string;
}

export interface RemindersState {
  available: boolean;
  reminders: ReminderRowUI[];
  sends: SendRowUI[];
  defaults: ReminderDefault[];
  disclosure: Disclosure;
  senderName: string | null;
  replyTo: string | null;
  previewApprovedAt: string | null;
  previewApprovedBy: string | null;
  gmailConfigured: boolean;
  emailEnabled: boolean;
  lineStatusByPayment: Record<string, string | null>;
  bankingByPayment: Record<string, BankingState | null>;
}

const heldState = (): RemindersState => ({
  available: false,
  reminders: [],
  sends: [],
  defaults: [],
  disclosure: "link",
  senderName: null,
  replyTo: null,
  previewApprovedAt: null,
  previewApprovedBy: null,
  gmailConfigured: gmailReady(),
  emailEnabled: remindersEmailEnabled(),
  lineStatusByPayment: {},
  bankingByPayment: {}
});

export async function getRemindersState(weddingId: string): Promise<RemindersState> {
  await teamSession();
  const supabase = await createClient();

  const [{ data: reminders, error: rErr }, { data: w, error: wErr }] = await Promise.all([
    supabase
      .from("payment_reminders")
      .select("id, payment_id, offset_days, fixed_date, channel, label, sent_at, created_by")
      .eq("wedding_id", weddingId)
      .order("created_at", { ascending: true }),
    supabase
      .from("weddings")
      .select(
        "reminder_defaults, email_banking_disclosure, reminder_sender_name, reminder_reply_to, reminder_preview_approved_at, reminder_preview_approved_by"
      )
      .eq("id", weddingId)
      .single()
  ]);
  if (rErr || wErr) return heldState();

  const [{ data: sends }, { data: pays }] = await Promise.all([
    supabase
      .from("reminder_sends")
      .select("id, reminder_id, payment_id, channel, recipient, sent_on, status, attempt, error, subject, created_at")
      .eq("wedding_id", weddingId)
      .order("created_at", { ascending: false })
      .limit(60),
    supabase.from("payments").select("id, budget_line_id").eq("wedding_id", weddingId)
  ]);

  const lineIds = [...new Set((pays ?? []).map((p) => p.budget_line_id).filter(Boolean))] as string[];
  const { data: lineRows } = lineIds.length
    ? await supabase.from("budget_lines").select("id, status, vendor_id").in("id", lineIds)
    : { data: [] as { id: string; status: string; vendor_id: string | null }[] };
  const lines = new Map((lineRows ?? []).map((l) => [l.id, l]));
  const vendorIds = [...new Set((lineRows ?? []).map((l) => l.vendor_id).filter(Boolean))] as string[];
  const banking = await vendorBankingStates(supabase, vendorIds);

  const lineStatusByPayment: Record<string, string | null> = {};
  const bankingByPayment: Record<string, BankingState | null> = {};
  for (const p of pays ?? []) {
    const line = p.budget_line_id ? lines.get(p.budget_line_id) : undefined;
    lineStatusByPayment[p.id] = line?.status ?? null;
    bankingByPayment[p.id] = line?.vendor_id
      ? banking.get(line.vendor_id) ?? "unverified"
      : null;
  }

  return {
    available: true,
    reminders: (reminders ?? []) as ReminderRowUI[],
    sends: (sends ?? []) as SendRowUI[],
    defaults: Array.isArray(w?.reminder_defaults)
      ? (w.reminder_defaults as ReminderDefault[])
      : [],
    disclosure: (w?.email_banking_disclosure ?? "link") as Disclosure,
    senderName: w?.reminder_sender_name ?? null,
    replyTo: w?.reminder_reply_to ?? null,
    previewApprovedAt: w?.reminder_preview_approved_at ?? null,
    previewApprovedBy: w?.reminder_preview_approved_by ?? null,
    gmailConfigured: gmailReady(),
    emailEnabled: remindersEmailEnabled(),
    lineStatusByPayment,
    bankingByPayment
  };
}

export async function saveReminder(input: {
  weddingId: string;
  paymentId: string;
  offsetDays: number | null;
  fixedDate: string | null;
  channel: "email" | "in_app" | "both";
  label: string;
}) {
  const session = await teamSession();
  if (input.offsetDays == null && !input.fixedDate) return { ok: false as const };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("payment_reminders")
    .insert({
      wedding_id: input.weddingId,
      payment_id: input.paymentId,
      offset_days: input.offsetDays != null ? Math.trunc(input.offsetDays) : null,
      fixed_date: input.fixedDate || null,
      channel: input.channel,
      label: input.label.trim() || null,
      created_by: session.profile.full_name
    })
    .select("id")
    .single();
  if (error) return { ok: false as const, reason: "needs_migration" as const };
  revalidateRooms("budget");
  return { ok: true as const, id: data.id };
}

/** Removable at any moment, even once programmed (brief §1). */
export async function removeReminder(id: string, weddingId: string) {
  await teamSession();
  const supabase = await createClient();
  const { error } = await supabase
    .from("payment_reminders")
    .delete()
    .eq("id", id)
    .eq("wedding_id", weddingId);
  revalidateRooms("budget");
  return { ok: !error };
}

export async function saveReminderDefaults(weddingId: string, defaults: ReminderDefault[]) {
  const session = await teamSession();
  const supabase = await createClient();
  const clean = defaults
    .filter((d) => Number.isFinite(Number(d.offset_days)))
    .map((d) => ({
      offset_days: Math.trunc(Number(d.offset_days)),
      channel: ["email", "in_app", "both"].includes(d.channel) ? d.channel : "both",
      ...(d.label?.trim() ? { label: d.label.trim() } : {})
    }));
  const { error } = await supabase
    .from("weddings")
    .update({ reminder_defaults: clean })
    .eq("id", weddingId);
  if (error) return { ok: false as const, reason: "needs_migration" as const };
  await logActivity(supabase, weddingId, session.profile.full_name, "reminder_defaults_set", {
    defaults: clean
  });
  revalidateRooms("budget");
  return { ok: true as const };
}

/** The level is journaled with its date and who set it (brief §2, rule 3). */
export async function setBankingDisclosure(weddingId: string, level: Disclosure) {
  const session = await teamSession();
  if (!["link", "partial", "full"].includes(level)) return { ok: false as const };
  const supabase = await createClient();
  const { error } = await supabase
    .from("weddings")
    .update({ email_banking_disclosure: level })
    .eq("id", weddingId);
  if (error) return { ok: false as const, reason: "needs_migration" as const };
  await logActivity(supabase, weddingId, session.profile.full_name, "banking_disclosure_set", {
    level
  });
  revalidateRooms("budget");
  return { ok: true as const };
}

export async function setSenderIdentity(
  weddingId: string,
  input: { senderName: string; replyTo: string }
) {
  await teamSession();
  const supabase = await createClient();
  const { error } = await supabase
    .from("weddings")
    .update({
      reminder_sender_name: input.senderName.trim() || null,
      reminder_reply_to: input.replyTo.trim() || null
    })
    .eq("id", weddingId);
  if (error) return { ok: false as const, reason: "needs_migration" as const };
  revalidateRooms("budget");
  return { ok: true as const };
}

/**
 * The mandatory preview (brief §1): Estelle sees exactly what the
 * couple will receive — composed by the same hand that will send it.
 */
export async function previewReminderEmail(weddingId: string) {
  await teamSession();
  const supabase = await createClient();
  const { data: w, error } = await supabase
    .from("weddings")
    .select(
      "couple_display_name, default_locale, email_banking_disclosure, reminder_sender_name, reminder_reply_to"
    )
    .eq("id", weddingId)
    .single();
  if (error || !w) return { ok: false as const, reason: "needs_migration" as const };

  const { data: pays } = await supabase
    .from("payments")
    .select("id, label, amount, currency, due_date, budget_line_id, reveal_banking")
    .eq("wedding_id", weddingId)
    .is("paid_at", null)
    .order("due_date", { ascending: true })
    .limit(1);
  const p = pays?.[0];
  if (!p) return { ok: false as const, reason: "no_payments" as const };

  const disclosure = (w.email_banking_disclosure ?? "link") as Disclosure;
  let vendor: string | null = null;
  let banking: LetterPayment["banking"] = null;
  if (p.budget_line_id) {
    const { data: line } = await supabase
      .from("budget_lines")
      .select("vendor_id")
      .eq("id", p.budget_line_id)
      .maybeSingle();
    if (line?.vendor_id) {
      const { data: v } = await supabase
        .from("vendors")
        .select("name")
        .eq("id", line.vendor_id)
        .maybeSingle();
      vendor = v?.name ?? null;
      if (disclosure !== "link" && p.reveal_banking) {
        const { data: vb } = await supabase
          .from("vendor_banking")
          .select("enc")
          .eq("vendor_id", line.vendor_id)
          .maybeSingle();
        const profile = vb?.enc ? decryptProfile(vb.enc) : null;
        if (profile) {
          const acct = profile.account ?? {};
          const main = acct.iban ?? Object.values(acct)[0] ?? "";
          banking =
            disclosure === "partial"
              ? { last4: String(main).replace(/\s+/g, "").slice(-4) }
              : { profile };
        }
      }
    }
  }

  const senderName =
    w.reminder_sender_name || process.env.REMINDER_SENDER_NAME || "Madame Wedding Design";
  const letter = await composeReminderLetter({
    locale: w.default_locale || "en",
    couple: w.couple_display_name,
    senderName,
    disclosure,
    url: siteUrl(),
    payments: [
      {
        label: p.label,
        vendor,
        amount: Number(p.amount),
        currency: p.currency || "EUR",
        dueDate: p.due_date,
        banking
      }
    ]
  });
  return {
    ok: true as const,
    subject: letter.subject,
    text: letter.text,
    from: `${senderName} <${process.env.GMAIL_SENDER ?? "GMAIL_SENDER"}>`,
    replyTo: w.reminder_reply_to || process.env.REMINDER_REPLY_TO || null
  };
}

export async function approveReminderPreview(weddingId: string) {
  const session = await teamSession();
  const supabase = await createClient();
  const { error } = await supabase
    .from("weddings")
    .update({
      reminder_preview_approved_at: new Date().toISOString(),
      reminder_preview_approved_by: session.profile.full_name
    })
    .eq("id", weddingId);
  if (error) return { ok: false as const, reason: "needs_migration" as const };
  await logActivity(supabase, weddingId, session.profile.full_name, "reminder_preview_approved", {});
  revalidateRooms("budget");
  return { ok: true as const };
}

/** Out-of-calendar, one gesture — through the very same locks (§1). */
export async function sendReminderNow(
  weddingId: string,
  paymentId: string,
  channel: "email" | "in_app" | "both" = "both"
) {
  const session = await teamSession();
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  const { data: r, error } = await supabase
    .from("payment_reminders")
    .insert({
      wedding_id: weddingId,
      payment_id: paymentId,
      fixed_date: today,
      channel,
      label: null,
      created_by: session.profile.full_name
    })
    .select("id")
    .single();
  if (error || !r) return { ok: false as const, reason: "needs_migration" as const };

  const summary = await runRemindersTick(createAdminClient(), {
    weddingId,
    onlyReminderId: r.id,
    today
  });
  revalidateRooms("budget");
  return { ok: true as const, outcome: summary.outcomes[r.id] ?? "waiting", summary };
}

/** Estelle's hand on the day's pass — the scheduler, without waiting for it. */
export async function runRemindersNow(weddingId: string): Promise<TickSummary> {
  await teamSession();
  const summary = await runRemindersTick(createAdminClient(), { weddingId });
  revalidateRooms("budget");
  return summary;
}
