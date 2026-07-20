import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireHouseSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { CeremonyList } from "@/components/CeremonyEditor";
import type { Ceremony } from "@/lib/types";

/**
 * The Ceremony — the heart the whole weekend beats around. A wedding
 * may hold several (civil, religious, symbolic…); the house keeps each
 * one's kind, hour, place and hands.
 */
export default async function CeremonyPage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await requireHouseSession();
  const t = await getTranslations("ceremony");
  const { wedding } = session;
  if (!wedding) return null;

  const supabase = await createClient();
  const { data: ceremonies } = await supabase
    .from("ceremonies")
    .select("*")
    .eq("wedding_id", wedding.id)
    .order("ceremony_date", { ascending: true, nullsFirst: false })
    .order("sort");

  return (
    <section className="sheet">
      <div className="eyebrow">{t("eyebrow")}</div>
      <h1 className="title">{t("headline")}</h1>
      <p className="lead">{t("lead")}</p>

      {(ceremonies ?? []).length === 0 && (
        <div className="card">
          <p className="serif" style={{ fontSize: 18, fontStyle: "italic", color: "var(--ink2)" }}>
            {t("empty")}
          </p>
        </div>
      )}

      <CeremonyList
        ceremonies={(ceremonies ?? []) as Ceremony[]}
        weddingId={wedding.id}
        isTeam={session.isTeam}
      />
    </section>
  );
}
