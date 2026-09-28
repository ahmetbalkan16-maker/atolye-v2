/** Stage 15.7: the registered strategy is exercised only in an isolated TEMP clone. */
import assert from "node:assert/strict";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { AYAS_IMPROVEMENT_BENCHMARKS, AYAS_IMPROVEMENT_STRATEGIES, validateAyasImprovementStrategy } from "../src/lib/brain/autonomy/AyasResearchExperimentRegistry";
import { applyAyasStrategyInSandbox, buildAyasExperimentChildEnv, captureAyasSandboxChange, createAyasResearchExperimentSandbox, destroyAyasResearchExperimentSandbox, runAyasBenchmarkInSandbox, runAyasRegressionSuiteInSandbox } from "../src/lib/brain/autonomy/AyasResearchExperimentSandbox";

async function main(): Promise<void> {
  const workspaceRoot = path.resolve(__dirname, "..");
  const repoRoot = process.env.AYAS_STAGE15_7_REPO_ROOT ? path.resolve(process.env.AYAS_STAGE15_7_REPO_ROOT) : workspaceRoot;
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
  const strategy = AYAS_IMPROVEMENT_STRATEGIES.find((item) => item.strategyId === "exp-memory-render-tool-supersession");
  assert.ok(strategy, "reviewed render-tool strategy must be registered");
  assert.deepEqual(validateAyasImprovementStrategy(strategy), []);
  assert.deepEqual(strategy.exactFiles, ["src/lib/ayas/memory/AyasMemoryTemporal.ts"]);
  assert.ok(strategy.maxChangedLines <= 80);
  const benchmark = AYAS_IMPROVEMENT_BENCHMARKS.find((item) => item.benchmarkId === strategy.benchmarkId)!;
  const sandbox = await createAyasResearchExperimentSandbox({ repoRoot, baseHead: head, nodeModulesDir: path.join(workspaceRoot, "node_modules"), timeoutMs: 120_000 });
  try {
    const before = await runAyasBenchmarkInSandbox(sandbox, benchmark, 120_000);
    const regressionsBefore = [];
    for (const suite of strategy.regressionSuites) regressionsBefore.push(await runAyasRegressionSuiteInSandbox(sandbox, suite, 120_000));
    const applied = await applyAyasStrategyInSandbox(sandbox, strategy);
    const change = await captureAyasSandboxChange(sandbox);
    const after = await runAyasBenchmarkInSandbox(sandbox, benchmark, 120_000);
    const regressionsAfter = [];
    for (const suite of strategy.regressionSuites) regressionsAfter.push(await runAyasRegressionSuiteInSandbox(sandbox, suite, 120_000));
    const runCandidateScript = (script: string) => spawnSync(process.execPath,
      ["--import", pathToFileURL(path.join(sandbox.repoDir, "node_modules", "tsx", "dist", "loader.mjs")).href, script],
      { cwd: sandbox.repoDir, env: buildAyasExperimentChildEnv(sandbox.runRoot), encoding: "utf8", timeout: 120_000 });
    const acceptance = runCandidateScript("scripts/smoke-ayas-stage15-7-temporal-acceptance.ts");
    const retrievalEvidence = runCandidateScript("scripts/smoke-ayas-retrieval-evaluation.ts");
    for (const failed of regressionsAfter.filter((result) => !result.pass)) {
      const detail = spawnSync(process.execPath, ["--import", pathToFileURL(path.join(sandbox.repoDir, "node_modules", "tsx", "dist", "loader.mjs")).href, failed.script],
        { cwd: sandbox.repoDir, env: buildAyasExperimentChildEnv(sandbox.runRoot), encoding: "utf8", timeout: 120_000 });
      console.error(JSON.stringify({ failedSuite: failed.script, status: detail.status, stdout: detail.stdout.slice(0, 2500), stderr: detail.stderr.slice(0, 2500) }));
    }
    assert.equal(applied.applied, true, `candidate refused: ${applied.violations.join(",")}`);
    assert.deepEqual(change.changedPaths, strategy.exactFiles);
    assert.ok(change.files.reduce((sum, file) => sum + file.addedLines + file.removedLines, 0) <= strategy.maxChangedLines, "candidate exceeds line budget");
    assert.ok(before.ok && after.ok, "cognitive benchmark unavailable");
    assert.equal(before.measurement.evaluatorSha256, after.measurement.evaluatorSha256);
    assert.ok(before.measurement.failing.some((failure) => failure.id === "stale-free-text-seed"));
    assert.ok(!after.measurement.failing.some((failure) => failure.id === "stale-free-text-seed"));
    assert.ok(after.measurement.passed > before.measurement.passed);
    assert.ok(after.measurement.heldOut.passed >= before.measurement.heldOut.passed);
    assert.ok(regressionsBefore.every((result) => result.pass), `baseline regression failed: ${JSON.stringify(regressionsBefore)}`);
    assert.ok(regressionsAfter.every((result) => result.pass), `candidate regression failed: ${JSON.stringify(regressionsAfter)}`);
    assert.equal(acceptance.status, 0, `candidate acceptance failed: ${acceptance.stderr}`);
    assert.equal(retrievalEvidence.status, 0, `candidate retrieval failed: ${retrievalEvidence.stderr}`);
    assert.match(retrievalEvidence.stdout, /RESOLVED_KNOWN_LIMITATION seed:project-decision-free-text source=[a-f0-9]{64} diff=[a-f0-9]{64}/);
    console.log(JSON.stringify({ status: "PASS", head, strategyId: strategy.strategyId, before: before.measurement.passed, after: after.measurement.passed,
      heldOutBefore: before.measurement.heldOut.passed, heldOutAfter: after.measurement.heldOut.passed, changedPaths: change.changedPaths, changedLines: change.files.reduce((sum, file) => sum + file.addedLines + file.removedLines, 0), acceptance: "PASS", retrievalResolution: retrievalEvidence.stdout.match(/RESOLVED_KNOWN_LIMITATION seed:project-decision-free-text[^\r\n]*/)?.[0], regressionsBefore, regressionsAfter }));
  } finally {
    await destroyAyasResearchExperimentSandbox(sandbox);
  }
}
void main();
