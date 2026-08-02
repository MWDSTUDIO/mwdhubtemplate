import { permanentRedirect } from "next/navigation";

/**
 * Guests has folded into Wedding Communication (brief, lot A §1):
 * one page, one entry in the rail. The old address forwards for good.
 */
export default async function GuestsRedirect({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  permanentRedirect(`/${locale}/communication`);
}
