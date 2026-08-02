// The three identities of the budget (chiffres-visuels brief §6) and
// the bar's construction — run with: npm run test:budget
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import os from "node:os";
import ts from "typescript";

const src = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/lib/budget-math.ts"),
  "utf8"
);
const { outputText: code } = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
});
const tmp = mkdtempSync(path.join(os.tmpdir(), "budgetmath-"));
const mod = path.join(tmp, "budget-math.mjs");
writeFileSync(mod, code);
const { barModel, pctOfBudget, coherence, envelopeCommitted } = await import(pathToFileURL(mod).href);

test("Camille & Alexander: paid is 22 % of budget, never 70 (§1)", () => {
  // total 720,000 · committed 221,427 · paid 156,100
  assert.equal(pctOfBudget(156100, 720000), 22);
  // The old, mislabeled figure — paid/committed — must not be what
  // pctOfBudget yields.
  assert.notEqual(pctOfBudget(156100, 720000), 70);
});

test("identity: paid + still to pay = committed", () => {
  const m = barModel({ total: 720000, committed: 221427, paid: 156100 });
  assert.equal(m.paid + m.stillToPay, 221427);
});

test("identity: committed + still to engage = budget (within budget)", () => {
  const m = barModel({ total: 720000, committed: 221427, paid: 156100 });
  assert.equal(221427 + m.stillToEngage, 720000);
  const c = coherence({ total: 720000, committed: 221427, paid: 156100 }, 221427);
  assert.equal(c.paidIdentity, true);
  assert.equal(c.budgetIdentity, true);
  assert.equal(c.envelopeIdentity, true);
});

test("Sophie & Gordon: the overrun is named, not a minus sign (§2)", () => {
  // committed exceeds the allotted budget by 94,573
  const total = 620000, committed = 714573;
  const m = barModel({ total, committed, paid: 400000 });
  assert.equal(m.beyond, 94573);
  assert.equal(m.stillToEngage, 0);
  // The bar's scale is the committed amount; the budget marker sits
  // strictly inside, and the beyond segment lives past it.
  assert.equal(m.scale, committed);
  assert.ok(m.markerPct < 100);
  assert.ok(m.beyondPct > 0);
  assert.ok(Math.abs(m.markerPct + m.beyondPct - 100) < 0.001);
});

test("the bar always sums to 100 % of its scale (beyond is an overlay)", () => {
  for (const f of [
    { total: 720000, committed: 221427, paid: 156100 },
    { total: 620000, committed: 714573, paid: 400000 },
    { total: 0, committed: 50000, paid: 10000 },
    { total: 100000, committed: 0, paid: 0 }
  ]) {
    const m = barModel(f);
    // paid + still-to-pay + still-to-engage tile the whole bar; the
    // beyond segment is the bronze overlay past the budget marker,
    // never an added length.
    const sum = m.paidPct + m.stillToPayPct + m.stillToEngagePct;
    assert.ok(Math.abs(sum - 100) < 0.001, JSON.stringify(f));
    if (m.beyond > 0) assert.ok(Math.abs(m.markerPct + m.beyondPct - 100) < 0.001);
  }
});

test("a percentage with no budget refuses to exist", () => {
  assert.equal(pctOfBudget(5000, 0), null);
});

test("envelope identity flags the gap for the team (§6)", () => {
  const c = coherence({ total: 720000, committed: 221427, paid: 156100 }, 200000);
  assert.equal(c.envelopeIdentity, false);
  assert.equal(Math.round(c.envelopeGap), -21427);
});

test("paid never exceeds committed on the bar", () => {
  const m = barModel({ total: 100000, committed: 50000, paid: 80000 });
  assert.equal(m.paid, 50000);
  assert.equal(m.stillToPay, 0);
});

test("envelopeCommitted: lines count in their category, homeless parents beyond", () => {
  const r = envelopeCommitted(
    [
      { id: "a", envelope_id: "E1", committedEur: 100, converted: true },
      { id: "b", envelope_id: null, committedEur: 40, converted: true },
      { id: "c", envelope_id: "E1", committedEur: 0, converted: false }
    ],
    []
  );
  assert.deepEqual(r.byEnvelope, { E1: 100 });
  assert.equal(r.beyond, 40);
});

test("envelopeCommitted: an overridden post moves its TTC, the line keeps the rest", () => {
  const r = envelopeCommitted(
    [{ id: "a", envelope_id: "VENUE", committedEur: 100000, converted: true }],
    [
      { budget_line_id: "a", envelope_id: "MUSIC", ttc: 8000 },
      { budget_line_id: "a", envelope_id: null, ttc: 50000 }
    ]
  );
  assert.equal(r.byEnvelope.MUSIC, 8000);
  assert.equal(r.byEnvelope.VENUE, 92000);
  assert.equal(r.beyond, 0);
});

test("envelopeCommitted: the identity holds even when moved posts exceed the committed", () => {
  const r = envelopeCommitted(
    [{ id: "a", envelope_id: "VENUE", committedEur: 100, converted: true }],
    [
      { budget_line_id: "a", envelope_id: "M1", ttc: 100 },
      { budget_line_id: "a", envelope_id: "M2", ttc: 100 }
    ]
  );
  assert.equal(Math.round(r.byEnvelope.M1), 50);
  assert.equal(Math.round(r.byEnvelope.M2), 50);
  assert.equal(Math.round(r.byEnvelope.VENUE ?? 0), 0);
  const sum = Object.values(r.byEnvelope).reduce((s, v) => s + v, 0) + r.beyond;
  assert.equal(Math.round(sum), 100);
});

test("envelopeCommitted: a homeless line's overridden post finds its category, the rest stays beyond", () => {
  const r = envelopeCommitted(
    [{ id: "a", envelope_id: null, committedEur: 128000, converted: true }],
    [{ budget_line_id: "a", envelope_id: "CAT", ttc: 25000 }]
  );
  assert.equal(r.byEnvelope.CAT, 25000);
  assert.equal(r.beyond, 103000);
});

test("envelopeCommitted: unconverted lines stand apart, overrides included", () => {
  const r = envelopeCommitted(
    [{ id: "a", envelope_id: "E1", committedEur: 0, converted: false }],
    [{ budget_line_id: "a", envelope_id: "E2", ttc: 500 }]
  );
  assert.deepEqual(r.byEnvelope, {});
  assert.equal(r.beyond, 0);
});
