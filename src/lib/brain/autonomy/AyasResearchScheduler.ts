import crypto from "node:crypto";
import path from "node:path";

import { withAyasExecutionAuthorityLock, AyasExecutionAuthorityLockError } from "./AyasExecutionAuthorityLock";
import { createAyasResearchSchedulerHeartbeatStore, createAyasResearchSchedulerStateStore, isAyasCanonicalUtc, type AyasResearchSchedulerState, type AyasResearchSchedulerStateStore } from "./AyasResearchSchedulerStateStore";
import { runAyasLightResearchScan, type AyasLightScanResult, type AyasLightResearchDeps } from "./AyasLightResearchEngine";
import { runAyasDeepResearchScan, type AyasDeepScanResult, type AyasDeepResearchDeps } from "./AyasDeepResearchEngine";
import { resolveAyasResearchSourceRegistry, type AyasResearchSource } from "./AyasResearchSourceRegistry";
import { AYAS_GOAL_RESEARCH_ON_TIME_GRACE_MS, tickDueAyasGoalResearchJob } from "./AyasGoalResearchSchedule";
import type { AyasGoalStore } from "./AyasGoalStore";
import type { AyasResearchSourceStateStore } from "./AyasResearchSourceStateStore";

/**
 * AYAS CONTINUOUS EXTERNAL INTELLIGENCE sprint, Part B — the durable
 * scheduler tying LIGHT (every ~6h) and DEEP (every ~24h) research together
 * into one logical, lease-protected cycle. Deliberately reuses
 * `AyasExecutionAuthorityLock` — the exact same proven, PID+start-time
 * verified, stale-reclaimable mutual-exclusion primitive Package C's own
 * execution authority already relies on — bound to a SEPARATE `gateRoot`
 * (`data/brain/self-improvement/research`, never Package C's own gate
 * root), so a research run and a governed source-mutation execution can
 * never contend with, block, or influence each other, and "never run two
 * research cycles concurrently" gets the same tested guarantee "never two
 * concurrent governed executions" already has, for free.
 *
 * The local observer only runs while this machine is on. A missed cadence
 * is coalesced into at most one cycle after restart. A reservation surviving
 * a crash is uncertain: its occurrence is skipped rather than replayed.
 */
export const AYAS_RESEARCH_LIGHT_INTERVAL_MS = 6 * 60 * 60_000;
export const AYAS_RESEARCH_DEEP_INTERVAL_MS = 24 * 60 * 60_000;

export function resolveAyasResearchGateRoot(repoRoot: string = process.cwd()): string {
  return path.join(repoRoot, "data", "brain", "self-improvement", "research");
}

function isDue(nextAt: string | undefined, nowIso: string): boolean {
  if (!nextAt) return true;
  return Date.parse(nowIso) >= Date.parse(nextAt);
}

export type AyasResearchSchedulerTickOutcome = "NONE_DUE" | "ANOTHER_RUN_ACTIVE" | "RECOVERED_UNCERTAIN" | "GOAL_RECONCILED" | "GOAL_WAITING" | "GOAL_SKIPPED" | "GOAL_DEFERRED" | "GOAL_SUCCEEDED" | "GOAL_FAILED" | "LIGHT" | "DEEP";

export interface AyasResearchSchedulerTickResult {
  readonly outcome: AyasResearchSchedulerTickOutcome;
  readonly light?: AyasLightScanResult;
  readonly deep?: AyasDeepScanResult;
  readonly state: AyasResearchSchedulerState;
}

export interface AyasResearchSchedulerDeps {
  readonly repoRoot?: string;
  readonly gateRoot?: string;
  readonly stateStore?: AyasResearchSchedulerStateStore;
  readonly sources?: readonly AyasResearchSource[];
  readonly now?: () => string;
  readonly lightInterval?: number;
  readonly deepInterval?: number;
  readonly light?: Omit<AyasLightResearchDeps, "sources">;
  readonly deep?: Omit<AyasDeepResearchDeps, "sources">;
  readonly goalStore?: AyasGoalStore;
  readonly sourceStateStore?: AyasResearchSourceStateStore;
}

/**
 * One tick. Safe to call on every observer heartbeat — it is a fast no-op
 * (`NONE_DUE`) the overwhelming majority of the time, and a real research
 * run only actually happens when the durable cadence says it is due. Never
 * throws for an ordinary research failure (network down, every source
 * erroring, the model unavailable) — those are recorded in `state.lastError`
 * / `state.consecutiveFailures` and the schedule still advances normally,
 * exactly Part B's "internet failure must not stop AYAS" requirement.
 */
export async function tickAyasResearchScheduler(deps: AyasResearchSchedulerDeps = {}): Promise<AyasResearchSchedulerTickResult> {
  const repoRoot = deps.repoRoot ?? process.cwd();
  const gateRoot = deps.gateRoot ?? resolveAyasResearchGateRoot(repoRoot);
  const stateStore = deps.stateStore ?? createAyasResearchSchedulerStateStore({ rootDir: gateRoot });
  const sources = deps.sources ?? resolveAyasResearchSourceRegistry();
  const now = deps.now ?? (() => new Date().toISOString());
  const lightInterval = deps.lightInterval ?? AYAS_RESEARCH_LIGHT_INTERVAL_MS;
  const deepInterval = deps.deepInterval ?? AYAS_RESEARCH_DEEP_INTERVAL_MS;

  // Read once before taking the lock to fail closed on corrupt state without
  // creating a lock directory. The authoritative read is repeated UNDER the
  // lock; no stale snapshot is ever used for a write or admission decision.
  let state = stateStore.read();
  // Liveness is recorded on EVERY heartbeat, before the lock, so a long run
  // holding the lock never looks like downtime. If it cannot be recorded,
  // unknown liveness counts as downtime (the conservative side for Goal jobs).
  let liveSince: string;
  try { liveSince = createAyasResearchSchedulerHeartbeatStore({ rootDir: gateRoot }).beat(now(), AYAS_GOAL_RESEARCH_ON_TIME_GRACE_MS).liveSince; }
  catch { liveSince = now(); }
  try {
    return await withAyasExecutionAuthorityLock(gateRoot, async () => {
      state = stateStore.read();
      const nowIso = now();
      const nowMs = Date.parse(nowIso);
      if (!isAyasCanonicalUtc(nowIso) || ![lightInterval, deepInterval].every((n) => Number.isSafeInteger(n) && n > 0)) {
        throw new Error("research scheduler clock or interval is invalid");
      }

      // An earlier process may have reached a provider and crashed before
      // committing its result. Never repeat that occurrence automatically.
      if (state.currentRunId) {
        const interruptedMode = state.currentMode;
        state = stateStore.write({
          ...state,
          currentRunId: undefined,
          currentMode: undefined,
          currentOccurrenceId: undefined,
          currentScheduledFor: undefined,
          lastUncertainRunId: state.currentRunId,
          lastReconciledAt: nowIso,
          lastError: "RESEARCH_OUTCOME_UNCERTAIN",
          consecutiveFailures: state.consecutiveFailures + 1,
          nextLightAt: new Date(nowMs + lightInterval).toISOString(),
          ...(interruptedMode !== "LIGHT" ? { nextDeepAt: new Date(nowMs + deepInterval).toISOString() } : {}),
        });
        return { outcome: "RECOVERED_UNCERTAIN", state };
      }

      if (state.goalResearchJobs?.length) {
        let goalTick: Awaited<ReturnType<typeof tickDueAyasGoalResearchJob>>;
        try {
          goalTick = await tickDueAyasGoalResearchJob(state, {
            repoRoot, gateRoot, stateStore, goalStore: deps.goalStore, sourceStateStore: deps.sourceStateStore,
            sources, now, deep: deps.deep, liveSince,
          });
        } catch {
          // A Goal-path fault must never stall the regular cadence. A job it
          // left RUNNING becomes UNCERTAIN on the next tick (never replayed).
          // `lastGoalFaultAt` keeps the fault visible after later cycles.
          state = stateStore.write({ ...stateStore.read(), lastError: "GOAL_RESEARCH_TICK_FAILED", lastGoalFaultAt: nowIso, lastReconciledAt: nowIso });
          goalTick = undefined;
        }
        if (goalTick) return { outcome: goalTick.outcome, state: goalTick.state, deep: goalTick.deep };
      }

      const lightDue = isDue(state.nextLightAt, nowIso);
      const deepDue = isDue(state.nextDeepAt, nowIso);
      if (!lightDue && !deepDue) return { outcome: "NONE_DUE", state };

      const mode: "LIGHT" | "DEEP" = deepDue ? "DEEP" : "LIGHT";
      const scheduledFor = (mode === "DEEP" ? state.nextDeepAt : state.nextLightAt) ?? nowIso;
      const occurrenceId = crypto.createHash("sha256").update(`ayas-research:${mode}:${scheduledFor}`).digest("hex");
      const missedFor = (dueAt: string | undefined, interval: number): number =>
        dueAt && nowMs > Date.parse(dueAt) ? Math.max(0, Math.floor((nowMs - Date.parse(dueAt)) / interval)) : 0;
      const missedCount = Math.min(Number.MAX_SAFE_INTEGER, (lightDue ? missedFor(state.nextLightAt, lightInterval) : 0) + (deepDue ? missedFor(state.nextDeepAt, deepInterval) : 0));
      const runId = crypto.randomUUID();

      // This fsynced reservation precedes the first network/provider call.
      state = stateStore.write({
        ...state,
        currentRunId: runId,
        currentMode: mode,
        currentOccurrenceId: occurrenceId,
        currentScheduledFor: scheduledFor,
        lastOccurrenceId: occurrenceId,
        lastScheduledFor: scheduledFor,
        lastAttemptAt: nowIso,
        lastMissedCount: missedCount,
        totalMissedOccurrences: Math.min(Number.MAX_SAFE_INTEGER, (state.totalMissedOccurrences ?? 0) + missedCount),
        totalAttempts: Math.min(Number.MAX_SAFE_INTEGER, (state.totalAttempts ?? 0) + 1),
        ...(mode === "LIGHT" ? { lastLightStartedAt: nowIso } : { lastLightStartedAt: nowIso, lastDeepStartedAt: nowIso }),
      });

      const light = await runAyasLightResearchScan({ ...deps.light, sources });
      const lightCompletedAt = now();

      let deep: AyasDeepScanResult | undefined;
      let deepCompletedAt: string | undefined;
      if (mode === "DEEP") {
        const changedSourceIds = new Set(light.results.filter((r) => r.changed).map((r) => r.sourceId));
        const changedSources = sources.filter((s) => changedSourceIds.has(s.sourceId));
        deep = await runAyasDeepResearchScan({ ...deps.deep, sources: changedSources, repoRoot, scheduleContext: { scheduledFor, runId, occurrenceId } });
        deepCompletedAt = now();
      }

      const finalNow = now();
      // Finalization remains inside the same cross-process lock. A failed
      // final write leaves the reservation intact for uncertain recovery.
      // A completed cycle is a successful cycle: per-source failures keep
      // their own durable state and backoff, and `consecutiveFailures` feeds
      // the stability/health guards, so it counts only thrown or uncertain runs.
      state = stateStore.write({
        ...state,
        currentRunId: undefined,
        currentMode: undefined,
        currentOccurrenceId: undefined,
        currentScheduledFor: undefined,
        lastLightCompletedAt: lightCompletedAt,
        lastExecutedAt: finalNow,
        nextLightAt: new Date(Date.parse(finalNow) + lightInterval).toISOString(),
        ...(mode === "DEEP" ? { lastDeepCompletedAt: deepCompletedAt, nextDeepAt: new Date(Date.parse(finalNow) + deepInterval).toISOString() } : {}),
        lastError: undefined,
        consecutiveFailures: 0,
        lastSuccessfulResearchAt: finalNow,
      });
      return { outcome: mode, light, deep, state };
    });
  } catch (error) {
    if (error instanceof AyasExecutionAuthorityLockError && error.code === "AYAS_LOCK_BUSY") {
      return { outcome: "ANOTHER_RUN_ACTIVE", state };
    }
    // Never clear an in-flight reservation on a thrown provider/storage
    // error: the external result may already exist even if this process
    // cannot prove it. The next tick reconciles it without replay.
    throw error;
  }
}
