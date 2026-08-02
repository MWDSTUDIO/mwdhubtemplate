import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { requireHouseSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import type { WeddingEvent } from "@/lib/types";
import { ClientSheet, TimelineComposer } from "./desk-client";
import { AccessPanel, TemplatesPanel } from "./access-client";
import { listMembers } from "@/app/actions/access";
import { CeremonyList } from "@/components/CeremonyEditor";
import { MomentsDesk } from "@/components/moments-desk";
import type { Ceremony } from "@/lib/types";

export default async function DeskPage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await requireHouseSession();
  if (!session.isTeam) redirect({ href: "/", locale });
  const t = await getTranslations("desk");
  const { wedding } = session;

  const supabase = await createClient();
  const [{ data: events }, { data: brief }, { data: ceremonies }] = await Promise.all([
    wedding
      ? supabase.from("wedding_events").select("*").eq("wedding_id", wedding.id).order("sort")
      : Promise.resolve({ data: [] as WeddingEvent[] }),
    wedding
      ? supabase.from("wedding_briefs").select("body").eq("wedding_id", wedding.id).maybeSingle()
      : Promise.resolve({ data: null }),
    wedding
      ? supabase.from("ceremonies").select("*").eq("wedding_id", wedding.id).order("sort")
      : Promise.resolve({ data: [] as Ceremony[] })
  ]);

  return (
    <section className="sheet">
      <div className="eyebrow">{t("eyebrow")}</div>
      <h1 className="title">{t("headline")}</h1>
      <p className="lead">{t("lead")}</p>

      <ClientSheet
        key={wedding?.id ?? "blank"}
        wedding={wedding}
        events={((events ?? []) as WeddingEvent[]).filter((e) => !e.archived)}
        brief={brief?.body ?? ""}
      />

      {wedding && <MomentsDesk weddingId={wedding.id} moments={(events ?? []) as WeddingEvent[]} />}

      {wedding && (
        <>
          <div className="eyebrow" style={{ margin: "26px 0 12px" }}>
            {t("ceremoniesTitle")}
          </div>
          <CeremonyList
            ceremonies={(ceremonies ?? []) as Ceremony[]}
            weddingId={wedding.id}
            isTeam={session.isTeam}
          />
        </>
      )}

      {wedding && <TimelineComposer weddingId={wedding.id} />}

      {wedding && <TemplatesPanel weddingId={wedding.id} />}

      <AccessPanel
        members={await listMembers()}
        weddings={session.weddings}
        activeWeddingId={wedding?.id ?? null}
        isPrincipal={session.isPrincipal}
      />
    </section>
  );
}
