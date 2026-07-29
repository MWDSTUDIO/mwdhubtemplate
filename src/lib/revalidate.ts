import { revalidatePath } from "next/cache";

/**
 * Invalidate the rooms a mutation actually touched — never the whole
 * house (vitesse brief §7). The root-layout sweep is reserved for the
 * few gestures that truly change every page: switching the current
 * wedding, creating or deleting one.
 *
 * Pass "" for the hub's home. Both route spellings are invalidated
 * (with and without the route group) so the call stays correct
 * whichever key the router holds.
 */
export function revalidateRooms(...rooms: string[]) {
  for (const room of rooms) {
    const suffix = room ? `/${room}` : "";
    revalidatePath(`/[locale]${suffix}`, "page");
    revalidatePath(`/[locale]/(hub)${suffix}`, "page");
  }
}
