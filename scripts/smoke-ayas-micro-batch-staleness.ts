import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createAyasMicroBatchStore, type AyasMicroBatchStoreHandle, type AyasMicroBatchItemRef } from "../src/lib/brain/autonomy/AyasMicroBatch";
import { createAyasMicroItemStore, type AyasMicroItemStore } from "../src/lib/brain/autonomy/AyasMicroItem";
import { reconcileAyasMicroBatchStaleness, supersedeStaleBatchOrphans } from "../src/lib/brain/autonomy/AyasMicroBatchStaleness";

/**
 * M18 — dedicated coverage for `reconcileAyasMicroBatchStaleness`, the batch
 * analogue of the M17 DEFERRED-proposal-stale-lifecycle fix: a batch bound
 * to a `baseHead` the branch has since moved past must become STALE through
 * the canonical lifecycle, never stay silently re-approvable/re-executable.
 *
 * Also covers the orphan-item repair (found via live M18 acceptance): a
 * STALE batch's own member items must not remain stuck `BATCHED` forever —
 * they must transition to `SUPERSEDED`, idempotently and crash-safely,
 * freeing their `semanticKey` for rediscovery.
 */
let count = 0;
function scenario(name: string, fn: () => void) { fn(); count += 1; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }
function store(): AyasMicroBatchStoreHandle { return createAyasMicroBatchStore({ rootDir: fs.mkdtempSync(path.join(os.tmpdir(), "ayas-micro-staleness-")) }); }
function itemStore(): AyasMicroItemStore { return createAyasMicroItemStore({ rootDir: fs.mkdtempSync(path.join(os.tmpdir(), "ayas-micro-staleness-items-")) }); }

const ITEM: AyasMicroBatchItemRef = { microItemId: "ayas-micro-item-x", semanticKey: "ayas-novel-x", patchArtifactId: "ayas-patch-artifact-x", patchHash: "hash-x", exactFiles: ["scripts/smoke-x.ts"] };

function baseInput(overrides: Record<string, unknown> = {}) {
  return { batchVersion: 1, baseHead: "head-a", baseBranch: "wip/test", items: [ITEM], exactFilesUnion: ["scripts/smoke-x.ts"], validatorUnion: [], worktreeBaseHead: "head-a", createdAt: "2026-09-16T00:00:00.000Z", validationSummary: ["fixture"], aggregateRisk: "low", ...overrides };
}

/** Creates a REAL micro item (via the item store, not just a plain object) already transitioned to BATCHED — for scenarios that need `supersedeStaleBatchOrphans` to actually find and transition it. */
function makeBatchedItem(items: AyasMicroItemStore, semanticKey: string, now = "2026-09-16T00:00:00.000Z"): AyasMicroBatchItemRef {
  const created = items.create({
    discoveryClass: "error-code-contract-gap", semanticKey, baseHead: "head-a",
    patchArtifactId: `ayas-patch-artifact-${semanticKey}`, patchHash: `hash-${semanticKey}`, exactFiles: [`scripts/smoke-${semanticKey}.ts`],
    validatorScripts: [`scripts/smoke-${semanticKey}.ts`], safetyClassification: "SAFE", graphifyEvidence: ["fixture evidence"],
    reason: "fixture reason", expectedBenefit: "fixture benefit", risk: "low", generatedAt: now, validatedAt: now,
  });
  items.transition(created.microItemId, "SANDBOX_VALIDATED", now);
  items.transition(created.microItemId, "BATCHED", now);
  return { microItemId: created.microItemId, semanticKey, patchArtifactId: created.patchArtifactId, patchHash: created.patchHash, exactFiles: created.exactFiles };
}

function main(): void {
  scenario("an ACCUMULATING batch bound to a superseded baseHead becomes STALE", () => {
    const s = store();
    const batch = s.createOrVersion(baseInput() as never);
    const staled = reconcileAyasMicroBatchStaleness(s, itemStore(), "head-b", "2026-09-16T01:00:00.000Z");
    assert.equal(staled.length, 1);
    assert.equal(staled[0]!.batchId, batch.batchId);
    assert.equal(s.load().batches.find((b) => b.batchId === batch.batchId)!.status, "STALE");
  });

  scenario("a READY_FOR_REVIEW batch bound to a superseded baseHead becomes STALE", () => {
    const s = store();
    const batch = s.createOrVersion(baseInput() as never);
    s.markReadyForReview(batch.batchId, "2026-09-16T00:01:00.000Z");
    reconcileAyasMicroBatchStaleness(s, itemStore(), "head-b", "2026-09-16T01:00:00.000Z");
    assert.equal(s.load().batches.find((b) => b.batchId === batch.batchId)!.status, "STALE");
  });

  scenario("an APPROVED-but-not-yet-reserved batch bound to a superseded baseHead becomes STALE — the exact M17 DEFERRED-lifecycle incident class, applied at batch granularity", () => {
    const s = store();
    const batch = s.createOrVersion(baseInput() as never);
    s.markReadyForReview(batch.batchId, "2026-09-16T00:01:00.000Z");
    s.decide(batch.batchId, "APPROVE", batch.batchHash, "2026-09-16T00:02:00.000Z");
    reconcileAyasMicroBatchStaleness(s, itemStore(), "head-b", "2026-09-16T01:00:00.000Z");
    assert.equal(s.load().batches.find((b) => b.batchId === batch.batchId)!.status, "STALE");
  });

  scenario("a RESERVED batch (possibly mid-execution under the authority lock) is NEVER touched by reconciliation, even at a superseded baseHead", () => {
    const s = store();
    const batch = s.createOrVersion(baseInput() as never);
    s.markReadyForReview(batch.batchId, "2026-09-16T00:01:00.000Z");
    s.decide(batch.batchId, "APPROVE", batch.batchHash, "2026-09-16T00:02:00.000Z");
    s.reserveApproval(batch.batchId, batch.batchHash, batch.baseHead, "2026-09-16T00:03:00.000Z");
    const staled = reconcileAyasMicroBatchStaleness(s, itemStore(), "head-b", "2026-09-16T01:00:00.000Z");
    assert.equal(staled.length, 0);
    assert.equal(s.load().batches.find((b) => b.batchId === batch.batchId)!.status, "RESERVED");
  });

  scenario("a batch whose baseHead still matches currentHead is left untouched", () => {
    const s = store();
    const batch = s.createOrVersion(baseInput() as never);
    const staled = reconcileAyasMicroBatchStaleness(s, itemStore(), "head-a", "2026-09-16T01:00:00.000Z");
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
    const staled = reconcileAyasMicroBatchStaleness(s, itemStore(), "head-b", "2026-09-16T01:00:00.000Z");
    assert.equal(staled.length, 0);
    assert.equal(s.load().batches.find((b) => b.batchId === batch.batchId)!.status, "COMPLETED");
  });

  scenario("multiple stale-eligible batches at different statuses are all reconciled in one call", () => {
    const s = store();
    const accumulating = s.createOrVersion(baseInput({ items: [{ ...ITEM, semanticKey: "a" }] }) as never);
    const ready = s.createOrVersion(baseInput({ items: [{ ...ITEM, semanticKey: "b" }] }) as never);
    s.markReadyForReview(ready.batchId, "2026-09-16T00:01:00.000Z");
    const staled = reconcileAyasMicroBatchStaleness(s, itemStore(), "head-b", "2026-09-16T01:00:00.000Z");
    assert.equal(staled.length, 2);
    const staleIds = new Set(staled.map((b) => b.batchId));
    assert.ok(staleIds.has(accumulating.batchId));
    assert.ok(staleIds.has(ready.batchId));
  });

  scenario("an empty store reconciles to zero staled batches without throwing", () => {
    const s = store();
    assert.deepEqual(reconcileAyasMicroBatchStaleness(s, itemStore(), "head-b", "2026-09-16T01:00:00.000Z"), []);
  });

  scenario("reconciliation is idempotent — calling it twice at the same superseded head does not throw or double-transition", () => {
    const s = store();
    const batch = s.createOrVersion(baseInput() as never);
    const items = itemStore();
    reconcileAyasMicroBatchStaleness(s, items, "head-b", "2026-09-16T01:00:00.000Z");
    const secondPass = reconcileAyasMicroBatchStaleness(s, items, "head-b", "2026-09-16T02:00:00.000Z");
    assert.equal(secondPass.length, 0, "an already-STALE batch is a terminal state and must not be reconciled again");
    assert.equal(s.load().batches.find((b) => b.batchId === batch.batchId)!.status, "STALE");
  });

  scenario("cross-restart durability: reconciliation via a FRESH store instance reading the same rootDir still finds and stales a superseded batch", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-micro-staleness-restart-"));
    const s1 = createAyasMicroBatchStore({ rootDir: dir });
    const batch = s1.createOrVersion(baseInput() as never);
    const s2 = createAyasMicroBatchStore({ rootDir: dir });
    const staled = reconcileAyasMicroBatchStaleness(s2, itemStore(), "head-b", "2026-09-16T01:00:00.000Z");
    assert.equal(staled.length, 1);
    assert.equal(staled[0]!.batchId, batch.batchId);
  });

  // --- orphan-item repair: supersedeStaleBatchOrphans / reconcileAyasMicroBatchStaleness ---

  scenario("a stale batch's BATCHED member item transitions to SUPERSEDED", () => {
    const s = store();
    const items = itemStore();
    const ref = makeBatchedItem(items, "ayas-novel-x");
    s.createOrVersion(baseInput({ items: [ref], exactFilesUnion: ref.exactFiles }) as never);
    reconcileAyasMicroBatchStaleness(s, items, "head-b", "2026-09-16T01:00:00.000Z");
    assert.equal(items.load(ref.microItemId).state, "SUPERSEDED");
  });

  scenario("multiple BATCHED items in the same stale batch are ALL superseded", () => {
    const s = store();
    const items = itemStore();
    const refA = makeBatchedItem(items, "ayas-novel-a");
    const refB = makeBatchedItem(items, "ayas-novel-b");
    s.createOrVersion(baseInput({ items: [refA, refB], exactFilesUnion: [...refA.exactFiles, ...refB.exactFiles] }) as never);
    reconcileAyasMicroBatchStaleness(s, items, "head-b", "2026-09-16T01:00:00.000Z");
    assert.equal(items.load(refA.microItemId).state, "SUPERSEDED");
    assert.equal(items.load(refB.microItemId).state, "SUPERSEDED");
  });

  scenario("an item already SUPERSEDED before reconciliation is left alone — no throw, no double-transition", () => {
    const s = store();
    const items = itemStore();
    const ref = makeBatchedItem(items, "ayas-novel-x");
    items.transition(ref.microItemId, "SUPERSEDED", "2026-09-16T00:30:00.000Z");
    s.createOrVersion(baseInput({ items: [ref], exactFilesUnion: ref.exactFiles }) as never);
    assert.doesNotThrow(() => reconcileAyasMicroBatchStaleness(s, items, "head-b", "2026-09-16T01:00:00.000Z"));
    assert.equal(items.load(ref.microItemId).state, "SUPERSEDED");
  });

  scenario("an item already REJECTED before reconciliation is left alone — the guarded transition never overwrites a later terminal state", () => {
    const s = store();
    const items = itemStore();
    const ref = makeBatchedItem(items, "ayas-novel-x");
    items.transition(ref.microItemId, "REJECTED", "2026-09-16T00:30:00.000Z");
    s.createOrVersion(baseInput({ items: [ref], exactFilesUnion: ref.exactFiles }) as never);
    reconcileAyasMicroBatchStaleness(s, items, "head-b", "2026-09-16T01:00:00.000Z");
    assert.equal(items.load(ref.microItemId).state, "REJECTED");
  });

  scenario("repeated reconciliation across ticks is idempotent for orphan items too — a second call never throws AYAS_MICRO_ITEM_INVALID_TRANSITION on an already-SUPERSEDED item", () => {
    const s = store();
    const items = itemStore();
    const ref = makeBatchedItem(items, "ayas-novel-x");
    s.createOrVersion(baseInput({ items: [ref], exactFilesUnion: ref.exactFiles }) as never);
    reconcileAyasMicroBatchStaleness(s, items, "head-b", "2026-09-16T01:00:00.000Z");
    assert.doesNotThrow(() => reconcileAyasMicroBatchStaleness(s, items, "head-b", "2026-09-16T02:00:00.000Z"));
    assert.doesNotThrow(() => reconcileAyasMicroBatchStaleness(s, items, "head-c", "2026-09-16T03:00:00.000Z"));
    assert.equal(items.load(ref.microItemId).state, "SUPERSEDED");
  });

  scenario("crash-safe convergence: a batch already marked STALE by a PRIOR, interrupted call (items never superseded) still gets its orphans fixed on the NEXT call — proves this is not a one-shot side effect of markStale itself", () => {
    const s = store();
    const items = itemStore();
    const ref = makeBatchedItem(items, "ayas-novel-x");
    const batch = s.createOrVersion(baseInput({ items: [ref], exactFilesUnion: ref.exactFiles }) as never);
    // Simulate the "crashed between batch-staled and items-superseded" window directly:
    // mark the batch STALE WITHOUT going through reconcileAyasMicroBatchStaleness at all.
    s.markStale(batch.batchId, "2026-09-16T00:30:00.000Z");
    assert.equal(items.load(ref.microItemId).state, "BATCHED", "sanity: the item is still orphaned before recovery runs");
    // A later, ordinary reconciliation call (e.g. the next observer tick after a restart) must find and fix it.
    reconcileAyasMicroBatchStaleness(s, items, "head-b", "2026-09-16T01:00:00.000Z");
    assert.equal(items.load(ref.microItemId).state, "SUPERSEDED");
  });

  scenario("supersedeStaleBatchOrphans is directly callable and safe against a missing item file — a deleted/corrupt item record never aborts reconciliation for the rest of the batch", () => {
    const s = store();
    const items = itemStore();
    const missingRef: AyasMicroBatchItemRef = { microItemId: "ayas-micro-item-does-not-exist", semanticKey: "ayas-novel-missing", patchArtifactId: "x", patchHash: "x", exactFiles: ["scripts/smoke-missing.ts"] };
    const realRef = makeBatchedItem(items, "ayas-novel-real");
    const batch = s.createOrVersion(baseInput({ items: [missingRef, realRef], exactFilesUnion: [...missingRef.exactFiles, ...realRef.exactFiles] }) as never);
    s.markStale(batch.batchId, "2026-09-16T00:30:00.000Z");
    assert.doesNotThrow(() => supersedeStaleBatchOrphans(s, items, "2026-09-16T01:00:00.000Z"));
    assert.equal(items.load(realRef.microItemId).state, "SUPERSEDED", "the real item must still be superseded despite the missing sibling");
  });

  scenario("historical evidence preserved: the stale batch's own item references (microItemIds, patchHashes, exactFiles) are unchanged after orphan supersession — no deletion, no rewrite of the batch record itself", () => {
    const s = store();
    const items = itemStore();
    const ref = makeBatchedItem(items, "ayas-novel-x");
    const batch = s.createOrVersion(baseInput({ items: [ref], exactFilesUnion: ref.exactFiles }) as never);
    reconcileAyasMicroBatchStaleness(s, items, "head-b", "2026-09-16T01:00:00.000Z");
    const finalBatch = s.load().batches.find((b) => b.batchId === batch.batchId)!;
    assert.deepEqual(finalBatch.items, [ref]);
    assert.equal(finalBatch.batchHash, batch.batchHash, "batchHash itself is never rewritten by reconciliation");
  });

  scenario("semanticKey is freed for rediscovery: after supersession, findBySemanticKey no longer reports the item as active (the exact predicate the accumulator's own cross-tick dedup uses)", () => {
    const s = store();
    const items = itemStore();
    const ref = makeBatchedItem(items, "ayas-novel-x");
    s.createOrVersion(baseInput({ items: [ref], exactFilesUnion: ref.exactFiles }) as never);
    const activeBefore = items.findBySemanticKey("ayas-novel-x").some((i) => i.state !== "REJECTED" && i.state !== "SUPERSEDED");
    assert.equal(activeBefore, true, "sanity: the item blocks rediscovery before reconciliation");
    reconcileAyasMicroBatchStaleness(s, items, "head-b", "2026-09-16T01:00:00.000Z");
    const activeAfter = items.findBySemanticKey("ayas-novel-x").some((i) => i.state !== "REJECTED" && i.state !== "SUPERSEDED");
    assert.equal(activeAfter, false, "the semanticKey must no longer be blocked once its only item is SUPERSEDED");
  });

  scenario("reconciliation never creates a decision, a result, or any authorization/execution side effect", () => {
    const s = store();
    const items = itemStore();
    const ref = makeBatchedItem(items, "ayas-novel-x");
    s.createOrVersion(baseInput({ items: [ref], exactFilesUnion: ref.exactFiles }) as never);
    reconcileAyasMicroBatchStaleness(s, items, "head-b", "2026-09-16T01:00:00.000Z");
    const state = s.load();
    assert.deepEqual(state.decisions, []);
    assert.deepEqual(state.results, []);
  });

  console.log(`AYAS micro batch staleness smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-micro-batch-staleness", scenarios: count }));
}
main();
