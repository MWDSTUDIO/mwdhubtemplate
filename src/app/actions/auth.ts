"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "@/i18n/navigation";
import { getLocale } from "next-intl/server";

export async function signIn(_prev: { error?: string } | null, formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return { error: "credentials" };
  }
  const locale = await getLocale();
  redirect({ href: "/", locale });
  return null;
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  const locale = await getLocale();
  redirect({ href: "/login", locale });
}

export async function setActiveWedding(weddingId: string) {
  const cookieStore = await cookies();
  cookieStore.set("mwd_wedding", weddingId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/"
  });
  revalidatePath("/", "layout");
}
