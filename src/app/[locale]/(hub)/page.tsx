import type { ReactNode } from "react";
import { getTranslations, getFormatter, setRequestLocale } from "next-intl/server";
import { requireHouseSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { AskHouse } from "@/components/AskHouse";
import { ProposeMoment } from "@/components/ProposeMoment";
import { ProposedMoments } from "@/components/ProposedMoments";
import { HomeConfigDesk } from "@/components/home-sections";
import type { Attention, AvailabilityProposal, Ceremony, InternalTask, Milestone, MilestoneOps, MonthlyNote } from "@/lib/types";
import { Link } from "@/i18n/navigation";
import { HouseProse } from "@/lib/house-prose";
import { lineEurValues, sumMoney, isSettledPayment } from "@/lib/money";
import { ceremonyReadiness } from "@/lib/ceremony";
import {
  clientSentenceKey,
  isHidden,
  rsvpAggregate,
  sectionOrder,
  teamPriorities,
  timelineProgress,
  vendorBuckets,
  type HomeConfig,
  type HomeSection
} from "@/lib/home";

/**
 * Home — the entrance hall of The Inner House (PRD Home): the calm
 * overview. It OWNS nothing but its presentation; every figure below
 * is consumed live from the canonical module, never duplicated. Each
 * source is guarded — one failing room never darkens the hall.
 */
export default async function HomePage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await requireHouseSession();
  const t = await getTranslations("home");
  const tc = await getTranslations("common");
  const format = await getFormatter();
  const { wedding } = session;

  if (!wedding) {
    return (
      <section className="sheet">
        <h1 className="title">{t("noWedding")}</h1>
      </section>
    );
  }

  const supabase = await createClient();
  const isTeam = session.isTeam;
  const today = new Date().toISOString().slice(0, 10);
  const monthKey = `${today.slice(0, 7)}-01`;

  // One burst, one wait (vitesse brief §8). Every result is guarded:
  // `(res).data ?? []` — a missing table or a refused read leaves its
  // section to its graceful empty state, never the page to an error.
  const [
    attentionsRes,
    internalTasksRes,
    boardsRes,
    docsRes,
    proposalsRes,
    milestonesRes,
    opsRes,
    notesRes,
    ceremoniesRes,
    linesRes,
    paymentsRes,
    vendorsRes,
    rsvpRes,
    formsRes,
    activityRes
  ] = await Promise.all([
    supabase
      .from("attentions")
      .select("*")
      .eq("wedding_id", wedding.id)
      .neq("status", "attended")
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(6),
    isTeam
      ? supabase
          .from("internal_tasks")
          .select("*")
          .eq("wedding_id", wedding.id)
          .eq("done", false)
          .order("due_date", { ascending: true, nullsFirst: false })
          .limit(3)
      : Promise.resolve({ data: [] as InternalTask[] }),
    supabase.from("boards").select("id, title, status").eq("wedding_id", wedding.id),
    supabase
      .from("documents")
      .select("id, label, created_at")
      .eq("wedding_id", wedding.id)
      .eq("internal", false)
      .order("created_at", { ascending: false })
      .limit(3),
    isTeam
      ? supabase
          .from("availability_proposals")
          .select("*")
          .eq("wedding_id", wedding.id)
          .order("created_at", { ascending: false })
          .limit(5)
      : Promise.resolve({ data: null }),
    supabase.from("timeline_milestones").select("*").eq("wedding_id", wedding.id).order("month").order("sort"),
    isTeam ? supabase.from("milestone_ops").select("*").eq("wedding_id", wedding.id) : Promise.resolve({ data: [] }),
    supabase.from("monthly_notes").select("*").eq("wedding_id", wedding.id).eq("status", "published").order("month"),
    supabase.from("ceremonies").select("*").eq("wedding_id", wedding.id).order("sort"),
    supabase.from("budget_lines").select("*").eq("wedding_id", wedding.id),
    isTeam ? supabase.from("payments").select("*").eq("wedding_id", wedding.id) : Promise.resolve({ data: [] }),
    isTeam ? supabase.from("vendors").select("id, stage, archived").eq("wedding_id", wedding.id) : Promise.resolve({ data: [] }),
    supabase.from("person_event_status").select("status").eq("wedding_id", wedding.id),
    supabase.from("forms").select("id, title, status, due_label").eq("wedding_id", wedding.id),
    isTeam
      ? supabase
          .from("activity_log")
          .select("actor, action, created_at")
          .eq("wedding_id", wedding.id)
          .order("created_at", { ascending: false })
          .limit(5)
      : Promise.resolve({ data: [] })
  ]);

  const g = <T,>(res: unknown): T[] => (((res as { data: unknown }).data ?? []) as T[]);
  const rawAttentions = g<Attention>(attentionsRes).filter(
    (a) => !a.dismissed && !(a.snoozed_until && a.snoozed_until > today)
  );
  const internalTasks = g<InternalTask>(internalTasksRes);
  const boards = g<{ id: string; title: string; status: string }>(boardsRes);
  const docs = g<{ id: string; label: string; created_at: string }>(docsRes);
  const proposals = g<AvailabilityProposal>(proposalsRes);
  const milestones = g<Milestone>(milestonesRes);
  const ops = new Map(g<MilestoneOps>(opsRes).map((o) => [o.milestone_id, o]));
  const notes = g<MonthlyNote>(notesRes);
  const ceremonies = g<Ceremony>(ceremoniesRes).filter((c) => !c.archived);
  const lines = g<{ committed: number | null; paid: number | null; currency?: string; committed_eur?: number | null; parent_line_id?: string | null; archived?: boolean; next_payment_label?: string | null; status: string }>(linesRes);
  const payments = g<{ id: string; label: string; due_date: string | null; paid_at: string | null; status?: string; kind?: string }>(paymentsRes);
  const vendors = g<{ id: string; stage: string; archived?: boolean }>(vendorsRes).filter((v) => !v.archived);
  const rsvp = rsvpAggregate(g<{ status: string }>(rsvpRes).map((x) => x.status));
  const forms = g<{ id: string; title: string; status: string; due_label: string | null }>(formsRes);
  const activity = g<{ actor: string; action: string; created_at: string }>(activityRes);

  // The couple's names as their own module speaks them.
  const proposerIds = [...new Set(proposals.map((p) => p.proposed_by).filter(Boolean))] as string[];
  let proposerNames: Record<string, string> = {};
  if (proposerIds.length) {
    const { data: profs } = await supabase.from("profiles").select("id, full_name").in("id", proposerIds);
    proposerNames = Object.fromEntries((profs ?? []).map((p) => [p.id, p.full_name]));
  }

  // Ceremony readiness — the team's eyes alone; sections guarded.
  const firstCeremony = ceremonies[0] ?? null;
  let ceremonyBlockers: string[] = [];
  if (isTeam && firstCeremony) {
    const [pRes, fRes, mRes, rRes, lRes, dRes] = await Promise.all([
      supabase.from("ceremony_participants").select("id").eq("ceremony_id", firstCeremony.id),
      supabase.from("ceremony_flow").select("id, archived, duration_min").eq("ceremony_id", firstCeremony.id),
      supabase.from("ceremony_music").select("id, archived").eq("ceremony_id", firstCeremony.id),
      supabase.from("ceremony_readings").select("id, archived").eq("ceremony_id", firstCeremony.id),
      supabase.from("ceremony_logistics").select("id, status").eq("ceremony_id", firstCeremony.id),
      supabase.from("ceremony_documents").select("id").eq("ceremony_id", firstCeremony.id)
    ]);
    ceremonyBlockers = ceremonyReadiness(firstCeremony, {
      participants: g(pRes),
      flow: g(fRes),
      music: g(mRes),
      readings: g(rRes),
      logistics: g(lRes),
      documents: g(dRes)
    }).blocking;
  }

  /* ── the derivations: nothing invented, nothing stored (§6) ── */
  const opOf = (m: Milestone) => ops.get(m.id)?.op_status ?? (m.done ? "completed" : "planned");
  const visibleMilestones = (isTeam ? milestones : milestones.filter((m) => m.status === "published")).filter(
    (m) => opOf(m) !== "archived"
  );
  const progress = timelineProgress(visibleMilestones);
  const nextMilestone = visibleMilestones.find((m) => !m.done) ?? null;
  const nextOps = nextMilestone ? ops.get(nextMilestone.id) : null;
  const overdueMilestones = isTeam
    ? visibleMilestones.filter((m) => {
        const o = ops.get(m.id);
        return o?.due_date && o.due_date < today && opOf(m) !== "completed";
      })
    : [];
  const recentDone = [...visibleMilestones.filter((m) => m.done)].slice(-3).reverse();

  const liveLines = lines.filter((l) => !l.archived && !l.parent_line_id);
  const coupleLines = isTeam ? liveLines.filter((l) => l.status === "published") : liveLines;
  const eur = (list: typeof liveLines) => {
    const vals = list.map((l) => lineEurValues(l));
    return {
      committed: sumMoney(vals.map((v) => (v.converted ? v.committedEur : 0))),
      paid: sumMoney(vals.map((v) => (v.converted ? v.paidEur : 0)))
    };
  };
  const clientBudget = eur(coupleLines);
  const teamBudget = eur(liveLines);
  const overduePayments = payments.filter(
    (p) => !isSettledPayment(p) && p.status !== "rejected" && p.status !== "reversed" && p.due_date && p.due_date < today
  );
  const nextClientPayment = coupleLines.map((l) => l.next_payment_label).find(Boolean) ?? null;

  const vb = vendorBuckets(vendors.map((v) => v.stage));
  const boardsApproved = boards.filter((b) => b.status === "approved");
  const boardsToReview = boards.filter((b) => b.status === "to_review");
  const latestBoard = boardsApproved.at(-1) ?? null;
  const formsOpen = forms.filter((f) => f.status === "awaiting");
  const currentNote = notes.filter((n) => n.composed_text && n.month <= monthKey).at(-1) ?? null;

  const money = (n: number) => format.number(n, { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
  const sentence = clientSentenceKey(rawAttentions.filter((a) => a.status === "awaiting_word").length);
  const priorities = isTeam
    ? teamPriorities({
        overdueMilestones: overdueMilestones.length,
        ceremonyBlockers: ceremonyBlockers.length,
        overduePayments: overduePayments.length,
        vendorsInReview: vb.inReview,
        boardsAwaiting: boardsToReview.length,
        formsOpen: formsOpen.length,
        attentionsAwaiting: rawAttentions.filter((a) => a.status === "awaiting_word").length
      })
    : [];

  const config = ((wedding as { home_config?: HomeConfig }).home_config ?? {}) as HomeConfig;
  const order = sectionOrder(config);
  const show = (s: HomeSection) => !isHidden(config, s);

  const days = wedding.first_toast_at
    ? Math.max(0, Math.ceil((new Date(wedding.first_toast_at).getTime() - Date.now()) / 86_400_000))
    : null;

  const viewBtn = (href: string, label: string) => (
    <Link className="btn ghost sm" href={href} style={{ marginTop: 10, display: "inline-block" }}>
      {label}
    </Link>
  );

  /* ── the sections, in the configured order (§5, §29) ── */
  const sections: Partial<Record<HomeSection, ReactNode>> = {
    pulse: (
      <div className="card" key="pulse">
        <div className="eyebrow">{t("pulse.title")}</div>
        <p className="serif" style={{ fontSize: 18, fontStyle: "italic", margin: "10px 0 0", color: "var(--hunter)" }}>
          {t(`pulse.${sentence}`, { count: rawAttentions.filter((a) => a.status === "awaiting_word").length })}
        </p>
        {progress.total > 0 && (
          <p style={{ fontSize: 13.5, color: "var(--ink2)", margin: "8px 0 0" }}>
            {t("pulse.progress", { done: progress.done, total: progress.total, pct: progress.pct })}
          </p>
        )}
        {rawAttentions.length > 0 && (
          <ul className="steps" style={{ marginTop: 12 }}>
            {rawAttentions.slice(0, 4).map((a) => (
              <li key={a.id}>
                <span className="d">
                  {a.due_date ? format.dateTime(new Date(a.due_date), { month: "short", day: "numeric" }) : "—"}
                </span>
                <span>{a.title}</span>
              </li>
            ))}
          </ul>
        )}
        {isTeam && (overdueMilestones.length > 0 || overduePayments.length > 0) && (
          <p className="team-only" style={{ fontSize: 12.5, color: "var(--bronze)", marginTop: 8 }}>
            {t("pulse.teamLine", { milestones: overdueMilestones.length, payments: overduePayments.length })}
          </p>
        )}
      </div>
    ),
    next_milestone: nextMilestone ? (
      <div className="card" key="next">
        <div className="eyebrow">{t("next.title")}</div>
        <p className="serif" style={{ fontSize: 19, fontStyle: "italic", margin: "8px 0 0" }}>{nextMilestone.label}</p>
        <p style={{ fontSize: 13, color: "var(--ink2)", margin: "6px 0 0" }}>
          {format.dateTime(new Date(nextMilestone.month), { month: "long", year: "numeric" })}
          {isTeam && nextOps?.due_date ? ` · ${nextOps.due_date}` : ""}
          {isTeam && nextOps?.owner ? ` · ${nextOps.owner}` : ""}
        </p>
        {isTeam && nextOps?.description && (
          <p className="team-only" style={{ fontSize: 13, color: "var(--ink2)", marginTop: 6 }}>{nextOps.description}</p>
        )}
        {viewBtn("/timeline", t("viewTimeline"))}
      </div>
    ) : null,
    month: currentNote?.composed_text ? (
      <div className="card" key="month">
        <div className="eyebrow">{t("month.title")}</div>
        <div style={{ marginTop: 10 }}>
          <HouseProse text={currentNote.composed_text} size={15.5} />
        </div>
        {viewBtn("/timeline", t("viewTimeline"))}
      </div>
    ) : null,
    ceremony: (
      <div className="card" key="ceremony">
        <div className="eyebrow">{t("ceremony.title")}</div>
        {firstCeremony ? (
          <>
            <p className="serif" style={{ fontSize: 19, fontStyle: "italic", margin: "8px 0 0" }}>
              {firstCeremony.title || firstCeremony.kind}
            </p>
            <p style={{ fontSize: 13.5, color: "var(--ink2)", margin: "6px 0 0" }}>
              {[firstCeremony.ceremony_date, firstCeremony.start_time, firstCeremony.venue, firstCeremony.officiant]
                .filter(Boolean)
                .join(" · ") || t("ceremony.toSettle")}
            </p>
            {isTeam && ceremonyBlockers.length > 0 && (
              <p className="team-only" style={{ fontSize: 12.5, color: "var(--bronze)", marginTop: 6 }}>
                {t("ceremony.blockers", { count: ceremonyBlockers.length })}
              </p>
            )}
            {viewBtn("/ceremony", t("ceremony.view"))}
          </>
        ) : (
          <p style={{ fontSize: 13.5, color: "var(--ink2)", marginTop: 8 }}>{t("ceremony.empty")}</p>
        )}
      </div>
    ),
    budget: (
      <div className="card" key="budget">
        <div className="eyebrow">{t("budget.title")}</div>
        {clientBudget.committed > 0 || (isTeam && teamBudget.committed > 0) ? (
          <>
            <p style={{ fontSize: 13.5, margin: "8px 0 0" }}>
              {t("budget.line", { committed: money(clientBudget.committed), paid: money(clientBudget.paid) })}
            </p>
            {nextClientPayment && (
              <p style={{ fontSize: 13, color: "var(--ink2)", margin: "6px 0 0" }}>
                {t("budget.next", { label: nextClientPayment })}
              </p>
            )}
            {isTeam && (
              <p className="team-only" style={{ fontSize: 12.5, color: overduePayments.length ? "var(--bronze)" : "var(--ink2)", marginTop: 6 }}>
                {t("budget.teamLine", {
                  committed: money(teamBudget.committed),
                  paid: money(teamBudget.paid),
                  remaining: money(teamBudget.committed - teamBudget.paid),
                  overdue: overduePayments.length
                })}
              </p>
            )}
            {viewBtn("/budget", t("budget.view"))}
          </>
        ) : (
          <p style={{ fontSize: 13.5, color: "var(--ink2)", marginTop: 8 }}>{t("budget.empty")}</p>
        )}
      </div>
    ),
    design: (
      <div className="card" key="design">
        <div className="eyebrow">{t("design.title")}</div>
        {boards.length > 0 ? (
          <>
            <p style={{ fontSize: 13.5, margin: "8px 0 0" }}>
              {t("design.line", { total: boards.length, approved: boardsApproved.length })}
              {latestBoard ? ` — ${t("design.latest", { title: latestBoard.title })}` : ""}
            </p>
            {isTeam && boardsToReview.length > 0 && (
              <p className="team-only" style={{ fontSize: 12.5, color: "var(--bronze)", marginTop: 6 }}>
                {t("design.awaiting", { count: boardsToReview.length })}
              </p>
            )}
            {viewBtn("/design", t("design.view"))}
          </>
        ) : (
          <p style={{ fontSize: 13.5, color: "var(--ink2)", marginTop: 8 }}>{t("design.empty")}</p>
        )}
      </div>
    ),
    vendors: isTeam ? (
      <div className="card team-only" key="vendors">
        <div className="eyebrow">{t("vendors.title")}</div>
        <p style={{ fontSize: 13.5, margin: "8px 0 0" }}>
          {t("vendors.line", { total: vb.total, contracted: vb.contracted, selected: vb.selected, inReview: vb.inReview, awaiting: vb.awaiting })}
        </p>
        {viewBtn("/vendors", t("vendors.view"))}
      </div>
    ) : null,
    communication: (
      <div className="card" key="communication">
        <div className="eyebrow">{t("comm.title")}</div>
        {rsvp.total > 0 ? (
          <>
            <p style={{ fontSize: 13.5, margin: "8px 0 0" }}>
              {t("comm.line", { attending: rsvp.attending, pending: rsvp.pending, declined: rsvp.declined })}
            </p>
            {viewBtn("/communication", t("comm.view"))}
          </>
        ) : (
          <p style={{ fontSize: 13.5, color: "var(--ink2)", marginTop: 8 }}>{t("comm.empty")}</p>
        )}
        {formsOpen.length > 0 && (
          <p style={{ fontSize: 13, color: "var(--ink2)", marginTop: 8 }}>
            {t("comm.forms", { count: formsOpen.length })}{" "}
            <Link className="addnote" href="/forms">{t("comm.viewForms")}</Link>
          </p>
        )}
      </div>
    ),
    recent: (
      <div className="card" key="recent">
        <div className="eyebrow">{t("recent.title")}</div>
        {recentDone.length === 0 && docs.length === 0 ? (
          <p style={{ fontSize: 13.5, color: "var(--ink2)", marginTop: 8 }}>{t("recent.empty")}</p>
        ) : (
          <ul className="steps" style={{ marginTop: 12 }}>
            {recentDone.map((m) => (
              <li key={m.id}>
                <span className="d">{format.dateTime(new Date(m.month), { month: "short" })}</span>
                <span>{m.label}</span>
              </li>
            ))}
            {docs.map((d) => (
              <li key={d.id}>
                <span className="d">{format.dateTime(new Date(d.created_at), { month: "short", day: "numeric" })}</span>
                <span>
                  {d.label} <Link className="addnote" href="/documents">{t("recent.viewDoc")}</Link>
                </span>
              </li>
            ))}
          </ul>
        )}
        {isTeam && activity.length > 0 && (
          <p className="team-only" style={{ fontSize: 12, color: "var(--ink2)", marginTop: 8 }}>
            {t("recent.journal", { entries: activity.map((a) => a.action).join(" · ") })}
          </p>
        )}
      </div>
    ),
    priorities: isTeam && priorities.length > 0 ? (
      <div className="card team-only" key="priorities">
        <div className="eyebrow">
          {t("priorities.title")} <span className="tag int">{tc("internal")}</span>
        </div>
        <ul className="steps" style={{ marginTop: 12 }}>
          {priorities.map((p) => (
            <li key={p.key}>
              <span className="d">{p.count}</span>
              <span>
                {t(`priorities.${p.key}`, { count: p.count })}{" "}
                <Link className="addnote" href={p.href}>{t("priorities.open")}</Link>
              </span>
            </li>
          ))}
          {internalTasks.map((task) => (
            <li key={task.id}>
              <span className="d">{task.assignee ?? "—"}</span>
              <span>
                {task.title} <span className="tag int">{tc("internal")}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    ) : null
  };

  return (
    <section className="sheet">
      <div className="eyebrow">{t("welcome")}</div>
      <h1 className="title">{t("headline")}</h1>
      {days !== null && (
        <div className="hero-count">
          <span className="serif num">{days}</span>
          <span className="eyebrow">{t("countdown")}</span>
        </div>
      )}
      <hr className="hair" />

      <div className="grid2">
        {order.filter((s) => show(s)).map((s) => sections[s] ?? null)}
      </div>

      {isTeam && <HomeConfigDesk weddingId={wedding.id} config={config} />}

      {isTeam && <ProposedMoments proposals={proposals} names={proposerNames} />}

      {isTeam && <AskHouse weddingId={wedding.id} />}

      <ProposeMoment weddingId={wedding.id} timezone={wedding.timezone} />
    </section>
  );
}
