import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { requireHouseSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import type { ContactSheet, RunSheet } from "@/lib/types";

/**
 * The Wedding Days — the production sub-hub. Coordinators joining at
 * the end of the process enter here, and only here (RLS grants them
 * run sheets and contact sheets of assigned weddings, nothing else).
 */
export default async function WeddingDaysPage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await requireHouseSession();
  if (!session.isTeam && !session.isCoordinator) redirect({ href: "/", locale });
  const t = await getTranslations("weddingDays");
  const { wedding } = session;
  if (!wedding) return null;

  const supabase = await createClient();
  const [{ data: runSheets }, { data: contactSheets }] = await Promise.all([
    supabase.from("run_sheets").select("*").eq("wedding_id", wedding.id),
    supabase.from("contact_sheets").select("*").eq("wedding_id", wedding.id)
  ]);

  const contacts = ((contactSheets ?? []) as ContactSheet[])[0];

  return (
    <section className="sheet">
      <div className="eyebrow">{t("eyebrow")}</div>
      <h1 className="title">{t("headline")}</h1>
      <p className="lead">{t("lead")}</p>
      <div className="grid2">
        {((runSheets ?? []) as RunSheet[]).map((sheet) => (
          <div className="card" key={sheet.id}>
            <div className="eyebrow" style={{ marginBottom: 12 }}>{sheet.title}</div>
            <ul className="steps">
              {sheet.items.map((item, i) => (
                <li key={i}>
                  <span className="d">{item.time}</span>
                  <span>{item.label}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <div className="card">
          <div className="eyebrow" style={{ marginBottom: 12 }}>{t("contactSheet")}</div>
          {contacts && (
            <table className="sheet-table">
              <thead>
                <tr>
                  <th>{t("vendor")}</th>
                  <th>{t("onSite")}</th>
                  <th>{t("reach")}</th>
                </tr>
              </thead>
              <tbody>
                {contacts.rows.map((row, i) => (
                  <tr key={i}>
                    <td>{row.vendor}</td>
                    <td>{row.on_site}</td>
                    <td>{row.reach}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <hr className="hair" />
          <span className="tag wait">{t("miniSite")}</span>
          <p style={{ fontSize: 12, color: "var(--ink2)", marginTop: 8 }}>{t("miniSiteBlurb")}</p>
        </div>
      </div>
    </section>
  );
}
