import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { requireHouseSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import type { WeddingEvent } from "@/lib/types";
import { ClientSheet, TimelineComposer } from "./desk-client";

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
  const [{ data: events }, { data: brief }] = await Promise.all([
    wedding
      ? supabase.from("wedding_events").select("*").eq("wedding_id", wedding.id).order("sort")
      : Promise.resolve({ data: [] as WeddingEvent[] }),
    wedding
      ? supabase.from("wedding_briefs").select("body").eq("wedding_id", wedding.id).maybeSingle()
      : Promise.resolve({ data: null })
  ]);

  return (
    <section className="sheet">
      <div className="eyebrow">{t("eyebrow")}</div>
      <h1 className="title">{t("headline")}</h1>
      <p className="lead">{t("lead")}</p>

      <ClientSheet
        wedding={wedding}
        events={(events ?? []) as WeddingEvent[]}
        brief={brief?.body ?? ""}
      />

      {wedding && <TimelineComposer weddingId={wedding.id} />}
    </section>
  );
}
