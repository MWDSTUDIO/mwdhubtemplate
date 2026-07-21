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

function key(): Buffer {
  const secret = process.env.BANKING_SECRET;
  if (!secret) throw new Error("BANKING_SECRET is not configured");
  return createHash("sha256").update(secret).digest();
}

export function encryptBanking(details: BankingDetails): string {
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

/** "FR76 3000 6000 0112 3456 7890 189" → "FR76 •••• •••• •••• •• 189" */
export function maskIban(iban: string): string {
  const flat = iban.replace(/\s+/g, "");
  if (flat.length < 10) return "••••";
  return `${flat.slice(0, 4)} •••• •••• ${flat.slice(-4)}`;
}
