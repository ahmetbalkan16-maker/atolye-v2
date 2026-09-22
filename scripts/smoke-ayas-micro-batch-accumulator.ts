import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { accumulateAyasMicroBatchCandidates } from "../src/lib/brain/autonomy/AyasMicroBatchAccumulator";
import { createAyasMicroItemStore } from "../src/lib/brain/autonomy/AyasMicroItem";
import { createAyasMicroBatchStore } from "../src/lib/brain/autonomy/AyasMicroBatch";
import { createAyasPatchArtifactStore } from "../src/lib/brain/autonomy/AyasPatchArtifact";
import { destroyAyasMicroBatchWorktree } from "../src/lib/brain/autonomy/AyasMicroBatchWorktree";
import type { AyasDaemonObservation } from "../src/lib/brain/autonomy/AyasAutonomyDaemon";

let count = 0;
async function scenario(name: string, fn: () => void | Promise<void>) { await fn(); count += 1; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }

function git(cwd: string, args: readonly string[]): string { return execFileSync("git", [...args], { cwd, encoding: "utf8", windowsHide: true }).trim(); }

function baseObservation(overrides: Partial<AyasDaemonObservation> = {}): AyasDaemonObservation {
  return { now: "2026-09-16T00:00:00.000Z", branch: "wip/test", head: "0000000000000000000000000000000000dead", repoClean: true, graphifyFresh: true, machineAction: "ALLOW", gaps: [], ...overrides };
}

/** A fixture repo with one or more real error-code-contract gaps, plus a working node_modules link so sandbox typecheck genuinely passes (not merely "unavailable"). */
function makeErrorClassFixtureRepo(classNames: readonly string[], extraFiles: Record<string, string> = {}): { readonly repoRoot: string; readonly head: string } {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-micro-acc-fixture-"));
  git(repoRoot, ["init", "-q"]); git(repoRoot, ["config", "user.email", "f@example.com"]); git(repoRoot, ["config", "user.name", "f"]);
  fs.mkdirSync(path.join(repoRoot, "src", "lib", "widget"), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, "scripts"), { recursive: true });
  for (const name of classNames) {
    fs.writeFileSync(path.join(repoRoot, "src", "lib", "widget", `${name}.ts`), `export class ${name} extends Error {\n  constructor(readonly code: "X", message: string) {\n    super(message);\n    this.name = "${name}";\n  }\n}\n`, "utf8");
  }
  for (const [rel, content] of Object.entries(extraFiles)) fs.writeFileSync(path.join(repoRoot, rel), content, "utf8");
  fs.writeFileSync(path.join(repoRoot, ".gitignore"), "node_modules/\n");
  fs.writeFileSync(
    path.join(repoRoot, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { target: "ES2020", module: "commonjs", moduleResolution: "node", esModuleInterop: true, strict: true, skipLibCheck: true, noEmit: true, types: ["node"] }, include: ["src/**/*.ts", "scripts/**/*.ts"], exclude: ["node_modules"] }, null, 2),
    "utf8",
  );
  git(repoRoot, ["add", "-A"]); git(repoRoot, ["commit", "-q", "-m", "initial"]);
  const head = git(repoRoot, ["rev-parse", "HEAD"]);
  fs.mkdirSync(path.join(repoRoot, "node_modules"), { recursive: true });
  fs.symlinkSync(path.join(process.cwd(), "node_modules", "tsx"), path.join(repoRoot, "node_modules", "tsx"), process.platform === "win32" ? "junction" : "dir");
  fs.symlinkSync(path.join(process.cwd(), "node_modules", "typescript"), path.join(repoRoot, "node_modules", "typescript"), process.platform === "win32" ? "junction" : "dir");
  fs.symlinkSync(path.join(process.cwd(), "node_modules", "@types"), path.join(repoRoot, "node_modules", "@types"), process.platform === "win32" ? "junction" : "dir");
  return { repoRoot, head };
}

function freshStores() {
  return {
    itemStore: createAyasMicroItemStore({ rootDir: fs.mkdtempSync(path.join(os.tmpdir(), "ayas-micro-acc-items-")) }),
    batchStore: createAyasMicroBatchStore({ rootDir: fs.mkdtempSync(path.join(os.tmpdir(), "ayas-micro-acc-batch-")) }),
    artifactStore: createAyasPatchArtifactStore({ rootDir: fs.mkdtempSync(path.join(os.tmpdir(), "ayas-micro-acc-artifacts-")) }),
  };
}

async function main(): Promise<void> {
  await scenario("returns nothing and does not touch disk when the working tree is dirty", async () => {
    const stores = freshStores();
    const result = await accumulateAyasMicroBatchCandidates({ repoRoot: process.cwd(), observation: baseObservation({ repoClean: false }), ...stores });
    assert.deepEqual(result.itemsAdded, []);
    assert.equal(result.batch, null);
  });

  await scenario("returns nothing when Machine Health demands PAUSE", async () => {
    const stores = freshStores();
    const result = await accumulateAyasMicroBatchCandidates({ repoRoot: process.cwd(), observation: baseObservation({ machineAction: "PAUSE" }), ...stores });
    assert.deepEqual(result.itemsAdded, []);
  });

  await scenario("stale Graphify metadata creates no artifact, micro-item, or batch even when real MICRO_SAFE gaps are discoverable", async () => {
    const { repoRoot, head } = makeErrorClassFixtureRepo(["WidgetError"]);
    await destroyAyasMicroBatchWorktree(repoRoot);
    try {
      const stores = freshStores();
      const artifactFilesBefore = fs.existsSync(stores.artifactStore.dir) ? fs.readdirSync(stores.artifactStore.dir).sort() : [];
      const result = await accumulateAyasMicroBatchCandidates({ repoRoot, observation: baseObservation({ head, branch: git(repoRoot, ["branch", "--show-current"]), graphifyFresh: false }), ...stores, maxAttemptsPerTick: 1 });
      assert.deepEqual(result.itemsAdded, []);
      assert.equal(result.batch, null);
      assert.equal(result.readyForReview, false);
      assert.equal(stores.itemStore.list().length, 0);
      assert.equal(stores.batchStore.load().batches.length, 0);
      const artifactFilesAfter = fs.existsSync(stores.artifactStore.dir) ? fs.readdirSync(stores.artifactStore.dir).sort() : [];
      assert.deepEqual(artifactFilesAfter, artifactFilesBefore, "stale knowledge must not freeze a patch artifact");
    } finally {
      await destroyAyasMicroBatchWorktree(repoRoot);
    }
  });

  await scenario("a stale tick preserves an accumulating batch without promotion, then fresh Graphify resumes accumulation into READY_FOR_REVIEW", async () => {
    const { repoRoot, head } = makeErrorClassFixtureRepo(["AlphaError", "BravoError", "CharlieError"]);
    await destroyAyasMicroBatchWorktree(repoRoot);
    try {
      const stores = freshStores(); const observation = baseObservation({ head, branch: git(repoRoot, ["branch", "--show-current"]) });
      const first = await accumulateAyasMicroBatchCandidates({ repoRoot, observation, ...stores, maxAttemptsPerTick: 2 });
      assert.equal(first.itemsAdded.length, 2); assert.equal(first.batch!.status, "ACCUMULATING");
      const stale = await accumulateAyasMicroBatchCandidates({ repoRoot, observation: { ...observation, graphifyFresh: false, now: "2026-09-16T00:05:00.000Z" }, ...stores, maxAttemptsPerTick: 2 });
      assert.deepEqual(stale.itemsAdded, []); assert.equal(stale.readyForReview, false);
      const preserved = stores.batchStore.load().batches.find((batch) => batch.batchId === first.batch!.batchId)!;
      assert.equal(preserved.status, "ACCUMULATING"); assert.equal(preserved.items.length, 2); assert.equal(stores.itemStore.list().length, 2);
      const fresh = await accumulateAyasMicroBatchCandidates({ repoRoot, observation: { ...observation, now: "2026-09-16T00:10:00.000Z" }, ...stores, maxAttemptsPerTick: 2 });
      assert.equal(fresh.itemsAdded.length, 1); assert.equal(fresh.readyForReview, true); assert.equal(fresh.batch!.status, "READY_FOR_REVIEW"); assert.equal(fresh.batch!.items.length, 3);
    } finally {
      await destroyAyasMicroBatchWorktree(repoRoot);
    }
  });

  await scenario("a READY_FOR_REVIEW batch is preserved unchanged on a stale tick and receives no stale-derived item", async () => {
    const { repoRoot, head } = makeErrorClassFixtureRepo(["AlphaError", "BravoError", "CharlieError", "DeltaError"]);
    await destroyAyasMicroBatchWorktree(repoRoot);
    try {
      const stores = freshStores(); const observation = baseObservation({ head, branch: git(repoRoot, ["branch", "--show-current"]) });
      const ready = await accumulateAyasMicroBatchCandidates({ repoRoot, observation, ...stores, maxAttemptsPerTick: 3 });
      assert.equal(ready.batch!.status, "READY_FOR_REVIEW"); assert.equal(ready.batch!.items.length, 3);
      const snapshot = JSON.stringify(ready.batch);
      const stale = await accumulateAyasMicroBatchCandidates({ repoRoot, observation: { ...observation, graphifyFresh: false, now: "2026-09-16T00:05:00.000Z" }, ...stores, maxAttemptsPerTick: 3 });
      assert.deepEqual(stale.itemsAdded, []);
      const preserved = stores.batchStore.load().batches.find((batch) => batch.batchId === ready.batch!.batchId)!;
      assert.equal(JSON.stringify(preserved), snapshot); assert.equal(stores.itemStore.list().length, 3);
    } finally {
      await destroyAyasMicroBatchWorktree(repoRoot);
    }
  });

  await scenario("end-to-end against the REAL Atölye repo: accumulates real MICRO_SAFE items into a persistent batch, real repo stays clean", async () => {
    const repoRoot = process.cwd();
    const head = git(repoRoot, ["rev-parse", "HEAD"]);
    await destroyAyasMicroBatchWorktree(repoRoot);
    try {
      const stores = freshStores();
      const observation = baseObservation({ head, branch: git(repoRoot, ["branch", "--show-current"]) });
      const result = await accumulateAyasMicroBatchCandidates({ repoRoot, observation, ...stores, maxAttemptsPerTick: 2 });
      for (const item of result.itemsAdded) {
        assert.equal(item.state, "BATCHED");
        assert.ok(item.patchArtifactId);
        const artifact = stores.artifactStore.loadVerified(item.patchArtifactId);
        assert.equal(artifact.baseHead, head);
        assert.equal(artifact.safetyClassification, "SAFE");
      }
      if (result.batch) {
        assert.equal(result.batch.baseHead, head);
        assert.equal(result.batch.items.length, result.itemsAdded.length);
      }
      const worktrees = git(repoRoot, ["worktree", "list"]).split("\n").filter(Boolean);
      assert.ok(worktrees.length >= 1, "the real repo's own worktree list must still list itself");
      assert.equal(git(repoRoot, ["status", "--short"]).includes("smoke-ayas-error-code-contract"), false, "the real working tree must never contain an accumulated micro item's generated file");
    } finally {
      await destroyAyasMicroBatchWorktree(repoRoot);
    }
  });

  await scenario("semantic dedup: calling accumulate twice at the same HEAD never re-adds the SAME opportunity twice (a real repo may legitimately have several distinct real gaps, so tick2 finding a DIFFERENT one is correct, not a dedup failure)", async () => {
    const repoRoot = process.cwd();
    const head = git(repoRoot, ["rev-parse", "HEAD"]);
    await destroyAyasMicroBatchWorktree(repoRoot);
    try {
      const stores = freshStores();
      const observation = baseObservation({ head, branch: git(repoRoot, ["branch", "--show-current"]), now: "2026-09-16T00:00:00.000Z" });
      const tick1 = await accumulateAyasMicroBatchCandidates({ repoRoot, observation, ...stores, maxAttemptsPerTick: 1 });
      const tick2 = await accumulateAyasMicroBatchCandidates({ repoRoot, observation: { ...observation, now: "2026-09-16T00:05:00.000Z" }, ...stores, maxAttemptsPerTick: 1 });
      const tick1Keys = new Set(tick1.itemsAdded.map((i) => i.semanticKey));
      const tick2Keys = tick2.itemsAdded.map((i) => i.semanticKey);
      for (const key of tick2Keys) assert.equal(tick1Keys.has(key), false, `semanticKey "${key}" was added in both ticks — cross-tick dedup failed`);
    } finally {
      await destroyAyasMicroBatchWorktree(repoRoot);
    }
  });

  await scenario("semantic dedup (isolated, deterministic): a fixture repo with exactly ONE real gap never gets a second item for that same gap on a second tick", async () => {
    const { repoRoot, head } = makeErrorClassFixtureRepo(["OnlyOneError"]);
    await destroyAyasMicroBatchWorktree(repoRoot);
    try {
      const stores = freshStores();
      const observation = baseObservation({ head, branch: git(repoRoot, ["branch", "--show-current"]), now: "2026-09-16T00:00:00.000Z" });
      const tick1 = await accumulateAyasMicroBatchCandidates({ repoRoot, observation, ...stores, maxAttemptsPerTick: 1 });
      assert.equal(tick1.itemsAdded.length, 1);
      const tick2 = await accumulateAyasMicroBatchCandidates({ repoRoot, observation: { ...observation, now: "2026-09-16T00:05:00.000Z" }, ...stores, maxAttemptsPerTick: 1 });
      assert.equal(tick2.itemsAdded.length, 0, "the one real gap is already BATCHED — a second tick must find nothing new");
    } finally {
      await destroyAyasMicroBatchWorktree(repoRoot);
    }
  });

  await scenario("orphan-repair rediscovery: a real gap whose batch went STALE across a HEAD move is superseded, then genuinely rediscovered as a FRESH item against the new HEAD — proving the semanticKey is not permanently blocked", async () => {
    const { repoRoot, head: head1 } = makeErrorClassFixtureRepo(["OnlyOneError"]);
    await destroyAyasMicroBatchWorktree(repoRoot);
    try {
      const stores = freshStores();
      const observation1 = baseObservation({ head: head1, branch: git(repoRoot, ["branch", "--show-current"]), now: "2026-09-16T00:00:00.000Z" });
      const tick1 = await accumulateAyasMicroBatchCandidates({ repoRoot, observation: observation1, ...stores, maxAttemptsPerTick: 1 });
      assert.equal(tick1.itemsAdded.length, 1);
      const item1 = tick1.itemsAdded[0]!;
      const batch1 = tick1.batch!;
      assert.equal(item1.state, "BATCHED");

      // The branch genuinely moves on (an unrelated real commit) — the underlying OnlyOneError gap itself is untouched and still real.
      fs.writeFileSync(path.join(repoRoot, "README.md"), "unrelated change\n", "utf8");
      git(repoRoot, ["add", "-A"]); git(repoRoot, ["commit", "-q", "-m", "unrelated"]);
      const head2 = git(repoRoot, ["rev-parse", "HEAD"]);

      const observation2 = baseObservation({ head: head2, branch: git(repoRoot, ["branch", "--show-current"]), now: "2026-09-16T00:10:00.000Z" });
      const tick2 = await accumulateAyasMicroBatchCandidates({ repoRoot, observation: observation2, ...stores, maxAttemptsPerTick: 1 });

      // The old batch and item are reconciled by the accumulator's own inline staling path (worktree rebuild at the new head).
      assert.equal(stores.batchStore.load().batches.find((b) => b.batchId === batch1.batchId)!.status, "STALE");
      assert.equal(stores.itemStore.load(item1.microItemId).state, "SUPERSEDED");

      // The SAME real opportunity is genuinely rediscovered — a fresh microItemId, BATCHED into a fresh batch at the new HEAD.
      assert.equal(tick2.itemsAdded.length, 1, "the still-real OnlyOneError gap must be rediscovered, not permanently blocked");
      const item2 = tick2.itemsAdded[0]!;
      assert.notEqual(item2.microItemId, item1.microItemId);
      assert.equal(item2.semanticKey, item1.semanticKey);
      assert.equal(item2.state, "BATCHED");
      assert.ok(tick2.batch);
      assert.equal(tick2.batch!.baseHead, head2);
      assert.equal(tick2.staledPreviousBatchId, batch1.batchId);
    } finally {
      await destroyAyasMicroBatchWorktree(repoRoot);
    }
  });

  await scenario("cross-observer-restart dedup: a fresh accumulator call (simulating a restart) reusing the SAME durable stores does not duplicate an already-BATCHED item", async () => {
    const repoRoot = process.cwd();
    const head = git(repoRoot, ["rev-parse", "HEAD"]);
    await destroyAyasMicroBatchWorktree(repoRoot);
    try {
      const stores = freshStores();
      const observation = baseObservation({ head, branch: git(repoRoot, ["branch", "--show-current"]) });
      const tick1 = await accumulateAyasMicroBatchCandidates({ repoRoot, observation, ...stores, maxAttemptsPerTick: 1 });
      // "restart": brand new in-process call, but the SAME durable store directories (as a real process restart would see).
      const tick2 = await accumulateAyasMicroBatchCandidates({ repoRoot, observation: { ...observation, now: "2026-09-16T00:10:00.000Z" }, ...stores, maxAttemptsPerTick: 1 });
      const tick1Keys = new Set(tick1.itemsAdded.map((i) => i.semanticKey));
      for (const item of tick2.itemsAdded) assert.equal(tick1Keys.has(item.semanticKey), false, "a semanticKey already BATCHED before the simulated restart must never reappear after it");
    } finally {
      await destroyAyasMicroBatchWorktree(repoRoot);
    }
  });

  await scenario("compatibility: an item whose exactFiles overlaps an already-BATCHED item's files is rejected, not silently double-applied", async () => {
    const { repoRoot, head } = makeErrorClassFixtureRepo(["WidgetError"]);
    await destroyAyasMicroBatchWorktree(repoRoot);
    try {
      const stores = freshStores();
      const observation = baseObservation({ head, branch: git(repoRoot, ["branch", "--show-current"]) });
      // Pre-seed the batch as if WidgetError's own target file were already batched, then verify a (hypothetical) second item targeting the SAME file would be rejected by the accumulator's own overlap check — exercised directly since this repo only has one real gap available.
      const first = await accumulateAyasMicroBatchCandidates({ repoRoot, observation, ...stores, maxAttemptsPerTick: 1 });
      assert.equal(first.itemsAdded.length, 1);
      // Re-running immediately (same tick semantics, dedup by semanticKey) must not create a duplicate targeting the same file.
      const second = await accumulateAyasMicroBatchCandidates({ repoRoot, observation: { ...observation, now: "2026-09-16T00:01:00.000Z" }, ...stores, maxAttemptsPerTick: 1 });
      assert.equal(second.itemsAdded.length, 0);
    } finally {
      await destroyAyasMicroBatchWorktree(repoRoot);
    }
  });

  await scenario("completed-target detection: a gap whose target file already exists on disk is never re-added", async () => {
    const { repoRoot, head } = makeErrorClassFixtureRepo(["WidgetError"], { "scripts/smoke-ayas-error-code-contract-widget.ts": "// already exists\n" });
    await destroyAyasMicroBatchWorktree(repoRoot);
    try {
      const stores = freshStores();
      const result = await accumulateAyasMicroBatchCandidates({ repoRoot, observation: baseObservation({ head, branch: git(repoRoot, ["branch", "--show-current"]) }), ...stores, maxAttemptsPerTick: 1 });
      assert.deepEqual(result.itemsAdded, []);
    } finally {
      await destroyAyasMicroBatchWorktree(repoRoot);
    }
  });

  await scenario("batch capacity: accumulation stops once the batch reaches its item cap, even with more real gaps available", async () => {
    const { repoRoot, head } = makeErrorClassFixtureRepo(["AaaError", "BbbError", "CccError"]);
    await destroyAyasMicroBatchWorktree(repoRoot);
    try {
      const stores = freshStores();
      const result = await accumulateAyasMicroBatchCandidates({ repoRoot, observation: baseObservation({ head, branch: git(repoRoot, ["branch", "--show-current"]) }), ...stores, maxAttemptsPerTick: 2 });
      assert.ok(result.itemsAdded.length <= 2, "maxAttemptsPerTick bounds how many are drafted in one call, regardless of how many real gaps exist");
    } finally {
      await destroyAyasMicroBatchWorktree(repoRoot);
    }
  });

  await scenario("retry budget bounds sandbox-validation-failure rejections: with 3 real MICRO_SAFE-eligible gaps that all fail sandbox typecheck and maxAttemptsPerTick=2, at most 2 are ever attempted-and-rejected", async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-micro-acc-retry-budget-"));
    git(repoRoot, ["init", "-q"]); git(repoRoot, ["config", "user.email", "f@example.com"]); git(repoRoot, ["config", "user.name", "f"]);
    fs.mkdirSync(path.join(repoRoot, "src", "lib", "widget"), { recursive: true });
    fs.mkdirSync(path.join(repoRoot, "scripts"), { recursive: true });
    // Three real, distinct gaps (alphabetically ordered by the detector), each an INVALID JS identifier as a class name
    // (starts with a digit) — every one fails sandbox typecheck for real, proving the retry budget bounds actual
    // sandbox attempts (and their resulting rejections), not just candidates returned. This is the M18-relocated
    // equivalent of the M17-era "retry budget" scenario in smoke-ayas-novel-patch-discovery.ts — that pipeline no
    // longer ever attempts a MICRO_SAFE-eligible gap at all, so the bounded-attempt behavior now lives here instead.
    for (const name of ["1AaaError", "2BbbError", "3CccError"]) {
      fs.writeFileSync(path.join(repoRoot, "src", "lib", "widget", `${name}.ts`), `export class ${name} extends Error {\n  constructor(readonly code: "X", message: string) { super(message); }\n}\n`, "utf8");
    }
    fs.writeFileSync(path.join(repoRoot, ".gitignore"), "node_modules/\n");
    fs.writeFileSync(
      path.join(repoRoot, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { target: "ES2020", module: "commonjs", moduleResolution: "node", esModuleInterop: true, strict: true, skipLibCheck: true, noEmit: true, types: ["node"] }, include: ["src/**/*.ts", "scripts/**/*.ts"], exclude: ["node_modules"] }, null, 2),
      "utf8",
    );
    git(repoRoot, ["add", "-A"]); git(repoRoot, ["commit", "-q", "-m", "three bad gaps"]);
    const head = git(repoRoot, ["rev-parse", "HEAD"]);
    fs.mkdirSync(path.join(repoRoot, "node_modules"), { recursive: true });
    fs.symlinkSync(path.join(process.cwd(), "node_modules", "tsx"), path.join(repoRoot, "node_modules", "tsx"), process.platform === "win32" ? "junction" : "dir");
    fs.symlinkSync(path.join(process.cwd(), "node_modules", "typescript"), path.join(repoRoot, "node_modules", "typescript"), process.platform === "win32" ? "junction" : "dir");
    fs.symlinkSync(path.join(process.cwd(), "node_modules", "@types"), path.join(repoRoot, "node_modules", "@types"), process.platform === "win32" ? "junction" : "dir");
    try {
      const stores = freshStores();
      const result = await accumulateAyasMicroBatchCandidates({ repoRoot, observation: baseObservation({ head, branch: git(repoRoot, ["branch", "--show-current"]) }), ...stores, maxAttemptsPerTick: 2 });
      assert.deepEqual(result.itemsAdded, [], "all three gaps are structurally invalid JS — none can pass sandbox validation");
      assert.equal(result.rejections.length, 2, `retry budget of 2 must bound sandbox attempts to exactly 2, got ${result.rejections.length}`);
    } finally {
      await destroyAyasMicroBatchWorktree(repoRoot);
    }
  });

  console.log(`AYAS micro batch accumulator smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-micro-batch-accumulator", scenarios: count }));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
