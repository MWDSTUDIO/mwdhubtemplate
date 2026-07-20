import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireHouseSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import type { FormRow } from "@/lib/types";
import { FormFill, ReplyReview } from "./forms-client";

export default async function FormsPage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await requireHouseSession();
  const t = await getTranslations("forms");
  const tc = await getTranslations("common");
  const { wedding } = session;
  if (!wedding) return null;

  const supabase = await createClient();
  const [{ data: forms }, { data: submissions }] = await Promise.all([
    supabase.from("forms").select("*").eq("wedding_id", wedding.id).order("sort"),
    supabase
      .from("form_submissions")
      .select("*")
      .eq("wedding_id", wedding.id)
      .order("created_at", { ascending: false })
  ]);

  const pendingReplies = (submissions ?? []).filter(
    (s) => s.agent_reply && s.reply_status === "draft"
  );

  return (
    <section className="sheet">
      <div className="eyebrow">{t("eyebrow")}</div>
      <h1 className="title">{t("headline")}</h1>
      <p className="lead">{t("lead")}</p>

      <div className="card">
        <table className="sheet-table">
          <thead>
            <tr>
              <th>{t("form")}</th>
              <th>{t("status")}</th>
            </tr>
          </thead>
          <tbody>
            {((forms ?? []) as FormRow[]).map((form) => (
              <tr key={form.id}>
                <td>{form.title}</td>
                <td>
                  {form.status === "completed" ? (
                    <span className="tag ok">{t("statuses.completed")}</span>
                  ) : form.status === "awaiting" ? (
                    <span style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                      <span className="tag wait">{t("statuses.awaiting")}</span>
                      {session.profile.role === "client" && (
                        <FormFill
                          form={form}
                          weddingId={wedding.id}
                          schema={Array.isArray(form.schema) ? form.schema : []}
                        />
                      )}
                    </span>
                  ) : (
                    <span className="tag">
                      {t("statuses.toCome")}
                      {form.due_label ? ` — ${form.due_label}` : ""}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {session.isTeam && pendingReplies.length > 0 && (
        <div className="ia team-only">
          <div className="eyebrow">
            {t("agent.title")} <span className="tag int">{tc("internal")}</span>
          </div>
          <p style={{ marginTop: 8, fontSize: 13.5 }}>{t("agent.blurb")}</p>
          {pendingReplies.map((submission) => (
            <div key={submission.id} style={{ marginTop: 14 }}>
              <hr className="hair" style={{ margin: "14px 0" }} />
              <ReplyReview submissionId={submission.id} reply={submission.agent_reply!} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
