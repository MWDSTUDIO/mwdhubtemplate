import { revalidatePath } from "next/cache";
import { routing } from "@/i18n/routing";

/**
 * Invalidate the rooms a mutation actually touched — never the whole
 * house (vitesse brief §7). The root-layout sweep stays reserved for
 * the few gestures that truly change every page: switching the
 * current wedding, creating or deleting one.
 *
 * Pass "" for the hub's home. Every spelling the router may hold is
 * invalidated: the literal URL for each locale (with and without the
 * default-locale prefix) and the route patterns — so the action's
 * response carries fresh data whichever key is cached.
 */
export function revalidateRooms(...rooms: string[]) {
  for (const room of rooms) {
    const suffix = room ? `/${room}` : "";
    revalidatePath(suffix || "/");
    for (const locale of routing.locales) {
      revalidatePath(`/${locale}${suffix}` || `/${locale}`);
    }
    revalidatePath(`/[locale]${suffix}`, "page");
    revalidatePath(`/[locale]/(hub)${suffix}`, "page");
  }
}
