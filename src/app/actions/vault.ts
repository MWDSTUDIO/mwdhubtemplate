"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireHouseSession } from "@/lib/session";
import { hasRoom } from "@/lib/rooms";
import { runAgent } from "@/lib/agents/run";

/** Every vault action requires Estelle AND her verified code. */
async function vaultSession() {
  const session = await requireHouseSession();
  if (!session.isPrincipal) throw new Error("Estelle only");
  if (!(await hasRoom("vault", session.userId))) throw new Error("vault locked");
  return session;
}

export async function addVaultContract(input: {
  weddingId: string | null;
  label: string;
  scheduleLabel: string;
  instalments: { label: string; amount: number; due_date: string; paid: boolean }[];
}) {
  await vaultSession();
  const supabase = await createClient();
  await supabase.from("contracts_vault").insert({
    wedding_id: input.weddingId,
    label: input.label,
    schedule_label: input.scheduleLabel || null,
    instalments: input.instalments
  });
  revalidatePath("/vault");
  return { ok: true };
}

export async function toggleInstalmentPaid(contractId: string, index: number) {
  await vaultSession();
  const supabase = await createClient();
  const { data: contract } = await supabase
    .from("contracts_vault")
    .select("instalments")
    .eq("id", contractId)
    .single();
  if (!contract) return;
  const instalments = [...(contract.instalments ?? [])];
  if (instalments[index]) instalments[index].paid = !instalments[index].paid;
  await supabase.from("contracts_vault").update({ instalments }).eq("id", contractId);
  revalidatePath("/vault");
}

/** The agent writes the payment reminder in Estelle's name. */
export async function draftReminder(
  weddingId: string,
  contractLabel: string,
  instalment: { label: string; amount: number; due_date: string }
) {
  await vaultSession();
  const text = await runAgent({
    weddingId,
    agent: "budget",
    maxTokens: 300,
    prompt: `Write the payment reminder Estelle will send for "${contractLabel}", instalment "${instalment.label}" of €${instalment.amount}, due ${instalment.due_date}. In her name, warm and unambiguous, 50–80 words, signed "— Estelle". Return only the reminder.`
  });
  return { text };
}
