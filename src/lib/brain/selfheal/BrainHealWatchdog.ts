/**
 * Atölye Brain — Autonomous v2: post-apply watchdog (pure, deterministic).
 *
 * Emir §13 / §14 / §40. "build PASS" does NOT mean healed. After a patch is
 * applied the Brain observes the live runtime over a window and only then
 * decides:
 *
 *   HEALED       the incident signature did NOT recur, no new error spike, no
 *                regression check failed post-apply, performance not worse;
 *   HEAL_FAILED  the signature recurred, OR a fresh error spike, OR a post-apply
 *                regression, OR a guarded perf metric regressed → AUTO_ROLLBACK;
 *   OBSERVING    not enough of the window has elapsed yet — keep watching.
 *
 * Deterministic — the caller supplies the window contents + elapsed time.
 */

import type { BrainRuntimeEvent } from "./BrainRuntimeEvent";
import type { BrainBenchmarkVerdict } from "./BrainOptimizationBenchmark";

export interface BrainHealWatchdogConfig {
  /** Observation checkpoints (ms since apply). The last one is "window complete". */
  readonly checkpointsMs: readonly number[];
  /** A post-apply error-event count above this in the window ⇒ HEAL_FAILED. */
  readonly maxNewErrors: number;
  /** Recurrences of the incident's own signature allowed before HEAL_FAILED. */
  readonly maxSignatureRecurrences: number;
}

export const DEFAULT_HEAL_WATCHDOG_CONFIG: BrainHealWatchdogConfig = Object.freeze({
  checkpointsMs: [30_000, 120_000, 600_000],
  maxNewErrors: 3,
  maxSignatureRecurrences: 0,
});

export interface BrainHealWatchdogInput {
  readonly config: BrainHealWatchdogConfig;
  /** ms since the patch was applied. */
  readonly elapsedMs: number;
  /** Runtime events observed since the apply. */
  readonly eventsSinceApply: readonly BrainRuntimeEvent[];
  /** How many of those events match this incident's signature (a recurrence). */
  readonly signatureRecurrences: number;
  /** Post-apply regression / smoke checks re-run against the live tree (optional). */
  readonly postApplyChecks?: readonly { readonly name: string; readonly status: "PASS" | "FAIL" }[];
  /** Optional benchmark: baseline (pre-fix) vs current (post-apply). */
  readonly benchmark?: BrainBenchmarkVerdict | null;
}

export interface BrainHealWatchdogResult {
  readonly verdict: "HEALED" | "HEAL_FAILED" | "OBSERVING";
  readonly reason: string;
  readonly evidence: readonly string[];
  /** Set when HEAL_FAILED — the caller triggers an auto-rollback. */
  readonly rollback: boolean;
  readonly checkpoint: number;
}

export function runHealWatchdog(input: BrainHealWatchdogInput): BrainHealWatchdogResult {
  const { config } = input;
  const evidence: string[] = [];
  const errorEvents = input.eventsSinceApply.filter((e) => e.severity === "error" || e.severity === "fatal");
  const windowComplete = input.elapsedMs >= (config.checkpointsMs[config.checkpointsMs.length - 1] ?? 0);
  const checkpoint = config.checkpointsMs.filter((c) => input.elapsedMs >= c).length;

  // ---- immediate failure signals (do not wait for the full window) ----
  if (input.signatureRecurrences > config.maxSignatureRecurrences) {
    return fail(
      `the incident signature recurred ${input.signatureRecurrences}× after the patch`,
      [`recurrences: ${input.signatureRecurrences} (max ${config.maxSignatureRecurrences})`],
      checkpoint,
    );
  }
  const postFail = (input.postApplyChecks ?? []).filter((c) => c.status === "FAIL");
  if (postFail.length > 0) {
    return fail(`post-apply check(s) failing on the live tree: ${postFail.map((c) => c.name).join(", ")}`, postFail.map((c) => `${c.name}: FAIL`), checkpoint);
  }
  if (errorEvents.length > config.maxNewErrors) {
    return fail(
      `${errorEvents.length} error/fatal events since the apply (max ${config.maxNewErrors})`,
      errorEvents.slice(0, 5).map((e) => `${e.component}:${e.event}`),
      checkpoint,
    );
  }
  if (input.benchmark && input.benchmark.verdict === "REJECT") {
    return fail(`a guarded performance metric regressed after the patch: ${input.benchmark.reason}`, input.benchmark.regressions.map((r) => r.name), checkpoint);
  }

  // ---- still observing ----
  if (!windowComplete) {
    evidence.push(`checkpoint ${checkpoint}/${config.checkpointsMs.length} — clean so far`);
    evidence.push(`errors since apply: ${errorEvents.length}, signature recurrences: ${input.signatureRecurrences}`);
    return { verdict: "OBSERVING", reason: `watching (${Math.round(input.elapsedMs / 1000)} s of the window elapsed)`, evidence, rollback: false, checkpoint };
  }

  // ---- window complete, all clean → HEALED ----
  evidence.push("the incident signature did not recur in the observation window");
  evidence.push(`no error spike (${errorEvents.length} error events, threshold ${config.maxNewErrors})`);
  if ((input.postApplyChecks ?? []).length > 0) evidence.push(`post-apply checks green: ${input.postApplyChecks!.map((c) => c.name).join(", ")}`);
  if (input.benchmark) {
    evidence.push(
      input.benchmark.verdict === "ACCEPT" && input.benchmark.headline
        ? `performance improved: ${input.benchmark.headline}`
        : "performance not worse",
    );
  }
  return { verdict: "HEALED", reason: "observation window complete — no regression, no recurrence, no error spike", evidence, rollback: false, checkpoint };
}

function fail(reason: string, evidence: string[], checkpoint: number): BrainHealWatchdogResult {
  return { verdict: "HEAL_FAILED", reason, evidence, rollback: true, checkpoint };
}
