import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createAyasGraphifyEvidenceStore, checkAyasItemWithGraphifyEvidenced } from "../src/lib/brain/autonomy/AyasGraphifyEvidenceStore";
import { AyasBatchGraphifyCheckError } from "../src/lib/brain/autonomy/AyasBatchGraphifyCheck";

/**
 * M19 — "Per-Item Graphify Durability Follow-up". Before this store, a
 * per-item Graphify check's PASS/FAIL result was never durably recorded —
 * only "the commit exists" was indirect, after-the-fact proof it didn't
 * fail. These scenarios prove: (1) the store itself is a genuine durable
 * append-only record, and (2) wrapping the real check with evidence
 * recording never changes its own throw/return behavior — a FAIL still
 * blocks publication exactly as before, evidence recording is purely
 * additive.
 */
let count = 0;
function scenario(name: string, fn: () => void) { fn(); count += 1; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }
function tmpDir(prefix: string) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }

scenario("record() writes a durable, retrievable PASS record with no absolute path leaked", () => {
  const store = createAyasGraphifyEvidenceStore({ rootDir: tmpDir("ayas-graphify-evidence-") });
  const record = store.record({ itemId: "item-1", file: "scripts/smoke-fixture.ts", startedAt: "2026-09-17T00:00:00.000Z", completedAt: "2026-09-17T00:00:01.000Z", outcome: "PASS", expectedImportCount: 2, actualImportCount: 2, nodeCount: 2, edgeCount: 4 });
  assert.ok(record.evidenceId.startsWith("ayas-graphify-evidence-"));
  const found = store.listForItem("item-1");
  assert.equal(found.length, 1);
  assert.equal(found[0]!.outcome, "PASS");
  assert.equal(found[0]!.file, "scripts/smoke-fixture.ts");
  assert.ok(!found[0]!.file.includes(":\\"), "evidence must carry a repo-relative path, never a machine-absolute one");
});

scenario("record() writes a durable FAIL record too, with the error code/message preserved", () => {
  const store = createAyasGraphifyEvidenceStore({ rootDir: tmpDir("ayas-graphify-evidence-") });
  store.record({ itemId: "item-2", file: "scripts/smoke-fixture.ts", startedAt: "2026-09-17T00:00:00.000Z", completedAt: "2026-09-17T00:00:01.000Z", outcome: "FAIL", expectedImportCount: 2, errorCode: "AYAS_GRAPHIFY_UNEXPECTED_DEPENDENCY", errorMessage: "mismatch" });
  const found = store.listForItem("item-2");
  assert.equal(found.length, 1);
  assert.equal(found[0]!.outcome, "FAIL");
  assert.equal(found[0]!.errorCode, "AYAS_GRAPHIFY_UNEXPECTED_DEPENDENCY");
});

scenario("listForItem never mixes evidence across different items", () => {
  const store = createAyasGraphifyEvidenceStore({ rootDir: tmpDir("ayas-graphify-evidence-") });
  store.record({ itemId: "item-a", file: "scripts/a.ts", startedAt: "t", completedAt: "t", outcome: "PASS", expectedImportCount: 1 });
  store.record({ itemId: "item-b", file: "scripts/b.ts", startedAt: "t", completedAt: "t", outcome: "PASS", expectedImportCount: 1 });
  assert.equal(store.listForItem("item-a").length, 1);
  assert.equal(store.listForItem("item-b").length, 1);
  assert.equal(store.listForItem("item-a")[0]!.file, "scripts/a.ts");
});

scenario("a corrupt evidence file never crashes listForItem — it's skipped, the rest still read (evidence, not an authority gate)", () => {
  const dir = tmpDir("ayas-graphify-evidence-");
  const store = createAyasGraphifyEvidenceStore({ rootDir: dir });
  store.record({ itemId: "item-c", file: "scripts/c.ts", startedAt: "t", completedAt: "t", outcome: "PASS", expectedImportCount: 1 });
  fs.writeFileSync(path.join(dir, "corrupt.json"), "{ not valid json", "utf8");
  const found = store.listForItem("item-c");
  assert.equal(found.length, 1);
});

scenario("listForItem returns [] for an item with no evidence yet, and for a store whose directory does not exist", () => {
  const store = createAyasGraphifyEvidenceStore({ rootDir: path.join(tmpDir("ayas-graphify-evidence-"), "never-created") });
  assert.deepEqual(store.listForItem("nothing"), []);
});

scenario("checkAyasItemWithGraphifyEvidenced records a FAIL and still re-throws when the real extraction fails (e.g. a nonexistent target file) — evidence recording never swallows the failure", () => {
  const store = createAyasGraphifyEvidenceStore({ rootDir: tmpDir("ayas-graphify-evidence-") });
  const repoRoot = tmpDir("ayas-graphify-evidence-repo-");
  assert.throws(
    () => checkAyasItemWithGraphifyEvidenced({ repoRoot, evidenceStore: store, itemId: "item-unavailable", file: "scripts/does-not-exist.ts", expectedImportCount: 2 }),
    (e: unknown) => e instanceof AyasBatchGraphifyCheckError,
  );
  const found = store.listForItem("item-unavailable");
  assert.equal(found.length, 1);
  assert.equal(found[0]!.outcome, "FAIL");
  assert.ok(found[0]!.errorCode);
});

scenario("checkAyasItemWithGraphifyEvidenced records a real PASS for a real file with the real Graphify extractor", () => {
  const repoRoot = tmpDir("ayas-graphify-evidence-real-");
  fs.mkdirSync(path.join(repoRoot, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, "scripts", "real.ts"), 'import assert from "node:assert/strict";\nassert.ok(true);\n', "utf8");
  const store = createAyasGraphifyEvidenceStore({ rootDir: tmpDir("ayas-graphify-evidence-") });
  const result = checkAyasItemWithGraphifyEvidenced({ repoRoot, evidenceStore: store, itemId: "item-real", file: "scripts/real.ts", expectedImportCount: 1 });
  assert.equal(result.importEdgeCount, 1);
  const found = store.listForItem("item-real");
  assert.equal(found.length, 1);
  assert.equal(found[0]!.outcome, "PASS");
  assert.equal(found[0]!.actualImportCount, 1);
});

console.log(`AYAS Graphify evidence store smoke: PASS (${count} scenarios)`);
console.log(JSON.stringify({ status: "PASS", suite: "ayas-graphify-evidence-store", scenarios: count }));
