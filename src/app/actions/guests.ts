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
  "address", "city", "postal_code", "country", "phone", "email",
  "locale", "travel", "dietary", "party_adults",
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

/* ══════════ The grid — per person, per event (0024, §A3) ══════════ */

export type GridStatus = "attending" | "declined" | "pending";

/**
 * One cell of the matrix: the person's word for one event. `null`
 * withdraws the invitation — "not invited" is the absence of a row.
 */
export async function setPersonEventStatus(
  weddingId: string,
  personId: string,
  eventId: string,
  status: GridStatus | null
) {
  await houseSession();
  const supabase = await createClient();
  let error = null;
  if (status === null) {
    ({ error } = await supabase
      .from("person_event_status")
      .delete()
      .eq("person_id", personId)
      .eq("event_id", eventId)
      .eq("wedding_id", weddingId));
  } else {
    ({ error } = await supabase.from("person_event_status").upsert({
      person_id: personId,
      event_id: eventId,
      wedding_id: weddingId,
      status,
      updated_at: new Date().toISOString()
    }));
  }
  revalidatePath("/communication");
  return { ok: !error };
}

/**
 * The household cell: one word for everyone invited — or, on an empty
 * cell, the whole household enters the column as pending.
 */
export async function setHouseholdEventStatus(
  weddingId: string,
  householdId: string,
  eventId: string,
  status: GridStatus
) {
  await houseSession();
  const supabase = await createClient();
  const { data: persons } = await supabase
    .from("guest_persons")
    .select("id")
    .eq("household_id", householdId)
    .eq("wedding_id", weddingId);
  if (!persons?.length) return { ok: false as const };
  const { error } = await supabase.from("person_event_status").upsert(
    persons.map((p) => ({
      person_id: p.id,
      event_id: eventId,
      wedding_id: weddingId,
      status,
      updated_at: new Date().toISOString()
    }))
  );
  revalidatePath("/communication");
  return { ok: !error };
}

/**
 * A person joins the household — and inherits the events their
 * household is already invited to, pending their own word.
 */
export async function addPerson(
  weddingId: string,
  householdId: string,
  kind: "adult" | "child" = "adult"
) {
  await houseSession();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("guest_persons")
    .insert({ wedding_id: weddingId, household_id: householdId, kind })
    .select("id")
    .single();
  if (error || !data) return { ok: false as const };
  const { data: siblings } = await supabase
    .from("guest_persons")
    .select("id")
    .eq("household_id", householdId)
    .neq("id", data.id);
  if (siblings?.length) {
    const { data: sibEvents } = await supabase
      .from("person_event_status")
      .select("event_id")
      .in("person_id", siblings.map((s) => s.id));
    const eventIds = [...new Set((sibEvents ?? []).map((e) => e.event_id))];
    if (eventIds.length) {
      await supabase.from("person_event_status").upsert(
        eventIds.map((event_id) => ({
          person_id: data.id,
          event_id,
          wedding_id: weddingId,
          status: "pending"
        }))
      );
    }
  }
  revalidatePath("/communication");
  return { ok: true as const, id: data.id as string };
}

const PERSON_FIELDS = new Set(["full_name", "dietary", "kind", "age", "accessibility"]);

/** The person's own line: a name arriving, a regime, adult or child. */
export async function patchPerson(
  personId: string,
  weddingId: string,
  field: string,
  value: string | number | null
) {
  await houseSession();
  if (!PERSON_FIELDS.has(field)) return { ok: false as const };
  const supabase = await createClient();
  const { error } = await supabase
    .from("guest_persons")
    .update({ [field]: value === "" ? null : value })
    .eq("id", personId)
    .eq("wedding_id", weddingId);
  revalidatePath("/communication");
  return { ok: !error };
}

/** A person leaves the household; their replies leave with them. */
export async function removePerson(personId: string, weddingId: string) {
  await houseSession();
  const supabase = await createClient();
  const { error } = await supabase
    .from("guest_persons")
    .delete()
    .eq("id", personId)
    .eq("wedding_id", weddingId);
  revalidatePath("/communication");
  return { ok: !error };
}

/**
 * The serial hand on the grid: many persons, one gesture — invite to
 * an event, withdraw from it, or set one status across the selection.
 */
export async function bulkGrid(
  weddingId: string,
  personIds: string[],
  action:
    | { kind: "invite"; eventId: string }
    | { kind: "withdraw"; eventId: string }
    | { kind: "status"; eventId: string; status: GridStatus }
) {
  await houseSession();
  if (!personIds.length) return { ok: true as const };
  const supabase = await createClient();
  if (action.kind === "withdraw") {
    await supabase
      .from("person_event_status")
      .delete()
      .eq("event_id", action.eventId)
      .eq("wedding_id", weddingId)
      .in("person_id", personIds);
  } else {
    await supabase.from("person_event_status").upsert(
      personIds.map((person_id) => ({
        person_id,
        event_id: action.eventId,
        wedding_id: weddingId,
        status: action.kind === "status" ? action.status : "pending",
        updated_at: new Date().toISOString()
      }))
    );
  }
  revalidatePath("/communication");
  return { ok: true as const };
}

/* ══════════ The household drawer (final prompt §A2/A4) ═════════════ */

export interface HouseholdDrawerFields {
  title: string;
  firstNames: string;
  surname: string;
  suffix: string;
  invitationLine: string;
  email: string;
  phone: string;
  address: string;
  addressLine2: string;
  city: string;
  postalCode: string;
  region: string;
  country: string;
  locale: string;
  side: string;
  relationship: string;
  category: string;
  vip: boolean;
  accommodationWished: boolean;
  partyChildren: number;
  notesInternal: string;
}

/**
 * The drawer saves the whole household file in one gesture — created
 * with its first person, or corrected in place. The house's hand
 * marks the row; nothing overwrites it.
 */
export async function saveHousehold(
  weddingId: string,
  householdId: string | null,
  f: HouseholdDrawerFields
) {
  await houseSession();
  const supabase = await createClient();
  const full: Record<string, unknown> = {
    title: f.title || null,
    first_names: f.firstNames || null,
    surname: f.surname || null,
    suffix: f.suffix || null,
    invitation_line: f.invitationLine || null,
    email: f.email || null,
    phone: f.phone || null,
    address: f.address || null,
    address_line2: f.addressLine2 || null,
    city: f.city || null,
    postal_code: f.postalCode || null,
    region: f.region || null,
    country: f.country || null,
    locale: f.locale || "en",
    side: f.side || null,
    relationship: f.relationship || null,
    category: f.category || null,
    vip: !!f.vip,
    accommodation_wished: !!f.accommodationWished,
    party_children: Math.max(0, Math.round(f.partyChildren || 0)),
    notes_internal: f.notesInternal || null,
    provenance: "house",
    house_touched_at: new Date().toISOString()
  };
  // Pre-migration columns may be absent — shed the newest first, so
  // the correction still lands on an older schema.
  const shed = [
    ["address_line2", "region", "side", "relationship", "category", "vip",
     "accommodation_wished", "notes_internal"],
    ["city", "postal_code", "country", "phone", "email"],
    ["suffix", "provenance", "house_touched_at"]
  ];
  const patch = { ...full };
  let newId: string | null = null;
  let error: unknown = null;
  for (let round = 0; round <= shed.length; round++) {
    if (round > 0) for (const c of shed[round - 1]) delete patch[c];
    if (householdId) {
      ({ error } = await supabase
        .from("guests").update(patch).eq("id", householdId).eq("wedding_id", weddingId));
    } else {
      const res = await supabase
        .from("guests").insert({ ...patch, wedding_id: weddingId }).select("id").single();
      error = res.error;
      newId = res.data?.id ?? null;
    }
    if (!error) break;
  }
  if (error) return { ok: false as const };
  if (!householdId && newId) {
    // The household's first person carries the invitation.
    const name = [f.firstNames, f.surname].filter(Boolean).join(" ") || null;
    await supabase.from("guest_persons").insert({
      wedding_id: weddingId,
      household_id: newId,
      full_name: name,
      sort: 0
    });
  }
  revalidatePath("/communication");
  return { ok: true as const, id: (householdId ?? newId) as string };
}

/** A household bows out of the working list without leaving history. */
export async function setHouseholdArchived(weddingId: string, householdId: string, archived: boolean) {
  await houseSession();
  const supabase = await createClient();
  const { error } = await supabase
    .from("guests")
    .update({ archived })
    .eq("id", householdId)
    .eq("wedding_id", weddingId);
  revalidatePath("/communication");
  return { ok: !error };
}

/* ══════════ Events managed from the module (final prompt §A3) ══════ */

export interface EventFields {
  name: string;
  eventDate: string | null;
  startTime: string | null;
  endTime: string | null;
  venue: string | null;
  dressCode: string | null;
  capacity: number | null;
  rsvpDeadline: string | null;
  notes: string | null;
}

function eventRow(f: EventFields) {
  return {
    name: f.name,
    event_date: f.eventDate || null,
    start_time: f.startTime || null,
    end_time: f.endTime || null,
    venue: f.venue || null,
    dress_code: f.dressCode || null,
    capacity: f.capacity ?? null,
    rsvp_deadline: f.rsvpDeadline || null,
    notes: f.notes || null
  };
}

/** A new event — its Grid column appears at once. */
export async function addWeddingEvent(weddingId: string, f: EventFields) {
  await houseSession();
  const supabase = await createClient();
  const { data: last } = await supabase
    .from("wedding_events")
    .select("sort")
    .eq("wedding_id", weddingId)
    .order("sort", { ascending: false })
    .limit(1)
    .maybeSingle();
  const base = { wedding_id: weddingId, sort: (last?.sort ?? 0) + 1 };
  let { data, error } = await supabase
    .from("wedding_events")
    .insert({ ...base, ...eventRow(f) })
    .select("id")
    .single();
  if (error) {
    // Pre-0024: only name, date and sort exist.
    ({ data, error } = await supabase
      .from("wedding_events")
      .insert({ ...base, name: f.name, event_date: f.eventDate || null })
      .select("id")
      .single());
  }
  revalidatePath("/communication");
  return { ok: !error, id: data?.id as string | undefined };
}

/** The event file, corrected in place. */
export async function updateWeddingEvent(weddingId: string, eventId: string, f: EventFields) {
  await houseSession();
  const supabase = await createClient();
  let { error } = await supabase
    .from("wedding_events")
    .update(eventRow(f))
    .eq("id", eventId)
    .eq("wedding_id", weddingId);
  if (error) {
    ({ error } = await supabase
      .from("wedding_events")
      .update({ name: f.name, event_date: f.eventDate || null })
      .eq("id", eventId)
      .eq("wedding_id", weddingId));
  }
  revalidatePath("/communication");
  return { ok: !error };
}

/** The column bows out; every reply in it is kept (archived, not deleted). */
export async function archiveWeddingEvent(weddingId: string, eventId: string, archived: boolean) {
  await houseSession();
  const supabase = await createClient();
  const { error } = await supabase
    .from("wedding_events")
    .update({ archived })
    .eq("id", eventId)
    .eq("wedding_id", weddingId);
  revalidatePath("/communication");
  return { ok: !error };
}

/** Deleting a column erases its attendance — the warning is the UI's duty. */
export async function deleteWeddingEvent(weddingId: string, eventId: string) {
  await houseSession();
  const supabase = await createClient();
  const { error } = await supabase
    .from("wedding_events")
    .delete()
    .eq("id", eventId)
    .eq("wedding_id", weddingId);
  revalidatePath("/communication");
  return { ok: !error };
}

/* ══════════ The import lands (final prompt §B1) ════════════════════ */

export interface ImportRowDecision {
  /** Estelle's word on this row — nothing enters without it. */
  action: "create" | "merge" | "skip";
  mergeInto?: string | null;
  /** Household fields, already normalised and reviewed. */
  fields: Record<string, string>;
  adults?: number;
  children?: number;
  /** Events this household is invited to (pending their word). */
  eventInvites: string[];
}

const IMPORT_FIELDS = new Set([
  "title", "first_names", "surname", "suffix", "invitation_line",
  "email", "phone", "address", "address_line2", "city", "postal_code",
  "region", "country", "locale", "side", "relationship", "category",
  "dietary", "travel", "notes_internal"
]);

/**
 * The reviewed batch enters the list — creations, careful merges,
 * skips — exactly as decided on the review screen. A merge only fills
 * EMPTY fields: a hand-corrected row is never overwritten, by anything.
 * The batch itself is kept (guest_import_batches) and journaled.
 */
export async function importGuests(
  weddingId: string,
  label: string,
  mapping: Record<string, string>,
  rows: ImportRowDecision[]
) {
  const session = await houseSession();
  const supabase = await createClient();
  let created = 0, merged = 0, skipped = 0, invited = 0;

  for (const row of rows) {
    if (row.action === "skip") { skipped++; continue; }
    const fields: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row.fields)) {
      if (IMPORT_FIELDS.has(k) && v !== "") fields[k] = v;
    }

    if (row.action === "create") {
      const { data, error } = await supabase
        .from("guests")
        .insert({
          wedding_id: weddingId,
          ...fields,
          locale: (fields.locale as string) || "en",
          party_adults: Math.max(1, row.adults ?? 1),
          party_children: Math.max(0, row.children ?? 0),
          accommodation_wished: row.fields.accommodation_wished === "yes",
          provenance: "import"
        })
        .select("id")
        .single();
      if (error || !data) continue;
      created++;
      const name = [row.fields.first_names, row.fields.surname].filter(Boolean).join(" ") || null;
      const { data: person } = await supabase
        .from("guest_persons")
        .insert({ wedding_id: weddingId, household_id: data.id, full_name: name, sort: 0 })
        .select("id")
        .single();
      if (person && row.eventInvites.length) {
        await supabase.from("person_event_status").upsert(
          row.eventInvites.map((event_id) => ({
            person_id: person.id, event_id, wedding_id: weddingId, status: "pending"
          })),
          { ignoreDuplicates: true }
        );
        invited += row.eventInvites.length;
      }
    } else if (row.action === "merge" && row.mergeInto) {
      const { data: existing } = await supabase
        .from("guests")
        .select("*")
        .eq("id", row.mergeInto)
        .eq("wedding_id", weddingId)
        .single();
      if (!existing) continue;
      // Only the empty pockets take something — the house's hand stands.
      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(fields)) {
        if (existing[k] == null || existing[k] === "") patch[k] = v;
      }
      if (Object.keys(patch).length) {
        await supabase.from("guests").update(patch).eq("id", row.mergeInto);
      }
      merged++;
      if (row.eventInvites.length) {
        const { data: persons } = await supabase
          .from("guest_persons")
          .select("id")
          .eq("household_id", row.mergeInto);
        if (persons?.length) {
          await supabase.from("person_event_status").upsert(
            persons.flatMap((p) =>
              row.eventInvites.map((event_id) => ({
                person_id: p.id, event_id, wedding_id: weddingId, status: "pending"
              }))
            ),
            { ignoreDuplicates: true }
          );
          invited += row.eventInvites.length;
        }
      }
    }
  }

  await supabase.from("guest_import_batches").insert({
    wedding_id: weddingId,
    label,
    mapping,
    rows: rows.map((r) => ({ action: r.action, line: r.fields.invitation_line ?? null })),
    status: "accepted",
    created_by: session.profile.full_name
  });
  const { logActivity } = await import("@/lib/activity");
  await logActivity(supabase, weddingId, session.profile.full_name, "guest_import", {
    label, created, merged, skipped, invitations: invited
  });
  revalidatePath("/communication");
  return { ok: true as const, created, merged, skipped };
}
