"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireHouseSession } from "@/lib/session";
import { notifyTeam, notifyCouple } from "@/lib/notify";
import { createMeetEvent } from "@/lib/google/calendar";
import { createAdminClient } from "@/lib/supabase/admin";

export async function proposeMoment(input: {
  weddingId: string;
  durationMinutes: 30 | 60;
  slots: { date: string; time: string }[];
}) {
  const session = await requireHouseSession();
  if (input.slots.length === 0) return { ok: false };

  const supabase = await createClient();
  const { error } = await supabase.from("availability_proposals").insert({
    wedding_id: input.weddingId,
    proposed_by: session.userId,
    duration_minutes: input.durationMinutes,
    slots: input.slots
  });
  if (error) return { ok: false };

  await notifyTeam(input.weddingId, {
    kind: "moment_proposed",
    title: "A moment proposed",
    body: `${session.profile.full_name} proposed ${input.slots.length} slot(s) — ${input.durationMinutes} min.`,
    url: "/"
  });
  revalidatePath("/");
  return { ok: true };
}

/** Estelle confirms one slot → Google Meet event on both sides + notification. */
export async function confirmMoment(proposalId: string, slot: { date: string; time: string }) {
  const session = await requireHouseSession();
  if (!session.isTeam) throw new Error("team only");

  const supabase = await createClient();
  const { data: proposal } = await supabase
    .from("availability_proposals")
    .select("*, weddings(couple_display_name, timezone)")
    .eq("id", proposalId)
    .single();
  if (!proposal) return { ok: false };

  // The invitation goes to both sides: the couple's addresses and the
  // house's inbox — never a personal box.
  const attendees: string[] = [];
  if (process.env.HOUSE_INBOX) attendees.push(process.env.HOUSE_INBOX);
  try {
    const admin = createAdminClient();
    const { data: members } = await admin
      .from("wedding_members")
      .select("profile_id, relation")
      .eq("wedding_id", proposal.wedding_id)
      .eq("relation", "couple");
    for (const m of members ?? []) {
      const { data: u } = await admin.auth.admin.getUserById(m.profile_id);
      if (u?.user?.email) attendees.push(u.user.email);
    }
  } catch {
    // Emails unavailable — the event still stands.
  }

  let meetUrl: string | null = null;
  let eventId: string | null = null;
  try {
    const event = await createMeetEvent({
      summary: `Madame Wedding Design — ${proposal.weddings?.couple_display_name ?? "call"}`,
      date: slot.date,
      time: slot.time,
      durationMinutes: proposal.duration_minutes,
      timezone: proposal.weddings?.timezone ?? "Europe/Paris",
      attendees
    });
    meetUrl = event.meetUrl;
    eventId = event.id;
  } catch {
    // Calendar not configured — the confirmation still stands.
  }

  await supabase
    .from("availability_proposals")
    .update({
      status: "confirmed",
      confirmed_slot: slot,
      calendar_event_id: eventId,
      meet_url: meetUrl
    })
    .eq("id", proposalId);

  await notifyCouple(proposal.wedding_id, {
    kind: "moment_confirmed",
    title: "Your call is confirmed",
    body: `${slot.date} · ${slot.time}${meetUrl ? " — the Google Meet invitation follows." : ""}`,
    url: "/"
  });
  revalidatePath("/");
  return { ok: true, meetUrl };
}
