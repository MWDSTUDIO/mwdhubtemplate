"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireHouseSession } from "@/lib/session";
import { runAgent } from "@/lib/agents/run";

interface GuestFields {
  weddingId: string;
  title: string;
  firstNames: string;
  surname: string;
  invitationLine: string;
  address: string;
  locale: string;
  travel: string;
  dietary: string;
  partyAdults: number;
  partyChildren: number;
  eventIds: string[];
}

function guestRow(input: GuestFields) {
  return {
    title: input.title || null,
    first_names: input.firstNames || null,
    surname: input.surname || null,
    invitation_line: input.invitationLine || null,
    address: input.address || null,
    locale: input.locale || "en",
    travel: input.travel || null,
    dietary: input.dietary || null,
    party_adults: Math.max(1, Math.round(input.partyAdults || 1)),
    party_children: Math.max(0, Math.round(input.partyChildren || 0))
  };
}

export async function addGuest(input: GuestFields) {
  await requireHouseSession();
  const supabase = await createClient();
  const { data: guest, error } = await supabase
    .from("guests")
    .insert({ wedding_id: input.weddingId, ...guestRow(input) })
    .select("id")
    .single();
  if (error || !guest) return { ok: false as const };

  if (input.eventIds.length) {
    await supabase.from("guest_events").insert(
      input.eventIds.map((event_id) => ({
        guest_id: guest.id,
        event_id,
        wedding_id: input.weddingId
      }))
    );
  }
  revalidatePath("/guests");
  return { ok: true as const };
}

/** Rework a household — every field, and the events it is invited to. */
export async function updateGuest(guestId: string, input: GuestFields) {
  await requireHouseSession();
  const supabase = await createClient();
  const { error } = await supabase.from("guests").update(guestRow(input)).eq("id", guestId);
  if (error) return { ok: false as const };

  const { data: existing } = await supabase
    .from("guest_events")
    .select("event_id")
    .eq("guest_id", guestId);
  const have = new Set((existing ?? []).map((l) => l.event_id));
  const want = new Set(input.eventIds);
  const toRemove = [...have].filter((id) => !want.has(id));
  const toAdd = [...want].filter((id) => !have.has(id));
  if (toRemove.length) {
    await supabase
      .from("guest_events")
      .delete()
      .eq("guest_id", guestId)
      .in("event_id", toRemove);
  }
  if (toAdd.length) {
    await supabase.from("guest_events").insert(
      toAdd.map((event_id) => ({ guest_id: guestId, event_id, wedding_id: input.weddingId }))
    );
  }
  revalidatePath("/guests");
  return { ok: true as const };
}

export async function deleteGuest(guestId: string) {
  await requireHouseSession();
  const supabase = await createClient();
  await supabase.from("guests").delete().eq("id", guestId);
  revalidatePath("/guests");
  return { ok: true as const };
}

/**
 * One word for the whole household: confirmed, declined, or back to
 * awaiting — across every event it is invited to. The couple may give
 * it as well as the house (RLS allows both, never other clients).
 */
export async function setHouseholdRsvp(
  guestId: string,
  rsvp: "pending" | "confirmed" | "declined"
) {
  await requireHouseSession();
  const supabase = await createClient();
  await supabase.from("guest_events").update({ rsvp }).eq("guest_id", guestId);
  revalidatePath("/guests");
  return { ok: true as const };
}

export async function setRsvp(
  guestId: string,
  eventId: string,
  rsvp: "pending" | "confirmed" | "declined"
) {
  await requireHouseSession();
  const supabase = await createClient();
  await supabase
    .from("guest_events")
    .update({ rsvp })
    .eq("guest_id", guestId)
    .eq("event_id", eventId);
  revalidatePath("/guests");
}

/**
 * The stationer's eye: before anything leaves the house, the agent
 * reads every invitation line as a ceremonial stationer would and
 * flags what should be perfected.
 */
export async function stationerReview(weddingId: string) {
  const session = await requireHouseSession();
  if (!session.isTeam) throw new Error("team only");
  const supabase = await createClient();
  const { data: guests } = await supabase
    .from("guests")
    .select("id, title, first_names, surname, invitation_line, locale")
    .eq("wedding_id", weddingId);

  const raw = await runAgent({
    weddingId,
    agent: "stationer",
    maxTokens: 1400,
    prompt:
      `Review these guest invitation lines with a master ceremonial stationer's eye (French, British and American usage; ` +
      `titles, honourifics, order of names, widowhood, divorce, unmarried couples, children): ${JSON.stringify(guests)}. ` +
      `Reply with STRICT JSON only: {"flags": [{"id": string, "remark": string (the stationer's remark, incl. the corrected line), ` +
      `"corrected_line": string|null}], "note": string (one sentence to the team)}`
  });

  const parsed = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, "")) as {
    flags: { id: string; remark: string; corrected_line: string | null }[];
    note: string;
  };

  for (const flag of parsed.flags ?? []) {
    await supabase.from("guests").update({ stationer_flag: flag.remark }).eq("id", flag.id);
  }
  revalidatePath("/guests");
  return { ok: true as const, note: parsed.note, count: parsed.flags?.length ?? 0 };
}
