import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { selectAyasAgenticRoute, type AyasAvailabilityEvidence } from "../../ayas/routing/AyasAgenticRouting";
import { evaluateAyasGoldenRegression, type AyasGoldenRegressionResult, type AyasGoldenVault } from "../../ayas/golden/AyasGoldenVault";
import { AYAS_GOLDEN_VAULT } from "../../ayas/golden/AyasGoldenVaultRegistry";
import { AYAS_EXPERIMENT_ISOLATION, ayasBaselineReproducesHypothesis, ayasEvidenceContainsSecret, boundAyasExperimentDiff, compareAyasExperimentBeforeGolden, evaluateAyasExperiment, toAyasEvidenceMeasurement, validAyasExperimentSourceBindings, type AyasBenchmarkRunOutcome, type AyasExperimentAbortCode, type AyasExperimentAnalysisRoute, type AyasExperimentEvidence, type AyasExperimentGoldenEvidence, type AyasExperimentSourceBinding, type AyasRegressionSuiteResult } from "./AyasResearchExperimentEvaluation";
import { AYAS_EXPERIMENT_MAX_CHANGED_LINES, type AyasImprovementBenchmark, type AyasImprovementStrategy } from "./AyasResearchExperimentRegistry";
import { applyAyasStrategyInSandbox, captureAyasSandboxChange, createAyasResearchExperimentSandbox, destroyAyasResearchExperimentSandbox, readAyasSandboxToolVersions, restoreAyasSandboxBase, runAyasBenchmarkInSandbox, runAyasGoldenVaultInSandbox, runAyasRegressionSuiteInSandbox, stampAyasNodeModules, type AyasResearchExperimentSandbox } from "./AyasResearchExperimentSandbox";
import type { AyasExperimentRecord, AyasResearchExperimentStore } from "./AyasResearchExperimentStore";
import { AYAS_RESEARCH_IMPROVEMENT_SCHEMA_VERSION, type AyasImprovementHypothesis } from "./AyasResearchImprovementLoop";
import type { AyasResearchImprovementCycleDeps, AyasResearchImprovementObservation, AyasResearchExperimentFaultPoint } from "./AyasResearchImprovementCycle";

export type AyasRegisteredExperimentObservation = AyasResearchImprovementObservation;
export type AyasRegisteredExperimentSourceBinding = AyasExperimentSourceBinding;
export interface AyasRegisteredExperimentRetainedSource {
  readonly diffSha256: string;
  readonly replacements: readonly { readonly filePath: string; readonly expectedHash: string; readonly content: string }[];
}
export interface AyasRegisteredExperimentResult { readonly record: AyasExperimentRecord; readonly verdict: string; readonly reasonCodes: readonly string[]; readonly retainedSource?: AyasRegisteredExperimentRetainedSource }

const execFileAsync = promisify(execFile);
const ANALYSIS_TASK_TEXT = "Sandbox deneyi için smoke test planı hazırla ve benchmark sonucunu doğrula";

async function gitRead(repoRoot: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["--no-optional-locks", ...args], { cwd: repoRoot, encoding: "utf8", windowsHide: true, timeout: 30_000, maxBuffer: 4_000_000 });
  return stdout.trim();
}

async function liveWorkspaceState(repoRoot: string): Promise<{ readonly head: string; readonly clean: boolean } | null> {
  try { return { head: await gitRead(repoRoot, ["rev-parse", "HEAD"]), clean: (await gitRead(repoRoot, ["status", "--porcelain"])).length === 0 }; }
  catch { return null; }
}

function analysisRoute(availability: AyasAvailabilityEvidence | undefined): AyasExperimentAnalysisRoute {
  const route = selectAyasAgenticRoute({ text: ANALYSIS_TASK_TEXT, availableModelIds: availability?.availableModelIds ?? [], ...(availability?.availableSkillIds ? { availableSkillIds: availability.availableSkillIds } : {}), ...(availability?.availableAgentIds ? { availableAgentIds: availability.availableAgentIds } : {}) });
  return { agent: route.selectedAgentId, tool: route.selectedToolId, skill: route.selectedSkillId, model: route.selectedModelId, blocked: route.blocked, reasonCodes: [...route.reasonCodes], executor: "ayas-sandbox-runner", authority: "NONE" };
}

export interface AyasRegisteredExperimentDeps {
  readonly deps: Pick<AyasResearchImprovementCycleDeps, "repoRoot" | "nodeModulesDir" | "availability" | "trace" | "faultInjection" | "goldenVault">;
  readonly observation: AyasRegisteredExperimentObservation;
  readonly store: AyasResearchExperimentStore;
  readonly record: AyasExperimentRecord;
  readonly hypothesis: AyasImprovementHypothesis;
  readonly strategy: AyasImprovementStrategy;
  readonly benchmark: AyasImprovementBenchmark;
  readonly sourceIds: readonly string[];
  readonly sourceBindings: readonly AyasRegisteredExperimentSourceBinding[];
  readonly remainingMs: () => number;
  readonly clock: () => string;
}

export async function runAyasRegisteredImprovementExperiment(ctx: AyasRegisteredExperimentDeps): Promise<AyasRegisteredExperimentResult> {
  const { deps, store, hypothesis, strategy, benchmark } = ctx;
  let record = ctx.record;
  const observation = ctx.observation;
  if (!/^[0-9a-f]{40}$/.test(observation.head) || !observation.repoClean || !observation.graphifyFresh || observation.machineAction !== "ALLOW"
    || observation.head !== record.baseHead || record.hypothesisId !== hypothesis.hypothesisId
    || record.strategyId !== strategy.strategyId || record.strategyVersion !== strategy.version
    || hypothesis.strategyId !== strategy.strategyId || hypothesis.strategyVersion !== strategy.version
    || hypothesis.benchmarkId !== benchmark.benchmarkId || strategy.benchmarkId !== benchmark.benchmarkId
    || !validAyasExperimentSourceBindings(ctx.sourceBindings, hypothesis.findingIds)) {
    throw new Error("EXPERIMENT_SOURCE_NOT_READY");
  }
  const before = await liveWorkspaceState(deps.repoRoot);
  if (!before?.clean || before.head !== record.baseHead) throw new Error("EXPERIMENT_SOURCE_NOT_READY");
  const fault = async (point: AyasResearchExperimentFaultPoint) => { if (deps.faultInjection) await deps.faultInjection(point); };
  const progress = (status: AyasExperimentRecord["status"]) => {
    const current = store.readExperiment(record.experimentId);
    if (current && current.status !== record.status) throw new Error("experiment record changed underneath its owner");
    record = { ...record, status, updatedAt: ctx.clock() };
    store.writeExperiment(record);
  };
  const cap = () => Math.max(1, Math.min(benchmark.timeoutMs, ctx.remainingMs() - 5_000));
  let sandbox: AyasResearchExperimentSandbox | undefined;
  let baseline: AyasBenchmarkRunOutcome | null = null;
  let experiment: AyasBenchmarkRunOutcome | null = null;
  const baselineSuites: AyasRegressionSuiteResult[] = [];
  const experimentSuites: AyasRegressionSuiteResult[] = [];
  let abortCode: AyasExperimentAbortCode | undefined;
  let change: Awaited<ReturnType<typeof captureAyasSandboxChange>> | null = null;
  let retainedSource: AyasRegisteredExperimentRetainedSource | null = null;
  let golden: AyasGoldenRegressionResult | null = null;
  let goldenCases: AyasExperimentGoldenEvidence["cases"] = [];
  const vault: AyasGoldenVault = deps.goldenVault ?? AYAS_GOLDEN_VAULT;
  let liveUnchanged = false;
  let discarded = false;
  let tools: { readonly tsx: string | null; readonly typescript: string | null } = { tsx: null, typescript: null };
  const nodeModulesDir = deps.nodeModulesDir ?? path.join(deps.repoRoot, "node_modules");
  const nodeModulesBefore = stampAyasNodeModules(nodeModulesDir);
  const span = deps.trace?.startSpan("experiment", "ayas-research", "run-experiment", null, record.attempt);
  try {
    await fault("after-reservation");
    sandbox = await createAyasResearchExperimentSandbox({ repoRoot: deps.repoRoot, baseHead: record.baseHead, timeoutMs: Math.max(1_000, ctx.remainingMs() - 10_000), ...(deps.nodeModulesDir ? { nodeModulesDir: deps.nodeModulesDir } : {}) });
    tools = readAyasSandboxToolVersionsSafe(sandbox);
    record = { ...record, sandboxRoot: sandbox.runRoot };
    progress("BASELINE_RUNNING");
    baseline = await runAyasBenchmarkInSandbox(sandbox, benchmark, cap());
    const reproduced = baseline.ok && ayasBaselineReproducesHypothesis(hypothesis, baseline.measurement);
    if (reproduced) for (const suite of hypothesis.regressionSuites) baselineSuites.push(await runAyasRegressionSuiteInSandbox(sandbox, suite, cap()));
    await fault("after-baseline");
    if (reproduced) {
      // Anything the unchanged tree's own benchmark or suites wrote would otherwise be blamed on the strategy.
      const afterBaseline = await captureAyasSandboxChange(sandbox);
      if (afterBaseline.changedPaths.length > 0) abortCode = "BENCHMARK_NOT_HERMETIC";
      else if (ctx.remainingMs() < 15_000) abortCode = "TIME_BUDGET_EXHAUSTED";
      else {
        const applied = await applyAyasStrategyInSandbox(sandbox, strategy);
        if (applied.violations.length > 0) abortCode = "SCOPE_VIOLATION";
        else if (!applied.applied) abortCode = "NO_CHANGE_GENERATED";
        else {
          const pre = await captureAyasSandboxChange(sandbox);
          const changedLines = pre.files.reduce((sum, file) => sum + file.addedLines + file.removedLines, 0);
          if (pre.changedPaths.some((file) => !strategy.exactFiles.includes(file)) || changedLines > Math.min(strategy.maxChangedLines, AYAS_EXPERIMENT_MAX_CHANGED_LINES)) abortCode = "SCOPE_VIOLATION";
          else if (pre.changedPaths.length === 0) abortCode = "NO_CHANGE_GENERATED";
          else {
            await fault("after-change-applied");
            progress("EXPERIMENT_RUNNING");
            experiment = await runAyasBenchmarkInSandbox(sandbox, benchmark, cap());
            for (const suite of hypothesis.regressionSuites) experimentSuites.push(await runAyasRegressionSuiteInSandbox(sandbox, suite, cap()));
            const post = await captureAyasSandboxChange(sandbox);
            // Anything the benchmark or suites wrote into the tree is a hermeticity breach.
            if (post.diff !== pre.diff || post.changedPaths.join("\n") !== pre.changedPaths.join("\n")) abortCode = "SANDBOX_ESCAPE";
            change = post;
            if (!abortCode && ctx.sourceBindings.some((binding) => binding.kind === "EVOLUTION_OPPORTUNITY")) {
              const replacements = await Promise.all(post.changedPaths.map(async (filePath) => {
                if (!strategy.exactFiles.includes(filePath)) throw new Error("RETAINED_SOURCE_OUTSIDE_SCOPE");
                const target = path.join(sandbox!.repoDir, filePath);
                const stat = fs.lstatSync(target);
                if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("RETAINED_SOURCE_NOT_REGULAR_FILE");
                const bytes = fs.readFileSync(target);
                const base = (await execFileAsync("git", ["--no-optional-locks", "show", `HEAD:${filePath}`], { cwd: sandbox!.repoDir, encoding: "buffer", windowsHide: true, timeout: 30_000, maxBuffer: 1_000_000 })).stdout;
                if (bytes.length > 400_000 || !Buffer.from(bytes.toString("utf8"), "utf8").equals(bytes) || !Buffer.from(base.toString("utf8"), "utf8").equals(base)) throw new Error("RETAINED_SOURCE_NOT_BOUNDED_UTF8");
                return { filePath, expectedHash: crypto.createHash("sha256").update(base).digest("hex"), content: bytes.toString("utf8") };
              }));
              retainedSource = { diffSha256: crypto.createHash("sha256").update(post.diff, "utf8").digest("hex"), replacements };
            }
            // Golden regression comes after held-out, and only for a change that everything so far would call improved.
            if (!abortCode && compareAyasExperimentBeforeGolden({ hypothesis, baseline, experiment, baselineSuites, experimentSuites }).verdict === "IMPROVED") {
              const candidateRun = await runAyasGoldenVaultInSandbox(sandbox, vault, { reuse: experimentSuites, caseTimeoutMs: cap, remainingMs: ctx.remainingMs });
              goldenCases = candidateRun.run.results.map((result) => ({ id: result.id, script: vault.cases.find((item) => item.id === result.id)?.script ?? "", pass: result.pass, timedOut: result.timedOut, reused: candidateRun.reusedCaseIds.includes(result.id) }));
              golden = evaluateAyasGoldenRegression({ vault, candidate: candidateRun.run });
              // A golden case that wrote into the tree is the same breach as a benchmark that did.
              const afterGolden = await captureAyasSandboxChange(sandbox);
              if (afterGolden.diff !== post.diff || afterGolden.changedPaths.join("\n") !== post.changedPaths.join("\n")) abortCode = "SANDBOX_ESCAPE";
              else if (golden.decision === "PROMOTION_STOPPED") {
                // Was it the change? Everything that had to be read from the changed tree has been read: put the unchanged
                // bytes back and ask only the red cases. The answer names the cause; it never rescues the candidate.
                await restoreAyasSandboxBase(sandbox, post.changedPaths);
                if ((await captureAyasSandboxChange(sandbox)).changedPaths.length === 0) {
                  const baselineRun = await runAyasGoldenVaultInSandbox(sandbox, vault, { reuse: baselineSuites, caseTimeoutMs: cap, remainingMs: ctx.remainingMs, onlyCaseIds: golden.failingCaseIds });
                  golden = evaluateAyasGoldenRegression({ vault, candidate: candidateRun.run, baseline: baselineRun.run });
                }
              }
            }
          }
        }
      }
    }
  } catch {
    abortCode = abortCode ?? "SANDBOX_FAILED";
  } finally {
    if (sandbox) discarded = await destroyAyasResearchExperimentSandbox(sandbox);
  }
  if (sandbox && !discarded) abortCode = "SANDBOX_CLEANUP_FAILED";
  const live = await liveWorkspaceState(deps.repoRoot);
  const nodeModulesChanged = stampAyasNodeModules(nodeModulesDir) !== nodeModulesBefore;
  liveUnchanged = live !== null && live.head === record.baseHead && live.clean && !nodeModulesChanged;
  // A write that reached the shared node_modules through the junction is an escape, not a workspace coincidence.
  if (!abortCode && nodeModulesChanged) abortCode = "SANDBOX_ESCAPE";
  else if (!abortCode && !liveUnchanged) abortCode = live && live.head !== record.baseHead ? "BASE_HEAD_MOVED" : "LIVE_WORKSPACE_CHANGED";
  const bounded = change ? boundAyasExperimentDiff(change.diff) : null;
  if (bounded?.containedSecret && !abortCode) abortCode = "EVIDENCE_SECRET";
  const comparison = evaluateAyasExperiment({ hypothesis, baseline, experiment, baselineSuites, experimentSuites, golden, ...(abortCode ? { abortCode } : {}) });
  const evidence: AyasExperimentEvidence = {
    schemaVersion: AYAS_RESEARCH_IMPROVEMENT_SCHEMA_VERSION,
    experimentId: record.experimentId,
    attemptKey: record.attemptKey,
    baseHead: record.baseHead,
    findingIds: hypothesis.findingIds,
    sourceIds: [...ctx.sourceIds],
    sourceBindings: ctx.sourceBindings.map((binding) => ({ kind: binding.kind, id: binding.id })),
    ...(comparison.verdict === "IMPROVED" && retainedSource ? { replacementDigest: crypto.createHash("sha256").update(JSON.stringify(retainedSource.replacements), "utf8").digest("hex") } : {}),
    hypothesis,
    baseline: toAyasEvidenceMeasurement(baseline),
    experiment: toAyasEvidenceMeasurement(experiment),
    environment: { node: process.version, platform: process.platform, arch: process.arch, tsx: tools.tsx, typescript: tools.typescript },
    change: change && bounded ? { strategyId: strategy.strategyId, strategyVersion: strategy.version, files: change.files, diffSha256: bounded.sha256, diffExcerpt: bounded.containedSecret ? "" : bounded.excerpt } : null,
    regressions: {
      newlyFailingCaseIds: comparison.newlyFailingCaseIds,
      heldOutDelta: comparison.heldOutDelta,
      suites: hypothesis.regressionSuites.map((script) => ({ script, baselinePass: baselineSuites.find((s) => s.script === script)?.pass ?? null, experimentPass: experimentSuites.find((s) => s.script === script)?.pass ?? null })),
    },
    ...(golden ? { golden: { vaultVersion: golden.vaultVersion, vaultDigest: golden.vaultDigest, decision: golden.decision, reasonCodes: golden.reasonCodes, cases: goldenCases,
      failingCaseIds: golden.failingCaseIds, regressedCaseIds: golden.regressedCaseIds, gapDomains: golden.gapDomains } } : {}),
    performance: { baselineMs: baseline?.ok ? baseline.measurement.durationMs : null, experimentMs: experiment?.ok ? experiment.measurement.durationMs : null, ratio: comparison.performanceRatio },
    risk: { riskClass: hypothesis.riskClass, isolation: AYAS_EXPERIMENT_ISOLATION, liveWorkspaceUnchanged: liveUnchanged, sandboxDiscarded: discarded },
    analysisRoute: analysisRoute(deps.availability),
    verdict: comparison.verdict,
    reasonCodes: comparison.reasonCodes,
    targetGain: comparison.targetGain,
    fixedCaseIds: comparison.fixedCaseIds,
    remainingTargetFailures: comparison.remainingTargetFailures,
    completedAt: ctx.clock(),
    authority: "NONE",
  };
  let written = evidence;
  let evidenceHash: string | null = null;
  try { evidenceHash = store.writeEvidence(evidence); }
  catch {
    // Only a package that genuinely carries a secret-like value is re-written, without the excerpt, as UNSAFE.
    if (ayasEvidenceContainsSecret(evidence)) {
      written = { ...evidence, change: evidence.change ? { ...evidence.change, diffExcerpt: "" } : null, verdict: "UNSAFE", reasonCodes: ["EVIDENCE_SECRET"], targetGain: 0, fixedCaseIds: [] };
      try { evidenceHash = store.writeEvidence(written); } catch { evidenceHash = null; }
    }
  }
  const settle = async (update: (current: AyasExperimentRecord) => AyasExperimentRecord): Promise<AyasExperimentRecord> => {
    try {
      return await store.withLock(async () => {
        const current = store.readExperiment(record.experimentId);
        if (!current || current.status === "UNCERTAIN" || current.status === "COMPLETED") return current ?? record;
        const next = update(current);
        store.writeExperiment(next);
        return next;
      });
    } catch {
      return record; // left active; crash recovery settles it as UNCERTAIN on a later tick
    }
  };
  if (!evidenceHash) {
    // A storage failure is not a verdict: the attempt is uncertain and retried later within its bounded budget.
    const failed = await settle((current) => ({ ...current, status: "UNCERTAIN", updatedAt: ctx.clock(), reasonCodes: ["EVIDENCE_WRITE_FAILED"] }));
    span?.end("error", undefined, "EVIDENCE_WRITE_FAILED");
    return { record: failed, verdict: "INCONCLUSIVE", reasonCodes: ["EVIDENCE_WRITE_FAILED"] };
  }
  const boundHash = evidenceHash;
  await fault("after-evidence-written");
  await fault("before-finalize");
  const finalRecord = await settle((current) => ({ ...current, status: "COMPLETED", updatedAt: ctx.clock(), completedAt: ctx.clock(), verdict: written.verdict, reasonCodes: written.reasonCodes, evidenceHash: boundHash }));
  span?.end(written.verdict === "IMPROVED" ? "ok" : written.verdict === "UNSAFE" ? "denied" : "error", {
    caseCount: baseline?.ok ? baseline.measurement.caseCount : null,
    targetGain: written.targetGain, heldOutDelta: comparison.heldOutDelta,
    regressionCount: comparison.newlyFailingCaseIds.length, improved: written.verdict === "IMPROVED",
  }, written.verdict === "IMPROVED" ? undefined : written.verdict);
  return { record: finalRecord, verdict: written.verdict, reasonCodes: written.reasonCodes,
    ...(written.verdict === "IMPROVED" && finalRecord.status === "COMPLETED" && finalRecord.evidenceHash === boundHash && retainedSource ? { retainedSource } : {}) };
}

function readAyasSandboxToolVersionsSafe(sandbox: AyasResearchExperimentSandbox): { readonly tsx: string | null; readonly typescript: string | null } {
  try { return readAyasSandboxToolVersions(sandbox); } catch { return { tsx: null, typescript: null }; }
}
