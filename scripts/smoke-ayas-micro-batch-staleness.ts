import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createAyasMicroBatchStore, type AyasMicroBatchStoreHandle, type AyasMicroBatchItemRef } from "../src/lib/brain/autonomy/AyasMicroBatch";
import { reconcileAyasMicroBatchStaleness } from "../src/lib/brain/autonomy/AyasMicroBatchStaleness";

/**
 * M18 — dedicated coverage for `reconcileAyasMicroBatchStaleness`, the batch
 * analogue of the M17 DEFERRED-proposal-stale-lifecycle fix: a batch bound
 * to a `baseHead` the branch has since moved past must become STALE through
 * the canonical lifecycle, never stay silently re-approvable/re-executable.
 */
let count = 0;
function scenario(name: string, fn: () => void) { fn(); count += 1; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }
function store(): AyasMicroBatchStoreHandle { return createAyasMicroBatchStore({ rootDir: fs.mkdtempSync(path.join(os.tmpdir(), "ayas-micro-staleness-")) }); }

const ITEM: AyasMicroBatchItemRef = { microItemId: "ayas-micro-item-x", semanticKey: "ayas-novel-x", patchArtifactId: "ayas-patch-artifact-x", patchHash: "hash-x", exactFiles: ["scripts/smoke-x.ts"] };

function baseInput(overrides: Record<string, unknown> = {}) {
  return { batchVersion: 1, baseHead: "head-a", baseBranch: "wip/test", items: [ITEM], exactFilesUnion: ["scripts/smoke-x.ts"], validatorUnion: [], worktreeBaseHead: "head-a", createdAt: "2026-09-16T00:00:00.000Z", validationSummary: ["fixture"], aggregateRisk: "low", ...overrides };
}

function main(): void {
  scenario("an ACCUMULATING batch bound to a superseded baseHead becomes STALE", () => {
    const s = store();
    const batch = s.createOrVersion(baseInput() as never);
    const staled = reconcileAyasMicroBatchStaleness(s, "head-b", "2026-09-16T01:00:00.000Z");
    assert.equal(staled.length, 1);
    assert.equal(staled[0]!.batchId, batch.batchId);
    assert.equal(s.load().batches.find((b) => b.batchId === batch.batchId)!.status, "STALE");
  });

  scenario("a READY_FOR_REVIEW batch bound to a superseded baseHead becomes STALE", () => {
    const s = store();
    const batch = s.createOrVersion(baseInput() as never);
    s.markReadyForReview(batch.batchId, "2026-09-16T00:01:00.000Z");
    reconcileAyasMicroBatchStaleness(s, "head-b", "2026-09-16T01:00:00.000Z");
    assert.equal(s.load().batches.find((b) => b.batchId === batch.batchId)!.status, "STALE");
  });

  scenario("an APPROVED-but-not-yet-reserved batch bound to a superseded baseHead becomes STALE — the exact M17 DEFERRED-lifecycle incident class, applied at batch granularity", () => {
    const s = store();
    const batch = s.createOrVersion(baseInput() as never);
    s.markReadyForReview(batch.batchId, "2026-09-16T00:01:00.000Z");
    s.decide(batch.batchId, "APPROVE", batch.batchHash, "2026-09-16T00:02:00.000Z");
    reconcileAyasMicroBatchStaleness(s, "head-b", "2026-09-16T01:00:00.000Z");
    assert.equal(s.load().batches.find((b) => b.batchId === batch.batchId)!.status, "STALE");
  });

  scenario("a RESERVED batch (possibly mid-execution under the authority lock) is NEVER touched by reconciliation, even at a superseded baseHead", () => {
    const s = store();
    const batch = s.createOrVersion(baseInput() as never);
    s.markReadyForReview(batch.batchId, "2026-09-16T00:01:00.000Z");
    s.decide(batch.batchId, "APPROVE", batch.batchHash, "2026-09-16T00:02:00.000Z");
    s.reserveApproval(batch.batchId, batch.batchHash, batch.baseHead, "2026-09-16T00:03:00.000Z");
    const staled = reconcileAyasMicroBatchStaleness(s, "head-b", "2026-09-16T01:00:00.000Z");
    assert.equal(staled.length, 0);
    assert.equal(s.load().batches.find((b) => b.batchId === batch.batchId)!.status, "RESERVED");
  });

  scenario("a batch whose baseHead still matches currentHead is left untouched", () => {
    const s = store();
    const batch = s.createOrVersion(baseInput() as never);
    const staled = reconcileAyasMicroBatchStaleness(s, "head-a", "2026-09-16T01:00:00.000Z");
    assert.equal(staled.length, 0);
    assert.equal(s.load().batches.find((b) => b.batchId === batch.batchId)!.status, "ACCUMULATING");
  });

  scenario("a terminal-state batch (COMPLETED) is never reconciled, even at a superseded baseHead", () => {
    const s = store();
    const batch = s.createOrVersion(baseInput() as never);
    s.markReadyForReview(batch.batchId, "2026-09-16T00:01:00.000Z");
    s.decide(batch.batchId, "APPROVE", batch.batchHash, "2026-09-16T00:02:00.000Z");
    const reservation = s.reserveApproval(batch.batchId, batch.batchHash, batch.baseHead, "2026-09-16T00:03:00.000Z");
    s.recordResult({ resultId: "r1", batchId: batch.batchId, authorizationId: reservation.authorizationId, startedAt: "2026-09-16T00:03:00.000Z", completedAt: "2026-09-16T00:04:00.000Z", changedFiles: ["scripts/smoke-x.ts"], testsRun: [], testResults: [], outcome: "COMPLETED" }, "COMPLETED");
    const staled = reconcileAyasMicroBatchStaleness(s, "head-b", "2026-09-16T01:00:00.000Z");
    assert.equal(staled.length, 0);
    assert.equal(s.load().batches.find((b) => b.batchId === batch.batchId)!.status, "COMPLETED");
  });

  scenario("multiple stale-eligible batches at different statuses are all reconciled in one call", () => {
    const s = store();
    const accumulating = s.createOrVersion(baseInput({ items: [{ ...ITEM, semanticKey: "a" }] }) as never);
    const ready = s.createOrVersion(baseInput({ items: [{ ...ITEM, semanticKey: "b" }] }) as never);
    s.markReadyForReview(ready.batchId, "2026-09-16T00:01:00.000Z");
    const staled = reconcileAyasMicroBatchStaleness(s, "head-b", "2026-09-16T01:00:00.000Z");
    assert.equal(staled.length, 2);
    const staleIds = new Set(staled.map((b) => b.batchId));
    assert.ok(staleIds.has(accumulating.batchId));
    assert.ok(staleIds.has(ready.batchId));
  });

  scenario("an empty store reconciles to zero staled batches without throwing", () => {
    const s = store();
    assert.deepEqual(reconcileAyasMicroBatchStaleness(s, "head-b", "2026-09-16T01:00:00.000Z"), []);
  });

  scenario("reconciliation is idempotent — calling it twice at the same superseded head does not throw or double-transition", () => {
    const s = store();
    const batch = s.createOrVersion(baseInput() as never);
    reconcileAyasMicroBatchStaleness(s, "head-b", "2026-09-16T01:00:00.000Z");
    const secondPass = reconcileAyasMicroBatchStaleness(s, "head-b", "2026-09-16T02:00:00.000Z");
    assert.equal(secondPass.length, 0, "an already-STALE batch is a terminal state and must not be reconciled again");
    assert.equal(s.load().batches.find((b) => b.batchId === batch.batchId)!.status, "STALE");
  });

  scenario("cross-restart durability: reconciliation via a FRESH store instance reading the same rootDir still finds and stales a superseded batch", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-micro-staleness-restart-"));
    const s1 = createAyasMicroBatchStore({ rootDir: dir });
    const batch = s1.createOrVersion(baseInput() as never);
    const s2 = createAyasMicroBatchStore({ rootDir: dir });
    const staled = reconcileAyasMicroBatchStaleness(s2, "head-b", "2026-09-16T01:00:00.000Z");
    assert.equal(staled.length, 1);
    assert.equal(staled[0]!.batchId, batch.batchId);
  });

  console.log(`AYAS micro batch staleness smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-micro-batch-staleness", scenarios: count }));
}
main();
