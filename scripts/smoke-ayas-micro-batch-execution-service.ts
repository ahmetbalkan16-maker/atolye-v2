import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { executeAyasApprovedMicroBatchWith, AyasMicroBatchExecutionError, mapBatchStatusToProposalStatus } from "../src/lib/brain/autonomy/AyasMicroBatchExecutionService";
import { createAyasMicroBatchStore, type AyasMicroBatchStoreHandle, type AyasMicroBatchItemRef } from "../src/lib/brain/autonomy/AyasMicroBatch";
import { createAyasMicroItemStore, type AyasMicroItemStore } from "../src/lib/brain/autonomy/AyasMicroItem";
import { createAyasPatchArtifactStore, type AyasPatchArtifactStore } from "../src/lib/brain/autonomy/AyasPatchArtifact";

/**
 * Isolated-fixture integration coverage for the M18 batch execution path —
 * same invariant as `smoke-ayas-patch-artifact-execution-integration.ts`: no
 * test here may ever touch the real `data/brain` or the real working tree.
 * Every repo, gate root, item store, batch store, and artifact store below
 * is a fresh temp directory.
 */
let count = 0;
function scenario(name: string, fn: () => void | Promise<void>) { return Promise.resolve(fn()).then(() => { count += 1; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }); }
function root() { return fs.mkdtempSync(path.join(os.tmpdir(), "ayas-micro-exec-")); }
function git(repoRoot: string, ...args: string[]) { return execFileSync("git", ["-C", repoRoot, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }

function repository(): { repoRoot: string; head: string } {
  const repoRoot = root();
  git(repoRoot, "init", "-q");
  git(repoRoot, "config", "user.email", "smoke@example.invalid");
  git(repoRoot, "config", "user.name", "Smoke");
  fs.mkdirSync(path.join(repoRoot, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, "scripts/existing.ts"), "export const value = 1;\n");
  git(repoRoot, "add", "-A");
  git(repoRoot, "commit", "-qm", "base");
  return { repoRoot, head: git(repoRoot, "rev-parse", "HEAD") };
}

function freezeArtifact(store: AyasPatchArtifactStore, overrides: Record<string, unknown> = {}) {
  const suffix = Math.random().toString(36).slice(2);
  return store.freeze({
    artifactId: `ayas-patch-artifact-${suffix}`,
    candidateId: `ayas-novel-fixture-${suffix}`,
    generatorIdentity: "ayas-detector:error-code-contract-gap-v1",
    baseBranch: "wip/test",
    baseHead: "will-be-overridden",
    exactFiles: [`scripts/smoke-fixture-generated-${suffix}.ts`],
    allowedRoots: ["scripts/"],
    replacements: [{ filePath: `scripts/smoke-fixture-generated-${suffix}.ts`, expectedHash: null, content: `console.log(JSON.stringify({ status: "PASS", suite: "fixture-generated-${suffix}", scenarios: 1 }));\n`, allowCreate: true }],
    validatorScripts: [],
    graphifyEvidence: ["fixture evidence"],
    safetyClassification: "SAFE",
    problemStatement: "fixture problem",
    rationale: "fixture rationale",
    expectedUserBenefit: "fixture benefit",
    expectedBehaviorChange: "fixture change",
    unchangedBehavior: "fixture unchanged",
    risk: "low",
    productionImpact: "none",
    sandboxValidationSummary: ["typecheck-project: PASS"],
    generatedAt: "2026-09-16T00:00:00.000Z",
    ...overrides,
  } as never);
}

interface Fixture {
  readonly repoRoot: string;
  readonly head: string;
  readonly gateRoot: string;
  readonly batchStore: AyasMicroBatchStoreHandle;
  readonly itemStore: AyasMicroItemStore;
  readonly artifactStore: AyasPatchArtifactStore;
}

function baseFixture(): Fixture {
  const { repoRoot, head } = repository();
  const gateRoot = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ayas-micro-exec-gate-")), "self-improvement");
  const batchStore = createAyasMicroBatchStore({ rootDir: fs.mkdtempSync(path.join(os.tmpdir(), "ayas-micro-exec-batch-")) });
  const itemStore = createAyasMicroItemStore({ rootDir: fs.mkdtempSync(path.join(os.tmpdir(), "ayas-micro-exec-items-")) });
  const artifactStore = createAyasPatchArtifactStore({ rootDir: fs.mkdtempSync(path.join(os.tmpdir(), "ayas-micro-exec-artifacts-")) });
  return { repoRoot, head, gateRoot, batchStore, itemStore, artifactStore };
}

/** Freezes an artifact + creates a BATCHED micro item bound to it, returning the item ref the batch store expects. */
function batchedItem(f: Fixture, artifactOverrides: Record<string, unknown> = {}): { ref: AyasMicroBatchItemRef; microItemId: string } {
  const artifact = freezeArtifact(f.artifactStore, { baseHead: f.head, ...artifactOverrides });
  const item = f.itemStore.create({
    discoveryClass: "error-code-contract-gap", semanticKey: artifact.candidateId, baseHead: f.head,
    patchArtifactId: artifact.artifactId, patchHash: artifact.patchHash, exactFiles: artifact.exactFiles,
    validatorScripts: artifact.validatorScripts, safetyClassification: "SAFE", graphifyEvidence: ["fixture evidence"],
    reason: "fixture reason", expectedBenefit: "fixture benefit", risk: "low", generatedAt: "2026-09-16T00:00:00.000Z", validatedAt: "2026-09-16T00:00:01.000Z",
  });
  f.itemStore.transition(item.microItemId, "SANDBOX_VALIDATED", "2026-09-16T00:00:02.000Z");
  return { ref: { microItemId: item.microItemId, semanticKey: artifact.candidateId, patchArtifactId: artifact.artifactId, patchHash: artifact.patchHash, exactFiles: artifact.exactFiles }, microItemId: item.microItemId };
}

/** Creates a batch of the given item refs, marks it READY_FOR_REVIEW, approves it, and returns the batchId. */
function approvedBatch(f: Fixture, refs: readonly AyasMicroBatchItemRef[]): string {
  const exactFilesUnion = [...new Set(refs.flatMap((r) => r.exactFiles))];
  const validatorUnion = [...new Set(refs.flatMap((r) => f.artifactStore.loadVerified(r.patchArtifactId).validatorScripts))];
  const batch = f.batchStore.createOrVersion({
    batchVersion: 1, baseHead: f.head, baseBranch: "wip/test", items: refs, exactFilesUnion, validatorUnion,
    worktreeBaseHead: f.head, createdAt: "2026-09-16T00:01:00.000Z", validationSummary: ["fixture"], aggregateRisk: "low",
  });
  for (const { microItemId } of refs.map((r) => ({ microItemId: r.microItemId }))) f.itemStore.transition(microItemId, "BATCHED", "2026-09-16T00:01:01.000Z", { batchId: batch.batchId });
  f.batchStore.markReadyForReview(batch.batchId, "2026-09-16T00:01:02.000Z");
  f.batchStore.decide(batch.batchId, "APPROVE", batch.batchHash, "2026-09-16T00:01:03.000Z");
  return batch.batchId;
}

async function main() {
  await scenario("mapBatchStatusToProposalStatus maps every post-approval status straight through", () => {
    for (const status of ["APPROVED", "RESERVED", "COMPLETED", "FAILED", "STALE", "ABANDONED", "RECOVERY_REQUIRED"] as const) {
      assert.equal(mapBatchStatusToProposalStatus(status), status);
    }
  });

  await scenario("mapBatchStatusToProposalStatus throws for ACCUMULATING/READY_FOR_REVIEW — those must never reach the execution adapter", () => {
    for (const status of ["ACCUMULATING", "READY_FOR_REVIEW"] as const) {
      assert.throws(() => mapBatchStatusToProposalStatus(status), (e: unknown) => e instanceof AyasMicroBatchExecutionError && e.code === "AYAS_MICRO_BATCH_ADAPTER_UNEXPECTED_STATUS");
    }
  });

  await scenario("rejects with NOT_FOUND when the batchId does not exist", async () => {
    const f = baseFixture();
    await assert.rejects(executeAyasApprovedMicroBatchWith("no-such-batch", f), (e: unknown) => e instanceof AyasMicroBatchExecutionError && e.code === "NOT_FOUND");
  });

  await scenario("rejects with NOT_APPROVED when the batch is still ACCUMULATING", async () => {
    const f = baseFixture();
    const item = batchedItem(f);
    const batch = f.batchStore.createOrVersion({ batchVersion: 1, baseHead: f.head, baseBranch: "wip/test", items: [item.ref], exactFilesUnion: item.ref.exactFiles, validatorUnion: [], worktreeBaseHead: f.head, createdAt: "2026-09-16T00:01:00.000Z", validationSummary: ["fixture"], aggregateRisk: "low" });
    await assert.rejects(executeAyasApprovedMicroBatchWith(batch.batchId, f), (e: unknown) => e instanceof AyasMicroBatchExecutionError && e.code === "NOT_APPROVED");
  });

  await scenario("full happy path: two-item batch APPROVED -> execute -> both files applied atomically -> batch COMPLETED -> both items EXECUTED -> decision EXECUTED", async () => {
    const f = baseFixture();
    const a = batchedItem(f);
    const b = batchedItem(f);
    const batchId = approvedBatch(f, [a.ref, b.ref]);
    await executeAyasApprovedMicroBatchWith(batchId, f);
    const state = f.batchStore.load();
    const finalBatch = state.batches.find((x) => x.batchId === batchId)!;
    assert.equal(finalBatch.status, "COMPLETED");
    const result = state.results.at(-1)!;
    assert.equal(result.changedFiles.length, 2);
    for (const { ref } of [a, b]) {
      assert.ok(fs.existsSync(path.join(f.repoRoot, ref.exactFiles[0]!)), `${ref.exactFiles[0]} must exist after execution`);
      assert.equal(f.itemStore.load(ref.microItemId).state, "EXECUTED");
    }
    const decision = state.decisions.find((d) => d.batchId === batchId && d.decision === "APPROVE")!;
    assert.equal(decision.finalizationOutcome, "EXECUTED");
  });

  await scenario("item hash mismatch: an item's frozen artifact no longer matches the batch's recorded patchHash — execution refuses before any mutation", async () => {
    const f = baseFixture();
    const a = batchedItem(f);
    const batchId = approvedBatch(f, [{ ...a.ref, patchHash: "tampered-hash-value" }]);
    await assert.rejects(executeAyasApprovedMicroBatchWith(batchId, f), (e: unknown) => e instanceof AyasMicroBatchExecutionError && e.code === "AYAS_MICRO_BATCH_ITEM_HASH_MISMATCH");
    assert.equal(fs.existsSync(path.join(f.repoRoot, a.ref.exactFiles[0]!)), false);
  });

  await scenario("item scope mismatch: an item's recorded exactFiles no longer matches its frozen artifact's exactFiles", async () => {
    const f = baseFixture();
    const a = batchedItem(f);
    const batchId = approvedBatch(f, [{ ...a.ref, exactFiles: ["scripts/tampered.ts"] }]);
    await assert.rejects(executeAyasApprovedMicroBatchWith(batchId, f), (e: unknown) => e instanceof AyasMicroBatchExecutionError && e.code === "AYAS_MICRO_BATCH_ITEM_SCOPE_MISMATCH");
  });

  await scenario("item unsafe: an artifact whose safetyClassification drifted away from SAFE is refused, never executed", async () => {
    const f = baseFixture();
    const artifact = freezeArtifact(f.artifactStore, { baseHead: f.head, safetyClassification: "REVIEW_REQUIRED" });
    const item = f.itemStore.create({
      discoveryClass: "error-code-contract-gap", semanticKey: artifact.candidateId, baseHead: f.head,
      patchArtifactId: artifact.artifactId, patchHash: artifact.patchHash, exactFiles: artifact.exactFiles,
      validatorScripts: artifact.validatorScripts, safetyClassification: "SAFE", graphifyEvidence: ["fixture evidence"],
      reason: "fixture reason", expectedBenefit: "fixture benefit", risk: "low", generatedAt: "2026-09-16T00:00:00.000Z", validatedAt: "2026-09-16T00:00:01.000Z",
    });
    f.itemStore.transition(item.microItemId, "SANDBOX_VALIDATED", "2026-09-16T00:00:02.000Z");
    const ref: AyasMicroBatchItemRef = { microItemId: item.microItemId, semanticKey: artifact.candidateId, patchArtifactId: artifact.artifactId, patchHash: artifact.patchHash, exactFiles: artifact.exactFiles };
    const batchId = approvedBatch(f, [ref]);
    await assert.rejects(executeAyasApprovedMicroBatchWith(batchId, f), (e: unknown) => e instanceof AyasMicroBatchExecutionError && e.code === "AYAS_MICRO_BATCH_ITEM_UNSAFE");
  });

  await scenario("stale approval: the repo moved on since baseHead — execution refuses and the batch is reconciled to STALE, never silently re-executed", async () => {
    const f = baseFixture();
    const a = batchedItem(f);
    const batchId = approvedBatch(f, [a.ref]);
    fs.writeFileSync(path.join(f.repoRoot, "scripts/existing.ts"), "export const value = 2;\n");
    git(f.repoRoot, "add", "-A");
    git(f.repoRoot, "commit", "-qm", "moved on");
    await assert.rejects(executeAyasApprovedMicroBatchWith(batchId, f), (e: unknown) => e instanceof AyasMicroBatchExecutionError && e.code === "STALE_APPROVAL");
    const finalBatch = f.batchStore.load().batches.find((b) => b.batchId === batchId)!;
    assert.equal(finalBatch.status, "STALE");
  });

  await scenario("whole-batch rollback: one item's validator failing rolls back EVERY item's write, not just the failing one", async () => {
    const f = baseFixture();
    const good = batchedItem(f);
    const badArtifact = freezeArtifact(f.artifactStore, {
      baseHead: f.head,
      exactFiles: ["scripts/smoke-fixture-bad.ts"],
      replacements: [{ filePath: "scripts/smoke-fixture-bad.ts", expectedHash: null, content: "console.log('never reports PASS');\n", allowCreate: true }],
      validatorScripts: ["scripts/smoke-fixture-bad.ts"],
    });
    const badItem = f.itemStore.create({
      discoveryClass: "error-code-contract-gap", semanticKey: badArtifact.candidateId, baseHead: f.head,
      patchArtifactId: badArtifact.artifactId, patchHash: badArtifact.patchHash, exactFiles: badArtifact.exactFiles,
      validatorScripts: badArtifact.validatorScripts, safetyClassification: "SAFE", graphifyEvidence: ["fixture evidence"],
      reason: "fixture reason", expectedBenefit: "fixture benefit", risk: "low", generatedAt: "2026-09-16T00:00:00.000Z", validatedAt: "2026-09-16T00:00:01.000Z",
    });
    f.itemStore.transition(badItem.microItemId, "SANDBOX_VALIDATED", "2026-09-16T00:00:02.000Z");
    const badRef: AyasMicroBatchItemRef = { microItemId: badItem.microItemId, semanticKey: badArtifact.candidateId, patchArtifactId: badArtifact.artifactId, patchHash: badArtifact.patchHash, exactFiles: badArtifact.exactFiles };
    fs.mkdirSync(path.join(f.repoRoot, "node_modules"), { recursive: true });
    fs.symlinkSync(path.join(process.cwd(), "node_modules", "tsx"), path.join(f.repoRoot, "node_modules", "tsx"), process.platform === "win32" ? "junction" : "dir");
    const batchId = approvedBatch(f, [good.ref, badRef]);
    await assert.rejects(executeAyasApprovedMicroBatchWith(batchId, f));
    assert.equal(fs.existsSync(path.join(f.repoRoot, good.ref.exactFiles[0]!)), false, "the GOOD item's write must also be rolled back — atomicity, not partial success");
    assert.equal(fs.existsSync(path.join(f.repoRoot, "scripts/smoke-fixture-bad.ts")), false);
    const finalBatch = f.batchStore.load().batches.find((b) => b.batchId === batchId)!;
    assert.notEqual(finalBatch.status, "COMPLETED");
  });

  await scenario("dirty repo at execution time: refuses, never mutates any item's file", async () => {
    const f = baseFixture();
    const a = batchedItem(f);
    const batchId = approvedBatch(f, [a.ref]);
    fs.writeFileSync(path.join(f.repoRoot, "scripts/uncommitted.ts"), "export const dirty = true;\n");
    await assert.rejects(executeAyasApprovedMicroBatchWith(batchId, f));
    assert.equal(fs.existsSync(path.join(f.repoRoot, a.ref.exactFiles[0]!)), false);
  });

  await scenario("execution never touches a second, unrelated batch/item/artifact store (test isolation self-check)", async () => {
    const f = baseFixture();
    const otherBatchDir = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-micro-exec-other-batch-"));
    const otherItemDir = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-micro-exec-other-items-"));
    const a = batchedItem(f);
    const batchId = approvedBatch(f, [a.ref]);
    await executeAyasApprovedMicroBatchWith(batchId, f);
    assert.deepEqual(fs.readdirSync(otherBatchDir), []);
    assert.deepEqual(fs.readdirSync(otherItemDir), []);
  });

  await scenario("a batch that is already COMPLETED cannot be executed again (one-shot reservation, no replay)", async () => {
    const f = baseFixture();
    const a = batchedItem(f);
    const batchId = approvedBatch(f, [a.ref]);
    await executeAyasApprovedMicroBatchWith(batchId, f);
    await assert.rejects(executeAyasApprovedMicroBatchWith(batchId, f), (e: unknown) => e instanceof AyasMicroBatchExecutionError && e.code === "NOT_APPROVED");
  });

  console.log(`AYAS micro batch execution service smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-micro-batch-execution-service", scenarios: count }));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
