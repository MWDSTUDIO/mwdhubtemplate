// Home's aggregations (PRD Home): derived, never invented — and Home
// owns nothing but its presentation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import os from "node:os";
import ts from "typescript";

const src = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/lib/home.ts"),
  "utf8"
);
const { outputText: code } = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
});
const tmp = mkdtempSync(path.join(os.tmpdir(), "home-"));
const mod = path.join(tmp, "home.mjs");
writeFileSync(mod, code);
const {
  HOME_SECTIONS, sectionOrder, isHidden, timelineProgress, rsvpAggregate,
  vendorBuckets, clientSentenceKey, teamPriorities
} = await import(pathToFileURL(mod).href);

test("progress is derived from actual completion — empty means zero, never invented", () => {
  assert.deepEqual(timelineProgress([]), { done: 0, total: 0, pct: 0 });
  assert.deepEqual(timelineProgress([{ done: true }, { done: false }, { done: true }, { done: false }]), {
    done: 2, total: 4, pct: 50
  });
});

test("rsvp aggregate: 'invited' and unknown read as pending", () => {
  const r = rsvpAggregate(["attending", "attending", "declined", "pending", "invited"]);
  assert.deepEqual(r, { attending: 2, declined: 1, pending: 2, total: 5 });
});

test("vendor buckets fold the full pipeline into four counts", () => {
  const b = vendorBuckets(["contracted", "completed", "selected", "shortlisted", "in_review", "proposal", "scouted", "contacted"]);
  assert.deepEqual(b, { total: 8, contracted: 2, selected: 2, inReview: 2, awaiting: 2 });
});

test("the couple's sentence follows the open attentions", () => {
  assert.equal(clientSentenceKey(0), "calm");
  assert.equal(clientSentenceKey(1), "one");
  assert.equal(clientSentenceKey(3), "several");
});

test("team priorities: only what exists, each linking to its source", () => {
  const p = teamPriorities({
    overdueMilestones: 2, ceremonyBlockers: 0, overduePayments: 1,
    vendorsInReview: 0, boardsAwaiting: 3, formsOpen: 0, attentionsAwaiting: 0
  });
  assert.deepEqual(p.map((x) => x.key), ["overdueMilestones", "overduePayments", "boardsAwaiting"]);
  assert.ok(p.every((x) => x.href.startsWith("/")));
});

test("section order honours the config, appends the missing, drops the unknown", () => {
  const order = sectionOrder({ order: ["budget", "made-up", "pulse"] });
  assert.equal(order[0], "budget");
  assert.equal(order[1], "pulse");
  assert.equal(order.length, HOME_SECTIONS.length);
  assert.ok(!order.includes("made-up"));
});

test("visibility: hidden hides, absent shows", () => {
  assert.equal(isHidden({ hidden: ["design"] }, "design"), true);
  assert.equal(isHidden({}, "design"), false);
});
