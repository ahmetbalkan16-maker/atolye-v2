/**
 * Stage 15O.2 — the vault of record inside a real experiment sandbox of this repository: the place where an improvement
 * is actually measured against it. The pinned bytes must be the committed ones there, every case must pass in the
 * sandbox's stripped environment, and no case may write into the tree. One TEMP clone and one TEMP sandbox; the
 * repository is only read. No model, provider or network.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ayasGoldenVaultDigest, evaluateAyasGoldenRegression } from "../src/lib/ayas/golden/AyasGoldenVault";
import { AYAS_GOLDEN_VAULT } from "../src/lib/ayas/golden/AyasGoldenVaultRegistry";
import { captureAyasSandboxChange, createAyasResearchExperimentSandbox, destroyAyasResearchExperimentSandbox, runAyasGoldenVaultInSandbox, type AyasResearchExperimentSandbox } from "../src/lib/brain/autonomy/AyasResearchExperimentSandbox";

const repo = process.cwd();
const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8", windowsHide: true, maxBuffer: 8_000_000 }).trim();

async function main(): Promise<void> {
  const temp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "ayas-golden-sandbox-"));
  let sandbox: AyasResearchExperimentSandbox | undefined;
  try {
    // A sandbox is a clone of a commit. Work that is not committed yet is committed in a TEMP clone first, so this
    // suite measures the tree it was started in, clean or not.
    const dirty = [...new Set([...git(repo, "diff", "--name-only", "HEAD").split("\n"), ...git(repo, "ls-files", "--others", "--exclude-standard").split("\n")])].filter(Boolean);
    let source = repo; let head = git(repo, "rev-parse", "HEAD");
    if (dirty.length > 0) {
      source = path.join(temp, "repo");
      git(repo, "clone", "--quiet", "--shared", "--no-tags", "--", repo, source);
      for (const file of dirty) {
        const from = path.join(repo, file); const to = path.join(source, file);
        if (fs.existsSync(from)) { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); } else fs.rmSync(to, { force: true });
      }
      git(source, "add", "-A");
      // Files that differ only in how they are checked out are not a change; then the clone's HEAD is the tree.
      if (git(source, "status", "--porcelain") !== "") git(source, "commit", "--quiet", "-m", "uncommitted work under test");
      head = git(source, "rev-parse", "HEAD");
    }
    const started = performance.now();
    sandbox = await createAyasResearchExperimentSandbox({ repoRoot: source, baseHead: head, nodeModulesDir: fs.realpathSync(path.join(repo, "node_modules")), timeoutMs: 120_000 });
    const before = await captureAyasSandboxChange(sandbox);
    const golden = await runAyasGoldenVaultInSandbox(sandbox, AYAS_GOLDEN_VAULT, { caseTimeoutMs: () => 60_000, remainingMs: () => 600_000 });
    const after = await captureAyasSandboxChange(sandbox);
    const decision = evaluateAyasGoldenRegression({ vault: AYAS_GOLDEN_VAULT, candidate: golden.run });
    // The committed bytes are the pinned bytes: a line-ending policy applied at checkout would show here as drift.
    assert.deepEqual(golden.run.pinDrift, [], "pinned graders and fixtures differ in a sandbox clone");
    assert.deepEqual([decision.decision, decision.failingCaseIds, golden.run.results.length, golden.reusedCaseIds], ["GOLDEN_HELD", [], AYAS_GOLDEN_VAULT.cases.length, []], JSON.stringify(golden.run.results.filter((result) => !result.pass)));
    assert.equal(golden.run.vaultDigest, ayasGoldenVaultDigest(AYAS_GOLDEN_VAULT));
    // Hermetic: nothing tracked, untracked or ignored appeared in the tree while the cases ran.
    assert.deepEqual([before.changedPaths, after.changedPaths, after.diff], [[], [], ""]);
    console.log(JSON.stringify({ status: "PASS", suite: "ayas-golden-sandbox-run", vaultVersion: AYAS_GOLDEN_VAULT.version, cases: golden.run.results.length, sandboxOf: dirty.length > 0 ? "TEMP_CLONE_WITH_UNCOMMITTED_WORK" : "HEAD",
      totalMs: Math.round(performance.now() - started), modelRuns: 0 }));
  } finally {
    if (sandbox) assert.equal(await destroyAyasResearchExperimentSandbox(sandbox), true, "sandbox not destroyed");
    assert.equal(path.dirname(temp), fs.realpathSync(os.tmpdir())); assert.ok(path.basename(temp).startsWith("ayas-golden-sandbox-"));
    fs.rmSync(temp, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
