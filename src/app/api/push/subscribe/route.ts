import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { gate } from "../../agents/_shared";

/** Save (or refresh) the caller's web-push subscription. */
export async function POST(request: Request) {
  const g = await gate(false);
  if ("error" in g) return g.error;
  const subscription = await request.json();
  if (!subscription?.endpoint || !subscription?.keys) {
    return NextResponse.json({ error: "bad subscription" }, { status: 400 });
  }
  const supabase = await createClient();
  await supabase.from("push_subscriptions").upsert(
    {
      profile_id: g.session.userId,
      endpoint: subscription.endpoint,
      keys: subscription.keys
    },
    { onConflict: "endpoint" }
  );
  return NextResponse.json({ ok: true });
}
