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
  let { data: guest, error } = await supabase
    .from("guests")
    .insert({ wedding_id: input.weddingId, ...guestRow(input) })
    .select("id")
    .single();
  // Before migration 0010 the household columns are absent — the
  // guest still takes their place at the table.
  if (error) {
    const { party_adults, party_children, ...bare } = guestRow(input);
    void party_adults;
    void party_children;
    ({ data: guest, error } = await supabase
      .from("guests")
      .insert({ wedding_id: input.weddingId, ...bare })
      .select("id")
      .single());
  }
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
  revalidatePath("/communication");
  return { ok: true as const };
}

/** Rework a household — every field, and the events it is invited to. */
export async function updateGuest(guestId: string, input: GuestFields) {
  await requireHouseSession();
  const supabase = await createClient();
  let { error } = await supabase.from("guests").update(guestRow(input)).eq("id", guestId);
  if (error) {
    const { party_adults, party_children, ...bare } = guestRow(input);
    void party_adults;
    void party_children;
    ({ error } = await supabase.from("guests").update(bare).eq("id", guestId));
  }
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
  revalidatePath("/communication");
  return { ok: true as const };
}

export async function deleteGuest(guestId: string) {
  await requireHouseSession();
  const supabase = await createClient();
  await supabase.from("guests").delete().eq("id", guestId);
  revalidatePath("/communication");
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
  // The household's own word first (a phone call to the house counts,
  // events or not) — then every event it is invited to follows.
  const { error } = await supabase.from("guests").update({ rsvp }).eq("id", guestId);
  const perEvent = await supabase.from("guest_events").update({ rsvp }).eq("guest_id", guestId);
  revalidatePath("/communication");
  // Before migration 0010 guests.rsvp is absent: the press still lands
  // when the household is linked to at least one event.
  return { ok: !error || !perEvent.error };
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
  revalidatePath("/communication");
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
  revalidatePath("/communication");
  return { ok: true as const, note: parsed.note, count: parsed.flags?.length ?? 0 };
}

/* ══════════ The sheet under the house's hand (lot A, step 2) ══════ */

const HOUSE_FIELDS = new Set([
  "title", "first_names", "surname", "suffix", "invitation_line",
  "address", "locale", "travel", "dietary", "party_adults",
  "party_children", "and_guest"
]);

async function houseSession() {
  const session = await requireHouseSession();
  if (!session.isTeam) throw new Error("team only");
  return session;
}

/**
 * One cell, corrected in place — no modal for a civility or a
 * spelling. The house's hand marks the row (provenance 'house',
 * house_touched_at): an import or an agent never overwrites it.
 */
export async function patchGuestField(
  guestId: string,
  weddingId: string,
  field: string,
  value: string | number | boolean | null
) {
  await houseSession();
  if (!HOUSE_FIELDS.has(field)) return { ok: false as const };
  const supabase = await createClient();
  const patch: Record<string, unknown> = {
    [field]: value === "" ? null : value,
    provenance: "house",
    house_touched_at: new Date().toISOString()
  };
  let { error } = await supabase
    .from("guests")
    .update(patch)
    .eq("id", guestId)
    .eq("wedding_id", weddingId);
  if (error) {
    // Pre-0021: the mark columns are absent — the correction still lands.
    ({ error } = await supabase
      .from("guests")
      .update({ [field]: value === "" ? null : value })
      .eq("id", guestId)
      .eq("wedding_id", weddingId));
  }
  revalidatePath("/communication");
  return { ok: !error };
}

/** "+ add a household" — created at once, the pen lands in the first field. */
export async function quickAddHousehold(weddingId: string, createId?: string) {
  const session = await houseSession();
  void session;
  const supabase = await createClient();
  let { data, error } = await supabase
    .from("guests")
    .insert({
      ...(createId ? { id: createId } : {}),
      wedding_id: weddingId,
      locale: "en",
      provenance: "house",
      house_touched_at: new Date().toISOString()
    })
    .select("id")
    .single();
  if (error) {
    ({ data, error } = await supabase
      .from("guests")
      .insert({ ...(createId ? { id: createId } : {}), wedding_id: weddingId, locale: "en" })
      .select("id")
      .single());
  }
  revalidatePath("/communication");
  return { ok: !error, id: data?.id ?? null };
}

/**
 * Twenty corrections in one gesture (brief §2.2): the selected
 * households take the word together — status, an event granted or
 * withdrawn, or the departure.
 */
export async function bulkGuests(
  weddingId: string,
  guestIds: string[],
  action:
    | { kind: "rsvp"; rsvp: "pending" | "confirmed" | "declined" }
    | { kind: "addEvent"; eventId: string }
    | { kind: "removeEvent"; eventId: string }
    | { kind: "delete" }
) {
  await houseSession();
  if (!guestIds.length) return { ok: false as const };
  const supabase = await createClient();
  if (action.kind === "rsvp") {
    await supabase.from("guests").update({ rsvp: action.rsvp }).in("id", guestIds).eq("wedding_id", weddingId);
    await supabase.from("guest_events").update({ rsvp: action.rsvp }).in("guest_id", guestIds);
  } else if (action.kind === "addEvent") {
    const { data: existing } = await supabase
      .from("guest_events")
      .select("guest_id")
      .eq("event_id", action.eventId)
      .in("guest_id", guestIds);
    const have = new Set((existing ?? []).map((l) => l.guest_id));
    const rows = guestIds
      .filter((id) => !have.has(id))
      .map((guest_id) => ({ guest_id, event_id: action.eventId, wedding_id: weddingId }));
    if (rows.length) await supabase.from("guest_events").insert(rows);
  } else if (action.kind === "removeEvent") {
    await supabase
      .from("guest_events")
      .delete()
      .eq("event_id", action.eventId)
      .in("guest_id", guestIds);
  } else if (action.kind === "delete") {
    await supabase.from("guests").delete().in("id", guestIds).eq("wedding_id", weddingId);
  }
  revalidatePath("/communication");
  return { ok: true as const };
}

/** The way back for a removed household — same id, same events (Cmd+Z). */
export async function restoreGuest(
  weddingId: string,
  row: Record<string, unknown>,
  eventIds: string[]
) {
  await houseSession();
  const supabase = await createClient();
  const { created_at, ...rest } = row;
  void created_at;
  let { error } = await supabase.from("guests").insert({ ...rest, wedding_id: weddingId });
  if (error) {
    const { suffix, and_guest, provenance, house_touched_at, ...bare } = rest;
    void suffix; void and_guest; void provenance; void house_touched_at;
    ({ error } = await supabase.from("guests").insert({ ...bare, wedding_id: weddingId }));
  }
  if (!error && eventIds.length && row.id) {
    await supabase.from("guest_events").insert(
      eventIds.map((event_id) => ({ guest_id: row.id, event_id, wedding_id: weddingId }))
    );
  }
  revalidatePath("/communication");
  return { ok: !error };
}

/** One event granted or withdrawn for one household, in place. */
export async function toggleGuestEvent(
  guestId: string,
  weddingId: string,
  eventId: string,
  on: boolean
) {
  await houseSession();
  const supabase = await createClient();
  if (on) {
    await supabase
      .from("guest_events")
      .upsert({ guest_id: guestId, event_id: eventId, wedding_id: weddingId }, { onConflict: "guest_id,event_id" });
  } else {
    await supabase.from("guest_events").delete().eq("guest_id", guestId).eq("event_id", eventId);
  }
  revalidatePath("/communication");
  return { ok: true as const };
}
