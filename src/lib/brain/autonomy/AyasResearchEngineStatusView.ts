import { createAyasResearchSchedulerStateStore } from "./AyasResearchSchedulerStateStore";
import type { AyasGoalResearchJob } from "./AyasResearchSchedulerStateStore";
import { createAyasResearchSourceStateStore } from "./AyasResearchSourceStateStore";
import { createAyasExternalResearchStore } from "./AyasExternalResearchStore";
import { resolveAyasResearchSourceRegistry } from "./AyasResearchSourceRegistry";
import { createAyasLocalDiscoveryRunLedger, type AyasLocalDiscoveryRunStatus } from "./AyasLocalDiscoveryRunLedger";

/**
 * AYAS CONTINUOUS EXTERNAL INTELLIGENCE sprint, Part O — the read-only
 * "Araştırma Motoru" (research engine) projection for Gelişim Merkezi.
 * Mirrors every other `Ayas*View.ts` loader's convention exactly
 * (`AyasGoalDevelopmentView.ts`, `AyasApprovalInboxView.ts`): reads
 * already-durable state via the default (real production) store
 * constructors, never mutates anything, and never throws — any read
 * failure resolves to `connected: false` with a plain error string so the
 * panel can render an honest "couldn't read this" instead of crashing the
 * whole console.
 */
export type AyasResearchEngineSourceStatus = "OK" | "UNCHANGED" | "ERROR" | "NEVER_CHECKED";

export interface AyasResearchEngineSourceView {
  readonly sourceId: string;
  readonly provider: string;
  readonly category: string;
  readonly officialSource: boolean;
  readonly lastCheckedAt?: string;
  readonly lastChangedAt?: string;
  readonly status: AyasResearchEngineSourceStatus;
  readonly consecutiveFailures: number;
  readonly lastError?: string;
}

export interface AyasResearchEngineDigest {
  readonly sourcesRegistered: number;
  readonly sourcesChangedLast24h: number;
  readonly sourcesFailingNow: number;
  readonly findingsLast24h: number;
}

export interface AyasResearchEngineStatusView {
  readonly connected: boolean;
  readonly lastLightStartedAt?: string;
  readonly lastLightCompletedAt?: string;
  readonly nextLightAt?: string;
  readonly lastDeepStartedAt?: string;
  readonly lastDeepCompletedAt?: string;
  readonly nextDeepAt?: string;
  readonly lastError?: string;
  readonly consecutiveFailures: number;
  readonly lastSuccessfulResearchAt?: string;
  readonly lastScheduledFor?: string;
  readonly lastAttemptAt?: string;
  readonly lastExecutedAt?: string;
  readonly lastReconciledAt?: string;
  readonly lastGoalFaultAt?: string;
  readonly lastMissedCount?: number;
  readonly totalMissedOccurrences?: number;
  readonly totalAttempts?: number;
  readonly uncertainOutcomePendingReview?: boolean;
  readonly goalResearchJobs?: readonly Pick<AyasGoalResearchJob, "jobId" | "goalId" | "scheduledFor" | "status" | "attempt" | "executedAt" | "findingsRecorded" | "errorCode">[];
  readonly pendingGoalCatchUpCount?: number;
  readonly awaitingOwnerGoalCount?: number;
  readonly skippedGoalCount?: number;
  readonly runningGoalCount?: number;
  readonly uncertainGoalCount?: number;
  readonly sources: readonly AyasResearchEngineSourceView[];
  readonly digest: AyasResearchEngineDigest;
  readonly localDiscovery?: {
    readonly lastStartedAt: string;
    readonly lastCompletedAt?: string;
    readonly nextExpectedAt?: string;
    readonly status: AyasLocalDiscoveryRunStatus;
    readonly candidateCount: number;
    readonly proposalCount: number;
    readonly duplicateCount: number;
  };
  readonly error?: string;
}

const DAY_MS = 24 * 60 * 60_000;

export function loadAyasResearchEngineStatusView(now: string = new Date().toISOString()): AyasResearchEngineStatusView {
  try {
    const schedulerState = createAyasResearchSchedulerStateStore().read();
    const sourceStateStore = createAyasResearchSourceStateStore();
    const registry = resolveAyasResearchSourceRegistry();
    const findings = createAyasExternalResearchStore().list();
    const discoveryRuns = createAyasLocalDiscoveryRunLedger().read().runs;
    const latestDiscovery = discoveryRuns[discoveryRuns.length - 1];

    const nowMs = Date.parse(now);
    const sources: AyasResearchEngineSourceView[] = registry.map((source) => {
      const state = sourceStateStore.read(source.sourceId);
      const status: AyasResearchEngineSourceStatus = !state ? "NEVER_CHECKED" : state.status;
      return {
        sourceId: source.sourceId,
        provider: source.provider,
        category: source.category,
        officialSource: source.officialSource,
        lastCheckedAt: state?.lastCheckedAt,
        lastChangedAt: state?.lastChangedAt,
        status,
        consecutiveFailures: state?.consecutiveFailures ?? 0,
        lastError: state?.lastError,
      };
    });

    const digest: AyasResearchEngineDigest = {
      sourcesRegistered: registry.length,
      sourcesChangedLast24h: sources.filter((s) => s.lastChangedAt && nowMs - Date.parse(s.lastChangedAt) <= DAY_MS).length,
      sourcesFailingNow: sources.filter((s) => s.status === "ERROR").length,
      findingsLast24h: findings.filter((f) => nowMs - Date.parse(f.recordedAt) <= DAY_MS).length,
    };

    return {
      connected: true,
      lastLightStartedAt: schedulerState.lastLightStartedAt,
      lastLightCompletedAt: schedulerState.lastLightCompletedAt,
      nextLightAt: schedulerState.nextLightAt,
      lastDeepStartedAt: schedulerState.lastDeepStartedAt,
      lastDeepCompletedAt: schedulerState.lastDeepCompletedAt,
      nextDeepAt: schedulerState.nextDeepAt,
      lastError: schedulerState.lastError,
      consecutiveFailures: schedulerState.consecutiveFailures,
      lastSuccessfulResearchAt: schedulerState.lastSuccessfulResearchAt,
      lastScheduledFor: schedulerState.lastScheduledFor,
      lastAttemptAt: schedulerState.lastAttemptAt,
      lastExecutedAt: schedulerState.lastExecutedAt,
      lastReconciledAt: schedulerState.lastReconciledAt,
      lastGoalFaultAt: schedulerState.lastGoalFaultAt,
      lastMissedCount: schedulerState.lastMissedCount,
      totalMissedOccurrences: schedulerState.totalMissedOccurrences,
      totalAttempts: schedulerState.totalAttempts,
      // Pending until a later cycle completes; an in-flight run is running, not uncertain.
      uncertainOutcomePendingReview: Boolean(schedulerState.lastUncertainRunId && schedulerState.lastReconciledAt &&
        (!schedulerState.lastExecutedAt || Date.parse(schedulerState.lastReconciledAt) >= Date.parse(schedulerState.lastExecutedAt))),
      goalResearchJobs: (schedulerState.goalResearchJobs ?? []).map((job) => ({ jobId: job.jobId, goalId: job.goalId, scheduledFor: job.scheduledFor, status: job.status, attempt: job.attempt, executedAt: job.executedAt, findingsRecorded: job.findingsRecorded, errorCode: job.errorCode })),
      pendingGoalCatchUpCount: (schedulerState.goalResearchJobs ?? []).filter((job) => job.status === "SCHEDULED" && Date.parse(job.scheduledFor) < nowMs).length,
      awaitingOwnerGoalCount: (schedulerState.goalResearchJobs ?? []).filter((job) => job.status === "AWAITING_OWNER").length,
      skippedGoalCount: (schedulerState.goalResearchJobs ?? []).filter((job) => job.status === "SKIPPED_STALE").length,
      runningGoalCount: (schedulerState.goalResearchJobs ?? []).filter((job) => job.status === "RUNNING").length,
      uncertainGoalCount: (schedulerState.goalResearchJobs ?? []).filter((job) => job.status === "UNCERTAIN").length,
      sources,
      digest,
      ...(latestDiscovery ? { localDiscovery: {
        lastStartedAt: latestDiscovery.startedAt,
        lastCompletedAt: latestDiscovery.completedAt,
        nextExpectedAt: latestDiscovery.nextExpectedAt,
        status: latestDiscovery.status,
        candidateCount: latestDiscovery.candidateCount,
        proposalCount: latestDiscovery.proposalCount,
        duplicateCount: latestDiscovery.duplicateCount,
      } } : {}),
    };
  } catch (error) {
    return {
      connected: false,
      consecutiveFailures: 0,
      sources: [],
      digest: { sourcesRegistered: 0, sourcesChangedLast24h: 0, sourcesFailingNow: 0, findingsLast24h: 0 },
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
