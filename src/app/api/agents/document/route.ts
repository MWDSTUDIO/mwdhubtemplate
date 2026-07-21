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
        `Estelle handed this document to the house's budget herself: if it is a vendor proposal, contract or invoice — ` +
        `even a sample drawn from another wedding — classify it as such and extract its vendor, amounts and schedule, ` +
        `so the drafts await her word. Only classify as "other" what is genuinely not vendor paper.\n` +
        `Reply with STRICT JSON only: {"doc_type": "proposal"|"contract"|"invoice"|"guest_list"|"other", ` +
        `"vendor_id": string|null (an existing vendor id if the document belongs to one), ` +
        `"vendor_name": string|null, "vendor_category": string|null (Floral, Catering, Image…), ` +
        `"label": string (short display label), ` +
        `"total_amount": number|null, "currency": string|null, ` +
        `"schedule": [{"label": string, "amount": number, "due_date": "yyyy-mm-dd"|null, "refundable": boolean (deposits/cautions marked refundable)}], ` +
        `"items": [{"event": string|null (the wedding moment this line belongs to, e.g. "Rehearsal dinner — April 30"), ` +
        `"label": string, "qty": number|null, "unit_price": number|null, "total_ht": number|null, "vat_pct": number|null, "total_ttc": number|null}] ` +
        `(EVERY line of the quote, grouped by event — a florist or caterer quote may hold dozens; keep them all), ` +
        `"terms": string|null (one line), ` +
        `"summary": string (2–3 sentences to Estelle, in the house's voice, describing what you read and what you have prepared as drafts)}`
    });

    const parsed = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ""));

    // Store the original in the internal bucket.
    const path = `${weddingId}/${Date.now()}-${file.name}`;
    await supabase.storage.from("internal").upload(path, buffer, {
      contentType: file.type || "application/octet-stream"
    });

    // Resolve the vendor — by explicit choice, by the agent's match,
    // by name, or by creating it on the spot: a dropped contract must
    // land in the budget even for a wedding whose file is brand new.
    let matchedVendor: string | null = vendorId ?? parsed.vendor_id ?? null;
    if (
      !matchedVendor &&
      parsed.vendor_name &&
      ["proposal", "contract", "invoice"].includes(parsed.doc_type)
    ) {
      const wanted = String(parsed.vendor_name).trim().toLowerCase();
      const found = (vendors ?? []).find((v) => v.name.trim().toLowerCase() === wanted);
      if (found) {
        matchedVendor = found.id;
      } else {
        const { data: created } = await supabase
          .from("vendors")
          .insert({
            wedding_id: weddingId,
            name: String(parsed.vendor_name).trim(),
            category: parsed.vendor_category ?? "—",
            stage: parsed.doc_type === "proposal" ? "proposal" : "contracted"
          })
          .select("id")
          .single();
        matchedVendor = created?.id ?? null;
      }
    }

    if (["proposal", "contract", "invoice"].includes(parsed.doc_type) && matchedVendor) {
      if (parsed.doc_type === "contract") {
        await supabase.from("vendors").update({ stage: "contracted" }).eq("id", matchedVendor);
      }
      await supabase.from("vendor_documents").insert({
        vendor_id: matchedVendor,
        wedding_id: weddingId,
        type: parsed.doc_type,
        label: parsed.label ?? file.name,
        storage_path: `internal/${path}`,
        extraction: parsed,
        client_visible: false
      });

      // The budget line: reworked if the vendor already has one,
      // opened as a draft if not — Estelle publishes when she is ready.
      let lineId: string | null = null;
      const { data: line } = await supabase
        .from("budget_lines")
        .select("id")
        .eq("wedding_id", weddingId)
        .eq("vendor_id", matchedVendor)
        .limit(1)
        .maybeSingle();
      if (line) {
        lineId = line.id;
        if (parsed.total_amount) {
          await supabase
            .from("budget_lines")
            .update({ committed: parsed.total_amount, status: "draft" })
            .eq("id", line.id);
        }
      } else if (parsed.total_amount) {
        const { count } = await supabase
          .from("budget_lines")
          .select("id", { count: "exact", head: true })
          .eq("wedding_id", weddingId);
        const { data: newLine } = await supabase
          .from("budget_lines")
          .insert({
            wedding_id: weddingId,
            vendor_id: matchedVendor,
            label: parsed.vendor_name ?? parsed.label ?? file.name,
            committed: parsed.total_amount,
            status: "draft",
            sort: (count ?? 0) + 1
          })
          .select("id")
          .single();
        lineId = newLine?.id ?? null;
      }

      // The quote's own lines, grouped by event — they power the unfold
      // and the client sheet, and the subtotal rolls up on its own.
      if (lineId && Array.isArray(parsed.items) && parsed.items.length) {
        const rows = parsed.items.map(
          (
            it: { event?: string; label?: string; qty?: number; unit_price?: number; total_ht?: number; vat_pct?: number; total_ttc?: number },
            i: number
          ) => ({
            wedding_id: weddingId,
            budget_line_id: lineId,
            event_label: it.event ?? null,
            label: it.label ?? "—",
            qty: it.qty ?? null,
            unit_price: it.unit_price ?? null,
            total_ht: it.total_ht ?? null,
            vat_pct: it.vat_pct ?? null,
            total_ttc: it.total_ttc ?? null,
            sort: i + 1
          })
        );
        // Replace this document's previous reading rather than stacking.
        await supabase.from("budget_line_items").delete().eq("budget_line_id", lineId);
        const { error: itemsErr } = await supabase.from("budget_line_items").insert(rows);
        // Before migration 0011 the table is absent — the line stands alone.
        if (!itemsErr) {
          const rollup = rows.reduce(
            (s: number, r: { total_ttc: number | null; total_ht: number | null }) =>
              s + Number(r.total_ttc ?? r.total_ht ?? 0),
            0
          );
          if (rollup > 0) {
            await supabase
              .from("budget_lines")
              .update({ committed: Math.round(rollup), committed_note: null, status: "draft" })
              .eq("id", lineId);
          }
        }
      }

      // A contract or invoice feeds the payment schedule — as data the
      // team reviews, never straight to the client.
      for (const instalment of parsed.schedule ?? []) {
        const base = {
          wedding_id: weddingId,
          budget_line_id: lineId,
          label: `${parsed.label ?? file.name} — ${instalment.label}`,
          amount: instalment.amount,
          due_date: instalment.due_date
        };
        const { error: payErr } = await supabase.from("payments").insert({
          ...base,
          currency: parsed.currency ?? "EUR",
          amount_eur: (parsed.currency ?? "EUR") === "EUR" ? instalment.amount : null,
          refundable: Boolean(instalment.refundable)
        });
        if (payErr) await supabase.from("payments").insert(base);
      }
    } else {
      const { error: docErr } = await supabase.from("documents").insert({
        wedding_id: weddingId,
        label: parsed.label ?? file.name,
        internal: true,
        storage_path: `internal/${path}`
      });
      // Before migration 0010 the column is absent — keep the register.
      if (docErr) {
        await supabase.from("documents").insert({
          wedding_id: weddingId,
          label: parsed.label ?? file.name,
          internal: true
        });
      }
    }

    // State plainly what was implanted — the narration must match the act.
    let text = parsed.summary ?? "Read and filed.";
    if (["proposal", "contract", "invoice"].includes(parsed.doc_type) && matchedVendor) {
      text += parsed.total_amount
        ? ` — The vendor and a draft budget line of ${parsed.total_amount} are in place below; publish when you are ready.`
        : ` — The vendor record is in place.`;
    }
    return NextResponse.json({ text, extraction: parsed });
  } catch (e) {
    return agentError(e);
  }
}
