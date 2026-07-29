import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The house's journal — one quiet line per publication gesture.
 * Absent until migration 0015; the gesture itself never depends on
 * its trace, so every write is fire-and-forget.
 */
export async function logActivity(
  supabase: SupabaseClient,
  weddingId: string,
  actor: string,
  action: string,
  detail: Record<string, unknown> = {}
): Promise<string | null> {
  try {
    const { data } = await supabase
      .from("activity_log")
      .insert({ wedding_id: weddingId, actor, action, detail })
      .select("id")
      .single();
    return data?.id ?? null;
  } catch {
    return null;
  }
}
