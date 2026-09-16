import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createAyasMicroItemStore, AyasMicroItemStoreError, type AyasMicroItem } from "../src/lib/brain/autonomy/AyasMicroItem";

let count = 0;
function scenario(name: string, fn: () => void) { fn(); count += 1; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }
function root() { return fs.mkdtempSync(path.join(os.tmpdir(), "ayas-micro-item-")); }

function baseInput(overrides: Partial<Omit<AyasMicroItem, "schemaVersion" | "microItemId" | "state" | "lastUpdatedAt">> = {}): Omit<AyasMicroItem, "schemaVersion" | "microItemId" | "state" | "lastUpdatedAt"> {
  return {
    discoveryClass: "error-code-contract-gap",
    semanticKey: "ayas-novel-fixture",
    baseHead: "abc123",
    patchArtifactId: "ayas-patch-artifact-fixture",
    patchHash: "fixturehash",
    exactFiles: ["scripts/smoke-fixture.ts"],
    validatorScripts: ["scripts/smoke-fixture.ts"],
    safetyClassification: "SAFE",
    graphifyEvidence: ["e"],
    reason: "fixture reason",
    expectedBenefit: "fixture benefit",
    risk: "low",
    generatedAt: "2026-09-16T00:00:00.000Z",
    validatedAt: "2026-09-16T00:00:01.000Z",
    ...overrides,
  };
}

scenario("create persists a DISCOVERED item and load returns it", () => {
  const store = createAyasMicroItemStore({ rootDir: root() });
  const item = store.create(baseInput());
  assert.equal(item.state, "DISCOVERED");
  const loaded = store.load(item.microItemId);
  assert.deepEqual(loaded, item);
});

scenario("load throws AYAS_MICRO_ITEM_NOT_FOUND for an unknown id", () => {
  const store = createAyasMicroItemStore({ rootDir: root() });
  assert.throws(() => store.load("ayas-micro-item-does-not-exist"), (e: unknown) => e instanceof AyasMicroItemStoreError && e.code === "AYAS_MICRO_ITEM_NOT_FOUND");
});

scenario("list returns every created item", () => {
  const store = createAyasMicroItemStore({ rootDir: root() });
  store.create(baseInput({ semanticKey: "a" }));
  store.create(baseInput({ semanticKey: "b" }));
  assert.equal(store.list().length, 2);
});

scenario("findBySemanticKey finds items regardless of state, dedup lookup", () => {
  const store = createAyasMicroItemStore({ rootDir: root() });
  const item = store.create(baseInput({ semanticKey: "target-key" }));
  store.create(baseInput({ semanticKey: "other-key" }));
  const hits = store.findBySemanticKey("target-key");
  assert.equal(hits.length, 1);
  assert.equal(hits[0]!.microItemId, item.microItemId);
});

scenario("valid transition DISCOVERED -> SANDBOX_VALIDATED -> BATCHED -> EXECUTED succeeds at each step", () => {
  const store = createAyasMicroItemStore({ rootDir: root() });
  const item = store.create(baseInput());
  const v = store.transition(item.microItemId, "SANDBOX_VALIDATED", "2026-09-16T00:01:00.000Z");
  assert.equal(v.state, "SANDBOX_VALIDATED");
  const b = store.transition(item.microItemId, "BATCHED", "2026-09-16T00:02:00.000Z", { batchId: "ayas-micro-batch-fixture" });
  assert.equal(b.state, "BATCHED");
  assert.equal(b.batchId, "ayas-micro-batch-fixture");
  const e = store.transition(item.microItemId, "EXECUTED", "2026-09-16T00:03:00.000Z");
  assert.equal(e.state, "EXECUTED");
});

scenario("an invalid transition (DISCOVERED -> BATCHED, skipping SANDBOX_VALIDATED) is refused", () => {
  const store = createAyasMicroItemStore({ rootDir: root() });
  const item = store.create(baseInput());
  assert.throws(() => store.transition(item.microItemId, "BATCHED", "2026-09-16T00:01:00.000Z"), (e: unknown) => e instanceof AyasMicroItemStoreError && e.code === "AYAS_MICRO_ITEM_INVALID_TRANSITION");
});

scenario("a terminal state (EXECUTED) accepts no further transition", () => {
  const store = createAyasMicroItemStore({ rootDir: root() });
  const item = store.create(baseInput());
  store.transition(item.microItemId, "SANDBOX_VALIDATED", "2026-09-16T00:01:00.000Z");
  store.transition(item.microItemId, "BATCHED", "2026-09-16T00:02:00.000Z");
  store.transition(item.microItemId, "EXECUTED", "2026-09-16T00:03:00.000Z");
  assert.throws(() => store.transition(item.microItemId, "SUPERSEDED", "2026-09-16T00:04:00.000Z"), (e: unknown) => e instanceof AyasMicroItemStoreError && e.code === "AYAS_MICRO_ITEM_INVALID_TRANSITION");
});

scenario("REJECTED and SUPERSEDED are both terminal — no further transition from either", () => {
  const store = createAyasMicroItemStore({ rootDir: root() });
  const rejected = store.create(baseInput({ semanticKey: "r" }));
  store.transition(rejected.microItemId, "REJECTED", "2026-09-16T00:01:00.000Z");
  assert.throws(() => store.transition(rejected.microItemId, "DISCOVERED", "2026-09-16T00:02:00.000Z"));

  const superseded = store.create(baseInput({ semanticKey: "s" }));
  store.transition(superseded.microItemId, "SUPERSEDED", "2026-09-16T00:01:00.000Z");
  assert.throws(() => store.transition(superseded.microItemId, "DISCOVERED", "2026-09-16T00:02:00.000Z"));
});

scenario("two items with different semanticKey are independent — no dedup collision", () => {
  const store = createAyasMicroItemStore({ rootDir: root() });
  const a = store.create(baseInput({ semanticKey: "a" }));
  const b = store.create(baseInput({ semanticKey: "b" }));
  assert.notEqual(a.microItemId, b.microItemId);
  assert.equal(store.list().length, 2);
});

scenario("a fresh store reading the same rootDir sees items created by an earlier store instance — cross-restart durability", () => {
  const dir = root();
  const store1 = createAyasMicroItemStore({ rootDir: dir });
  const item = store1.create(baseInput());
  const store2 = createAyasMicroItemStore({ rootDir: dir });
  assert.deepEqual(store2.load(item.microItemId), item);
});

console.log(`AYAS micro item smoke: PASS (${count} scenarios)`);
console.log(JSON.stringify({ status: "PASS", suite: "ayas-micro-item", scenarios: count }));
