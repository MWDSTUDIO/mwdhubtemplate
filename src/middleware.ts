import { type NextRequest, NextResponse } from "next/server";
import createIntlMiddleware from "next-intl/middleware";
import { createServerClient } from "@supabase/ssr";
import { routing } from "@/i18n/routing";

const intlMiddleware = createIntlMiddleware(routing);

// Paths that never require a session.
const PUBLIC = /^\/(?:[a-z]{2}\/)?(?:login|auth\/.*)?$/;

export async function middleware(request: NextRequest) {
  // 1. Locale negotiation / rewrite first.
  const response = intlMiddleware(request);

  // 2. Keep the Supabase session fresh on every request.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        }
      }
    }
  );

  const {
    data: { user }
  } = await supabase.auth.getUser();

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
