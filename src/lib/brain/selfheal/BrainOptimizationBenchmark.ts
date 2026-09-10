/**
 * Atölye Brain — Self-Healing: self-optimization benchmark comparison (pure).
 *
 * Emir §12. An optimization candidate is only accepted when a sandbox benchmark
 * shows a real improvement AND no regression on the guarded metrics. An
 * *estimated* improvement is never reported as a result — only a measured
 * before/after pair.
 */

export interface BrainMetric {
  readonly name: string;
  readonly unit: string;
  readonly value: number;
  /** true ⇒ lower is better (latency, memory); false ⇒ higher is better (throughput). */
  readonly lowerIsBetter: boolean;
  /** Optional: the max acceptable regression (fraction, e.g. 0.05 = 5 %). Defaults per-metric. */
  readonly regressionTolerance?: number;
}

export interface BrainBenchmarkSample {
  /** Median of N runs — a single number is treated as its own median. */
  readonly metrics: readonly BrainMetric[];
  readonly runs: number;
  readonly capturedAt: string;
}

export interface BrainMetricDelta {
  readonly name: string;
  readonly unit: string;
  readonly before: number;
  readonly after: number;
  readonly deltaPct: number; // signed; positive = "better" after direction normalisation
  readonly improved: boolean;
  readonly regressed: boolean;
  readonly withinTolerance: boolean;
}

export interface BrainBenchmarkVerdict {
  readonly verdict: "ACCEPT" | "REJECT" | "NEUTRAL";
  readonly reason: string;
  readonly deltas: readonly BrainMetricDelta[];
  readonly improvements: readonly BrainMetricDelta[];
  readonly regressions: readonly BrainMetricDelta[];
  readonly headline: string | null;
}

const DEFAULT_TOLERANCE = 0.03; // 3 % — noise floor for a median-of-N benchmark
const MEANINGFUL_IMPROVEMENT = 0.05; // < 5 % better is NEUTRAL, not worth the risk

export function compareBenchmark(before: BrainBenchmarkSample, after: BrainBenchmarkSample): BrainBenchmarkVerdict {
  if (before.runs < 3 || after.runs < 3) {
    return {
      verdict: "REJECT",
      reason: `benchmark needs ≥ 3 runs per side (got ${before.runs} / ${after.runs}) — an under-sampled benchmark is not a result`,
      deltas: [],
      improvements: [],
      regressions: [],
      headline: null,
    };
  }

  const afterByName = new Map(after.metrics.map((m) => [m.name, m]));
  const deltas: BrainMetricDelta[] = [];

  for (const b of before.metrics) {
    const a = afterByName.get(b.name);
    if (!a) continue;
    const tol = b.regressionTolerance ?? DEFAULT_TOLERANCE;
    const rawPct = b.value === 0 ? 0 : (a.value - b.value) / Math.abs(b.value);
    // normalise so a positive deltaPct always means "better"
    const deltaPct = b.lowerIsBetter ? -rawPct : rawPct;
    const improved = deltaPct >= MEANINGFUL_IMPROVEMENT;
    const regressed = deltaPct <= -tol;
    deltas.push({
      name: b.name,
      unit: b.unit,
      before: round(b.value),
      after: round(a.value),
      deltaPct: round(deltaPct * 100) / 100,
      improved,
      regressed,
      withinTolerance: Math.abs(deltaPct) <= tol,
    });
  }

  const improvements = deltas.filter((d) => d.improved);
  const regressions = deltas.filter((d) => d.regressed);

  let verdict: BrainBenchmarkVerdict["verdict"];
  let reason: string;
  if (regressions.length > 0) {
    verdict = "REJECT";
    reason = `regression on ${regressions.map((d) => `${d.name} (${fmtPct(d.deltaPct)})`).join(", ")}`;
  } else if (improvements.length > 0) {
    verdict = "ACCEPT";
    reason = `improved ${improvements.map((d) => `${d.name} ${fmtPct(d.deltaPct)}`).join(", ")}, no regression on the guarded metrics`;
  } else {
    verdict = "NEUTRAL";
    reason = "no meaningful improvement (< 5 %) and no regression — not worth the change";
  }

  const headline =
    improvements.length > 0
      ? (() => {
          const top = [...improvements].sort((x, y) => y.deltaPct - x.deltaPct)[0];
          return `${top.name}: ${top.before} ${top.unit} → ${top.after} ${top.unit} (${fmtPct(top.deltaPct)})`;
        })()
      : null;

  return { verdict, reason, deltas, improvements, regressions, headline };
}

function round(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : 0;
}
function fmtPct(fraction: number): string {
  const pct = Math.round(fraction * 1000) / 10;
  return `${pct > 0 ? "+" : ""}${pct}%`;
}
