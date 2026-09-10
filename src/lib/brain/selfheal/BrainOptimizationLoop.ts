/**
 * Atölye Brain — Autonomous v2: the self-optimization loop (pure state machine).
 *
 * Emir §15 / §16 / §17. Distinct from self-healing: there is no fault. The Brain
 * picks a metric that could be better, forms a hypothesis, changes it in a
 * sandbox, benchmarks before/after, checks for a regression, and ACCEPTS only a
 * MEASURED improvement with no guarded-metric regression. An *estimated* gain is
 * never a result.
 *
 *   OBSERVE → BASELINE → HYPOTHESIS → SANDBOX CHANGE → BENCHMARK → REGRESSION →
 *   COMPARE → ACCEPT / REJECT → LEARN
 */

import { compareBenchmark, type BrainBenchmarkSample, type BrainBenchmarkVerdict } from "./BrainOptimizationBenchmark";
import { classifyPatchSet } from "./BrainPatchSafety";
import { sanitizeUntrustedNote } from "./BrainUntrustedInput";

export type BrainOptimizationStage =
  | "observe"
  | "baseline"
  | "hypothesis"
  | "sandbox-change"
  | "benchmark"
  | "regression"
  | "compare"
  | "accepted"
  | "rejected"
  | "halted";

export interface BrainOptimizationRun {
  readonly id: string;
  readonly stage: BrainOptimizationStage;
  readonly metricName: string;
  readonly hypothesis: string;
  readonly changedFiles: readonly string[];
  readonly baseline: BrainBenchmarkSample | null;
  readonly candidate: BrainBenchmarkSample | null;
  readonly regressionPass: boolean | null;
  readonly verdict: BrainBenchmarkVerdict | null;
  readonly disposition: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface BrainOptimizationRunInput {
  readonly id: string;
  readonly metricName: string;
  readonly hypothesis: string;
  readonly now: string;
}

export function buildOptimizationRun(input: BrainOptimizationRunInput): BrainOptimizationRun {
  return {
    id: input.id,
    stage: "observe",
    metricName: sanitizeUntrustedNote(input.metricName, 60) || "unspecified",
    hypothesis: sanitizeUntrustedNote(input.hypothesis, 300) || "unspecified",
    changedFiles: [],
    baseline: null,
    candidate: null,
    regressionPass: null,
    verdict: null,
    disposition: "Observing — a metric that could be better was noted.",
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export type BrainOptimizationEvent =
  | { readonly kind: "baseline"; readonly sample: BrainBenchmarkSample; readonly now: string }
  | { readonly kind: "hypothesis-ready"; readonly changedFiles: readonly string[]; readonly now: string }
  | { readonly kind: "candidate"; readonly sample: BrainBenchmarkSample; readonly now: string }
  | { readonly kind: "regression"; readonly pass: boolean; readonly detail: string; readonly now: string }
  | { readonly kind: "halt"; readonly reason: string; readonly now: string };

const ORDER: readonly BrainOptimizationStage[] = ["observe", "baseline", "hypothesis", "sandbox-change", "benchmark", "regression", "compare"];

export function advanceOptimizationRun(run: BrainOptimizationRun, event: BrainOptimizationEvent): BrainOptimizationRun {
  const base = { ...run, updatedAt: event.now };
  switch (event.kind) {
    case "halt":
      return { ...base, stage: "halted", disposition: `Halted: ${sanitizeUntrustedNote(event.reason, 200)}` };
    case "baseline":
      return { ...base, stage: "hypothesis", baseline: event.sample, disposition: `Baseline captured (${event.sample.runs} runs).` };
    case "hypothesis-ready": {
      const verdict = classifyPatchSet(event.changedFiles);
      if (verdict.forbidden.length > 0) {
        return { ...base, stage: "halted", disposition: `Halted — the change would touch a FORBIDDEN area: ${verdict.forbidden.map((f) => f.path).join(", ")}` };
      }
      return { ...base, stage: "benchmark", changedFiles: event.changedFiles, disposition: "Sandbox change applied — benchmarking." };
    }
    case "candidate":
      return { ...base, stage: "regression", candidate: event.sample, disposition: `Candidate benchmarked (${event.sample.runs} runs) — running the regression sweep.` };
    case "regression":
      return {
        ...base,
        stage: "compare",
        regressionPass: event.pass,
        disposition: event.pass ? "Regression green — comparing." : `Regression FAILED: ${sanitizeUntrustedNote(event.detail, 200)}`,
      };
  }
}

/** The final decision once baseline + candidate + regression are all in. */
export function decideOptimization(run: BrainOptimizationRun): BrainOptimizationRun {
  if (run.stage !== "compare") return run;
  if (!run.baseline || !run.candidate) {
    return { ...run, stage: "rejected", disposition: "Rejected — missing a benchmark sample; not a result." };
  }
  if (run.regressionPass === false) {
    return { ...run, stage: "rejected", disposition: "Rejected — the change regressed the test suite." };
  }
  const verdict = compareBenchmark(run.baseline, run.candidate);
  if (verdict.verdict === "ACCEPT") {
    return { ...run, stage: "accepted", verdict, disposition: `ACCEPTED — ${verdict.headline ?? verdict.reason}` };
  }
  if (verdict.verdict === "REJECT") {
    return { ...run, stage: "rejected", verdict, disposition: `REJECTED — ${verdict.reason}` };
  }
  return { ...run, stage: "rejected", verdict, disposition: `NEUTRAL — ${verdict.reason} (not worth the change)` };
}

export function optimizationProgress(run: BrainOptimizationRun): { readonly done: number; readonly total: number } {
  const idx = ORDER.indexOf(run.stage);
  return { done: idx < 0 ? ORDER.length : idx, total: ORDER.length };
}
