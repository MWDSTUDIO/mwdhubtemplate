"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { requireHouseSession } from "@/lib/session";
import { runAgent } from "@/lib/agents/run";
import { createWeddingFolders } from "@/lib/google/drive";
import { DEFAULT_FORMS } from "@/lib/templates";

const MOMENT_BOARDS: { type: string; title: string; sort: number }[] = [
  { type: "global", title: "Global design", sort: 0 },
  { type: "floral", title: "Floral design", sort: 1 },
  { type: "tablescape", title: "Tablescape", sort: 2 },
  { type: "welcome", title: "Welcome & Rehearsal", sort: 3 },
  { type: "cocktail", title: "Wedding cocktail", sort: 4 },
  { type: "dinner", title: "Wedding dinner", sort: 5 },
  { type: "reception", title: "Wedding reception", sort: 6 },
  { type: "farewell", title: "Farewell", sort: 7 },
  { type: "stationery", title: "Stationery", sort: 8 }
];

async function teamSession() {
  const session = await requireHouseSession();
  if (!session.isTeam) throw new Error("team only");
  return session;
}

/**
 * The Desk — a new couple is set in motion in minutes: the wedding row,
 * its events, blank boards with their sub-boards, the closed rooming
 * list. Nothing hard-coded anywhere else.
 */
export async function saveWedding(input: {
  id?: string;
  coupleDisplayName: string;
  partnerA: string;
  partnerB: string;
  destination: string;
  venue: string;
  dateStart: string;
  dateEnd: string;
  defaultLocale: string;
  languages: string[];
  budgetTotal: number | null;
  events: { name: string; date: string }[];
  brief: string;
}) {
  await teamSession();
  const supabase = await createClient();

  const slug =
    `${input.partnerA}-${input.partnerB}`.toLowerCase().replace(/[^a-z0-9]+/g, "-") +
    (input.id ? "" : `-${Date.now().toString(36).slice(-4)}`);

  const row = {
    couple_display_name: input.coupleDisplayName,
    partner_a: input.partnerA,
    partner_b: input.partnerB,
    destination: input.destination,
    venue: input.venue || null,
    date_start: input.dateStart || null,
    date_end: input.dateEnd || null,
    default_locale: input.defaultLocale,
    languages: input.languages,
    budget_total: input.budgetTotal,
    first_toast_at: input.dateStart ? `${input.dateStart}T19:00:00+02:00` : null
  };

  let weddingId = input.id;
  if (weddingId) {
    await supabase.from("weddings").update(row).eq("id", weddingId);
  } else {
    const { data: wedding, error } = await supabase
      .from("weddings")
      .insert({ ...row, slug })
      .select("id")
      .single();
    if (error || !wedding) return { ok: false as const };
    weddingId = wedding.id;

    // Instantiate the blank spaces of the house.
    await supabase.from("boards").insert(
      MOMENT_BOARDS.map((b) => ({ wedding_id: weddingId, ...b }))
    );
    const { data: created } = await supabase
      .from("boards")
      .select("id, type")
      .eq("wedding_id", weddingId);
    const subs: { board_id: string; wedding_id: string; kind: string; title?: string }[] = [];
    for (const board of created ?? []) {
      if (board.type === "global") continue;
      if (board.type === "stationery") {
        subs.push(
          { board_id: board.id, wedding_id: weddingId!, kind: "invitations", title: "Wedding invitations" },
          { board_id: board.id, wedding_id: weddingId!, kind: "day_of", title: "Day-of stationery" }
        );
      } else {
        subs.push(
          { board_id: board.id, wedding_id: weddingId!, kind: "rental" },
          { board_id: board.id, wedding_id: weddingId!, kind: "stationery" }
        );
      }
    }
    if (subs.length) await supabase.from("sub_boards").insert(subs);
    await supabase.from("rooming_list_state").insert({ wedding_id: weddingId, opened: false });

    // The house's form templates, ready to send at the right moment.
    await supabase.from("forms").insert(
      DEFAULT_FORMS.map((f) => ({
        wedding_id: weddingId,
        title: f.title,
        status: f.status,
        due_label: f.due_label ?? null,
        schema: f.schema,
        sort: f.sort
      }))
    );

    // One Drive folder per client (shared / internal) — best effort.
    try {
      const folders = await createWeddingFolders(input.coupleDisplayName);
      if (folders) {
        await supabase
          .from("weddings")
          .update({
            drive_folder_shared_id: folders.shared,
            drive_folder_internal_id: folders.internal
          })
          .eq("id", weddingId);
      }
    } catch {
      // Drive not configured — the hub stands without it.
    }
  }

  // Events are free labels, synced with the sheet: removed rows leave,
  // dates follow, new labels arrive in order.
  {
    const { data: existing } = await supabase
      .from("wedding_events")
      .select("id, name")
      .eq("wedding_id", weddingId);
    const wanted = input.events;
    const wantedNames = new Set(wanted.map((e) => e.name));
    const leftover = (existing ?? []).filter((e) => !wantedNames.has(e.name));
    if (leftover.length) {
      await supabase
        .from("wedding_events")
        .delete()
        .in("id", leftover.map((e) => e.id));
    }
    for (const [i, event] of wanted.entries()) {
      const match = (existing ?? []).find((e) => e.name === event.name);
      if (match) {
        await supabase
          .from("wedding_events")
          .update({ event_date: event.date || null, sort: i + 1 })
          .eq("id", match.id);
      } else {
        await supabase.from("wedding_events").insert({
          wedding_id: weddingId,
          name: event.name,
          event_date: event.date || null,
          sort: i + 1
        });
      }
    }
  }

  if (input.brief.trim()) {
    await supabase.from("wedding_briefs").upsert({
      wedding_id: weddingId,
      body: input.brief.trim(),
      updated_at: new Date().toISOString()
    });
  }

  // The whole hub turns to the wedding just set in motion.
  const cookieStore = await cookies();
  cookieStore.set("mwd_wedding", weddingId!, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365
  });

  revalidatePath("/", "layout");
  return { ok: true as const, weddingId };
}

/** Add a bespoke form to a wedding (title + fields, from The Desk). */
export async function addForm(input: {
  weddingId: string;
  title: string;
  fields: { label: string; type: "text" | "textarea" }[];
}) {
  await teamSession();
  const supabase = await createClient();
  const { count } = await supabase
    .from("forms")
    .select("id", { count: "exact", head: true })
    .eq("wedding_id", input.weddingId);
  await supabase.from("forms").insert({
    wedding_id: input.weddingId,
    title: input.title,
    status: "awaiting",
    schema: input.fields.map((f, i) => ({ name: `field_${i + 1}`, label: f.label, type: f.type })),
    sort: (count ?? 0) + 1
  });
  revalidatePath("/forms");
  revalidatePath("/desk");
  return { ok: true };
}

/**
 * Add a supplementary board beyond the house's standard moments
 * (requires migration 0006 — 'custom' board type).
 */
export async function addCustomBoard(weddingId: string, title: string) {
  await teamSession();
  const supabase = await createClient();
  const { count } = await supabase
    .from("boards")
    .select("id", { count: "exact", head: true })
    .eq("wedding_id", weddingId);
  const { data: board, error } = await supabase
    .from("boards")
    .insert({ wedding_id: weddingId, type: "custom", title, sort: (count ?? 0) + 1 })
    .select("id")
    .single();
  if (error || !board) {
    return { ok: false as const, needsMigration: /invalid input value|unique/.test(error?.message ?? "") };
  }
  await supabase.from("sub_boards").insert([
    { board_id: board.id, wedding_id: weddingId, kind: "rental" },
    { board_id: board.id, wedding_id: weddingId, kind: "stationery" }
  ]);
  revalidatePath("/design");
  return { ok: true as const };
}

/**
 * The timeline composer: from dates, events and the brief, the agent
 * composes the full production timeline in the manner of the great
 * houses — every milestone at its month, as drafts on Estelle's desk.
 */
export async function composeTimeline(weddingId: string) {
  await teamSession();
  const supabase = await createClient();

  const raw = await runAgent({
    weddingId,
    agent: "timeline",
    maxTokens: 1600,
    prompt:
      `Compose the full production timeline from today to the wedding, in the manner of the great houses: ` +
      `design boards, vendor curation and contracts, payments, stationery and proofs, guest communication, RSVPs, ` +
      `hotel blocks, tastings, day-of preparation. One milestone per month (a month may carry two if needed, max 18 total). ` +
      `Reply with STRICT JSON only: {"milestones": [{"month": "yyyy-mm", "label": string (max 9 words)}], ` +
      `"note": string (one sentence to Estelle)}`
  });

  const parsed = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, "")) as {
    milestones: { month: string; label: string }[];
    note: string;
  };

  const rows = (parsed.milestones ?? []).map((m, i) => ({
    wedding_id: weddingId,
    month: `${m.month}-01`,
    label: m.label,
    status: "draft" as const,
    sort: i
  }));
  if (rows.length) await supabase.from("timeline_milestones").insert(rows);

  revalidatePath("/timeline");
  return { ok: true as const, count: rows.length, note: parsed.note };
}
