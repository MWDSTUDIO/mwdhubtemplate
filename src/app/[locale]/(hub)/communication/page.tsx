import { getTranslations, setRequestLocale, getFormatter } from "next-intl/server";
import { requireHouseSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import type { Board, Correspondence, HospitalityItem, HotelBlock } from "@/lib/types";
import { HotelDesk, OpenRoomingButton } from "./communication-client";

export default async function CommunicationPage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await requireHouseSession();
  const t = await getTranslations("communication");
  const format = await getFormatter();
  const { wedding } = session;
  if (!wedding) return null;

  const supabase = await createClient();
  const [
    { data: correspondence },
    { data: hospitality },
    { data: blocks },
    { data: roomingState },
    { data: stationeryBoard }
  ] = await Promise.all([
    supabase.from("correspondence").select("*").eq("wedding_id", wedding.id).order("sent_at", { ascending: true, nullsFirst: false }),
    supabase.from("hospitality_items").select("*").eq("wedding_id", wedding.id).order("sort"),
    supabase.from("hotel_blocks").select("*").eq("wedding_id", wedding.id),
    supabase.from("rooming_list_state").select("*").eq("wedding_id", wedding.id).maybeSingle(),
    supabase.from("boards").select("*").eq("wedding_id", wedding.id).eq("type", "stationery").maybeSingle<Board>()
  ]);

  const opened = roomingState?.opened ?? false;
  const date = (iso: string | null) =>
    iso ? format.dateTime(new Date(iso), { month: "short", day: "numeric", year: "numeric" }) : "—";

  return (
    <section className="sheet">
      <div className="eyebrow">{t("eyebrow")}</div>
      <h1 className="title">{t("headline")}</h1>
      <p className="lead">{t("lead")}</p>

      <div className="grid2">
        <div className="card">
          <div className="eyebrow">{t("suite.title")}</div>
          <div className="serif" style={{ fontSize: 22, margin: "8px 0" }}>{t("suite.onPaper")}</div>
          <p style={{ fontSize: 13.5, color: "var(--ink2)" }}>{t("suite.blurb")}</p>
          <hr className="hair" />
          <span className={`tag ${stationeryBoard?.status === "approved" ? "ok" : "wait"}`}>
            {stationeryBoard?.status === "approved" ? t("suite.approved") : t("suite.inProof")}
          </span>
        </div>
        <div className="card">
          <div className="eyebrow">{t("correspondence.title")}</div>
          <div className="serif" style={{ fontSize: 22, margin: "8px 0" }}>{t("correspondence.byWord")}</div>
          <ul className="steps" style={{ marginTop: 6 }}>
            {((correspondence ?? []) as Correspondence[]).map((c) => (
              <li key={c.id}>
                <span className="d">
                  {c.status === "sent" ? t("correspondence.sent") : c.scheduled_label ?? "—"}
                </span>
                <span>{c.title}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="card">
        <div className="eyebrow" style={{ marginBottom: 14 }}>{t("hospitality.title")}</div>
        <div style={{ overflowX: "auto" }}>
          <table className="sheet-table">
            <thead>
              <tr>
                <th>{t("hospitality.attention")}</th>
                <th>{t("hospitality.scope")}</th>
                <th>{t("hospitality.status")}</th>
              </tr>
            </thead>
            <tbody>
              {((hospitality ?? []) as HospitalityItem[]).map((item) => (
                <tr key={item.id}>
                  <td>{item.label}</td>
                  <td>{item.scope}</td>
                  <td>
                    <span className={`tag${item.status === "awaiting_rsvps" ? " wait" : ""}`}>
                      {t(`hospitality.statuses.${item.status}`)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="eyebrow" style={{ marginBottom: 6 }}>{t("accommodation.title")}</div>
        <p style={{ fontSize: 13, color: "var(--ink2)", marginBottom: 16 }}>{t("accommodation.blurb")}</p>
        <div className="grid2">
          <div style={{ border: "1px solid var(--line)", padding: "20px 22px" }}>
            <div className="eyebrow">{t("accommodation.blocking")}</div>
            <p style={{ fontSize: 13, color: "var(--ink2)", margin: "8px 0 12px" }}>
              {t("accommodation.blockingBlurb")}
            </p>
            <table className="sheet-table">
              <thead>
                <tr>
                  <th>{t("accommodation.hotel")}</th>
                  <th>{t("accommodation.held")}</th>
                  <th>{t("accommodation.cutoff")}</th>
                </tr>
              </thead>
              <tbody>
                {((blocks ?? []) as HotelBlock[]).map((block) => (
                  <tr key={block.id}>
                    <td>{block.hotel}</td>
                    <td className="num">{block.rooms_held}</td>
                    <td>{date(block.cutoff_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ marginTop: 12 }}>
              <span className="tag ok">{t("accommodation.active")}</span>
            </div>
          </div>
          <div style={{ border: "1px dashed var(--line)", padding: "20px 22px", background: "var(--parchment)" }}>
            <div className="eyebrow">{t("accommodation.rooming")}</div>
            <p style={{ fontSize: 13, color: "var(--ink2)", margin: "8px 0 12px" }}>
              {t("accommodation.roomingBlurb")}
            </p>
            {opened ? (
              <span className="tag ok">{t("accommodation.open")}</span>
            ) : (
              <span className="tag wait">{t("accommodation.opensOnWord")}</span>
            )}
            {session.isPrincipal && !opened && <OpenRoomingButton weddingId={wedding.id} />}
          </div>
        </div>
      </div>

      {session.isTeam && <HotelDesk weddingId={wedding.id} sample={t("hotelDesk.sample")} />}

      {session.isTeam && (
        <div className="ia team-only">
          <div className="eyebrow">{t("desk.title")}</div>
          <p style={{ marginTop: 8, fontSize: 13.5 }}>{t("desk.blurb")}</p>
        </div>
      )}
    </section>
  );
}
