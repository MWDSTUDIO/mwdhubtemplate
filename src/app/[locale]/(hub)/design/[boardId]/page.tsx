import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale, getFormatter } from "next-intl/server";
import { requireHouseSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { Link } from "@/i18n/navigation";
import type { Board, SubBoard } from "@/lib/types";
import { BoardActions } from "./board-client";
import { BoardSheet, type SheetData, type SheetLinks } from "./sheet-client";

const SUB_KINDS = ["rental", "stationery", "invitations", "day_of"] as const;
type SubKind = (typeof SUB_KINDS)[number];

export default async function BoardPage({
  params,
  searchParams
}: {
  params: Promise<{ locale: string; boardId: string }>;
  searchParams: Promise<{ sub?: string }>;
}) {
  const { locale, boardId } = await params;
  const { sub: subParam } = await searchParams;
  setRequestLocale(locale);
  const session = await requireHouseSession();
  const t = await getTranslations("design");
  const ts = await getTranslations("boardSheet");
  const tc = await getTranslations("common");
  const format = await getFormatter();
  if (!session.wedding) return null;
  const wedding = session.wedding;

  const supabase = await createClient();
  const { data: board } = await supabase
    .from("boards")
    .select("*")
    .eq("id", boardId)
    .maybeSingle<Board>();
  if (!board || board.wedding_id !== wedding.id) notFound();

  const sub = SUB_KINDS.includes(subParam as SubKind) ? (subParam as SubKind) : undefined;

  const [{ data: siblings }, { data: subBoards }, { data: comments }] = await Promise.all([
    supabase
      .from("boards")
      .select("id, type, title, sort")
      .eq("wedding_id", wedding.id)
      .order("sort"),
    supabase.from("sub_boards").select("*").eq("board_id", boardId),
    supabase
      .from("board_comments")
      .select("*, profiles(full_name)")
      .eq("board_id", boardId)
      .order("created_at")
  ]);

  // Sheet source: the board row, or the sub-board's content pocket.
  const subRow = sub
    ? ((subBoards ?? []) as SubBoard[]).find((s) => s.kind === sub)
    : undefined;
  const source: Record<string, unknown> = sub
    ? ((subRow?.content ?? {}) as Record<string, unknown>)
    : (board as unknown as Record<string, unknown>);

  // Signed URLs for the collage + backdrop (RLS-checked by Storage) —
  // the backdrop signs in the same burst as the tiles (vitesse §8).
  const photoPaths = ((source.photos as Record<string, string>) ?? {});
  const photoUrls: Record<string, string> = {};
  let backdropUrl: string | null = null;
  await Promise.all([
    ...Object.entries(photoPaths).map(async ([slot, path]) => {
      const { data } = await supabase.storage.from("shared").createSignedUrl(path, 3600);
      if (data?.signedUrl) photoUrls[slot] = data.signedUrl;
    }),
    (async () => {
      if (!source.backdrop_path) return;
      const { data } = await supabase.storage
        .from("shared")
        .createSignedUrl(source.backdrop_path as string, 3600);
      backdropUrl = data?.signedUrl ?? null;
    })()
  ]);

  const weddingDate = wedding.date_start
    ? format.dateTime(new Date(wedding.date_start), { month: "long", year: "numeric" })
    : "";
  const subLabel = sub ? t(`kinds.${sub}`) : null;

  const data: SheetData = {
    eyebrow:
      (source.eyebrow as string) ||
      `${board.title}${subLabel ? ` — ${subLabel}` : ""}`,
    conceptTitle: (source.concept_title as string) ?? "",
    conceptText: (source.concept_text as string) ?? "",
    signature: ts("signature"),
    palette: ((source.palette as string[]) ?? board.palette) || [],
    materials: ((source.materials as string[]) ?? []),
    photoPaths,
    photoUrls,
    backdropUrl,
    footerRef:
      (source.footer_ref as string) ||
      `${wedding.couple_display_name} · ${wedding.destination}${weddingDate ? ` · ${weddingDate}` : ""}`
  };

  const ordered = ((siblings ?? []) as Pick<Board, "id" | "type" | "title" | "sort">[])
    .filter((b) => b.type !== "global");
  const idx = ordered.findIndex((b) => b.id === boardId);
  const neighbor = idx >= 0 ? ordered[(idx + 1) % ordered.length] : null;
  const globalBoard = ((siblings ?? []) as Pick<Board, "id" | "type" | "title">[]).find(
    (b) => b.type === "global"
  );

  // The kinship link: the house's explicit choice first, else the next
  // board in the studio's order.
  const relatedId = (board as unknown as { related_board_id?: string | null }).related_board_id ?? null;
  const related = relatedId
    ? ((siblings ?? []) as Pick<Board, "id" | "title">[]).find((b) => b.id === relatedId)
    : null;

  const links: SheetLinks = {
    globalId: board.type !== "global" ? globalBoard?.id ?? null : null,
    neighbor: related
      ? { id: related.id, title: related.title }
      : neighbor && neighbor.id !== boardId
        ? { id: neighbor.id, title: neighbor.title }
        : null,
    hasSubs: ((subBoards ?? []) as SubBoard[]).some(
      (s) => s.kind === "rental" || s.kind === "stationery"
    ),
    options: ((siblings ?? []) as Pick<Board, "id" | "title">[]).map((b) => ({
      id: b.id,
      title: b.title
    })),
    relatedId
  };

  const pdfHref = `/api/pdf/board/${boardId}${sub ? `?sub=${sub}` : ""}`;

  return (
    <section className="sheet" style={{ maxWidth: 1320 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 14, flexWrap: "wrap", marginBottom: 18 }}>
        <Link href="/design" className="eyebrow" style={{ textDecoration: "none" }}>
          ← {t("headline")}
        </Link>
        {board.status === "approved" ? (
          <span className="tag ok">{tc("approved")}</span>
        ) : board.status === "to_review" ? (
          <span className="tag wait">{tc("toReview")}</span>
        ) : (
          <span className="tag">{tc("inCreation")}</span>
        )}
      </div>

      <BoardSheet
        target={{ boardId, weddingId: wedding.id, sub }}
        data={data}
        links={links}
        isTeam={session.isTeam}
        pdfHref={pdfHref}
        status={sub ? null : board.status}
      />

      {!sub && (
        <div style={{ maxWidth: 1060, margin: "24px auto 0" }}>
          <BoardActions
            board={board}
            isTeam={session.isTeam}
            isClient={session.profile.role === "client"}
          />

          {(comments ?? []).length > 0 && (
            <div className="card">
              <div className="eyebrow" style={{ marginBottom: 8 }}>{t("exchangesOnBoard")}</div>
              <ul className="steps">
                {(comments as { id: string; kind: string; body: string | null; created_at: string; profiles: { full_name: string } | null }[]).map((c) => (
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
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
