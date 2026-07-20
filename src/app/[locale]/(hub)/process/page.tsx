import { getTranslations, setRequestLocale } from "next-intl/server";

/** The house's method — an editorial page, identical for every wedding. */
export default async function ProcessPage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("process");
  const numerals = ["I", "II", "III", "IV"];

  return (
    <section className="sheet">
      <div className="eyebrow">{t("eyebrow")}</div>
      <h1 className="title">{t("headline")}</h1>
      <p className="lead">{t("lead")}</p>
      {numerals.map((n, i) => (
        <div className="phase" key={n}>
          <div className="n serif">{n}</div>
          <div>
            <strong>{t(`phases.${i}.title`)}</strong>
            <br />
            {t(`phases.${i}.body`)}
          </div>
        </div>
      ))}
    </section>
  );
}
