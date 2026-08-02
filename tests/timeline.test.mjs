// The Timeline's sync anchor (PRD Timeline §11–§15): one (source,
// source_id) → one milestone, updated in place — never a duplicate;
// silent before migration 0029.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import os from "node:os";
import ts from "typescript";

const src = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/lib/timeline-sync.ts"),
  "utf8"
);
const { outputText: code } = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
});
const tmp = mkdtempSync(path.join(os.tmpdir(), "tlsync-"));
const mod = path.join(tmp, "timeline-sync.mjs");
writeFileSync(mod, code);
const { syncModuleMilestone } = await import(pathToFileURL(mod).href);

/** A quiet double of the supabase client — records every gesture. */
function stubClient({ anchor }) {
  const calls = [];
  const table = (name) => {
    const q = {
      _name: name,
      _op: "select",
      _row: null,
      select() { return q; },
      eq() { return q; },
      insert(row) { q._op = "insert"; q._row = row; calls.push({ table: name, op: "insert", row }); return q; },
      update(row) { q._op = "update"; q._row = row; calls.push({ table: name, op: "update", row }); return q; },
      maybeSingle: async () =>
        name === "milestone_ops" && anchor ? { data: { milestone_id: anchor } } : { data: null },
      single: async () =>
        q._op === "insert" && name === "timeline_milestones"
          ? { data: { id: "new-milestone" }, error: null }
          : { data: null, error: null },
      then(resolve) { resolve({ data: null, error: null }); }
    };
    return q;
  };
  return { from: table, calls };
}

const input = {
  weddingId: "w1",
  source: "vendor",
  sourceId: "v1",
  label: "Maison L. — contracted",
  date: "2026-08-02",
  done: true,
  module: "vendors",
  vendorId: "v1"
};

test("no anchor → ONE milestone born draft, with its anchor", async () => {
  const client = stubClient({ anchor: null });
  const id = await syncModuleMilestone(client, input);
  assert.equal(id, "new-milestone");
  const inserts = client.calls.filter((c) => c.op === "insert");
  assert.equal(inserts.filter((c) => c.table === "timeline_milestones").length, 1);
  const m = inserts.find((c) => c.table === "timeline_milestones").row;
  assert.equal(m.status, "draft");
  assert.equal(m.month, "2026-08-01");
  assert.equal(m.done, true);
  const anchor = inserts.find((c) => c.table === "milestone_ops").row;
  assert.equal(anchor.source, "vendor");
  assert.equal(anchor.source_id, "v1");
  assert.equal(anchor.op_status, "completed");
});

test("anchor found → the SAME milestone updates; nothing is born", async () => {
  const client = stubClient({ anchor: "m-77" });
  const id = await syncModuleMilestone(client, { ...input, label: "Maison L. — completed" });
  assert.equal(id, "m-77");
  assert.equal(client.calls.filter((c) => c.op === "insert").length, 0);
  const updates = client.calls.filter((c) => c.op === "update");
  assert.ok(updates.some((c) => c.table === "timeline_milestones" && c.row.label === "Maison L. — completed"));
  assert.ok(updates.some((c) => c.table === "milestone_ops"));
});

test("pre-0029 (the anchor table throws) → silence, the caller stands", async () => {
  const broken = {
    from() { throw new Error("relation milestone_ops does not exist"); }
  };
  const id = await syncModuleMilestone(broken, input);
  assert.equal(id, null);
});
