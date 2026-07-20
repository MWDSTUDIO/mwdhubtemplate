import { createElement as h } from "react";
import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { Document, Page, Text, View, Image, renderToBuffer } from "@react-pdf/renderer";
import { createClient } from "@/lib/supabase/server";
import { gate } from "../../../agents/_shared";
import type { Board, SubBoard } from "@/lib/types";

export const runtime = "nodejs";

const HUNTER = "#22382B";
const CREAM = "#fbf8f3";
const CHAMPAGNE = "#c9b291";
const INK2 = "#5f6a5a";

/**
 * Export a board as a PDF signed with the house's mark.
 * RLS decides who can read the board — the couple gets published
 * boards of their wedding, the team gets everything.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await gate(false);
  if ("error" in g) return g.error;
  const { id } = await params;

  const supabase = await createClient();
  const { data: board } = await supabase
    .from("boards")
    .select("*, weddings(couple_display_name, destination)")
    .eq("id", id)
    .maybeSingle<Board & { weddings: { couple_display_name: string; destination: string } | null }>();
  if (!board) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { data: subBoards } = await supabase
    .from("sub_boards")
    .select("*")
    .eq("board_id", id);

  let plaque: Buffer | null = null;
  try {
    plaque = await readFile(path.join(process.cwd(), "public", "brand", "plaque.png"));
  } catch {
    plaque = null;
  }

  const doc = h(
    Document,
    { title: board.title, author: "Madame Wedding Design" },
    h(
      Page,
      { size: "A4", style: { backgroundColor: CREAM, padding: 56, fontFamily: "Times-Roman" } },
      // header
      h(
        View,
        { style: { borderBottom: `1pt solid ${CHAMPAGNE}`, paddingBottom: 18, marginBottom: 28 } },
        h(Text, {
          style: { fontSize: 9, color: INK2, letterSpacing: 3, textTransform: "uppercase" },
          children: "Madame Wedding Design — The Inner House"
        }),
        h(Text, {
          style: { fontSize: 26, color: HUNTER, marginTop: 10 },
          children: board.title
        }),
        board.subtitle
          ? h(Text, {
              style: { fontSize: 14, color: INK2, marginTop: 4, fontFamily: "Times-Italic" },
              children: board.subtitle
            })
          : null,
        board.weddings
          ? h(Text, {
              style: { fontSize: 10, color: INK2, marginTop: 8 },
              children: `${board.weddings.couple_display_name} · ${board.weddings.destination}`
            })
          : null
      ),
      // palette
      board.palette.length > 0
        ? h(
            View,
            { style: { marginBottom: 26 } },
            h(Text, {
              style: { fontSize: 9, color: INK2, letterSpacing: 3, textTransform: "uppercase", marginBottom: 10 },
              children: "Palette"
            }),
            h(
              View,
              { style: { flexDirection: "row", gap: 10 } },
              ...board.palette.map((tone) =>
                h(View, {
                  key: tone,
                  style: {
                    width: 52,
                    height: 52,
                    backgroundColor: tone,
                    border: `1pt solid ${CHAMPAGNE}`
                  }
                })
              )
            ),
            h(Text, {
              style: { fontSize: 9, color: INK2, marginTop: 8 },
              children: board.palette.join("  ·  ")
            })
          )
        : null,
      // sub-boards
      (subBoards ?? []).length > 0
        ? h(
            View,
            { style: { marginBottom: 26 } },
            h(Text, {
              style: { fontSize: 9, color: INK2, letterSpacing: 3, textTransform: "uppercase", marginBottom: 8 },
              children: "Sub-boards"
            }),
            ...(subBoards as SubBoard[]).map((s) =>
              h(Text, {
                key: s.id,
                style: { fontSize: 11, color: HUNTER, marginBottom: 4 },
                children: `— ${s.title ?? s.kind} (${s.status.replace("_", " ")})`
              })
            )
          )
        : null,
      // signature
      h(
        View,
        {
          style: {
            position: "absolute",
            bottom: 48,
            left: 56,
            right: 56,
            borderTop: `1pt solid ${CHAMPAGNE}`,
            paddingTop: 14,
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center"
          }
        },
        h(Text, {
          style: { fontSize: 9, color: INK2, fontFamily: "Times-Italic" },
          children: "A Parisian house of wedding planning and production"
        }),
        plaque
          ? h(Image, { src: { data: plaque, format: "png" }, style: { width: 64 } })
          : h(Text, { style: { fontSize: 10, color: HUNTER }, children: "MWD" })
      )
    )
  );

  const buffer = await renderToBuffer(doc);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="MWD — ${board.title}.pdf"`
    }
  });
}
