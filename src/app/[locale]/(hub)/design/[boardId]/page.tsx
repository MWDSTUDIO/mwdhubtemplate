import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale, getFormatter } from "next-intl/server";
import { requireHouseSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { Link } from "@/i18n/navigation";
import type { Board, SubBoard } from "@/lib/types";
import { BoardActions, PaletteEditor } from "./board-client";

export default async function BoardPage({
  params
}: {
  params: Promise<{ locale: string; boardId: string }>;
}) {
  const { locale, boardId } = await params;
  setRequestLocale(locale);
  const session = await requireHouseSession();
  const t = await getTranslations("design");
  const tc = await getTranslations("common");
  const format = await getFormatter();
  if (!session.wedding) return null;

  const supabase = await createClient();
  const { data: board } = await supabase
    .from("boards")
    .select("*")
    .eq("id", boardId)
    .maybeSingle<Board>();
  if (!board || board.wedding_id !== session.wedding.id) notFound();

  const [{ data: subBoards }, { data: comments }] = await Promise.all([
    supabase.from("sub_boards").select("*").eq("board_id", boardId),
    supabase
      .from("board_comments")
      .select("*, profiles(full_name)")
      .eq("board_id", boardId)
      .order("created_at")
  ]);

  const subKindLabel = (kind: SubBoard["kind"]) => t(`kinds.${kind}`);

  return (
    <section className="sheet">
      <Link href="/design" className="eyebrow" style={{ textDecoration: "none" }}>
        ← {t("headline")}
      </Link>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div className="eyebrow" style={{ marginTop: 14 }}>
            {t("boardDetail")}
          </div>
          <h1 className="title">{board.title}</h1>
          {board.subtitle && (
            <div className="serif" style={{ fontSize: 22, marginTop: -4, fontStyle: "italic" }}>
              {board.subtitle}
            </div>
          )}
        </div>
        {board.status === "approved" ? (
          <span className="tag ok">{tc("approved")}</span>
        ) : board.status === "to_review" ? (
          <span className="tag wait">{tc("toReview")}</span>
        ) : (
          <span className="tag">{tc("inCreation")}</span>
        )}
      </div>

      <div className="card" style={{ marginTop: 24 }}>
        <div className="eyebrow" style={{ marginBottom: 12 }}>{t("palette")}</div>
        <PaletteEditor board={board} isTeam={session.isTeam} />
        {(subBoards ?? []).length > 0 && (
          <>
            <hr className="hair" />
            <div className="eyebrow" style={{ marginBottom: 10 }}>{t("subBoardsTitle")}</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {(subBoards as SubBoard[]).map((s) => (
                <span key={s.id} className="doc">
                  {s.title ?? subKindLabel(s.kind)} <em>{tc(s.status === "approved" ? "approved" : s.status === "to_review" ? "toReview" : "inCreation")}</em>
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      <BoardActions board={board} isTeam={session.isTeam} isClient={session.profile.role === "client"} />

      {(comments ?? []).length > 0 && (
        <div className="card">
          <div className="eyebrow" style={{ marginBottom: 8 }}>{t("exchangesOnBoard")}</div>
          <ul className="steps">
            {(comments as (typeof comments extends (infer U)[] | null ? U : never)[]).map(
              (c: { id: string; kind: string; body: string | null; created_at: string; profiles: { full_name: string } | null }) => (
                <li key={c.id}>
                  <span className="d">
                    {format.dateTime(new Date(c.created_at), { month: "short", day: "numeric" })}
                  </span>
                  <span>
                    <strong>{c.profiles?.full_name}</strong>{" "}
                    {c.kind === "approval" ? <span className="tag ok">{tc("approved")}</span> : null}{" "}
                    {c.body}
                  </span>
                </li>
              )
            )}
          </ul>
        </div>
      )}
    </section>
  );
}
