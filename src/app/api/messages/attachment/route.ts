import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getHouseSession } from "@/lib/session";
import { storageKeyFor } from "@/lib/docfiles";

const MAX_BYTES = 12 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic"]);

/**
 * A photo slipped into the conversation (0035) — through a route
 * handler, the Documents room's transmit door: uploaded here, the
 * path returns and the message carries it. The couple has no write
 * right on the shared bucket, so the house's own hand files it after
 * judging the caller belongs to the wedding.
 */
export async function POST(request: Request) {
  const session = await getHouseSession();
  if (!session?.wedding) return NextResponse.json({ error: "signed out" }, { status: 401 });

  const form = await request.formData();
  const file = form.get("file") as File | null;
  if (!file || !file.size) return NextResponse.json({ error: "missing" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "too large" }, { status: 413 });
  if (!IMAGE_TYPES.has(file.type)) return NextResponse.json({ error: "not an image" }, { status: 415 });

  const key = `${session.wedding.id}/messages/${Date.now()}-${storageKeyFor(file.name)}`;
  const admin = createAdminClient();
  const { error } = await admin.storage.from("shared").upload(key, Buffer.from(await file.arrayBuffer()), {
    contentType: file.type
  });
  if (error) {
    console.error("[message-attachment] storage failed:", error.message);
    return NextResponse.json({ error: "storage" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, path: `shared/${key}` });
}
