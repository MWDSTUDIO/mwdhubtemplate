import { getTranslations, getFormatter, setRequestLocale } from "next-intl/server";
import { requireHouseSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { AskHouse } from "@/components/AskHouse";
import { ProposeMoment } from "@/components/ProposeMoment";
import { ProposedMoments } from "@/components/ProposedMoments";
import type { AvailabilityProposal } from "@/lib/types";
import { Link } from "@/i18n/navigation";
import type { Attention, InternalTask } from "@/lib/types";

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
  const [{ data: attentions }, { data: internalTasks }, { count: boardsMoving }, { count: docsShared }] =
    await Promise.all([
      supabase
        .from("attentions")
        .select("*")
        .eq("wedding_id", wedding.id)
        .neq("status", "attended")
        .order("due_date", { ascending: true, nullsFirst: false })
        .limit(4),
      session.isTeam
        ? supabase
            .from("internal_tasks")
            .select("*")
            .eq("wedding_id", wedding.id)
            .eq("done", false)
            .order("due_date", { ascending: true, nullsFirst: false })
            .limit(3)
        : Promise.resolve({ data: [] as InternalTask[] }),
      supabase
        .from("boards")
        .select("id", { count: "exact", head: true })
        .eq("wedding_id", wedding.id)
        .neq("status", "in_creation"),
      supabase
        .from("documents")
        .select("id", { count: "exact", head: true })
        .eq("wedding_id", wedding.id)
        .eq("internal", false)
    ]);

  // The moments the couple proposed — for the house to confirm.
  let proposals: AvailabilityProposal[] = [];
  let proposerNames: Record<string, string> = {};
  if (session.isTeam) {
    const { data } = await supabase
      .from("availability_proposals")
      .select("*")
      .eq("wedding_id", wedding.id)
      .order("created_at", { ascending: false })
      .limit(5);
    proposals = (data ?? []) as AvailabilityProposal[];
    const ids = [...new Set(proposals.map((p) => p.proposed_by).filter(Boolean))] as string[];
    if (ids.length) {
      const { data: profs } = await supabase.from("profiles").select("id, full_name").in("id", ids);
      proposerNames = Object.fromEntries((profs ?? []).map((p) => [p.id, p.full_name]));
    }
  }

  const days = wedding.first_toast_at
    ? Math.max(
        0,
        Math.ceil(
          (new Date(wedding.first_toast_at).getTime() - Date.now()) / 86_400_000
        )
      )
    : null;

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
        <div className="card">
          <div className="eyebrow">{t("nextSteps")}</div>
          <ul className="steps" style={{ marginTop: 14 }}>
            {(attentions as Attention[] | null)?.map((a) => (
              <li key={a.id}>
                <span className="d">
                  {a.due_date
                    ? format.dateTime(new Date(a.due_date), { month: "short", day: "numeric" })
                    : "—"}
                </span>
                <span>{a.title}</span>
              </li>
            ))}
            {(internalTasks as InternalTask[] | null)?.map((task) => (
              <li key={task.id} className="team-only">
                <span className="d">
                  {task.due_date
                    ? format.dateTime(new Date(task.due_date), { month: "short", day: "numeric" })
                    : task.assignee ?? "—"}
                </span>
                <span>
                  {task.title} <span className="tag int">{tc("internal")}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="card">
          <div className="eyebrow">{t("thisWeek")}</div>
          <ul className="steps" style={{ marginTop: 14 }}>
            <li><span>{t("weekBoards", { count: boardsMoving ?? 0 })}</span></li>
            <li><span>{t("weekBudget")}</span></li>
            <li><span>{t("weekDocs", { count: docsShared ?? 0 })}</span></li>
          </ul>
          <hr className="hair" />
          <Link className="btn ghost" href="/timeline">
            {t("viewTimeline")}
          </Link>
        </div>
      </div>

      {session.isTeam && <ProposedMoments proposals={proposals} names={proposerNames} />}

      <AskHouse weddingId={wedding.id} />

      <ProposeMoment weddingId={wedding.id} timezone={wedding.timezone} />
    </section>
  );
}
