import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "crypto";

/**
 * Short-lived, signed cookies that remember a verified room code
 * (Teamwork shared code, Vault personal code) for the session.
 * The code itself is verified in Postgres (public.verify_code) against
 * bcrypt hashes no RLS policy exposes; this cookie only carries proof
 * of that verification, bound to the user id.
 */

const TTL_MS = 1000 * 60 * 60 * 4; // a working afternoon

function secret() {
  return (
    process.env.ROOM_COOKIE_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    "inner-house-dev"
  );
}

function sign(payload: string) {
  return createHmac("sha256", secret()).update(payload).digest("hex");
}

export function roomToken(scope: "teamwork" | "vault", userId: string) {
  const exp = Date.now() + TTL_MS;
  const payload = `${scope}.${userId}.${exp}`;
  return `${exp}.${sign(payload)}`;
}

export async function grantRoom(scope: "teamwork" | "vault", userId: string) {
  const cookieStore = await cookies();
  cookieStore.set(`mwd_room_${scope}`, roomToken(scope, userId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: TTL_MS / 1000,
    path: "/"
  });
}

export async function hasRoom(scope: "teamwork" | "vault", userId: string) {
  const cookieStore = await cookies();
  const raw = cookieStore.get(`mwd_room_${scope}`)?.value;
  if (!raw) return false;
  const [expStr, mac] = raw.split(".");
  const exp = Number(expStr);
  if (!exp || exp < Date.now()) return false;
  const expected = sign(`${scope}.${userId}.${exp}`);
  try {
    return timingSafeEqual(Buffer.from(mac), Buffer.from(expected));
  } catch {
    return false;
  }
}
