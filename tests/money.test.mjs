// The rounding rule, tested and not merely intended
// (application-financière brief §1.4, §10) — npm run test:money
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import os from "node:os";
import ts from "typescript";

const src = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/lib/money.ts"),
  "utf8"
);
const { outputText: code } = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
});
const tmp = mkdtempSync(path.join(os.tmpdir(), "money-"));
const mod = path.join(tmp, "money.mjs");
writeFileSync(mod, code);
const { roundMoney, sumMoney, convertMoney, isCurrencyCode, lineEurValues } =
  await import(pathToFileURL(mod).href);

test("two decimals, half away from zero — both signs", () => {
  assert.equal(roundMoney(1.005), 1.01);
  assert.equal(roundMoney(2.675), 2.68);
  assert.equal(roundMoney(-1.005), -1.01);
  assert.equal(roundMoney(-2.675), -2.68);
  assert.equal(roundMoney(1.004), 1.0);
  assert.equal(roundMoney(0), 0);
});

test("never sum rounded values: sum exact, round once", () => {
  const values = [0.335, 0.335, 0.335];
  // Naive: round each (0.34) then sum → 1.02. The rule → 1.01.
  const naive = values.map(roundMoney).reduce((a, b) => a + b, 0);
  assert.equal(roundMoney(naive), 1.02);
  assert.equal(sumMoney(values), 1.01);
});

test("a traced conversion rounds once", () => {
  // £120,000 at 1.1837
  assert.equal(convertMoney(120000, 1.1837), 142044);
  assert.equal(convertMoney(99.99, 1.0001), 100.0);
});

test("currency codes are three letters, nothing else", () => {
  assert.equal(isCurrencyCode("GBP"), true);
  assert.equal(isCurrencyCode("EUR"), true);
  assert.equal(isCurrencyCode("eu"), false);
  assert.equal(isCurrencyCode("EURO"), false);
  assert.equal(isCurrencyCode("12E"), false);
});

test("EUR lines pass through untouched", () => {
  const v = lineEurValues({ currency: "EUR", committed: 195000, paid: 97500 });
  assert.deepEqual(v, { converted: true, committedEur: 195000, paidEur: 97500 });
});

test("a foreign line counts only through its traced equivalent (§1.1)", () => {
  // £120,000 held at €142,044 — paid £60,000 follows the same rate.
  const v = lineEurValues({ currency: "GBP", committed: 120000, committed_eur: 142044, paid: 60000 });
  assert.equal(v.converted, true);
  assert.equal(v.committedEur, 142044);
  assert.equal(v.paidEur, 71022);
});

test("a foreign line without a held rate stands apart — never mixed", () => {
  const v = lineEurValues({ currency: "GBP", committed: 120000, paid: 0 });
  assert.equal(v.converted, false);
  assert.equal(v.committedEur, 0);
});

test("a legacy line with no currency column behaves as EUR", () => {
  const v = lineEurValues({ committed: 5000, paid: 1000 });
  assert.equal(v.converted, true);
  assert.equal(v.committedEur, 5000);
});
