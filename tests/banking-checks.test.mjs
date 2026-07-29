// The safety net's own safety net (banking brief §4) — run with:
//   npm run test:banking
// Pure calculations; if one of these fails, nothing banking ships.
import { test } from "node:test";
import assert from "node:assert/strict";

// The module under test is TypeScript; the project's own compiler
// erases the types so the test exercises the exact shipping code.
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import os from "node:os";
import ts from "typescript";

const src = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/lib/banking-checks.ts"),
  "utf8"
);
const { outputText: code } = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
});
const tmp = mkdtempSync(path.join(os.tmpdir(), "bankcheck-"));
const mod = path.join(tmp, "banking-checks.mjs");
writeFileSync(mod, code);
const {
  ibanChecksumOk, ibanLengthOk, bicFormatOk, bicCountryMatchesIban,
  ribKeyOk, abaChecksumOk, clabeChecksumOk, ukSortCodeOk, ukAccountOk,
  checkAccount, ibanGroups
} = await import(pathToFileURL(mod).href);

test("IBAN mod-97 accepts valid IBANs across corridors", () => {
  for (const iban of [
    "FR7630006000011234567890189",
    "DE89370400440532013000",
    "GB29NWBK60161331926819",
    "IT60X0542811101000000123456",
    "ES9121000418450200051332",
    "CH9300762011623852957",
    "NL91ABNA0417164300",
    "BE68539007547034",
    "MC5811222000010123456789030",
    "PT50000201231234567890154"
  ]) {
    assert.equal(ibanChecksumOk(iban), true, iban);
    assert.equal(ibanLengthOk(iban), true, iban + " length");
  }
});

test("IBAN mod-97 rejects a single misread character (0/O, 5/S…)", () => {
  const good = "FR7630006000011234567890189";
  // Swap each character for a plausible misread and expect rejection.
  const confusions = { "0": "8", "1": "7", "5": "3", "8": "0", "2": "9", "6": "5", "9": "4" };
  let rejected = 0, tried = 0;
  for (let i = 4; i < good.length; i++) {
    const c = good[i];
    const swap = confusions[c];
    if (!swap) continue;
    tried++;
    const bad = good.slice(0, i) + swap + good.slice(i + 1);
    if (!ibanChecksumOk(bad)) rejected++;
  }
  assert.equal(rejected, tried, "every single-character misread must fail mod-97");
});

test("IBAN with spaces and lowercase still validates", () => {
  assert.equal(ibanChecksumOk("fr76 3000 6000 0112 3456 7890 189"), true);
});

test("IBAN length table blocks truncated reads", () => {
  assert.equal(ibanLengthOk("FR763000600001123456789018"), false); // 26, not 27
  assert.equal(ibanLengthOk("XX7630006000011234567890189"), false); // unknown country
});

test("BIC format and country coherence", () => {
  assert.equal(bicFormatOk("BNPAFRPP"), true);
  assert.equal(bicFormatOk("BNPAFRPPXXX"), true);
  assert.equal(bicFormatOk("BNPAFRP"), false);
  assert.equal(bicCountryMatchesIban("BNPAFRPP", "FR7630006000011234567890189"), true);
  assert.equal(bicCountryMatchesIban("CHASUS33", "FR7630006000011234567890189"), false);
  // Intermediary divergence is normal:
  assert.equal(bicCountryMatchesIban("CHASUS33", "FR7630006000011234567890189", true), true);
});

test("French RIB key mod-97", () => {
  // Coherent bank/branch/account/key: key = 97 - (concat·100 mod 97).
  assert.equal(ribKeyOk("30006", "00001", "12345678901", "89"), true);
  assert.equal(ribKeyOk("30006", "00001", "12345678901", "90"), false);
});

test("ABA routing checksum (3-7-1)", () => {
  assert.equal(abaChecksumOk("021000021"), true);  // JPMorgan Chase NY
  assert.equal(abaChecksumOk("011401533"), true);
  assert.equal(abaChecksumOk("021000022"), false);
  assert.equal(abaChecksumOk("12345678"), false);  // 8 digits
});

test("CLABE check digit", () => {
  assert.equal(clabeChecksumOk("002010077777777771"), true);
  assert.equal(clabeChecksumOk("002010077777777770"), false);
  assert.equal(clabeChecksumOk("00201007777777777"), false); // 17 digits
});

test("UK local formats", () => {
  assert.equal(ukSortCodeOk("60-16-13"), true);
  assert.equal(ukAccountOk("31926819"), true);
  assert.equal(ukSortCodeOk("6016131"), false);
  assert.equal(ukAccountOk("3192681"), false);
});

test("corridor completeness: a US contract never asks for an IBAN", () => {
  const checks = checkAccount("us", { aba_routing: "021000021", account_number: "12345678", account_type: "checking" });
  assert.equal(checks.some((c) => c.field === "iban"), false);
  assert.equal(checks.every((c) => c.ok), true);
});

test("corridor completeness: UK GBP requires sort code + account, no IBAN", () => {
  const missing = checkAccount("uk_gbp", { account_number: "31926819" });
  assert.ok(missing.find((c) => c.field === "sort_code" && !c.ok && c.reason === "missing"));
});

test("a failing checksum rejects the field", () => {
  const checks = checkAccount("sepa", { iban: "FR7630006000011234567890188" });
  assert.ok(checks.find((c) => c.field === "iban" && !c.ok && c.reason === "mod97"));
});

test("IBAN presents in groups of four for the human eye", () => {
  assert.equal(ibanGroups("FR7630006000011234567890189"), "FR76 3000 6000 0112 3456 7890 189");
});
