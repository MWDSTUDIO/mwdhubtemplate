// The Forms card library's pure rules (PRD Forms) — visibility,
// publication, duplicates, import judgement. The provider keeps the
// answers; these tests keep the promises.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import os from "node:os";
import ts from "typescript";

const src = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/lib/forms.ts"),
  "utf8"
);
const { outputText: code } = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
});
const tmp = mkdtempSync(path.join(os.tmpdir(), "forms-"));
const mod = path.join(tmp, "forms.mjs");
writeFileSync(mod, code);
const {
  statusBucket, isOpenStatus, coupleCanSee, isInAppForm, validUrl,
  canPublish, duplicateUrlOf, isDueSoon, canDeleteDraft,
  validateImportRow, orderCards
} = await import(pathToFileURL(mod).href);

const card = (over = {}) => ({
  id: "f1", title: "Photography Direction", status: "shared",
  client_visible: true, archived: false, external_url: "https://hello.dubsado.com/f/1",
  ...over
});

test("statuses fold into buckets — legacy values included", () => {
  assert.equal(statusBucket("draft"), "internal");
  assert.equal(statusBucket("ready"), "internal");
  assert.equal(statusBucket("shared"), "open");
  assert.equal(statusBucket("awaiting"), "open");
  assert.equal(statusBucket("in_progress"), "open");
  assert.equal(statusBucket("submitted"), "done");
  assert.equal(statusBucket("completed"), "done");
  assert.equal(statusBucket("updated"), "done");
  assert.equal(statusBucket("to_come"), "upcoming");
  assert.ok(isOpenStatus("awaiting") && !isOpenStatus("draft"));
});

test("the couple sees published, visible, live cards only (§15)", () => {
  assert.ok(coupleCanSee(card()));
  assert.ok(!coupleCanSee(card({ status: "draft" })));
  assert.ok(!coupleCanSee(card({ status: "ready" })));
  assert.ok(!coupleCanSee(card({ archived: true })));
  assert.ok(!coupleCanSee(card({ client_visible: false })));
  // legacy rows (pre-0031 shapes) keep their couple visibility
  assert.ok(coupleCanSee({ id: "x", title: "T", status: "awaiting" }));
  assert.ok(coupleCanSee({ id: "x", title: "T", status: "to_come" }));
});

test("publishing demands a door — a valid URL or an in-app schema (§10)", () => {
  assert.ok(canPublish(card()).ok);
  assert.equal(canPublish(card({ title: " " })).reason, "title");
  assert.equal(canPublish(card({ external_url: "not a url" })).reason, "url");
  assert.equal(canPublish(card({ external_url: "ftp://x.com/f" })).reason, "url");
  assert.ok(canPublish(card({ external_url: null, schema: [{ name: "a", label: "A" }] })).ok);
});

test("in-app legacy forms are recognised and preserved", () => {
  assert.ok(isInAppForm({ id: "x", title: "T", status: "awaiting", schema: [{ name: "a" }] }));
  assert.ok(!isInAppForm(card({ schema: [{ name: "a" }] }))); // an external URL wins
  assert.ok(!isInAppForm({ id: "x", title: "T", status: "awaiting", schema: [] }));
});

test("URLs are judged strictly", () => {
  assert.ok(validUrl("https://forms.dubsado.com/x"));
  assert.ok(validUrl("http://example.org"));
  assert.ok(!validUrl("dubsado.com/x"));
  assert.ok(!validUrl(""));
  assert.ok(!validUrl(null));
  assert.ok(!validUrl("javascript:alert(1)"));
});

test("the same external door on two cards is named (§10)", () => {
  const forms = [card(), card({ id: "f2", external_url: "https://other.example/f" })];
  assert.equal(duplicateUrlOf(forms, "https://hello.dubsado.com/f/1/", "f9")?.id, "f1");
  assert.equal(duplicateUrlOf(forms, "HTTPS://HELLO.DUBSADO.COM/F/1")?.id, "f1");
  assert.equal(duplicateUrlOf(forms, "https://hello.dubsado.com/f/1", "f1"), null);
  assert.equal(duplicateUrlOf(forms, "https://fresh.example/f"), null);
});

test("due soon watches only open cards within the horizon", () => {
  const today = "2026-08-02";
  assert.ok(isDueSoon(card({ due_date: "2026-08-05" }), today));
  assert.ok(!isDueSoon(card({ due_date: "2026-09-20" }), today));
  assert.ok(!isDueSoon(card({ due_date: "2026-07-20" }), today));
  assert.ok(!isDueSoon(card({ due_date: "2026-08-05", status: "submitted" }), today));
});

test("delete is reserved for unshared drafts (§17)", () => {
  assert.ok(canDeleteDraft(card({ status: "draft", shared_at: null })));
  assert.ok(!canDeleteDraft(card({ status: "draft", shared_at: "2026-07-01" })));
  assert.ok(!canDeleteDraft(card({ status: "shared" })));
});

test("import lines are judged one by one (§25)", () => {
  assert.ok(validateImportRow({ title: "Floral Direction" }).ok);
  assert.equal(validateImportRow({ title: " " }).reason, "title");
  assert.equal(validateImportRow({ title: "X", external_url: "nope" }).reason, "url");
  assert.equal(validateImportRow({ title: "X", status: "banana" }).reason, "status");
  assert.ok(validateImportRow({ title: "X", status: "awaiting" }).ok);
});

test("cards keep their shelf order — category first, then sort", () => {
  const cats = [{ id: "c2", sort: 2 }, { id: "c1", sort: 1 }];
  const list = [
    { id: "a", title: "A", status: "draft", category_id: "c2", sort: 1 },
    { id: "b", title: "B", status: "draft", category_id: "c1", sort: 2 },
    { id: "c", title: "C", status: "draft", category_id: "c1", sort: 1 },
    { id: "d", title: "D", status: "draft", category_id: null, sort: 0 }
  ];
  assert.deepEqual(orderCards(list, cats).map((f) => f.id), ["c", "b", "a", "d"]);
});
