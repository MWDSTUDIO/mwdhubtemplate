import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import webpush from "web-push";

interface Notice {
  kind: string;
  title: string;
  body?: string;
  url?: string;
}

function pushReady() {
  return Boolean(
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY
  );
}

if (pushReady()) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:house@example.com",
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!
  );
}

async function sendEmail(to: string[], subject: string, text: string) {
  const key = process.env.RESEND_API_KEY;
  if (!key || to.length === 0) return;
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.NOTIFY_FROM || "The Inner House <onboarding@resend.dev>",
      to,
      subject,
      text
    })
  }).catch(() => undefined);
}

async function fanOut(recipientIds: string[], weddingId: string | null, notice: Notice) {
  if (recipientIds.length === 0) return;
  const admin = createAdminClient();

  await admin.from("notifications").insert(
    recipientIds.map((recipient_id) => ({
      wedding_id: weddingId,
      recipient_id,
      kind: notice.kind,
      title: notice.title,
      body: notice.body ?? null,
      url: notice.url ?? null
    }))
  );

  // Web push
  if (pushReady()) {
    const { data: subs } = await admin
      .from("push_subscriptions")
      .select("endpoint, keys, profile_id")
      .in("profile_id", recipientIds);
    await Promise.allSettled(
      (subs ?? []).map((s) =>
        webpush.sendNotification(
          { endpoint: s.endpoint, keys: s.keys as { p256dh: string; auth: string } },
          JSON.stringify({ title: notice.title, body: notice.body, url: notice.url })
        )
      )
    );
  }

  // Email
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const emails = (users?.users ?? [])
    .filter((u) => recipientIds.includes(u.id) && u.email)
    .map((u) => u.email!) as string[];
  await sendEmail(emails, notice.title, `${notice.body ?? ""}\n\n— Madame Wedding Design`);
}

/** Notify specific profiles — used for @citations in Messages. */
export async function notifyProfiles(
  profileIds: string[],
  weddingId: string | null,
  notice: Notice
) {
  await fanOut(profileIds, weddingId, notice);
}

/** Notify every team profile (Estelle, Jordane, collaborators). */
export async function notifyTeam(weddingId: string, notice: Notice) {
  const admin = createAdminClient();
  const { data } = await admin.from("profiles").select("id").eq("role", "team");
  await fanOut((data ?? []).map((p) => p.id), weddingId, notice);
}

/**
 * Notify the couple of a wedding. Every client notification follows an
 * act of publication or confirmation by the house — never raw drafts.
 */
export async function notifyCouple(weddingId: string, notice: Notice) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("wedding_members")
    .select("profile_id")
    .eq("wedding_id", weddingId)
    .eq("relation", "couple");
  await fanOut((data ?? []).map((m) => m.profile_id), weddingId, notice);
}
