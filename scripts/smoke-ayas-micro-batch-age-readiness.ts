import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { accumulateAyasMicroBatchCandidates } from "../src/lib/brain/autonomy/AyasMicroBatchAccumulator";
import { createAyasMicroItemStore } from "../src/lib/brain/autonomy/AyasMicroItem";
import { createAyasMicroBatchStore } from "../src/lib/brain/autonomy/AyasMicroBatch";
import { createAyasPatchArtifactStore } from "../src/lib/brain/autonomy/AyasPatchArtifact";
import { resolveAyasMicroBatchWorktreeRoot } from "../src/lib/brain/autonomy/AyasMicroBatchWorktree";
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
  const previous = { TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR };
  const privateTemp = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-age-readiness-"));
  process.env.TEMP = privateTemp; process.env.TMP = privateTemp; process.env.TMPDIR = privateTemp;
  assert.equal(path.dirname(path.resolve(resolveAyasMicroBatchWorktreeRoot(process.cwd()))), fs.realpathSync(privateTemp), "fixed worktree must resolve INSIDE this suite's own private TEMP");
  try {
    const { repoRoot, head } = makeErrorClassFixtureRepo(["OnlyOneError"]);
    const stores = freshStores();
    const observation = baseObservation({ head, branch: git(repoRoot, ["branch", "--show-current"]) });
    const first = await accumulateAyasMicroBatchCandidates({ repoRoot, observation, ...stores, maxAttemptsPerTick: 1 });
    assert.equal(first.itemsAdded.length, 1, "one genuinely validated micro item is required");
    assert.equal(first.batch!.status, "ACCUMULATING");
    const id = first.batch!.batchId;
    const beforeItems = JSON.stringify(stores.itemStore.list());
    await scenario("one validated item remains accumulating before 24 hours", async () => {
      const result = await accumulateAyasMicroBatchCandidates({ repoRoot, observation: { ...observation, now: "2026-09-16T23:59:59.999Z" }, ...stores });
      assert.equal(result.itemsAdded.length, 0); assert.equal(result.readyForReview, false);
      assert.equal(result.batch!.status, "ACCUMULATING");
    });
    for (const [name, overrides] of [
      ["stale graph", { graphifyFresh: false }],
      ["dirty repo", { repoClean: false }],
      ["machine pause", { machineAction: "PAUSE" as const }],
      ["new heavy work blocked", { machineAction: "BLOCK NEW HEAVY WORK" as const }],
    ] as const) {
      await scenario(`age readiness cannot bypass ${name}`, async () => {
        const before = JSON.stringify(stores.batchStore.load());
        const result = await accumulateAyasMicroBatchCandidates({ repoRoot, observation: { ...observation, now: "2026-09-17T00:00:00.000Z", ...overrides }, ...stores });
        assert.equal(result.readyForReview, false);
        assert.equal(JSON.stringify(stores.batchStore.load()), before, "blocked discovery must preserve durable batch state");
      });
    }
    await scenario("at 24 hours, no new candidate is needed to request owner review", async () => {
      const result = await accumulateAyasMicroBatchCandidates({ repoRoot, observation: { ...observation, now: "2026-09-17T00:00:00.000Z" }, ...stores });
      assert.equal(result.itemsAdded.length, 0); assert.equal(result.rejections.length, 0);
      assert.equal(result.readyForReview, true, "a validated single-item batch must not wait forever when no new gaps are found");
      assert.equal(result.batch!.status, "READY_FOR_REVIEW"); assert.equal(result.batch!.batchId, id);
      assert.equal(JSON.stringify(stores.itemStore.list()), beforeItems, "readiness must preserve items");
      assert.equal(stores.batchStore.load().decisions.length, 0, "review readiness grants no execution authority");
      assert.equal(stores.batchStore.load().results.length, 0, "nothing executed or published");
    });
    await scenario("another tick is idempotent after readiness", async () => {
      const before = JSON.stringify(stores.batchStore.load());
      const result = await accumulateAyasMicroBatchCandidates({ repoRoot, observation: { ...observation, now: "2026-09-17T00:05:00.000Z" }, ...stores });
      assert.equal(result.readyForReview, true); assert.equal(JSON.stringify(stores.batchStore.load()), before);
    });
  } finally {
    if (previous.TEMP === undefined) delete process.env.TEMP; else process.env.TEMP = previous.TEMP;
    if (previous.TMP === undefined) delete process.env.TMP; else process.env.TMP = previous.TMP;
    if (previous.TMPDIR === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = previous.TMPDIR;
    // Private diagnostics retained; no cleanup of the shared Observer worktree.
  }
  console.log(`AYAS micro batch age readiness smoke: PASS (${count} scenarios)`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
