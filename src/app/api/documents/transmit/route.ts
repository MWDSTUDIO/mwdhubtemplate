import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getHouseSession } from "@/lib/session";
import { notifyTeam } from "@/lib/notify";
import { storageKeyFor } from "@/lib/docfiles";

const MAX_BYTES = 25 * 1024 * 1024;

/**
 * The couple places a document in the house's hands. It lands in the
 * shared room — visible to them and to the team, who is told at once.
 * No agent reads it; a person does. Authorization is judged here:
 * the caller must belong to the wedding they are handing the paper to.
 */
export async function POST(request: Request) {
  const session = await getHouseSession();
  if (!session || !session.wedding) {
    return NextResponse.json({ error: "signed out" }, { status: 401 });
  }
  const weddingId = session.wedding.id;

  const form = await request.formData();
  const file = form.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "missing file" }, { status: 400 });
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "too large" }, { status: 413 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const key = `${weddingId}/${storageKeyFor(file.name)}`;
  const admin = createAdminClient();
  const { error: upErr } = await admin.storage.from("shared").upload(key, buffer, {
    contentType: file.type || "application/octet-stream"
  });
  if (upErr) return NextResponse.json({ error: "storage" }, { status: 500 });

  const row = {
    wedding_id: weddingId,
    label: file.name,
    internal: false,
    storage_path: `shared/${key}`
  };
  let { error } = await admin.from("documents").insert({
    ...row,
    category: "from_couple",
    source: session.isTeam ? "house" : "client",
    size_bytes: file.size,
    mime: file.type || null
  });
  // Before migration 0012 the new columns are absent — the paper still lands.
  if (error) ({ error } = await admin.from("documents").insert(row));
  if (error) return NextResponse.json({ error: "register" }, { status: 500 });

  if (!session.isTeam) {
    await notifyTeam(weddingId, {
      kind: "document_transmitted",
      title: "A document placed in the house's hands",
      body: `${session.profile.full_name} — ${file.name}`,
      url: "/documents"
    });
  }

  return NextResponse.json({ ok: true });
}
