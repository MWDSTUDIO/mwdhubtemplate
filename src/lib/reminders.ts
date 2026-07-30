import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createTranslator } from "next-intl";
import { gmailReady, sendGmail } from "./gmail";
import { decryptProfile, type BankingProfile } from "./banking";
import { notifyCouple, notifyTeam } from "./notify";
import {
  groupKey,
  isDue,
  reminderChannels,
  reminderHold,
  reminderTargetDate
} from "./reminders-logic";

/**
 * The reminder engine (notifications brief, Part I). One pass a day —
 * or by Estelle's hand — over every unsent reminder, with the locks
 * applied server-side, the same-day sends grouped into one letter,
 * and every departure written to the ledger. A reminder that cannot
 * leave says why; a reminder that fails twice is abandoned aloud.
 */

export type Disclosure = "link" | "partial" | "full";
export type BankingState = "verified" | "unverified" | "changed";

const MAX_ATTEMPTS = 2;

export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || process.env.URL || "").replace(/\/$/, "");
}

export function remindersEmailEnabled(): boolean {
  return process.env.REMINDERS_ENABLED === "1";
}

interface ReminderRow {
  id: string;
  wedding_id: string;
  payment_id: string;
  offset_days: number | null;
  fixed_date: string | null;
  channel: "email" | "in_app" | "both";
  label: string | null;
  sent_at: string | null;
}

interface PaymentRow {
  id: string;
  wedding_id: string;
  label: string;
  amount: number;
  currency: string | null;
  due_date: string | null;
  paid_at: string | null;
  budget_line_id: string | null;
  reveal_banking: boolean | null;
}

interface WeddingRow {
  id: string;
  couple_display_name: string;
  default_locale: string;
  email_banking_disclosure: Disclosure;
  reminder_sender_name: string | null;
  reminder_reply_to: string | null;
  reminder_preview_approved_at: string | null;
}

export interface TickSummary {
  ok: boolean;
  reason?: "needs_migration";
  inApp: number;
  emails: number;
  failed: number;
  abandoned: number;
  waiting: number;
  held: { settled: number; draft: number; banking: number; preview: number; gmail: number };
  /** reminderId → what became of it this pass. */
  outcomes: Record<string, string>;
}

const emptySummary = (): TickSummary => ({
  ok: true,
  inApp: 0,
  emails: 0,
  failed: 0,
  abandoned: 0,
  waiting: 0,
  held: { settled: 0, draft: 0, banking: 0, preview: 0, gmail: 0 },
  outcomes: {}
});

/**
 * The wedding's default set, copied onto a fresh instalment. Silent
 * before migration 0018 — the instalment itself never depends on it.
 */
export async function applyReminderDefaults(
  supabase: SupabaseClient,
  weddingId: string,
  paymentId: string,
  actor = ""
) {
  try {
    const { data: w } = await supabase
      .from("weddings")
      .select("reminder_defaults")
      .eq("id", weddingId)
      .single();
    const defs = Array.isArray(w?.reminder_defaults) ? w.reminder_defaults : [];
    const rows = defs
      .filter((d) => Number.isFinite(Number(d?.offset_days)))
      .map((d) => ({
        wedding_id: weddingId,
        payment_id: paymentId,
        offset_days: Math.trunc(Number(d.offset_days)),
        channel: ["email", "in_app", "both"].includes(d?.channel) ? d.channel : "both",
        label: typeof d?.label === "string" && d.label.trim() ? d.label.trim() : null,
        created_by: actor
      }));
    if (rows.length) await supabase.from("payment_reminders").insert(rows);
  } catch {
    /* pre-0018: the desk is held, nothing breaks */
  }
}

/** verified · unverified · changed — per vendor, for the suspension lock. */
export async function vendorBankingStates(
  supabase: SupabaseClient,
  vendorIds: string[]
): Promise<Map<string, BankingState>> {
  const map = new Map<string, BankingState>();
  if (!vendorIds.length) return map;
  try {
    const { data } = await supabase
      .from("vendor_banking")
      .select("vendor_id, status, pending_fingerprint")
      .in("vendor_id", vendorIds);
    for (const r of data ?? []) {
      map.set(
        r.vendor_id,
        r.pending_fingerprint ? "changed" : r.status === "verified" ? "verified" : "unverified"
      );
    }
  } catch {
    /* pre-0016: no verification column — nothing counts as verified */
  }
  return map;
}

export interface LetterPayment {
  label: string;
  vendor: string | null;
  amount: number;
  currency: string;
  dueDate: string | null;
  /** Only present when the level allows it AND the hub reveals it. */
  banking: { last4?: string; profile?: BankingProfile } | null;
}

/**
 * The letter itself — composed in the wedding's own language, one
 * message even when several instalments fall the same day, the
 * invariable warning line at every level (brief §2).
 */
export async function composeReminderLetter(opts: {
  locale: string;
  couple: string;
  senderName: string;
  disclosure: Disclosure;
  url: string;
  payments: LetterPayment[];
}): Promise<{ subject: string; text: string }> {
  const messages = (await import(`../../messages/${opts.locale}.json`)).default;
  const t = createTranslator({ locale: opts.locale, messages, namespace: "reminderEmail" });
  const dateFmt = new Intl.DateTimeFormat(opts.locale, {
    day: "numeric",
    month: "long",
    year: "numeric"
  });
  const moneyFmt = (amount: number, currency: string) =>
    new Intl.NumberFormat(opts.locale, { style: "currency", currency }).format(amount);

  const subject =
    opts.payments.length === 1
      ? t("subject", { label: opts.payments[0].label })
      : t("subjectMany", { count: opts.payments.length });

  const blocks = opts.payments.map((p) => {
    const lines: string[] = [];
    lines.push(`• ${p.label}${p.vendor ? ` — ${p.vendor}` : ""}`);
    lines.push(
      `  ${
        p.dueDate
          ? t("lineAmount", {
              amount: moneyFmt(p.amount, p.currency),
              date: dateFmt.format(new Date(`${p.dueDate}T12:00:00`))
            })
          : moneyFmt(p.amount, p.currency)
      }`
    );
    if (opts.disclosure === "partial" && p.banking?.last4) {
      lines.push(`  ${t("partialLine", { last4: p.banking.last4 })}`);
    }
    if (opts.disclosure === "full" && p.banking?.profile) {
      const prof = p.banking.profile;
      if (prof.beneficiary?.legal_name)
        lines.push(`  ${t("fullBeneficiary")}: ${prof.beneficiary.legal_name}`);
      for (const [k, v] of Object.entries(prof.account ?? {})) {
        lines.push(`  ${k.toUpperCase()}: ${v}`);
      }
      if (prof.bank?.name) lines.push(`  ${t("fullBank")}: ${prof.bank.name}`);
      if (prof.terms?.payment_reference)
        lines.push(`  ${t("fullReference")}: ${prof.terms.payment_reference}`);
    }
    return lines.join("\n");
  });

  const text = [
    t("greeting", { couple: opts.couple }),
    "",
    opts.payments.length === 1 ? t("intro") : t("introMany"),
    "",
    blocks.join("\n\n"),
    "",
    opts.url ? t("hubLine", { url: `${opts.url}/budget` }) : null,
    "",
    t("warning"),
    "",
    t("signoff"),
    opts.senderName
  ]
    .filter((l) => l !== null)
    .join("\n");

  return { subject, text };
}

async function coupleEmails(admin: SupabaseClient, weddingId: string): Promise<string[]> {
  const { data: members } = await admin
    .from("wedding_members")
    .select("profile_id")
    .eq("wedding_id", weddingId)
    .eq("relation", "couple");
  const emails: string[] = [];
  for (const m of members ?? []) {
    const { data: u } = await admin.auth.admin.getUserById(m.profile_id);
    if (u?.user?.email) emails.push(u.user.email);
  }
  return emails;
}

/**
 * One pass. `weddingId` narrows to a single wedding (Estelle's hand);
 * `onlyReminderId` narrows to one reminder (send-now).
 */
export async function runRemindersTick(
  admin: SupabaseClient,
  opts: { weddingId?: string; onlyReminderId?: string; today?: string } = {}
): Promise<TickSummary> {
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const summary = emptySummary();

  let q = admin.from("payment_reminders").select("*").is("sent_at", null);
  if (opts.weddingId) q = q.eq("wedding_id", opts.weddingId);
  if (opts.onlyReminderId) q = q.eq("id", opts.onlyReminderId);
  const { data: reminderRows, error } = await q;
  if (error) return { ...summary, ok: false, reason: "needs_migration" };
  const reminders = (reminderRows ?? []) as ReminderRow[];
  if (!reminders.length) return summary;

  const payIds = [...new Set(reminders.map((r) => r.payment_id))];
  const { data: payRows } = await admin
    .from("payments")
    .select("id, wedding_id, label, amount, currency, due_date, paid_at, budget_line_id, reveal_banking")
    .in("id", payIds);
  const payments = new Map((payRows ?? []).map((p) => [p.id, p as PaymentRow]));

  const lineIds = [...new Set((payRows ?? []).map((p) => p.budget_line_id).filter(Boolean))] as string[];
  const { data: lineRows } = lineIds.length
    ? await admin.from("budget_lines").select("id, status, vendor_id").in("id", lineIds)
    : { data: [] as { id: string; status: string; vendor_id: string | null }[] };
  const lines = new Map((lineRows ?? []).map((l) => [l.id, l]));

  const vendorIds = [...new Set((lineRows ?? []).map((l) => l.vendor_id).filter(Boolean))] as string[];
  const bankingStates = await vendorBankingStates(admin, vendorIds);
  const { data: vendorRows } = vendorIds.length
    ? await admin.from("vendors").select("id, name").in("id", vendorIds)
    : { data: [] as { id: string; name: string }[] };
  const vendorNames = new Map((vendorRows ?? []).map((v) => [v.id, v.name]));

  const weddingIds = [...new Set(reminders.map((r) => r.wedding_id))];
  const { data: weddingRows } = await admin
    .from("weddings")
    .select(
      "id, couple_display_name, default_locale, email_banking_disclosure, reminder_sender_name, reminder_reply_to, reminder_preview_approved_at"
    )
    .in("id", weddingIds);
  const weddings = new Map((weddingRows ?? []).map((w) => [w.id, w as WeddingRow]));

  const { data: historyRows } = await admin
    .from("reminder_sends")
    .select("reminder_id, payment_id, channel, status, rfc822_message_id, gmail_thread_id, created_at")
    .in("reminder_id", reminders.map((r) => r.id));
  const history = historyRows ?? [];
  const sentChannels = new Map<string, Set<string>>();
  const failCount = new Map<string, number>();
  const abandoned = new Set<string>();
  for (const h of history) {
    if (h.status === "sent") {
      if (!sentChannels.has(h.reminder_id)) sentChannels.set(h.reminder_id, new Set());
      sentChannels.get(h.reminder_id)!.add(h.channel);
    }
    if (h.status === "failed") failCount.set(h.reminder_id, (failCount.get(h.reminder_id) ?? 0) + 1);
    if (h.status === "abandoned") abandoned.add(h.reminder_id);
  }

  // Threading: the last letter that spoke of each instalment.
  const { data: lastEmailRows } = await admin
    .from("reminder_sends")
    .select("payment_id, rfc822_message_id, gmail_thread_id, created_at")
    .in("payment_id", payIds)
    .eq("channel", "email")
    .eq("status", "sent")
    .order("created_at", { ascending: false });
  const lastThread = new Map<string, { messageId: string | null; threadId: string | null }>();
  for (const s of lastEmailRows ?? []) {
    if (!lastThread.has(s.payment_id)) {
      lastThread.set(s.payment_id, { messageId: s.rfc822_message_id, threadId: s.gmail_thread_id });
    }
  }

  // ── partition: what is due, what holds, what waits ────────────────
  type Due = { r: ReminderRow; p: PaymentRow; channels: ("email" | "in_app")[] };
  const dueByWedding = new Map<string, Due[]>();

  for (const r of reminders) {
    const p = payments.get(r.payment_id);
    if (!p) continue;
    if (abandoned.has(r.id)) {
      summary.outcomes[r.id] = "abandoned";
      continue;
    }
    const target = reminderTargetDate(r, p.due_date);
    if (!isDue(target, today)) {
      summary.waiting += 1;
      summary.outcomes[r.id] = "waiting";
      continue;
    }
    const line = p.budget_line_id ? lines.get(p.budget_line_id) : undefined;
    const hold = reminderHold({
      paidAt: p.paid_at,
      lineStatus: line?.status ?? null,
      bankingState: line?.vendor_id ? bankingStates.get(line.vendor_id) ?? "unverified" : null
    });
    if (hold === "settled") {
      summary.held.settled += 1;
      summary.outcomes[r.id] = "settled";
      continue;
    }
    if (hold === "draft_line") {
      summary.held.draft += 1;
      summary.outcomes[r.id] = "draft_line";
      continue;
    }
    if (hold === "banking") {
      summary.held.banking += 1;
      summary.outcomes[r.id] = "banking";
      continue;
    }
    const already = sentChannels.get(r.id) ?? new Set<string>();
    const channels = reminderChannels(r.channel).filter((c) => !already.has(c));
    if (!channels.length) continue;
    if (!dueByWedding.has(r.wedding_id)) dueByWedding.set(r.wedding_id, []);
    dueByWedding.get(r.wedding_id)!.push({ r, p, channels });
  }

  // ── per wedding: one in-app word, one letter ──────────────────────
  for (const [weddingId, due] of dueByWedding) {
    const w = weddings.get(weddingId);
    if (!w) continue;
    const locale = w.default_locale || "en";
    const messages = (await import(`../../messages/${locale}.json`)).default;
    const t = createTranslator({ locale, messages, namespace: "reminderEmail" });
    const gkey = groupKey(weddingId, today);
    const newlySent = new Map<string, Set<string>>();
    const markSent = (id: string, c: string) => {
      if (!newlySent.has(id)) newlySent.set(id, new Set());
      newlySent.get(id)!.add(c);
    };

    // In-app: one grouped notification, never two the same day.
    const inAppDue = due.filter((d) => d.channels.includes("in_app"));
    if (inAppDue.length) {
      const labels = [...new Set(inAppDue.map((d) => d.p.label))];
      await notifyCouple(weddingId, {
        kind: "payment_reminder",
        // Counted on the instalments, not the reminders: two reminders
        // falling the same day on one instalment are still one word.
        title: labels.length === 1 ? t("inAppTitle") : t("inAppTitleMany", { count: labels.length }),
        body: labels.join(" · "),
        url: "/budget"
      });
      await admin.from("reminder_sends").insert(
        inAppDue.map((d) => ({
          wedding_id: weddingId,
          reminder_id: d.r.id,
          payment_id: d.p.id,
          channel: "in_app",
          recipient: "in_app",
          sent_on: today,
          status: "sent",
          group_key: gkey
        }))
      );
      for (const d of inAppDue) {
        markSent(d.r.id, "in_app");
        summary.inApp += 1;
        summary.outcomes[d.r.id] = "in_app";
      }
    }

    // Email: preview approved, box wired — else held, said plainly.
    const emailDue = due.filter((d) => d.channels.includes("email"));
    if (emailDue.length) {
      if (!w.reminder_preview_approved_at) {
        summary.held.preview += emailDue.length;
        for (const d of emailDue) summary.outcomes[d.r.id] = summary.outcomes[d.r.id] ?? "held_preview";
      } else if (!gmailReady()) {
        summary.held.gmail += emailDue.length;
        for (const d of emailDue) summary.outcomes[d.r.id] = summary.outcomes[d.r.id] ?? "held_gmail";
      } else {
        const recipients = await coupleEmails(admin, weddingId);
        const disclosure = (w.email_banking_disclosure ?? "link") as Disclosure;
        const uniquePayments = [...new Map(emailDue.map((d) => [d.p.id, d.p])).values()];

        const letterPayments: LetterPayment[] = [];
        for (const p of uniquePayments) {
          const line = p.budget_line_id ? lines.get(p.budget_line_id) : undefined;
          let banking: LetterPayment["banking"] = null;
          // The hub stays the single legitimate place: coordinates
          // enter a letter only where the hub itself reveals them.
          if (disclosure !== "link" && p.reveal_banking && line?.vendor_id) {
            const { data: vb } = await admin
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
          letterPayments.push({
            label: p.label,
            vendor: line?.vendor_id ? vendorNames.get(line.vendor_id) ?? null : null,
            amount: Number(p.amount),
            currency: p.currency || "EUR",
            dueDate: p.due_date,
            banking
          });
        }

        const senderName =
          w.reminder_sender_name || process.env.REMINDER_SENDER_NAME || "Madame Wedding Design";
        const letter = await composeReminderLetter({
          locale,
          couple: w.couple_display_name,
          senderName,
          disclosure,
          url: siteUrl(),
          payments: letterPayments
        });

        // Successive words on one instalment join the same thread.
        const threads = uniquePayments
          .map((p) => lastThread.get(p.id))
          .filter(Boolean) as { messageId: string | null; threadId: string | null }[];
        const sameThread =
          threads.length &&
          threads.every((th) => th.threadId && th.threadId === threads[0].threadId)
            ? threads[0]
            : uniquePayments.length === 1
              ? lastThread.get(uniquePayments[0].id)
              : undefined;

        const result = recipients.length
          ? await sendGmail({
              to: recipients,
              subject: letter.subject,
              text: letter.text,
              senderName,
              replyTo: w.reminder_reply_to || process.env.REMINDER_REPLY_TO || undefined,
              inReplyTo: sameThread?.messageId ?? undefined,
              references: sameThread?.messageId ? [sameThread.messageId] : undefined,
              threadId: sameThread?.threadId ?? undefined
            })
          : ({ ok: false, error: "no couple address on file" } as const);

        if (result.ok) {
          await admin.from("reminder_sends").insert(
            emailDue.map((d) => ({
              wedding_id: weddingId,
              reminder_id: d.r.id,
              payment_id: d.p.id,
              channel: "email",
              recipient: recipients.join(", "),
              sent_on: today,
              status: "sent",
              subject: letter.subject,
              group_key: gkey,
              gmail_message_id: result.id,
              gmail_thread_id: result.threadId,
              rfc822_message_id: result.messageId
            }))
          );
          for (const d of emailDue) {
            markSent(d.r.id, "email");
            summary.emails += 1;
            summary.outcomes[d.r.id] = "emailed";
          }
        } else {
          // The failure the brief insists on: recorded, retried once,
          // then abandoned aloud — never a silent nothing.
          for (const d of emailDue) {
            const attempt = (failCount.get(d.r.id) ?? 0) + 1;
            const final = attempt >= MAX_ATTEMPTS;
            await admin.from("reminder_sends").insert({
              wedding_id: weddingId,
              reminder_id: d.r.id,
              payment_id: d.p.id,
              channel: "email",
              recipient: recipients.join(", "),
              sent_on: today,
              status: final ? "abandoned" : "failed",
              attempt,
              error: result.error,
              group_key: gkey
            });
            if (final) {
              summary.abandoned += 1;
              summary.outcomes[d.r.id] = "abandoned";
            } else {
              summary.failed += 1;
              summary.outcomes[d.r.id] = "failed";
            }
          }
          await notifyTeam(weddingId, {
            kind: "reminder_failed",
            title: "A payment reminder did not leave",
            body: `${uniquePayments.map((p) => p.label).join(" · ")} — ${result.error}`,
            url: "/budget"
          });
        }
      }
    }

    // A reminder is done once every channel it asked for has gone.
    for (const d of due) {
      const asked = reminderChannels(d.r.channel);
      const gone = new Set([
        ...(sentChannels.get(d.r.id) ?? new Set<string>()),
        ...(newlySent.get(d.r.id) ?? new Set<string>())
      ]);
      if (asked.every((c) => gone.has(c))) {
        await admin
          .from("payment_reminders")
          .update({ sent_at: new Date().toISOString() })
          .eq("id", d.r.id);
        summary.outcomes[d.r.id] = "sent";
      }
    }
  }

  return summary;
}
