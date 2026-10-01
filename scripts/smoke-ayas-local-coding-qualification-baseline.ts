/** Host-only historical oracle checks. These clones are never model workspaces. */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

import { buildAyasExperimentChildEnv, createAyasResearchExperimentSandbox, destroyAyasResearchExperimentSandbox } from "../src/lib/brain/autonomy/AyasResearchExperimentSandbox";
import { AYAS_LOCAL_CODING_QUALIFICATION_VAULT } from "./fixtures/ayas-local-coding-qualification-vault";

const repoRoot = path.resolve(__dirname, "..");
const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");
const gitBytes = (object: string): Buffer => execFileSync("git", ["show", object], {
  cwd: repoRoot, windowsHide: true, maxBuffer: 4_000_000,
});

type Run = { readonly exit: number | null; readonly durationMs: number; readonly stderr: string; readonly timedOut: boolean };
function runFrozenEvaluator(repoDir: string, runRoot: string, script: string): Run {
  const loader = path.join(repoDir, "node_modules", "tsx", "dist", "loader.mjs");
  assert.ok(fs.statSync(loader).isFile(), "tsx loader must be available in host-only clone");
  const start = performance.now();
  const result = spawnSync(process.execPath, ["--import", pathToFileURL(loader).href, script], {
    cwd: repoDir, env: buildAyasExperimentChildEnv(runRoot), windowsHide: true,
    encoding: "utf8", timeout: 120_000, maxBuffer: 1_000_000,
  });
  assert.ok(!result.error, `frozen evaluator could not run: ${String(result.error)}`);
  return { exit: result.status, durationMs: Math.round(performance.now() - start),
    stderr: result.stderr, timedOut: result.signal !== null };
}

async function main(): Promise<void> {
  const results = [];
  for (const item of AYAS_LOCAL_CODING_QUALIFICATION_VAULT) {
    assert.equal(item.exactFiles.length, 1, "this historical oracle requires one exact source file");
    const file = item.exactFiles[0]!;
    const baselineBytes = gitBytes(`${item.baseHead}:${file}`);
    const candidateBytes = gitBytes(`${item.fixHead}:${file}`);
    const frozenEvaluator = gitBytes(item.evaluatorBlob);
    assert.notEqual(sha256(baselineBytes), sha256(candidateBytes), "historical repair must change source");
    const sandbox = await createAyasResearchExperimentSandbox({ repoRoot, baseHead: item.baseHead,
      nodeModulesDir: path.join(repoRoot, "node_modules"), timeoutMs: 120_000 });
    try {
      assert.ok(sandbox.nodeModulesLink, "local dependencies must be present");
      const sourcePath = path.join(sandbox.repoDir, file);
      const evaluatorPath = path.join(sandbox.repoDir, item.evaluatorScript);
      assert.equal(sha256(fs.readFileSync(sourcePath)), sha256(baselineBytes), "clone must contain the frozen baseline");
      fs.mkdirSync(path.dirname(evaluatorPath), { recursive: true });
      fs.writeFileSync(evaluatorPath, frozenEvaluator); // Host oracle; never project this into a model request.
      assert.equal(sha256(fs.readFileSync(evaluatorPath)), sha256(frozenEvaluator));

      const baseline = runFrozenEvaluator(sandbox.repoDir, sandbox.runRoot, item.evaluatorScript);
      assert.ok(!baseline.timedOut && baseline.exit === 1,
        `${item.caseId}: baseline must fail normally, not timeout/crash: ${baseline.stderr.slice(0, 800)}`);
      assert.match(baseline.stderr, /AssertionError|ERR_ASSERTION/, `${item.caseId}: baseline failure must be an assertion`);
      const expectedFactKey = item.caseId === "historical-explicit-computer-plan"
        ? "user.decision.computer-purchase-plan"
        : item.caseId === "heldout-render-tool-supersession" ? "user.decision.render-tool" : null;
      const expectedFailure = expectedFactKey ? `- '${expectedFactKey}'`
        : item.caseId === "historical-atomic-bounded-write" ? "Missing expected rejection" : null;
      assert.ok(expectedFailure, "every historical case needs an explicit expected failure");
      assert.ok(baseline.stderr.includes(expectedFailure), `${item.caseId}: baseline failed for a different reason: ${baseline.stderr.slice(0, 500)}`);

      fs.writeFileSync(sourcePath, candidateBytes);
      assert.equal(sha256(fs.readFileSync(sourcePath)), sha256(candidateBytes), "candidate must use exact fix blob");
      const candidate = runFrozenEvaluator(sandbox.repoDir, sandbox.runRoot, item.evaluatorScript);
      assert.ok(!candidate.timedOut && candidate.exit === 0,
        `${item.caseId}: frozen historical candidate must pass: ${candidate.stderr.slice(0, 800)}`);

      const wrongBytes = Buffer.concat([baselineBytes, Buffer.from("\n// Host-only wrong candidate: unrelated no-op.\n")]);
      fs.writeFileSync(sourcePath, wrongBytes);
      const wrong = runFrozenEvaluator(sandbox.repoDir, sandbox.runRoot, item.evaluatorScript);
      assert.ok(!wrong.timedOut && wrong.exit === 1,
        `${item.caseId}: wrong candidate must fail normally: ${wrong.stderr.slice(0, 800)}`);
      assert.match(wrong.stderr, /AssertionError|ERR_ASSERTION/, `${item.caseId}: wrong-candidate failure must be an assertion`);
      assert.ok(wrong.stderr.includes(expectedFailure), `${item.caseId}: wrong candidate failed for a different reason`);
      results.push({ caseId: item.caseId, split: item.split, baseline: "FAIL", candidate: "PASS",
        wrongCandidate: "FAIL", baselineMs: baseline.durationMs, candidateMs: candidate.durationMs,
        wrongCandidateMs: wrong.durationMs, modelRuns: 0 });
    } finally {
      await destroyAyasResearchExperimentSandbox(sandbox);
    }
  }
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-local-coding-qualification-baseline",
    evidence: "historical-oracle-only; no model or hard-sandbox qualification", results }));
}

void main();
