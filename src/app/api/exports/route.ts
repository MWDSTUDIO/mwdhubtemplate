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

  // The meta hand: when did a file of each kind last leave the house?
  if (url.searchParams.get("meta") === "1") {
    const { data: snaps } = await supabase
      .from("guest_export_snapshots")
      .select("kind, event_id, created_at")
      .eq("wedding_id", wedding.id)
      .order("created_at", { ascending: false })
      .limit(60);
    const last: Record<string, string> = {};
    for (const s of snaps ?? []) {
      const k = `${s.kind}${s.event_id ? ":" + s.event_id : ""}`;
      if (!last[k]) last[k] = s.created_at;
    }
    return NextResponse.json({ last });
  }

  let sheets = buildExport(kind, data, { eventId, fields, wishedOnly });
  const currentRows = sheets[0]?.rows ?? [];
  const wantDelta = url.searchParams.get("delta") === "1";
  let deltaSince: string | null = null;

  if (kind !== "template") {
    // C1 · the delta: what changed since the last list this recipient
    // received — keyed on the first column, changes named per row.
    const { data: prev } = await supabase
      .from("guest_export_snapshots")
      .select("rows, created_at")
      .eq("wedding_id", wedding.id)
      .eq("kind", kind)
      .filter("event_id", eventId ? "eq" : "is", eventId ?? null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (wantDelta && prev) {
      deltaSince = prev.created_at as string;
      const old = prev.rows as (string | number | null)[][];
      const header = currentRows[0] ?? [];
      const oldMap = new Map(old.slice(1).map((r) => [String(r[0] ?? ""), r]));
      const curMap = new Map(currentRows.slice(1).map((r) => [String(r[0] ?? ""), r]));
      const deltaRows: (string | number | null)[][] = [[...header, "Change"]];
      for (const [key, row] of curMap) {
        const before = oldMap.get(key);
        if (!before) deltaRows.push([...row, "added"]);
        else if (JSON.stringify(before) !== JSON.stringify(row)) deltaRows.push([...row, "updated"]);
      }
      for (const [key, row] of oldMap) {
        if (!curMap.has(key)) deltaRows.push([...row, "removed"]);
      }
      sheets = [{ name: sheets[0].name.slice(0, 22) + " Δ", rows: deltaRows }];
    }

    // Every departure leaves its snapshot of the FULL list — the next
    // delta measures against what actually left today.
    await supabase.from("guest_export_snapshots").insert({
      wedding_id: wedding.id,
      kind,
      event_id: eventId ?? null,
      rows: currentRows,
      created_by: session.profile.full_name
    });
  }

  const rowCount = sheets.reduce((s, sh) => s + Math.max(0, sh.rows.length - 1), 0);

  const day = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const kindLabel = (kind === "template" ? "Import template" : kind[0].toUpperCase() + kind.slice(1)) + (deltaSince ? " (delta)" : "");
  const eventName = eventId ? data.events.find((e) => e.id === eventId)?.name : null;
  const base = `${wedding.couple_display_name} — ${kindLabel}${eventName ? ` (${eventName})` : ""} — ${day}`;

  await logActivity(supabase, wedding.id, session.profile.full_name, "guest_export", {
    kind, format, rows: rowCount, event: eventName ?? null, file: base,
    ...(deltaSince ? { delta_since: deltaSince } : {})
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
