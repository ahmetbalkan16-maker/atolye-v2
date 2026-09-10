/**
 * Atölye Brain — post-apply watchdog smoke (emir §13 / §14 / §16 / §24).
 *
 * `runHealWatchdog`: "build PASS" is not "healed". Focused scenarios over the
 * observation window — HEALED only when the signature did not recur, no error
 * spike, no post-apply regression, no guarded perf regression; otherwise
 * HEAL_FAILED → rollback; OBSERVING while the window is still open.
 */

import assert from "node:assert/strict";

import { buildRuntimeEvent } from "../src/lib/brain/selfheal/BrainRuntimeEvent";
import {
  DEFAULT_HEAL_WATCHDOG_CONFIG,
  runHealWatchdog,
} from "../src/lib/brain/selfheal/BrainHealWatchdog";

let count = 0;
async function scenario(name: string, fn: () => void | Promise<void>) {
  await fn();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

const NOW = "2026-09-12T16:00:00.000Z";
const errEvt = () => buildRuntimeEvent({ at: NOW, component: "voice", event: "wake-stall", severity: "error" });
const okEvt = () => buildRuntimeEvent({ at: NOW, component: "voice", event: "wake-hit", severity: "info" });

async function run() {
  await scenario("window complete, all clean → HEALED, no rollback", () => {
    const r = runHealWatchdog({
      config: DEFAULT_HEAL_WATCHDOG_CONFIG,
      elapsedMs: 600_000,
      eventsSinceApply: [okEvt(), okEvt()],
      signatureRecurrences: 0,
      postApplyChecks: [{ name: "smoke", status: "PASS" }],
    });
    assert.equal(r.verdict, "HEALED");
    assert.equal(r.rollback, false);
    assert.ok(r.evidence.some((e) => /did not recur/i.test(e)));
  });

  await scenario("signature recurred → HEAL_FAILED + rollback, immediately (no waiting the window)", () => {
    const r = runHealWatchdog({
      config: DEFAULT_HEAL_WATCHDOG_CONFIG,
      elapsedMs: 30_000,
      eventsSinceApply: [],
      signatureRecurrences: 1,
    });
    assert.equal(r.verdict, "HEAL_FAILED");
    assert.equal(r.rollback, true);
    assert.match(r.reason, /recurred/i);
  });

  await scenario("error spike above maxNewErrors → HEAL_FAILED + rollback", () => {
    const r = runHealWatchdog({
      config: DEFAULT_HEAL_WATCHDOG_CONFIG,
      elapsedMs: 120_000,
      eventsSinceApply: [errEvt(), errEvt(), errEvt(), errEvt()],
      signatureRecurrences: 0,
    });
    assert.equal(r.verdict, "HEAL_FAILED");
    assert.equal(r.rollback, true);
    assert.match(r.reason, /error/i);
  });

  await scenario("a post-apply regression on the live tree → HEAL_FAILED + rollback", () => {
    const r = runHealWatchdog({
      config: DEFAULT_HEAL_WATCHDOG_CONFIG,
      elapsedMs: 600_000,
      eventsSinceApply: [],
      signatureRecurrences: 0,
      postApplyChecks: [
        { name: "smoke-brain-core-ui", status: "PASS" },
        { name: "smoke-ayas-voice", status: "FAIL" },
      ],
    });
    assert.equal(r.verdict, "HEAL_FAILED");
    assert.equal(r.rollback, true);
    assert.match(r.reason, /smoke-ayas-voice/);
  });

  await scenario("a guarded perf metric regressed → HEAL_FAILED + rollback", () => {
    const r = runHealWatchdog({
      config: DEFAULT_HEAL_WATCHDOG_CONFIG,
      elapsedMs: 600_000,
      eventsSinceApply: [],
      signatureRecurrences: 0,
      benchmark: {
        verdict: "REJECT",
        reason: "regression on sttLatency (-12%)",
        deltas: [],
        improvements: [],
        regressions: [{ name: "sttLatency", unit: "ms", before: 1200, after: 1344, deltaPct: -0.12, improved: false, regressed: true, withinTolerance: false }],
        headline: null,
      },
    });
    assert.equal(r.verdict, "HEAL_FAILED");
    assert.equal(r.rollback, true);
    assert.match(r.reason, /performance metric regressed/i);
  });

  await scenario("window not complete, clean so far → OBSERVING (no verdict yet)", () => {
    const r = runHealWatchdog({
      config: DEFAULT_HEAL_WATCHDOG_CONFIG,
      elapsedMs: 45_000,
      eventsSinceApply: [okEvt()],
      signatureRecurrences: 0,
    });
    assert.equal(r.verdict, "OBSERVING");
    assert.equal(r.rollback, false);
    assert.ok(r.checkpoint >= 1);
  });

  await scenario("a benchmark that improved → HEALED with a 'performance improved' note", () => {
    const r = runHealWatchdog({
      config: DEFAULT_HEAL_WATCHDOG_CONFIG,
      elapsedMs: 600_000,
      eventsSinceApply: [],
      signatureRecurrences: 0,
      benchmark: {
        verdict: "ACCEPT",
        reason: "improved sttLatency +30%",
        deltas: [],
        improvements: [{ name: "sttLatency", unit: "ms", before: 1800, after: 1250, deltaPct: 0.31, improved: true, regressed: false, withinTolerance: false }],
        regressions: [],
        headline: "sttLatency: 1800 ms → 1250 ms (+30.6%)",
      },
    });
    assert.equal(r.verdict, "HEALED");
    assert.ok(r.evidence.some((e) => /performance improved/i.test(e)));
  });

  console.log(`Atölye Brain watchdog smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "brain-watchdog", scenarios: count }));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
