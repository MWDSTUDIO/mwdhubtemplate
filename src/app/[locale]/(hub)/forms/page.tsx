import { getTranslations, getFormatter, setRequestLocale } from "next-intl/server";
import { requireHouseSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import type { FormRow, FormCategory } from "@/lib/types";
import { coupleCanSee, isInAppForm, orderCards } from "@/lib/forms";
import { FormFill, ReplyReview } from "./forms-client";
import { FormsDesk } from "./cards-client";

/**
 * Forms — a curated library of questionnaires (PRD Forms). The house
 * presents and tracks the cards; Dubsado keeps the questionnaire and
 * the answers. Legacy in-app forms keep their filling flow untouched.
 */
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
  const format = await getFormatter();
  const { wedding } = session;
  if (!wedding) return null;

  const supabase = await createClient();
  const [{ data: formsRaw }, catsRes, { data: submissions }] = await Promise.all([
    supabase.from("forms").select("*").eq("wedding_id", wedding.id).order("sort"),
    supabase.from("form_categories").select("*").eq("wedding_id", wedding.id).order("sort"),
    supabase
      .from("form_submissions")
      .select("*")
      .eq("wedding_id", wedding.id)
      .order("created_at", { ascending: false })
  ]);
  const categories = ((catsRes.data ?? []) as FormCategory[]).filter((c) => !c.archived);
  const forms = orderCards((formsRaw ?? []) as FormRow[], categories);

  // Covers: the path is kept, the URL is signed for this reading only.
  const covers: Record<string, string> = {};
  await Promise.all(
    forms
      .filter((f) => f.cover_path)
      .map(async (f) => {
        const { data } = await supabase.storage.from("shared").createSignedUrl(f.cover_path!, 3600);
        if (data?.signedUrl) covers[f.id] = data.signedUrl;
      })
  );

  const pendingReplies = (submissions ?? []).filter(
    (s) => s.agent_reply && s.reply_status === "draft"
  );

  /* ── the couple's gallery: published, client-visible, calm ── */
  if (!session.isTeam) {
    const visible = forms.filter((f) => coupleCanSee(f));
    const catName = new Map(categories.map((c) => [c.id, c.name]));
    return (
      <section className="sheet">
        <div className="eyebrow">{t("eyebrow")}</div>
        <h1 className="title">{t("headline")}</h1>
        <p className="lead">{t("lead")}</p>
        {visible.length === 0 ? (
          <p style={{ fontSize: 13.5, color: "var(--ink2)" }}>{t("cards.coupleEmpty")}</p>
        ) : (
          <div className="planches">
            {visible.map((f) => (
              <div key={f.id} className="planche" style={{ cursor: "default" }}>
                <div className="visu">
                  {covers[f.id] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={covers[f.id]} alt="" style={f.cover_focal ? { objectPosition: f.cover_focal } : undefined} />
                  ) : (
                    <span>{f.title}</span>
                  )}
                </div>
                <div className="body">
                  <h3>{f.title}</h3>
                  {f.description && <div className="sub">{f.description}</div>}
                  {f.category_id && catName.get(f.category_id) && (
                    <div className="sub">{catName.get(f.category_id)}</div>
                  )}
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
                    {["completed", "submitted", "updated"].includes(f.status) ? (
                      <span className="tag ok">{t(`statuses.${f.status === "completed" ? "completed" : f.status}`)}</span>
                    ) : f.status === "to_come" ? (
                      <span className="tag">
                        {t("statuses.toCome")}
                        {f.due_label ? ` — ${f.due_label}` : ""}
                      </span>
                    ) : (
                      <span className="tag wait">{t("cards.awaitingYou")}</span>
                    )}
                    {f.due_date && (
                      <span style={{ fontSize: 12.5, color: "var(--ink2)" }}>
                        {t("cards.due", {
                          date: format.dateTime(new Date(f.due_date), { month: "short", day: "numeric" })
                        })}
                      </span>
                    )}
                  </div>
                  {f.note_client && (
                    <p style={{ fontSize: 13, color: "var(--ink2)", margin: "8px 0 0" }}>{f.note_client}</p>
                  )}
                  {f.external_url ? (
                    <a
                      className="btn sm"
                      href={f.external_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ marginTop: 10, display: "inline-block", textDecoration: "none" }}
                    >
                      {t(`cta.${f.cta_label && ["open", "begin", "continue", "review", "update"].includes(f.cta_label) ? f.cta_label : f.status === "in_progress" ? "continue" : ["submitted", "updated", "completed"].includes(f.status) ? "review" : "open"}`)}
                    </a>
                  ) : isInAppForm(f) && ["awaiting", "shared", "in_progress"].includes(f.status) ? (
                    <div style={{ marginTop: 10 }}>
                      <FormFill
                        form={f}
                        weddingId={wedding.id}
                        schema={Array.isArray(f.schema) ? f.schema : []}
                      />
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    );
  }

  /* ── the team's desk ── */
  return (
    <section className="sheet">
      <div className="eyebrow">{t("eyebrow")}</div>
      <h1 className="title">{t("headline")}</h1>
      <p className="lead team-only">{t("cards.teamLead")}</p>

      <FormsDesk weddingId={wedding.id} forms={forms} categories={categories} covers={covers} />

      {pendingReplies.length > 0 && (
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
