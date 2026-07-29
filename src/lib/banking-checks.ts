/**
 * Deterministic banking controls (banking brief §4). Calculations,
 * not judgements: they do not err, they run before any display and
 * any write, and a failed control REJECTS the field — never a
 * warning beside a wrong number, because warnings get clicked.
 *
 * Pure functions, no server dependency: unit-tested in isolation.
 */

/** Official IBAN lengths per country (ISO 13616 registry). */
export const IBAN_LENGTHS: Record<string, number> = {
  AD: 24, AE: 23, AL: 28, AT: 20, AZ: 28, BA: 20, BE: 16, BG: 22,
  BH: 22, BR: 29, CH: 21, CR: 22, CY: 28, CZ: 24, DE: 22, DK: 18,
  DO: 28, EE: 20, EG: 29, ES: 24, FI: 18, FO: 18, FR: 27, GB: 22,
  GE: 22, GI: 23, GL: 18, GR: 27, GT: 28, HR: 21, HU: 28, IE: 22,
  IL: 23, IS: 26, IT: 27, JO: 30, KW: 30, KZ: 20, LB: 28, LI: 21,
  LT: 20, LU: 20, LV: 21, MC: 27, MD: 24, ME: 22, MK: 19, MR: 27,
  MT: 31, MU: 30, NL: 18, NO: 15, PK: 24, PL: 28, PS: 29, PT: 25,
  QA: 29, RO: 24, RS: 22, SA: 24, SE: 24, SI: 19, SK: 24, SM: 27,
  TN: 24, TR: 26, UA: 29, VG: 24, XK: 20
};

const flat = (s: string) => s.replace(/[\s-]+/g, "").toUpperCase();

/** ISO 13616 mod-97 checksum — catches nearly every misread character. */
export function ibanChecksumOk(iban: string): boolean {
  const s = flat(iban);
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]+$/.test(s)) return false;
  const rearranged = s.slice(4) + s.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const v = ch >= "A" ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of v) remainder = (remainder * 10 + Number(d)) % 97;
  }
  return remainder === 1;
}

/** Length per country. Unknown country → cannot vouch: false. */
export function ibanLengthOk(iban: string): boolean {
  const s = flat(iban);
  const expected = IBAN_LENGTHS[s.slice(0, 2)];
  return expected != null && s.length === expected;
}

export function ibanCountry(iban: string): string | null {
  const s = flat(iban);
  return /^[A-Z]{2}/.test(s) ? s.slice(0, 2) : null;
}

/** ISO 9362: 8 or 11 chars; positions 5–6 carry the country. */
export function bicFormatOk(bic: string): boolean {
  return /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(flat(bic));
}

/**
 * The BIC's country must match the IBAN's — except an intermediary
 * bank, where divergence is normal (pass isIntermediary).
 */
export function bicCountryMatchesIban(bic: string, iban: string, isIntermediary = false): boolean {
  if (isIntermediary) return true;
  const b = flat(bic), i = flat(iban);
  if (!bicFormatOk(b) || !/^[A-Z]{2}/.test(i)) return false;
  return b.slice(4, 6) === i.slice(0, 2);
}

/** French RIB key: bank (5) + branch (5) + account (11) + key (2), mod 97. */
export function ribKeyOk(bank: string, branch: string, account: string, key: string): boolean {
  const b = flat(bank), g = flat(branch), a = flat(account), k = flat(key);
  if (!/^\d{5}$/.test(b) || !/^\d{5}$/.test(g) || a.length !== 11 || !/^\d{2}$/.test(k)) return false;
  // Letters in the account map to digits per the RIB table.
  const table: Record<string, string> = {
    A: "1", B: "2", C: "3", D: "4", E: "5", F: "6", G: "7", H: "8", I: "9",
    J: "1", K: "2", L: "3", M: "4", N: "5", O: "6", P: "7", Q: "8", R: "9",
    S: "2", T: "3", U: "4", V: "5", W: "6", X: "7", Y: "8", Z: "9"
  };
  const acc = [...a].map((c) => (/[0-9]/.test(c) ? c : table[c] ?? "")).join("");
  if (acc.length !== 11) return false;
  let remainder = 0;
  for (const d of b + g + acc + k) remainder = (remainder * 10 + Number(d)) % 97;
  return remainder === 0;
}

/** ABA routing checksum — weights 3, 7, 1 (US). */
export function abaChecksumOk(routing: string): boolean {
  const s = flat(routing);
  if (!/^\d{9}$/.test(s)) return false;
  const w = [3, 7, 1, 3, 7, 1, 3, 7, 1];
  const sum = [...s].reduce((acc, d, i) => acc + Number(d) * w[i], 0);
  return sum % 10 === 0;
}

/** CLABE check digit (Mexico, 18 digits, weights 3-7-1 mod 10). */
export function clabeChecksumOk(clabe: string): boolean {
  const s = flat(clabe);
  if (!/^\d{18}$/.test(s)) return false;
  const w = [3, 7, 1];
  const sum = [...s.slice(0, 17)].reduce((acc, d, i) => acc + ((Number(d) * w[i % 3]) % 10), 0);
  return (10 - (sum % 10)) % 10 === Number(s[17]);
}

/** UK sort code: 6 digits. Account: 8 digits. */
export function ukSortCodeOk(sort: string): boolean {
  return /^\d{6}$/.test(flat(sort));
}
export function ukAccountOk(account: string): boolean {
  return /^\d{8}$/.test(flat(account));
}

export type Corridor =
  | "sepa" | "uk_gbp" | "uk_eur" | "ch" | "us" | "ca" | "au"
  | "in" | "mx" | "jp" | "mena" | "other" | "unknown";

/** Which account fields a corridor requires to be COMPLETE (§2 bloc B). */
export const CORRIDOR_REQUIRED: Record<Corridor, string[]> = {
  sepa: ["iban"],
  uk_gbp: ["sort_code", "account_number"],
  uk_eur: ["iban", "bic"],
  ch: ["iban", "bic"],
  us: ["aba_routing", "account_number", "account_type"],
  ca: ["institution_number", "transit_number", "account_number"],
  au: ["bsb", "account_number"],
  in: ["ifsc", "account_number"],
  mx: ["clabe"],
  jp: ["bank_code", "branch_code", "account_number"],
  mena: ["account_number", "swift"],
  other: ["account_number", "swift"],
  unknown: []
};

/** Outside SEPA, the bank block is required by the wire form (§2 bloc C). */
export function bankBlockRequired(corridor: Corridor): boolean {
  return corridor !== "sepa" && corridor !== "unknown";
}

export interface FieldCheck {
  field: string;
  ok: boolean;
  reason?: string;
}

/**
 * Run every applicable deterministic control over an account block.
 * A failing control rejects its field — the caller must send it back
 * to "reading to confirm", never display it with a warning.
 */
export function checkAccount(corridor: Corridor, account: Record<string, string | undefined>): FieldCheck[] {
  const out: FieldCheck[] = [];
  const iban = account.iban;
  if (iban) {
    if (!ibanChecksumOk(iban)) out.push({ field: "iban", ok: false, reason: "mod97" });
    else if (!ibanLengthOk(iban)) out.push({ field: "iban", ok: false, reason: "length" });
    else out.push({ field: "iban", ok: true });
  }
  const bic = account.bic ?? account.swift;
  if (bic) {
    if (!bicFormatOk(bic)) out.push({ field: "bic", ok: false, reason: "format" });
    else if (iban && !bicCountryMatchesIban(bic, iban)) out.push({ field: "bic", ok: false, reason: "country_mismatch" });
    else out.push({ field: "bic", ok: true });
  }
  if (account.aba_routing) {
    out.push(
      abaChecksumOk(account.aba_routing)
        ? { field: "aba_routing", ok: true }
        : { field: "aba_routing", ok: false, reason: "checksum" }
    );
  }
  if (account.clabe) {
    out.push(
      clabeChecksumOk(account.clabe)
        ? { field: "clabe", ok: true }
        : { field: "clabe", ok: false, reason: "check_digit" }
    );
  }
  if (corridor === "uk_gbp") {
    if (account.sort_code) {
      out.push(ukSortCodeOk(account.sort_code) ? { field: "sort_code", ok: true } : { field: "sort_code", ok: false, reason: "format" });
    }
    if (account.account_number) {
      out.push(ukAccountOk(account.account_number) ? { field: "account_number", ok: true } : { field: "account_number", ok: false, reason: "format" });
    }
  }
  // Completeness for the corridor: an incomplete sheet is incomplete,
  // not "roughly right" (§2).
  for (const req of CORRIDOR_REQUIRED[corridor] ?? []) {
    if (!account[req] || !String(account[req]).trim()) {
      out.push({ field: req, ok: false, reason: "missing" });
    }
  }
  return out;
}

/** "FR7630006000011234567890189" → "FR76 3000 6000 0112 3456 7890 189" (§4). */
export function ibanGroups(iban: string): string {
  return flat(iban).replace(/(.{4})/g, "$1 ").trim();
}
