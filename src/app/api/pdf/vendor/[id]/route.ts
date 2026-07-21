import { createElement as h } from "react";
import { NextResponse } from "next/server";
import { Document, Page, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptBanking } from "@/lib/banking";
import { gate } from "../../../agents/_shared";
import type { BudgetLine, BudgetLineItem, Payment } from "@/lib/types";

export const runtime = "nodejs";

const HUNTER = "#22382B";
const CHAMPAGNE = "#c9b291";
const INK2 = "#6f6a5c";
const PARCHMENT = "#f2efe4";

/**
 * The vendor sheet as a portrait PDF, signed with the house's mark:
 * what the couple pays this house — the quote by event, the schedule,
 * the house's note. Banking details appear only where an instalment
 * carries the explicit reveal.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await gate(false);
  if ("error" in g) return g.error;
  const { id } = await params;

  try {
    const supabase = await createClient();
    const { data: vendor } = await supabase
      .from("vendors")
      .select("*, weddings(couple_display_name, destination, default_locale)")
      .eq("id", id)
      .maybeSingle<{ id: string; wedding_id: string; name: string; category: string; weddings: { couple_display_name: string; destination: string } | null }>();
    if (!vendor) return NextResponse.json({ error: "not found" }, { status: 404 });

    const [{ data: lines }, itemsRes, noteRes, { data: payments }] = await Promise.all([
      supabase.from("budget_lines").select("*").eq("vendor_id", id).order("sort"),
      supabase.from("budget_line_items").select("*").eq("wedding_id", vendor.wedding_id).order("sort"),
      supabase.from("vendor_client_notes").select("body, status").eq("vendor_id", id).maybeSingle(),
      supabase.from("payments").select("*").eq("wedding_id", vendor.wedding_id).order("due_date", { ascending: true })
    ]);

    const vendorLines = (lines ?? []) as BudgetLine[];
    const lineIds = new Set(vendorLines.map((l) => l.id));
    const items = ((itemsRes.data ?? []) as BudgetLineItem[]).filter((it) => lineIds.has(it.budget_line_id));
    const schedule = ((payments ?? []) as Payment[]).filter((p) => p.budget_line_id && lineIds.has(p.budget_line_id));
    const note = (noteRes.data as { body: string | null; status: string } | null) ?? null;

    let banking = null;
    if (schedule.some((p) => p.reveal_banking)) {
      const admin = createAdminClient();
      const { data: enc } = await admin.from("vendor_banking").select("enc").eq("vendor_id", id).maybeSingle();
      if (enc) banking = decryptBanking(enc.enc);
    }

    const committed = vendorLines.reduce((s, l) => s + (l.committed ?? 0), 0);
    const paid = vendorLines.reduce((s, l) => s + (l.paid ?? 0), 0);
    const eur = (n: number | null | undefined, cur = "EUR") =>
      n == null
        ? "—"
        : `${new Intl.NumberFormat("en-IE", { maximumFractionDigits: 0 }).format(n)} ${cur === "EUR" ? "€" : cur}`;

    const groups = new Map<string, BudgetLineItem[]>();
    for (const it of items) {
      const k = it.event_label ?? "—";
      groups.set(k, [...(groups.get(k) ?? []), it]);
    }

    const cell = (txt: string, flex: number, align: "left" | "right" = "left", bold = false) =>
      h(Text, { style: { flex, textAlign: align, fontSize: 8.5, color: bold ? HUNTER : "#3a4a3f" } }, txt);

    const doc = h(
      Document,
      {},
      h(
        Page,
        { size: "A4", style: { backgroundColor: "#fdfcf9", padding: 46, fontFamily: "Helvetica" } },
        // header
        h(
          View,
          { style: { textAlign: "center", marginBottom: 18 } },
          h(Text, { style: { fontSize: 8, letterSpacing: 3, color: INK2, textTransform: "uppercase" } }, "MADAME WEDDING DESIGN"),
          h(Text, { style: { fontSize: 24, fontFamily: "Times-Italic", color: HUNTER, marginTop: 6 } }, vendor.name),
          h(
            Text,
            { style: { fontSize: 8.5, color: INK2, marginTop: 4 } },
            `${vendor.category} — for ${vendor.weddings?.couple_display_name ?? ""} · ${vendor.weddings?.destination ?? ""}`
          )
        ),
        // summary strip
        h(
          View,
          { style: { flexDirection: "row", borderTop: `1 solid ${CHAMPAGNE}`, borderBottom: `1 solid ${CHAMPAGNE}`, paddingVertical: 8, marginBottom: 16 } },
          ...[
            ["CONTRACT", eur(committed)],
            ["PAID", eur(paid)],
            ["REMAINING", eur(committed - paid)]
          ].map(([label, value]) =>
            h(
              View,
              { key: label, style: { flex: 1, textAlign: "center" } },
              h(Text, { style: { fontSize: 7, letterSpacing: 2, color: INK2 } }, label),
              h(Text, { style: { fontSize: 13, fontFamily: "Times-Roman", color: HUNTER, marginTop: 2 } }, value)
            )
          )
        ),
        // note
        note?.body && note.status === "published"
          ? h(
              View,
              { style: { backgroundColor: PARCHMENT, padding: 12, marginBottom: 16 } },
              h(Text, { style: { fontSize: 9.5, fontFamily: "Times-Italic", color: HUNTER, lineHeight: 1.5 } }, `“${note.body}” — Estelle`)
            )
          : null,
        // items by event
        ...[...groups.entries()].map(([event, rows]) =>
          h(
            View,
            { key: event, style: { marginBottom: 12 } },
            h(Text, { style: { fontSize: 7.5, letterSpacing: 2, color: "#8a6f45", textTransform: "uppercase", marginBottom: 4 } }, event),
            ...rows.map((it) =>
              h(
                View,
                { key: it.id, style: { flexDirection: "row", borderBottom: `0.5 solid ${CHAMPAGNE}`, paddingVertical: 3 } },
                cell(it.label, 5),
                cell(it.qty != null ? String(it.qty) : "", 1, "right"),
                cell(it.total_ht != null ? eur(it.total_ht) : "", 2, "right"),
                cell(it.vat_pct != null ? `${it.vat_pct} %` : "", 1, "right"),
                cell(eur(it.total_ttc ?? it.total_ht), 2, "right")
              )
            ),
            h(
              View,
              { style: { flexDirection: "row", backgroundColor: PARCHMENT, paddingVertical: 4, paddingHorizontal: 2 } },
              cell("Subtotal", 5, "left", true),
              cell("", 1),
              cell(eur(rows.reduce((s, r) => s + Number(r.total_ht ?? 0), 0)), 2, "right", true),
              cell("", 1),
              cell(eur(rows.reduce((s, r) => s + Number(r.total_ttc ?? r.total_ht ?? 0), 0)), 2, "right", true)
            )
          )
        ),
        // schedule
        schedule.length
          ? h(
              View,
              { style: { marginTop: 6 } },
              h(Text, { style: { fontSize: 7.5, letterSpacing: 2, color: INK2, textTransform: "uppercase", marginBottom: 4 } }, "PAYMENT SCHEDULE"),
              ...schedule.map((p) =>
                h(
                  View,
                  { key: p.id, style: { flexDirection: "row", borderBottom: `0.5 solid ${CHAMPAGNE}`, paddingVertical: 3 } },
                  cell(p.label, 5),
                  cell(eur(p.amount, p.currency || "EUR"), 2, "right"),
                  cell(p.due_date ?? "—", 2, "right"),
                  cell(p.paid_at ? "Settled" : p.refundable ? "Refundable" : "Upcoming", 2, "right")
                )
              )
            )
          : null,
        // banking, only when revealed
        banking?.iban
          ? h(
              View,
              { style: { marginTop: 14, backgroundColor: PARCHMENT, padding: 10 } },
              h(Text, { style: { fontSize: 7.5, letterSpacing: 2, color: INK2, marginBottom: 3 } }, "BANKING DETAILS"),
              h(
                Text,
                { style: { fontSize: 9, color: HUNTER } },
                `${banking.holder ? `${banking.holder} · ` : ""}IBAN ${banking.iban}${banking.swift ? ` · SWIFT ${banking.swift}` : ""}`
              )
            )
          : null,
        // footer mark
        h(
          View,
          { style: { position: "absolute", bottom: 26, left: 46, right: 46, textAlign: "center", borderTop: `1 solid ${CHAMPAGNE}`, paddingTop: 8 } },
          h(Text, { style: { fontSize: 7, letterSpacing: 3, color: INK2 } }, "MADAME WEDDING DESIGN — A PARISIAN HOUSE OF WEDDING PLANNING AND PRODUCTION")
        )
      )
    );

    const buffer = await renderToBuffer(doc);
    const ascii = `MWD-${vendor.name}`.replace(/[^\x20-\x7E]/g, "-");
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${ascii}.pdf"; filename*=UTF-8''${encodeURIComponent(`MWD — ${vendor.name}.pdf`)}`
      }
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "pdf failed" }, { status: 500 });
  }
}
