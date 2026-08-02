"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireHouseSession } from "@/lib/session";
import { notifyCouple, notifyTeam } from "@/lib/notify";
import { runAgent } from "@/lib/agents/run";
import { logActivity } from "@/lib/activity";
import { canPublish, canDeleteDraft, validateImportRow, type ImportRow } from "@/lib/forms";
import type { FormRow } from "@/lib/types";

async function teamSession() {
  const session = await requireHouseSession();
  if (!session.isTeam) throw new Error("team only");
  return session;
}

/** §28 — one quiet line per gesture; the gesture never depends on it. */
async function history(
  supabase: Awaited<ReturnType<typeof createClient>>,
  weddingId: string,
  formId: string,
  actor: string,
  action: string,
  oldValue: unknown = null,
  newValue: unknown = null
) {
  try {
    await supabase.from("form_history").insert({
      form_id: formId,
      wedding_id: weddingId,
      actor,
      action,
      old_value: oldValue,
      new_value: newValue
    });
  } catch {
    /* silent before 0031 */
  }
}

/**
 * A client submits a form: the team is notified, and the agent
 * pre-writes a reply in the house's voice — a draft Estelle approves
 * or refines before it is sent.
 */
export async function submitForm(formId: string, weddingId: string, data: Record<string, string>) {
  const session = await requireHouseSession();
  const supabase = await createClient();

  const { data: submission, error } = await supabase
    .from("form_submissions")
    .insert({
      form_id: formId,
      wedding_id: weddingId,
      submitted_by: session.userId,
      data
    })
    .select("id")
    .single();
  if (error || !submission) return { ok: false };

  await supabase.from("forms").update({ status: "completed" }).eq("id", formId);

  const { data: form } = await supabase.from("forms").select("title").eq("id", formId).single();

  await notifyTeam(weddingId, {
    kind: "form_submitted",
    title: `Form completed — ${form?.title ?? ""}`,
    body: "A reply has been pre-written for your approval.",
    url: "/forms"
  });

  // Pre-write the reply (stored as draft; nothing reaches the client yet).
  try {
    const reply = await runAgent({
      weddingId,
      agent: "forms",
      maxTokens: 400,
      prompt: `The clients completed the form "${form?.title}". Their answers: ${JSON.stringify(data)}. Pre-write Estelle's reply in the house's voice — warm, precise, 40–80 words, addressing the couple by first names, noting what the house will do with the answers. Return only the reply.`
    });
    await supabase
      .from("form_submissions")
      .update({ agent_reply: reply })
      .eq("id", submission.id);
  } catch {
    // The submission stands; the reply can be written by hand.
  }

  revalidatePath("/forms");
  return { ok: true };
}

export async function saveReply(submissionId: string, reply: string) {
  const session = await requireHouseSession();
  if (!session.isTeam) throw new Error("team only");
  const supabase = await createClient();
  await supabase
    .from("form_submissions")
    .update({ agent_reply: reply })
    .eq("id", submissionId);
  revalidatePath("/forms");
}

/* ════════════════════════════════════════════════════════════════
   The card library (PRD Forms, migration 0031). Everything below is
   Team View; the couple only ever reads what RLS lets through.
   ════════════════════════════════════════════════════════════════ */

const CARD_FIELDS = [
  "title", "internal_title", "category_id", "description", "provider",
  "external_url", "cta_label", "client_visible", "due_date",
  "note_internal", "note_client", "cover_focal"
] as const;

export interface FormCardInput {
  weddingId: string;
  id?: string;
  title: string;
  internal_title?: string | null;
  category_id?: string | null;
  description?: string | null;
  provider?: string | null;
  external_url?: string | null;
  cta_label?: string | null;
  client_visible?: boolean;
  due_date?: string | null;
  note_internal?: string | null;
  note_client?: string | null;
  cover_focal?: string | null;
  status?: string;
}

/** Create or refine a card. Publishing demands a working door (§10). */
export async function saveFormCard(input: FormCardInput) {
  const session = await teamSession();
  const supabase = await createClient();
  const title = input.title?.trim();
  if (!title) return { ok: false as const, reason: "title" as const };

  const status = input.status ?? "draft";
  const wantsClientEyes = status !== "draft" && status !== "ready";
  if (wantsClientEyes && !canPublish({ id: "", title, status, external_url: input.external_url }).ok) {
    // In-app legacy forms carry their own schema — checked on update below.
    if (!input.id) return { ok: false as const, reason: "url" as const };
    const { data: existing } = await supabase.from("forms").select("schema").eq("id", input.id).maybeSingle();
    const hasSchema = Array.isArray(existing?.schema) && existing.schema.length > 0;
    if (!hasSchema) return { ok: false as const, reason: "url" as const };
  }

  const fields: Record<string, unknown> = { title, status };
  for (const k of CARD_FIELDS) {
    if (k === "title") continue;
    if (input[k] !== undefined) fields[k] = input[k] === "" ? null : input[k];
  }
  fields.updated_at = new Date().toISOString();

  if (input.id) {
    const { data: before } = await supabase.from("forms").select("*").eq("id", input.id).maybeSingle();
    let { error } = await supabase.from("forms").update(fields).eq("id", input.id);
    if (error) {
      // Pre-0031 the card columns are absent — title and status land.
      ({ error } = await supabase.from("forms").update({ title }).eq("id", input.id));
    }
    if (error) return { ok: false as const, reason: "save" as const };
    if (before) {
      const changed: Record<string, { from: unknown; to: unknown }> = {};
      for (const [k, v] of Object.entries(fields)) {
        if (k !== "updated_at" && (before as Record<string, unknown>)[k] !== v) {
          changed[k] = { from: (before as Record<string, unknown>)[k] ?? null, to: v };
        }
      }
      if (Object.keys(changed).length) {
        await history(supabase, input.weddingId, input.id, session.profile.full_name, "card_updated", null, changed);
      }
    }
    revalidatePath("/forms");
    return { ok: true as const, id: input.id };
  }

  const { count } = await supabase
    .from("forms")
    .select("id", { count: "exact", head: true })
    .eq("wedding_id", input.weddingId);
  const full = {
    wedding_id: input.weddingId,
    ...fields,
    schema: [],
    sort: (count ?? 0) + 1,
    created_by: session.profile.full_name,
    shared_at: wantsClientEyes ? new Date().toISOString().slice(0, 10) : null
  };
  let { data, error } = await supabase.from("forms").insert(full).select("id").single();
  if (error) {
    // Pre-0031: the movement lands with what the old table knows.
    ({ data, error } = await supabase
      .from("forms")
      .insert({ wedding_id: input.weddingId, title, status: "awaiting", schema: [], sort: (count ?? 0) + 1 })
      .select("id")
      .single());
  }
  if (error || !data) return { ok: false as const, reason: "save" as const };
  await history(supabase, input.weddingId, data.id, session.profile.full_name, "card_created", null, { title, status });
  await logActivity(supabase, input.weddingId, session.profile.full_name, "form_card_created", { title });
  revalidatePath("/forms");
  return { ok: true as const, id: data.id };
}

/** The status under the team's hand (§8) — dates follow the word. */
export async function setFormStatus(formId: string, status: string) {
  const session = await teamSession();
  const supabase = await createClient();
  const { data: before } = await supabase.from("forms").select("wedding_id, status, shared_at").eq("id", formId).maybeSingle();
  if (!before) return { ok: false as const };
  const today = new Date().toISOString().slice(0, 10);
  const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
  if ((status === "shared" || status === "in_progress") && !before.shared_at) patch.shared_at = today;
  if (status === "submitted" || status === "updated") patch.submitted_at = today;
  const { error } = await supabase.from("forms").update(patch).eq("id", formId);
  if (error) return { ok: false as const };
  await history(supabase, before.wedding_id, formId, session.profile.full_name, "status_changed", before.status, status);
  revalidatePath("/forms");
  return { ok: true as const };
}

export async function setFormClientVisible(formId: string, visible: boolean) {
  const session = await teamSession();
  const supabase = await createClient();
  const { data: before } = await supabase.from("forms").select("wedding_id, client_visible").eq("id", formId).maybeSingle();
  if (!before) return { ok: false as const };
  const { error } = await supabase
    .from("forms")
    .update({ client_visible: visible, updated_at: new Date().toISOString() })
    .eq("id", formId);
  if (error) return { ok: false as const };
  await history(supabase, before.wedding_id, formId, session.profile.full_name, visible ? "shown_to_client" : "hidden_from_client", before.client_visible, visible);
  revalidatePath("/forms");
  return { ok: true as const };
}

export async function setFormArchived(formId: string, archived: boolean) {
  const session = await teamSession();
  const supabase = await createClient();
  const { data: before } = await supabase.from("forms").select("wedding_id").eq("id", formId).maybeSingle();
  if (!before) return { ok: false as const };
  const { error } = await supabase
    .from("forms")
    .update({ archived, archived_at: archived ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
    .eq("id", formId);
  if (error) return { ok: false as const };
  await history(supabase, before.wedding_id, formId, session.profile.full_name, archived ? "archived" : "restored");
  revalidatePath("/forms");
  return { ok: true as const };
}

/** Delete is for cards the couple never saw (§17). Never the external form. */
export async function deleteFormDraft(formId: string) {
  const session = await teamSession();
  const supabase = await createClient();
  const { data: form } = await supabase.from("forms").select("*").eq("id", formId).maybeSingle();
  if (!form) return { ok: false as const };
  if (!canDeleteDraft(form as FormRow)) return { ok: false as const, reason: "not_draft" as const };
  const { error } = await supabase.from("forms").delete().eq("id", formId);
  if (error) return { ok: false as const };
  await logActivity(supabase, form.wedding_id, session.profile.full_name, "form_draft_deleted", { title: form.title });
  revalidatePath("/forms");
  return { ok: true as const };
}

/** §18 — a copy arrives as a draft; the URL question is asked, not assumed. */
export async function duplicateFormCard(formId: string, urlMode: "keep" | "blank") {
  const session = await teamSession();
  const supabase = await createClient();
  const { data: source } = await supabase.from("forms").select("*").eq("id", formId).maybeSingle();
  if (!source) return { ok: false as const };
  const { count } = await supabase
    .from("forms")
    .select("id", { count: "exact", head: true })
    .eq("wedding_id", source.wedding_id);
  const copy: Record<string, unknown> = {
    wedding_id: source.wedding_id,
    title: `${source.title} — copy`,
    status: "draft",
    schema: source.schema ?? [],
    sort: (count ?? 0) + 1
  };
  for (const k of ["internal_title", "category_id", "description", "cover_path", "cover_focal", "provider", "cta_label", "client_visible", "note_internal", "note_client"]) {
    if (source[k] !== undefined) copy[k] = source[k];
  }
  if (urlMode === "keep" && source.external_url) copy.external_url = source.external_url;
  copy.created_by = session.profile.full_name;
  let { data, error } = await supabase.from("forms").insert(copy).select("id").single();
  if (error) {
    ({ data, error } = await supabase
      .from("forms")
      .insert({ wedding_id: source.wedding_id, title: `${source.title} — copy`, status: "to_come", schema: source.schema ?? [], sort: (count ?? 0) + 1 })
      .select("id")
      .single());
  }
  if (error || !data) return { ok: false as const };
  await history(supabase, source.wedding_id, data.id, session.profile.full_name, "card_duplicated", null, { from: source.title });
  revalidatePath("/forms");
  return { ok: true as const, id: data.id };
}

/** §19 — the whole shelf reordered in one gesture (drag or keyboard). */
export async function reorderForms(weddingId: string, orderedIds: string[]) {
  await teamSession();
  const supabase = await createClient();
  await Promise.all(
    orderedIds.map((id, i) =>
      supabase.from("forms").update({ sort: i + 1 }).eq("id", id).eq("wedding_id", weddingId)
    )
  );
  revalidatePath("/forms");
  return { ok: true as const };
}

export async function setFormCategory(formId: string, categoryId: string | null) {
  const session = await teamSession();
  const supabase = await createClient();
  const { data: before } = await supabase.from("forms").select("wedding_id, category_id").eq("id", formId).maybeSingle();
  if (!before) return { ok: false as const };
  const { error } = await supabase
    .from("forms")
    .update({ category_id: categoryId, updated_at: new Date().toISOString() })
    .eq("id", formId);
  if (error) return { ok: false as const };
  await history(supabase, before.wedding_id, formId, session.profile.full_name, "category_changed", before.category_id, categoryId);
  revalidatePath("/forms");
  return { ok: true as const };
}

export async function markFormChecked(formId: string) {
  await teamSession();
  const supabase = await createClient();
  await supabase
    .from("forms")
    .update({ last_checked_at: new Date().toISOString().slice(0, 10) })
    .eq("id", formId);
  revalidatePath("/forms");
  return { ok: true as const };
}

/* ── categories (§6) ─────────────────────────────────────────────── */

export async function saveFormCategory(input: { weddingId: string; id?: string; name: string }) {
  await teamSession();
  const supabase = await createClient();
  const name = input.name.trim();
  if (!name) return { ok: false as const };
  if (input.id) {
    const { error } = await supabase.from("form_categories").update({ name }).eq("id", input.id);
    if (error) return { ok: false as const, needsMigration: true };
  } else {
    const { count } = await supabase
      .from("form_categories")
      .select("id", { count: "exact", head: true })
      .eq("wedding_id", input.weddingId);
    const { error } = await supabase
      .from("form_categories")
      .insert({ wedding_id: input.weddingId, name, sort: (count ?? 0) + 1 });
    if (error) return { ok: false as const, needsMigration: true };
  }
  revalidatePath("/forms");
  return { ok: true as const };
}

export async function setCategoryArchived(categoryId: string, archived: boolean) {
  await teamSession();
  const supabase = await createClient();
  const { error } = await supabase.from("form_categories").update({ archived }).eq("id", categoryId);
  if (error) return { ok: false as const };
  revalidatePath("/forms");
  return { ok: true as const };
}

export async function reorderFormCategories(weddingId: string, orderedIds: string[]) {
  await teamSession();
  const supabase = await createClient();
  await Promise.all(
    orderedIds.map((id, i) =>
      supabase.from("form_categories").update({ sort: i + 1 }).eq("id", id).eq("wedding_id", weddingId)
    )
  );
  revalidatePath("/forms");
  return { ok: true as const };
}

/* ── covers (§11) — the shared bucket, path kept, URL signed ─────── */

export async function uploadFormCover(formId: string, fd: FormData) {
  const session = await teamSession();
  const supabase = await createClient();
  const file = fd.get("file") as File | null;
  if (!file || !file.size) return { ok: false as const };
  if (file.size > 8 * 1024 * 1024) return { ok: false as const, reason: "size" as const };
  const { data: form } = await supabase.from("forms").select("wedding_id, cover_path").eq("id", formId).maybeSingle();
  if (!form) return { ok: false as const };
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const path = `${form.wedding_id}/forms/${formId}-${Date.now()}.${ext}`;
  const { error: upErr } = await supabase.storage
    .from("shared")
    .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type || "image/jpeg", upsert: true });
  if (upErr) return { ok: false as const, reason: "upload" as const };
  const { error } = await supabase
    .from("forms")
    .update({ cover_path: path, updated_at: new Date().toISOString() })
    .eq("id", formId);
  if (error) return { ok: false as const };
  if (form.cover_path && form.cover_path !== path) {
    await supabase.storage.from("shared").remove([form.cover_path]).catch(() => undefined);
  }
  await history(supabase, form.wedding_id, formId, session.profile.full_name, "cover_changed");
  revalidatePath("/forms");
  return { ok: true as const };
}

export async function removeFormCover(formId: string) {
  const session = await teamSession();
  const supabase = await createClient();
  const { data: form } = await supabase.from("forms").select("wedding_id, cover_path").eq("id", formId).maybeSingle();
  if (!form) return { ok: false as const };
  await supabase
    .from("forms")
    .update({ cover_path: null, cover_focal: null, updated_at: new Date().toISOString() })
    .eq("id", formId);
  if (form.cover_path) await supabase.storage.from("shared").remove([form.cover_path]).catch(() => undefined);
  await history(supabase, form.wedding_id, formId, session.profile.full_name, "cover_removed");
  revalidatePath("/forms");
  return { ok: true as const };
}

/* ── import (§25) — parse on the server, judge every line ────────── */

export async function parseFormsImport(fd: FormData): Promise<
  { ok: true; rows: Record<string, string>[]; columns: string[] } | { ok: false }
> {
  await teamSession();
  const file = fd.get("file") as File | null;
  if (!file) return { ok: false };
  try {
    const XLSX = await import("xlsx");
    const wb = XLSX.read(Buffer.from(await file.arrayBuffer()), { type: "buffer" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { raw: false, defval: "" });
    const columns = rows.length ? Object.keys(rows[0]) : [];
    return { ok: true, rows: rows.slice(0, 200), columns };
  } catch {
    return { ok: false };
  }
}

export async function importFormCards(weddingId: string, rows: ImportRow[]) {
  const session = await teamSession();
  const supabase = await createClient();
  const { data: existing } = await supabase.from("forms").select("id, title, external_url").eq("wedding_id", weddingId);
  const { data: cats } = await supabase.from("form_categories").select("id, name").eq("wedding_id", weddingId);
  const catByName = new Map((cats ?? []).map((c) => [c.name.toLowerCase(), c.id]));
  const urls = new Set(
    (existing ?? []).map((f) => f.external_url?.trim().replace(/\/+$/, "").toLowerCase()).filter(Boolean)
  );
  let imported = 0;
  let skipped = 0;
  const { count } = await supabase
    .from("forms")
    .select("id", { count: "exact", head: true })
    .eq("wedding_id", weddingId);
  let sort = (count ?? 0) + 1;
  for (const raw of rows.slice(0, 200)) {
    const judged = validateImportRow(raw);
    if (!judged.ok) { skipped += 1; continue; }
    const row = judged.row;
    const cleanUrl = row.external_url?.trim().replace(/\/+$/, "").toLowerCase();
    if (cleanUrl && urls.has(cleanUrl)) { skipped += 1; continue; }
    // Categories are matched by name; a new name becomes a new shelf.
    let categoryId: string | null = null;
    if (row.category?.trim()) {
      const key = row.category.trim().toLowerCase();
      categoryId = catByName.get(key) ?? null;
      if (!categoryId) {
        const { data: cat } = await supabase
          .from("form_categories")
          .insert({ wedding_id: weddingId, name: row.category.trim(), sort: catByName.size + 1 })
          .select("id")
          .single();
        if (cat) { categoryId = cat.id; catByName.set(key, cat.id); }
      }
    }
    const { error } = await supabase.from("forms").insert({
      wedding_id: weddingId,
      title: row.title,
      status: row.status ?? "draft",
      schema: [],
      sort: sort++,
      description: row.description || null,
      external_url: row.external_url || null,
      provider: row.provider || null,
      client_visible: row.client_visible ?? true,
      due_date: row.due_date || null,
      category_id: categoryId,
      created_by: session.profile.full_name
    });
    if (error) skipped += 1;
    else { imported += 1; if (cleanUrl) urls.add(cleanUrl); }
  }
  await logActivity(supabase, weddingId, session.profile.full_name, "forms_imported", { imported, skipped });
  revalidatePath("/forms");
  return { ok: true as const, imported, skipped };
}

/** The card's history, for the drawer (§28) — team eyes only. */
export async function formHistory(formId: string) {
  await teamSession();
  const supabase = await createClient();
  const { data } = await supabase
    .from("form_history")
    .select("actor, action, old_value, new_value, created_at")
    .eq("form_id", formId)
    .order("created_at", { ascending: false })
    .limit(30);
  return data ?? [];
}

/** Estelle approves — only then does the reply reach the client. */
export async function approveReply(submissionId: string) {
  const session = await requireHouseSession();
  if (!session.isTeam) throw new Error("team only");
  const supabase = await createClient();
  const { data: submission } = await supabase
    .from("form_submissions")
    .update({ reply_status: "sent" })
    .eq("id", submissionId)
    .select("wedding_id, agent_reply")
    .single();
  if (submission?.agent_reply) {
    await notifyCouple(submission.wedding_id, {
      kind: "form_reply",
      title: "A word from the house",
      body: submission.agent_reply,
      url: "/forms"
    });
  }
  revalidatePath("/forms");
}
