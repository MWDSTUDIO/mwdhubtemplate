import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { gate, agentError } from "../_shared";
import { runAgentFull, ANALYSIS_MODEL, HOUSE_MODEL } from "@/lib/agents/run";

const READABLE = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif"
]);

/**
 * The analyst's system prompt — a finance director of hospitality and
 * events (brief C8): minimum spends, service charges, buyouts, European
 * VAT rates and their per-post differences, the invoicing usage of
 * châteaux and fine caterers. The cardinal rule is stated in so many
 * words: a flagged empty field is worth infinitely more than an
 * invented figure.
 */
const ANALYST_SYSTEM =
  `You are also the house's finance director for hospitality and events: fluent in minimum spends, ` +
  `service charges, venue buyouts, European VAT rates and how they differ by post (catering vs rental vs service), ` +
  `deposit and caution customs, and the invoicing habits of châteaux, fine caterers, florists and rental houses.\n` +
  `THE CARDINAL RULE: never invent. A flagged empty field is worth infinitely more than an invented figure. ` +
  `When a value is ambiguous, unreadable or absent, leave the field null and record it in "flagged" with the ` +
  `document's exact words.\n` +
  `THE SCHEDULE BELONGS TO THE VENDOR (absolute): reproduce instalments exactly as the document states them — ` +
  `no normalisation, no rounding, no template. NEVER compute a date that is not written: when an instalment is ` +
  `expressed as a condition ("at signature", "60 days before the event", "on settlement of the minimum spend"), ` +
  `keep the condition word for word in "trigger" and leave "due_date" null — an invented date would one day ` +
  `notify a client falsely. NEVER complete a partial schedule: if the document says nothing of the balance, ` +
  `stop and flag it — do not deduce the last instalment by subtraction.`;

/**
 * Drop a document on the house: the analyst reads it whole on the most
 * capable model, and the reading lands as a PROPOSAL — vendor, totals,
 * every line, the schedule as written, terms, banking — side by side
 * with what the hub holds, awaiting Estelle's word. Nothing writes
 * itself into the budget (brief C6). The paper itself is always filed.
 */
export async function POST(request: Request) {
  const g = await gate(true);
  if ("error" in g) return g.error;
  try {
    const form = await request.formData();
    const weddingId = String(form.get("weddingId"));
    const vendorId = form.get("vendorId") ? String(form.get("vendorId")) : null;
    const sha256 = form.get("sha256") ? String(form.get("sha256")) : null;
    const force = Boolean(form.get("force"));
    // Re-read (PRD Budget §10): the paper already filed is read again
    // from its original — the user never re-uploads the whole file.
    const rereadPath = form.get("rereadPath") ? String(form.get("rereadPath")) : null;
    const focus = form.get("focus") ? String(form.get("focus")).slice(0, 500) : null;
    const file = form.get("file") as File | null;
    if ((!file && !rereadPath) || !weddingId) {
      return NextResponse.json({ error: "missing file" }, { status: 400 });
    }

    const supabase = await createClient();

    let buffer: Buffer;
    let fileName: string;
    let fileType: string;
    let path: string;
    if (rereadPath) {
      const storageKey = rereadPath.replace(/^internal\//, "");
      const { data: blob, error: dlErr } = await supabase.storage.from("internal").download(storageKey);
      if (dlErr || !blob) return NextResponse.json({ error: "original not found" }, { status: 404 });
      buffer = Buffer.from(await blob.arrayBuffer());
      fileName = storageKey.split("/").pop() ?? "document";
      fileType = /\.pdf$/i.test(fileName)
        ? "application/pdf"
        : /\.(png)$/i.test(fileName)
          ? "image/png"
          : /\.(jpe?g)$/i.test(fileName)
            ? "image/jpeg"
            : blob.type || "application/octet-stream";
      path = storageKey;
    } else {
      buffer = Buffer.from(await file!.arrayBuffer());
      fileName = file!.name;
      fileType = file!.type;
      path = "";
    }
    const mediaType = READABLE.has(fileType) ? fileType : null;

    // The same paper is never filed twice (§9): the fingerprint is
    // checked before any reading — Estelle may still insist.
    if (sha256 && !force && !rereadPath) {
      try {
        const { data: twin } = await supabase
          .from("vendor_documents")
          .select("id, label")
          .eq("wedding_id", weddingId)
          .eq("file_sha256", sha256)
          .limit(1)
          .maybeSingle();
        if (twin) return NextResponse.json({ duplicate: true, label: twin.label });
      } catch {
        // Pre-0027 the fingerprint column is absent — no check to make.
      }
    }

    // A rough page count for the paper's file (0027) — PDF only.
    let pageCount: number | null = null;
    if (fileType === "application/pdf") {
      const m = buffer.toString("latin1").match(/\/Type\s*\/Page(?![a-zA-Z])/g);
      pageCount = m?.length || null;
    }

    const { data: vendors } = await supabase
      .from("vendors")
      .select("id, name, category")
      .eq("wedding_id", weddingId);

    // The original is filed first — whatever the reading yields. A
    // re-read never duplicates the file: the filed original serves.
    if (!rereadPath) {
      path = `${weddingId}/${Date.now()}-${fileName}`;
      await supabase.storage.from("internal").upload(path, buffer, {
        contentType: fileType || "application/octet-stream"
      });
    }

    const intro = mediaType
      ? "Read the attached document in its entirety — every page, every line." +
        (focus ? ` Estelle asks particular care on this re-reading: ${focus}.` : "")
      : `A file named "${fileName}" was dropped (its format cannot be read inline).`;
    const baseFields =
      `Reply with STRICT JSON only — no prose before or after: {` +
      `"doc_type": "proposal"|"contract"|"invoice"|"guest_list"|"other", ` +
      `"vendor_id": string|null (an existing vendor id if the document belongs to one), ` +
      `"vendor_name": string|null, "vendor_category": string|null (Venue, Floral, Catering, Image…), ` +
      `"vendor_country": string|null, ` +
      `"label": string (short display label), ` +
      `"currency": string|null, "total_ht": number|null, "total_ttc": number|null, ` +
      `"total_amount": number|null (the committed total, TTC when known), ` +
      `"vat_summary": [{"rate": number, "base": number|null, "amount": number|null}]|null, ` +
      `"service_charge": {"pct": number|null, "amount": number|null}|null, ` +
      `"minimum_spend": number|null (to carry as a NEGATIVE credit line when consumed), ` +
      `"buyout": number|null, ` +
      `"deposit": {"amount": number|null, "refundable": boolean|null, "deadline": string|null}|null, ` +
      `"cancellation_terms": string|null (one or two lines, the sliding scale if any), ` +
      `"validity_date": "yyyy-mm-dd"|null (how long the offer stands), ` +
      `"banking": {"account_name": string|null, "iban": string|null, "swift": string|null, "bank": string|null}|null ` +
      `(if printed on the document — it will be stored encrypted, never shown), ` +
      `"schedule": [{"label": string, "amount": number, "percentage": number|null, ` +
      `"due_date": "yyyy-mm-dd"|null (ONLY a date written in the document), ` +
      `"trigger": string|null (the condition word for word when no date is written), ` +
      `"refundable": boolean (true ONLY when the document expressly says so), "page": number|null}], `;
    const preamble =
      `${intro}\n` +
      `Known vendors: ${JSON.stringify(vendors)}.\n` +
      `Estelle handed this document to the house herself: if it is a vendor proposal, contract or invoice — even a ` +
      `sample drawn from another wedding — classify it as such and extract everything. Only classify as "other" what ` +
      `is genuinely not vendor paper.\n`;
    const fullPrompt =
      preamble +
      baseFields +
      `"items": [{"event": string|null (the wedding moment the line belongs to), "label": string (short), ` +
      `"qty": number|null, "unit_price": number|null, "total_ht": number|null, "vat_pct": number|null, ` +
      `"total_ttc": number|null, "page": number|null}] ` +
      `(EVERY priced line of the quote, grouped by event, at the document's own granularity — never aggregate, ` +
      `never truncate; legal boilerplate is not a line), ` +
      `"terms": string|null (one line), ` +
      `"confidence": {"vendor": number, "totals": number, "items": number, "schedule": number} (0 to 1 each), ` +
      `"flagged": [{"field": string, "reason": string, "quote": string (the document's exact words)}], ` +
      `"summary": string (2–3 sentences to Estelle, in the house's voice, stating what you read and what now awaits her word)}`;
    const slimPrompt =
      preamble +
      baseFields +
      `"items": [] (leave empty this time), ` +
      `"terms": string|null (one line), ` +
      `"confidence": {"vendor": number, "totals": number, "items": number, "schedule": number}, ` +
      `"flagged": [{"field": string, "reason": string, "quote": string}], ` +
      `"summary": string (2–3 sentences to Estelle, in the house's voice)}`;

    const documents = mediaType ? [{ mediaType, base64: buffer.toString("base64") }] : undefined;
    let parsed: Record<string, unknown> & {
      doc_type?: string; vendor_id?: string | null; vendor_name?: string | null;
      vendor_category?: string | null; label?: string; summary?: string;
    } | null = null;
    let itemsLost = false;
    // A missing key is a configuration fact, not a difficult document —
    // it is said in so many words, never disguised (house rule: honest).
    const keyMissing = !process.env.ANTHROPIC_API_KEY;
    try {
      if (keyMissing) throw new Error("ANTHROPIC_API_KEY is not configured");
      // The full reading, on the most capable model, with room for a
      // long quote read whole (C2 — no line cap, ever).
      const first = await runAgentFull({
        weddingId, agent: "budget", maxTokens: 8000, documents, prompt: fullPrompt,
        model: ANALYSIS_MODEL, effort: "medium", extraSystem: ANALYST_SYSTEM
      });
      if (first.stopReason === "max_tokens") throw new Error("truncated");
      parsed = JSON.parse(first.text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
    } catch (err) {
      console.error("document read, full pass:", err);
      // The fallback reads without the line detail — and SAYS SO (C3):
      // a silent loss is a lie by omission.
      try {
        if (keyMissing) throw new Error("ANTHROPIC_API_KEY is not configured");
        const second = await runAgentFull({
          weddingId, agent: "budget", maxTokens: 2500, documents, prompt: slimPrompt,
          model: HOUSE_MODEL, extraSystem: ANALYST_SYSTEM
        });
        parsed = JSON.parse(second.text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
        itemsLost = true;
      } catch (err2) {
        console.error("document read, slim pass:", err2);
        parsed = null;
      }
    }

    if (!parsed) {
      const { error: docErr } = await supabase.from("documents").insert({
        wedding_id: weddingId,
        label: fileName,
        internal: true,
        storage_path: `internal/${path}`
      });
      if (docErr) {
        await supabase.from("documents").insert({ wedding_id: weddingId, label: fileName, internal: true });
      }
      return NextResponse.json({
        text: keyMissing
          ? "The document is filed in the register, but the house's reading key is not set: " +
            "add ANTHROPIC_API_KEY to the environment (Netlify and .env.local) and drop the paper once more — " +
            "no reading can run without it."
          : "The document is filed in the register, but its reading resisted just now — " +
            "it may be long or densely set. Drop it once more, or tell Madame what it holds and she will enter it by hand."
      });
    }

    // Resolve the vendor — by explicit choice, by the analyst's match,
    // by name, or by creating the record (identity only; figures wait).
    const docType = parsed.doc_type ?? "other";
    let matchedVendor: string | null = vendorId ?? parsed.vendor_id ?? null;
    if (
      !matchedVendor &&
      parsed.vendor_name &&
      ["proposal", "contract", "invoice"].includes(docType)
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
            stage: docType === "proposal" ? "proposal" : "contracted"
          })
          .select("id")
          .single();
        matchedVendor = created?.id ?? null;
      }
    }

    if (["proposal", "contract", "invoice"].includes(docType) && matchedVendor) {
      if (docType === "contract") {
        await supabase.from("vendors").update({ stage: "contracted" }).eq("id", matchedVendor);
      }
      // The paper joins the vendor's file — re-drops replace, never stack.
      await supabase
        .from("vendor_documents")
        .delete()
        .eq("vendor_id", matchedVendor)
        .eq("type", docType)
        .eq("label", parsed.label ?? fileName);
      const docRow = {
        vendor_id: matchedVendor,
        wedding_id: weddingId,
        type: docType,
        label: parsed.label ?? fileName,
        storage_path: `internal/${path}`,
        extraction: parsed,
        client_visible: false
      };
      // The fingerprint and page count ride along (0027) — shed
      // gracefully while the columns are still to come.
      let { data: vendorDoc, error: vdErr } = await supabase
        .from("vendor_documents")
        .insert({ ...docRow, file_sha256: sha256, page_count: pageCount })
        .select("id")
        .single();
      if (vdErr) {
        ({ data: vendorDoc } = await supabase
          .from("vendor_documents")
          .insert(docRow)
          .select("id")
          .single());
      }

      // C6 — the reading lands as a PROPOSAL. Nothing touches the
      // budget until Estelle's word; the comparison waits in the hub.
      // A re-drop of the same paper replaces its previous proposal.
      const { error: readErr } = await supabase
        .from("document_readings")
        .delete()
        .eq("vendor_id", matchedVendor)
        .eq("label", parsed.label ?? fileName)
        .eq("status", "proposed");
      const { error: insErr } = await supabase.from("document_readings").insert({
        wedding_id: weddingId,
        vendor_id: matchedVendor,
        vendor_document_id: vendorDoc?.id ?? null,
        label: parsed.label ?? fileName,
        storage_path: `internal/${path}`,
        payload: { ...parsed, items_lost: itemsLost }
      });
      void readErr;

      let text = parsed.summary ?? "Read and filed.";
      if (!insErr) {
        text +=
          " — The reading awaits your word in the Budget: the document's figures sit beside the hub's, and nothing moves until you accept.";
      } else {
        // Before migration 0013 the desk is absent — say so honestly.
        text += " — Run migration 0013 to review readings before they enter the budget.";
      }
      if (itemsLost) {
        text +=
          " NOTE: the line-by-line detail could not be kept this time — totals and schedule stand, but the sub-lines were lost; drop the document once more to recover them.";
      }
      return NextResponse.json({ text, extraction: parsed });
    }

    // Not vendor paper — it goes to the internal register as before.
    const { error: docErr } = await supabase.from("documents").insert({
      wedding_id: weddingId,
      label: parsed.label ?? fileName,
      internal: true,
      storage_path: `internal/${path}`
    });
    if (docErr) {
      await supabase.from("documents").insert({
        wedding_id: weddingId,
        label: parsed.label ?? fileName,
        internal: true
      });
    }
    return NextResponse.json({ text: parsed.summary ?? "Read and filed.", extraction: parsed });
  } catch (e) {
    return agentError(e);
  }
}
