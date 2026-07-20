import { NextResponse } from "next/server";

/** Deployment health: which server-side configuration is present. */
export async function GET() {
  return NextResponse.json({
    ok: true,
    supabaseUrl: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    supabaseAnonKey: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    serviceRole: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
    resend: Boolean(process.env.RESEND_API_KEY),
    google: Boolean(process.env.GOOGLE_CLIENT_ID),
    push: Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY)
  });
}
