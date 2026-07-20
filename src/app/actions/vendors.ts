"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireHouseSession } from "@/lib/session";
import { runAgent } from "@/lib/agents/run";

async function teamSession() {
  const session = await requireHouseSession();
  if (!session.isTeam) throw new Error("team only");
  return session;
}

export async function addVendor(weddingId: string, name: string, category: string) {
  await teamSession();
  const supabase = await createClient();
  await supabase.from("vendors").insert({ wedding_id: weddingId, name, category });
  revalidatePath("/vendors");
}

export async function setVendorStage(
  vendorId: string,
  stage: "scouted" | "contacted" | "proposal" | "contracted"
) {
  await teamSession();
  const supabase = await createClient();
  await supabase.from("vendors").update({ stage }).eq("id", vendorId);
  revalidatePath("/vendors");
}

/**
 * Vendor outreach: the agent drafts the email from the category
 * template in the house's voice; the send leaves from Estelle's inbox
 * through Netlify Forms.
 */
export async function draftOutreach(input: {
  weddingId: string;
  vendorId: string;
  template: "availability" | "proposal" | "negotiation" | "confirmation";
}) {
  await teamSession();
  const supabase = await createClient();
  const { data: vendor } = await supabase
    .from("vendors")
    .select("name, category")
    .eq("id", input.vendorId)
    .single();
  if (!vendor) return { ok: false as const };

  const text = await runAgent({
    weddingId: input.weddingId,
    agent: "madame",
    maxTokens: 600,
    prompt:
      `Draft the "${input.template}" outreach email to the vendor ${vendor.name} (category: ${vendor.category}), ` +
      `to be sent from Estelle's inbox. Professional, precise, in the house's voice; include the wedding's dates and ` +
      `destination, and what the house asks at this stage. Reply with STRICT JSON only: {"subject": string, "body": string}.`
  });

  try {
    const parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
    return { ok: true as const, subject: parsed.subject as string, body: parsed.body as string };
  } catch {
    return { ok: true as const, subject: `Madame Wedding Design — ${vendor.name}`, body: text };
  }
}

export async function sendOutreach(input: {
  weddingId: string;
  vendorId: string;
  template: string;
  to: string;
  subject: string;
  body: string;
}) {
  const session = await teamSession();
  const site = process.env.NEXT_PUBLIC_SITE_URL;

  // Netlify Forms endpoint — the statically registered vendor-outreach form.
  if (site) {
    await fetch(`${site}/vendor-outreach`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        "form-name": "vendor-outreach",
        wedding: input.weddingId,
        vendor: input.vendorId,
        category: input.template,
        template: input.template,
        to: input.to,
        reply_to: process.env.HOUSE_INBOX ?? "",
        subject: input.subject,
        body: input.body
      })
    }).catch(() => undefined);
  }

  const supabase = await createClient();
  await supabase.from("vendors").update({ stage: "contacted" }).eq("id", input.vendorId)
    .eq("stage", "scouted");
  void session;
  revalidatePath("/vendors");
  return { ok: true };
}
