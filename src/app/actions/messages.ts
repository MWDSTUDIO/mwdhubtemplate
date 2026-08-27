"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireHouseSession } from "@/lib/session";
import { notifyCouple, notifyProfiles, notifyTeam } from "@/lib/notify";
import type { Message } from "@/lib/types";

const fold = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * "@jordane" is a summons, not a decoration: whoever of the hub is
 * cited receives the word directly (bell, push, email when wired).
 */
async function notifyMentions(
  weddingId: string,
  authorId: string,
  authorName: string,
  text: string
) {
  const handles = [...text.matchAll(/@([\p{L}\p{N}._-]+)/gu)].map((m) => fold(m[1]));
  if (handles.length === 0) return;

  const admin = createAdminClient();
  const [{ data: team }, { data: members }] = await Promise.all([
    admin.from("profiles").select("id, full_name").eq("role", "team"),
    admin
      .from("wedding_members")
      .select("profile_id, profiles(full_name)")
      .eq("wedding_id", weddingId)
  ]);
  const people = [
    ...(team ?? []),
    ...((members ?? []) as unknown as { profile_id: string; profiles: { full_name: string } | null }[]).map(
      (m) => ({ id: m.profile_id, full_name: m.profiles?.full_name ?? "" })
    )
  ];
  const cited = people.filter((p) => {
    if (p.id === authorId || !p.full_name) return false;
    const name = fold(p.full_name);
    const first = name.split(/\s+/)[0];
    return handles.some((h) => h === first || h === name.replace(/\s+/g, ""));
  });
  if (cited.length === 0) return;

  const preview = text.length > 90 ? `${text.slice(0, 90)}…` : text;
  await notifyProfiles([...new Set(cited.map((p) => p.id))], weddingId, {
    kind: "mention",
    title: `${authorName} cites you`,
    body: preview,
    url: "/messages"
  });
}

/** Send a chat message; the other side is notified (push + email). */
export async function sendMessage(
  weddingId: string,
  channel: "client" | "teamwork",
  body: string,
  subject?: string | null,
  attachmentPath?: string | null
) {
  const session = await requireHouseSession();
  const text = body.trim();
  // A photo may travel alone; words may travel alone; never neither.
  if (!text && !attachmentPath) return { ok: false };

  const supabase = await createClient();
  const row: Record<string, unknown> = {
    wedding_id: weddingId,
    channel,
    author_id: session.userId,
    body: text
  };
  if (subject?.trim()) row.subject = subject.trim();
  if (attachmentPath) row.attachment_path = attachmentPath;
  // The persisted row returns so the salon can trade its optimistic
  // bubble for the server's word — confirmed, not presumed.
  let { data, error } = await supabase.from("messages").insert(row).select().single();
  // Before migration 0035 the attachment column is absent; before
  // 0010 the subject column is — the word still reaches the house.
  if (error && row.attachment_path) {
    delete row.attachment_path;
    if (!text) return { ok: false, needsMigration: true };
    ({ data, error } = await supabase.from("messages").insert(row).select().single());
  }
  if (error && row.subject) {
    delete row.subject;
    ({ data, error } = await supabase.from("messages").insert(row).select().single());
  }
  if (error) return { ok: false };

  await notifyMentions(weddingId, session.userId, session.profile.full_name, text);

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
  return { ok: true, message: data as Message | null };
}

/**
 * The author withdraws their own message (0035) — a quiet trace
 * stays, nothing is deleted, nothing edited. RLS holds the pen: only
 * the author's own line can move, and the UI offers no other change.
 */
export async function withdrawMessage(messageId: string) {
  const session = await requireHouseSession();
  const supabase = await createClient();
  const { error } = await supabase
    .from("messages")
    .update({ withdrawn_at: new Date().toISOString() })
    .eq("id", messageId)
    .eq("author_id", session.userId);
  if (error) return { ok: false as const, needsMigration: true };
  return { ok: true as const };
}
