// The Wedding Moments registry's pure rules (PRD Moments) — one
// canonical list, duplicates named, deletion reserved, legacy labels
// judged and never guessed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import os from "node:os";
import ts from "typescript";

const src = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/lib/moments.ts"),
  "utf8"
);
const { outputText: code } = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
});
const tmp = mkdtempSync(path.join(os.tmpdir(), "moments-"));
const mod = path.join(tmp, "moments.mjs");
writeFileSync(mod, code);
const {
  activeMoments, findDuplicateMoment, canDeleteMoment, totalReferences,
  nextMoment, mapLegacyLabel
} = await import(pathToFileURL(mod).href);

const m = (over = {}) => ({
  id: "m1", name: "Welcome", event_date: "2027-09-03", sort: 1, archived: false, ...over
});

test("the dropdowns speak only the living registry, in order", () => {
  const list = [
    m({ id: "b", name: "B", sort: 2 }),
    m({ id: "x", name: "X", archived: true, sort: 0 }),
    m({ id: "a", name: "A", sort: 1 })
  ];
  assert.deepEqual(activeMoments(list).map((x) => x.id), ["a", "b"]);
});

test("a possible duplicate is named — same name, or same date and type (§15)", () => {
  const list = [m(), m({ id: "m2", name: "Dinner", event_date: "2027-09-04", event_type: "dinner" })];
  assert.equal(findDuplicateMoment(list, { name: " welcome " })?.id, "m1");
  assert.equal(findDuplicateMoment(list, { name: "Grand dinner", date: "2027-09-04", kind: "dinner" })?.id, "m2");
  assert.equal(findDuplicateMoment(list, { name: "Brunch" }), null);
  // an archived namesake never blocks a new moment
  assert.equal(findDuplicateMoment([m({ archived: true })], { name: "Welcome" }), null);
  // editing a row never collides with itself
  assert.equal(findDuplicateMoment(list, { name: "Welcome" }, "m1"), null);
});

test("delete is reserved for a moment nothing points at (§16)", () => {
  const zero = { milestones: 0, ceremonies: 0, budgetLines: 0, runSheets: 0, guests: 0, links: 0 };
  assert.ok(canDeleteMoment(zero));
  assert.equal(totalReferences(zero), 0);
  const some = { ...zero, budgetLines: 2, guests: 5 };
  assert.ok(!canDeleteMoment(some));
  assert.equal(totalReferences(some), 7);
});

test("Home reads the next moment on the calendar (§12)", () => {
  const list = [
    m({ id: "past", name: "Past", event_date: "2026-01-01" }),
    m({ id: "far", name: "Far", event_date: "2027-09-05", sort: 3 }),
    m({ id: "next", name: "Next", event_date: "2027-09-03", sort: 2 }),
    m({ id: "arch", name: "Arch", event_date: "2027-01-01", archived: true })
  ];
  assert.equal(nextMoment(list, "2026-08-02")?.id, "next");
  assert.equal(nextMoment([m({ event_date: null })], "2026-08-02"), null);
});

test("legacy labels are judged, never guessed (§17)", () => {
  const list = [m(), m({ id: "m2", name: "Welcome dinner" }), m({ id: "m3", name: "Brunch" })];
  assert.equal(mapLegacyLabel(list, "brunch").verdict, "mapped");
  assert.equal(mapLegacyLabel(list, "Welcome").verdict, "mapped"); // exact beats partial
  assert.equal(mapLegacyLabel(list, "dinner").verdict, "mapped"); // one partial match
  assert.equal(mapLegacyLabel([m(), m({ id: "m2", name: "welcome" })], "Welcome").verdict, "ambiguous");
  assert.equal(mapLegacyLabel(list, "Fireworks").verdict, "unmatched");
  assert.equal(mapLegacyLabel(list, "  ").verdict, "unmatched");
});
