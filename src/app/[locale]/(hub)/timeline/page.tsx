import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireHouseSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { Frise, type FrisePickers } from "@/components/Frise";
import { MonthlyNotes } from "@/components/MonthlyNotes";
import { Attentions } from "@/components/Attentions";
import type { Attention, InternalTask, Milestone, MilestoneOps, MonthlyNote } from "@/lib/types";

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

  // The operational side and the reference pickers — team material,
  // absent before 0029: the page keeps its manners.
  let ops: Record<string, MilestoneOps> = {};
  let pickers: FrisePickers = { vendors: [], lines: [], documents: [], ceremonies: [] };
  if (session.isTeam) {
    const [opsRes, vendorsRes, linesRes, docsRes, cerRes] = await Promise.all([
      supabase.from("milestone_ops").select("*").eq("wedding_id", wedding.id),
      supabase.from("vendors").select("id, name").eq("wedding_id", wedding.id).order("name"),
      supabase.from("budget_lines").select("id, label").eq("wedding_id", wedding.id).order("sort"),
      supabase.from("documents").select("id, label").eq("wedding_id", wedding.id).order("created_at", { ascending: false }),
      supabase.from("ceremonies").select("id, kind, title").eq("wedding_id", wedding.id).order("sort")
    ]);
    for (const o of ((opsRes as { data: unknown }).data ?? []) as MilestoneOps[]) ops[o.milestone_id] = o;
    pickers = {
      vendors: ((vendorsRes as { data: unknown }).data ?? []) as { id: string; name: string }[],
      lines: ((linesRes as { data: unknown }).data ?? []) as { id: string; label: string }[],
      documents: ((docsRes as { data: unknown }).data ?? []) as { id: string; label: string }[],
      ceremonies: (((cerRes as { data: unknown }).data ?? []) as { id: string; kind: string; title: string | null }[]).map(
        (c) => ({ id: c.id, label: c.title || c.kind })
      )
    };
  }

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
        ops={ops}
        pickers={pickers}
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
