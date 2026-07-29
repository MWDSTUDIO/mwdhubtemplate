import { NextResponse } from "next/server";
import { gate } from "../../agents/_shared";
import { busyWindows } from "@/lib/google/calendar";

const SLOTS = [
  "09:00", "09:30", "10:00", "10:30", "11:00", "11:30",
  "14:00", "14:30", "15:00", "15:30", "16:00", "16:30",
  "17:00", "17:30", "18:00", "18:30"
];

/**
 * Which of the house's 30-minute slots are taken on a given day,
 * from Estelle's Google Calendar. Returns [] when the calendar is
 * not configured (every slot open). TEAM ONLY — the house's diary is
 * private; a client must never be able to reconstruct it.
 */
export async function GET(request: Request) {
  const g = await gate(true);
  if ("error" in g) return g.error;

  const url = new URL(request.url);
  const date = url.searchParams.get("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "bad date" }, { status: 400 });
  }

  const windows = await busyWindows(date, "Europe/Paris");
  if (!windows) return NextResponse.json({ busy: [] });

  const busy = SLOTS.filter((slot) => {
    const start = new Date(`${date}T${slot}:00+02:00`).getTime();
    const end = start + 30 * 60000;
    return windows.some(
      (w) => new Date(w.start).getTime() < end && new Date(w.end).getTime() > start
    );
  });

  return NextResponse.json({ busy });
}
