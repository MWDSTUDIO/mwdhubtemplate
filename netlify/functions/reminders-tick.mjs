/**
 * The reminder scheduler — DORMANT until Estelle authorises the launch
 * (notifications brief §2 bis f): it does nothing unless the
 * REMINDERS_ENABLED environment variable is set to "1".
 *
 * Once awake it runs every morning at 07:00 UTC and asks the
 * application to pass the day's reminders — the locks (draft, settled,
 * unverified banking, preview, grouping) all live server-side in
 * /api/reminders/tick, never here.
 */
export default async () => {
  if (process.env.REMINDERS_ENABLED !== "1") {
    return new Response("dormant — awaiting the house's launch word", { status: 200 });
  }
  const base = process.env.NEXT_PUBLIC_SITE_URL || process.env.URL;
  const secret = process.env.REMINDERS_SECRET;
  if (!base || !secret) return new Response("not configured", { status: 200 });
  try {
    const r = await fetch(`${base.replace(/\/$/, "")}/api/reminders/tick`, {
      method: "POST",
      headers: { "x-reminders-secret": secret }
    });
    return new Response(`tick: ${r.status}`, { status: 200 });
  } catch {
    return new Response("tick skipped", { status: 200 });
  }
};

export const config = { schedule: "0 7 * * *" };
