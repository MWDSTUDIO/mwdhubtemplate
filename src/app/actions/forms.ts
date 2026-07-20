"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireHouseSession } from "@/lib/session";
import { notifyCouple, notifyTeam } from "@/lib/notify";
import { runAgent } from "@/lib/agents/run";

/**
 * A client submits a form: the team is notified, and the agent
 * pre-writes a reply in the house's voice — a draft Estelle approves
 * or refines before it is sent.
 */
export async function submitForm(formId: string, weddingId: string, data: Record<string, string>) {
  const session = await requireHouseSession();
  const supabase = await createClient();

  const { data: submission, error } = await supabase
    .from("form_submissions")
    .insert({
      form_id: formId,
      wedding_id: weddingId,
      submitted_by: session.userId,
      data
    })
    .select("id")
    .single();
  if (error || !submission) return { ok: false };

  await supabase.from("forms").update({ status: "completed" }).eq("id", formId);

  const { data: form } = await supabase.from("forms").select("title").eq("id", formId).single();

  await notifyTeam(weddingId, {
    kind: "form_submitted",
    title: `Form completed — ${form?.title ?? ""}`,
    body: "A reply has been pre-written for your approval.",
    url: "/forms"
  });

  // Pre-write the reply (stored as draft; nothing reaches the client yet).
  try {
    const reply = await runAgent({
      weddingId,
      agent: "forms",
      maxTokens: 400,
      prompt: `The clients completed the form "${form?.title}". Their answers: ${JSON.stringify(data)}. Pre-write Estelle's reply in the house's voice — warm, precise, 40–80 words, addressing the couple by first names, noting what the house will do with the answers. Return only the reply.`
    });
    await supabase
      .from("form_submissions")
      .update({ agent_reply: reply })
      .eq("id", submission.id);
  } catch {
    // The submission stands; the reply can be written by hand.
  }

  revalidatePath("/forms");
  return { ok: true };
}

export async function saveReply(submissionId: string, reply: string) {
  const session = await requireHouseSession();
  if (!session.isTeam) throw new Error("team only");
  const supabase = await createClient();
  await supabase
    .from("form_submissions")
    .update({ agent_reply: reply })
    .eq("id", submissionId);
  revalidatePath("/forms");
}

/** Estelle approves — only then does the reply reach the client. */
export async function approveReply(submissionId: string) {
  const session = await requireHouseSession();
  if (!session.isTeam) throw new Error("team only");
  const supabase = await createClient();
  const { data: submission } = await supabase
    .from("form_submissions")
    .update({ reply_status: "sent" })
    .eq("id", submissionId)
    .select("wedding_id, agent_reply")
    .single();
  if (submission?.agent_reply) {
    await notifyCouple(submission.wedding_id, {
      kind: "form_reply",
      title: "A word from the house",
      body: submission.agent_reply,
      url: "/forms"
    });
  }
  revalidatePath("/forms");
}
