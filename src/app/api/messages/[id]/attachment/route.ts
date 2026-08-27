import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getHouseSession } from "@/lib/session";
import { mimeFor } from "@/lib/docfiles";

/**
 * The photo of a message, judged on every click like every filed
 * paper of the house: the message row is read under the caller's own
 * RLS (the couple only ever reaches the client channel of their own
 * wedding), a withdrawn message keeps its photo to itself, and the
 * single original streams inline.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getHouseSession();
  if (!session) return NextResponse.json({ error: "signed out" }, { status: 401 });

  const { id } = await params;
  const supabase = await createClient();
  const { data: message } = await supabase
    .from("messages")
    .select("attachment_path, withdrawn_at")
    .eq("id", id)
    .maybeSingle();
  if (!message?.attachment_path || message.withdrawn_at) {
    return new NextResponse(null, { status: 404 });
  }

  const [bucket, ...rest] = message.attachment_path.split("/");
  const admin = createAdminClient();
  const { data: file, error } = await admin.storage.from(bucket).download(rest.join("/"));
  if (error || !file) return new NextResponse(null, { status: 404 });

  return new NextResponse(file.stream(), {
    headers: {
      "Content-Type": mimeFor(message.attachment_path, null),
      "Content-Disposition": "inline",
      "Cache-Control": "private, no-store"
    }
  });
}
