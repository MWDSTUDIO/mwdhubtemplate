import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { gate, agentError } from "../_shared";
import { runAgentFull, ANALYSIS_MODEL } from "@/lib/agents/run";
import { checkAccount, type Corridor } from "@/lib/banking-checks";

const READABLE = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif"]);

/**
 * The banking reader — a sub-agent of its own, distinct from the
 * budget analyst, on the most capable model. It does only this.
 *
 * The governing sentence (banking brief §0): the agent reads, a human
 * verifies out of band, the system keeps the trace. This route only
 * ever produces a PROPOSED reading; nothing it extracts can pay
 * anyone until Estelle has verified it de vive voix.
 */
const BANKING_SYSTEM =
  `You are the house's banking reader. You extract beneficiary bank coordinates from vendor documents ` +
  `(contracts, quotes, RIB sheets, photographed bank details) with the caution of a person who knows that ` +
  `a wire sent to the wrong account does not come back.\n` +
  `THE PROHIBITIONS — absolute, no exception:\n` +
  `1. NEVER guess a character. Systematically suspect the confusable pairs 0/O, 1/l/I, 5/S, 8/B, 2/Z, 6/G. ` +
  `A doubtful character is flagged with its exact position in the string — never settled by judgement.\n` +
  `2. NEVER complete a partial IBAN — not by checksum arithmetic, not by national format deduction.\n` +
  `3. NEVER derive the BIC from the IBAN. A bank has several BICs and correspondence tables go stale. ` +
  `If the document does not print a BIC, the field stays null.\n` +
  `4. NEVER invent a bank's address from its name.\n` +
  `5. NEVER deduce the corridor. It is read in the document or in the first two letters of a printed IBAN; ` +
  `otherwise it is "unknown".\n` +
  `6. NEVER merge two banking blocks. A document may carry several (the vendor and a subcontractor, an EUR ` +
  `account and a GBP account) — extract each separately with whatever identifies it.\n` +
  `7. When in doubt, do not fill. A flagged empty field is worth infinitely more than a plausible figure.\n` +
  `For every field report the normalised value, the raw reading exactly as printed, a confidence between 0 ` +
  `and 1, and where it sits (page, zone). Report every character-level doubt in "flagged" with the exact ` +
  `quote and position.`;

const SCHEMA =
  `Reply with STRICT JSON only — no prose: {"blocks": [{` +
  `"identifies": string|null (what marks this block: "main contract account", "EUR account", "subcontractor X"…), ` +
  `"beneficiary": {"legal_name": F, "trading_name": F, "entity_type": {"value": "company"|"sole_trader"|"individual"|null, ...F}, "address": F, "tax_id": F}, ` +
  `"corridor": "sepa"|"uk_gbp"|"uk_eur"|"ch"|"us"|"ca"|"au"|"in"|"mx"|"jp"|"mena"|"other"|"unknown" (READ, never deduced), ` +
  `"account": {"iban": F, "bic": F, "sort_code": F, "account_number": F, "account_type": F, "aba_routing": F, ` +
  `"institution_number": F, "transit_number": F, "bsb": F, "ifsc": F, "clabe": F, "bank_code": F, "branch_code": F, "swift": F, "rib_key": F} (only the fields the document prints), ` +
  `"bank": {"name": F, "branch": F, "address": F, "country": F}, ` +
  `"intermediary": {"name": F, "swift": F, "account": F}|null (small print under the main block — omitting it bounces wires), ` +
  `"terms": {"account_currency": F, "fee_arrangement": {"value": "OUR"|"SHA"|"BEN"|null, ...F}, "payment_reference": F, "notes": F}, ` +
  `"flagged": [{"field": string, "reason": string, "quote": string (exact words), "position": string|null (char position for character doubts)}]` +
  `}]} where F = {"value": string|null, "raw": string|null (exactly as printed), "confidence": number, "page": number|null, "zone": string|null}.`;

type F = { value: string | null; raw?: string | null; confidence?: number; page?: number | null; zone?: string | null };
interface AgentBlock {
  identifies?: string | null;
  beneficiary?: Record<string, F>;
  corridor?: string;
  account?: Record<string, F>;
  bank?: Record<string, F>;
  intermediary?: Record<string, F> | null;
  terms?: Record<string, F>;
  flagged?: { field: string; reason: string; quote?: string; position?: string | null }[];
}

export async function POST(request: Request) {
  const g = await gate(true);
  if ("error" in g) return g.error;
  try {
    const form = await request.formData();
    const weddingId = String(form.get("weddingId"));
    const vendorId = form.get("vendorId") ? String(form.get("vendorId")) : null;
    const file = form.get("file") as File | null;
    if (!file || !weddingId || !vendorId) {
      return NextResponse.json({ error: "missing file or vendor" }, { status: 400 });
    }
    const mediaType = READABLE.has(file.type) ? file.type : null;
    if (!mediaType) {
      return NextResponse.json({ text: "This format cannot be read for banking — a PDF or a photo, please." });
    }
    const buffer = Buffer.from(await file.arrayBuffer());

    // A paper carrying bank coordinates is filed in the VAULT —
    // Estelle's level alone; it never nears the client's Documents
    // page whatever the manipulation (§3).
    const admin = createAdminClient();
    const vaultPath = `${weddingId}/banking/${Date.now()}-${file.name}`;
    await admin.storage.from("vault").upload(vaultPath, buffer, {
      contentType: file.type || "application/octet-stream"
    });

    const { text } = await runAgentFull({
      weddingId,
      agent: "document",
      extraSystem: BANKING_SYSTEM,
      prompt:
        `Read the attached document for BANKING COORDINATES only — every page, including small print under ` +
        `the payment block. ${SCHEMA}`,
      documents: [{ base64: buffer.toString("base64"), mediaType }],
      model: ANALYSIS_MODEL,
      maxTokens: 4000,
      effort: "medium"
    });

    let parsed: { blocks?: AgentBlock[] } | null = null;
    try {
      parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    } catch {
      /* handled below */
    }
    const blocks = parsed?.blocks ?? [];
    if (blocks.length === 0) {
      return NextResponse.json({
        text: "No banking block could be read in this document. The paper itself is filed in the vault."
      });
    }

    // The deterministic net (§4) runs BEFORE anything is displayed:
    // a failing control rejects the field — back to "reading to
    // confirm", never a warning beside a wrong number.
    for (const b of blocks) {
      const account = b.account ?? {};
      const values: Record<string, string | undefined> = {};
      for (const [k, f] of Object.entries(account)) {
        if (f?.value) values[k] = f.value;
      }
      const checks = checkAccount((b.corridor as Corridor) ?? "unknown", values);
      for (const c of checks) {
        if (!c.ok && account[c.field]?.value) {
          (b.flagged ??= []).push({
            field: c.field,
            reason: `deterministic:${c.reason}`,
            quote: account[c.field]?.raw ?? account[c.field]?.value ?? ""
          });
          account[c.field] = { ...account[c.field], value: null };
        } else if (!c.ok) {
          (b.flagged ??= []).push({ field: c.field, reason: `deterministic:${c.reason}`, quote: "" });
        }
      }
    }

    const supabase = await createClient();
    const { error } = await supabase.from("document_readings").insert({
      wedding_id: weddingId,
      vendor_id: vendorId,
      label: `Banking — ${file.name}`,
      storage_path: `vault/${vaultPath}`,
      status: "proposed",
      payload: { kind: "banking", blocks, vault_path: `vault/${vaultPath}`, file_name: file.name }
    });
    if (error) {
      return NextResponse.json({
        text: "The reading is done but cannot be filed before migration 0013. The paper is safe in the vault."
      });
    }

    const flaggedCount = blocks.reduce((s, b) => s + (b.flagged?.length ?? 0), 0);
    return NextResponse.json({
      text:
        `Read: ${blocks.length} banking block${blocks.length > 1 ? "s" : ""}, ` +
        `${flaggedCount} point${flaggedCount === 1 ? "" : "s"} to confirm. ` +
        `The reading awaits your eye on the vendor sheet — and nothing pays anyone before your ` +
        `own out-of-band verification.`,
      blocks: blocks.length,
      flagged: flaggedCount
    });
  } catch (e) {
    return agentError(e);
  }
}
