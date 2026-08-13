import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getHouseSession } from "@/lib/session";
import { storageKeyFor } from "@/lib/docfiles";

const MAX_BYTES = 25 * 1024 * 1024;

/**
 * A paper filed on the vendor — through a route handler, the same
 * door the Documents room uses: a server action would cap the body
 * at 1 MB and reject any real proposal before our code ever ran
 * (the exact root cause of the repeated-upload failures). One
 * canonical record, one physical file, NO analysis — the Budget's
 * reading room keeps that duty. Each stage names itself on failure
 * so the server log says where an upload died.
 */
export async function POST(request: Request) {
  const session = await getHouseSession();
  if (!session?.isTeam || !session.wedding) {
    return NextResponse.json({ error: "team only" }, { status: 401 });
  }
  const weddingId = session.wedding.id;

  const form = await request.formData();
  const file = form.get("file") as File | null;
  const vendorId = String(form.get("vendorId") ?? "");
  if (!file || !file.size || !vendorId) {
    return NextResponse.json({ error: "missing", stage: "input" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "too large", stage: "input" }, { status: 413 });
  }

  const supabase = await createClient();
  const key = `${weddingId}/vendors/${vendorId}/${Date.now()}-${storageKeyFor(file.name)}`;
  const { error: upErr } = await supabase.storage
    .from("internal")
    .upload(key, Buffer.from(await file.arrayBuffer()), {
      contentType: file.type || "application/pdf",
      upsert: false
    });
  if (upErr) {
    console.error("[vendor-upload] storage failed:", vendorId, file.name, upErr.message);
    return NextResponse.json({ error: "storage", stage: "storage" }, { status: 500 });
  }

  const { data: doc, error } = await supabase
    .from("vendor_documents")
    .insert({
      wedding_id: weddingId,
      vendor_id: vendorId,
      type: "other",
      label: file.name.replace(/\.[a-z0-9]{1,8}$/i, "").trim() || file.name,
      storage_path: `internal/${key}`,
      // Showing a paper to the couple stays Estelle's explicit gesture (0033).
      client_visible: false
    })
    .select("*")
    .single();
  if (error || !doc) {
    console.error("[vendor-upload] record failed:", vendorId, file.name, error?.message);
    await supabase.storage.from("internal").remove([key]).catch(() => undefined);
    return NextResponse.json({ error: "record", stage: "record" }, { status: 500 });
  }

  // The persisted row rides back so the desk can show it at once —
  // rapid consecutive refreshes dedupe and can serve a render from
  // before the last insert; the response is the source of truth.
  return NextResponse.json({ ok: true, doc });
}
