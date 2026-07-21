"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireHouseSession } from "@/lib/session";
import { encryptBanking, decryptBanking, type BankingDetails } from "@/lib/banking";

async function teamSession() {
  const session = await requireHouseSession();
  if (!session.isTeam) throw new Error("team only");
  return session;
}

/**
 * A vendor's banking details — written once, encrypted at rest,
 * shown to a client only through the explicit reveal on an instalment.
 * The house never re-shares an IBAN by hand again.
 */
export async function saveVendorBanking(
  vendorId: string,
  weddingId: string,
  details: BankingDetails
) {
  await teamSession();
  const supabase = await createClient();
  const { error } = await supabase.from("vendor_banking").upsert(
    {
      vendor_id: vendorId,
      wedding_id: weddingId,
      enc: encryptBanking(details),
      updated_at: new Date().toISOString()
    },
    { onConflict: "vendor_id" }
  );
  revalidatePath("/budget");
  return { ok: !error, needsMigration: Boolean(error) };
}

/** Team reads back the clear details (their own eyes only). */
export async function readVendorBanking(vendorId: string) {
  await teamSession();
  const supabase = await createClient();
  const { data } = await supabase
    .from("vendor_banking")
    .select("enc")
    .eq("vendor_id", vendorId)
    .maybeSingle();
  if (!data) return { ok: true as const, details: null };
  return { ok: true as const, details: decryptBanking(data.enc) };
}
