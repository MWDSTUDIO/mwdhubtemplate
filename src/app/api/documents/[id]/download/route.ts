import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getHouseSession } from "@/lib/session";
import { dispositionFor, mimeFor } from "@/lib/docfiles";

/**
 * One click, one download. Access is judged here on every call: the
 * row is read under the caller's own RLS rights, so a draft or an
 * internal paper simply does not exist for a client — 404, never a
 * 403 that would reveal there is something to hide. The file then
 * streams with a clean, readable name.
 *
 * ?preview=1 serves PDF and images inline for the light viewer —
 * same access judgement, different disposition.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getHouseSession();
  if (!session) return NextResponse.json({ error: "signed out" }, { status: 401 });

  const { id } = await params;
  const supabase = await createClient();
  // RLS decides what this caller may see; anything else is not found.
  const { data: doc } = await supabase
    .from("documents")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!doc) return new NextResponse(null, { status: 404 });

  // A linked paper without a filed original (team-side Drive links).
  if (!doc.storage_path) {
    if (doc.url && session.isTeam) return NextResponse.redirect(doc.url);
    return new NextResponse(null, { status: 404 });
  }

  const [bucket, ...rest] = doc.storage_path.split("/");
  const key = rest.join("/");
  const admin = createAdminClient();
  const { data: file, error } = await admin.storage.from(bucket).download(key);
  if (error || !file) return new NextResponse(null, { status: 404 });

  const url = new URL(request.url);
  const mime = mimeFor(doc.storage_path, doc.mime);
  const preview =
    url.searchParams.get("preview") === "1" &&
    (mime === "application/pdf" || mime.startsWith("image/"));

  return new NextResponse(file.stream(), {
    headers: {
      "Content-Type": mime,
      "Content-Disposition": dispositionFor(doc.label, doc.storage_path, preview),
      "Cache-Control": "private, no-store"
    }
  });
}
