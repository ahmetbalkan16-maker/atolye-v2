/**
 * Atölye Brain — self-optimization loop with realistic telemetry (emir §15–§17).
 *
 * `compareBenchmark` + the `BrainOptimizationLoop` state machine on measured
 * before/after latency samples:
 *   - a real (≥ 5 %) improvement + no guarded regression → ACCEPT;
 *   - a sub-5 % change → NEUTRAL (rejected stage — not worth the risk);
 *   - a guarded-metric regression → REJECT;
 *   - a missing sample / a failed regression sweep → rejected (never a result).
 * An *estimated* gain is never accepted.
 */

import assert from "node:assert/strict";

import { compareBenchmark, type BrainBenchmarkSample } from "../src/lib/brain/selfheal/BrainOptimizationBenchmark";
import {
  advanceOptimizationRun,
  buildOptimizationRun,
  decideOptimization,
} from "../src/lib/brain/selfheal/BrainOptimizationLoop";

let count = 0;
async function scenario(name: string, fn: () => void | Promise<void>) {
  await fn();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

const NOW = "2026-09-12T17:00:00.000Z";

function sample(metrics: { name: string; unit: string; value: number; lowerIsBetter: boolean }[], runs = 5): BrainBenchmarkSample {
  return { metrics, runs, capturedAt: NOW };
}

// Realistic AYAS voice telemetry.
const BASELINE = sample([
  { name: "sttLatencyMs", unit: "ms", value: 1800, lowerIsBetter: true },
  { name: "wakeSuccessRate", unit: "%", value: 82, lowerIsBetter: false },
  { name: "firstWordLoss", unit: "count", value: 7, lowerIsBetter: true },
  { name: "totalTurnMs", unit: "ms", value: 4200, lowerIsBetter: true },
]);

async function run() {
  await scenario("a real STT-latency win with no regression → ACCEPT + headline", () => {
    const after = sample([
      { name: "sttLatencyMs", unit: "ms", value: 1250, lowerIsBetter: true },
      { name: "wakeSuccessRate", unit: "%", value: 82, lowerIsBetter: false },
      { name: "firstWordLoss", unit: "count", value: 7, lowerIsBetter: true },
      { name: "totalTurnMs", unit: "ms", value: 3650, lowerIsBetter: true },
    ]);
    const v = compareBenchmark(BASELINE, after);
    assert.equal(v.verdict, "ACCEPT");
    assert.match(v.headline ?? "", /sttLatencyMs: 1800 ms → 1250 ms/);
    assert.equal(v.regressions.length, 0);
  });

  await scenario("a sub-5 % change → NEUTRAL (not worth the risk)", () => {
    const after = sample([
      { name: "sttLatencyMs", unit: "ms", value: 1760, lowerIsBetter: true }, // ~2.2 %
      { name: "wakeSuccessRate", unit: "%", value: 83, lowerIsBetter: false },
      { name: "firstWordLoss", unit: "count", value: 7, lowerIsBetter: true },
      { name: "totalTurnMs", unit: "ms", value: 4160, lowerIsBetter: true },
    ]);
    assert.equal(compareBenchmark(BASELINE, after).verdict, "NEUTRAL");
  });

  await scenario("a win on one metric but a regression on a guarded one → REJECT", () => {
    const after = sample([
      { name: "sttLatencyMs", unit: "ms", value: 1200, lowerIsBetter: true }, // better
      { name: "wakeSuccessRate", unit: "%", value: 70, lowerIsBetter: false }, // WORSE
      { name: "firstWordLoss", unit: "count", value: 7, lowerIsBetter: true },
      { name: "totalTurnMs", unit: "ms", value: 4100, lowerIsBetter: true },
    ]);
    const v = compareBenchmark(BASELINE, after);
    assert.equal(v.verdict, "REJECT");
    assert.match(v.reason, /wakeSuccessRate/);
  });

  await scenario("an under-sampled benchmark is not a result → REJECT", () => {
    const v = compareBenchmark({ ...BASELINE, runs: 2 }, { ...BASELINE, runs: 2 });
    assert.equal(v.verdict, "REJECT");
    assert.match(v.reason, /≥ 3 runs/);
  });

  await scenario("loop — OBSERVE → BASELINE → HYPOTHESIS → BENCHMARK → REGRESSION → COMPARE → accepted", () => {
    let run = buildOptimizationRun({ id: "opt-live-1", metricName: "sttLatencyMs", hypothesis: "skip the beam-search fallback for high-confidence tokens", now: NOW });
    assert.equal(run.stage, "observe");
    run = advanceOptimizationRun(run, { kind: "baseline", sample: BASELINE, now: NOW });
    run = advanceOptimizationRun(run, { kind: "hypothesis-ready", changedFiles: ["scripts/smoke-x.ts"], now: NOW });
    run = advanceOptimizationRun(run, {
      kind: "candidate",
      sample: sample([
        { name: "sttLatencyMs", unit: "ms", value: 1240, lowerIsBetter: true },
        { name: "wakeSuccessRate", unit: "%", value: 82, lowerIsBetter: false },
        { name: "firstWordLoss", unit: "count", value: 7, lowerIsBetter: true },
        { name: "totalTurnMs", unit: "ms", value: 3600, lowerIsBetter: true },
      ]),
      now: NOW,
    });
    run = advanceOptimizationRun(run, { kind: "regression", pass: true, detail: "all suites green", now: NOW });
    run = decideOptimization(run);
    assert.equal(run.stage, "accepted");
    assert.match(run.disposition, /ACCEPTED/);
  });

  await scenario("loop — a failed regression sweep → rejected regardless of the benchmark", () => {
    let run = buildOptimizationRun({ id: "opt-live-2", metricName: "sttLatencyMs", hypothesis: "x", now: NOW });
    run = advanceOptimizationRun(run, { kind: "baseline", sample: BASELINE, now: NOW });
    run = advanceOptimizationRun(run, { kind: "hypothesis-ready", changedFiles: ["scripts/smoke-x.ts"], now: NOW });
    run = advanceOptimizationRun(run, {
      kind: "candidate",
      sample: sample([{ name: "sttLatencyMs", unit: "ms", value: 900, lowerIsBetter: true }]),
      now: NOW,
    });
    run = advanceOptimizationRun(run, { kind: "regression", pass: false, detail: "smoke-ayas-voice failed", now: NOW });
    run = decideOptimization(run);
    assert.equal(run.stage, "rejected");
    assert.match(run.disposition, /regressed the test suite/);
  });

  await scenario("loop — a FORBIDDEN-area change halts before benchmarking", () => {
    let run = buildOptimizationRun({ id: "opt-live-3", metricName: "x", hypothesis: "y", now: NOW });
    run = advanceOptimizationRun(run, { kind: "baseline", sample: BASELINE, now: NOW });
    run = advanceOptimizationRun(run, { kind: "hypothesis-ready", changedFiles: ["src/lib/ayas/execution/AyasExecutionGate.ts"], now: NOW });
    assert.equal(run.stage, "halted");
    assert.match(run.disposition, /FORBIDDEN/);
  });

  console.log(`Atölye Brain optimization-live smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "brain-optimization-live", scenarios: count }));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
