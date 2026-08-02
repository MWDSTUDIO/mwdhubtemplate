import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { gate } from "../agents/_shared";
import { createClient } from "@/lib/supabase/server";
import { logActivity } from "@/lib/activity";
import { buildExport, type ExportKind, type ExportData } from "@/lib/guest-export";
import type { Guest, GuestPerson, HotelBlock, PersonEventStatus, WeddingEvent } from "@/lib/types";

/**
 * The export desk (final prompt §B2) — Team view only, server-checked:
 * a client calling this directly receives 403, never a file. Every
 * departure is journaled with its kind, its row count and its name.
 * The file reflects the corrected state at the instant of the click.
 */

const KINDS: ExportKind[] = [
  "stationer", "caterer", "venue", "rooming", "arrivals",
  "labels", "pending", "declined", "raw", "custom", "template"
];

export async function GET(request: Request) {
  const g = await gate(true);
  if ("error" in g) return g.error;
  const { session } = g;
  const wedding = session.wedding;
  if (!wedding) return NextResponse.json({ error: "no wedding" }, { status: 400 });

  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") as ExportKind | null;
  if (!kind || !KINDS.includes(kind)) {
    return NextResponse.json({ error: "unknown export" }, { status: 400 });
  }
  const format = url.searchParams.get("format") === "csv" ? "csv" : "xlsx";
  const eventId = url.searchParams.get("event") ?? undefined;
  const fields = url.searchParams.get("fields")?.split(",").filter(Boolean);
  const wishedOnly = url.searchParams.get("wished") === "1";

  const supabase = await createClient();
  const [hh, ps, sts, evs, blocks] = await Promise.all([
    supabase.from("guests").select("*").eq("wedding_id", wedding.id).order("created_at"),
    supabase.from("guest_persons").select("*").eq("wedding_id", wedding.id),
    supabase.from("person_event_status").select("*").eq("wedding_id", wedding.id),
    supabase.from("wedding_events").select("*").eq("wedding_id", wedding.id).order("sort"),
    supabase.from("hotel_blocks").select("*").eq("wedding_id", wedding.id)
  ]);
  const data: ExportData = {
    households: (hh.data ?? []) as Guest[],
    persons: (ps.data ?? []) as GuestPerson[],
    statuses: (sts.data ?? []) as PersonEventStatus[],
    events: ((evs.data ?? []) as WeddingEvent[]).filter((e) => !e.archived),
    blocks: (blocks.data ?? []) as HotelBlock[]
  };

  const sheets = buildExport(kind, data, { eventId, fields, wishedOnly });
  const rowCount = sheets.reduce((s, sh) => s + Math.max(0, sh.rows.length - 1), 0);

  const day = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const kindLabel = kind === "template" ? "Import template" : kind[0].toUpperCase() + kind.slice(1);
  const eventName = eventId ? data.events.find((e) => e.id === eventId)?.name : null;
  const base = `${wedding.couple_display_name} — ${kindLabel}${eventName ? ` (${eventName})` : ""} — ${day}`;

  await logActivity(supabase, wedding.id, session.profile.full_name, "guest_export", {
    kind, format, rows: rowCount, event: eventName ?? null, file: base
  });

  if (format === "csv") {
    const sheet = sheets[0];
    const csv = sheet.rows
      .map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\r\n");
    return new NextResponse("﻿" + csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(base)}.csv"; filename*=UTF-8''${encodeURIComponent(base)}.csv`
      }
    });
  }

  const wb = XLSX.utils.book_new();
  for (const sheet of sheets) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheet.rows), sheet.name.replace(/[\\/?*[\]]/g, " "));
  }
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(base)}.xlsx"; filename*=UTF-8''${encodeURIComponent(base)}.xlsx`
    }
  });
}
