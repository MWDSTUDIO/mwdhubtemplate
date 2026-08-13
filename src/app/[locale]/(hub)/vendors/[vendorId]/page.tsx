import { getTranslations, setRequestLocale, getFormatter } from "next-intl/server";
import { redirect } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { requireHouseSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import type {
  Payment, Vendor, VendorContact, VendorDocument, VendorNote, VendorRegistry
} from "@/lib/types";
import { ContactsDesk, DocumentsDesk, NotesDesk, ProfileForm, RelationshipActions } from "./profile-client";
import { MomentLinks } from "@/components/moments-desk";

/**
 * The vendor profile (PRD §5) — one canonical record: identity,
 * relationship, contacts, papers, notes, wedding history, and a
 * read-only financial summary that belongs to Budget.
 */
export default async function VendorProfilePage({
  params
}: {
  params: Promise<{ locale: string; vendorId: string }>;
}) {
  const { locale, vendorId } = await params;
  setRequestLocale(locale);
  const session = await requireHouseSession();
  if (!session.isTeam) redirect(`/${locale}/vendors`);
  const t = await getTranslations("vendors.profile");
  const format = await getFormatter();
  const { wedding } = session;
  if (!wedding) return null;

  const supabase = await createClient();
  const { data: vendor } = await supabase
    .from("vendors").select("*").eq("id", vendorId).eq("wedding_id", wedding.id).single();
  if (!vendor) redirect(`/${locale}/vendors`);
  const v = vendor as Vendor;

  const [regRes, contactsRes, notesRes, { data: docs }, { data: lines }, { data: payments }, historyRes] =
    await Promise.all([
      v.registry_id
        ? supabase.from("vendor_registry").select("*").eq("id", v.registry_id).maybeSingle()
        : Promise.resolve({ data: null }),
      v.registry_id
        ? supabase.from("vendor_contacts").select("*").eq("registry_id", v.registry_id).order("sort")
        : Promise.resolve({ data: [] }),
      supabase.from("vendor_notes").select("*").eq("vendor_id", vendorId).order("created_at", { ascending: false }),
      supabase.from("vendor_documents").select("*").eq("vendor_id", vendorId),
      supabase.from("budget_lines").select("id, committed, paid").eq("vendor_id", vendorId),
      supabase
        .from("payments")
        .select("*")
        .in(
          "budget_line_id",
          (await supabase.from("budget_lines").select("id").eq("vendor_id", vendorId)).data?.map((x) => x.id) ?? ["-"]
        ),
      v.registry_id
        ? supabase
            .from("vendors")
            .select("id, wedding_id, stage, weddings(couple_display_name, date_start)")
            .eq("registry_id", v.registry_id)
            .neq("id", vendorId)
        : Promise.resolve({ data: [] })
    ]);

  const registry = ((regRes as { data: unknown }).data ?? null) as VendorRegistry | null;
  const contacts = ((contactsRes as { data: unknown }).data ?? []) as VendorContact[];
  const notes = ((notesRes as { data: unknown }).data ?? []) as VendorNote[];
  const papers = ((docs ?? []) as VendorDocument[]);
  const history = ((historyRes as { data: unknown }).data ?? []) as {
    id: string; stage: string; weddings: { couple_display_name: string; date_start: string | null } | null;
  }[];

  // Read-only, from Budget's rows — the button below opens the real desk.
  const committed = ((lines ?? []) as { committed: number | null }[]).reduce((s, l) => s + Number(l.committed ?? 0), 0);
  const paid = ((lines ?? []) as { paid: number | null }[]).reduce((s, l) => s + Number(l.paid ?? 0), 0);
  const next = ((payments ?? []) as Payment[])
    .filter((p) => !p.paid_at && p.due_date)
    .sort((a, b) => (a.due_date! < b.due_date! ? -1 : 1))[0];
  const eur = (n: number) => format.number(n, { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

  // Papers open through /api/vendor-documents/[id]/download — access
  // judged on every click, the Documents room's own mechanism. No URL
  // is signed at render, so nothing can expire in the page's hands.

  return (
    <section className="sheet">
      <div className="eyebrow">{t("eyebrow")}</div>
      <h1 className="title">{v.name}</h1>
      <p className="lead" style={{ marginBottom: 20 }}>
        {v.category}
        {registry?.city ? ` · ${registry.city}` : ""}{registry?.country ? `, ${registry.country}` : ""}
      </p>

      <RelationshipActions weddingId={wedding.id} vendor={v} />

      <div style={{ margin: "10px 0 16px" }}>
        <MomentLinks weddingId={wedding.id} module="vendor" recordId={v.id} />
      </div>

      <div className="grid2" style={{ alignItems: "start" }}>
        <div>
          <ProfileForm weddingId={wedding.id} vendor={v} registry={registry} />
          {registry && <ContactsDesk registryId={registry.id} contacts={contacts} />}
          <NotesDesk weddingId={wedding.id} vendorId={v.id} notes={notes} />
        </div>
        <div>
          {/* ── the financial summary — Budget's figures, read only ── */}
          <div className="card">
            <div className="eyebrow" style={{ marginBottom: 8 }}>{t("finTitle")}</div>
            <table className="sheet-table" style={{ fontSize: 13.5 }}>
              <tbody>
                <tr><td>{t("finCommitted")}</td><td className="num">{eur(committed)}</td></tr>
                <tr><td>{t("finPaid")}</td><td className="num">{eur(paid)}</td></tr>
                <tr><td>{t("finRemaining")}</td><td className="num">{eur(Math.max(0, committed - paid))}</td></tr>
                <tr>
                  <td>{t("finNext")}</td>
                  <td className="num">
                    {next ? `${eur(Number(next.amount))} · ${next.due_date}` : "—"}
                  </td>
                </tr>
              </tbody>
            </table>
            <p style={{ fontSize: 12, color: "var(--ink2)", margin: "8px 0 10px" }}>{t("finNote")}</p>
            <Link className="btn ghost sm" href={`/budget/vendor/${v.id}`} style={{ textDecoration: "none" }}>
              {t("openInBudget")}
            </Link>
          </div>

          <DocumentsDesk weddingId={wedding.id} vendorId={v.id} docs={papers} />

          {/* ── other weddings, same house profile ── */}
          {history.length > 0 && (
            <div className="card">
              <div className="eyebrow" style={{ marginBottom: 8 }}>{t("historyTitle")}</div>
              <ul className="steps">
                {history.map((h) => (
                  <li key={h.id}>
                    <span className="d">{h.weddings?.date_start?.slice(0, 4) ?? "—"}</span>
                    <span>{h.weddings?.couple_display_name ?? "—"} · {t(`stageWord`, { stage: h.stage })}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* ── messages live in their own room ── */}
          <div className="card">
            <div className="eyebrow" style={{ marginBottom: 6 }}>{t("messagesTitle")}</div>
            <p style={{ fontSize: 13, color: "var(--ink2)", margin: "0 0 10px" }}>{t("messagesBlurb")}</p>
            <Link className="btn ghost sm" href="/messages" style={{ textDecoration: "none" }}>
              {t("openMessages")}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
