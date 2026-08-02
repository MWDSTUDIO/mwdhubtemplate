import { getTranslations, setRequestLocale, getFormatter } from "next-intl/server";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { requireHouseSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptProfile, type BankingProfile } from "@/lib/banking";
import { ibanGroups } from "@/lib/banking-checks";
import { logActivity } from "@/lib/activity";
import type { BudgetLine, BudgetLineItem, Payment } from "@/lib/types";
import { VendorNoteEditor, BankingDesk, CopyLine, QuoteItems, VendorMeta, FicheDocDrop } from "./vendor-client";

/**
 * The vendor sheet — what the couple pays this house, in full clarity:
 * the quote's lines by event, the payment schedule, the house's note.
 * Exportable as a PDF signed with the house's mark. Banking details
 * appear only where an instalment carries the explicit reveal.
 */
export default async function VendorSheetPage({
  params
}: {
  params: Promise<{ locale: string; vendorId: string }>;
}) {
  const { locale, vendorId } = await params;
  setRequestLocale(locale);
  const session = await requireHouseSession();
  const t = await getTranslations("budget.fiche");
  const tc = await getTranslations("common");
  const format = await getFormatter();
  const { wedding } = session;
  if (!wedding) return null;

  const supabase = await createClient();
  // Everything independent leaves in one burst (vitesse brief §8);
  // only the banking decrypt, which depends on the reveal flags,
  // waits behind it.
  const [{ data: vendor }, { data: lines }, itemsRes, noteRes, paymentsRes, readingsRes, metaRes, envelopesRes, papersRes] =
    await Promise.all([
      supabase.from("vendors").select("*").eq("id", vendorId).eq("wedding_id", wedding.id).maybeSingle(),
      supabase.from("budget_lines").select("*").eq("vendor_id", vendorId).order("sort"),
      supabase.from("budget_line_items").select("*").eq("wedding_id", wedding.id).order("sort"),
      supabase.from("vendor_client_notes").select("*").eq("vendor_id", vendorId).maybeSingle(),
      supabase
        .from("payments")
        .select("*")
        .eq("wedding_id", wedding.id)
        .order("due_date", { ascending: true, nullsFirst: false }),
      session.isTeam
        ? supabase
            .from("document_readings")
            .select("id, label, payload, created_at")
            .eq("wedding_id", wedding.id)
            .eq("vendor_id", vendorId)
            .eq("status", "proposed")
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: null }),
      session.isTeam
        ? supabase.from("vendor_banking").select("*").eq("vendor_id", vendorId).maybeSingle<Record<string, unknown>>()
        : Promise.resolve({ data: null }),
      session.isTeam
        ? supabase.from("budget_envelopes").select("id, label").eq("wedding_id", wedding.id).order("sort")
        : Promise.resolve({ data: null }),
      session.isTeam
        ? supabase
            .from("vendor_documents")
            .select("id, type, label, storage_path")
            .eq("vendor_id", vendorId)
        : Promise.resolve({ data: null })
    ]);
  if (!vendor) notFound();

  const vendorLines = (lines ?? []) as BudgetLine[];
  const lineIds = new Set(vendorLines.map((l) => l.id));
  const items = ((itemsRes.data ?? []) as BudgetLineItem[]).filter((it) => lineIds.has(it.budget_line_id));
  const note = noteRes.data as { body_raw: string | null; body: string | null; status: string } | null;

  const vendorPayments = ((paymentsRes.data ?? []) as Payment[]).filter(
    (p) => p.budget_line_id && lineIds.has(p.budget_line_id)
  );

  // Banking reaches the page only when an instalment carries the
  // reveal — and, once migration 0016 stands, only when a human of
  // the house has verified the coordinates out of band (§5, §8).
  // Every clear-text rendering leaves a trace (§9), never the
  // coordinates themselves.
  let banking: BankingProfile | null = null;
  if (vendorPayments.some((p) => p.reveal_banking)) {
    const admin = createAdminClient();
    const { data: row } = await admin
      .from("vendor_banking")
      .select("*")
      .eq("vendor_id", vendorId)
      .maybeSingle<{ enc: string; status?: string }>();
    const verifiedOrLegacy = row && (row.status === undefined || row.status === null || row.status === "verified");
    if (row && verifiedOrLegacy) {
      banking = decryptProfile(row.enc);
      await logActivity(
        admin,
        wedding.id,
        session.isTeam ? session.profile.full_name : wedding.couple_display_name,
        "banking_access",
        { vendorId, via: "vendor_sheet" }
      );
    }
  }

  // The banking readings awaiting Estelle's eye — this vendor's only.
  const bankingReadings = (readingsRes.data ?? []).filter(
    (r) => (r.payload as { kind?: string } | null)?.kind === "banking"
  );

  // The verification state, without ever decrypting for display here.
  let bankingMeta: {
    exists: boolean;
    status: string;
    verified_by: string | null;
    verified_at: string | null;
    verification_method: string | null;
    pending_read_at: string | null;
  } | null = null;
  if (session.isTeam) {
    const metaRow = metaRes.data;
    if (metaRow) {
      bankingMeta = {
        exists: true,
        status: (metaRow.status as string) ?? "legacy",
        verified_by: (metaRow.verified_by as string) ?? null,
        verified_at: (metaRow.verified_at as string) ?? null,
        verification_method: (metaRow.verification_method as string) ?? null,
        pending_read_at: (metaRow.pending_read_at as string) ?? null
      };
    } else {
      bankingMeta = { exists: false, status: "none", verified_by: null, verified_at: null, verification_method: null, pending_read_at: null };
    }
  }

  const money = (n: number | null | undefined, currency = "EUR") =>
    n == null ? "—" : format.number(n, { style: "currency", currency, maximumFractionDigits: 0 });

  // The vendor's papers, with a one-hour signed door to each original.
  const papers: { id: string; type: string; label: string; url: string | null }[] = [];
  if (session.isTeam) {
    for (const d of papersRes.data ?? []) {
      let url: string | null = null;
      if (d.storage_path?.startsWith("internal/")) {
        const { data: signed } = await supabase.storage
          .from("internal")
          .createSignedUrl(d.storage_path.slice("internal/".length), 3600);
        url = signed?.signedUrl ?? null;
      }
      papers.push({ id: d.id, type: d.type, label: d.label, url });
    }
  }

  const committed = vendorLines.reduce((s, l) => s + (l.committed ?? 0), 0);
  const paidTotal = vendorLines.reduce((s, l) => s + (l.paid ?? 0), 0);

  return (
    <section className="sheet">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div className="eyebrow">{t("eyebrow", { category: vendor.category })}</div>
          <h1 className="title" style={{ fontStyle: "italic" }}>{vendor.name}</h1>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <a className="btn ghost" href={`/api/pdf/vendor/${vendorId}`} target="_blank" rel="noreferrer">
            {t("exportPdf")}
          </a>
          <Link className="btn ghost" href="/budget">{t("backToBudget")}</Link>
        </div>
      </div>
      <p className="lead" style={{ marginTop: 6 }}>
        {t("lead", { couple: wedding.couple_display_name })}
      </p>

      {session.isTeam && (
        <VendorMeta
          weddingId={wedding.id}
          vendorId={vendorId}
          category={vendor.category}
          envelopeId={(vendor as { envelope_id?: string | null }).envelope_id ?? null}
          envelopes={(envelopesRes.data ?? []) as { id: string; label: string }[]}
        />
      )}

      <div className="grid3" style={{ marginBottom: 18 }}>
        <div className="card" style={{ marginBottom: 0 }}>
          <div className="eyebrow">{t("contract")}</div>
          <div className="serif num" style={{ fontSize: 28 }}>{money(committed)}</div>
        </div>
        <div className="card" style={{ marginBottom: 0 }}>
          <div className="eyebrow">{t("paid")}</div>
          <div className="serif num" style={{ fontSize: 28 }}>{money(paidTotal)}</div>
        </div>
        <div className="card" style={{ marginBottom: 0 }}>
          <div className="eyebrow">{t("remaining")}</div>
          <div className="serif num" style={{ fontSize: 28 }}>{money(committed - paidTotal)}</div>
        </div>
      </div>

      {(note?.body && (note.status === "published" || session.isTeam)) && (
        <div className="card" style={{ background: "var(--parchment)" }}>
          <p className="serif" style={{ fontStyle: "italic", fontSize: 17, lineHeight: 1.65 }}>
            &ldquo;{note.body}&rdquo; — Estelle
          </p>
          {session.isTeam && note.status === "draft" && (
            <span className="tag int" style={{ marginTop: 8 }}>{tc("draft")}</span>
          )}
          {session.isTeam && note.body_raw && (
            <p className="team-only" style={{ fontSize: 12, color: "var(--ink2)", marginTop: 10 }}>
              {t("note.rawShown")}: {note.body_raw}
            </p>
          )}
        </div>
      )}
      {session.isTeam && (
        <div className="team-only" style={{ margin: "0 0 16px" }}>
          <VendorNoteEditor
            weddingId={wedding.id}
            vendorId={vendorId}
            initialRaw={note?.body_raw ?? ""}
            initialBody={note?.body ?? ""}
            status={(note?.status as "draft" | "published") ?? null}
          />
        </div>
      )}

      {/* The quote's lines — read by the couple, held by the team:
          a reading fills them, a hand corrects them (bloc 4's rule). */}
      <QuoteItems
        weddingId={wedding.id}
        lines={vendorLines.map((l) => ({ id: l.id, label: l.label }))}
        items={items}
        isTeam={session.isTeam}
        envelopes={(envelopesRes.data ?? []) as { id: string; label: string }[]}
      />

      {/* The vendor's papers — dropped here, on the vendor itself:
          a contract, a proposal, an invoice; the analyst reads whole
          and the reading awaits Estelle's word in the Budget. */}
      {session.isTeam && (
        <div className="card team-only">
          <div className="eyebrow">{t("papers.title")}</div>
          {papers.length === 0 && (
            <p style={{ fontSize: 13, color: "var(--ink2)", marginTop: 8 }}>{t("papers.empty")}</p>
          )}
          {papers.length > 0 && (
            <ul style={{ margin: "8px 0 0", padding: 0, listStyle: "none" }}>
              {papers.map((d) => (
                <li key={d.id} style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "5px 0", flexWrap: "wrap" }}>
                  <span className="tag">{t(`papers.type_${d.type}`)}</span>
                  <span style={{ flex: "1 1 200px" }}>{d.label}</span>
                  {d.url && (
                    <a className="addnote" href={d.url} target="_blank" rel="noreferrer">
                      {t("papers.open")}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
          <FicheDocDrop weddingId={wedding.id} vendorId={vendorId} />
        </div>
      )}


      {vendorPayments.length > 0 && (
        <div className="card">
          <div className="eyebrow" style={{ marginBottom: 10 }}>{t("schedule")}</div>
          <div style={{ overflowX: "auto" }}>
            <table className="sheet-table">
              <tbody>
                {vendorPayments.map((p) => (
                  <tr key={p.id}>
                    <td>{p.label}</td>
                    <td className="num">{money(p.amount, p.currency || "EUR")}</td>
                    <td>{p.due_date ? format.dateTime(new Date(p.due_date), { day: "numeric", month: "long", year: "numeric" }) : "—"}</td>
                    <td>
                      {p.refundable && <span className="tag">{t("refundable")}</span>}{" "}
                      {p.paid_at ? <span className="tag ok">{t("settled")}</span> : <span className="tag wait">{t("upcoming")}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {banking && (
            <div style={{ marginTop: 14, background: "var(--parchment)", padding: "14px 16px" }}>
              <div className="eyebrow" style={{ marginBottom: 6 }}>{t("banking.title")}</div>
              <div style={{ fontSize: 14.5, fontVariantNumeric: "tabular-nums", lineHeight: 1.7 }}>
                {banking.beneficiary?.legal_name && <div>{banking.beneficiary.legal_name}</div>}
                {banking.account?.iban && (
                  <CopyLine label="IBAN" value={ibanGroups(banking.account.iban)} copyValue={banking.account.iban.replace(/\s+/g, "")} />
                )}
                {banking.account?.bic && <CopyLine label="BIC" value={banking.account.bic} copyValue={banking.account.bic} />}
                {banking.account?.sort_code && <CopyLine label="Sort code" value={banking.account.sort_code} copyValue={banking.account.sort_code} />}
                {banking.account?.account_number && (
                  <CopyLine label={t("banking.accountNumber")} value={banking.account.account_number} copyValue={banking.account.account_number} />
                )}
                {banking.bank?.name && <div>{banking.bank.name}</div>}
                {banking.terms?.payment_reference && (
                  <CopyLine label={t("banking.reference")} value={banking.terms.payment_reference} copyValue={banking.terms.payment_reference} />
                )}
              </div>
              {/* The sentence that protects better than any device (§8):
                  the couple emits the wire. */}
              <p style={{ fontSize: 13, color: "var(--ink2)", marginTop: 10 }}>{t("banking.neverByEmail")}</p>
              <p style={{ fontSize: 12.5, color: "var(--ink2)", marginTop: 4 }}>{t("banking.revealNote")}</p>
            </div>
          )}
        </div>
      )}

      {session.isTeam && bankingMeta && (
        <div className="ia team-only">
          <div className="eyebrow">
            {t("banking.internalTitle")} <span className="tag int">{tc("internal")}</span>
          </div>
          <p style={{ marginTop: 8, fontSize: 13 }}>{t("banking.internalBlurb")}</p>
          <div style={{ marginTop: 8 }}>
            <BankingDesk
              weddingId={wedding.id}
              vendorId={vendorId}
              meta={bankingMeta}
              readings={bankingReadings.map((r) => ({
                id: r.id,
                label: r.label,
                created_at: r.created_at,
                payload: r.payload as Record<string, unknown>
              }))}
            />
          </div>
        </div>
      )}
    </section>
  );
}
