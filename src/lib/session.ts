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
  // The token is verified locally (ES256 against the cached signing
  // keys) — no auth round-trip on every page. Forgery has nowhere to
  // go anyway: the same token is what RLS judges at the database.
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims.sub;
  if (!userId) return null;

  // One parallel burst, one round-trip total: profile, memberships and
  // the full wedding rows travel together (RLS trims the list to what
  // the caller may see — a couple only ever receives their own).
  const cookieStore = await cookies();
  const wanted = cookieStore.get(WEDDING_COOKIE)?.value;

  const [{ data: profile }, { data: memberships }, { data: allWeddings }] =
    await Promise.all([
      supabase.from("profiles").select("*").eq("id", userId).single<Profile>(),
      supabase.from("wedding_members").select("wedding_id").eq("profile_id", userId),
      // Newest first: without a stored choice, the team lands on the
      // wedding most recently set in motion, not the oldest file.
      supabase
        .from("weddings")
        .select("*")
        .order("created_at", { ascending: false })
        .returns<Wedding[]>()
    ]);
  if (!profile) return null;

  const isTeam = profile.role === "team";
  const rows = allWeddings ?? [];

  const chosenId = isTeam
    ? (rows.find((w) => w.id === wanted) ?? rows[0])?.id
    : (memberships?.[0]?.wedding_id ?? rows[0]?.id);

  const wedding: Wedding | null = rows.find((w) => w.id === chosenId) ?? null;
  const weddings: Pick<Wedding, "id" | "slug" | "couple_display_name">[] = (
    isTeam ? rows : rows.filter((w) => w.id === chosenId)
  ).map((w) => ({ id: w.id, slug: w.slug, couple_display_name: w.couple_display_name }));

  return {
    userId,
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
