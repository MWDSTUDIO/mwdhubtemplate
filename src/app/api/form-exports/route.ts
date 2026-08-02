import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { createElement as h } from "react";
import { Document, Page, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { gate } from "../agents/_shared";
import { createClient } from "@/lib/supabase/server";
import { logActivity } from "@/lib/activity";
import { coupleCanSee, statusBucket } from "@/lib/forms";
import type { FormRow, FormCategory } from "@/lib/types";

export const runtime = "nodejs";

/**
 * Forms exports (PRD §25) — real files, team only, journaled.
 * XLSX/CSV for every kind; a PDF directory where a sheet of cards
 * reads better on paper. Raw URLs appear here because the reader is
 * the team; the couple never receives these files.
 */

const HUNTER = "#22382B";
const CHAMPAGNE = "#c9b291";
const INK2 = "#6f6a5c";

export async function GET(request: Request) {
  const g = await gate(true);
  if ("error" in g) return g.error;
  const { session } = g;
  const wedding = session.wedding;
  if (!wedding) return NextResponse.json({ error: "no wedding" }, { status: 400 });

  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") ?? "directory";
  const format = url.searchParams.get("format") ?? "xlsx";
  const ids = (url.searchParams.get("ids") ?? "").split(",").filter(Boolean);
  const supabase = await createClient();

  const [{ data: formsRaw }, catsRes] = await Promise.all([
    supabase.from("forms").select("*").eq("wedding_id", wedding.id).order("sort"),
    supabase.from("form_categories").select("*").eq("wedding_id", wedding.id).order("sort")
  ]);
  const all = (formsRaw ?? []) as FormRow[];
  const catName = new Map(((catsRes.data ?? []) as FormCategory[]).map((c) => [c.id, c.name]));

  const pick: Record<string, FormRow[]> = {
    directory: all,
    active: all.filter((f) => !f.archived),
    client: all.filter(coupleCanSee),
    submitted: all.filter((f) => statusBucket(f.status) === "done"),
    archived: all.filter((f) => Boolean(f.archived)),
    filtered: all.filter((f) => ids.includes(f.id))
  };
  const list = pick[kind] ?? pick.directory;

  type Cell = string | number | null;
  const rows: Cell[][] = [
    ["Title", "Internal title", "Category", "Description", "Status", "Client visible", "Provider", "External URL", "Shared", "Due", "Submitted", "Last checked", "Internal note", "Archived"],
    ...list.map((f) => [
      f.title,
      f.internal_title ?? null,
      f.category_id ? (catName.get(f.category_id) ?? null) : null,
      f.description ?? null,
      f.status,
      f.client_visible === false ? "no" : "yes",
      f.provider ?? null,
      f.external_url ?? null,
      f.shared_at ?? null,
      f.due_date ?? f.due_label ?? null,
      f.submitted_at ?? null,
      f.last_checked_at ?? null,
      f.note_internal ?? null,
      f.archived ? "yes" : ""
    ])
  ];

  const day = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const names: Record<string, string> = {
    directory: "Form directory", active: "Active forms", client: "Client-visible forms",
    submitted: "Submitted forms", archived: "Archived forms", filtered: "Forms — filtered view"
  };
  const base = `${wedding.couple_display_name} — ${names[kind] ?? "Forms"} — ${day}`;
  await logActivity(supabase, wedding.id, session.profile.full_name, "forms_export", { kind, format, count: list.length });

  if (format === "csv") {
    const csv = rows.map((r) => r.map((x) => `"${String(x ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
    return new NextResponse("﻿" + csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(base)}.csv`
      }
    });
  }

  if (format === "xlsx") {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = rows[0].map((_, i) => ({ wch: i === 7 ? 44 : 18 }));
    ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(1, rows.length - 1), c: rows[0].length - 1 } }) };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, (names[kind] ?? "Forms").slice(0, 28));
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(base)}.xlsx`
      }
    });
  }

  /* ── the PDF summary ── */
  const cell = (txt: string, flex: number, bold = false) =>
    h(Text, { style: { flex, fontSize: 8.5, color: bold ? HUNTER : "#3a4a3f" } }, txt);
  const grouped = new Map<string, FormRow[]>();
  for (const f of list) {
    const key = f.category_id ? (catName.get(f.category_id) ?? "—") : "—";
    grouped.set(key, [...(grouped.get(key) ?? []), f]);
  }
  const doc = h(
    Document,
    {},
    h(
      Page,
      { size: "A4", style: { padding: 46, fontFamily: "Helvetica" } },
      h(
        View,
        { style: { textAlign: "center", marginBottom: 16 } },
        h(Text, { style: { fontSize: 8, letterSpacing: 3, color: INK2, textTransform: "uppercase" } }, "MADAME WEDDING DESIGN"),
        h(Text, { style: { fontSize: 24, fontFamily: "Times-Italic", color: HUNTER, marginTop: 6 } }, names[kind] ?? "Forms"),
        h(Text, { style: { fontSize: 8.5, color: INK2, marginTop: 4 } }, `${wedding.couple_display_name} · ${day}`)
      ),
      ...[...grouped.entries()].flatMap(([cat, items]) => [
        h(Text, { key: `h-${cat}`, style: { fontSize: 7.5, letterSpacing: 2, color: "#8a6f45", textTransform: "uppercase", marginTop: 12, marginBottom: 4 } }, cat),
        ...items.map((f) =>
          h(
            View,
            { key: f.id, style: { flexDirection: "row", borderBottom: `0.5 solid ${CHAMPAGNE}`, paddingVertical: 4 } },
            cell(f.title, 3, true),
            cell(f.status, 1),
            cell(f.client_visible === false ? "internal" : "client", 1),
            cell(f.due_date ?? f.due_label ?? "", 1),
            cell(f.provider ?? "", 1)
          )
        )
      ]),
      h(
        View,
        { style: { position: "absolute", bottom: 26, left: 46, right: 46, textAlign: "center", borderTop: `1 solid ${CHAMPAGNE}`, paddingTop: 8 } },
        h(Text, { style: { fontSize: 7, letterSpacing: 3, color: INK2 } }, "MADAME WEDDING DESIGN — A PARISIAN HOUSE OF WEDDING PLANNING AND PRODUCTION")
      )
    )
  );
  const buf = await renderToBuffer(doc as Parameters<typeof renderToBuffer>[0]);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(base)}.pdf`
    }
  });
}
