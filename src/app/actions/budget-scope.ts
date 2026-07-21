"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireHouseSession } from "@/lib/session";
import { runAgent } from "@/lib/agents/run";
import { HOUSE_ENVELOPES, type EnvelopeDraft } from "@/lib/templates";

async function teamSession() {
  const session = await requireHouseSession();
  if (!session.isTeam) throw new Error("team only");
  return session;
}



/**
 * The whole scope in one word: the set of envelopes is saved together,
 * and the 100 % rule is enforced here as well as in the sheet — the
 * scope never publishes above 100 %.
 */
export async function saveScope(weddingId: string, envelopes: EnvelopeDraft[]) {
  await teamSession();
  const total = envelopes.reduce((s, e) => s + (Number(e.percent) || 0), 0);
  if (total > 100.001) {
    return { ok: false as const, reason: "over" as const, total: Math.round(total * 10) / 10 };
  }
  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("budget_envelopes")
    .select("id")
    .eq("wedding_id", weddingId);
  const keep = new Set(envelopes.filter((e) => e.id).map((e) => e.id));
  const gone = (existing ?? []).filter((e) => !keep.has(e.id)).map((e) => e.id);
  if (gone.length) {
    // Lines pointing at a removed envelope keep living, unassigned.
    await supabase.from("budget_lines").update({ envelope_id: null }).in("envelope_id", gone);
    await supabase.from("envelope_notes").delete().in("envelope_id", gone);
    await supabase.from("budget_envelopes").delete().in("id", gone);
  }

  for (const [i, env] of envelopes.entries()) {
    const row: Record<string, unknown> = {
      label: env.label.trim(),
      percent: Math.round(Number(env.percent) * 10) / 10,
      sort: i + 1
    };
    const rowFull = { ...row, priority: env.priority, locked: env.locked };
    if (env.id) {
      let { error } = await supabase.from("budget_envelopes").update(rowFull).eq("id", env.id);
      // Before migration 0011 priority/locked are absent.
      if (error) ({ error } = await supabase.from("budget_envelopes").update(row).eq("id", env.id));
      if (error) return { ok: false as const, reason: "save" as const };
    } else {
      let { error } = await supabase
        .from("budget_envelopes")
        .insert({ wedding_id: weddingId, ...rowFull });
      if (error) {
        ({ error } = await supabase.from("budget_envelopes").insert({ wedding_id: weddingId, ...row }));
      }
      if (error) return { ok: false as const, reason: "save" as const };
    }
  }
  revalidatePath("/budget");
  return { ok: true as const };
}

/** Adopt the house's default envelopes for a wedding that has none. */
export async function adoptHouseEnvelopes(weddingId: string) {
  await teamSession();
  const supabase = await createClient();
  const { count } = await supabase
    .from("budget_envelopes")
    .select("id", { count: "exact", head: true })
    .eq("wedding_id", weddingId);
  if ((count ?? 0) > 0) return { ok: true as const };
  for (const env of HOUSE_ENVELOPES) {
    const { error } = await supabase
      .from("budget_envelopes")
      .insert({ wedding_id: weddingId, label: env.label, percent: env.percent, sort: env.sort, priority: env.priority, locked: env.locked });
    if (error) {
      await supabase
        .from("budget_envelopes")
        .insert({ wedding_id: weddingId, label: env.label, percent: env.percent, sort: env.sort });
    }
  }
  revalidatePath("/budget");
  return { ok: true as const };
}

/**
 * Estelle speaks, Madame shapes the envelopes: add, rename, reweigh —
 * returned as a full draft set for the sheet, never saved directly.
 */
export async function scopeViaMadame(
  weddingId: string,
  instruction: string,
  current: EnvelopeDraft[]
) {
  await teamSession();
  const raw = await runAgent({
    weddingId,
    agent: "budget",
    maxTokens: 1200,
    prompt:
      `Current scope envelopes: ${JSON.stringify(current)}.\n` +
      `Estelle's instruction: "${instruction}".\n` +
      `Rework the envelope set accordingly (add, rename, remove, reweigh). Percentages must total at most 100. ` +
      `Reply with STRICT JSON only: {"envelopes": [{"id": string|null (keep the id when the envelope survives), ` +
      `"label": string, "percent": number, "priority": "high"|"standard", "locked": boolean}], ` +
      `"note": string (one sentence to Estelle, in her language)}`
  });
  const parsed = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, "")) as {
    envelopes: EnvelopeDraft[];
    note: string;
  };
  return { ok: true as const, envelopes: parsed.envelopes ?? [], note: parsed.note ?? "" };
}

/**
 * The envelope note, under the language rule: Estelle's raw words stay
 * internal; Madame delivers the client-language version for approval.
 */
export async function refineEnvelopeNote(
  weddingId: string,
  envelopeLabel: string,
  bodyRaw: string
) {
  await teamSession();
  const text = await runAgent({
    weddingId,
    agent: "budget",
    maxTokens: 700,
    prompt:
      `Estelle's raw note for the "${envelopeLabel}" envelope (her own words, any language): "${bodyRaw}".\n` +
      `Compose the client-facing envelope note from it — the house's voice, 2–3 sentences, in the wedding's ` +
      `CLIENT LANGUAGE, signed nowhere (the sheet signs "— Estelle"). Reply with the note text alone.`
  });
  return { ok: true as const, refined: text.trim() };
}

export async function saveEnvelopeNoteV2(input: {
  envelopeId: string;
  weddingId: string;
  bodyRaw: string;
  body: string;
  publish: boolean;
}) {
  await teamSession();
  const supabase = await createClient();
  const status = input.publish ? "published" : "draft";
  let { error } = await supabase.from("envelope_notes").upsert(
    {
      envelope_id: input.envelopeId,
      wedding_id: input.weddingId,
      body: input.body.trim(),
      body_raw: input.bodyRaw.trim() || null,
      status
    },
    { onConflict: "envelope_id" }
  );
  if (error) {
    // Before migration 0011 body_raw is absent.
    ({ error } = await supabase.from("envelope_notes").upsert(
      { envelope_id: input.envelopeId, wedding_id: input.weddingId, body: input.body.trim(), status },
      { onConflict: "envelope_id" }
    ));
  }
  revalidatePath("/budget");
  return { ok: !error };
}

/* ══════════ The risk buffer — team only ══════════ */

export async function saveRisk(input: {
  id?: string;
  weddingId: string;
  label: string;
  exposure: number | null;
  probability: number | null; // 0–100 from the sheet
  owner: string;
  mitigation: string;
}) {
  await teamSession();
  const supabase = await createClient();
  const row = {
    label: input.label.trim(),
    exposure: input.exposure,
    probability: input.probability != null ? Math.min(1, Math.max(0, input.probability / 100)) : null,
    owner: input.owner.trim() || null,
    mitigation: input.mitigation.trim() || null
  };
  const { error } = input.id
    ? await supabase.from("budget_risks").update(row).eq("id", input.id)
    : await supabase.from("budget_risks").insert({ wedding_id: input.weddingId, ...row });
  revalidatePath("/budget");
  return { ok: !error, needsMigration: Boolean(error) };
}

export async function deleteRisk(id: string) {
  await teamSession();
  const supabase = await createClient();
  await supabase.from("budget_risks").delete().eq("id", id);
  revalidatePath("/budget");
  return { ok: true as const };
}
