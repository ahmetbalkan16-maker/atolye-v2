import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { approveAndExecuteAyasMicroBatch, AyasMicroBatchApprovalError } from "../src/lib/brain/autonomy/AyasMicroBatchApprovalService";
import { createAyasMicroBatchStore, type AyasMicroBatchStoreHandle, type AyasMicroBatchItemRef } from "../src/lib/brain/autonomy/AyasMicroBatch";
import { createAyasMicroItemStore, type AyasMicroItemStore } from "../src/lib/brain/autonomy/AyasMicroItem";
import { createAyasPatchArtifactStore, type AyasPatchArtifactStore } from "../src/lib/brain/autonomy/AyasPatchArtifact";
import { isolatedStabilityGuardDeps } from "./ayas-isolated-stability-guard";
import { ayasPublicationOperationName } from "../src/lib/brain/autonomy/AyasGuardedPublication";
import { AyasPostPublicationClosureError } from "../src/lib/brain/autonomy/AyasPostPublicationClosure";
import { createAyasExecutionJournal } from "../src/lib/brain/autonomy/AyasExecutionJournal";

/**
 * M18.1 — "BATCH ONAYLA VE UYGULA": the single-approval → Package C
 * execution → per-item + final Graphify → post-execution validation →
 * exact Git staging → ONE commit → push pipeline. Every scenario below uses
 * a REAL isolated fixture repo with a REAL bare "remote" repo (never the
 * real Atölye repo, never a network remote) — push behavior is exercised
 * against real Git, not mocked.
 */
let count = 0;
function scenario(name: string, fn: () => void | Promise<void>) { return Promise.resolve(fn()).then(() => { count += 1; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }); }
function root() { return fs.mkdtempSync(path.join(os.tmpdir(), "ayas-approval-svc-")); }
function git(cwd: string, ...args: string[]) { return execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim(); }

interface Fixture {
  readonly repoRoot: string;
  readonly remoteDir: string;
  /** The batch's intended baseHead — mutable: `seedItem` advances it after committing each target class file, so `readyBatch` always binds to the CURRENT HEAD. */
  head: string;
  readonly batchStore: AyasMicroBatchStoreHandle;
  readonly itemStore: AyasMicroItemStore;
  readonly artifactStore: AyasPatchArtifactStore;
  readonly gateRoot: string;
  /** Every publication now runs under the Runtime Stability Guard; this keeps the guard's own observations isolated too, so no scenario's outcome can depend on the real scheduler state, the real approval inbox or the real :3000. */
  readonly stabilityGuard: ReturnType<typeof isolatedStabilityGuardDeps>;
  readonly postPublicationClosure: (expectedHead: string) => void;
}

function widgetContent(className: string): string {
  return [
    'import assert from "node:assert/strict";',
    `import { ${className} } from "../src/lib/widget/${className}";`,
    'const CODES = ["X"] as const;',
    "for (const code of CODES) {",
    `  const error = new ${className}(code, \`test message for \${code}\`);`,
    "  assert.equal(error.code, code);",
    `  assert.equal(error.name, "${className}");`,
    "  assert.ok(error instanceof Error);",
    `  assert.ok(error instanceof ${className});`,
    "}",
    `console.log(JSON.stringify({ status: "PASS", suite: "${className}", scenarios: 4 }));`,
    "",
  ].join("\n");
}

/** A real isolated repo + a real bare "remote" repo, with node_modules linked so tsc/graphify genuinely run. */
function makeFixture(): Fixture {
  const remoteDir = root();
  git(remoteDir, "init", "-q", "--bare");

  const repoRoot = root();
  git(repoRoot, "init", "-q");
  git(repoRoot, "config", "user.email", "f@example.com");
  git(repoRoot, "config", "user.name", "f");
  fs.mkdirSync(path.join(repoRoot, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, "src", "lib", "widget"), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, "scripts", "existing.ts"), "export const existing = 1;\n");
  fs.writeFileSync(path.join(repoRoot, ".gitignore"), "node_modules/\n.graphify/\nscripts/.graphify/\n");
  fs.writeFileSync(
    path.join(repoRoot, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { target: "ES2020", module: "commonjs", moduleResolution: "node", esModuleInterop: true, strict: true, skipLibCheck: true, noEmit: true, types: ["node"] }, include: ["src/**/*.ts", "scripts/**/*.ts"], exclude: ["node_modules"] }, null, 2),
    "utf8",
  );
  git(repoRoot, "add", "-A"); git(repoRoot, "commit", "-q", "-m", "initial");
  git(repoRoot, "remote", "add", "origin", remoteDir);
  git(repoRoot, "push", "-q", "-u", "origin", "master");
  const head = git(repoRoot, "rev-parse", "HEAD");

  fs.mkdirSync(path.join(repoRoot, "node_modules"), { recursive: true });
  fs.symlinkSync(path.join(process.cwd(), "node_modules", "tsx"), path.join(repoRoot, "node_modules", "tsx"), process.platform === "win32" ? "junction" : "dir");
  fs.symlinkSync(path.join(process.cwd(), "node_modules", "typescript"), path.join(repoRoot, "node_modules", "typescript"), process.platform === "win32" ? "junction" : "dir");
  fs.symlinkSync(path.join(process.cwd(), "node_modules", "@types"), path.join(repoRoot, "node_modules", "@types"), process.platform === "win32" ? "junction" : "dir");

  return {
    repoRoot, remoteDir, head,
    stabilityGuard: isolatedStabilityGuardDeps({ isolateApprovalInbox: true }),
    batchStore: createAyasMicroBatchStore({ rootDir: fs.mkdtempSync(path.join(os.tmpdir(), "ayas-approval-svc-batch-")) }),
    itemStore: createAyasMicroItemStore({ rootDir: fs.mkdtempSync(path.join(os.tmpdir(), "ayas-approval-svc-items-")) }),
    artifactStore: createAyasPatchArtifactStore({ rootDir: fs.mkdtempSync(path.join(os.tmpdir(), "ayas-approval-svc-artifacts-")) }),
    gateRoot: path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ayas-approval-svc-gate-"))),
    postPublicationClosure: (expectedHead) => {
      assert.equal(git(repoRoot, "rev-parse", "HEAD"), expectedHead);
      assert.equal(git(remoteDir, "rev-parse", "master"), expectedHead);
    },
  };
}

/** Writes the target class's source file, freezes an artifact, creates+advances a micro item to BATCHED, for a given className. */
function seedItem(f: Fixture, className: string, extraContent?: string): AyasMicroBatchItemRef {
  const classFile = path.join("src", "lib", "widget", `${className}.ts`);
  fs.writeFileSync(path.join(f.repoRoot, classFile), `export class ${className} extends Error {\n  constructor(readonly code: "X", message: string) {\n    super(message);\n    this.name = "${className}";\n  }\n}\n`, "utf8");
  // The target class itself is committed, real, pre-existing source — only the generated regression TEST is the batch's own new content.
  git(f.repoRoot, "add", "--", classFile);
  git(f.repoRoot, "commit", "-q", "-m", `add ${className}`);
  f.head = git(f.repoRoot, "rev-parse", "HEAD");
  const artifact = f.artifactStore.freeze({
    artifactId: `ayas-patch-artifact-${className}`, candidateId: `ayas-novel-${className}`, generatorIdentity: "ayas-detector:error-code-contract-gap-v1",
    baseBranch: "master", baseHead: f.head, exactFiles: [`scripts/smoke-ayas-error-code-contract-${className}.ts`], allowedRoots: ["scripts/"],
    replacements: [{ filePath: `scripts/smoke-ayas-error-code-contract-${className}.ts`, expectedHash: null, content: extraContent ?? widgetContent(className), allowCreate: true }],
    validatorScripts: [`scripts/smoke-ayas-error-code-contract-${className}.ts`], graphifyEvidence: ["fixture"], safetyClassification: "SAFE",
    problemStatement: "p", rationale: "r", expectedUserBenefit: "b", expectedBehaviorChange: "c", unchangedBehavior: "u", risk: "low", productionImpact: "none",
    sandboxValidationSummary: ["PASS"], generatedAt: "2026-09-16T00:00:00.000Z",
  } as never);
  const item = f.itemStore.create({
    discoveryClass: "error-code-contract-gap", semanticKey: `ayas-novel-${className}`, baseHead: f.head,
    patchArtifactId: artifact.artifactId, patchHash: artifact.patchHash, exactFiles: artifact.exactFiles,
    validatorScripts: artifact.validatorScripts, safetyClassification: "SAFE", graphifyEvidence: ["fixture"],
    reason: "r", expectedBenefit: "b", risk: "low", generatedAt: "2026-09-16T00:00:00.000Z", validatedAt: "2026-09-16T00:00:01.000Z",
  });
  f.itemStore.transition(item.microItemId, "SANDBOX_VALIDATED", "2026-09-16T00:00:02.000Z");
  return { microItemId: item.microItemId, semanticKey: `ayas-novel-${className}`, patchArtifactId: artifact.artifactId, patchHash: artifact.patchHash, exactFiles: artifact.exactFiles };
}

/** Batches the given item refs, transitions them to BATCHED, and marks the batch READY_FOR_REVIEW. */
function readyBatch(f: Fixture, refs: readonly AyasMicroBatchItemRef[]) {
  const batch = f.batchStore.createOrVersion({
    batchVersion: 1, baseHead: f.head, baseBranch: "master", items: refs, exactFilesUnion: refs.flatMap((r) => r.exactFiles), validatorUnion: refs.flatMap((r) => r.exactFiles),
    worktreeBaseHead: f.head, createdAt: "2026-09-16T00:01:00.000Z", validationSummary: ["fixture"], aggregateRisk: "low",
  } as never);
  for (const ref of refs) f.itemStore.transition(ref.microItemId, "BATCHED", "2026-09-16T00:01:01.000Z", { batchId: batch.batchId });
  f.batchStore.markReadyForReview(batch.batchId, "2026-09-16T00:01:02.000Z");
  return f.batchStore.load().batches.find((b) => b.batchId === batch.batchId)!;
}

async function main(): Promise<void> {
  await scenario("one authorization binds execution AND Git publication: a single call decides, executes through Package C, and produces ONE pushed commit — no separate step", async () => {
    const f = makeFixture();
    const ref = seedItem(f, "WidgetError");
    const batch = readyBatch(f, [ref]);
    const result = await approveAndExecuteAyasMicroBatch(batch.batchId, batch.batchHash, f);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.ok(fs.existsSync(path.join(f.repoRoot, ref.exactFiles[0]!)));
    const localHead = git(f.repoRoot, "rev-parse", "HEAD");
    const remoteHead = git(f.remoteDir, "rev-parse", "master");
    assert.equal(localHead, remoteHead, "local must equal the real bare remote after one call");
    assert.equal(localHead, result.commitSha);
    assert.equal(git(f.repoRoot, "status", "--short"), "", "working tree must be clean after publication");
    assert.equal(f.batchStore.load().batches.find((b) => b.batchId === batch.batchId)!.status, "COMPLETED");

    // The batch lane goes through the SAME `runGuardedAyasPublication`
    // primitive as the individual-proposal lane, so a batch publication is
    // equally incapable of reaching Git without a durable guard record.
    const transactions = f.stabilityGuard.store!.load().transactions.filter((t) => t.operation === ayasPublicationOperationName("micro-batch", batch.batchId));
    assert.equal(transactions.length, 1, "exactly ONE stability transaction must exist for this batch publication");
    assert.equal(transactions[0]!.state, "COMPLETED");
    assert.equal(transactions[0]!.scope.impactClass, "TEST_ONLY");
    assert.deepEqual(transactions[0]!.violations, []);
    assert.deepEqual(transactions[0]!.healthFailures, []);
    assert.equal(transactions[0]!.after?.repo.head, localHead, "the after-snapshot must prove which commit this batch produced");
  });

  await scenario("deferred micro-batch keeps batch and micro-item terminal states open until shared closure succeeds", async () => {
    const f = makeFixture(); const ref = seedItem(f, "WidgetError"); const batch = readyBatch(f, [ref]);
    const result = await approveAndExecuteAyasMicroBatch(batch.batchId, batch.batchHash, {
      ...f,
      postPublicationClosure: () => {
        assert.equal(f.batchStore.load().batches.find((entry) => entry.batchId === batch.batchId)!.status, "RESERVED");
        assert.notEqual(f.itemStore.load(ref.microItemId).state, "EXECUTED");
        assert.equal(createAyasExecutionJournal({ rootDir: f.gateRoot }).list().at(-1)!.phase, "MUTATION_COMPLETED_PENDING_PUBLICATION");
      },
    });
    assert.equal(result.ok, true);
    assert.equal(f.batchStore.load().batches.find((entry) => entry.batchId === batch.batchId)!.status, "COMPLETED");
    assert.equal(f.itemStore.load(ref.microItemId).state, "EXECUTED");
    assert.equal(createAyasExecutionJournal({ rootDir: f.gateRoot }).list().at(-1)!.phase, "RESULT_RECORDED");
  });

  await scenario("a post-push micro-batch closure failure is recovery-required and never falsely marks micro-items executed", async () => {
    const f = makeFixture(); const ref = seedItem(f, "WidgetError"); const batch = readyBatch(f, [ref]);
    const before = git(f.repoRoot, "rev-parse", "HEAD");
    const result = await approveAndExecuteAyasMicroBatch(batch.batchId, batch.batchHash, {
      ...f,
      postPublicationClosure: () => { throw new AyasPostPublicationClosureError("AYAS_POST_PUBLICATION_GRAPHIFY_STALE", "fixture stale graph"); },
    });
    assert.equal(result.ok, false); if (result.ok) return;
    const published = git(f.repoRoot, "rev-parse", "HEAD");
    assert.notEqual(published, before); assert.equal(git(f.remoteDir, "rev-parse", "master"), published);
    assert.equal(f.batchStore.load().batches.find((entry) => entry.batchId === batch.batchId)!.status, "RECOVERY_REQUIRED");
    assert.notEqual(f.itemStore.load(ref.microItemId).state, "EXECUTED");
    assert.equal(createAyasExecutionJournal({ rootDir: f.gateRoot }).list().at(-1)!.phase, "RECOVERY_REQUIRED");
  });

  await scenario("a batch whose declared file union reaches the storage/execution authority is refused before any decision or mutation", async () => {
    const f = makeFixture();
    const ref = seedItem(f, "WidgetError");
    const batch = readyBatch(f, [{ ...ref, exactFiles: ["src/lib/runtime/RuntimeStoragePaths.ts"] }]);
    await assert.rejects(
      approveAndExecuteAyasMicroBatch(batch.batchId, batch.batchHash, f),
      (e: unknown) => e instanceof AyasMicroBatchApprovalError && e.code === "RUNTIME_IMPACT_NOT_PUBLISHABLE",
    );
    assert.equal(f.batchStore.load().batches.find((b) => b.batchId === batch.batchId)!.status, "READY_FOR_REVIEW", "no approval may be minted for a batch this lane can never publish");
    assert.equal(f.stabilityGuard.store!.load().transactions.length, 0);
    assert.equal(git(f.repoRoot, "status", "--short"), "");
  });

  await scenario("a dirty working tree fail-closes the batch lane at the guard precondition — nothing executed, nothing committed", async () => {
    const f = makeFixture();
    const ref = seedItem(f, "WidgetError");
    const batch = readyBatch(f, [ref]);
    fs.writeFileSync(path.join(f.repoRoot, "scripts", "unrelated-in-flight-work.ts"), "export const wip = 1;\n");
    const headBefore = git(f.repoRoot, "rev-parse", "HEAD");

    const result = await approveAndExecuteAyasMicroBatch(batch.batchId, batch.batchHash, f);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "AYAS_MICRO_BATCH_STABILITY_GUARD_REFUSED");
    assert.equal(result.stage, "STABILITY_GUARD");
    assert.equal(git(f.repoRoot, "rev-parse", "HEAD"), headBefore);
    assert.equal(fs.existsSync(path.join(f.repoRoot, ref.exactFiles[0]!)), false, "the mutation must never have run");
  });

  await scenario("one commit for a multi-item batch, not one per item", async () => {
    const f = makeFixture();
    const refA = seedItem(f, "WidgetError");
    const refB = seedItem(f, "GadgetError");
    const batch = readyBatch(f, [refA, refB]);
    const beforeCount = Number(git(f.repoRoot, "rev-list", "--count", "HEAD"));
    const result = await approveAndExecuteAyasMicroBatch(batch.batchId, batch.batchHash, f);
    assert.equal(result.ok, true);
    const afterCount = Number(git(f.repoRoot, "rev-list", "--count", "HEAD"));
    assert.equal(afterCount, beforeCount + 1, "exactly one new commit for the whole batch");
    if (result.ok) assert.deepEqual([...result.changedFiles].sort(), [...refA.exactFiles, ...refB.exactFiles].sort());
  });

  await scenario("a batchHash that no longer matches the current batch (it changed since review) is refused before any decision or mutation", async () => {
    const f = makeFixture();
    const ref = seedItem(f, "WidgetError");
    const batch = readyBatch(f, [ref]);
    await assert.rejects(
      approveAndExecuteAyasMicroBatch(batch.batchId, "stale-hash-value", f),
      (e: unknown) => e instanceof AyasMicroBatchApprovalError && e.code === "BATCH_HASH_MISMATCH",
    );
    assert.equal(f.batchStore.load().batches.find((b) => b.batchId === batch.batchId)!.status, "READY_FOR_REVIEW", "no decision must be recorded");
    assert.equal(git(f.repoRoot, "status", "--short"), "");
  });

  await scenario("HEAD drift since the batch's baseHead invalidates the authorization — refused, and the batch is reconciled to STALE, never silently re-approved", async () => {
    const f = makeFixture();
    const ref = seedItem(f, "WidgetError");
    const batch = readyBatch(f, [ref]);
    fs.writeFileSync(path.join(f.repoRoot, "scripts", "existing.ts"), "export const existing = 2;\n");
    git(f.repoRoot, "add", "-A"); git(f.repoRoot, "commit", "-q", "-m", "moved on");
    const result = await approveAndExecuteAyasMicroBatch(batch.batchId, batch.batchHash, f);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.stage, "EXECUTION");
    assert.equal(f.batchStore.load().batches.find((b) => b.batchId === batch.batchId)!.status, "STALE");
  });

  await scenario("an item's patchHash drift (frozen artifact no longer matches the batch's recorded hash) invalidates the authorization — refused before any mutation, working tree untouched", async () => {
    const f = makeFixture();
    const ref = seedItem(f, "WidgetError");
    const tamperedRef: AyasMicroBatchItemRef = { ...ref, patchHash: "tampered-hash-value" };
    const batch = readyBatch(f, [tamperedRef]);
    const result = await approveAndExecuteAyasMicroBatch(batch.batchId, batch.batchHash, f);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "AYAS_MICRO_BATCH_ITEM_HASH_MISMATCH");
    assert.equal(fs.existsSync(path.join(f.repoRoot, ref.exactFiles[0]!)), false);
    assert.equal(git(f.repoRoot, "status", "--short"), "");
  });

  await scenario("per-item Graphify check runs inside execution: a file whose real import count does not match its generator's declared contract fails the batch and rolls back EVERY item's write, not just the offending one", async () => {
    const f = makeFixture();
    const good = seedItem(f, "WidgetError");
    // A "bad" item whose actual written content imports something extra beyond assert/strict + its own class — the generator's declared shape (2 imports) no longer matches reality.
    const badContent = [
      'import assert from "node:assert/strict";',
      'import path from "node:path";',
      'import { GadgetError } from "../src/lib/widget/GadgetError";',
      'assert.ok(path.sep);',
      'console.log(JSON.stringify({ status: "PASS", suite: "GadgetError", scenarios: 1 }));',
      "",
    ].join("\n");
    const bad = seedItem(f, "GadgetError", badContent);
    const batch = readyBatch(f, [good, bad]);
    const result = await approveAndExecuteAyasMicroBatch(batch.batchId, batch.batchHash, f);
    assert.equal(result.ok, false);
    if (!result.ok) { assert.equal(result.stage, "EXECUTION"); assert.equal(result.code, "AYAS_GRAPHIFY_UNEXPECTED_DEPENDENCY"); }
    assert.equal(fs.existsSync(path.join(f.repoRoot, good.exactFiles[0]!)), false, "the GOOD item's write must also be rolled back — Graphify failure invalidates the whole batch, not just the offending item");
    assert.equal(fs.existsSync(path.join(f.repoRoot, bad.exactFiles[0]!)), false);
    assert.equal(git(f.repoRoot, "status", "--short"), "");
  });

  await scenario("a real item validator failure prevents Git publication entirely — no commit, no push, working tree rolled back", async () => {
    const f = makeFixture();
    const good = seedItem(f, "WidgetError");
    const failingContent = 'console.log("this smoke test never reports PASS");\n';
    const bad = seedItem(f, "GadgetError", failingContent);
    const batch = readyBatch(f, [good, bad]);
    const beforeCount = Number(git(f.repoRoot, "rev-list", "--count", "HEAD"));
    const result = await approveAndExecuteAyasMicroBatch(batch.batchId, batch.batchHash, f);
    assert.equal(result.ok, false);
    const afterCount = Number(git(f.repoRoot, "rev-list", "--count", "HEAD"));
    assert.equal(afterCount, beforeCount, "no commit must be created");
    assert.equal(git(f.repoRoot, "status", "--short"), "");
  });

  await scenario("exact-scope staging only: the commit contains ONLY the approved batch's exactFiles, never an incidental repo-wide change", async () => {
    const f = makeFixture();
    const ref = seedItem(f, "WidgetError");
    const batch = readyBatch(f, [ref]);
    const result = await approveAndExecuteAyasMicroBatch(batch.batchId, batch.batchHash, f);
    assert.equal(result.ok, true);
    const changedInCommit = git(f.repoRoot, "diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD").split("\n").filter(Boolean);
    assert.deepEqual(changedInCommit, [...ref.exactFiles]);
  });

  await scenario("the module never stages via broad commands — source inspection proves no `add .` / `add -A` / `commit -a`", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src", "lib", "brain", "autonomy", "AyasMicroBatchApprovalService.ts"), "utf8");
    assert.doesNotMatch(src, /git\(deps\.repoRoot,\s*\["add",\s*"-A"|git\(deps\.repoRoot,\s*\["add",\s*"\."|"commit",\s*"-a"/);
  });

  await scenario("replay is refused: a second approval call on an already-COMPLETED batch is rejected, never re-executed or re-pushed", async () => {
    const f = makeFixture();
    const ref = seedItem(f, "WidgetError");
    const batch = readyBatch(f, [ref]);
    const first = await approveAndExecuteAyasMicroBatch(batch.batchId, batch.batchHash, f);
    assert.equal(first.ok, true);
    await assert.rejects(
      approveAndExecuteAyasMicroBatch(batch.batchId, batch.batchHash, f),
      (e: unknown) => e instanceof AyasMicroBatchApprovalError && e.code === "NOT_READY",
    );
  });

  await scenario("push failure (remote already moved on) is reported as a distinct PUSH-stage failure, never silently retried, and the local commit is preserved untouched (no reset/rewrite)", async () => {
    const f = makeFixture();
    // A second clone pushes an unrelated commit to the same bare remote FIRST, so this fixture's own push will be rejected as non-fast-forward.
    const otherClone = root();
    git(otherClone, "clone", "-q", f.remoteDir, ".");
    git(otherClone, "config", "user.email", "g@example.com"); git(otherClone, "config", "user.name", "g");
    fs.writeFileSync(path.join(otherClone, "elsewhere.ts"), "export const elsewhere = 1;\n");
    git(otherClone, "add", "-A"); git(otherClone, "commit", "-q", "-m", "elsewhere");
    git(otherClone, "push", "-q", "origin", "master");

    const ref = seedItem(f, "WidgetError");
    const batch = readyBatch(f, [ref]);
    const beforeLocalHead = git(f.repoRoot, "rev-parse", "HEAD");
    const result = await approveAndExecuteAyasMicroBatch(batch.batchId, batch.batchHash, f);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.stage, "PUSH");
    // The local commit itself must still exist (git commit already happened) — never reset/rewritten after a push failure.
    const afterLocalHead = git(f.repoRoot, "rev-parse", "HEAD");
    assert.notEqual(afterLocalHead, beforeLocalHead, "the local commit must still exist even though the push failed");
    assert.ok(fs.existsSync(path.join(f.repoRoot, ref.exactFiles[0]!)));
  });

  console.log(`AYAS micro batch approval service smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-micro-batch-approval-service", scenarios: count }));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
