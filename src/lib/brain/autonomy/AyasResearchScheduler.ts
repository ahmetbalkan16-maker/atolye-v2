import crypto from "node:crypto";
import path from "node:path";

import { withAyasExecutionAuthorityLock, AyasExecutionAuthorityLockError } from "./AyasExecutionAuthorityLock";
import { createAyasResearchSchedulerStateStore, type AyasResearchSchedulerState, type AyasResearchSchedulerStateStore } from "./AyasResearchSchedulerStateStore";
import { runAyasLightResearchScan, type AyasLightScanResult, type AyasLightResearchDeps } from "./AyasLightResearchEngine";
import { runAyasDeepResearchScan, type AyasDeepScanResult, type AyasDeepResearchDeps } from "./AyasDeepResearchEngine";
import { resolveAyasResearchSourceRegistry, type AyasResearchSource } from "./AyasResearchSourceRegistry";

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
 * Catch-up semantics fall out of a simple design choice rather than needing
 * special-cased logic: `nextLightAt`/`nextDeepAt` are always rescheduled as
 * `now + interval`, never `previousNextAt + interval`. If the machine was
 * off for three days, the next tick after startup sees both due, runs
 * exactly ONE catch-up cycle, and reschedules from `now` — it can never
 * "replay" the missed intervals, because there is no accumulator counting
 * them.
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

export type AyasResearchSchedulerTickOutcome = "NONE_DUE" | "ANOTHER_RUN_ACTIVE" | "LIGHT" | "DEEP";

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

  const nowIso = now();
  let state = stateStore.read();

  // A `currentRunId` left over from a process that died mid-run — the lock
  // itself is independently stale-reclaimable, this just keeps the
  // diagnostic fields honest rather than showing a permanently-stuck run.
  if (state.currentRunId) {
    state = stateStore.write({ ...state, currentRunId: undefined, currentMode: undefined, lastError: "recovered from an interrupted research run (process restarted mid-run)" });
  }

  const lightDue = isDue(state.nextLightAt, nowIso);
  const deepDue = isDue(state.nextDeepAt, nowIso);
  if (!lightDue && !deepDue) return { outcome: "NONE_DUE", state };

  const mode: "LIGHT" | "DEEP" = deepDue ? "DEEP" : "LIGHT"; // DEEP takes priority over an overlapping LIGHT due-time (Part B)
  const runId = crypto.randomUUID();

  try {
    const result = await withAyasExecutionAuthorityLock(gateRoot, async () => {
      state = stateStore.write({
        ...state,
        currentRunId: runId,
        currentMode: mode,
        ...(mode === "LIGHT" ? { lastLightStartedAt: nowIso } : { lastLightStartedAt: nowIso, lastDeepStartedAt: nowIso }),
      });

      const light = await runAyasLightResearchScan({ ...deps.light, sources });
      const lightCompletedAt = now();

      if (mode === "LIGHT") {
        return { light, deep: undefined as AyasDeepScanResult | undefined, lightCompletedAt, deepCompletedAt: undefined as string | undefined };
      }

      const changedSourceIds = new Set(light.results.filter((r) => r.changed).map((r) => r.sourceId));
      const changedSources = sources.filter((s) => changedSourceIds.has(s.sourceId));
      const deep = await runAyasDeepResearchScan({ ...deps.deep, sources: changedSources, repoRoot });
      const deepCompletedAt = now();
      return { light, deep, lightCompletedAt, deepCompletedAt };
    });

    const finalNow = now();
    state = stateStore.write({
      ...state,
      currentRunId: undefined,
      currentMode: undefined,
      lastLightCompletedAt: result.lightCompletedAt,
      nextLightAt: new Date(Date.parse(finalNow) + lightInterval).toISOString(),
      ...(mode === "DEEP" ? { lastDeepCompletedAt: result.deepCompletedAt, nextDeepAt: new Date(Date.parse(finalNow) + deepInterval).toISOString() } : {}),
      lastError: undefined,
      consecutiveFailures: 0,
      lastSuccessfulResearchAt: finalNow,
    });

    return { outcome: mode, light: result.light, deep: result.deep, state };
  } catch (error) {
    if (error instanceof AyasExecutionAuthorityLockError && error.code === "AYAS_LOCK_BUSY") {
      return { outcome: "ANOTHER_RUN_ACTIVE", state };
    }
    // A genuinely unexpected failure (not the per-source-soft-failure paths
    // already handled inside the light/deep engines themselves) — record it
    // and STILL advance the schedule, so a persistent bug never turns into a
    // tight retry loop on every subsequent observer heartbeat.
    const finalNow = now();
    const message = error instanceof Error ? error.message : String(error);
    state = stateStore.write({
      ...state,
      currentRunId: undefined,
      currentMode: undefined,
      nextLightAt: new Date(Date.parse(finalNow) + lightInterval).toISOString(),
      ...(mode === "DEEP" ? { nextDeepAt: new Date(Date.parse(finalNow) + deepInterval).toISOString() } : {}),
      lastError: message,
      consecutiveFailures: (state.consecutiveFailures ?? 0) + 1,
    });
    return { outcome: mode, state };
  }
}
