import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { createElement as h } from "react";
import { Document, Page, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { gate } from "../agents/_shared";
import { createClient } from "@/lib/supabase/server";
import { logActivity } from "@/lib/activity";
import { flowDuration } from "@/lib/ceremony";
import type {
  Ceremony,
  CeremonyFlowItem,
  CeremonyLogistic,
  CeremonyMusic,
  CeremonyParticipant,
  CeremonyReading
} from "@/lib/types";

export const runtime = "nodejs";

/**
 * Ceremony exports (PRD §24) — real files, team only, journaled.
 * PDF: summary, script, brief (internal), client. XLSX/CSV: flow,
 * participants, music, readings, logistics.
 */

const HUNTER = "#22382B";
const CHAMPAGNE = "#c9b291";
const INK2 = "#6f6a5c";
const PARCHMENT = "#f2efe4";

type Cell = string | number | null;

export async function GET(request: Request) {
  const g = await gate(true);
  if ("error" in g) return g.error;
  const { session } = g;
  const wedding = session.wedding;
  if (!wedding) return NextResponse.json({ error: "no wedding" }, { status: 400 });

  const url = new URL(request.url);
  const ceremonyId = url.searchParams.get("ceremonyId") ?? "";
  const kind = url.searchParams.get("kind") ?? "summary";
  const format = url.searchParams.get("format") ?? (["flow", "participants", "music", "readings", "logistics"].includes(kind) ? "xlsx" : "pdf");
  const supabase = await createClient();

  const [{ data: c }, flowRes, partsRes, musicRes, readRes, logRes] = await Promise.all([
    supabase.from("ceremonies").select("*").eq("id", ceremonyId).eq("wedding_id", wedding.id).maybeSingle(),
    supabase.from("ceremony_flow").select("*").eq("ceremony_id", ceremonyId).order("sort"),
    supabase.from("ceremony_participants").select("*, guest_persons(full_name), vendors(name)").eq("ceremony_id", ceremonyId).order("sort"),
    supabase.from("ceremony_music").select("*, vendors(name)").eq("ceremony_id", ceremonyId).order("sort"),
    supabase.from("ceremony_readings").select("*").eq("ceremony_id", ceremonyId).order("sort"),
    supabase.from("ceremony_logistics").select("*, vendors(name)").eq("ceremony_id", ceremonyId).order("sort")
  ]);
  if (!c) return NextResponse.json({ error: "not found" }, { status: 404 });
  const ceremony = c as Ceremony;

  type PartRow = CeremonyParticipant & { guest_persons: { full_name: string | null } | null; vendors: { name: string } | null };
  const parts = ((partsRes as { data: unknown }).data ?? []) as PartRow[];
  const flow = ((flowRes as { data: unknown }).data ?? []) as CeremonyFlowItem[];
  const music = ((musicRes as { data: unknown }).data ?? []) as (CeremonyMusic & { vendors: { name: string } | null })[];
  const readings = ((readRes as { data: unknown }).data ?? []) as CeremonyReading[];
  const logistics = ((logRes as { data: unknown }).data ?? []) as (CeremonyLogistic & { vendors: { name: string } | null })[];
  const partName = (p: PartRow) => p.name || p.guest_persons?.full_name || p.vendors?.name || "—";
  const partById = (id: string | null) => { const p = parts.find((x) => x.id === id); return p ? partName(p) : null; };
  const activeFlow = flow.filter((f) => !f.archived);
  const minutes = ceremony.duration_min ?? flowDuration(flow);
  const title = ceremony.title || ceremony.kind;

  const sheets: Record<string, { name: string; rows: Cell[][] }> = {
    flow: {
      name: "Ceremony flow",
      rows: [
        ["#", "Block", "Title", "Duration (min)", "Who", "Client note", "Internal note"],
        ...activeFlow.map((f, i) => [i + 1, f.block_type, f.title, f.duration_min, partById(f.participant_id), f.note_client, f.note_internal])
      ]
    },
    participants: {
      name: "Participants",
      rows: [
        ["Name", "Role", "Client visible", "Internal note"],
        ...parts.map((p) => [partName(p), p.role, p.client_visible ? "yes" : "", p.note_internal])
      ]
    },
    music: {
      name: "Music list",
      rows: [
        ["Slot", "Title", "Artist", "Performer", "Duration (min)", "Cue", "Status"],
        ...music.filter((m) => !m.archived).map((m) => [m.slot, m.title, m.artist, m.performer || m.vendors?.name || null, m.duration_min != null ? Number(m.duration_min) : null, m.cue, m.status])
      ]
    },
    readings: {
      name: "Readings",
      rows: [
        ["Title", "Reader", "Language", "Duration (min)", "Status", "Excerpt"],
        ...readings.filter((r) => !r.archived).map((r) => [r.title, partById(r.reader_participant_id), r.language, r.duration_min, r.status, r.excerpt])
      ]
    },
    logistics: {
      name: "Logistics checklist",
      rows: [
        ["Item", "Qty", "Detail", "Owner", "Vendor", "Status", "Note"],
        ...logistics.map((l) => [l.item, l.qty, l.detail, l.owner, l.vendors?.name ?? null, l.status, l.note_internal])
      ]
    }
  };

  const day = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const base = `${wedding.couple_display_name} — ${title} — ${kind} — ${day}`;
  await logActivity(supabase, wedding.id, session.profile.full_name, "ceremony_export", { ceremonyId, kind, format, file: base });

  if (format === "csv" || format === "xlsx") {
    const sheet = sheets[kind] ?? sheets.flow;
    if (format === "csv") {
      const csv = sheet.rows.map((r) => r.map((x) => `"${String(x ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
      return new NextResponse("﻿" + csv, {
        headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(base)}.csv` }
      });
    }
    const ws = XLSX.utils.aoa_to_sheet(sheet.rows);
    ws["!cols"] = sheet.rows[0].map(() => ({ wch: 20 }));
    ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(1, sheet.rows.length - 1), c: sheet.rows[0].length - 1 } }) };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheet.name.slice(0, 28));
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(base)}.xlsx`
      }
    });
  }

  /* ── the PDFs: summary · script · brief (internal) · client ── */
  const clientOnly = kind === "client";
  const cell = (txt: string, flex: number, align: "left" | "right" = "left", bold = false) =>
    h(Text, { style: { flex, textAlign: align, fontSize: 8.5, color: bold ? HUNTER : "#3a4a3f" } }, txt);
  const eyebrowT = (txt: string) =>
    h(Text, { style: { fontSize: 7.5, letterSpacing: 2, color: "#8a6f45", textTransform: "uppercase", marginTop: 12, marginBottom: 4 } }, txt);

  const header = h(
    View,
    { style: { textAlign: "center", marginBottom: 16 } },
    h(Text, { style: { fontSize: 8, letterSpacing: 3, color: INK2, textTransform: "uppercase" } }, "MADAME WEDDING DESIGN"),
    h(Text, { style: { fontSize: 24, fontFamily: "Times-Italic", color: HUNTER, marginTop: 6 } }, title),
    h(Text, { style: { fontSize: 8.5, color: INK2, marginTop: 4 } },
      `${ceremony.kind} — ${wedding.couple_display_name} · ${[ceremony.ceremony_date, ceremony.start_time, ceremony.venue].filter(Boolean).join(" · ")}`)
  );
  const strip = h(
    View,
    { style: { flexDirection: "row", borderTop: `1 solid ${CHAMPAGNE}`, borderBottom: `1 solid ${CHAMPAGNE}`, paddingVertical: 8, marginBottom: 12 } },
    ...[
      ["OFFICIANT", ceremony.officiant ?? "—"],
      ["DURATION", minutes ? `≈ ${minutes} min` : "—"],
      ["PARTICIPANTS", String(clientOnly ? parts.filter((p) => p.client_visible).length : parts.length)],
      ...(clientOnly ? [] : [["STATUS", (ceremony.status ?? "published").replace(/_/g, " ")]])
    ].map(([label, value]) =>
      h(View, { key: label, style: { flex: 1, textAlign: "center" } },
        h(Text, { style: { fontSize: 7, letterSpacing: 2, color: INK2 } }, label),
        h(Text, { style: { fontSize: 12, fontFamily: "Times-Roman", color: HUNTER, marginTop: 2 } }, value))
    )
  );
  const footer = h(
    View,
    { style: { position: "absolute", bottom: 26, left: 46, right: 46, textAlign: "center", borderTop: `1 solid ${CHAMPAGNE}`, paddingTop: 8 } },
    h(Text, { style: { fontSize: 7, letterSpacing: 3, color: INK2 } }, "MADAME WEDDING DESIGN — A PARISIAN HOUSE OF WEDDING PLANNING AND PRODUCTION")
  );

  const flowRows = (withInternal: boolean) =>
    activeFlow.map((f) =>
      h(View, { key: f.id, style: { flexDirection: "row", borderBottom: `0.5 solid ${CHAMPAGNE}`, paddingVertical: 3 } },
        cell(f.title, 5, "left", true),
        cell(partById(f.participant_id) ?? "", 3),
        cell(f.duration_min ? `${f.duration_min} min` : "", 2, "right"),
        cell((withInternal ? f.note_internal : f.note_client) ?? (withInternal ? f.note_client ?? "" : ""), 5))
    );

  const body: unknown[] = [];
  if (kind === "script") {
    body.push(eyebrowT("CEREMONY FLOW"), ...flowRows(true));
    for (const r of readings.filter((x) => !x.archived)) {
      body.push(
        eyebrowT(`READING — ${r.title}${partById(r.reader_participant_id) ? ` · ${partById(r.reader_participant_id)}` : ""}`),
        r.excerpt ? h(Text, { key: `${r.id}x`, style: { fontSize: 9.5, fontFamily: "Times-Roman", color: "#3a4a3f", lineHeight: 1.5 } }, r.excerpt) : null
      );
    }
    if (music.some((m) => !m.archived)) {
      body.push(eyebrowT("MUSIC"),
        ...music.filter((m) => !m.archived).map((m) =>
          h(View, { key: m.id, style: { flexDirection: "row", borderBottom: `0.5 solid ${CHAMPAGNE}`, paddingVertical: 3 } },
            cell(m.slot, 2), cell(`${m.title}${m.artist ? ` — ${m.artist}` : ""}`, 6, "left", true), cell(m.cue ?? "", 4))));
    }
  } else if (kind === "brief") {
    body.push(eyebrowT("FLOW"), ...flowRows(true));
    body.push(eyebrowT("LOGISTICS"),
      ...logistics.map((l) =>
        h(View, { key: l.id, style: { flexDirection: "row", borderBottom: `0.5 solid ${CHAMPAGNE}`, paddingVertical: 3 } },
          cell(`${l.item}${l.qty ? ` × ${l.qty}` : ""}`, 4, "left", true),
          cell(l.detail ?? "", 4), cell(l.owner || l.vendors?.name || "", 3), cell(l.status.replace(/_/g, " "), 2, "right"))));
    if (ceremony.plan_b) body.push(eyebrowT("PLAN B"), h(Text, { style: { fontSize: 9.5, color: "#3a4a3f" } }, ceremony.plan_b));
  } else if (kind === "client") {
    const visParts = parts.filter((p) => p.client_visible);
    if (visParts.length) {
      body.push(eyebrowT("AT THEIR SIDE"),
        h(Text, { style: { fontSize: 9.5, color: "#3a4a3f" } }, visParts.map((p) => partName(p)).join(" · ")));
    }
    body.push(eyebrowT("THE CEREMONY"),
      ...activeFlow.map((f) =>
        h(View, { key: f.id, style: { flexDirection: "row", borderBottom: `0.5 solid ${CHAMPAGNE}`, paddingVertical: 3 } },
          cell(f.title, 5, "left", true), cell(f.note_client ?? "", 7))));
    const app = readings.filter((r) => r.status === "approved" && !r.archived);
    const appM = music.filter((m) => m.status === "approved" && !m.archived);
    if (app.length) body.push(eyebrowT("READINGS"), h(Text, { style: { fontSize: 9.5, color: "#3a4a3f" } }, app.map((r) => r.title).join(" · ")));
    if (appM.length) body.push(eyebrowT("MUSIC"), h(Text, { style: { fontSize: 9.5, color: "#3a4a3f" } }, appM.map((m) => `${m.title}${m.artist ? ` (${m.artist})` : ""}`).join(" · ")));
    if (ceremony.notes) {
      body.push(h(View, { style: { backgroundColor: PARCHMENT, padding: 12, marginTop: 14 } },
        h(Text, { style: { fontSize: 9.5, fontFamily: "Times-Italic", color: HUNTER, lineHeight: 1.5 } }, `“${ceremony.notes}” — Estelle`)));
    }
  } else {
    // summary — the team's one-page reading
    body.push(eyebrowT("FLOW"), ...flowRows(false));
    if (parts.length) body.push(eyebrowT("PARTICIPANTS"), h(Text, { style: { fontSize: 9.5, color: "#3a4a3f" } }, parts.map((p) => `${partName(p)} (${p.role})`).join(" · ")));
    if (logistics.length) body.push(eyebrowT("LOGISTICS"), h(Text, { style: { fontSize: 9.5, color: "#3a4a3f" } }, logistics.map((l) => `${l.item} — ${l.status.replace(/_/g, " ")}`).join(" · ")));
  }

  const doc = h(Document, {},
    h(Page, { size: "A4", style: { backgroundColor: "#fdfcf9", padding: 46, fontFamily: "Helvetica" } },
      header, strip, ...(body.filter(Boolean) as Parameters<typeof h>[2][]), footer));
  const buffer = await renderToBuffer(doc);
  const ascii = `MWD-${title}-${kind}`.replace(/[^\x20-\x7E]/g, "-");
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${ascii}.pdf"; filename*=UTF-8''${encodeURIComponent(base)}.pdf`
    }
  });
}
