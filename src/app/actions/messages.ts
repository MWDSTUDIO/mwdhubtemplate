"use server";

import { createClient } from "@/lib/supabase/server";
import { requireHouseSession } from "@/lib/session";
import { notifyCouple, notifyTeam } from "@/lib/notify";

/** Send a chat message; the other side is notified (push + email). */
export async function sendMessage(
  weddingId: string,
  channel: "client" | "teamwork",
  body: string,
  subject?: string | null
) {
  const session = await requireHouseSession();
  const text = body.trim();
  if (!text) return { ok: false };

  const supabase = await createClient();
  const row: Record<string, unknown> = {
    wedding_id: weddingId,
    channel,
    author_id: session.userId,
    body: text
  };
  if (subject?.trim()) row.subject = subject.trim();
  let { error } = await supabase.from("messages").insert(row);
  // Before migration 0010 the subject column is absent — the word
  // still reaches the house, in the general thread.
  if (error && row.subject) {
    delete row.subject;
    ({ error } = await supabase.from("messages").insert(row));
  }
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
