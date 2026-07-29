import "server-only";
import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";

/**
 * Vendor banking details — IBAN, SWIFT, holder — encrypted at rest
 * (AES-256-GCM, key held by the server alone). They are never visible
 * by default, and reach a client only through an explicit, revocable
 * "reveal" the house sets on a given instalment.
 */

export interface BankingDetails {
  holder?: string;
  iban?: string;
  swift?: string;
  bank?: string;
  reference?: string;
}

/**
 * The structured profile (banking brief §2): a corridor discriminant
 * plus the field set that corridor requires — never a fixed column
 * list. Still one encrypted blob at rest; the structure lives inside.
 */
export interface BankingProfile {
  beneficiary?: {
    legal_name?: string;
    trading_name?: string;
    entity_type?: string;
    address?: string;
    tax_id?: string;
  };
  corridor?: string;
  account?: Record<string, string>;
  bank?: { name?: string; branch?: string; address?: string; country?: string };
  intermediary?: { name?: string; swift?: string; account?: string };
  terms?: {
    account_currency?: string;
    fee_arrangement?: string;
    payment_reference?: string;
    notes?: string;
  };
}

/** A legacy blob (0011 era) upgraded into the structured profile. */
export function toProfile(raw: BankingDetails | BankingProfile | null): BankingProfile | null {
  if (!raw) return null;
  if ("account" in raw || "beneficiary" in raw || "corridor" in raw) {
    return raw as BankingProfile;
  }
  const legacy = raw as BankingDetails;
  const account: Record<string, string> = {};
  if (legacy.iban) account.iban = legacy.iban;
  if (legacy.swift) account.bic = legacy.swift;
  return {
    beneficiary: legacy.holder ? { legal_name: legacy.holder } : undefined,
    corridor: legacy.iban ? "sepa" : "unknown",
    account,
    bank: legacy.bank ? { name: legacy.bank } : undefined,
    terms: legacy.reference ? { payment_reference: legacy.reference } : undefined
  };
}

/**
 * The fingerprint of the account itself (§6) — corridor plus account
 * fields, canonicalised. Two readings of the same coordinates agree;
 * a single changed character does not.
 */
export function bankingFingerprint(profile: BankingProfile): string {
  const account = profile.account ?? {};
  const canonical = Object.keys(account)
    .sort()
    .map((k) => `${k}=${String(account[k]).replace(/[\s-]+/g, "").toUpperCase()}`)
    .join("|");
  return createHash("sha256")
    .update(`${(profile.corridor ?? "unknown").toLowerCase()}::${canonical}`)
    .digest("hex");
}

function key(): Buffer {
  const secret = process.env.BANKING_SECRET;
  if (!secret) throw new Error("BANKING_SECRET is not configured");
  return createHash("sha256").update(secret).digest();
}

export function encryptBanking(details: BankingDetails | BankingProfile): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([
    cipher.update(JSON.stringify(details), "utf8"),
    cipher.final()
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
}

export function decryptBanking(enc: string): BankingDetails | null {
  try {
    const raw = Buffer.from(enc, "base64");
    const decipher = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const out = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]);
    return JSON.parse(out.toString("utf8")) as BankingDetails;
  } catch {
    return null;
  }
}

/** Decrypt and upgrade to the structured profile, whatever the era. */
export function decryptProfile(enc: string): BankingProfile | null {
  return toProfile(decryptBanking(enc));
}

/** "FR76 3000 6000 0112 3456 7890 189" → "FR76 •••• •••• •••• •• 189" */
export function maskIban(iban: string): string {
  const flat = iban.replace(/\s+/g, "");
  if (flat.length < 10) return "••••";
  return `${flat.slice(0, 4)} •••• •••• ${flat.slice(-4)}`;
}
