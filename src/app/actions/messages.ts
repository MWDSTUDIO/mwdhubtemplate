"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireHouseSession } from "@/lib/session";
import { notifyCouple, notifyProfiles, notifyTeam } from "@/lib/notify";

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
  return { ok: true };
}
