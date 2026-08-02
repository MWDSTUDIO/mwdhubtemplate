import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { createElement as h } from "react";
import { Document, Page, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { gate } from "../agents/_shared";
import { createClient } from "@/lib/supabase/server";
import { logActivity } from "@/lib/activity";
import type { Milestone, MilestoneOps, MonthlyNote } from "@/lib/types";

export const runtime = "nodejs";

/**
 * Timeline exports (PRD §24) — real files, team only, journaled.
 * PDF: timeline, letter (the monthly note), client (progress summary).
 * XLSX/CSV: checklist (operational), milestones, template.
 */

const HUNTER = "#22382B";
const CHAMPAGNE = "#c9b291";
const INK2 = "#6f6a5c";
const PARCHMENT = "#f2efe4";

export async function GET(request: Request) {
  const g = await gate(true);
  if ("error" in g) return g.error;
  const { session } = g;
  const wedding = session.wedding;
  if (!wedding) return NextResponse.json({ error: "no wedding" }, { status: 400 });

  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") ?? "timeline";
  const format = url.searchParams.get("format") ?? (["checklist", "milestones", "template"].includes(kind) ? "xlsx" : "pdf");
  const supabase = await createClient();

  const [{ data: milestones }, opsRes, { data: notes }] = await Promise.all([
    supabase.from("timeline_milestones").select("*").eq("wedding_id", wedding.id).order("month").order("sort"),
    supabase.from("milestone_ops").select("*").eq("wedding_id", wedding.id),
    supabase.from("monthly_notes").select("*").eq("wedding_id", wedding.id).order("month")
  ]);
  const all = (milestones ?? []) as Milestone[];
  const ops = new Map(
    (((opsRes as { data: unknown }).data ?? []) as MilestoneOps[]).map((o) => [o.milestone_id, o])
  );
  const opOf = (m: Milestone) => ops.get(m.id)?.op_status ?? (m.done ? "completed" : "planned");
  const active = all.filter((m) => opOf(m) !== "archived");

  type Cell = string | number | null;
  const sheets: Record<string, Cell[][]> = {
    checklist: [
      ["Month", "Milestone", "Status", "Priority", "Owner", "Due", "Description", "Module", "Internal note", "Published"],
      ...active.map((m) => {
        const o = ops.get(m.id);
        return [m.month.slice(0, 7), m.label, opOf(m), o?.priority ?? "standard", o?.owner ?? null, o?.due_date ?? null, o?.description ?? null, o?.module ?? null, o?.note_internal ?? null, m.status];
      })
    ],
    milestones: [
      ["Month", "Milestone", "Done", "Published"],
      ...active.map((m) => [m.month.slice(0, 7), m.label, m.done ? "yes" : "", m.status])
    ],
    template: [
      ["Month", "Milestone", "Description", "Owner", "Due", "Priority"],
      ["2027-03", "Tasting at the château", "Menu and wines settled", "Estelle", "2027-03-15", "high"]
    ]
  };

  const day = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const names: Record<string, string> = {
    timeline: "Timeline", letter: "Monthly letter", checklist: "Operational checklist",
    client: "Progress summary", milestones: "Milestones", template: "Timeline import template"
  };
  const base = `${wedding.couple_display_name} — ${names[kind] ?? "Timeline"} — ${day}`;
  await logActivity(supabase, wedding.id, session.profile.full_name, "timeline_export", { kind, format, file: base });

  if (format === "csv" || format === "xlsx") {
    const rows = sheets[kind] ?? sheets.checklist;
    if (format === "csv") {
      const csv = rows.map((r) => r.map((x) => `"${String(x ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
      return new NextResponse("﻿" + csv, {
        headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(base)}.csv` }
      });
    }
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = rows[0].map(() => ({ wch: 20 }));
    ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(1, rows.length - 1), c: rows[0].length - 1 } }) };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, (names[kind] ?? "Timeline").slice(0, 28));
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(base)}.xlsx`
      }
    });
  }

  /* ── the PDFs: timeline · letter · client ── */
  const clientOnly = kind === "client";
  const published = active.filter((m) => m.status === "published");
  const list = clientOnly ? published : active;
  const completed = list.filter((m) => m.done || opOf(m) === "completed");
  const pct = list.length ? Math.round((completed.length / list.length) * 100) : 0;

  const cell = (txt: string, flex: number, align: "left" | "right" = "left", bold = false) =>
    h(Text, { style: { flex, textAlign: align, fontSize: 8.5, color: bold ? HUNTER : "#3a4a3f" } }, txt);
  const eyebrowT = (txt: string) =>
    h(Text, { style: { fontSize: 7.5, letterSpacing: 2, color: "#8a6f45", textTransform: "uppercase", marginTop: 12, marginBottom: 4 } }, txt);

  const header = h(
    View,
    { style: { textAlign: "center", marginBottom: 16 } },
    h(Text, { style: { fontSize: 8, letterSpacing: 3, color: INK2, textTransform: "uppercase" } }, "MADAME WEDDING DESIGN"),
    h(Text, { style: { fontSize: 24, fontFamily: "Times-Italic", color: HUNTER, marginTop: 6 } }, names[kind] ?? "Timeline"),
    h(Text, { style: { fontSize: 8.5, color: INK2, marginTop: 4 } }, `${wedding.couple_display_name}${wedding.destination ? ` · ${wedding.destination}` : ""}`)
  );
  const strip = h(
    View,
    { style: { flexDirection: "row", borderTop: `1 solid ${CHAMPAGNE}`, borderBottom: `1 solid ${CHAMPAGNE}`, paddingVertical: 8, marginBottom: 12 } },
    ...[
      ["PROGRESS", `${pct} %`],
      ["COMPLETED", String(completed.length)],
      ["AHEAD", String(list.length - completed.length)]
    ].map(([label, value]) =>
      h(View, { key: label, style: { flex: 1, textAlign: "center" } },
        h(Text, { style: { fontSize: 7, letterSpacing: 2, color: INK2 } }, label),
        h(Text, { style: { fontSize: 13, fontFamily: "Times-Roman", color: HUNTER, marginTop: 2 } }, value))
    )
  );
  const footer = h(
    View,
    { style: { position: "absolute", bottom: 26, left: 46, right: 46, textAlign: "center", borderTop: `1 solid ${CHAMPAGNE}`, paddingTop: 8 } },
    h(Text, { style: { fontSize: 7, letterSpacing: 3, color: INK2 } }, "MADAME WEDDING DESIGN — A PARISIAN HOUSE OF WEDDING PLANNING AND PRODUCTION")
  );

  const body: unknown[] = [];
  if (kind === "letter") {
    const currentKey = `${new Date().toISOString().slice(0, 7)}-01`;
    const note = ((notes ?? []) as MonthlyNote[]).filter((n) => n.composed_text && n.month <= currentKey).at(-1);
    if (note?.composed_text) {
      body.push(
        h(View, { style: { backgroundColor: PARCHMENT, padding: 14, marginBottom: 12 } },
          h(Text, { style: { fontSize: 10, fontFamily: "Times-Italic", color: HUNTER, lineHeight: 1.6 } }, `“${note.composed_text}” — Estelle`))
      );
    }
    const monthMs = list.filter((m) => m.month === (note?.month ?? currentKey));
    if (monthMs.length) {
      body.push(eyebrowT("THE MONTH'S MILESTONES"),
        ...monthMs.map((m) =>
          h(View, { key: m.id, style: { flexDirection: "row", borderBottom: `0.5 solid ${CHAMPAGNE}`, paddingVertical: 3 } },
            cell(m.label, 8, "left", true), cell(m.done ? "Attended to" : "Ahead", 3, "right"))));
    }
  } else {
    // timeline (internal) and client (published, serene) share the
    // month-by-month body; the internal one carries the working notes.
    const byMonth = new Map<string, Milestone[]>();
    for (const m of list) byMonth.set(m.month, [...(byMonth.get(m.month) ?? []), m]);
    for (const [month, ms] of [...byMonth.entries()].sort()) {
      body.push(eyebrowT(new Date(month).toLocaleDateString("en-GB", { month: "long", year: "numeric" })),
        ...ms.map((m) => {
          const o = ops.get(m.id);
          return h(View, { key: m.id, style: { flexDirection: "row", borderBottom: `0.5 solid ${CHAMPAGNE}`, paddingVertical: 3 } },
            cell(m.label, 7, "left", true),
            ...(clientOnly
              ? [cell(m.done ? "Attended to" : "Ahead", 3, "right")]
              : [cell(o?.owner ?? "", 3), cell(o?.due_date ?? "", 2, "right"), cell(opOf(m).replace(/_/g, " "), 3, "right")]));
        }));
    }
  }

  const doc = h(Document, {},
    h(Page, { size: "A4", style: { backgroundColor: "#fdfcf9", padding: 46, fontFamily: "Helvetica" } },
      header, strip, ...(body as Parameters<typeof h>[2][]), footer));
  const buffer = await renderToBuffer(doc);
  const ascii = `MWD-${names[kind] ?? "Timeline"}`.replace(/[^\x20-\x7E]/g, "-");
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${ascii}.pdf"; filename*=UTF-8''${encodeURIComponent(base)}.pdf`
    }
  });
}
