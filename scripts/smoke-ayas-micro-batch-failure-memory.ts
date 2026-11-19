import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { accumulateAyasMicroBatchCandidates } from "../src/lib/brain/autonomy/AyasMicroBatchAccumulator";
import {
  AYAS_MICRO_BATCH_TRANSIENT_ATTEMPTS,
  ayasMicroCandidateValidationFingerprint,
  classifyAyasMicroValidationFailure,
  createAyasMicroBatchFailureStore,
  isAyasMicroCandidateSuppressed,
} from "../src/lib/brain/autonomy/AyasMicroBatchFailureMemory";
import { createAyasMicroItemStore } from "../src/lib/brain/autonomy/AyasMicroItem";
import { createAyasMicroBatchStore } from "../src/lib/brain/autonomy/AyasMicroBatch";
import { createAyasPatchArtifactStore } from "../src/lib/brain/autonomy/AyasPatchArtifact";
import { createAyasSandboxUnvalidatableStore, type AyasSandboxUnvalidatableRecord } from "../src/lib/brain/autonomy/AyasSandboxUnvalidatableStore";
import { destroyAyasMicroBatchWorktree } from "../src/lib/brain/autonomy/AyasMicroBatchWorktree";
import { AyasValidatorFailedError } from "../src/lib/brain/autonomy/AyasMutationValidators";
import type { AyasDaemonObservation } from "../src/lib/brain/autonomy/AyasAutonomyDaemon";

/**
 * Owner decision 2026-11-19 ("mikro-parti başarısız adayı HEAD başına hatırlama"): on 14 Nov the micro-batch lane
 * re-validated `ayas-novel-v3-budget` every 5 minutes, 293 identical failures. A failed validation is remembered for its
 * HEAD + batch + candidate bytes; a real failure is not repeated, a transient one only a bounded number of times, and a
 * new HEAD (or candidate) is tried again.
 */

// The batch worktree has one fixed path under os.tmpdir(); a private TEMP keeps it away from the live Observer's own.
const privateTemp = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-micro-memory-suite-"));
process.env.TEMP = privateTemp; process.env.TMP = privateTemp; process.env.TMPDIR = privateTemp;
process.on("exit", () => { try { fs.rmSync(privateTemp, { recursive: true, force: true }); } catch { /* best effort */ } });

let count = 0;
async function scenario(name: string, fn: () => void | Promise<void>) { await fn(); count += 1; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }

function git(cwd: string, args: readonly string[]): string { return execFileSync("git", [...args], { cwd, encoding: "utf8", windowsHide: true }).trim(); }

function observationFor(repoRoot: string, head: string, now: string): AyasDaemonObservation {
  return { now, branch: git(repoRoot, ["branch", "--show-current"]), head, repoClean: true, graphifyFresh: true, machineAction: "ALLOW", gaps: [] };
}

function link(repoRoot: string, pkg: string): void {
  fs.mkdirSync(path.join(repoRoot, "node_modules"), { recursive: true });
  fs.symlinkSync(path.join(process.cwd(), "node_modules", pkg), path.join(repoRoot, "node_modules", pkg), process.platform === "win32" ? "junction" : "dir");
}

/** A fixture repo whose error classes are real error-code-contract gaps; `packages` decides which validator tools exist. */
function fixtureRepo(classSources: Record<string, string>, packages: readonly string[]): { readonly repoRoot: string; readonly head: string } {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-micro-memory-fixture-"));
  git(repoRoot, ["init", "-q"]); git(repoRoot, ["config", "user.email", "f@example.com"]); git(repoRoot, ["config", "user.name", "f"]);
  fs.mkdirSync(path.join(repoRoot, "src", "lib", "widget"), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, "scripts"), { recursive: true });
  for (const [name, source] of Object.entries(classSources)) fs.writeFileSync(path.join(repoRoot, "src", "lib", "widget", `${name}.ts`), source, "utf8");
  fs.writeFileSync(path.join(repoRoot, ".gitignore"), "node_modules/\n");
  fs.writeFileSync(path.join(repoRoot, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2020", module: "commonjs", moduleResolution: "node", esModuleInterop: true, strict: true, skipLibCheck: true, noEmit: true, types: ["node"] }, include: ["src/**/*.ts", "scripts/**/*.ts"], exclude: ["node_modules"] }, null, 2), "utf8");
  git(repoRoot, ["add", "-A"]); git(repoRoot, ["commit", "-q", "-m", "initial"]);
  for (const pkg of packages) link(repoRoot, pkg);
  return { repoRoot, head: git(repoRoot, ["rev-parse", "HEAD"]) };
}

function commitUnrelated(repoRoot: string, text: string): string {
  fs.writeFileSync(path.join(repoRoot, "README.md"), `${text}\n`, "utf8");
  git(repoRoot, ["add", "-A"]); git(repoRoot, ["commit", "-q", "-m", text]);
  return git(repoRoot, ["rev-parse", "HEAD"]);
}

function stores() {
  const tmp = (prefix: string) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return {
    itemStore: createAyasMicroItemStore({ rootDir: tmp("ayas-micro-memory-items-") }),
    batchStore: createAyasMicroBatchStore({ rootDir: tmp("ayas-micro-memory-batch-") }),
    artifactStore: createAyasPatchArtifactStore({ rootDir: tmp("ayas-micro-memory-artifacts-") }),
    failureStore: createAyasSandboxUnvalidatableStore({ rootDir: tmp("ayas-micro-memory-failures-") }),
  };
}

const invalidClass = (name: string) => `export class ${name} extends Error {\n  constructor(readonly code: "X", message: string) { super(message); }\n}\n`;
const validClass = (name: string) => `export class ${name} extends Error {\n  constructor(readonly code: "X", message: string) {\n    super(message);\n    this.name = "${name}";\n  }\n}\n`;

function record(overrides: Partial<AyasSandboxUnvalidatableRecord>): AyasSandboxUnvalidatableRecord {
  return { schemaVersion: "1", semanticKey: "k", generatorIdentity: "g", contentFingerprint: "fp", reason: "r", requiredCapability: "c", firstFailedAt: "2026-11-19T00:00:00.000Z", lastFailedAt: "2026-11-19T00:00:00.000Z", attemptCount: 1, ...overrides };
}

async function main(): Promise<void> {
  await scenario("classification: a validator verdict on the candidate is a real failure; timeouts, kills, missing tools and non-validator errors are transient", () => {
    const verdict = (summary: string) => new AyasValidatorFailedError([{ validator: "x", pass: false, summary }]);
    assert.equal(classifyAyasMicroValidationFailure(verdict("smoke test run failed: Command failed: node tsx scripts/smoke-x.ts AssertionError [ERR_ASSERTION]: Expected values to be strictly equal: 'Error' !== 'V3BudgetError'")), "VALIDATION_FAILED");
    assert.equal(classifyAyasMicroValidationFailure(verdict("Command failed: node typescript/bin/tsc --noEmit")), "VALIDATION_FAILED");
    assert.equal(classifyAyasMicroValidationFailure(verdict("smoke test did not report PASS")), "VALIDATION_FAILED");
    assert.equal(classifyAyasMicroValidationFailure(verdict("smoke test run failed: spawnSync node.exe ETIMEDOUT")), "TRANSIENT");
    assert.equal(classifyAyasMicroValidationFailure(verdict("tsc --noEmit timed out or was killed: Command failed: node tsc --noEmit")), "TRANSIENT");
    assert.equal(classifyAyasMicroValidationFailure(verdict("local tsx CLI is unavailable")), "TRANSIENT");
    assert.equal(classifyAyasMicroValidationFailure(verdict("local tsc binary is unavailable in sandbox")), "TRANSIENT");
    assert.equal(classifyAyasMicroValidationFailure(verdict("smoke test skipped itself (PASS with 0 scenarios) — not validation evidence")), "TRANSIENT");
    assert.equal(classifyAyasMicroValidationFailure(verdict("validator threw: boom")), "TRANSIENT");
    assert.equal(classifyAyasMicroValidationFailure(new Error("EBUSY: resource busy or locked")), "TRANSIENT");
    assert.equal(classifyAyasMicroValidationFailure("not even an error"), "TRANSIENT");
  });

  await scenario("fingerprint: HEAD, batch, generator, file path and bytes each change it; batch and file order do not", () => {
    const base = { head: "a".repeat(40), batchPatchHashes: ["h1", "h2"], generatorIdentity: "g@1", replacements: [{ filePath: "scripts/a.ts", content: "x" }, { filePath: "scripts/b.ts", content: "y" }] };
    const fp = ayasMicroCandidateValidationFingerprint(base);
    assert.match(fp, /^[0-9a-f]{64}$/);
    assert.equal(ayasMicroCandidateValidationFingerprint({ ...base, batchPatchHashes: ["h2", "h1"], replacements: [...base.replacements].reverse() }), fp);
    for (const changed of [
      { ...base, head: "b".repeat(40) },
      { ...base, batchPatchHashes: ["h1"] },
      { ...base, generatorIdentity: "g@2" },
      { ...base, replacements: [{ filePath: "scripts/a.ts", content: "x2" }, base.replacements[1]!] },
      { ...base, replacements: [{ filePath: "scripts/c.ts", content: "x" }, base.replacements[1]!] },
    ]) assert.notEqual(ayasMicroCandidateValidationFingerprint(changed), fp);
  });

  await scenario("suppression: only the same fingerprint suppresses; a real failure at once, a transient one after the bounded attempts", () => {
    assert.equal(isAyasMicroCandidateSuppressed(undefined, "fp"), false);
    assert.equal(isAyasMicroCandidateSuppressed(record({}), "other"), false);
    assert.equal(isAyasMicroCandidateSuppressed(record({}), "fp"), true);
    for (let attempt = 1; attempt < AYAS_MICRO_BATCH_TRANSIENT_ATTEMPTS; attempt += 1) {
      assert.equal(isAyasMicroCandidateSuppressed(record({ retryable: true, attemptCount: attempt }), "fp"), false, `transient attempt ${attempt} is retried`);
    }
    assert.equal(isAyasMicroCandidateSuppressed(record({ retryable: true, attemptCount: AYAS_MICRO_BATCH_TRANSIENT_ATTEMPTS }), "fp"), true);
    assert.ok(createAyasMicroBatchFailureStore(path.join("D:", "repo")).dir.endsWith(path.join("data", "brain", "self-improvement", "sandbox-unvalidatable", "micro-batch")));
  });

  await scenario("real validation failure: tried once per HEAD, never again at the same HEAD, again after the HEAD moves; a failed candidate no longer starves the next one", async () => {
    const { repoRoot, head } = fixtureRepo({ "1AaaError": invalidClass("1AaaError"), "2BbbError": invalidClass("2BbbError"), "3CccError": invalidClass("3CccError") }, ["tsx", "typescript", "@types"]);
    await destroyAyasMicroBatchWorktree(repoRoot);
    try {
      const s = stores();
      const tick1 = await accumulateAyasMicroBatchCandidates({ repoRoot, observation: observationFor(repoRoot, head, "2026-11-19T00:00:00.000Z"), ...s, maxAttemptsPerTick: 2 });
      assert.deepEqual(tick1.itemsAdded, []);
      assert.equal(tick1.rejections.length, 2);
      const firstTwo = tick1.rejections.map((r) => r.semanticKey);
      for (const key of firstTwo) {
        const saved = s.failureStore.load(key)!;
        assert.equal(saved.retryable, undefined, "a type error is the candidate's own failure");
        assert.match(saved.reason, /\(VALIDATION_FAILED\)/);
      }
      const tick2 = await accumulateAyasMicroBatchCandidates({ repoRoot, observation: observationFor(repoRoot, head, "2026-11-19T00:05:00.000Z"), ...s, maxAttemptsPerTick: 2 });
      assert.equal(tick2.rejections.length, 1, "the two remembered failures are skipped without an attempt; the third candidate finally gets its turn");
      assert.equal(firstTwo.includes(tick2.rejections[0]!.semanticKey), false);
      const tick3 = await accumulateAyasMicroBatchCandidates({ repoRoot, observation: observationFor(repoRoot, head, "2026-11-19T00:10:00.000Z"), ...s, maxAttemptsPerTick: 2 });
      assert.deepEqual(tick3.rejections, [], "same HEAD, same candidates: no sandbox attempt at all");
      const head2 = commitUnrelated(repoRoot, "unrelated");
      const tick4 = await accumulateAyasMicroBatchCandidates({ repoRoot, observation: observationFor(repoRoot, head2, "2026-11-19T00:15:00.000Z"), ...s, maxAttemptsPerTick: 2 });
      assert.equal(tick4.rejections.length, 2, "a new HEAD tries the remembered candidates again");
      assert.equal(s.failureStore.load(tick4.rejections[0]!.semanticKey)!.attemptCount, 1, "a new fingerprint starts its own count");
    } finally {
      await destroyAyasMicroBatchWorktree(repoRoot);
    }
  });

  await scenario("transient failure: retried a bounded number of times at the same HEAD, then held; a fixed environment on a new HEAD lets the candidate through", async () => {
    // typescript is present (typecheck passes) but tsx is not: the smoke validator reports "local tsx CLI is unavailable".
    const { repoRoot, head } = fixtureRepo({ OnlyOneError: validClass("OnlyOneError") }, ["typescript", "@types"]);
    await destroyAyasMicroBatchWorktree(repoRoot);
    try {
      const s = stores();
      for (let attempt = 1; attempt <= AYAS_MICRO_BATCH_TRANSIENT_ATTEMPTS; attempt += 1) {
        const tick = await accumulateAyasMicroBatchCandidates({ repoRoot, observation: observationFor(repoRoot, head, `2026-11-19T0${attempt}:00:00.000Z`), ...s, maxAttemptsPerTick: 1 });
        assert.equal(tick.rejections.length, 1, `transient attempt ${attempt} runs`);
        const saved = s.failureStore.load(tick.rejections[0]!.semanticKey)!;
        assert.equal(saved.retryable, true); assert.equal(saved.attemptCount, attempt); assert.match(saved.reason, /\(TRANSIENT\)/);
      }
      const held = await accumulateAyasMicroBatchCandidates({ repoRoot, observation: observationFor(repoRoot, head, "2026-11-19T09:00:00.000Z"), ...s, maxAttemptsPerTick: 1 });
      assert.deepEqual(held.rejections, [], "after the bounded transient attempts the same validation is held at this HEAD");
      assert.deepEqual(held.itemsAdded, []);
      link(repoRoot, "tsx");
      const head2 = commitUnrelated(repoRoot, "environment fixed");
      const fixed = await accumulateAyasMicroBatchCandidates({ repoRoot, observation: observationFor(repoRoot, head2, "2026-11-19T10:00:00.000Z"), ...s, maxAttemptsPerTick: 1 });
      assert.deepEqual(fixed.rejections, []);
      assert.equal(fixed.itemsAdded.length, 1, "on a new HEAD the candidate is validated again and accepted");
      assert.equal(fixed.itemsAdded[0]!.state, "BATCHED");
    } finally {
      await destroyAyasMicroBatchWorktree(repoRoot);
    }
  });

  await scenario("an unreadable memory record never suppresses (retrying costs an attempt, never authority)", async () => {
    const { repoRoot, head } = fixtureRepo({ "1AaaError": invalidClass("1AaaError") }, ["tsx", "typescript", "@types"]);
    await destroyAyasMicroBatchWorktree(repoRoot);
    try {
      const s = stores();
      const tick1 = await accumulateAyasMicroBatchCandidates({ repoRoot, observation: observationFor(repoRoot, head, "2026-11-19T00:00:00.000Z"), ...s, maxAttemptsPerTick: 1 });
      assert.equal(tick1.rejections.length, 1);
      for (const file of fs.readdirSync(s.failureStore.dir)) fs.writeFileSync(path.join(s.failureStore.dir, file), "{ not json", "utf8");
      const tick2 = await accumulateAyasMicroBatchCandidates({ repoRoot, observation: observationFor(repoRoot, head, "2026-11-19T00:05:00.000Z"), ...s, maxAttemptsPerTick: 1 });
      assert.equal(tick2.rejections.length, 1);
      assert.equal(s.failureStore.load(tick2.rejections[0]!.semanticKey)!.attemptCount, 1, "the corrupt record is replaced by a fresh one");
    } finally {
      await destroyAyasMicroBatchWorktree(repoRoot);
    }
  });

  console.log(`AYAS micro batch failure memory smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-micro-batch-failure-memory", scenarios: count }));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
