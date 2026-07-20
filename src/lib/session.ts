import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Profile, Wedding } from "@/lib/types";

export interface HouseSession {
  userId: string;
  profile: Profile;
  wedding: Wedding | null;
  isTeam: boolean;
  isTeamwork: boolean;
  isPrincipal: boolean;
  isCoordinator: boolean;
  /** Weddings the team can switch between (single entry for members). */
  weddings: Pick<Wedding, "id" | "slug" | "couple_display_name">[];
}

const WEDDING_COOKIE = "mwd_wedding";

/**
 * Resolves the signed-in profile and the active wedding.
 * Clients and coordinators get their own wedding; the team can switch
 * between all weddings (selection kept in a cookie).
 */
export const getHouseSession = cache(async (): Promise<HouseSession | null> => {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return null;

  // One parallel burst instead of a chain of round-trips: profile,
  // memberships and the wedding list travel together (RLS trims the
  // list to what the caller may see).
  const cookieStore = await cookies();
  const wanted = cookieStore.get(WEDDING_COOKIE)?.value;

  const [{ data: profile }, { data: memberships }, { data: allWeddings }] =
    await Promise.all([
      supabase.from("profiles").select("*").eq("id", user.id).single<Profile>(),
      supabase.from("wedding_members").select("wedding_id").eq("profile_id", user.id),
      supabase
        .from("weddings")
        .select("id, slug, couple_display_name")
        .order("created_at", { ascending: true })
    ]);
  if (!profile) return null;

  const isTeam = profile.role === "team";

  let weddings: Pick<Wedding, "id" | "slug" | "couple_display_name">[] = allWeddings ?? [];
  let wedding: Wedding | null = null;

  const chosenId = isTeam
    ? (weddings.find((w) => w.id === wanted) ?? weddings[0])?.id
    : memberships?.[0]?.wedding_id;

  if (chosenId) {
    const { data: full } = await supabase
      .from("weddings")
      .select("*")
      .eq("id", chosenId)
      .single<Wedding>();
    wedding = full;
    if (!isTeam && full) {
      weddings = [{ id: full.id, slug: full.slug, couple_display_name: full.couple_display_name }];
    }
  }

  return {
    userId: user.id,
    profile,
    wedding,
    isTeam,
    isTeamwork: isTeam && profile.is_teamwork,
    isPrincipal: isTeam && profile.is_principal,
    isCoordinator: profile.role === "coordinator",
    weddings
  };
});

/** Like getHouseSession but redirects to /login when signed out. */
export async function requireHouseSession(): Promise<HouseSession> {
  const session = await getHouseSession();
  if (!session) redirect("/login");
  return session;
}
