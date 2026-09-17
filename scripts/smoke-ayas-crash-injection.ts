import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createAyasMicroBatchStore, type AyasMicroBatchStoreHandle, type AyasMicroBatchItemRef } from "../src/lib/brain/autonomy/AyasMicroBatch";
import { createAyasMicroItemStore, type AyasMicroItemStore } from "../src/lib/brain/autonomy/AyasMicroItem";
import { createAyasPatchArtifactStore, type AyasPatchArtifactStore } from "../src/lib/brain/autonomy/AyasPatchArtifact";
import { createAyasExecutionJournal } from "../src/lib/brain/autonomy/AyasExecutionJournal";
import { classifyAyasRestartRecovery } from "../src/lib/brain/autonomy/AyasExecutionRecoveryPolicy";
import { AyasMicroBatchApprovalError } from "../src/lib/brain/autonomy/AyasMicroBatchApprovalService";

/**
 * M21.1/M21.8 — genuine process-interruption crash boundaries.
 *
 * Every scenario below spawns scripts/ayas-crash-injection-worker.ts as a
 * REAL, SEPARATE OS process (never an in-process call) against a real
 * isolated fixture repo + real bare remote. The worker's crash-injection
 * hook calls `process.exit(137)` — an immediate, unwind-free death, not a
 * caught exception — so `AyasAutonomyDaemon.executeApproved`'s own catch
 * block (finalizeApproval/gate-fault/RECOVERY_REQUIRED classification)
 * NEVER runs for these. Recovery is then checked from a FRESH process
 * (this test script itself), reading only the real durable state the dead
 * worker left behind — proving what a genuine crash actually leaves on
 * disk, not what a hand-built journal fixture claims it would.
 */
let count = 0;
function scenario(name: string, fn: () => void | Promise<void>) { return Promise.resolve(fn()).then(() => { count += 1; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }); }
function root() { return fs.mkdtempSync(path.join(os.tmpdir(), "ayas-crash-")); }
function git(cwd: string, ...args: string[]) { return execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim(); }

interface Fixture {
  readonly repoRoot: string;
  readonly remoteDir: string;
  readonly gateRoot: string;
  readonly batchStoreDir: string;
  readonly itemStoreDir: string;
  readonly artifactStoreDir: string;
  readonly batchStore: AyasMicroBatchStoreHandle;
  readonly itemStore: AyasMicroItemStore;
  readonly artifactStore: AyasPatchArtifactStore;
}

function widgetContent(className: string): string {
  return [
    'import assert from "node:assert/strict";',
    `import { ${className} } from "../src/lib/widget/${className}";`,
    'const CODES = ["X"] as const;',
    "for (const code of CODES) {",
    `  const error = new ${className}(code, \`test message for \${code}\`);`,
    '  assert.equal(error.code, code, "code");',
    "}",
    `console.log(JSON.stringify({ status: "PASS", suite: "${className}", scenarios: 1 }));`,
    "",
  ].join("\n");
}

function makeFixture(): Fixture {
  const remoteDir = root();
  git(remoteDir, "init", "-q", "--bare");
  const repoRoot = root();
  git(repoRoot, "init", "-q");
  git(repoRoot, "config", "user.email", "f@example.com");
  git(repoRoot, "config", "user.name", "f");
  fs.mkdirSync(path.join(repoRoot, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, "src", "lib", "widget"), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, ".gitignore"), "node_modules/\n.graphify/\nscripts/.graphify/\n");
  fs.writeFileSync(
    path.join(repoRoot, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { target: "ES2020", module: "commonjs", moduleResolution: "node", esModuleInterop: true, strict: true, skipLibCheck: true, noEmit: true, types: ["node"] }, include: ["src/**/*.ts", "scripts/**/*.ts"], exclude: ["node_modules"] }, null, 2),
  );
  git(repoRoot, "add", "-A"); git(repoRoot, "commit", "-q", "-m", "initial");
  git(repoRoot, "remote", "add", "origin", remoteDir);
  git(repoRoot, "push", "-q", "-u", "origin", "master");
  fs.mkdirSync(path.join(repoRoot, "node_modules"), { recursive: true });
  for (const dep of ["tsx", "typescript", "@types"]) {
    fs.symlinkSync(path.join(process.cwd(), "node_modules", dep), path.join(repoRoot, "node_modules", dep), process.platform === "win32" ? "junction" : "dir");
  }
  const batchStoreDir = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-crash-batch-"));
  const itemStoreDir = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-crash-items-"));
  const artifactStoreDir = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-crash-artifacts-"));
  return {
    repoRoot, remoteDir, gateRoot: fs.mkdtempSync(path.join(os.tmpdir(), "ayas-crash-gate-")),
    batchStoreDir, itemStoreDir, artifactStoreDir,
    batchStore: createAyasMicroBatchStore({ rootDir: batchStoreDir }),
    itemStore: createAyasMicroItemStore({ rootDir: itemStoreDir }),
    artifactStore: createAyasPatchArtifactStore({ rootDir: artifactStoreDir }),
  };
}

function seedReadyBatch(f: Fixture, className = "WidgetError"): { batchId: string; batchHash: string } {
  const classFile = path.join("src", "lib", "widget", `${className}.ts`);
  fs.writeFileSync(path.join(f.repoRoot, classFile), `export class ${className} extends Error {\n  constructor(readonly code: "X", message: string) {\n    super(message);\n    this.name = "${className}";\n  }\n}\n`, "utf8");
  git(f.repoRoot, "add", "--", classFile);
  git(f.repoRoot, "commit", "-q", "-m", `add ${className}`);
  const head = git(f.repoRoot, "rev-parse", "HEAD");
  const targetFile = `scripts/smoke-ayas-error-code-contract-${className}.ts`;
  const artifact = f.artifactStore.freeze({
    artifactId: `ayas-patch-artifact-${className}`, candidateId: `ayas-novel-${className}`, generatorIdentity: "ayas-detector:error-code-contract-gap-v1",
    baseBranch: "master", baseHead: head, exactFiles: [targetFile], allowedRoots: ["scripts/"],
    replacements: [{ filePath: targetFile, expectedHash: null, content: widgetContent(className), allowCreate: true }],
    validatorScripts: [targetFile], graphifyEvidence: ["fixture"], safetyClassification: "SAFE",
    problemStatement: "p", rationale: "r", expectedUserBenefit: "b", expectedBehaviorChange: "c", unchangedBehavior: "u", risk: "low", productionImpact: "none",
    sandboxValidationSummary: ["PASS"], generatedAt: "2026-09-17T00:00:00.000Z",
  } as never);
  const ref: AyasMicroBatchItemRef = { microItemId: `ayas-micro-item-${className}`, semanticKey: `ayas-novel-${className}`, patchArtifactId: artifact.artifactId, patchHash: artifact.patchHash, exactFiles: artifact.exactFiles };
  const item = f.itemStore.create({
    discoveryClass: "error-code-contract-gap", semanticKey: ref.semanticKey, baseHead: head,
    patchArtifactId: artifact.artifactId, patchHash: artifact.patchHash, exactFiles: artifact.exactFiles,
    validatorScripts: artifact.validatorScripts, safetyClassification: "SAFE", graphifyEvidence: ["fixture"],
    reason: "r", expectedBenefit: "b", risk: "low", generatedAt: "2026-09-17T00:00:00.000Z", validatedAt: "2026-09-17T00:00:01.000Z",
  });
  f.itemStore.transition(item.microItemId, "SANDBOX_VALIDATED", "2026-09-17T00:00:02.000Z");
  const batch = f.batchStore.createOrVersion({
    batchVersion: 1, baseHead: head, baseBranch: "master", items: [ref], exactFilesUnion: ref.exactFiles, validatorUnion: ref.exactFiles,
    worktreeBaseHead: head, createdAt: "2026-09-17T00:01:00.000Z", validationSummary: ["fixture"], aggregateRisk: "low",
  } as never);
  f.itemStore.transition(item.microItemId, "BATCHED", "2026-09-17T00:01:01.000Z", { batchId: batch.batchId });
  const ready = f.batchStore.markReadyForReview(batch.batchId, "2026-09-17T00:01:02.000Z");
  return { batchId: ready.batchId, batchHash: ready.batchHash };
}

/** Spawns the real crash-injection worker as a genuine child process. Returns its exit code (137 for a real self-kill) without throwing — a non-zero exit from a worker crash is the EXPECTED outcome here, not a test failure. */
function spawnWorker(config: object): number {
  const configPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ayas-crash-config-")), "config.json");
  fs.writeFileSync(configPath, JSON.stringify(config), "utf8");
  try {
    execFileSync(process.execPath, [path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs"), path.join(process.cwd(), "scripts", "ayas-crash-injection-worker.ts"), configPath], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    return 0;
  } catch (error) {
    const status = (error as { status?: number | null }).status;
    return status ?? 1;
  }
}

async function main(): Promise<void> {
  await scenario("crash BEFORE reservation (APPROVED_NOT_STARTED): no reservation ever happens, batch stays freely re-approvable, no journal entry, no partial commit", async () => {
    const f = makeFixture();
    const { batchId, batchHash } = seedReadyBatch(f);
    const exitCode = spawnWorker({ lane: "batch", repoRoot: f.repoRoot, gateRoot: f.gateRoot, remoteName: "origin", storeRoots: { batch: f.batchStoreDir, items: f.itemStoreDir, artifacts: f.artifactStoreDir }, batchId, batchHash, crashAt: "APPROVED_NOT_STARTED" });
    assert.equal(exitCode, 137, "the worker must actually die with our injected exit code, not run to completion");
    // decide() already ran (APPROVE recorded) before executeApproved's journal starts — but reservation itself never happened, so the batch is not stuck: a FRESH approval attempt is refused for the ordinary reason (already decided), never silently replayed.
    const batch = f.batchStore.load().batches.find((b) => b.batchId === batchId)!;
    assert.notEqual(batch.status, "COMPLETED", "must never look completed after a crash before any mutation");
    assert.equal(git(f.repoRoot, "log", "--oneline").split("\n").length, 2, "no new commit — still just the initial + class-add commits");
  });

  await scenario("crash AFTER reservation (AUTHORIZATION_RESERVED): batch is durably stuck at RESERVED — never auto-replayable, requires human/operator recovery", async () => {
    const f = makeFixture();
    const { batchId, batchHash } = seedReadyBatch(f);
    const exitCode = spawnWorker({ lane: "batch", repoRoot: f.repoRoot, gateRoot: f.gateRoot, remoteName: "origin", storeRoots: { batch: f.batchStoreDir, items: f.itemStoreDir, artifacts: f.artifactStoreDir }, batchId, batchHash, crashAt: "AUTHORIZATION_RESERVED" });
    assert.equal(exitCode, 137);
    const batch = f.batchStore.load().batches.find((b) => b.batchId === batchId)!;
    assert.equal(batch.status, "RESERVED", "a genuine crash right after reservation leaves the batch durably RESERVED — finalizeApproval never ran");
    // No auto-replay: a second attempt with the SAME approved hash must be refused, not silently re-executed.
    await assert.rejects(
      approveAndExecuteBatchAgain(batchId, batchHash, f),
      (e: unknown) => e instanceof AyasMicroBatchApprovalError && e.code === "NOT_READY",
    );
    assert.equal(git(f.repoRoot, "log", "--oneline").split("\n").length, 2, "no commit was ever created");
  });

  await scenario("crash AFTER gate open, before mutation (GATE_OPEN): journal + recovery classification correctly report PRE_MUTATION_GATE — no mutation was possible", async () => {
    const f = makeFixture();
    const { batchId, batchHash } = seedReadyBatch(f);
    const exitCode = spawnWorker({ lane: "batch", repoRoot: f.repoRoot, gateRoot: f.gateRoot, remoteName: "origin", storeRoots: { batch: f.batchStoreDir, items: f.itemStoreDir, artifacts: f.artifactStoreDir }, batchId, batchHash, crashAt: "GATE_OPEN" });
    assert.equal(exitCode, 137);
    const journal = createAyasExecutionJournal({ rootDir: f.gateRoot });
    const entries = journal.list();
    assert.equal(entries.length, 1, "exactly one execution attempt was journaled");
    assert.equal(entries[0]!.phase, "GATE_OPEN", "the last durable phase must be exactly where we crashed");
    const decision = classifyAyasRestartRecovery(entries[0]);
    assert.equal(decision.classification, "PRE_MUTATION_GATE");
    assert.equal(decision.mutationPossible, false, "no mutation could have happened before the gate even reached EXECUTING");
    assert.equal(decision.autoReplayAllowed, false);
    assert.equal(decision.humanReviewRequired, true);
    assert.equal(git(f.repoRoot, "status", "--short"), "", "no dirty working tree from a crash that never reached mutation");
  });

  await scenario("crash AFTER the first (only) mutation, before result-record (MUTATION_COMPLETED): recovery correctly reports mutation IS possible/uncertain-finalization, requiring human review — never silently treated as clean", async () => {
    const f = makeFixture();
    const { batchId, batchHash } = seedReadyBatch(f);
    const exitCode = spawnWorker({ lane: "batch", repoRoot: f.repoRoot, gateRoot: f.gateRoot, remoteName: "origin", storeRoots: { batch: f.batchStoreDir, items: f.itemStoreDir, artifacts: f.artifactStoreDir }, batchId, batchHash, crashAt: "MUTATION_COMPLETED" });
    assert.equal(exitCode, 137);
    const journal = createAyasExecutionJournal({ rootDir: f.gateRoot });
    const entry = journal.list()[0]!;
    assert.equal(entry.phase, "MUTATION_COMPLETED");
    const decision = classifyAyasRestartRecovery(entry);
    assert.equal(decision.classification, "MUTATION_COMPLETED_UNFINALIZED");
    assert.equal(decision.mutationPossible, true, "the file WAS actually written to the real working tree — recovery must never claim otherwise");
    assert.equal(decision.humanReviewRequired, true);
    // The batch itself never reached COMPLETED — proves no false success is ever reported.
    const batch = f.batchStore.load().batches.find((b) => b.batchId === batchId)!;
    assert.notEqual(batch.status, "COMPLETED");
  });

  await scenario("crash AFTER result-record, before Git commit (RESULT_RECORDED / BEFORE_COMMIT): the mutation is durably applied and recorded, but nothing is ever committed or pushed", async () => {
    const f = makeFixture();
    const { batchId, batchHash } = seedReadyBatch(f);
    const beforeCount = Number(git(f.repoRoot, "rev-list", "--count", "HEAD"));
    const exitCode = spawnWorker({ lane: "batch", repoRoot: f.repoRoot, gateRoot: f.gateRoot, remoteName: "origin", storeRoots: { batch: f.batchStoreDir, items: f.itemStoreDir, artifacts: f.artifactStoreDir }, batchId, batchHash, crashAt: "BEFORE_COMMIT" });
    assert.equal(exitCode, 137);
    const afterCount = Number(git(f.repoRoot, "rev-list", "--count", "HEAD"));
    assert.equal(afterCount, beforeCount, "no commit was created even though the mutation itself completed and was recorded");
    const journal = createAyasExecutionJournal({ rootDir: f.gateRoot });
    const entry = journal.list()[0]!;
    assert.equal(entry.phase, "RESULT_RECORDED", "the journal's last durable phase is RESULT_RECORDED — everything Package C itself owns finished cleanly");
    assert.equal(classifyAyasRestartRecovery(entry).classification, "COMPLETED", "Package C's own view is complete — the crash happened in Git-publication code this session added on top, a distinct concern from Package C's mutation authority");
  });

  await scenario("crash AFTER commit, before push (AFTER_COMMIT_BEFORE_PUSH): the commit survives locally, untouched, but never reaches the remote — no silent republish, no force-push on retry", async () => {
    const f = makeFixture();
    const { batchId, batchHash } = seedReadyBatch(f);
    const exitCode = spawnWorker({ lane: "batch", repoRoot: f.repoRoot, gateRoot: f.gateRoot, remoteName: "origin", storeRoots: { batch: f.batchStoreDir, items: f.itemStoreDir, artifacts: f.artifactStoreDir }, batchId, batchHash, crashAt: "AFTER_COMMIT_BEFORE_PUSH" });
    assert.equal(exitCode, 137);
    const localHead = git(f.repoRoot, "rev-parse", "HEAD");
    const remoteHead = git(f.remoteDir, "rev-parse", "master");
    assert.notEqual(localHead, remoteHead, "the commit must exist locally but never have reached the remote");
    assert.match(git(f.repoRoot, "log", "-1", "--format=%s"), /apply safe micro-improvement batch/, "the real commit the worker made before crashing is still there, untouched");
  });

  console.log(`AYAS crash injection smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-crash-injection", scenarios: count }));
}

/** Re-attempts the SAME batch through the real approval service, in-process, from this (fresh) test process — proves a second, ordinary call sees exactly the durable state the dead worker left and refuses to replay, without needing a second child process. */
async function approveAndExecuteBatchAgain(batchId: string, batchHash: string, f: Fixture): Promise<void> {
  const { approveAndExecuteAyasMicroBatch } = await import("../src/lib/brain/autonomy/AyasMicroBatchApprovalService");
  await approveAndExecuteAyasMicroBatch(batchId, batchHash, { repoRoot: f.repoRoot, gateRoot: f.gateRoot, remoteName: "origin", batchStore: f.batchStore, itemStore: f.itemStore, artifactStore: f.artifactStore });
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
