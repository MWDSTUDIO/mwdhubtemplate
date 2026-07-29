"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireHouseSession } from "@/lib/session";
import { notifyCouple } from "@/lib/notify";
import { logActivity } from "@/lib/activity";
import { storageKeyFor } from "@/lib/docfiles";

async function teamSession() {
  const session = await requireHouseSession();
  if (!session.isTeam) throw new Error("team only");
  return session;
}

const TYPE_CATEGORY: Record<string, string> = {
  contract: "contracts",
  proposal: "proposals",
  invoice: "invoices"
};

/**
 * "Place in the couple's hands" — a paper read by Madame (filed in the
 * internal room) is copied into the shared room, appears on the
 * couple's Documents page, and the couple is told. Estelle's gesture,
 * never automatic (brief B7).
 */
export async function publishVendorDocToCouple(vendorDocId: string, notify: boolean) {
  const session = await teamSession();
  const admin = createAdminClient();
  const { data: doc } = await admin
    .from("vendor_documents")
    .select("*, vendors(name)")
    .eq("id", vendorDocId)
    .maybeSingle();
  if (!doc?.storage_path) return { ok: false as const };

  const [bucket, ...rest] = doc.storage_path.split("/");
  const { data: file } = await admin.storage.from(bucket).download(rest.join("/"));
  if (!file) return { ok: false as const };

  const vendorName = (doc.vendors as { name?: string } | null)?.name;
  const label = vendorName ? `${vendorName} — ${doc.label}` : doc.label;
  const key = `${doc.wedding_id}/${storageKeyFor(label + "." + (doc.storage_path.split(".").pop() ?? "pdf"))}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const { error: upErr } = await admin.storage.from("shared").upload(key, buffer, {
    contentType: file.type || "application/octet-stream"
  });
  if (upErr && !`${upErr.message}`.includes("exists")) return { ok: false as const };

  const row = {
    wedding_id: doc.wedding_id,
    label,
    internal: false,
    storage_path: `shared/${key}`
  };
  let { error } = await admin.from("documents").insert({
    ...row,
    category: TYPE_CATEGORY[doc.type] ?? "practical",
    source: "house",
    size_bytes: buffer.length,
    mime: file.type || null
  });
  if (error) ({ error } = await admin.from("documents").insert(row));
  if (error) return { ok: false as const };

  await admin.from("vendor_documents").update({ client_visible: true }).eq("id", vendorDocId);
  await logActivity(admin, doc.wedding_id, session.profile.full_name, "publish_document", {
    label
  });
  if (notify) {
    await notifyCouple(doc.wedding_id, {
      kind: "document_published",
      title: "A document placed in your hands",
      body: label,
      url: "/documents"
    });
  }
  revalidatePath("/documents");
  revalidatePath("/vendors");
  return { ok: true as const };
}

/** An internal register paper published to the couple, same gesture. */
export async function publishDocumentToCouple(documentId: string, notify: boolean) {
  const session = await teamSession();
  const admin = createAdminClient();
  const { data: doc } = await admin.from("documents").select("*").eq("id", documentId).maybeSingle();
  if (!doc?.storage_path || !doc.internal) return { ok: false as const };

  const [bucket, ...rest] = doc.storage_path.split("/");
  let path = doc.storage_path;
  if (bucket !== "shared") {
    const { data: file } = await admin.storage.from(bucket).download(rest.join("/"));
    if (!file) return { ok: false as const };
    const key = `${doc.wedding_id}/${storageKeyFor(doc.label)}`;
    const { error: upErr } = await admin.storage.from("shared").upload(key, Buffer.from(await file.arrayBuffer()), {
      contentType: file.type || "application/octet-stream"
    });
    if (upErr) return { ok: false as const };
    path = `shared/${key}`;
  }
  const { error } = await admin
    .from("documents")
    .update({ internal: false, storage_path: path })
    .eq("id", documentId);
  if (error) return { ok: false as const };
  await logActivity(admin, doc.wedding_id, session.profile.full_name, "publish_document", {
    label: doc.label
  });
  if (notify) {
    await notifyCouple(doc.wedding_id, {
      kind: "document_published",
      title: "A document placed in your hands",
      body: doc.label,
      url: "/documents"
    });
  }
  revalidatePath("/documents");
  return { ok: true as const };
}

/** A shared paper withdrawn from the couple's page — mistakes can leave. */
export async function withdrawDocument(documentId: string) {
  const session = await teamSession();
  const admin = createAdminClient();
  const { data: doc } = await admin.from("documents").select("*").eq("id", documentId).maybeSingle();
  if (!doc) return { ok: false as const };
  await admin.from("documents").update({ internal: true }).eq("id", documentId);
  await logActivity(admin, doc.wedding_id, session.profile.full_name, "withdraw_document", {
    label: doc.label
  });
  revalidatePath("/documents");
  return { ok: true as const };
}

/** Remove a register entry and its filed original entirely. */
export async function removeDocument(documentId: string) {
  await teamSession();
  const admin = createAdminClient();
  const { data: doc } = await admin.from("documents").select("*").eq("id", documentId).maybeSingle();
  if (!doc) return { ok: true as const };
  if (doc.storage_path) {
    const [bucket, ...rest] = doc.storage_path.split("/");
    await admin.storage.from(bucket).remove([rest.join("/")]);
  }
  await admin.from("documents").delete().eq("id", documentId);
  revalidatePath("/documents");
  return { ok: true as const };
}

/** Reclassify a paper — the register keeps itself tidy. */
export async function setDocumentCategory(documentId: string, category: string) {
  await teamSession();
  const admin = createAdminClient();
  const { error } = await admin.from("documents").update({ category }).eq("id", documentId);
  revalidatePath("/documents");
  return { ok: !error };
}
