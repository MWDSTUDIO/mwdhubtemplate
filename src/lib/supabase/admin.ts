import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role client. Server only — bypasses RLS.
 * Used exclusively for privileged flows: vault code verification,
 * notification fan-out, agent writes that are then re-checked by RLS reads.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Supabase service-role credentials are not configured");
  }
  return createSupabaseClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}
