import { execFile } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";

import { selectAyasAgenticRoute, type AyasAvailabilityEvidence } from "../../ayas/routing/AyasAgenticRouting";
import type { AyasTraceHandle } from "../../ayas/trace/AyasUnifiedTrace";
import type { AyasApprovalInboxHandle } from "./AyasApprovalInboxStore";
import type { AyasExternalResearchFinding } from "./AyasExternalResearchStore";
import { isAyasInternalReviewDecisionReason } from "./AyasOwnerApprovalProvenance";
import { readProcessStartEpochMs } from "./AyasProcessLiveness";
import {
  AYAS_EXPERIMENT_ISOLATION, AYAS_RESEARCH_EXPERIMENT_PROPOSAL_MUTATION_KIND, ayasBaselineReproducesHypothesis, ayasEvidenceContainsSecret, boundAyasExperimentDiff,
  evaluateAyasExperiment, toAyasEvidenceMeasurement,
  type AyasBenchmarkRunOutcome, type AyasExperimentAbortCode, type AyasExperimentAnalysisRoute, type AyasExperimentEvidence, type AyasRegressionSuiteResult,
} from "./AyasResearchExperimentEvaluation";
import {
  AYAS_DEFAULT_IMPROVEMENT_REGISTRY, AYAS_EXPERIMENT_MAX_CHANGED_LINES, ayasImprovementRegistryDigest, findAyasImprovementBenchmark, validateAyasImprovementStrategy,
  type AyasImprovementBenchmark, type AyasImprovementRegistry, type AyasImprovementStrategy,
} from "./AyasResearchExperimentRegistry";
import {
  applyAyasStrategyInSandbox, captureAyasSandboxChange, createAyasResearchExperimentSandbox, destroyAyasResearchExperimentSandbox, readAyasSandboxToolVersions,
  runAyasBenchmarkInSandbox, runAyasRegressionSuiteInSandbox, stampAyasNodeModules, sweepAyasStaleResearchSandboxes, type AyasResearchExperimentSandbox,
} from "./AyasResearchExperimentSandbox";
import {
  AYAS_RESEARCH_EXPERIMENT_BUDGET, createAyasResearchExperimentStore, decideAyasExperimentAdmission, isAyasExperimentActive, reconcileAyasInterruptedExperiments, resolveAyasResearchImprovementRoot,
  type AyasExperimentRecord, type AyasResearchExperimentBudget, type AyasResearchExperimentStore, type AyasResearchImprovementIndex, type AyasResearchIndexedFinding,
} from "./AyasResearchExperimentStore";
import {
  AYAS_RESEARCH_IMPROVEMENT_SCHEMA_VERSION, ayasResearchIndexKey, buildAyasImprovementHypothesis, normalizeAyasResearchImprovementCandidate, planAyasResearchCandidate,
  type AyasImprovementHypothesis, type AyasKnownResearchFinding, type AyasLocalGapSnapshot, type AyasResearchImprovementCandidate,
} from "./AyasResearchImprovementLoop";
import { AYAS_RESEARCH_EXPERIMENT_EVIDENCE_PREFIX, type AyasResearchDesignReviewGate } from "./AyasResearchProposalBridge";

const execFileAsync = promisify(execFile);

/**
 * Stage 8 — one bounded, restart-safe pass of the research → improvement
 * loop. It classifies a bounded batch of new findings, measures a local gap
 * at most once per HEAD, admits at most one sandbox experiment under a
 * durable reservation, and returns verified IMPROVED evidence for the
 * existing bridge → discovery → owner-approval path.
 *
 * Authority boundary: this module never approves, reserves an approval,
 * opens a gate, resolves a mutation, stages, commits or pushes. Its only
 * write into the approval inbox is the existing `markStale` bookkeeping for
 * research experiment proposals whose bound evidence no longer verifies.
 */
export interface AyasResearchImprovementObservation {
  readonly now: string;
  readonly head: string;
  readonly repoClean: boolean;
  readonly graphifyFresh: boolean;
  readonly machineAction: string;
}

export type AyasResearchExperimentFaultPoint = "before-gap-measurement" | "after-reservation" | "after-baseline" | "after-change-applied" | "after-evidence-written" | "before-finalize";

export interface AyasResearchImprovementCycleDeps {
  readonly repoRoot: string;
  readonly observation: AyasResearchImprovementObservation;
  readonly findings: readonly AyasExternalResearchFinding[];
  readonly store?: AyasResearchExperimentStore;
  readonly registry?: AyasImprovementRegistry;
  readonly budget?: Partial<AyasResearchExperimentBudget>;
  readonly timeBudgetMs?: number;
  readonly nodeModulesDir?: string;
  readonly inbox?: Pick<AyasApprovalInboxHandle, "load" | "markStale">;
  /** Stage 7 availability evidence for the advisory analysis route; never an execution input. */
  readonly availability?: AyasAvailabilityEvidence;
  readonly trace?: AyasTraceHandle;
  readonly clock?: () => string;
  /** Test-only crash injection. Production callers never set it. */
  readonly faultInjection?: (point: AyasResearchExperimentFaultPoint) => void | Promise<void>;
}

export interface AyasResearchImprovementCycleResult {
  readonly outcome: "SKIPPED_REPO_NOT_READY" | "COMPLETED";
  /** New findings classified this cycle (bounded by `maxFindingsPerCycle`). */
  readonly classified: number;
  /** Already-classified findings re-planned after this cycle's gap measurement (same bound). */
  readonly replanned: number;
  readonly relevance: Readonly<Record<string, number>>;
  readonly outcomes: Readonly<Record<string, number>>;
  readonly pendingFindings: number;
  readonly gapSnapshotsMeasured: number;
  readonly reconciledInterrupted: readonly string[];
  readonly admission: string | null;
  readonly experiment: { readonly experimentId: string; readonly hypothesisId: string; readonly verdict: string; readonly reasonCodes: readonly string[] } | null;
  readonly staleProposals: readonly string[];
  readonly proposalEvidence: readonly { readonly evidence: AyasExperimentEvidence; readonly evidenceHash: string }[];
  /** Admits a design-review proposal only where the loop found that a design, not a claim, is what is missing. */
  readonly designReviewGate: AyasResearchDesignReviewGate;
  readonly durationMs: number;
}

export const AYAS_RESEARCH_IMPROVEMENT_DEFAULT_TIME_BUDGET_MS = 90_000;
const COMMIT = /^[0-9a-f]{40}$/;
const ANALYSIS_TASK_TEXT = "Sandbox deneyi için smoke test planı hazırla ve benchmark sonucunu doğrula";
const sha256 = (value: string): string => crypto.createHash("sha256").update(value, "utf8").digest("hex");
const bump = (counter: Record<string, number>, key: string): void => { counter[key] = (counter[key] ?? 0) + 1; };

function knownFrom(entry: AyasResearchIndexedFinding): AyasKnownResearchFinding {
  return { findingId: entry.findingId, domain: entry.domain, sourceIds: entry.sourceIds, claimFingerprint: entry.claimFingerprint, claimTokenHashes: entry.claimTokenHashes };
}

/** A finding whose "no local gap" is older than this is re-measured once at a later HEAD, so a later regression is noticed. */
export const AYAS_RESEARCH_NO_GAP_RECHECK_MS = 7 * 24 * 60 * 60_000;

/**
 * Bounded work queue: new findings; findings whose hypothesis was retired;
 * findings waiting for a measurement that now exists; "no local gap" findings
 * when a measurement at a newer HEAD exists; and design, benchmark or
 * hypothesis outcomes decided under an older registry.
 */
function selectFindingQueue(findings: readonly AyasExternalResearchFinding[], index: AyasResearchImprovementIndex, registryDigest: string, snapshots: readonly AyasLocalGapSnapshot[], head: string, limit: number, presentKeys: ReadonlySet<string>): readonly AyasExternalResearchFinding[] {
  const measuredHere = (benchmarkId: string | undefined) => snapshots.some((snapshot) => snapshot.benchmarkId === benchmarkId && snapshot.measuredAtHead === head);
  return [...findings]
    .filter((finding) => {
      const entry = index.findings[ayasResearchIndexKey(finding.findingId)];
      if (!entry || entry.outcome === "REPLAN_PENDING") return true;
      if (entry.outcome === "GAP_NOT_MEASURED") return measuredHere(entry.gap?.benchmarkId) || entry.registryDigest !== registryDigest;
      if (entry.outcome === "NO_LOCAL_GAP") return entry.gap?.measuredAtHead !== head && measuredHere(entry.gap?.benchmarkId);
      if (entry.outcome === "IGNORED") {
        // Irrelevance depends on the capability map; a duplicate depends on its original still being plausible.
        if (entry.reasonCode === "NO_AYAS_CAPABILITY") return entry.registryDigest !== registryDigest;
        if (entry.relevance === "DUPLICATE") return !presentKeys.has(entry.duplicateOf ?? "") || index.findings[entry.duplicateOf ?? ""]?.relevance !== "PLAUSIBLE_IMPROVEMENT";
        return false;
      }
      return (entry.outcome === "NEEDS_EXPERIMENT_DESIGN" || entry.outcome === "NO_LOCAL_BENCHMARK" || entry.outcome === "HYPOTHESIS") && entry.registryDigest !== registryDigest;
    })
    .sort((a, b) => String(a.recordedAt).localeCompare(String(b.recordedAt)) || String(a.findingId).localeCompare(String(b.findingId)))
    .slice(0, Math.max(0, limit));
}

interface ClassifiedBatch {
  readonly index: AyasResearchImprovementIndex;
  readonly relevance: Record<string, number>;
  readonly outcomes: Record<string, number>;
  readonly classified: number;
}

function classifyFindingBatch(queue: readonly AyasExternalResearchFinding[], index: AyasResearchImprovementIndex, registry: AyasImprovementRegistry, registryDigest: string, snapshots: readonly AyasLocalGapSnapshot[], head: string, nowIso: string, presentKeys: ReadonlySet<string>): ClassifiedBatch {
  const findings: Record<string, AyasResearchIndexedFinding> = { ...index.findings };
  const hypotheses = { ...index.hypotheses };
  const relevanceCounts: Record<string, number> = {};
  const outcomeCounts: Record<string, number> = {};
  for (const finding of queue) {
    const key = ayasResearchIndexKey(finding.findingId);
    const prior = findings[key];
    let candidate: AyasResearchImprovementCandidate;
    try { candidate = normalizeAyasResearchImprovementCandidate(finding, nowIso); }
    catch {
      findings[key] = { findingId: key, domain: null, sourceIds: [], claimFingerprint: "", claimTokenHashes: [], relevance: "INVALID", reasonCode: "INVALID_FINDING", outcome: "IGNORED", registryDigest, processedAt: nowIso };
      bump(relevanceCounts, "INVALID"); bump(outcomeCounts, "IGNORED");
      continue;
    }
    // A finding already judged plausible keeps that judgment; only its gap/strategy mapping is redone.
    // Duplicates are judged only against findings accepted as plausible, so a weak or hostile finding
    // processed first can never suppress a stronger one.
    const known = Object.values(findings).filter((entry) => entry.findingId !== key && entry.relevance === "PLAUSIBLE_IMPROVEMENT" && presentKeys.has(entry.findingId)).map(knownFrom);
    const plan = prior?.relevance === "PLAUSIBLE_IMPROVEMENT"
      ? planAyasResearchCandidate(candidate, registry, [], snapshots, head)
      : planAyasResearchCandidate(candidate, registry, known, snapshots, head);
    // A re-planned finding leaves its previous hypothesis; a hypothesis with no finding left is retired.
    const previous = prior?.hypothesisId ? hypotheses[prior.hypothesisId] : undefined;
    if (previous && prior?.hypothesisId && !(plan.outcome === "HYPOTHESIS" && plan.hypothesis.hypothesisId === prior.hypothesisId)) {
      const remaining = previous.hypothesis.findingIds.filter((id) => id !== key);
      if (remaining.length === 0) delete hypotheses[prior.hypothesisId];
      else hypotheses[prior.hypothesisId] = { ...previous, hypothesis: { ...previous.hypothesis, findingIds: remaining } };
    }
    const base = { findingId: key, domain: candidate.domain, sourceIds: candidate.sourceIds, claimFingerprint: candidate.claimFingerprint, claimTokenHashes: candidate.claimTokenHashes, relevance: plan.relevance.relevance, reasonCode: plan.relevance.reasonCode, ...(plan.relevance.duplicateOf ? { duplicateOf: plan.relevance.duplicateOf } : {}), registryDigest, processedAt: nowIso };
    bump(relevanceCounts, plan.relevance.relevance);
    bump(outcomeCounts, plan.outcome);
    if (plan.outcome === "IGNORED" || plan.outcome === "NO_LOCAL_BENCHMARK") {
      findings[key] = { ...base, outcome: plan.outcome };
    } else if (plan.outcome === "GAP_NOT_MEASURED") {
      findings[key] = { ...base, outcome: plan.outcome, gap: { benchmarkId: plan.mapping.benchmarkId } };
    } else if (plan.outcome === "NO_LOCAL_GAP") {
      findings[key] = { ...base, outcome: plan.outcome, gap: { benchmarkId: plan.mapping.benchmarkId, measuredAtHead: plan.mapping.measuredAtHead, failingTargetCount: 0 } };
    } else {
      const gap = { benchmarkId: plan.mapping.benchmarkId, dimension: plan.mapping.dimension, measuredAtHead: plan.mapping.snapshot.measuredAtHead, failingTargetCount: plan.mapping.targetCaseIds.length };
      if (plan.outcome === "NEEDS_EXPERIMENT_DESIGN") {
        findings[key] = { ...base, outcome: plan.outcome, gap };
      } else {
        const existing = hypotheses[plan.hypothesis.hypothesisId];
        const findingIds = [...new Set([...(existing?.hypothesis.findingIds ?? []), key])].sort();
        hypotheses[plan.hypothesis.hypothesisId] = { hypothesis: { ...plan.hypothesis, findingIds }, createdAt: existing?.createdAt ?? nowIso, updatedAt: nowIso };
        findings[key] = { ...base, outcome: plan.outcome, hypothesisId: plan.hypothesis.hypothesisId, gap };
      }
    }
  }
  return { index: { ...index, findings, hypotheses }, relevance: relevanceCounts, outcomes: outcomeCounts, classified: queue.length };
}

/**
 * Keeps hypotheses consistent with the registry and the current HEAD. A
 * hypothesis whose strategy (id and version) is gone is retired and its
 * findings are queued for re-planning. One measured at an older HEAD is
 * rebuilt from the current snapshot; if its gap vanished, it is retired and
 * its findings record "no local gap" at this HEAD. No finding is left
 * pointing at a hypothesis that no longer exists.
 */
function refreshHypotheses(index: AyasResearchImprovementIndex, registry: AyasImprovementRegistry, snapshots: readonly AyasLocalGapSnapshot[], head: string, nowIso: string, presentKeys: ReadonlySet<string>): AyasResearchImprovementIndex {
  // Built into a fresh map: a rebuilt hypothesis that lands on the id of one not yet visited is merged,
  // and nothing visited later can delete that merge.
  const next: Record<string, AyasResearchImprovementIndex["hypotheses"][string]> = {};
  const findings: Record<string, AyasResearchIndexedFinding> = { ...index.findings };
  let changed = false;
  const keep = (id: string, value: AyasResearchImprovementIndex["hypotheses"][string]) => {
    const existing = next[id];
    next[id] = existing
      ? { ...value, hypothesis: { ...value.hypothesis, findingIds: [...new Set([...existing.hypothesis.findingIds, ...value.hypothesis.findingIds])].sort() }, createdAt: existing.createdAt < value.createdAt ? existing.createdAt : value.createdAt }
      : value;
  };
  const repoint = (findingIds: readonly string[], from: string, update: (entry: AyasResearchIndexedFinding) => AyasResearchIndexedFinding) => {
    for (const id of findingIds) { const entry = findings[id]; if (entry && entry.hypothesisId === from) findings[id] = update(entry); }
  };
  for (const [hypothesisId, entry] of Object.entries(index.hypotheses)) {
    const h = entry.hypothesis;
    // Research that no longer exists justifies no measurement and no experiment.
    if (!h.findingIds.some((id) => presentKeys.has(id))) { changed = true; continue; }
    const strategy = registry.strategies.find((item) => item.strategyId === h.strategyId && item.version === h.strategyVersion);
    if (!strategy) {
      repoint(h.findingIds, hypothesisId, (finding) => ({ ...finding, outcome: "REPLAN_PENDING", hypothesisId: undefined, processedAt: nowIso }));
      changed = true;
      continue;
    }
    if (h.gapEvidence.measuredAtHead === head) { keep(hypothesisId, entry); continue; }
    const snapshot = snapshots.find((item) => item.benchmarkId === h.benchmarkId && item.measuredAtHead === head);
    if (!snapshot) { keep(hypothesisId, entry); continue; }
    const targetCaseIds = snapshot.failing.filter((row) => row.dimension === h.targetDimension && !row.heldOut).map((row) => row.id).sort();
    changed = true;
    if (targetCaseIds.length === 0) {
      repoint(h.findingIds, hypothesisId, (finding) => ({ ...finding, outcome: "NO_LOCAL_GAP", hypothesisId: undefined, gap: { benchmarkId: h.benchmarkId, measuredAtHead: head, failingTargetCount: 0 }, processedAt: nowIso }));
      continue;
    }
    const rebuilt = buildAyasImprovementHypothesis({ status: "MAPPED", capability: h.capability, component: h.component, benchmarkId: h.benchmarkId, dimension: h.targetDimension, targetCaseIds, snapshot }, strategy, h.findingIds);
    keep(rebuilt.hypothesisId, { hypothesis: rebuilt, createdAt: entry.createdAt, updatedAt: nowIso });
    repoint(h.findingIds, hypothesisId, (finding) => ({ ...finding, hypothesisId: rebuilt.hypothesisId, gap: { benchmarkId: h.benchmarkId, dimension: h.targetDimension, measuredAtHead: head, failingTargetCount: targetCaseIds.length } }));
  }
  return changed ? { ...index, hypotheses: next, findings } : index;
}

const DESIGN_REVIEW_OUTCOMES = new Set(["NEEDS_EXPERIMENT_DESIGN", "NO_LOCAL_BENCHMARK"]);

/** Builds the bridge gate from the durable loop index. An unprocessed finding is not admitted yet. */
export function buildAyasResearchDesignReviewGate(index: AyasResearchImprovementIndex): AyasResearchDesignReviewGate {
  return (finding) => {
    const entry = index.findings[ayasResearchIndexKey(finding.findingId)];
    if (!entry || entry.relevance !== "PLAUSIBLE_IMPROVEMENT" || !DESIGN_REVIEW_OUTCOMES.has(entry.outcome)) return null;
    return [
      `stage8-outcome:${entry.outcome}`,
      ...(entry.gap?.dimension ? [`local-gap:${entry.gap.benchmarkId}/${entry.gap.dimension}/${entry.gap.failingTargetCount ?? 0}@${String(entry.gap.measuredAtHead ?? "").slice(0, 12)}`] : []),
    ];
  };
}

export const AYAS_RESEARCH_DESIGN_REVIEW_CLOSED_GATE: AyasResearchDesignReviewGate = () => null;

/** Admission refusals that cannot change until HEAD moves (or the registry changes, which rebuilds the hypothesis). */
const SETTLED_ADMISSIONS = new Set(["NEGATIVE_RESULT_KNOWN", "OWNER_REJECTED", "EVIDENCE_CURRENT", "ATTEMPTS_EXHAUSTED", "STRATEGY_UNAVAILABLE"]);

/**
 * Entries for findings still present in the research store are never
 * evicted — evicting one would make it look new and re-queue it forever. Only
 * entries whose finding disappeared are dropped, oldest first, past the cap.
 */
function pruneIndex(index: AyasResearchImprovementIndex, budget: AyasResearchExperimentBudget, nowIso: string, presentKeys: ReadonlySet<string>): AyasResearchImprovementIndex {
  const all = Object.values(index.findings);
  const orphans = all.filter((entry) => !presentKeys.has(entry.findingId)).sort((a, b) => b.processedAt.localeCompare(a.processedAt));
  const keepOrphans = orphans.slice(0, Math.max(0, budget.maxIndexedFindings - (all.length - orphans.length)));
  const kept = [...all.filter((entry) => presentKeys.has(entry.findingId)), ...keepOrphans];
  const nowMs = Date.parse(nowIso);
  return { ...index, findings: Object.fromEntries(kept.map((entry) => [entry.findingId, entry])), experimentStarts: index.experimentStarts.filter((at) => nowMs - Date.parse(at) < 2 * 24 * 60 * 60_000).slice(-50) };
}

async function gitRead(repoRoot: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["--no-optional-locks", ...args], { cwd: repoRoot, encoding: "utf8", windowsHide: true, timeout: 30_000, maxBuffer: 4_000_000 });
  return stdout.trim();
}

/** Identity of everything an experiment reads that a strategy or benchmark declares: blob ids at the base commit. */
async function experimentInputsDigest(repoRoot: string, head: string, benchmark: AyasImprovementBenchmark, strategy: AyasImprovementStrategy): Promise<string> {
  const paths = [benchmark.script, ...strategy.exactFiles, ...strategy.regressionSuites];
  // One `ls-tree` for every declared path; an absent path is part of the identity too.
  let listing = "";
  try { listing = await gitRead(repoRoot, ["ls-tree", head, "--", ...paths]); } catch { listing = ""; }
  const blobByPath = new Map(listing.split("\n").filter(Boolean).map((line) => { const [meta, file] = line.split("\t"); return [file ?? "", meta?.split(" ")[2] ?? ""] as const; }));
  return sha256(JSON.stringify(paths.map((file) => `${file}=${blobByPath.get(file) ?? "missing"}`)));
}

async function liveWorkspaceState(repoRoot: string): Promise<{ readonly head: string; readonly clean: boolean } | null> {
  try { return { head: await gitRead(repoRoot, ["rev-parse", "HEAD"]), clean: (await gitRead(repoRoot, ["status", "--porcelain"])).length === 0 }; }
  catch { return null; }
}

/** Measures one registered benchmark at `head` inside a disposable sandbox. */
export async function measureAyasLocalGapSnapshot(input: { readonly repoRoot: string; readonly head: string; readonly benchmark: AyasImprovementBenchmark; readonly timeoutMs: number; readonly nodeModulesDir?: string; readonly nowIso: string }): Promise<AyasLocalGapSnapshot | null> {
  let sandbox: AyasResearchExperimentSandbox | undefined;
  let snapshot: AyasLocalGapSnapshot | null = null;
  let discarded = true;
  try {
    const deadline = Date.now() + input.timeoutMs;
    const nodeModulesDir = input.nodeModulesDir ?? path.join(input.repoRoot, "node_modules");
    const nodeModulesBefore = stampAyasNodeModules(nodeModulesDir);
    sandbox = await createAyasResearchExperimentSandbox({ repoRoot: input.repoRoot, baseHead: input.head, timeoutMs: input.timeoutMs, ...(input.nodeModulesDir ? { nodeModulesDir: input.nodeModulesDir } : {}) });
    const run = await runAyasBenchmarkInSandbox(sandbox, input.benchmark, Math.max(1, deadline - Date.now()));
    // A measurement whose benchmark wrote through the shared node_modules junction is not trusted.
    if (!run.ok || stampAyasNodeModules(nodeModulesDir) !== nodeModulesBefore) return null;
    const m = run.measurement;
    snapshot = { schemaVersion: AYAS_RESEARCH_IMPROVEMENT_SCHEMA_VERSION, benchmarkId: m.benchmarkId, evaluatorSha256: m.evaluatorSha256, measuredAtHead: input.head, measuredAt: input.nowIso, caseCount: m.caseCount, passed: m.passed, heldOut: m.heldOut, dimensions: m.dimensions, failing: m.failing };
  } catch {
    snapshot = null;
  } finally {
    if (sandbox) discarded = await destroyAyasResearchExperimentSandbox(sandbox);
  }
  return discarded ? snapshot : null;
}

function analysisRoute(availability: AyasAvailabilityEvidence | undefined): AyasExperimentAnalysisRoute {
  const route = selectAyasAgenticRoute({ text: ANALYSIS_TASK_TEXT, availableModelIds: availability?.availableModelIds ?? [], ...(availability?.availableSkillIds ? { availableSkillIds: availability.availableSkillIds } : {}), ...(availability?.availableAgentIds ? { availableAgentIds: availability.availableAgentIds } : {}) });
  return { agent: route.selectedAgentId, tool: route.selectedToolId, skill: route.selectedSkillId, model: route.selectedModelId, blocked: route.blocked, reasonCodes: [...route.reasonCodes], executor: "ayas-sandbox-runner", authority: "NONE" };
}

interface ExperimentContext {
  readonly deps: AyasResearchImprovementCycleDeps;
  readonly store: AyasResearchExperimentStore;
  readonly record: AyasExperimentRecord;
  readonly hypothesis: AyasImprovementHypothesis;
  readonly strategy: AyasImprovementStrategy;
  readonly benchmark: AyasImprovementBenchmark;
  readonly sourceIds: readonly string[];
  readonly remainingMs: () => number;
  readonly clock: () => string;
}

async function runReservedExperiment(ctx: ExperimentContext): Promise<{ readonly record: AyasExperimentRecord; readonly verdict: string; readonly reasonCodes: readonly string[] }> {
  const { deps, store, hypothesis, strategy, benchmark } = ctx;
  let record = ctx.record;
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

/**
 * Durable evidence binding for research experiment proposals. A proposal
 * whose bound evidence hash no longer verifies against a COMPLETED IMPROVED
 * record at the same base HEAD is marked STALE through the existing
 * bookkeeping primitive; it can never be revived, only rediscovered.
 */
export function reconcileAyasResearchExperimentProposals(inbox: Pick<AyasApprovalInboxHandle, "load" | "markStale">, store: AyasResearchExperimentStore, nowIso: string): readonly string[] {
  const staled: string[] = [];
  for (const proposal of inbox.load().proposals) {
    if (proposal.mutationKind !== AYAS_RESEARCH_EXPERIMENT_PROPOSAL_MUTATION_KIND || !["PENDING", "DEFERRED", "APPROVED"].includes(proposal.status)) continue;
    const hash = proposal.evidence.find((item) => item.startsWith(AYAS_RESEARCH_EXPERIMENT_EVIDENCE_PREFIX))?.slice(AYAS_RESEARCH_EXPERIMENT_EVIDENCE_PREFIX.length) ?? "";
    const record = proposal.sourceReference ? store.readExperiment(proposal.sourceReference) : undefined;
    const evidence = record?.evidenceHash === hash ? store.readEvidence(hash) : undefined;
    const bound = !!record && record.status === "COMPLETED" && record.verdict === "IMPROVED" && !!evidence && evidence.experimentId === record.experimentId && record.baseHead === proposal.baseHead;
    if (bound) continue;
    try { inbox.markStale(proposal.proposalId, nowIso); staled.push(proposal.proposalId); } catch { /* status changed concurrently; next tick re-checks */ }
  }
  return staled;
}

/** Benchmarks that findings or hypotheses are waiting on at this HEAD and that may still be measured. */
function pendingMeasurements(index: AyasResearchImprovementIndex, findings: readonly AyasExternalResearchFinding[], snapshots: readonly AyasLocalGapSnapshot[], head: string, budget: AyasResearchExperimentBudget, nowIso: string, registry: AyasImprovementRegistry): readonly string[] {
  const needed = new Set<string>();
  for (const finding of findings) {
    const entry = index.findings[ayasResearchIndexKey(finding.findingId)];
    if (entry?.outcome === "GAP_NOT_MEASURED" && entry.gap) needed.add(entry.gap.benchmarkId);
    // A stale "no local gap" is re-measured at most weekly, never on every commit.
    if (entry?.outcome === "NO_LOCAL_GAP" && entry.gap && entry.gap.measuredAtHead !== head && Date.parse(nowIso) - Date.parse(entry.processedAt) >= AYAS_RESEARCH_NO_GAP_RECHECK_MS) needed.add(entry.gap.benchmarkId);
  }
  for (const entry of Object.values(index.hypotheses)) if (entry.hypothesis.gapEvidence.measuredAtHead !== head) needed.add(entry.hypothesis.benchmarkId);
  return [...needed]
    .filter((benchmarkId) => !snapshots.some((snapshot) => snapshot.benchmarkId === benchmarkId && snapshot.measuredAtHead === head))
    .filter((benchmarkId) => (index.measurementAttempts?.[`${benchmarkId}@${head}`] ?? 0) < budget.maxMeasurementAttemptsPerHead)
    .filter((benchmarkId) => Boolean(findAyasImprovementBenchmark(registry, benchmarkId)))
    .sort();
}

/** Attempt keys whose evidence proposal the owner rejected (AYAS's own internal review decisions do not count). */
function ownerRejectedAttemptKeys(inbox: Pick<AyasApprovalInboxHandle, "load"> | undefined, store: AyasResearchExperimentStore): ReadonlySet<string> {
  const keys = new Set<string>();
  if (!inbox) return keys;
  const state = inbox.load();
  for (const proposal of state.proposals) {
    if (proposal.mutationKind !== AYAS_RESEARCH_EXPERIMENT_PROPOSAL_MUTATION_KIND || proposal.status !== "REJECTED" || !proposal.sourceReference) continue;
    const decision = [...state.decisions].reverse().find((item) => item.proposalId === proposal.proposalId && item.decision === "REJECT");
    if (!decision || isAyasInternalReviewDecisionReason(decision.reason)) continue;
    const record = store.readExperiment(proposal.sourceReference);
    if (record) keys.add(record.attemptKey);
  }
  return keys;
}

/** The machine allows heavy work and no global (daily-budget) deferral is pending. */
function admissionMayProceed(index: AyasResearchImprovementIndex, heavyAllowed: boolean, nowIso: string): boolean {
  return heavyAllowed && (!index.admissionDeferredUntil || Date.parse(nowIso) >= Date.parse(index.admissionDeferredUntil));
}

/** Measured at this HEAD, not settled at this HEAD, and past any time-based deferral. */
function isAdmissionCandidate(entry: AyasResearchImprovementIndex["hypotheses"][string], head: string, nowIso: string): boolean {
  return entry.hypothesis.gapEvidence.measuredAtHead === head && entry.settledAdmission?.head !== head
    && (!entry.deferredUntil || Date.parse(nowIso) >= Date.parse(entry.deferredUntil));
}

/** A crashed tick's sandbox is swept once it is clearly abandoned; live experiments are far shorter than this. */
export const AYAS_RESEARCH_SANDBOX_ORPHAN_AGE_MS = 6 * 60 * 60_000;

/** One bounded loop pass. Safe on every daemon tick: with nothing to do it takes no lock and writes nothing. */
export async function runAyasResearchImprovementCycle(deps: AyasResearchImprovementCycleDeps): Promise<AyasResearchImprovementCycleResult> {
  const started = performance.now();
  const registry = deps.registry ?? AYAS_DEFAULT_IMPROVEMENT_REGISTRY;
  const budget: AyasResearchExperimentBudget = { ...AYAS_RESEARCH_EXPERIMENT_BUDGET, ...deps.budget };
  const store = deps.store ?? createAyasResearchExperimentStore({ rootDir: resolveAyasResearchImprovementRoot(deps.repoRoot) });
  const clock = deps.clock ?? (() => new Date().toISOString());
  const timeBudgetMs = deps.timeBudgetMs ?? AYAS_RESEARCH_IMPROVEMENT_DEFAULT_TIME_BUDGET_MS;
  const remainingMs = () => timeBudgetMs - (performance.now() - started);
  const { observation } = deps;
  const cycleSpan = deps.trace?.startSpan("research", "ayas-research", "improvement-cycle");
  const finish = (result: Omit<AyasResearchImprovementCycleResult, "durationMs">): AyasResearchImprovementCycleResult => ({ ...result, durationMs: Math.round(performance.now() - started) });
  if (!observation.repoClean || !observation.graphifyFresh || !COMMIT.test(observation.head)) {
    cycleSpan?.end("denied", undefined, "REPO_NOT_READY");
    return finish({ outcome: "SKIPPED_REPO_NOT_READY", classified: 0, replanned: 0, relevance: {}, outcomes: {}, pendingFindings: 0, gapSnapshotsMeasured: 0, reconciledInterrupted: [], admission: null, experiment: null, staleProposals: [], proposalEvidence: [], designReviewGate: AYAS_RESEARCH_DESIGN_REVIEW_CLOSED_GATE });
  }
  const heavyAllowed = observation.machineAction === "ALLOW";
  const registryDigest = ayasImprovementRegistryDigest(registry);
  const head = observation.head;
  const presentKeys = new Set(deps.findings.map((finding) => ayasResearchIndexKey(finding.findingId)));

  // Lock-free read of atomically written state decides whether any work exists at all.
  const peekIndex = store.loadIndex();
  const peekSnapshots = store.listGapSnapshots();
  const hasWork = selectFindingQueue(deps.findings, peekIndex, registryDigest, peekSnapshots, head, budget.maxFindingsPerCycle, presentKeys).length > 0
    || Object.values(peekIndex.hypotheses).some((entry) => entry.hypothesis.gapEvidence.measuredAtHead !== head && peekSnapshots.some((snapshot) => snapshot.benchmarkId === entry.hypothesis.benchmarkId && snapshot.measuredAtHead === head))
    || store.listExperiments().some(isAyasExperimentActive)
    || (admissionMayProceed(peekIndex, heavyAllowed, clock()) && Object.values(peekIndex.hypotheses).some((entry) => isAdmissionCandidate(entry, head, clock())))
    || Object.values(peekIndex.hypotheses).some((entry) => !registry.strategies.some((strategy) => strategy.strategyId === entry.hypothesis.strategyId && strategy.version === entry.hypothesis.strategyVersion))
    || (heavyAllowed && pendingMeasurements(peekIndex, deps.findings, peekSnapshots, head, budget, clock(), registry).length > 0);

  let reconciled: readonly string[] = [];
  let classified = 0;
  let replanned = 0;
  const relevance: Record<string, number> = {};
  const outcomes: Record<string, number> = {};
  const merge = (target: Record<string, number>, source: Readonly<Record<string, number>>, prefix = "") => { for (const [key, value] of Object.entries(source)) target[`${prefix}${key}`] = (target[`${prefix}${key}`] ?? 0) + value; };
  const snapshots: AyasLocalGapSnapshot[] = [];
  const rejectedAttemptKeys = ownerRejectedAttemptKeys(deps.inbox, store);
  let admission: string | null = null;
  let experiment: AyasResearchImprovementCycleResult["experiment"] = null;

  if (hasWork) {
    const activeSandboxes = new Set(store.listExperiments().filter(isAyasExperimentActive).map((record) => record.sandboxRoot).filter((root): root is string => Boolean(root)));
    await sweepAyasStaleResearchSandboxes(AYAS_RESEARCH_SANDBOX_ORPHAN_AGE_MS, activeSandboxes);
    // A — crash reconciliation and a bounded classification batch, under the loop's own lock.
    const classifySpan = deps.trace?.startSpan("research", "ayas-research", "classify-findings", cycleSpan?.spanId ?? null);
    const phaseA = await store.withLock(async () => {
      const recovered = await reconcileAyasInterruptedExperiments(store, clock());
      const index = store.loadIndex();
      const currentSnapshots = store.listGapSnapshots();
      const queue = selectFindingQueue(deps.findings, index, registryDigest, currentSnapshots, head, budget.maxFindingsPerCycle, presentKeys);
      const batch = classifyFindingBatch(queue, index, registry, registryDigest, currentSnapshots, head, clock(), presentKeys);
      let refreshed = refreshHypotheses(batch.index, registry, currentSnapshots, head, clock(), presentKeys);
      // Measurement attempts are recorded BEFORE measuring, so a tick killed mid-measurement still spends one.
      const toMeasure = heavyAllowed && remainingMs() >= budget.minGapSnapshotTimeBudgetMs
        ? pendingMeasurements(refreshed, deps.findings, currentSnapshots, head, budget, clock(), registry).slice(0, budget.maxGapSnapshotsPerCycle)
        : [];
      if (toMeasure.length > 0) {
        const attempts = { ...(refreshed.measurementAttempts ?? {}) };
        for (const benchmarkId of toMeasure) attempts[`${benchmarkId}@${head}`] = (attempts[`${benchmarkId}@${head}`] ?? 0) + 1;
        refreshed = { ...refreshed, measurementAttempts: Object.fromEntries(Object.entries(attempts).slice(-20)) };
      }
      if (queue.length > 0 || refreshed !== batch.index) store.saveIndex(pruneIndex(refreshed, budget, clock(), presentKeys));
      return { recovered, batch, toMeasure };
    });
    reconciled = phaseA.recovered;
    // An interrupted attempt's sandbox is removed; the destroy primitive only ever deletes an owned OS-TEMP run root.
    for (const experimentId of reconciled) {
      const orphan = store.readExperiment(experimentId);
      if (orphan?.sandboxRoot) await destroyAyasResearchExperimentSandbox({ runRoot: orphan.sandboxRoot, repoDir: path.join(orphan.sandboxRoot, "repo"), baseHead: orphan.baseHead, nodeModulesLink: null });
    }
    classified += phaseA.batch.classified;
    merge(relevance, phaseA.batch.relevance);
    merge(outcomes, phaseA.batch.outcomes);
    classifySpan?.end("ok", { findingCount: phaseA.batch.classified, ignoredCount: phaseA.batch.outcomes.IGNORED ?? 0 });

    // B — at most `maxGapSnapshotsPerCycle` sandboxed benchmark measurements at this HEAD.
    for (const benchmarkId of phaseA.toMeasure) {
      const benchmark = findAyasImprovementBenchmark(registry, benchmarkId);
      if (!benchmark || remainingMs() < budget.minGapSnapshotTimeBudgetMs) break;
      if (deps.faultInjection) await deps.faultInjection("before-gap-measurement");
      const gapSpan = deps.trace?.startSpan("research", "ayas-research", "measure-gap", cycleSpan?.spanId ?? null);
      const snapshot = await measureAyasLocalGapSnapshot({ repoRoot: deps.repoRoot, head, benchmark, timeoutMs: Math.max(1, Math.min(benchmark.timeoutMs, remainingMs() - 5_000)), nowIso: clock(), ...(deps.nodeModulesDir ? { nodeModulesDir: deps.nodeModulesDir } : {}) });
      gapSpan?.end(snapshot ? "ok" : "error", { caseCount: snapshot?.caseCount ?? null }, snapshot ? undefined : "GAP_MEASUREMENT_FAILED");
      if (snapshot) snapshots.push(snapshot);
    }

    // C — record measurements, re-plan waiting findings, admit at most one experiment.
    const phaseC = await store.withLock(async () => {
      for (const snapshot of snapshots) store.writeGapSnapshot(snapshot, budget.maxGapSnapshots);
      const loaded = store.loadIndex();
      let index = loaded;
      let extra: ClassifiedBatch | null = null;
      if (snapshots.length > 0) {
        const currentSnapshots = store.listGapSnapshots();
        // Only findings that were waiting on this measurement are re-planned; new findings wait for the next cycle's budget.
        const waiting = deps.findings.filter((finding) => ["GAP_NOT_MEASURED", "NO_LOCAL_GAP"].includes(index.findings[ayasResearchIndexKey(finding.findingId)]?.outcome ?? ""));
        extra = classifyFindingBatch(selectFindingQueue(waiting, index, registryDigest, currentSnapshots, head, budget.maxFindingsPerCycle, presentKeys), index, registry, registryDigest, currentSnapshots, head, clock(), presentKeys);
        index = refreshHypotheses(extra.index, registry, currentSnapshots, head, clock(), presentKeys);
      }
      let reservation: { readonly record: AyasExperimentRecord; readonly hypothesis: AyasImprovementHypothesis; readonly strategy: AyasImprovementStrategy; readonly benchmark: AyasImprovementBenchmark; readonly sourceIds: readonly string[] } | null = null;
      let code: string | null = null;
      const ready = Object.values(index.hypotheses)
        .filter((entry) => isAdmissionCandidate(entry, head, clock()))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.hypothesis.hypothesisId.localeCompare(b.hypothesis.hypothesisId));
      const records = store.listExperiments();
      const nowMs = Date.parse(clock());
      // Global limits first: when they refuse, no per-hypothesis work is done at all.
      if (ready.length === 0) code = null;
      else if (!heavyAllowed) code = "MACHINE_NOT_ALLOW";
      else if (remainingMs() < budget.minExperimentTimeBudgetMs) code = "TIME_BUDGET";
      else if (records.filter(isAyasExperimentActive).length >= budget.maxConcurrentExperiments) code = "CONCURRENCY_LIMIT";
      else if (!admissionMayProceed(index, heavyAllowed, clock())) code = "DAILY_LIMIT";
      else if (index.experimentStarts.filter((at) => nowMs - Date.parse(at) < 24 * 60 * 60_000).length >= budget.maxExperimentsPer24h) {
        code = "DAILY_LIMIT";
        // Deferred only until the oldest start leaves the window; with no start in the window there is nothing to anchor to.
        const oldest = index.experimentStarts.map((at) => Date.parse(at)).filter((at) => nowMs - at < 24 * 60 * 60_000).sort((a, b) => a - b)[0];
        if (oldest !== undefined) index = { ...index, admissionDeferredUntil: new Date(oldest + 24 * 60 * 60_000).toISOString() };
      }
      else {
        const hypotheses: Record<string, AyasResearchImprovementIndex["hypotheses"][string]> = { ...index.hypotheses };
        let settledChanged = false;
        for (const entry of ready) {
          const h = entry.hypothesis;
          const strategy = registry.strategies.find((item) => item.strategyId === h.strategyId && item.version === h.strategyVersion);
          const benchmark = findAyasImprovementBenchmark(registry, h.benchmarkId);
          if (!strategy || !benchmark || validateAyasImprovementStrategy(strategy).length > 0) {
            code = "STRATEGY_UNAVAILABLE";
            hypotheses[h.hypothesisId] = { ...entry, settledAdmission: { head, code } };
            settledChanged = true;
            continue;
          }
          // Never run a hypothesis frozen from an older strategy scope; its findings are re-planned first.
          if (JSON.stringify([h.exactFiles, h.regressionSuites, h.maxChangedLines]) !== JSON.stringify([strategy.exactFiles, strategy.regressionSuites, strategy.maxChangedLines])) { code = "HYPOTHESIS_OUTDATED"; continue; }
          const inputsDigest = await experimentInputsDigest(deps.repoRoot, head, benchmark, strategy);
          const attemptKey = sha256(JSON.stringify([h.hypothesisId, strategy.strategyId, strategy.version, inputsDigest]));
          const decision = decideAyasExperimentAdmission({ attemptKey, baseHead: head, records, rejectedAttemptKeys, experimentStarts: index.experimentStarts, startedThisCycle: 0, nowIso: clock(), budget });
          if (!decision.admit) {
            code = decision.code;
            if (SETTLED_ADMISSIONS.has(decision.code)) { hypotheses[h.hypothesisId] = { ...entry, settledAdmission: { head, code: decision.code } }; settledChanged = true; }
            else if (decision.retryAt) { hypotheses[h.hypothesisId] = { ...entry, deferredUntil: decision.retryAt }; settledChanged = true; }
            continue;
          }
          const nowIso = clock();
          const sourceIds = [...new Set(h.findingIds.flatMap((id) => index.findings[id]?.sourceIds ?? []))].sort();
          const record: AyasExperimentRecord = {
            schemaVersion: AYAS_RESEARCH_IMPROVEMENT_SCHEMA_VERSION,
            experimentId: `ayas-experiment-${crypto.randomUUID()}`,
            hypothesisId: h.hypothesisId, attemptKey, attempt: decision.attempt, baseHead: head,
            strategyId: strategy.strategyId, strategyVersion: strategy.version, inputsDigest,
            status: "RESERVED", reservedAt: nowIso, updatedAt: nowIso,
            owner: { pid: process.pid, processStartEpochMs: await readProcessStartEpochMs(process.pid).catch(() => Date.now() - Math.floor(process.uptime() * 1000)), runId: crypto.randomUUID() },
            leaseExpiresAt: new Date(Date.parse(nowIso) + budget.experimentLeaseMs).toISOString(),
            ...(deps.trace ? { traceId: deps.trace.traceId } : {}),
          };
          store.writeExperiment(record);
          index = { ...index, experimentStarts: [...index.experimentStarts, nowIso] };
          reservation = { record, hypothesis: h, strategy, benchmark, sourceIds };
          code = "ADMITTED";
          break;
        }
        if (settledChanged) index = { ...index, hypotheses };
      }
      if (index !== loaded) store.saveIndex(pruneIndex(index, budget, clock(), presentKeys));
      return { extra, reservation, code };
    });
    admission = phaseC.code;
    if (phaseC.extra) { replanned += phaseC.extra.classified; merge(outcomes, phaseC.extra.outcomes, "remeasured:"); merge(relevance, phaseC.extra.relevance, "remeasured:"); }

    // D — the single admitted experiment, outside the lock, protected by its durable reservation.
    if (phaseC.reservation) {
      const reserved = phaseC.reservation;
      const outcome = await runReservedExperiment({ deps, store, record: reserved.record, hypothesis: reserved.hypothesis, strategy: reserved.strategy, benchmark: reserved.benchmark, sourceIds: reserved.sourceIds, remainingMs, clock });
      experiment = { experimentId: reserved.record.experimentId, hypothesisId: reserved.hypothesis.hypothesisId, verdict: outcome.verdict, reasonCodes: outcome.reasonCodes };
    }
  }

  // E — evidence binding for existing proposals, then verified evidence for new ones (read-only unless a binding broke).
  const staleProposals = deps.inbox ? reconcileAyasResearchExperimentProposals(deps.inbox, store, clock()) : [];
  const proposalEvidence: { evidence: AyasExperimentEvidence; evidenceHash: string }[] = [];
  // Newest first, and never spend the bound on experiments the inbox already carries.
  const bridged = new Set(deps.inbox ? deps.inbox.load().proposals.map((proposal) => proposal.sourceReference).filter(Boolean) : []);
  for (const record of [...store.listExperiments()].reverse()) {
    if (record.status !== "COMPLETED" || record.verdict !== "IMPROVED" || record.baseHead !== head || !record.evidenceHash || bridged.has(record.experimentId) || rejectedAttemptKeys.has(record.attemptKey)) continue;
    const evidence = store.readEvidence(record.evidenceHash);
    if (evidence && evidence.experimentId === record.experimentId) proposalEvidence.push({ evidence, evidenceHash: record.evidenceHash });
    if (proposalEvidence.length >= 5) break;
  }
  const finalIndex = store.loadIndex();
  const pendingFindings = Object.values(finalIndex.findings).filter((entry) => entry.outcome === "GAP_NOT_MEASURED" || entry.outcome === "REPLAN_PENDING").length + deps.findings.filter((finding) => !finalIndex.findings[ayasResearchIndexKey(finding.findingId)]).length;
  cycleSpan?.end("ok", { findingCount: classified, experimentCount: experiment ? 1 : 0, hypothesisCount: Object.keys(finalIndex.hypotheses).length });
  return finish({ outcome: "COMPLETED", classified, replanned, relevance, outcomes, pendingFindings, gapSnapshotsMeasured: snapshots.length, reconciledInterrupted: reconciled, admission, experiment, staleProposals, proposalEvidence, designReviewGate: buildAyasResearchDesignReviewGate(finalIndex) });
}

/** Mutation kinds this loop can emit; exported for authority-boundary assertions. */
export const AYAS_RESEARCH_IMPROVEMENT_EMITTED_MUTATION_KINDS: readonly string[] = Object.freeze([AYAS_RESEARCH_EXPERIMENT_PROPOSAL_MUTATION_KIND]);
