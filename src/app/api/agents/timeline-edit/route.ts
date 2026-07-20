import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { gate, agentError } from "../_shared";
import { runAgent } from "@/lib/agents/run";

interface Operation {
  op: "edit" | "move" | "add" | "remove" | "mark_done" | "mark_open";
  id?: string;
  month?: string; // yyyy-mm
  label?: string;
}

/**
 * Madame corrects the frise from a plain instruction
 * ("move venues to August, mark the global design done").
 * Every change lands as a draft; the client's frise never moves
 * before Estelle publishes.
 */
export async function POST(request: Request) {
  const g = await gate(true);
  if ("error" in g) return g.error;
  try {
    const { weddingId, instruction } = await request.json();
    const supabase = await createClient();
    const { data: milestones } = await supabase
      .from("timeline_milestones")
      .select("id, month, label, done, status")
      .eq("wedding_id", weddingId)
      .order("month");

    const raw = await runAgent({
      weddingId,
      agent: "timeline",
      maxTokens: 800,
      prompt:
        `Estelle instructs: "${instruction}".\n` +
        `Current milestones: ${JSON.stringify(milestones)}.\n` +
        `Reply with STRICT JSON only: {"operations": [{"op": "edit"|"move"|"add"|"remove"|"mark_done"|"mark_open", ` +
        `"id": string (existing milestone id; omit for add), "month": "yyyy-mm" (for move/add/edit when changed), ` +
        `"label": string (for add/edit)}], "note": string (one short sentence to Estelle describing what you did)}`
    });

    const parsed = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, "")) as {
      operations: Operation[];
      note: string;
    };

    for (const op of parsed.operations ?? []) {
      if (op.op === "add" && op.label && op.month) {
        await supabase.from("timeline_milestones").insert({
          wedding_id: weddingId,
          month: `${op.month}-01`,
          label: op.label,
          status: "draft"
        });
      } else if (op.id) {
        if (op.op === "remove") {
          await supabase.from("timeline_milestones").delete().eq("id", op.id);
        } else {
          const patch: Record<string, unknown> = { status: "draft" };
          if (op.op === "mark_done") patch.done = true;
          if (op.op === "mark_open") patch.done = false;
          if (op.month) patch.month = `${op.month}-01`;
          if (op.label) patch.label = op.label;
          await supabase.from("timeline_milestones").update(patch).eq("id", op.id);
        }
      }
    }

    return NextResponse.json({
      text: parsed.note ?? "Done — in draft, awaiting your word.",
      applied: parsed.operations?.length ?? 0
    });
  } catch (e) {
    return agentError(e);
  }
}
