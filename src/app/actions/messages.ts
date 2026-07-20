"use server";

import { createClient } from "@/lib/supabase/server";
import { requireHouseSession } from "@/lib/session";
import { notifyCouple, notifyTeam } from "@/lib/notify";

/** Send a chat message; the other side is notified (push + email). */
export async function sendMessage(
  weddingId: string,
  channel: "client" | "teamwork",
  body: string
) {
  const session = await requireHouseSession();
  const text = body.trim();
  if (!text) return { ok: false };

  const supabase = await createClient();
  const { error } = await supabase.from("messages").insert({
    wedding_id: weddingId,
    channel,
    author_id: session.userId,
    body: text
  });
  if (error) return { ok: false };

  const preview = text.length > 90 ? `${text.slice(0, 90)}…` : text;
  if (channel === "client") {
    if (session.isTeam) {
      await notifyCouple(weddingId, {
        kind: "message",
        title: "A word from the house",
        body: preview,
        url: "/messages"
      });
    } else {
      await notifyTeam(weddingId, {
        kind: "message",
        title: `Message — ${session.profile.full_name}`,
        body: preview,
        url: "/messages"
      });
    }
  }
  return { ok: true };
}
