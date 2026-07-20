import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireHouseSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { Frise } from "@/components/Frise";
import { MonthlyNotes } from "@/components/MonthlyNotes";
import { Attentions } from "@/components/Attentions";
import type { Attention, InternalTask, Milestone, MonthlyNote } from "@/lib/types";

export default async function TimelinePage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await requireHouseSession();
  const t = await getTranslations("timeline");
  const tc = await getTranslations("common");
  const { wedding } = session;
  if (!wedding) return null;

  const supabase = await createClient();
  const monthStart = new Date();
  monthStart.setDate(1);
  const currentKey = monthStart.toISOString().slice(0, 10);

  const [{ data: milestones }, { data: notes }, { data: attentions }, { data: internalTasks }] =
    await Promise.all([
      supabase
        .from("timeline_milestones")
        .select("*")
        .eq("wedding_id", wedding.id)
        .order("month")
        .order("sort"),
      supabase
        .from("monthly_notes")
        .select("*")
        .eq("wedding_id", wedding.id)
        .order("month"),
      supabase
        .from("attentions")
        .select("*")
        .eq("wedding_id", wedding.id)
        .order("status")
        .order("due_date", { ascending: true, nullsFirst: false }),
      session.isTeam
        ? supabase
            .from("internal_tasks")
            .select("*")
            .eq("wedding_id", wedding.id)
            .eq("done", false)
        : Promise.resolve({ data: [] as InternalTask[] })
    ]);

  const allNotes = (notes ?? []) as MonthlyNote[];
  const current =
    allNotes.filter((n) => n.composed_text && n.month <= currentKey).at(-1) ?? null;
  const previews = allNotes
    .filter((n) => n.month > (current?.month ?? currentKey) && n.preview_text)
    .slice(0, 3);

  return (
    <section className="sheet">
      <div className="eyebrow">{t("eyebrow")}</div>
      <h1 className="title">{t("headline")}</h1>
      <p className="lead">{t("lead")}</p>

      <Frise
        milestones={(milestones ?? []) as Milestone[]}
        weddingId={wedding.id}
        isTeam={session.isTeam}
      />

      <MonthlyNotes
        weddingId={wedding.id}
        current={current}
        previews={previews}
        isTeam={session.isTeam}
      />

      <Attentions
        attentions={(attentions ?? []) as Attention[]}
        weddingId={wedding.id}
        isTeam={session.isTeam}
        isClient={session.profile.role === "client"}
      />

      {session.isTeam && (internalTasks ?? []).length > 0 && (
        <div className="card team-only">
          <div className="eyebrow">
            {t("internalTasks")} <span className="tag int">{tc("internal")}</span>
          </div>
          <ul className="steps" style={{ marginTop: 12 }}>
            {(internalTasks as InternalTask[]).map((task) => (
              <li key={task.id}>
                <span className="d">{task.assignee ?? "—"}</span>
                <span>{task.title}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
