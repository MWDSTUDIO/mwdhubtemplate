"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireHouseSession } from "@/lib/session";
import { notifyCouple } from "@/lib/notify";

/** The rooming list opens on Estelle's action alone (RLS: principal). */
export async function openRoomingList(weddingId: string) {
  const session = await requireHouseSession();
  if (!session.isPrincipal) throw new Error("Estelle only");
  const supabase = await createClient();
  await supabase.from("rooming_list_state").upsert({
    wedding_id: weddingId,
    opened: true,
    opened_at: new Date().toISOString(),
    opened_by: session.userId
  });
  await notifyCouple(weddingId, {
    kind: "rooming_opened",
    title: "The rooming list is open",
    body: "The house has opened your rooming list.",
    url: "/communication"
  });
  revalidatePath("/communication");
}

/* ══════════ Lot C — the great house (final prompt) ═════════════════ */

async function teamOnly() {
  const session = await requireHouseSession();
  if (!session.isTeam) throw new Error("team only");
  return session;
}

/* ── C5 · the correspondence register ── */

export interface RegisterLineFields {
  title: string;
  kind: string;
  scheduledLabel: string;
  milestoneId: string | null;
  sent: boolean;
}

/** One line of the register — written, corrected or linked to a
    Timeline milestone; a linked line takes its state from the
    milestone alone (one fact, one place). */
export async function saveRegisterLine(
  weddingId: string,
  lineId: string | null,
  f: RegisterLineFields
) {
  await teamOnly();
  const supabase = await createClient();
  const row: Record<string, unknown> = {
    title: f.title,
    kind: f.kind || "custom",
    scheduled_label: f.scheduledLabel || null,
    milestone_id: f.milestoneId,
    status: f.milestoneId ? "scheduled" : f.sent ? "sent" : "draft",
    sent_at: !f.milestoneId && f.sent ? new Date().toISOString() : null
  };
  let error = null;
  if (lineId) {
    ({ error } = await supabase.from("correspondence").update(row).eq("id", lineId).eq("wedding_id", weddingId));
    if (error) {
      // Pre-0025: no milestone column — the line still lands.
      delete row.milestone_id;
      ({ error } = await supabase.from("correspondence").update(row).eq("id", lineId).eq("wedding_id", weddingId));
    }
  } else {
    ({ error } = await supabase.from("correspondence").insert({ wedding_id: weddingId, body_by_locale: {}, ...row }));
    if (error) {
      delete row.milestone_id;
      ({ error } = await supabase.from("correspondence").insert({ wedding_id: weddingId, body_by_locale: {}, ...row }));
    }
  }
  revalidatePath("/communication");
  return { ok: !error };
}

export async function removeRegisterLine(weddingId: string, lineId: string) {
  await teamOnly();
  const supabase = await createClient();
  const { error } = await supabase.from("correspondence").delete().eq("id", lineId).eq("wedding_id", weddingId);
  revalidatePath("/communication");
  return { ok: !error };
}

/** The house's note on the register — a draft until Estelle's word. */
export async function saveCommNote(weddingId: string, text: string, publish: boolean) {
  await teamOnly();
  const supabase = await createClient();
  let { error } = await supabase
    .from("weddings")
    .update({ comm_note: text.trim() || null, comm_note_status: publish ? "published" : "draft" })
    .eq("id", weddingId);
  if (error) {
    ({ error } = await supabase.from("weddings").update({}).eq("id", weddingId));
  }
  revalidatePath("/communication");
  return { ok: !error };
}

/* ── C2 · the recorded count ── */

export async function recordCountGiven(
  weddingId: string,
  eventId: string,
  recipient: string,
  figure: number,
  givenOn: string
) {
  const session = await teamOnly();
  const supabase = await createClient();
  const { error } = await supabase.from("event_counts_given").insert({
    wedding_id: weddingId,
    event_id: eventId,
    recipient: recipient.trim(),
    figure: Math.round(figure),
    given_on: givenOn,
    created_by: session.profile.full_name
  });
  revalidatePath("/communication");
  return { ok: !error };
}

export async function removeCountGiven(weddingId: string, id: string) {
  await teamOnly();
  const supabase = await createClient();
  const { error } = await supabase.from("event_counts_given").delete().eq("id", id).eq("wedding_id", weddingId);
  revalidatePath("/communication");
  return { ok: !error };
}

/* ── C3 · the pen ── */

/** From this date the couple's edits become proposals. Null = never. */
export async function setPenDate(weddingId: string, date: string | null) {
  await teamOnly();
  const supabase = await createClient();
  const { error } = await supabase.from("weddings").update({ pen_taken_from: date }).eq("id", weddingId);
  revalidatePath("/communication");
  return { ok: !error };
}

/** Estelle applies a couple's proposal in one click — as the house. */
export async function applyProposal(weddingId: string, proposalId: string) {
  const session = await teamOnly();
  const supabase = await createClient();
  const { data: prop } = await supabase
    .from("guest_change_proposals")
    .select("*")
    .eq("id", proposalId)
    .eq("wedding_id", weddingId)
    .single();
  if (!prop || prop.status !== "proposed") return { ok: false as const };
  const payload = prop.payload as Record<string, unknown>;

  if (prop.kind === "add") {
    const { data: hh } = await supabase
      .from("guests")
      .insert({ wedding_id: weddingId, ...payload, provenance: "couple" })
      .select("id")
      .single();
    if (hh) {
      const name = [payload.first_names, payload.surname].filter(Boolean).join(" ") || null;
      await supabase.from("guest_persons").insert({ wedding_id: weddingId, household_id: hh.id, full_name: name, sort: 0 });
    }
  } else if (prop.kind === "update" && prop.household_id) {
    await supabase.from("guests").update(payload).eq("id", prop.household_id).eq("wedding_id", weddingId);
  } else if (prop.kind === "delete" && prop.household_id) {
    await supabase.from("guests").delete().eq("id", prop.household_id).eq("wedding_id", weddingId);
  } else if (prop.kind === "rsvp" && prop.household_id) {
    await supabase.from("guests").update({ rsvp: payload.rsvp }).eq("id", prop.household_id);
    await supabase.from("guest_events").update({ rsvp: payload.rsvp }).eq("guest_id", prop.household_id);
  }

  await supabase
    .from("guest_change_proposals")
    .update({ status: "applied", decided_at: new Date().toISOString() })
    .eq("id", proposalId);
  const { logActivity } = await import("@/lib/activity");
  await logActivity(supabase, weddingId, session.profile.full_name, "proposal_applied", { kind: prop.kind });
  revalidatePath("/communication");
  return { ok: true as const };
}

export async function dismissProposal(weddingId: string, proposalId: string) {
  await teamOnly();
  const supabase = await createClient();
  const { error } = await supabase
    .from("guest_change_proposals")
    .update({ status: "dismissed", decided_at: new Date().toISOString() })
    .eq("id", proposalId)
    .eq("wedding_id", weddingId);
  revalidatePath("/communication");
  return { ok: !error };
}

/* ── C4 · accommodation, deepened ── */

export interface PropertyFields {
  name: string;
  propertyType: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  checkIn: string;
  checkOut: string;
  notes: string;
}

export async function saveProperty(weddingId: string, id: string | null, f: PropertyFields) {
  await teamOnly();
  const supabase = await createClient();
  const row = {
    name: f.name,
    property_type: f.propertyType || "hotel",
    contact_name: f.contactName || null,
    contact_phone: f.contactPhone || null,
    contact_email: f.contactEmail || null,
    check_in: f.checkIn || null,
    check_out: f.checkOut || null,
    notes: f.notes || null
  };
  const { error } = id
    ? await supabase.from("properties").update(row).eq("id", id).eq("wedding_id", weddingId)
    : await supabase.from("properties").insert({ wedding_id: weddingId, ...row });
  revalidatePath("/communication");
  return { ok: !error };
}

export async function removeProperty(weddingId: string, id: string) {
  await teamOnly();
  const supabase = await createClient();
  const { error } = await supabase.from("properties").delete().eq("id", id).eq("wedding_id", weddingId);
  revalidatePath("/communication");
  return { ok: !error };
}

export interface BlockFields {
  name: string;
  dateStart: string;
  dateEnd: string;
  bookingDeadline: string;
  bookingCode: string;
  bookingLink: string;
  rate: number | null;
  rateCurrency: string;
  allocated: number;
}

export async function saveBlock(weddingId: string, propertyId: string, id: string | null, f: BlockFields) {
  await teamOnly();
  const supabase = await createClient();
  const row = {
    name: f.name,
    date_start: f.dateStart || null,
    date_end: f.dateEnd || null,
    booking_deadline: f.bookingDeadline || null,
    booking_code: f.bookingCode || null,
    booking_link: f.bookingLink || null,
    rate: f.rate,
    rate_currency: f.rateCurrency || "EUR",
    allocated: Math.max(0, Math.round(f.allocated || 0))
  };
  const { error } = id
    ? await supabase.from("room_blocks").update(row).eq("id", id).eq("wedding_id", weddingId)
    : await supabase.from("room_blocks").insert({ wedding_id: weddingId, property_id: propertyId, ...row });
  revalidatePath("/communication");
  return { ok: !error };
}

export async function removeBlock(weddingId: string, id: string) {
  await teamOnly();
  const supabase = await createClient();
  const { error } = await supabase.from("room_blocks").delete().eq("id", id).eq("wedding_id", weddingId);
  revalidatePath("/communication");
  return { ok: !error };
}

/** A household takes a room; the remaining count follows by itself. */
export async function assignRoom(weddingId: string, blockId: string, householdId: string) {
  await teamOnly();
  const supabase = await createClient();
  const { error } = await supabase.from("room_assignments").insert({
    wedding_id: weddingId,
    block_id: blockId,
    household_id: householdId,
    status: "requested"
  });
  revalidatePath("/communication");
  return { ok: !error };
}

const ASSIGNMENT_FIELDS = new Set(["status", "room_type", "room_number", "date_start", "date_end", "confirmation_no", "block_id"]);

/** Status chain, room details, or a transfer to another property's block. */
export async function patchAssignment(
  weddingId: string,
  id: string,
  field: string,
  value: string | null
) {
  await teamOnly();
  if (!ASSIGNMENT_FIELDS.has(field)) return { ok: false as const };
  const supabase = await createClient();
  const { error } = await supabase
    .from("room_assignments")
    .update({ [field]: value === "" ? null : value })
    .eq("id", id)
    .eq("wedding_id", weddingId);
  revalidatePath("/communication");
  return { ok: !error };
}

export async function removeAssignment(weddingId: string, id: string) {
  await teamOnly();
  const supabase = await createClient();
  const { error } = await supabase.from("room_assignments").delete().eq("id", id).eq("wedding_id", weddingId);
  revalidatePath("/communication");
  return { ok: !error };
}
