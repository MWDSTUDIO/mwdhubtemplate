import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireHouseSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { ProcessEditor, type ProcessStep } from "./process-client";

/**
 * The house's method — four acts by default, and a wedding may be
 * given movements of its own, because no two weddings are alike.
 */
export default async function ProcessPage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await requireHouseSession();
  const t = await getTranslations("process");
  const { wedding } = session;

  let steps: ProcessStep[] = [];
  if (wedding) {
    const supabase = await createClient();
    // Absent until migration 0010 — the four acts stand in that case.
    const { data } = await supabase
      .from("process_steps")
      .select("id, sort, title, body")
      .eq("wedding_id", wedding.id)
      .order("sort");
    steps = (data ?? []) as ProcessStep[];
  }

  const defaults = [0, 1, 2, 3].map((i) => ({
    title: t(`phases.${i}.title`),
    body: t(`phases.${i}.body`)
  }));

  return (
    <section className="sheet">
      <div className="eyebrow">{t("eyebrow")}</div>
      <h1 className="title">{t("headline")}</h1>
      <p className="lead">{t("lead")}</p>
      {wedding ? (
        <ProcessEditor
          weddingId={wedding.id}
          steps={steps}
          defaults={defaults}
          isTeam={session.isTeam}
        />
      ) : (
        defaults.map((d, i) => (
          <div className="phase" key={i}>
            <div className="n serif">{["I", "II", "III", "IV"][i]}</div>
            <div>
              <strong>{d.title}</strong>
              <br />
              {d.body}
            </div>
          </div>
        ))
      )}
    </section>
  );
}
