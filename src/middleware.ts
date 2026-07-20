import { type NextRequest, NextResponse } from "next/server";
import createIntlMiddleware from "next-intl/middleware";
import { createServerClient } from "@supabase/ssr";
import { routing } from "@/i18n/routing";

const intlMiddleware = createIntlMiddleware(routing);

// Paths that never require a session.
const PUBLIC = /^\/(?:[a-z]{2}\/)?(?:login|auth\/.*)?$/;

export async function middleware(request: NextRequest) {
  const isApi = request.nextUrl.pathname.startsWith("/api");

  // 1. Locale negotiation / rewrite — never for API routes, which have
  //    no locale prefix (the intl middleware would rewrite them to 404).
  const response = isApi ? NextResponse.next() : intlMiddleware(request);

  // 2. Keep the Supabase session fresh on every request.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: object }[]) {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        }
      }
    }
  );

  // No auth cookie → no network round-trip: anonymous visitors go
  // straight to their answer (redirect or public page).
  const hasAuthCookie = request.cookies
    .getAll()
    .some((c) => c.name.startsWith("sb-") && c.name.includes("-auth-token"));

  const user = hasAuthCookie
    ? (await supabase.auth.getUser()).data.user
    : null;

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC.test(path) || path.startsWith("/api/public");

  if (!user && !isPublic && !path.startsWith("/api")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    // Everything except static assets and the service worker.
    "/((?!_next|sw\\.js|manifest\\.webmanifest|brand|icons|favicon\\.ico|netlify-forms\\.html|.*\\.(?:png|jpg|jpeg|svg|webp|ico|woff2?)).*)"
  ]
};
