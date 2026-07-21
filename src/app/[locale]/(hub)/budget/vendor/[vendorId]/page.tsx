import { getTranslations, setRequestLocale, getFormatter } from "next-intl/server";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { requireHouseSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptBanking, type BankingDetails } from "@/lib/banking";
import type { BudgetLine, BudgetLineItem, Payment } from "@/lib/types";
import { VendorNoteEditor, BankingEditor } from "./vendor-client";

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
  const [{ data: vendor }, { data: lines }, itemsRes, noteRes] = await Promise.all([
    supabase.from("vendors").select("*").eq("id", vendorId).eq("wedding_id", wedding.id).maybeSingle(),
    supabase.from("budget_lines").select("*").eq("vendor_id", vendorId).order("sort"),
    supabase.from("budget_line_items").select("*").eq("wedding_id", wedding.id).order("sort"),
    supabase.from("vendor_client_notes").select("*").eq("vendor_id", vendorId).maybeSingle()
  ]);
  if (!vendor) notFound();

  const vendorLines = (lines ?? []) as BudgetLine[];
  const lineIds = new Set(vendorLines.map((l) => l.id));
  const items = ((itemsRes.data ?? []) as BudgetLineItem[]).filter((it) => lineIds.has(it.budget_line_id));
  const note = noteRes.data as { body_raw: string | null; body: string | null; status: string } | null;

  const { data: payments } = await supabase
    .from("payments")
    .select("*")
    .eq("wedding_id", wedding.id)
    .order("due_date", { ascending: true, nullsFirst: false });
  const vendorPayments = ((payments ?? []) as Payment[]).filter(
    (p) => p.budget_line_id && lineIds.has(p.budget_line_id)
  );

  // Banking reaches the page only when an instalment carries the reveal.
  let banking: BankingDetails | null = null;
  if (vendorPayments.some((p) => p.reveal_banking)) {
    const admin = createAdminClient();
    const { data: enc } = await admin.from("vendor_banking").select("enc").eq("vendor_id", vendorId).maybeSingle();
    if (enc) banking = decryptBanking(enc.enc);
  }

  const money = (n: number | null | undefined, currency = "EUR") =>
    n == null ? "—" : format.number(n, { style: "currency", currency, maximumFractionDigits: 0 });

  const committed = vendorLines.reduce((s, l) => s + (l.committed ?? 0), 0);
  const paidTotal = vendorLines.reduce((s, l) => s + (l.paid ?? 0), 0);

  const groups = new Map<string, BudgetLineItem[]>();
  for (const it of items) {
    const k = it.event_label ?? t("noEvent");
    groups.set(k, [...(groups.get(k) ?? []), it]);
  }

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

      {groups.size > 0 ? (
        [...groups.entries()].map(([event, rows]) => (
          <div className="card" key={event}>
            <div className="eyebrow" style={{ color: "var(--bronze)", marginBottom: 10 }}>{event}</div>
            <div style={{ overflowX: "auto" }}>
              <table className="sheet-table">
                <thead>
                  <tr>
                    <th>{t("item")}</th>
                    <th className="num">{t("qty")}</th>
                    <th className="num">{t("unit")}</th>
                    <th className="num">HT</th>
                    <th className="num">{t("vat")}</th>
                    <th className="num">TTC</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((it) => (
                    <tr key={it.id}>
                      <td>{it.label}</td>
                      <td className="num">{it.qty ?? ""}</td>
                      <td className="num">{it.unit_price != null ? money(it.unit_price) : ""}</td>
                      <td className="num">{it.total_ht != null ? money(it.total_ht) : ""}</td>
                      <td className="num">{it.vat_pct != null ? `${it.vat_pct} %` : ""}</td>
                      <td className="num">{money(it.total_ttc ?? it.total_ht)}</td>
                    </tr>
                  ))}
                  <tr style={{ background: "var(--parchment)" }}>
                    <td>{t("subtotal")}</td>
                    <td colSpan={2}></td>
                    <td className="num">{money(rows.reduce((s, r) => s + Number(r.total_ht ?? 0), 0))}</td>
                    <td></td>
                    <td className="num"><b>{money(rows.reduce((s, r) => s + Number(r.total_ttc ?? r.total_ht ?? 0), 0))}</b></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        ))
      ) : (
        <div className="card">
          <p className="serif" style={{ fontStyle: "italic", color: "var(--ink2)" }}>{t("noItems")}</p>
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
              <p style={{ fontSize: 13.5, fontVariantNumeric: "tabular-nums" }}>
                {banking.holder && <>{banking.holder}<br /></>}
                IBAN&nbsp;: {banking.iban}
                {banking.swift && <><br />SWIFT&nbsp;: {banking.swift}</>}
                {banking.bank && <><br />{banking.bank}</>}
              </p>
              <p style={{ fontSize: 11.5, color: "var(--ink2)", marginTop: 6 }}>{t("banking.revealNote")}</p>
            </div>
          )}
        </div>
      )}

      {session.isTeam && (
        <div className="ia team-only">
          <div className="eyebrow">
            {t("banking.internalTitle")} <span className="tag int">{tc("internal")}</span>
          </div>
          <p style={{ marginTop: 8, fontSize: 13 }}>{t("banking.internalBlurb")}</p>
          <div style={{ marginTop: 8 }}>
            <BankingEditor weddingId={wedding.id} vendorId={vendorId} />
          </div>
        </div>
      )}
    </section>
  );
}
