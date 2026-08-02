// The ceremony's deterministic readiness and its duration (PRD
// Ceremony §8, §16) — actual completion, never an interpretation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import os from "node:os";
import ts from "typescript";

const src = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/lib/ceremony.ts"),
  "utf8"
);
const { outputText: code } = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
});
const tmp = mkdtempSync(path.join(os.tmpdir(), "ceremony-"));
const mod = path.join(tmp, "ceremony.mjs");
writeFileSync(mod, code);
const { ceremonyReadiness, flowDuration, checkDone, TEMPLATE_FLOW, READINESS_CHECKS } = await import(
  pathToFileURL(mod).href
);

const emptySections = {
  participants: [],
  flow: [],
  music: [],
  readings: [],
  logistics: [],
  documents: []
};
const bareCeremony = {
  kind: "", title: null, ceremony_date: null, start_time: null,
  venue: null, officiant: null, duration_min: null, plan_b: null, checklist: {}
};
const fullCeremony = {
  kind: "civil", title: "The civil hour", ceremony_date: "2027-09-04",
  start_time: "16:30", venue: "Mairie de Gordes", officiant: "M. le Maire",
  duration_min: 30, plan_b: "The orangerie", checklist: {}
};
const fullSections = {
  participants: [{ id: "p1" }],
  flow: [{ id: "f1", archived: false, duration_min: 10 }, { id: "f2", archived: false, duration_min: 20 }],
  music: [{ id: "m1", archived: false }],
  readings: [{ id: "r1", archived: false }],
  logistics: [{ id: "l1", status: "ready" }, { id: "l2", status: "not_required" }],
  documents: [{ id: "d1" }]
};

test("an empty ceremony blocks on every required check, counsels the rest", () => {
  const r = ceremonyReadiness(bareCeremony, emptySections);
  assert.equal(r.done, 0);
  assert.equal(r.total, READINESS_CHECKS.length);
  assert.ok(r.blocking.includes("kind"));
  assert.ok(r.blocking.includes("date"));
  assert.ok(r.blocking.includes("flow"));
  assert.ok(r.counsel.includes("music"));
  assert.ok(r.counsel.includes("plan_b"));
});

test("a complete ceremony reads all set", () => {
  const r = ceremonyReadiness(fullCeremony, fullSections);
  assert.equal(r.missing, 0);
  assert.equal(r.blocking.length, 0);
  assert.equal(r.counsel.length, 0);
});

test("a mark of n/a removes the check from the count", () => {
  const r = ceremonyReadiness({ ...bareCeremony, checklist: { music: "na", plan_b: "na" } }, emptySections);
  assert.equal(r.total, READINESS_CHECKS.length - 2);
  assert.ok(!r.counsel.includes("music"));
});

test("a check promoted to required blocks when open", () => {
  const r = ceremonyReadiness({ ...fullCeremony, checklist: { readings: "required" } }, { ...fullSections, readings: [] });
  assert.deepEqual(r.blocking, ["readings"]);
});

test("duration sums the ACTIVE flow items alone (§8)", () => {
  assert.equal(
    flowDuration([
      { archived: false, duration_min: 10 },
      { archived: true, duration_min: 45 },
      { archived: false, duration_min: 5 },
      { archived: false, duration_min: null }
    ]),
    15
  );
});

test("an explicit duration satisfies the check; so does a timed flow", () => {
  assert.equal(checkDone("duration", { ...bareCeremony, duration_min: 25 }, emptySections), true);
  assert.equal(checkDone("duration", bareCeremony, fullSections), true);
  assert.equal(checkDone("duration", bareCeremony, emptySections), false);
});

test("logistics are ready only when nothing stays open (§12)", () => {
  assert.equal(checkDone("logistics", bareCeremony, { ...emptySections, logistics: [{ id: "a", status: "open" }] }), false);
  assert.equal(checkDone("logistics", bareCeremony, { ...emptySections, logistics: [{ id: "a", status: "ready" }] }), true);
  assert.equal(checkDone("logistics", bareCeremony, emptySections), false);
});

test("the house's template flow carries titles, types and minutes", () => {
  assert.ok(TEMPLATE_FLOW.length >= 8);
  for (const b of TEMPLATE_FLOW) {
    assert.ok(b.title.length > 0);
    assert.ok(b.block_type.length > 0);
    assert.ok(b.duration_min > 0);
  }
});
