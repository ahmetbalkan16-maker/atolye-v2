import crypto from "node:crypto";

import { containsBrainSecret, redactBrainText } from "../BrainRedaction";
import { AYAS_RESEARCH_IMPROVEMENT_SCHEMA_VERSION, type AyasImprovementHypothesis } from "./AyasResearchImprovementLoop";

/**
 * Stage 8 — turns two benchmark runs (matched baseline, experimental change)
 * into a verdict and a bounded evidence package. A verdict is evidence, never
 * authority: nothing here approves, schedules or executes anything.
 *
 * An improvement claim requires a matched baseline: same evaluator digest,
 * same case set, and a baseline that reproduces the gap measured when the
 * hypothesis was formed. Success means the target improved AND no case that
 * passed at baseline fails afterwards — a net gain that hides one regression
 * is still a regression.
 */
export type AyasExperimentVerdict = "IMPROVED" | "NEUTRAL" | "REGRESSED" | "INVALID_EXPERIMENT" | "INCONCLUSIVE" | "UNSAFE";

export interface AyasBenchmarkFailingCase {
  readonly id: string;
  readonly dimension: string;
  readonly heldOut: boolean;
  readonly knownLimitation: boolean;
}

export interface AyasBenchmarkMeasurement {
  readonly benchmarkId: string;
  readonly evaluatorSha256: string;
  readonly caseCount: number;
  readonly passed: number;
  readonly heldOut: { readonly passed: number; readonly total: number };
  readonly dimensions: Readonly<Record<string, { readonly passed: number; readonly total: number }>>;
  readonly failing: readonly AyasBenchmarkFailingCase[];
  readonly durationMs: number;
}

export type AyasBenchmarkFailureCode = "BENCHMARK_TIMEOUT" | "BENCHMARK_CRASHED" | "REPORT_INVALID" | "BENCHMARK_MISSING";
export type AyasBenchmarkRunOutcome =
  | { readonly ok: true; readonly measurement: AyasBenchmarkMeasurement }
  | { readonly ok: false; readonly code: AyasBenchmarkFailureCode; readonly durationMs: number };

export interface AyasRegressionSuiteResult {
  readonly script: string;
  readonly pass: boolean;
  readonly timedOut: boolean;
  readonly durationMs: number;
}

const HEX64 = /^[0-9a-f]{64}$/;
const CASE_ID = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,95}$/;
const DIMENSION = /^[A-Z][A-Z0-9_]{1,63}$/;
const isCount = (value: unknown, max: number): value is number => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= max;

/** Accepts only the standard advisory report shape; anything else is `undefined` (fail closed, never coerced). */
export function parseAyasBenchmarkReport(benchmarkId: string, raw: unknown, durationMs: number): AyasBenchmarkMeasurement | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const report = raw as Record<string, unknown>;
  if (report.schemaVersion !== 1 || typeof report.evaluatorSha256 !== "string" || !HEX64.test(report.evaluatorSha256)) return undefined;
  if (!isCount(report.caseCount, 10_000) || report.caseCount === 0 || !isCount(report.passed, report.caseCount)) return undefined;
  const heldOut = report.heldOut as Record<string, unknown> | undefined;
  if (!heldOut || !isCount(heldOut.total, report.caseCount) || !isCount(heldOut.passed, heldOut.total as number)) return undefined;
  const rawDimensions = report.dimensions;
  if (!rawDimensions || typeof rawDimensions !== "object" || Array.isArray(rawDimensions)) return undefined;
  const dimensionEntries = Object.entries(rawDimensions as Record<string, unknown>);
  if (dimensionEntries.length === 0 || dimensionEntries.length > 64) return undefined;
  const dimensions: Record<string, { passed: number; total: number }> = {};
  for (const [name, value] of dimensionEntries) {
    const row = value as Record<string, unknown> | null;
    if (!DIMENSION.test(name) || !row || !isCount(row.total, report.caseCount) || !isCount(row.passed, row.total as number)) return undefined;
    dimensions[name] = { passed: row.passed as number, total: row.total as number };
  }
  if (!Array.isArray(report.failures) || report.failures.length !== report.caseCount - report.passed) return undefined;
  const failing: AyasBenchmarkFailingCase[] = [];
  for (const item of report.failures as unknown[]) {
    const row = item as Record<string, unknown> | null;
    if (!row || typeof row.id !== "string" || !CASE_ID.test(row.id) || typeof row.dimension !== "string" || !(row.dimension in dimensions)) return undefined;
    failing.push({ id: row.id, dimension: row.dimension, heldOut: row.heldOut === true, knownLimitation: row.knownLimitation === true });
  }
  if (new Set(failing.map((row) => row.id)).size !== failing.length) return undefined;
  return {
    benchmarkId,
    evaluatorSha256: report.evaluatorSha256,
    caseCount: report.caseCount,
    passed: report.passed,
    heldOut: { passed: heldOut.passed as number, total: heldOut.total as number },
    dimensions,
    failing,
    durationMs: Math.max(0, Math.round(durationMs)),
  };
}

export const AYAS_EXPERIMENT_PERFORMANCE_MAX_RATIO = 3;
export const AYAS_EXPERIMENT_PERFORMANCE_MIN_DELTA_MS = 10_000;

export type AyasExperimentAbortCode =
  | "SCOPE_VIOLATION" | "SANDBOX_ESCAPE" | "SANDBOX_CLEANUP_FAILED" | "EVIDENCE_SECRET"
  | "NO_CHANGE_GENERATED" | "BASE_HEAD_MOVED" | "LIVE_WORKSPACE_CHANGED" | "BENCHMARK_NOT_HERMETIC"
  | "TIME_BUDGET_EXHAUSTED" | "SANDBOX_FAILED";

const UNSAFE_ABORTS = new Set<AyasExperimentAbortCode>(["SCOPE_VIOLATION", "SANDBOX_ESCAPE", "SANDBOX_CLEANUP_FAILED", "EVIDENCE_SECRET"]);
const INVALID_ABORTS = new Set<AyasExperimentAbortCode>(["NO_CHANGE_GENERATED", "BASE_HEAD_MOVED", "LIVE_WORKSPACE_CHANGED", "BENCHMARK_NOT_HERMETIC"]);

export interface AyasExperimentEvaluationInput {
  readonly hypothesis: AyasImprovementHypothesis;
  readonly baseline: AyasBenchmarkRunOutcome | null;
  readonly experiment: AyasBenchmarkRunOutcome | null;
  readonly baselineSuites: readonly AyasRegressionSuiteResult[];
  readonly experimentSuites: readonly AyasRegressionSuiteResult[];
  readonly abortCode?: AyasExperimentAbortCode;
}

export interface AyasExperimentComparison {
  readonly verdict: AyasExperimentVerdict;
  readonly reasonCodes: readonly string[];
  readonly targetGain: number;
  readonly fixedCaseIds: readonly string[];
  readonly newlyFailingCaseIds: readonly string[];
  readonly heldOutDelta: number;
  readonly remainingTargetFailures: number;
  readonly performanceRatio: number | null;
}

const EMPTY_COMPARISON = { targetGain: 0, fixedCaseIds: [], newlyFailingCaseIds: [], heldOutDelta: 0, remainingTargetFailures: 0, performanceRatio: null } as const;

/** Same evaluator digest and exactly the same failing target cases as the gap measurement the hypothesis came from. */
export function ayasBaselineReproducesHypothesis(hypothesis: AyasImprovementHypothesis, baseline: AyasBenchmarkMeasurement): boolean {
  const failingTargets = baseline.failing.filter((row) => row.dimension === hypothesis.targetDimension && !row.heldOut).map((row) => row.id).sort();
  return baseline.evaluatorSha256 === hypothesis.gapEvidence.evaluatorSha256 && JSON.stringify(failingTargets) === JSON.stringify([...hypothesis.targetCaseIds].sort());
}

/** Phases 9, 11, 12 and 13 — ordered, deterministic, fail-closed. */
export function evaluateAyasExperiment(input: AyasExperimentEvaluationInput): AyasExperimentComparison {
  const { hypothesis } = input;
  if (input.abortCode && UNSAFE_ABORTS.has(input.abortCode)) return { verdict: "UNSAFE", reasonCodes: [input.abortCode], ...EMPTY_COMPARISON };
  if (input.abortCode && INVALID_ABORTS.has(input.abortCode)) return { verdict: "INVALID_EXPERIMENT", reasonCodes: [input.abortCode], ...EMPTY_COMPARISON };
  if (input.abortCode) return { verdict: "INCONCLUSIVE", reasonCodes: [input.abortCode], ...EMPTY_COMPARISON };
  if (!input.baseline) return { verdict: "INVALID_EXPERIMENT", reasonCodes: ["BASELINE_MISSING"], ...EMPTY_COMPARISON };
  if (!input.baseline.ok) return { verdict: "INCONCLUSIVE", reasonCodes: [`BASELINE_${input.baseline.code}`], ...EMPTY_COMPARISON };
  const base = input.baseline.measurement;
  if (base.benchmarkId !== hypothesis.benchmarkId) return { verdict: "INVALID_EXPERIMENT", reasonCodes: ["BENCHMARK_MISMATCH"], ...EMPTY_COMPARISON };
  // The matched baseline must reproduce the gap the hypothesis was built on.
  if (!ayasBaselineReproducesHypothesis(hypothesis, base)) return { verdict: "INVALID_EXPERIMENT", reasonCodes: ["BASELINE_NOT_REPRODUCED"], ...EMPTY_COMPARISON };
  if (!input.experiment) return { verdict: "INVALID_EXPERIMENT", reasonCodes: ["EXPERIMENT_NOT_RUN"], ...EMPTY_COMPARISON };
  if (!input.experiment.ok) return { verdict: "INCONCLUSIVE", reasonCodes: [`EXPERIMENT_${input.experiment.code}`], ...EMPTY_COMPARISON };

  const exp = input.experiment.measurement;
  if (exp.benchmarkId !== hypothesis.benchmarkId) return { verdict: "INVALID_EXPERIMENT", reasonCodes: ["BENCHMARK_MISMATCH"], ...EMPTY_COMPARISON };
  // Benchmark gaming defense: the yardstick itself must not move.
  const sameDimensions = JSON.stringify(Object.entries(base.dimensions).map(([name, row]) => [name, row.total]).sort()) === JSON.stringify(Object.entries(exp.dimensions).map(([name, row]) => [name, row.total]).sort());
  if (base.evaluatorSha256 !== exp.evaluatorSha256 || base.caseCount !== exp.caseCount || base.heldOut.total !== exp.heldOut.total || !sameDimensions) {
    return { verdict: "INVALID_EXPERIMENT", reasonCodes: ["BENCHMARK_CHANGED"], ...EMPTY_COMPARISON };
  }
  const baseTargetFailing = base.failing.filter((row) => row.dimension === hypothesis.targetDimension && !row.heldOut).map((row) => row.id).sort();

  const baseFailing = new Set(base.failing.map((row) => row.id));
  const expFailing = new Set(exp.failing.map((row) => row.id));
  const newlyFailing = exp.failing.filter((row) => !baseFailing.has(row.id));
  const fixed = base.failing.filter((row) => !expFailing.has(row.id));
  const targetFixed = fixed.filter((row) => row.dimension === hypothesis.targetDimension && !row.heldOut);
  const heldOutDelta = exp.heldOut.passed - base.heldOut.passed;
  const performanceRatio = base.durationMs > 0 ? Math.round((exp.durationMs / base.durationMs) * 100) / 100 : null;
  const shared = {
    targetGain: targetFixed.length,
    fixedCaseIds: fixed.map((row) => row.id).sort(),
    newlyFailingCaseIds: newlyFailing.map((row) => row.id).sort(),
    heldOutDelta,
    remainingTargetFailures: baseTargetFailing.length - targetFixed.length,
    performanceRatio,
  };

  const reasons: string[] = [];
  if (newlyFailing.some((row) => row.heldOut) || heldOutDelta < 0) reasons.push("HELD_OUT_REGRESSION");
  if (newlyFailing.some((row) => !row.heldOut)) reasons.push("CASE_REGRESSION");
  const suitesByScript = new Map(input.baselineSuites.map((suite) => [suite.script, suite]));
  for (const suite of hypothesis.regressionSuites) {
    const before = suitesByScript.get(suite);
    const after = input.experimentSuites.find((item) => item.script === suite);
    if (!before || !after) return { verdict: "INCONCLUSIVE", reasonCodes: ["REGRESSION_SUITE_NOT_RUN"], ...shared };
    if (!before.pass) return { verdict: "INCONCLUSIVE", reasonCodes: [before.timedOut ? "REGRESSION_SUITE_TIMEOUT" : "REGRESSION_SUITE_BASELINE_FAILING"], ...shared };
    if (!after.pass) reasons.push(after.timedOut ? "REGRESSION_SUITE_TIMEOUT" : "REGRESSION_SUITE_FAILED");
  }
  if (base.durationMs > 0 && exp.durationMs > base.durationMs * AYAS_EXPERIMENT_PERFORMANCE_MAX_RATIO && exp.durationMs - base.durationMs > AYAS_EXPERIMENT_PERFORMANCE_MIN_DELTA_MS) reasons.push("PERFORMANCE_REGRESSION");
  if (reasons.length > 0) return { verdict: "REGRESSED", reasonCodes: [...new Set(reasons)], ...shared };
  if (targetFixed.length >= hypothesis.expectedImprovement.minDelta) {
    return { verdict: "IMPROVED", reasonCodes: [shared.remainingTargetFailures > 0 ? "PARTIAL_TARGET_IMPROVEMENT" : "TARGET_IMPROVED"], ...shared };
  }
  return { verdict: "NEUTRAL", reasonCodes: [fixed.length > 0 ? "OFF_TARGET_CHANGE_ONLY" : "NO_MEASURED_CHANGE"], ...shared };
}

export interface AyasEvidenceMeasurement {
  readonly benchmarkId: string;
  readonly evaluatorSha256: string;
  readonly caseCount: number;
  readonly passed: number;
  readonly heldOut: { readonly passed: number; readonly total: number };
  readonly dimensions: Readonly<Record<string, { readonly passed: number; readonly total: number }>>;
  readonly failingCaseIds: readonly string[];
  readonly durationMs: number;
}

export interface AyasExperimentChangeSummary {
  readonly strategyId: string;
  readonly strategyVersion: number;
  readonly files: readonly { readonly filePath: string; readonly addedLines: number; readonly removedLines: number }[];
  readonly diffSha256: string;
  /** Redacted and bounded; the reviewable change, never external text. */
  readonly diffExcerpt: string;
}

export interface AyasExperimentAnalysisRoute {
  readonly agent: string;
  readonly tool: string | null;
  readonly skill: string | null;
  readonly model: string | null;
  readonly blocked: boolean;
  readonly reasonCodes: readonly string[];
  /** The sandbox runner is always the executor; a recommendation never dispatches anything. */
  readonly executor: "ayas-sandbox-runner";
  readonly authority: "NONE";
}

export interface AyasExperimentEvidence {
  readonly schemaVersion: typeof AYAS_RESEARCH_IMPROVEMENT_SCHEMA_VERSION;
  readonly experimentId: string;
  readonly attemptKey: string;
  readonly baseHead: string;
  readonly findingIds: readonly string[];
  readonly sourceIds: readonly string[];
  readonly hypothesis: AyasImprovementHypothesis;
  readonly baseline: AyasEvidenceMeasurement | { readonly error: string } | null;
  readonly experiment: AyasEvidenceMeasurement | { readonly error: string } | null;
  readonly environment: { readonly node: string; readonly platform: string; readonly arch: string; readonly tsx: string | null; readonly typescript: string | null };
  readonly change: AyasExperimentChangeSummary | null;
  readonly regressions: {
    readonly newlyFailingCaseIds: readonly string[];
    readonly heldOutDelta: number;
    readonly suites: readonly { readonly script: string; readonly baselinePass: boolean | null; readonly experimentPass: boolean | null }[];
  };
  readonly performance: { readonly baselineMs: number | null; readonly experimentMs: number | null; readonly ratio: number | null };
  readonly risk: { readonly riskClass: AyasImprovementHypothesis["riskClass"]; readonly isolation: typeof AYAS_EXPERIMENT_ISOLATION; readonly liveWorkspaceUnchanged: boolean; readonly sandboxDiscarded: boolean };
  readonly analysisRoute: AyasExperimentAnalysisRoute | null;
  readonly verdict: AyasExperimentVerdict;
  readonly reasonCodes: readonly string[];
  readonly targetGain: number;
  readonly fixedCaseIds: readonly string[];
  readonly remainingTargetFailures: number;
  readonly completedAt: string;
  readonly authority: "NONE";
}

export const AYAS_EXPERIMENT_DIFF_EXCERPT_MAX = 16_000;
export const AYAS_EXPERIMENT_ISOLATION = "shared-clone-temp; origin removed; provider credentials stripped; mock AI provider; TEMP runtime/authority/workspace roots" as const;

/**
 * Deliberately UNREGISTERED in `AyasMutationRegistry`: a research experiment
 * proposal can be reviewed and even approved by the owner as a design
 * decision, but it has no execution path. Implementing it needs a separate,
 * reviewed change.
 */
export const AYAS_RESEARCH_EXPERIMENT_PROPOSAL_MUTATION_KIND = "research-experiment-proposal:v1";

export function toAyasEvidenceMeasurement(outcome: AyasBenchmarkRunOutcome | null): AyasEvidenceMeasurement | { readonly error: string } | null {
  if (!outcome) return null;
  if (!outcome.ok) return { error: outcome.code };
  const m = outcome.measurement;
  return { benchmarkId: m.benchmarkId, evaluatorSha256: m.evaluatorSha256, caseCount: m.caseCount, passed: m.passed, heldOut: m.heldOut, dimensions: m.dimensions, failingCaseIds: m.failing.map((row) => row.id).sort(), durationMs: m.durationMs };
}

/** Redacts and bounds a sandbox diff; reports whether anything secret-like had to be removed. */
export function boundAyasExperimentDiff(diff: string): { readonly excerpt: string; readonly sha256: string; readonly containedSecret: boolean } {
  const text = String(diff ?? "");
  return {
    excerpt: redactBrainText(text).text.slice(0, AYAS_EXPERIMENT_DIFF_EXCERPT_MAX),
    sha256: crypto.createHash("sha256").update(text, "utf8").digest("hex"),
    containedSecret: containsBrainSecret(text),
  };
}

/** Content hash of a canonical evidence object; key order is fixed by construction and preserved by JSON round-trips. */
export function hashAyasExperimentEvidence(evidence: AyasExperimentEvidence): string {
  return crypto.createHash("sha256").update(JSON.stringify(evidence), "utf8").digest("hex");
}

/**
 * True when any string value (not the JSON encoding) looks secret. Checking
 * the stringified package would misread escaped newlines — a diff line ending
 * in `default:` becomes `t:\n…`, which looks like an absolute path.
 */
export function ayasEvidenceContainsSecret(value: unknown, depth = 0): boolean {
  if (typeof value === "string") return containsBrainSecret(value);
  if (!value || typeof value !== "object") return false;
  if (depth > 12) return true; // fail closed: real packages are a few levels deep
  if (Array.isArray(value)) return value.some((item) => ayasEvidenceContainsSecret(item, depth + 1));
  return Object.entries(value).some(([key, item]) => containsBrainSecret(key) || ayasEvidenceContainsSecret(item, depth + 1));
}

/** Structural and privacy verification of a stored package against its bound hash. */
export function verifyAyasExperimentEvidence(evidence: unknown, expectedHash: string): evidence is AyasExperimentEvidence {
  if (!evidence || typeof evidence !== "object" || !HEX64.test(String(expectedHash ?? ""))) return false;
  const candidate = evidence as AyasExperimentEvidence;
  if (candidate.schemaVersion !== AYAS_RESEARCH_IMPROVEMENT_SCHEMA_VERSION || candidate.authority !== "NONE" || typeof candidate.experimentId !== "string" || !candidate.hypothesis) return false;
  if (ayasEvidenceContainsSecret(candidate)) return false;
  return hashAyasExperimentEvidence(candidate) === expectedHash;
}
