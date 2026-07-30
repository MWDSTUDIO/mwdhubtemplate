import { getTranslations, setRequestLocale, getFormatter } from "next-intl/server";
import { requireHouseSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import type {
  BudgetEnvelope,
  BudgetLine,
  BudgetLineItem,
  BudgetRisk,
  EnvelopeNote,
  Payment
} from "@/lib/types";
import {
  BudgetTabs,
  MadameBudgetAdd,
  PublishBar,
  BudgetAsk,
  BudgetDocDrop,
  InternalNotes
} from "./budget-client";
import { ScopeStudio, ScopeAnalysisDrop } from "./scope-client";
import { PaymentsCalendar, RiskBuffer } from "./mgmt-client";
import { BudgetViews } from "./ledger-client";
import { ReadingsDesk, type ReadingPayload, type ReadingRow } from "./readings-client";
import { barModel, pctOfBudget, coherence } from "@/lib/budget-math";
import { lineEurValues, sumMoney } from "@/lib/money";

export default async function BudgetPage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await requireHouseSession();
  const t = await getTranslations("budget");
  const format = await getFormatter();
  const { wedding } = session;
  if (!wedding) return null;

  const supabase = await createClient();
  const [
    { data: envelopes },
    { data: notes },
    { data: lines },
    { data: payments },
    itemsRes,
    risksRes,
    internalLatest
  ] = await Promise.all([
    supabase.from("budget_envelopes").select("*").eq("wedding_id", wedding.id).order("sort"),
    supabase.from("envelope_notes").select("*").eq("wedding_id", wedding.id),
    supabase.from("budget_lines").select("*").eq("wedding_id", wedding.id).order("sort"),
    supabase
      .from("payments")
      .select("*")
      .eq("wedding_id", wedding.id)
      .order("due_date", { ascending: true, nullsFirst: false }),
    // Absent until migration 0011 — the page stands without them.
    supabase.from("budget_line_items").select("*").eq("wedding_id", wedding.id).order("sort"),
    session.isTeam
      ? supabase.from("budget_risks").select("*").eq("wedding_id", wedding.id).order("sort")
      : Promise.resolve({ data: null, error: null }),
    session.isTeam
      ? supabase
          .from("internal_budget_notes")
          .select("body")
          .eq("wedding_id", wedding.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null })
  ]);

  // The analyst's desk — readings proposed by a dropped document,
  // awaiting Estelle's word (absent until migration 0013).
  const readingsRes = session.isTeam
    ? await supabase
        .from("document_readings")
        .select("*, vendors(name)")
        .eq("wedding_id", wedding.id)
        .eq("status", "proposed")
        .order("created_at", { ascending: false })
    : { data: null };

  const allLines = (lines ?? []) as BudgetLine[];
  const allPayments = (payments ?? []) as Payment[];
  const items = (itemsRes.data ?? []) as BudgetLineItem[];
  const risks = (risksRes.data ?? []) as BudgetRisk[];
  const risksAvailable = !risksRes.error;
  const draftCount = allLines.filter((l) => l.status === "draft").length;

  const money = (n: number | null | undefined) =>
    n == null ? "—" : format.number(n, { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

  // Credits fold into their parent, so totals never double-count.
  // Totals are computed HERE, server-side, and never mix currencies
  // without a traced conversion (application-financière §1.1, §1.5):
  // a foreign line without a held rate stands apart, named to the team.
  const eurLines = allLines.map((l) => ({ l, v: lineEurValues(l) }));
  const committed = sumMoney(eurLines.map(({ v }) => (v.converted ? v.committedEur : 0)));
  const paid = sumMoney(eurLines.map(({ v }) => (v.converted ? v.paidEur : 0)));
  const unconverted = eurLines.filter(({ v }) => !v.converted).map(({ l }) => l.label);
  const remaining = committed - paid;
  const total = wedding.budget_total ?? 0;

  const committedByEnvelope: Record<string, number> = {};
  for (const { l, v } of eurLines) {
    if (l.envelope_id && v.converted) {
      committedByEnvelope[l.envelope_id] = (committedByEnvelope[l.envelope_id] ?? 0) + v.committedEur;
    }
  }

  const nextByLine: Record<string, string> = {};
  for (const p of allPayments) {
    if (!p.budget_line_id || p.paid_at || nextByLine[p.budget_line_id]) continue;
    const when = p.due_date
      ? format.dateTime(new Date(p.due_date), { day: "numeric", month: "short", year: "numeric" })
      : null;
    const cur = p.currency && p.currency !== "EUR" ? p.currency : "EUR";
    nextByLine[p.budget_line_id] =
      `${format.number(p.amount, { style: "currency", currency: cur, maximumFractionDigits: 0 })}${when ? ` · ${when}` : ""}`;
  }

  const lineLabels: Record<string, string> = Object.fromEntries(allLines.map((l) => [l.id, l.label]));

  // Each reading beside what the hub currently holds for its vendor.
  // Banking readings live on the vendor sheet, never on this desk.
  const readingRows = (readingsRes.data ?? []).filter(
    (r) => (r.payload as { kind?: string } | null)?.kind !== "banking"
  );
  const readings: ReadingRow[] = readingRows.map((r) => {
    const line = allLines.find((l) => l.vendor_id === r.vendor_id && !l.parent_line_id);
    const lineItems = line ? items.filter((it) => it.budget_line_id === line.id) : [];
    const linePayments = line
      ? allPayments.filter((p) => p.budget_line_id === line.id && !p.paid_at)
      : [];
    return {
      id: r.id,
      label: r.label,
      created_at: r.created_at,
      vendorName: (r.vendors as { name?: string } | null)?.name ?? null,
      payload: r.payload as ReadingPayload,
      current: {
        committed: line?.committed ?? null,
        itemsCount: lineItems.length,
        itemsTotal: lineItems.reduce((s, it) => s + Number(it.total_ttc ?? it.total_ht ?? 0), 0),
        paymentsCount: linePayments.length,
        paymentsTotal: linePayments.reduce((s, p) => s + Number(p.amount ?? 0), 0)
      }
    };
  });

  const scopePanel = (
    <>
      <div className="card" style={{ background: "var(--parchment)", border: "1px solid var(--line)" }}>
        <div className="eyebrow">{t("scope.title")}</div>
        <p style={{ margin: "10px 0 0", fontSize: 13.5, color: "var(--ink2)" }}>
          {t("scope.blurb", { destination: wedding.destination })}
        </p>
      </div>
      <ScopeStudio
        weddingId={wedding.id}
        total={total}
        envelopes={(envelopes ?? []) as BudgetEnvelope[]}
        committedByEnvelope={committedByEnvelope}
        notes={(notes ?? []) as EnvelopeNote[]}
        isTeam={session.isTeam}
      />
      {session.isTeam && <ScopeAnalysisDrop weddingId={wedding.id} />}
      {session.isTeam && <MadameBudgetAdd weddingId={wedding.id} />}
    </>
  );

  const mgmtPanel = (
    <>
      {session.isTeam && <PublishBar weddingId={wedding.id} draftCount={draftCount} />}

      {session.isTeam && <ReadingsDesk readings={readings} />}
      <div className="grid3" style={{ marginBottom: 18 }}>
        <div className="card" style={{ marginBottom: 0 }}>
          <div className="eyebrow">{t("mgmt.total")}</div>
          <div className="serif num" style={{ fontSize: 30 }}>{money(total)}</div>
          {/* An overrun is said in words, never left to a minus sign (§2). */}
          {total > 0 && committed > total && (
            <span style={{ fontSize: 13.5, color: "var(--bronze)", fontWeight: 500 }}>
              {t("mgmt.beyondBudget", { amount: money(committed - total) })}
            </span>
          )}
          {total > 0 && committed <= total && (
            <span style={{ fontSize: 12, color: "var(--ink2)" }}>
              {t("mgmt.leftToAllot", { amount: money(total - committed) })}
            </span>
          )}
          {total === 0 && session.isTeam && (
            <span style={{ fontSize: 12, color: "var(--bronze)" }}>{t("mgmt.setInDesk")}</span>
          )}
        </div>
        <div className="card" style={{ marginBottom: 0 }}>
          <div className="eyebrow">{t("mgmt.paid")}</div>
          <div className="serif num" style={{ fontSize: 30 }}>{money(paid)}</div>
          {/* The label says "of budget" — so the calculation does too (§1). */}
          {pctOfBudget(paid, total) != null && (
            <span style={{ fontSize: 12, color: "var(--ink2)" }}>
              {t("mgmt.ofBudget", { pct: pctOfBudget(paid, total)! })}
            </span>
          )}
        </div>
        <div className="card" style={{ marginBottom: 0 }}>
          <div className="eyebrow">{t("mgmt.remaining")}</div>
          <div className="serif num" style={{ fontSize: 30 }}>{money(remaining)}</div>
          <span style={{ fontSize: 12, color: "var(--ink2)" }}>
            {t("mgmt.ofCommitted", { amount: money(committed) })}
          </span>
        </div>
      </div>

      {/* One bar answers "where do we stand?" — same scale for the
          within-budget and the overrun regimes, the allotted budget
          always marked (§3). Named amounts beside every percentage. */}
      {(total > 0 || committed > 0) && (() => {
        const m = barModel({ total, committed, paid });
        // The envelopes (plus the unassigned bucket) must retile the
        // committed exactly — anything else is a data anomaly (§6).
        const envelopeSum =
          Object.values(committedByEnvelope).reduce((s, v) => s + v, 0) +
          eurLines
            .filter(({ l, v }) => !l.envelope_id && v.converted)
            .reduce((s, { v }) => s + v.committedEur, 0);
        const c = coherence({ total, committed, paid }, envelopeSum);
        return (
          <div className="card" style={{ marginBottom: 18 }}>
            <div className="bbar" role="img" aria-label={t("bar.aria")}>
              {m.paidPct > 0 && <span className="bbar-paid" style={{ width: `${m.paidPct}%` }} />}
              {m.stillToPayPct > 0 && <span className="bbar-due" style={{ width: `${m.stillToPayPct}%` }} />}
              {m.beyondPct > 0 && (
                <span className="bbar-beyond" style={{ left: `${m.markerPct}%`, width: `${m.beyondPct}%` }} />
              )}
              {total > 0 && <span className="bbar-mark" style={{ left: `${m.markerPct}%` }} title={t("bar.mark")} />}
            </div>
            <div className="bbar-legend">
              {/* A percentage exists only when its denominator does:
                  with no allotted budget, amounts stand alone. */}
              <span>
                <i className="bbar-dot dot-paid" aria-hidden="true" />
                {total > 0 ? t("bar.paid", { amount: money(m.paid), pct: pctOfBudget(m.paid, total)! }) : t("mgmt.paid") + " " + money(m.paid)}
              </span>
              <span>
                <i className="bbar-dot dot-due" aria-hidden="true" />
                {total > 0 ? t("bar.stillToPay", { amount: money(m.stillToPay), pct: pctOfBudget(m.stillToPay, total)! }) : t("mgmt.remaining") + " " + money(m.stillToPay)}
              </span>
              {m.stillToEngage > 0 && total > 0 && (
                <span><i className="bbar-dot dot-free" aria-hidden="true" />{t("bar.stillToEngage", { amount: money(m.stillToEngage), pct: pctOfBudget(m.stillToEngage, total)! })}</span>
              )}
              {m.beyond > 0 && (
                <span style={{ color: "var(--bronze)", fontWeight: 500 }}>
                  <i className="bbar-dot dot-beyond" aria-hidden="true" />
                  {t("bar.beyond", { amount: money(m.beyond) })}
                </span>
              )}
              <span style={{ marginLeft: "auto", color: "var(--ink2)" }}>
                {t("bar.committedIs", { amount: money(committed) })}
              </span>
            </div>
            {session.isTeam && unconverted.length > 0 && (
              <p className="team-only" role="alert" style={{ fontSize: 12.5, color: "var(--bronze)", marginTop: 8 }}>
                {t("bar.unconverted", { labels: unconverted.join(" · ") })}
              </p>
            )}
            {/* A broken identity is a data anomaly — said to the team,
                never to the couple (§6). */}
            {session.isTeam && !c.envelopeIdentity && (
              <p className="team-only" role="alert" style={{ fontSize: 12.5, color: "var(--bronze)", marginTop: 8 }}>
                {t("bar.anomaly", { sum: money(envelopeSum), committed: money(committed) })}
              </p>
            )}
          </div>
        );
      })()}

      <BudgetViews
        weddingId={wedding.id}
        lines={allLines}
        items={items}
        payments={allPayments}
        envelopes={(envelopes ?? []) as BudgetEnvelope[]}
        envelopeNotes={(notes ?? []) as EnvelopeNote[]}
        nextByLine={nextByLine}
        isTeam={session.isTeam}
      />

      {session.isTeam && (
        <PaymentsCalendar
          payments={allPayments}
          lineLabels={lineLabels}
          weddingId={wedding.id}
          lines={allLines}
          isTeam={session.isTeam}
        />
      )}

      {/* The house's analysis reads to everyone; Madame answers the
          team alone — the client's questions go to the house itself. */}
      {(wedding.budget_analysis || session.isTeam) && (
        <div className="ia">
          <div className="eyebrow">{t("ask.title")}</div>
          {session.isTeam && (
            <p className="team-only" style={{ marginTop: 10, fontSize: 13, color: "var(--ink2)" }}>{t("ask.blurb")}</p>
          )}
          {wedding.budget_analysis && (
            <>
              <hr className="hair" />
              <p className="ia-quote" style={{ fontSize: 16.5 }}>
                &ldquo;{wedding.budget_analysis}&rdquo;
              </p>
            </>
          )}
          {session.isTeam && <BudgetAsk weddingId={wedding.id} />}
        </div>
      )}

      {session.isTeam && (
        <div className="ia team-only" style={{ marginTop: 14 }}>
          <div className="eyebrow">{t("docs.title")}</div>
          <p style={{ marginTop: 8, fontSize: 13.5 }}>{t("docs.blurb")}</p>
          <BudgetDocDrop weddingId={wedding.id} />
        </div>
      )}

      {session.isTeam && (
        <RiskBuffer weddingId={wedding.id} risks={risks} available={risksAvailable} />
      )}

      {session.isTeam && (
        <InternalNotes weddingId={wedding.id} latest={internalLatest.data?.body ?? null} />
      )}
    </>
  );

  return (
    <section className="sheet">
      <div className="eyebrow">{t("eyebrow")}</div>
      <h1 className="title">{t("headline")}</h1>
      <p className="lead">{t("lead")}</p>
      <BudgetTabs scope={scopePanel} mgmt={mgmtPanel} />
    </section>
  );
}
