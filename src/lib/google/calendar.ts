import "server-only";

/**
 * Minimal Google Calendar REST wrapper (OAuth2 refresh-token flow on
 * Estelle's account). No SDK — one token call, one API call.
 */

async function accessToken(): Promise<string | null> {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) return null;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: GOOGLE_REFRESH_TOKEN,
      grant_type: "refresh_token"
    })
  });
  if (!r.ok) return null;
  const d = await r.json();
  return d.access_token ?? null;
}

const calendarId = () => encodeURIComponent(process.env.GOOGLE_CALENDAR_ID || "primary");

/** Busy windows of Estelle's calendar for one day (ISO strings). */
export async function busyWindows(date: string, timezone: string) {
  const token = await accessToken();
  if (!token) return null; // not configured — caller treats all slots as open
  const r = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      timeMin: `${date}T00:00:00Z`,
      timeMax: `${date}T23:59:59Z`,
      timeZone: timezone,
      items: [{ id: process.env.GOOGLE_CALENDAR_ID || "primary" }]
    })
  });
  if (!r.ok) return null;
  const d = await r.json();
  const cal = Object.values(d.calendars ?? {})[0] as { busy?: { start: string; end: string }[] };
  return cal?.busy ?? [];
}

/** Create a calendar event with a Google Meet link, invite both sides later. */
export async function createMeetEvent(input: {
  summary: string;
  date: string; // yyyy-mm-dd
  time: string; // HH:MM
  durationMinutes: number;
  timezone: string;
  attendees?: string[];
}) {
  const token = await accessToken();
  if (!token) throw new Error("Google Calendar is not configured");

  const start = new Date(`${input.date}T${input.time}:00`);
  const end = new Date(start.getTime() + input.durationMinutes * 60000);
  const fmt = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "");

  const r = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${calendarId()}/events?conferenceDataVersion=1&sendUpdates=all`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        summary: input.summary,
        start: { dateTime: fmt(start), timeZone: input.timezone },
        end: { dateTime: fmt(end), timeZone: input.timezone },
        attendees: (input.attendees ?? []).map((email) => ({ email })),
        conferenceData: {
          createRequest: {
            requestId: crypto.randomUUID(),
            conferenceSolutionKey: { type: "hangoutsMeet" }
          }
        }
      })
    }
  );
  if (!r.ok) throw new Error(`calendar: ${r.status}`);
  const d = await r.json();
  return {
    id: d.id as string,
    meetUrl:
      (d.conferenceData?.entryPoints?.find((e: { entryPointType: string }) => e.entryPointType === "video")
        ?.uri as string) ?? d.hangoutLink ?? null
  };
}
