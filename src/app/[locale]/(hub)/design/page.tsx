import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireHouseSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { Link } from "@/i18n/navigation";
import type { Board, SubBoard } from "@/lib/types";
import { AddBoardBar, RemoveBoardButton } from "./studio-client";

function StatusTag({ status, t }: { status: Board["status"]; t: (k: string) => string }) {
  if (status === "approved") return <span className="tag ok">{t("approved")}</span>;
  if (status === "to_review") return <span className="tag wait">{t("toReview")}</span>;
  return <span className="tag">{t("inCreation")}</span>;
}

export default async function DesignPage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await requireHouseSession();
  const t = await getTranslations("design");
  const tc = await getTranslations("common");
  const { wedding } = session;
  if (!wedding) return null;

  const supabase = await createClient();
  const [{ data: boards }, { data: subBoards }] = await Promise.all([
    supabase.from("boards").select("*").eq("wedding_id", wedding.id).order("sort"),
    supabase.from("sub_boards").select("*").eq("wedding_id", wedding.id)
  ]);

  const all = (boards ?? []) as Board[];
  const global = all.find((b) => b.type === "global");
  const moments = all.filter((b) => b.type !== "global" && b.type !== "stationery");
  const stationery = all.find((b) => b.type === "stationery");
  const subsFor = (id: string) => (subBoards ?? []).filter((s: SubBoard) => s.board_id === id);

  return (
    <section className="sheet">
      <div className="eyebrow">{t("eyebrow")}</div>
      <h1 className="title">{t("headline")}</h1>
      <p className="lead">{t("lead")}</p>

      {global && (
        <div
          className="card"
          style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 20, flexWrap: "wrap" }}
        >
          <div>
            <div className="eyebrow">{t("globalDesign")}</div>
            <div className="serif" style={{ fontSize: 24, fontStyle: "italic" }}>
              &ldquo;{global.title}&rdquo;
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <StatusTag status={global.status} t={tc} />
            <a className="btn ghost" href={`/api/pdf/board/${global.id}`}>
              {t("exportPdf")}
            </a>
          </div>
        </div>
      )}

      <div className="planches">
        {[...moments, ...(stationery ? [stationery] : [])].map((board) => (
          <div key={board.id} style={{ position: "relative" }}>
            {session.isTeam && (
              <RemoveBoardButton boardId={board.id} title={board.title} />
            )}
            <Link
              href={`/design/${board.id}`}
              className="planche"
              style={{ textDecoration: "none" }}
            >
              <div className="visu">
                {board.cover_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={board.cover_url} alt="" />
                ) : (
                  <span>{board.title}</span>
                )}
              </div>
              <div className="body">
                <h3>{board.title}</h3>
                <div className="sub">
                  {board.type === "stationery"
                    ? t("stationerySubs")
                    : t("subBoards", { count: subsFor(board.id).length })}
                </div>
                <StatusTag status={board.status} t={tc} />
              </div>
            </Link>
          </div>
        ))}
      </div>

      {session.isTeam && <AddBoardBar weddingId={wedding.id} />}

      {session.isTeam && (
        <div className="ia team-only">
          <div className="eyebrow">
            {t("workflow.title")} <span className="tag int">{tc("internal")}</span>
          </div>
          <p style={{ marginTop: 8, fontSize: 13.5 }}>{t("workflow.blurb")}</p>
        </div>
      )}
    </section>
  );
}
