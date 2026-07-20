import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { gate, agentError } from "../_shared";
import { runAgent } from "@/lib/agents/run";

const READABLE = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif"
]);

/**
 * Drop a document on Madame: she identifies its type (contract,
 * proposal, invoice, guest list…), extracts amounts, schedules and
 * terms, stores the file, and implements the data where it belongs —
 * always as drafts awaiting Estelle's word.
 */
export async function POST(request: Request) {
  const g = await gate(true);
  if ("error" in g) return g.error;
  try {
    const form = await request.formData();
    const weddingId = String(form.get("weddingId"));
    const vendorId = form.get("vendorId") ? String(form.get("vendorId")) : null;
    const file = form.get("file") as File | null;
    if (!file || !weddingId) {
      return NextResponse.json({ error: "missing file" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const mediaType = READABLE.has(file.type) ? file.type : null;

    const supabase = await createClient();
    const { data: vendors } = await supabase
      .from("vendors")
      .select("id, name, category")
      .eq("wedding_id", weddingId);

    const raw = await runAgent({
      weddingId,
      agent: "budget",
      maxTokens: 1200,
      documents: mediaType ? [{ mediaType, base64: buffer.toString("base64") }] : undefined,
      prompt:
        `${mediaType ? "Read the attached document." : `A file named "${file.name}" was dropped (its format cannot be read inline).`}\n` +
        `Known vendors: ${JSON.stringify(vendors)}.\n` +
        `Reply with STRICT JSON only: {"doc_type": "proposal"|"contract"|"invoice"|"guest_list"|"other", ` +
        `"vendor_id": string|null (an existing vendor id if the document belongs to one), ` +
        `"vendor_name": string|null, "label": string (short display label), ` +
        `"total_amount": number|null, "currency": string|null, ` +
        `"schedule": [{"label": string, "amount": number, "due_date": "yyyy-mm-dd"|null}], ` +
        `"terms": string|null (one line), ` +
        `"summary": string (2–3 sentences to Estelle, in the house's voice, describing what you read and what you have prepared as drafts)}`
    });

    const parsed = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ""));

    // Store the original in the internal bucket.
    const path = `${weddingId}/${Date.now()}-${file.name}`;
    await supabase.storage.from("internal").upload(path, buffer, {
      contentType: file.type || "application/octet-stream"
    });

    const matchedVendor = vendorId ?? parsed.vendor_id ?? null;

    if (["proposal", "contract", "invoice"].includes(parsed.doc_type) && matchedVendor) {
      await supabase.from("vendor_documents").insert({
        vendor_id: matchedVendor,
        wedding_id: weddingId,
        type: parsed.doc_type,
        label: parsed.label ?? file.name,
        storage_path: `internal/${path}`,
        extraction: parsed,
        client_visible: false
      });

      // A contract or invoice feeds the payment schedule — as data the
      // team reviews, never straight to the client.
      for (const instalment of parsed.schedule ?? []) {
        await supabase.from("payments").insert({
          wedding_id: weddingId,
          label: `${parsed.label ?? file.name} — ${instalment.label}`,
          amount: instalment.amount,
          due_date: instalment.due_date
        });
      }
      if (parsed.doc_type === "contract" && parsed.total_amount) {
        await supabase
          .from("budget_lines")
          .update({ committed: parsed.total_amount, status: "draft" })
          .eq("wedding_id", weddingId)
          .eq("vendor_id", matchedVendor);
      }
    } else {
      await supabase.from("documents").insert({
        wedding_id: weddingId,
        label: parsed.label ?? file.name,
        internal: true
      });
    }

    return NextResponse.json({ text: parsed.summary ?? "Read and filed.", extraction: parsed });
  } catch (e) {
    return agentError(e);
  }
}
