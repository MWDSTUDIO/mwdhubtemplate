import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getHouseSession } from "@/lib/session";
import { dispositionFor, mimeFor } from "@/lib/docfiles";

/**
 * A vendor's paper, opened the way the Documents room opens files:
 * access judged HERE on every click — the row is read under the
 * caller's own RLS rights (the couple only ever receives papers
 * marked client-visible), then the single filed original streams
 * with a clean name. No signed URL is minted in advance, so nothing
 * ever expires in a component's hands.
 *
 * ?preview=1 serves PDF and images inline for reading in a tab.
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
    .from("vendor_documents")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!doc || !doc.storage_path) return new NextResponse(null, { status: 404 });
  // An archived paper has left the couple's shelves.
  if (!session.isTeam && doc.archived) return new NextResponse(null, { status: 404 });

  const [bucket, ...rest] = doc.storage_path.split("/");
  const admin = createAdminClient();
  const { data: file, error } = await admin.storage.from(bucket).download(rest.join("/"));
  if (error || !file) return new NextResponse(null, { status: 404 });

  const url = new URL(request.url);
  const mime = mimeFor(doc.storage_path, null);
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
