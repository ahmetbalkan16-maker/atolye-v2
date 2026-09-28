import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { selectAyasAgenticRoute, type AyasAvailabilityEvidence } from "../../ayas/routing/AyasAgenticRouting";
import { AYAS_EXPERIMENT_ISOLATION, ayasBaselineReproducesHypothesis, ayasEvidenceContainsSecret, boundAyasExperimentDiff, evaluateAyasExperiment, toAyasEvidenceMeasurement, type AyasBenchmarkRunOutcome, type AyasExperimentAbortCode, type AyasExperimentAnalysisRoute, type AyasExperimentEvidence, type AyasRegressionSuiteResult } from "./AyasResearchExperimentEvaluation";
import { AYAS_EXPERIMENT_MAX_CHANGED_LINES, type AyasImprovementBenchmark, type AyasImprovementStrategy } from "./AyasResearchExperimentRegistry";
import { applyAyasStrategyInSandbox, captureAyasSandboxChange, createAyasResearchExperimentSandbox, destroyAyasResearchExperimentSandbox, readAyasSandboxToolVersions, runAyasBenchmarkInSandbox, runAyasRegressionSuiteInSandbox, stampAyasNodeModules, type AyasResearchExperimentSandbox } from "./AyasResearchExperimentSandbox";
import type { AyasExperimentRecord, AyasResearchExperimentStore } from "./AyasResearchExperimentStore";
import { AYAS_RESEARCH_IMPROVEMENT_SCHEMA_VERSION, type AyasImprovementHypothesis } from "./AyasResearchImprovementLoop";
import type { AyasResearchImprovementCycleDeps, AyasResearchImprovementObservation, AyasResearchExperimentFaultPoint } from "./AyasResearchImprovementCycle";

export type AyasRegisteredExperimentObservation = AyasResearchImprovementObservation;
export interface AyasRegisteredExperimentSourceBinding { readonly kind: "RESEARCH_FINDING" | "EVOLUTION_OPPORTUNITY"; readonly id: string }
export interface AyasRegisteredExperimentResult { readonly record: AyasExperimentRecord; readonly verdict: string; readonly reasonCodes: readonly string[] }

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
  readonly deps: Pick<AyasResearchImprovementCycleDeps, "repoRoot" | "nodeModulesDir" | "availability" | "trace" | "faultInjection">;
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
    || ctx.sourceBindings.length === 0 || ctx.sourceBindings.some((binding) => !["RESEARCH_FINDING", "EVOLUTION_OPPORTUNITY"].includes(binding.kind) || !binding.id.trim())) {
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
  const comparison = evaluateAyasExperiment({ hypothesis, baseline, experiment, baselineSuites, experimentSuites, ...(abortCode ? { abortCode } : {}) });
  const evidence: AyasExperimentEvidence = {
    schemaVersion: AYAS_RESEARCH_IMPROVEMENT_SCHEMA_VERSION,
    experimentId: record.experimentId,
    attemptKey: record.attemptKey,
    baseHead: record.baseHead,
    findingIds: hypothesis.findingIds,
    sourceIds: [...ctx.sourceIds],
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
  return { record: finalRecord, verdict: written.verdict, reasonCodes: written.reasonCodes };
}

function readAyasSandboxToolVersionsSafe(sandbox: AyasResearchExperimentSandbox): { readonly tsx: string | null; readonly typescript: string | null } {
  try { return readAyasSandboxToolVersions(sandbox); } catch { return { tsx: null, typescript: null }; }
}
