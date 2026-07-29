/**
 * The weekly purge (banking brief §9): a bank coordinate kept without
 * reason is a risk without counterpart. Once a wedding's day is 180
 * days past, its vendors' coordinates — and their history — leave.
 * Runs Sundays at 04:00 UTC; harmless before migration 0016.
 */
export default async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return new Response("not configured", { status: 200 });
  try {
    const r = await fetch(`${url}/rest/v1/rpc/purge_vendor_banking`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ p_days: 180 })
    });
    return new Response(`purge: ${r.status}`, { status: 200 });
  } catch {
    return new Response("purge skipped", { status: 200 });
  }
};

export const config = { schedule: "0 4 * * 0" };
