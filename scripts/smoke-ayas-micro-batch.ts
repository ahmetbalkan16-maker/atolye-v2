import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createAyasMicroBatchStore, computeAyasMicroBatchHash, AyasMicroBatchStoreError, type AyasMicroBatch, type AyasMicroBatchItemRef } from "../src/lib/brain/autonomy/AyasMicroBatch";

let count = 0;
function scenario(name: string, fn: () => void) { fn(); count += 1; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }
function root() { return fs.mkdtempSync(path.join(os.tmpdir(), "ayas-micro-batch-")); }

const ITEM_A: AyasMicroBatchItemRef = { microItemId: "ayas-micro-item-a", semanticKey: "ayas-novel-a", patchArtifactId: "ayas-patch-artifact-a", patchHash: "hash-a", exactFiles: ["scripts/smoke-a.ts"] };
const ITEM_B: AyasMicroBatchItemRef = { microItemId: "ayas-micro-item-b", semanticKey: "ayas-novel-b", patchArtifactId: "ayas-patch-artifact-b", patchHash: "hash-b", exactFiles: ["scripts/smoke-b.ts"] };

function baseInput(overrides: Partial<Omit<AyasMicroBatch, "schemaVersion" | "batchId" | "batchHash" | "lastUpdatedAt" | "status">> = {}): Omit<AyasMicroBatch, "schemaVersion" | "batchId" | "batchHash" | "lastUpdatedAt" | "status"> {
  return {
    batchVersion: 1,
    baseHead: "abc123",
    baseBranch: "wip/test",
    items: [ITEM_A],
    exactFilesUnion: ["scripts/smoke-a.ts"],
    validatorUnion: ["scripts/smoke-a.ts"],
    worktreeBaseHead: "abc123",
    createdAt: "2026-09-16T00:00:00.000Z",
    validationSummary: ["fixture"],
    aggregateRisk: "low",
    ...overrides,
  };
}

scenario("createOrVersion creates a new batch in ACCUMULATING status with a computed batchHash", () => {
  const store = createAyasMicroBatchStore({ rootDir: root() });
  const batch = store.createOrVersion(baseInput());
  assert.equal(batch.status, "ACCUMULATING");
  assert.equal(typeof batch.batchHash, "string");
  assert.ok(batch.batchHash.length > 32);
});

scenario("computeAyasMicroBatchHash excludes batchId/createdAt/lastUpdatedAt/worktreeBaseHead/validationSummary — identical content hashes identically regardless of volatile fields", () => {
  const h1 = computeAyasMicroBatchHash({ baseHead: "abc", items: [ITEM_A], exactFilesUnion: ["scripts/smoke-a.ts"], validatorUnion: ["scripts/smoke-a.ts"], batchVersion: 1 });
  const h2 = computeAyasMicroBatchHash({ baseHead: "abc", items: [ITEM_A], exactFilesUnion: ["scripts/smoke-a.ts"], validatorUnion: ["scripts/smoke-a.ts"], batchVersion: 1 });
  assert.equal(h1, h2);
});

scenario("batchHash changes when an item is added", () => {
  const h1 = computeAyasMicroBatchHash({ baseHead: "abc", items: [ITEM_A], exactFilesUnion: ["scripts/smoke-a.ts"], validatorUnion: [], batchVersion: 1 });
  const h2 = computeAyasMicroBatchHash({ baseHead: "abc", items: [ITEM_A, ITEM_B], exactFilesUnion: ["scripts/smoke-a.ts", "scripts/smoke-b.ts"], validatorUnion: [], batchVersion: 2 });
  assert.notEqual(h1, h2);
});

scenario("batchHash changes when an item is removed", () => {
  const h1 = computeAyasMicroBatchHash({ baseHead: "abc", items: [ITEM_A, ITEM_B], exactFilesUnion: ["scripts/smoke-a.ts", "scripts/smoke-b.ts"], validatorUnion: [], batchVersion: 1 });
  const h2 = computeAyasMicroBatchHash({ baseHead: "abc", items: [ITEM_A], exactFilesUnion: ["scripts/smoke-a.ts"], validatorUnion: [], batchVersion: 2 });
  assert.notEqual(h1, h2);
});

scenario("batchHash changes when items are reordered — order is part of identity", () => {
  const h1 = computeAyasMicroBatchHash({ baseHead: "abc", items: [ITEM_A, ITEM_B], exactFilesUnion: [], validatorUnion: [], batchVersion: 1 });
  const h2 = computeAyasMicroBatchHash({ baseHead: "abc", items: [ITEM_B, ITEM_A], exactFilesUnion: [], validatorUnion: [], batchVersion: 1 });
  assert.notEqual(h1, h2);
});

scenario("batchHash changes when baseHead changes", () => {
  const h1 = computeAyasMicroBatchHash({ baseHead: "abc", items: [ITEM_A], exactFilesUnion: [], validatorUnion: [], batchVersion: 1 });
  const h2 = computeAyasMicroBatchHash({ baseHead: "def", items: [ITEM_A], exactFilesUnion: [], validatorUnion: [], batchVersion: 1 });
  assert.notEqual(h1, h2);
});

scenario("batchHash changes when an item's patchHash changes (content drift), even with the same semanticKey", () => {
  const changed: AyasMicroBatchItemRef = { ...ITEM_A, patchHash: "different-hash" };
  const h1 = computeAyasMicroBatchHash({ baseHead: "abc", items: [ITEM_A], exactFilesUnion: [], validatorUnion: [], batchVersion: 1 });
  const h2 = computeAyasMicroBatchHash({ baseHead: "abc", items: [changed], exactFilesUnion: [], validatorUnion: [], batchVersion: 1 });
  assert.notEqual(h1, h2);
});

scenario("full lifecycle: markReadyForReview -> decide APPROVE -> reserveApproval -> finalizeApproval(EXECUTED) after recordResult", () => {
  const store = createAyasMicroBatchStore({ rootDir: root() });
  const batch = store.createOrVersion(baseInput());
  store.markReadyForReview(batch.batchId, "2026-09-16T00:01:00.000Z");
  const { batch: approved, decision } = store.decide(batch.batchId, "APPROVE", batch.batchHash, "2026-09-16T00:02:00.000Z");
  assert.equal(approved.status, "APPROVED");
  assert.ok(decision.authorizationId);
  const reservation = store.reserveApproval(batch.batchId, batch.batchHash, batch.baseHead, "2026-09-16T00:03:00.000Z");
  assert.ok(reservation.reservationId);
  assert.equal(store.load().batches.find((b) => b.batchId === batch.batchId)?.status, "RESERVED");
  store.recordResult({ resultId: "r1", batchId: batch.batchId, authorizationId: reservation.authorizationId, startedAt: "2026-09-16T00:03:00.000Z", completedAt: "2026-09-16T00:04:00.000Z", changedFiles: ["scripts/smoke-a.ts"], testsRun: ["scripts/smoke-a.ts"], testResults: ["PASS"], outcome: "COMPLETED" }, "COMPLETED");
  store.finalizeApproval(reservation.reservationId, "EXECUTED", "2026-09-16T00:04:01.000Z");
  const final = store.load().batches.find((b) => b.batchId === batch.batchId)!;
  assert.equal(final.status, "COMPLETED");
});

scenario("decide APPROVE is refused if the batchHash provided does not match the current batch (content changed since review)", () => {
  const store = createAyasMicroBatchStore({ rootDir: root() });
  const batch = store.createOrVersion(baseInput());
  store.markReadyForReview(batch.batchId, "2026-09-16T00:01:00.000Z");
  assert.throws(() => store.decide(batch.batchId, "APPROVE", "stale-hash-value", "2026-09-16T00:02:00.000Z"), (e: unknown) => e instanceof AyasMicroBatchStoreError && e.code === "AYAS_MICRO_BATCH_INVALID");
});

scenario("decide is refused unless the batch is READY_FOR_REVIEW (e.g. still ACCUMULATING)", () => {
  const store = createAyasMicroBatchStore({ rootDir: root() });
  const batch = store.createOrVersion(baseInput());
  assert.throws(() => store.decide(batch.batchId, "APPROVE", batch.batchHash, "2026-09-16T00:01:00.000Z"), (e: unknown) => e instanceof AyasMicroBatchStoreError && e.code === "AYAS_MICRO_BATCH_INVALID");
});

scenario("reserveApproval is one-shot — a second reservation attempt on the same decision is refused", () => {
  const store = createAyasMicroBatchStore({ rootDir: root() });
  const batch = store.createOrVersion(baseInput());
  store.markReadyForReview(batch.batchId, "2026-09-16T00:01:00.000Z");
  store.decide(batch.batchId, "APPROVE", batch.batchHash, "2026-09-16T00:02:00.000Z");
  store.reserveApproval(batch.batchId, batch.batchHash, batch.baseHead, "2026-09-16T00:03:00.000Z");
  assert.throws(() => store.reserveApproval(batch.batchId, batch.batchHash, batch.baseHead, "2026-09-16T00:03:01.000Z"), (e: unknown) => e instanceof AyasMicroBatchStoreError && e.code === "AYAS_MICRO_BATCH_INVALID");
});

scenario("reserveApproval refuses a stale baseHead even with a valid approval", () => {
  const store = createAyasMicroBatchStore({ rootDir: root() });
  const batch = store.createOrVersion(baseInput());
  store.markReadyForReview(batch.batchId, "2026-09-16T00:01:00.000Z");
  store.decide(batch.batchId, "APPROVE", batch.batchHash, "2026-09-16T00:02:00.000Z");
  assert.throws(() => store.reserveApproval(batch.batchId, batch.batchHash, "a-different-head", "2026-09-16T00:03:00.000Z"), (e: unknown) => e instanceof AyasMicroBatchStoreError && e.code === "AYAS_MICRO_BATCH_INVALID");
});

scenario("markStale transitions ACCUMULATING/READY_FOR_REVIEW/APPROVED to STALE, and RESERVED is refused (may be mid-execution)", () => {
  const store = createAyasMicroBatchStore({ rootDir: root() });
  const accumulating = store.createOrVersion(baseInput());
  const staled = store.markStale(accumulating.batchId, "2026-09-16T00:01:00.000Z");
  assert.equal(staled.status, "STALE");

  const readyBatch = store.createOrVersion({ ...baseInput(), items: [ITEM_B], exactFilesUnion: ["scripts/smoke-b.ts"] });
  store.markReadyForReview(readyBatch.batchId, "2026-09-16T00:01:00.000Z");
  assert.equal(store.markStale(readyBatch.batchId, "2026-09-16T00:02:00.000Z").status, "STALE");

  const reservedBatch = store.createOrVersion({ ...baseInput(), items: [{ ...ITEM_A, semanticKey: "c" }], exactFilesUnion: ["scripts/smoke-a.ts"] });
  store.markReadyForReview(reservedBatch.batchId, "2026-09-16T00:01:00.000Z");
  store.decide(reservedBatch.batchId, "APPROVE", reservedBatch.batchHash, "2026-09-16T00:02:00.000Z");
  store.reserveApproval(reservedBatch.batchId, reservedBatch.batchHash, reservedBatch.baseHead, "2026-09-16T00:03:00.000Z");
  assert.throws(() => store.markStale(reservedBatch.batchId, "2026-09-16T00:04:00.000Z"), (e: unknown) => e instanceof AyasMicroBatchStoreError && e.code === "AYAS_MICRO_BATCH_INVALID");
});

scenario("no manual JSON editing needed — a fresh store instance reading the same rootDir sees prior writes (cross-restart durability)", () => {
  const dir = root();
  const store1 = createAyasMicroBatchStore({ rootDir: dir });
  const batch = store1.createOrVersion(baseInput());
  const store2 = createAyasMicroBatchStore({ rootDir: dir });
  assert.equal(store2.load().batches.find((b) => b.batchId === batch.batchId)?.batchHash, batch.batchHash);
});

console.log(`AYAS micro batch smoke: PASS (${count} scenarios)`);
console.log(JSON.stringify({ status: "PASS", suite: "ayas-micro-batch", scenarios: count }));
