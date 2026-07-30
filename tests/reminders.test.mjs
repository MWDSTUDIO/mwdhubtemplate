// The reminder rules, tested and not merely intended
// (notifications brief, Part I §1) — npm run test:reminders
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import os from "node:os";
import ts from "typescript";

const src = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/lib/reminders-logic.ts"),
  "utf8"
);
const { outputText: code } = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
});
const tmp = mkdtempSync(path.join(os.tmpdir(), "reminders-"));
const mod = path.join(tmp, "reminders-logic.mjs");
writeFileSync(mod, code);
const { addDays, reminderTargetDate, isDue, reminderChannels, reminderHold, groupKey } =
  await import(pathToFileURL(mod).href);

test("calendar arithmetic crosses months and years", () => {
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(addDays("2028-03-01", -1), "2028-02-29"); // leap
  assert.equal(addDays("2026-12-25", 10), "2027-01-04");
  assert.equal(addDays("2026-07-30", 0), "2026-07-30");
});

test("target: J−30, J+7, any combination — negative is before", () => {
  assert.equal(reminderTargetDate({ offset_days: -30, fixed_date: null }, "2026-10-15"), "2026-09-15");
  assert.equal(reminderTargetDate({ offset_days: 7, fixed_date: null }, "2026-10-15"), "2026-10-22");
  assert.equal(reminderTargetDate({ offset_days: 0, fixed_date: null }, "2026-10-15"), "2026-10-15");
});

test("a fixed date takes precedence; nothing anchors to nothing", () => {
  assert.equal(
    reminderTargetDate({ offset_days: -30, fixed_date: "2026-09-01" }, "2026-10-15"),
    "2026-09-01"
  );
  assert.equal(reminderTargetDate({ offset_days: -30, fixed_date: null }, null), null);
  assert.equal(reminderTargetDate({ offset_days: null, fixed_date: null }, "2026-10-15"), null);
});

test("due today — or overdue and never sent, which still speaks once", () => {
  assert.equal(isDue("2026-07-30", "2026-07-30"), true);
  assert.equal(isDue("2026-07-01", "2026-07-30"), true); // a missed day
  assert.equal(isDue("2026-08-01", "2026-07-30"), false);
  assert.equal(isDue(null, "2026-07-30"), false);
});

test("channels expand: both = email + hub", () => {
  assert.deepEqual(reminderChannels("both"), ["email", "in_app"]);
  assert.deepEqual(reminderChannels("email"), ["email"]);
  assert.deepEqual(reminderChannels("in_app"), ["in_app"]);
});

test("the locks: settled cancels, draft holds, unverified banking suspends", () => {
  const base = { paidAt: null, lineStatus: "published", bankingState: "verified" };
  assert.equal(reminderHold(base), null);
  assert.equal(reminderHold({ ...base, paidAt: "2026-07-01" }), "settled");
  assert.equal(reminderHold({ ...base, lineStatus: "draft" }), "draft_line");
  assert.equal(reminderHold({ ...base, bankingState: "unverified" }), "banking");
  assert.equal(reminderHold({ ...base, bankingState: "changed" }), "banking");
  // settled wins over everything: cancelled, not suspended.
  assert.equal(
    reminderHold({ paidAt: "2026-07-01", lineStatus: "draft", bankingState: "changed" }),
    "settled"
  );
});

test("no vendor attached: nothing to verify, no banking hold", () => {
  assert.equal(
    reminderHold({ paidAt: null, lineStatus: "published", bankingState: null }),
    null
  );
  // …but a payment without a line at all is not held as draft either.
  assert.equal(reminderHold({ paidAt: null, lineStatus: null, bankingState: null }), null);
});

test("same day, same wedding — one message: the group key agrees", () => {
  assert.equal(groupKey("w1", "2026-07-30"), groupKey("w1", "2026-07-30"));
  assert.notEqual(groupKey("w1", "2026-07-30"), groupKey("w1", "2026-07-31"));
  assert.notEqual(groupKey("w1", "2026-07-30"), groupKey("w2", "2026-07-30"));
});
