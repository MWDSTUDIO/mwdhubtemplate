import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireHouseSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import type { Vendor, VendorContact, VendorDocument, VendorRegistry } from "@/lib/types";
import { AddVendor, OutreachComposer, VendorDocDrop, VendorsTable, type VendorRow } from "./vendors-client";

/**
 * Vendors — who they are, where the relationship stands, what papers
 * they carry (PRD Vendors). One vendor record, one document record;
 * the figures stay Budget's and appear here read-only.
 */
export default async function VendorsPage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await requireHouseSession();
  const t = await getTranslations("vendors");
  const { wedding } = session;
  if (!wedding) return null;

  const supabase = await createClient();
  const [{ data: vendors }, { data: docs }, { data: lines }, registryRes, contactsRes] = await Promise.all([
    supabase.from("vendors").select("*").eq("wedding_id", wedding.id).order("created_at"),
    supabase.from("vendor_documents").select("*").eq("wedding_id", wedding.id),
    session.isTeam
      ? supabase.from("budget_lines").select("vendor_id, committed, paid, parent_line_id").eq("wedding_id", wedding.id)
      : Promise.resolve({ data: [] }),
    // Pre-0026 these tables are absent — the page keeps its manners.
    session.isTeam ? supabase.from("vendor_registry").select("*") : Promise.resolve({ data: [], error: null }),
    session.isTeam ? supabase.from("vendor_contacts").select("*") : Promise.resolve({ data: [], error: null })
  ]);

  const allVendors = (vendors ?? []) as Vendor[];
  const allDocs = (docs ?? []) as VendorDocument[];
  const registry = ((registryRes as { data: unknown }).data ?? []) as VendorRegistry[];
  const contacts = ((contactsRes as { data: unknown }).data ?? []) as VendorContact[];

  // Read-only financial summary, computed here, server-side, from
  // Budget's own rows — never edited from Vendors.
  const finance = new Map<string, { committed: number; paid: number }>();
  for (const l of (lines ?? []) as { vendor_id: string | null; committed: number | null; paid: number | null }[]) {
    if (!l.vendor_id) continue;
    const f = finance.get(l.vendor_id) ?? { committed: 0, paid: 0 };
    f.committed += Number(l.committed ?? 0);
    f.paid += Number(l.paid ?? 0);
    finance.set(l.vendor_id, f);
  }

  const mainContact = (v: Vendor) => {
    const reg = registry.find((r) => r.id === v.registry_id);
    const c = contacts
      .filter((x) => x.registry_id === v.registry_id)
      .sort((a, b) => (a.contact_role === "main" ? -1 : 1) - (b.contact_role === "main" ? -1 : 1))[0];
    return c ? c.name : reg?.email ?? null;
  };

  const rows: VendorRow[] = allVendors.map((v) => ({
    vendor: v,
    contact: mainContact(v),
    docs: allDocs.filter((d) => d.vendor_id === v.id && !d.archived).length,
    committed: finance.get(v.id)?.committed ?? null,
    paid: finance.get(v.id)?.paid ?? null,
    openActions: 0,
    lastActivity: v.last_activity_at ?? null
  }));

  return (
    <section className="sheet">
      <div className="eyebrow">{t("eyebrow")}</div>
      <h1 className="title">{t("headline")}</h1>
      <p className="lead">{t("lead")}</p>

      <div className="card">
        <VendorsTable
          weddingId={wedding.id}
          rows={rows}
          registrySnapshot={registry.map((r) => ({ id: r.id, legal_name: r.legal_name, trading_name: r.trading_name, email: r.email }))}
          isTeam={session.isTeam}
        />
        {session.isTeam && (
          <div id="vendor-add">
            <AddVendor weddingId={wedding.id} />
          </div>
        )}
      </div>

      {session.isTeam && (
        <>
          <div id="vendor-drop">
            <VendorDocDrop weddingId={wedding.id} vendors={allVendors.filter((v) => !v.archived)} />
          </div>
          <OutreachComposer weddingId={wedding.id} vendors={allVendors.filter((v) => !v.archived)} />
        </>
      )}
    </section>
  );
}
