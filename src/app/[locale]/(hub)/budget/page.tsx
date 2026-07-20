import { getTranslations, setRequestLocale, getFormatter } from "next-intl/server";
import { requireHouseSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import type { BudgetEnvelope, BudgetLine, EnvelopeNote } from "@/lib/types";
import {
  BudgetTabs,
  EnvelopeNoteEditor,
  MadameBudgetAdd,
  PublishBar,
  BudgetAsk,
  InternalNotes
} from "./budget-client";

export default async function BudgetPage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await requireHouseSession();
  const t = await getTranslations("budget");
  const tc = await getTranslations("common");
  const format = await getFormatter();
  const { wedding } = session;
  if (!wedding) return null;

  const supabase = await createClient();
  const [{ data: envelopes }, { data: notes }, { data: lines }, internalLatest] =
    await Promise.all([
      supabase.from("budget_envelopes").select("*").eq("wedding_id", wedding.id).order("sort"),
      supabase.from("envelope_notes").select("*").eq("wedding_id", wedding.id),
      supabase.from("budget_lines").select("*").eq("wedding_id", wedding.id).order("sort"),
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

  const allLines = (lines ?? []) as BudgetLine[];
  const visibleLines = allLines; // RLS already hides drafts from clients
  const draftCount = allLines.filter((l) => l.status === "draft").length;
  const noteFor = (envId: string) =>
    ((notes ?? []) as EnvelopeNote[]).find((n) => n.envelope_id === envId) ?? null;

  const money = (n: number | null | undefined) =>
    n == null ? "—" : format.number(n, { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

  const committed = allLines.reduce((s, l) => s + (l.committed ?? 0), 0);
  const paid = allLines.reduce((s, l) => s + (l.paid ?? 0), 0);
  const remaining = committed - paid;
  const total = wedding.budget_total ?? 0;

  const scopePanel = (
    <>
      <div className="card">
        <div className="eyebrow">{t("scope.title")}</div>
        <p style={{ margin: "10px 0 20px", fontSize: 13.5, color: "var(--ink2)" }}>
          {t("scope.blurb", { destination: wedding.destination })}
        </p>
        {(envelopes as BudgetEnvelope[] | null)?.map((env) => {
          const note = noteFor(env.id);
          const showNote = note && (note.status === "published" || session.isTeam);
          return (
            <div key={env.id}>
              <div className="env" style={showNote ? { borderBottom: "none" } : undefined}>
                <span>
                  {env.label}
                  {session.isTeam && (
                    <EnvelopeNoteEditor
                      envelopeId={env.id}
                      weddingId={wedding.id}
                      envelopeLabel={env.label}
                      existing={note?.body ?? null}
                      status={note?.status ?? null}
                    />
                  )}
                </span>
                {env.percent != null && <span className="serif num">{env.percent} %</span>}
              </div>
              {showNote && (
                <div className="envnote">
                  &ldquo;{note.body}&rdquo; — Estelle
                  {note.status === "draft" && (
                    <span className="tag int" style={{ marginLeft: 8 }}>{tc("draft")}</span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {session.isTeam && <MadameBudgetAdd weddingId={wedding.id} />}
    </>
  );

  const mgmtPanel = (
    <>
      {session.isTeam && <PublishBar weddingId={wedding.id} draftCount={draftCount} />}
      <div className="grid3" style={{ marginBottom: 18 }}>
        <div className="card" style={{ marginBottom: 0 }}>
          <div className="eyebrow">{t("mgmt.total")}</div>
          <div className="serif num" style={{ fontSize: 30 }}>{money(total)}</div>
        </div>
        <div className="card" style={{ marginBottom: 0 }}>
          <div className="eyebrow">{t("mgmt.paid")}</div>
          <div className="serif num" style={{ fontSize: 30 }}>{money(paid)}</div>
          {total > 0 && (
            <span style={{ fontSize: 12, color: "var(--ink2)" }}>
              {t("mgmt.ofBudget", { pct: Math.round((paid / total) * 100) })}
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
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 14, flexWrap: "wrap", marginBottom: 14 }}>
          <div className="eyebrow">{t("mgmt.lineByLine")}</div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="sheet-table">
            <thead>
              <tr>
                <th>{t("mgmt.line")}</th>
                <th>{t("mgmt.budgeted")}</th>
                <th>{t("mgmt.committed")}</th>
                <th>{t("mgmt.paidCol")}</th>
                <th>{t("mgmt.remainingCol")}</th>
                <th>{t("mgmt.nextPayment")}</th>
              </tr>
            </thead>
            <tbody>
              {visibleLines.map((line) => (
                <tr key={line.id}>
                  <td>
                    {line.label}
                    {line.status === "draft" && (
                      <span className="tag int" style={{ marginLeft: 8 }}>{tc("draft")}</span>
                    )}
                  </td>
                  <td className="num">{money(line.budgeted)}</td>
                  <td className="num">{line.committed != null ? money(line.committed) : line.committed_note ?? "—"}</td>
                  <td className="num">{line.paid ? money(line.paid) : "—"}</td>
                  <td className="num">
                    {line.committed != null ? money(line.committed - line.paid) : "—"}
                  </td>
                  <td>{line.next_payment_label ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="ia">
        <div className="eyebrow">{t("ask.title")}</div>
        <p style={{ marginTop: 10, fontSize: 13, color: "var(--ink2)" }}>{t("ask.blurb")}</p>
        {wedding.budget_analysis && (
          <>
            <hr className="hair" />
            <p className="ia-quote" style={{ fontSize: 16.5 }}>
              &ldquo;{wedding.budget_analysis}&rdquo;
            </p>
          </>
        )}
        <BudgetAsk weddingId={wedding.id} />
      </div>

      <div className="ia" style={{ marginTop: 14 }}>
        <div className="eyebrow">{t("docs.title")}</div>
        <p style={{ marginTop: 8, fontSize: 13.5 }}>{t("docs.blurb")}</p>
      </div>

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
