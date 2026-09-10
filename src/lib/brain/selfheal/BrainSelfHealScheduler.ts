/**
 * Atölye Brain — Autonomous v2: the scheduler (pure).
 *
 * Emir §22. The Brain runs a health check on a safe cadence — but NEVER while a
 * voice turn is live, a critical operation is running, or the user just
 * interacted. It also backs off if the last check was recent.
 */

import { runtimeIsBusy, type BrainRuntimeEvent } from "./BrainRuntimeEvent";

export interface BrainSchedulerConfig {
  /** Minimum gap between autonomous health checks (ms). */
  readonly minIntervalMs: number;
  /** How long after the last user interaction to stay quiet (ms). */
  readonly userQuietMs: number;
  /** Runtime-busy look-back window (ms). */
  readonly busyWindowMs: number;
}

export const DEFAULT_SCHEDULER_CONFIG: BrainSchedulerConfig = Object.freeze({
  minIntervalMs: 5 * 60 * 1000,
  userQuietMs: 45 * 1000,
  busyWindowMs: 20 * 1000,
});

export interface BrainSchedulerInput {
  readonly config: BrainSchedulerConfig;
  readonly nowMs: number;
  readonly lastHealthCheckMs: number | null;
  readonly recentEvents: readonly BrainRuntimeEvent[];
  /** An explicit "the operator is doing something important" flag. */
  readonly criticalOperationActive?: boolean;
  /** Any incident already in flight — do heavy work one at a time. */
  readonly selfHealBusy?: boolean;
}

export interface BrainSchedulerDecision {
  readonly runHealthCheck: boolean;
  readonly reason: string;
  readonly nextEarliestMs: number;
}

export function decideHealthCheck(input: BrainSchedulerInput): BrainSchedulerDecision {
  const { config, nowMs } = input;
  const since = input.lastHealthCheckMs == null ? Infinity : nowMs - input.lastHealthCheckMs;
  const nextEarliest = input.lastHealthCheckMs == null ? nowMs : input.lastHealthCheckMs + config.minIntervalMs;

  if (input.criticalOperationActive) {
    return { runHealthCheck: false, reason: "a critical operation is active", nextEarliestMs: nextEarliest };
  }
  if (input.selfHealBusy) {
    return { runHealthCheck: false, reason: "a self-heal run is already in progress", nextEarliestMs: nextEarliest };
  }
  if (since < config.minIntervalMs) {
    return { runHealthCheck: false, reason: `last check was ${Math.round(since / 1000)} s ago (min ${config.minIntervalMs / 1000} s)`, nextEarliestMs: nextEarliest };
  }
  const lastUserInteraction = input.recentEvents
    .filter((e) => e.event === "user-interaction")
    .map((e) => Date.parse(e.at))
    .filter((t) => Number.isFinite(t))
    .reduce((m, t) => Math.max(m, t), 0);
  if (lastUserInteraction > 0 && nowMs - lastUserInteraction < config.userQuietMs) {
    return { runHealthCheck: false, reason: "the user interacted recently — staying quiet", nextEarliestMs: nowMs + config.userQuietMs };
  }
  if (runtimeIsBusy(input.recentEvents, nowMs, config.busyWindowMs)) {
    return { runHealthCheck: false, reason: "a voice turn / conversation is live", nextEarliestMs: nowMs + config.busyWindowMs };
  }
  return { runHealthCheck: true, reason: "safe window — running a health check", nextEarliestMs: nowMs + config.minIntervalMs };
}
