"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireHouseSession } from "@/lib/session";
import { notifyCouple, notifyTeam } from "@/lib/notify";

/** Team moves a board through the workflow; "to_review" notifies the client. */
export async function setBoardStatus(
  boardId: string,
  status: "in_creation" | "to_review" | "approved"
) {
  const session = await requireHouseSession();
  if (!session.isTeam) throw new Error("team only");
  const supabase = await createClient();
  const { data: board } = await supabase
    .from("boards")
    .update({ status })
    .eq("id", boardId)
    .select("wedding_id, title")
    .single();
  if (board && status === "to_review") {
    await notifyCouple(board.wedding_id, {
      kind: "board_to_review",
      title: "A board awaits your word",
      body: board.title,
      url: `/design/${boardId}`
    });
  }
  revalidatePath("/design");
}

/** The couple approves a board or leaves a comment; the team is notified. */
export async function respondToBoard(
  boardId: string,
  kind: "approval" | "comment",
  body: string
) {
  const session = await requireHouseSession();
  const supabase = await createClient();
  const { data: board } = await supabase
    .from("boards")
    .select("wedding_id, title")
    .eq("id", boardId)
    .single();
  if (!board) return;

  await supabase.from("board_comments").insert({
    board_id: boardId,
    wedding_id: board.wedding_id,
    author_id: session.userId,
    kind,
    body: body || null
  });
  if (kind === "approval") {
    await supabase.from("boards").update({ status: "approved" }).eq("id", boardId);
  }
  await notifyTeam(board.wedding_id, {
    kind: `board_${kind}`,
    title: kind === "approval" ? "A board was approved" : "A comment on a board",
    body: `${board.title}${body ? ` — “${body}”` : ""}`,
    url: `/design/${boardId}`
  });
  revalidatePath("/design");
}

/** Team enters a hex code; the app renders the square. */
export async function addPaletteTone(boardId: string, hex: string) {
  const session = await requireHouseSession();
  if (!session.isTeam) throw new Error("team only");
  const clean = hex.trim().toLowerCase();
  if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/.test(clean)) return;
  const supabase = await createClient();
  const { data: board } = await supabase
    .from("boards")
    .select("palette")
    .eq("id", boardId)
    .single();
  if (!board) return;
  await supabase
    .from("boards")
    .update({ palette: [...(board.palette ?? []), clean] })
    .eq("id", boardId);
  revalidatePath("/design");
}

export async function removePaletteTone(boardId: string, index: number) {
  const session = await requireHouseSession();
  if (!session.isTeam) throw new Error("team only");
  const supabase = await createClient();
  const { data: board } = await supabase
    .from("boards")
    .select("palette")
    .eq("id", boardId)
    .single();
  if (!board) return;
  const palette = [...(board.palette ?? [])];
  palette.splice(index, 1);
  await supabase.from("boards").update({ palette }).eq("id", boardId);
  revalidatePath("/design");
}
