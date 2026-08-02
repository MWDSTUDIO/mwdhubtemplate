import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { gate } from "../agents/_shared";
import { createClient } from "@/lib/supabase/server";
import { logActivity } from "@/lib/activity";
import type { Vendor, VendorContact, VendorRegistry } from "@/lib/types";

/**
 * Vendor exports (PRD §10) — real files, team only, journaled.
 * Kinds: wedding (this wedding's vendors), all (the whole registry),
 * contacts, history (the registry across weddings), template.
 */

export async function GET(request: Request) {
  const g = await gate(true);
  if ("error" in g) return g.error;
  const { session } = g;
  const wedding = session.wedding;
  if (!wedding) return NextResponse.json({ error: "no wedding" }, { status: 400 });

  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") ?? "wedding";
  const format = url.searchParams.get("format") === "csv" ? "csv" : "xlsx";
  const supabase = await createClient();

  const [{ data: vendors }, regRes, contactsRes, { data: allVendors }] = await Promise.all([
    supabase.from("vendors").select("*").eq("wedding_id", wedding.id).order("created_at"),
    supabase.from("vendor_registry").select("*"),
    supabase.from("vendor_contacts").select("*"),
    supabase.from("vendors").select("id, name, category, stage, registry_id, wedding_id, weddings(couple_display_name)")
  ]);
  const registry = ((regRes as { data: unknown }).data ?? []) as VendorRegistry[];
  const contacts = ((contactsRes as { data: unknown }).data ?? []) as VendorContact[];
  const regOf = (id: string | null | undefined) => registry.find((r) => r.id === id);

  let rows: (string | number | null)[][];
  let name = kind;
  if (kind === "template") {
    rows = [
      ["Name", "Category", "Email", "Phone", "Website", "Instagram", "City", "Country", "Notes"],
      ["Maison Lumière", "Florals", "hello@maisonlumiere.fr", "+33 1 00 00 00 00", "maisonlumiere.fr", "@maisonlumiere", "Paris", "France", ""]
    ];
    name = "Import template";
  } else if (kind === "contacts") {
    rows = [
      ["Vendor", "Role", "Name", "Email", "Phone", "WhatsApp", "Notes"],
      ...contacts.map((c) => {
        const r = regOf(c.registry_id);
        return [r?.trading_name || r?.legal_name || "—", c.contact_role, c.name, c.email ?? null, c.phone ?? null, c.whatsapp ?? null, c.notes ?? null];
      })
    ];
    name = "Vendor contacts";
  } else if (kind === "history") {
    rows = [
      ["Vendor", "Wedding", "Stage"],
      ...((allVendors ?? []) as unknown as { name: string; stage: string; weddings: { couple_display_name: string } | null }[]).map(
        (v) => [v.name, v.weddings?.couple_display_name ?? "—", v.stage]
      )
    ];
    name = "Vendor wedding history";
  } else if (kind === "all") {
    rows = [
      ["Legal name", "Trading name", "Category", "City", "Country", "Email", "Phone", "Website", "Instagram", "Rating", "Tags"],
      ...registry.map((r) => [r.legal_name, r.trading_name ?? null, r.category, r.city ?? null, r.country ?? null, r.email ?? null, r.phone ?? null, r.website ?? null, r.instagram ?? null, r.rating ?? null, (r.tags ?? []).join(", ")])
    ];
    name = "Vendor registry";
  } else {
    rows = [
      ["Vendor", "Category", "Stage", "Email", "Phone", "City", "Country", "Contacted", "Contracted", "Archived"],
      ...((vendors ?? []) as Vendor[]).map((v) => {
        const r = regOf(v.registry_id);
        return [v.name, v.category, v.stage, r?.email ?? null, r?.phone ?? null, r?.city ?? null, r?.country ?? null, v.contacted_on ?? null, v.contracted_on ?? null, v.archived ? "yes" : ""];
      })
    ];
    name = "Vendors";
  }

  const day = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const base = `${wedding.couple_display_name} — ${name} — ${day}`;
  await logActivity(supabase, wedding.id, session.profile.full_name, "vendor_export", {
    kind, format, rows: Math.max(0, rows.length - 1), file: base
  });

  if (format === "csv") {
    const csv = rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
    return new NextResponse("﻿" + csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(base)}.csv`
      }
    });
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name.slice(0, 28));
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(base)}.xlsx`
    }
  });
}
