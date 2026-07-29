import { NextResponse } from "next/server";
import JSZip from "jszip";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getHouseSession } from "@/lib/session";
import { dispositionFor, extensionOf } from "@/lib/docfiles";

/**
 * A whole category in one gesture. The list is read under the
 * caller's RLS rights — a client zips only what the house has placed
 * in their hands.
 */
export async function GET(request: Request) {
  const session = await getHouseSession();
  if (!session || !session.wedding) {
    return NextResponse.json({ error: "signed out" }, { status: 401 });
  }

  const url = new URL(request.url);
  const category = url.searchParams.get("category");

  const supabase = await createClient();
  const { data: docs } = await supabase
    .from("documents")
    .select("*")
    .eq("wedding_id", session.wedding.id)
    .not("storage_path", "is", null);
  // Category filtering happens here, not in SQL: before migration 0012
  // the column does not exist, and every paper reads as Practical.
  const rows = (docs ?? []).filter(
    (d) => !category || (d.category ?? "practical") === category
  );
  if (!rows.length) return new NextResponse(null, { status: 404 });

  const admin = createAdminClient();
  const zip = new JSZip();
  const seen = new Set<string>();
  for (const doc of rows) {
    const [bucket, ...rest] = doc.storage_path!.split("/");
    const { data: file } = await admin.storage.from(bucket).download(rest.join("/"));
    if (!file) continue;
    const ext = extensionOf(doc.storage_path!);
    let name = `${doc.label.replace(/\.[a-z0-9]{1,8}$/i, "").trim() || "Document"}${ext ? `.${ext}` : ""}`;
    for (let i = 2; seen.has(name); i++) name = name.replace(/(\.[a-z0-9]{1,8})?$/i, ` (${i})$1`);
    seen.add(name);
    zip.file(name, await file.arrayBuffer());
  }

  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  const zipLabel = `${session.wedding.couple_display_name} — Documents${category ? ` — ${category}` : ""}.zip`;
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": dispositionFor(zipLabel, "x.zip"),
      "Cache-Control": "private, no-store"
    }
  });
}
