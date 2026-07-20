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
const INK2 = "#6f6a5c";
const CHIP_BG = "#f2ecdf";

type Img = { data: Buffer; format: "png" | "jpg" };

/**
 * The board sheet as a landscape PDF — the validated editorial
 * template: centred header, round palette dots, staggered collage with
 * the raised centre portrait, material chips, the house's mark.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await gate(false);
  if ("error" in g) return g.error;
  const { id } = await params;
  const sub = new URL(request.url).searchParams.get("sub");

  const supabase = await createClient();
  const { data: board } = await supabase
    .from("boards")
    .select("*, weddings(couple_display_name, destination, date_start)")
    .eq("id", id)
    .maybeSingle<Board & { weddings: { couple_display_name: string; destination: string; date_start: string | null } | null }>();
  if (!board) return NextResponse.json({ error: "not found" }, { status: 404 });

  let source: Record<string, unknown> = board as unknown as Record<string, unknown>;
  if (sub) {
    const { data: subRow } = await supabase
      .from("sub_boards")
      .select("content")
      .eq("board_id", id)
      .eq("kind", sub)
      .maybeSingle<Pick<SubBoard, "content">>();
    source = (subRow?.content ?? {}) as Record<string, unknown>;
  }

  const download = async (p?: string | null): Promise<Img | null> => {
    if (!p) return null;
    const { data } = await supabase.storage.from("shared").download(p);
    if (!data) return null;
    return {
      data: Buffer.from(await data.arrayBuffer()),
      format: p.toLowerCase().endsWith(".png") ? "png" : "jpg"
    };
  };

  const photoPaths = (source.photos as Record<string, string>) ?? {};
  const photos: (Img | null)[] = await Promise.all(
    [0, 1, 2, 3, 4, 5, 6].map((i) => download(photoPaths[String(i)]))
  );

  let plaque: Buffer | null = null;
  try {
    plaque = await readFile(path.join(process.cwd(), "public", "brand", "plaque.png"));
  } catch { /* mark falls back to text */ }

  const w = board.weddings;
  const weddingDate = w?.date_start
    ? new Date(w.date_start).toLocaleDateString("en-GB", { month: "long", year: "numeric" })
    : "";
  const eyebrow = (source.eyebrow as string) || `${board.title}${sub ? ` — ${sub}` : ""}`;
  const conceptTitle = (source.concept_title as string) || board.subtitle || board.title;
  const conceptText = (source.concept_text as string) || "";
  const palette = ((source.palette as string[]) ?? board.palette ?? []).filter((x) =>
    /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(x)
  );
  const materials = ((source.materials as string[]) ?? []).filter(Boolean);
  const footerRef =
    (source.footer_ref as string) ||
    `${w?.couple_display_name ?? ""} · ${w?.destination ?? ""}${weddingDate ? ` · ${weddingDate}` : ""}`;

  // ── collage geometry (A4 landscape: 842×595pt) ────────────────────
  const COLLAGE_W = 672;
  const GAP = 9;
  const r1u = COLLAGE_W - 3 * GAP;
  const r1w = [r1u * 0.2247, r1u * 0.3258, r1u * 0.2247, r1u * 0.2247];
  const r1conf = [
    { w: r1w[0], h: (r1w[0] * 4) / 3, mt: 9 },
    { w: r1w[1], h: (r1w[1] * 2) / 3, mt: 1 },
    { w: r1w[2], h: (r1w[2] * 4) / 3, mt: 15 },
    { w: r1w[3], h: (r1w[3] * 4) / 3, mt: 0 }
  ];
  const r2u = COLLAGE_W - 2 * GAP;
  const r2w = [r2u * 0.368, r2u * 0.263, r2u * 0.368];
  const r2conf = [
    { w: r2w[0], h: (r2w[0] * 2) / 3, mt: 6 },
    { w: r2w[1], h: (r2w[1] * 4) / 3, mt: -54 },
    { w: r2w[2], h: (r2w[2] * 2) / 3, mt: 0 }
  ];

  const tile = (img: Img | null, conf: { w: number; h: number; mt: number }, key: string) =>
    h(
      View,
      {
        key,
        style: {
          width: conf.w,
          height: conf.h,
          marginTop: conf.mt,
          backgroundColor: "#ece4d3",
          border: img ? undefined : `0.5pt dashed ${CHAMPAGNE}`,
          overflow: "hidden"
        }
      },
      img
        ? h(Image, {
            src: img,
            style: { width: "100%", height: "100%", objectFit: "cover" }
          })
        : null
    );

  const doc = h(
    Document,
    { title: conceptTitle, author: "Madame Wedding Design" },
    h(
      Page,
      {
        size: "A4",
        orientation: "landscape",
        style: { backgroundColor: CREAM, padding: "26 34", fontFamily: "Times-Roman" }
      },
      // header
      h(
        View,
        { style: { alignItems: "center", marginBottom: 16 } },
        h(Text, {
          style: { fontSize: 6.5, color: INK2, letterSpacing: 2.6, textTransform: "uppercase", fontFamily: "Helvetica" },
          children: eyebrow
        }),
        h(Text, {
          style: { fontSize: 24, color: HUNTER, marginTop: 6 },
          children: conceptTitle
        }),
        conceptText
          ? h(Text, {
              style: {
                fontSize: 9.5, lineHeight: 1.55, color: "#3d4a3f",
                marginTop: 7, maxWidth: 430, textAlign: "center"
              },
              children: conceptText
            })
          : null,
        h(Text, {
          style: { fontSize: 5.5, color: INK2, letterSpacing: 2, textTransform: "uppercase", marginTop: 6, fontFamily: "Helvetica" },
          children: "— Estelle · Madame Wedding Design"
        })
      ),
      // body: palette + collage
      h(
        View,
        { style: { flexDirection: "row", gap: 16 } },
        h(
          View,
          { style: { width: 66, paddingTop: 6, gap: 10 } },
          ...palette.map((hex, i) =>
            h(
              View,
              { key: `p${i}`, style: { flexDirection: "row", alignItems: "center", gap: 5 } },
              h(View, {
                style: {
                  width: 15, height: 15, borderRadius: 8,
                  backgroundColor: hex, border: "0.5pt solid rgba(34,56,43,0.15)"
                }
              }),
              h(Text, { style: { fontSize: 5.5, color: INK2, fontFamily: "Helvetica" }, children: hex })
            )
          )
        ),
        h(
          View,
          { style: { width: COLLAGE_W, gap: GAP } },
          h(
            View,
            { style: { flexDirection: "row", gap: GAP, alignItems: "flex-start" } },
            ...[0, 1, 2, 3].map((i) => tile(photos[i], r1conf[i], `t${i}`))
          ),
          h(
            View,
            { style: { flexDirection: "row", gap: GAP, alignItems: "flex-start" } },
            ...[4, 5, 6].map((i) => tile(photos[i], r2conf[i - 4], `t${i}`))
          )
        )
      ),
      // materials
      materials.length
        ? h(
            View,
            { style: { flexDirection: "row", gap: 6, marginTop: 14, marginLeft: 82, flexWrap: "wrap" } },
            ...materials.map((m, i) =>
              h(Text, {
                key: `m${i}`,
                style: {
                  fontSize: 5.5, letterSpacing: 1.4, textTransform: "uppercase",
                  color: INK2, backgroundColor: CHIP_BG, padding: "5 10", fontFamily: "Helvetica"
                },
                children: m
              })
            )
          )
        : null,
      // footer
      h(
        View,
        {
          style: {
            position: "absolute", bottom: 22, left: 34, right: 34,
            flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end"
          }
        },
        h(Text, {
          style: { fontSize: 5.5, letterSpacing: 1.8, textTransform: "uppercase", color: INK2, fontFamily: "Helvetica" },
          children: footerRef
        }),
        plaque
          ? h(Image, { src: { data: plaque, format: "png" }, style: { width: 62 } })
          : h(Text, { style: { fontSize: 9, color: HUNTER }, children: "MWD" })
      )
    )
  );

  const buffer = await renderToBuffer(doc);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="MWD — ${conceptTitle}.pdf"`
    }
  });
}
