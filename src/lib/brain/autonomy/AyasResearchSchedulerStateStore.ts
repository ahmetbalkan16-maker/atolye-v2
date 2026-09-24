import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/**
 * AYAS CONTINUOUS EXTERNAL INTELLIGENCE sprint, Part B — the scheduler's own
 * durable state: a single JSON file (atomic write, schema-versioned — this
 * codebase's standard durable-store convention). One scheduler, one state
 * file; concurrent-run exclusion is NOT this store's job (that is
 * `AyasResearchScheduler.ts`'s reused `AyasExecutionAuthorityLock`) — this
 * module only persists what has already been decided.
 */
export const ayasResearchSchedulerStateSchemaVersion = "1" as const;

export const AYAS_GOAL_RESEARCH_JOB_STATUSES = ["SCHEDULED", "AWAITING_OWNER", "RUNNING", "SUCCEEDED", "FAILED", "SKIPPED_STALE", "UNCERTAIN", "CANCELLED"] as const;
export type AyasGoalResearchJobStatus = (typeof AYAS_GOAL_RESEARCH_JOB_STATUSES)[number];
/** Shared Goal Research limits: the service and this validator must never disagree. */
export const AYAS_GOAL_RESEARCH_CATCH_UP_POLICIES = ["CATCH_UP_ONCE", "SKIP_AS_STALE", "REQUIRE_OWNER_CONFIRMATION"] as const;
export type AyasGoalResearchCatchUpPolicy = (typeof AYAS_GOAL_RESEARCH_CATCH_UP_POLICIES)[number];
export const AYAS_GOAL_RESEARCH_MAX_LATENESS_MS = 7 * 24 * 60 * 60_000;
export const AYAS_GOAL_RESEARCH_MAX_SOURCES = 3;
export const AYAS_GOAL_RESEARCH_MAX_JOBS = 100;

export function isAyasCanonicalUtc(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

/** Deterministic occurrence identity of one Goal job at its planned time (service and validator share it). */
export function deriveAyasGoalResearchOccurrenceId(jobId: string, scheduledFor: string): string {
  return crypto.createHash("sha256").update(`ayas-goal-research:${jobId}:${scheduledFor}`).digest("hex");
}

export interface AyasGoalResearchJob {
  readonly jobId: string;
  readonly goalId: string;
  readonly goalFingerprint: string;
  readonly sourceIds: readonly string[];
  readonly scheduledFor: string;
  readonly catchUpPolicy: AyasGoalResearchCatchUpPolicy;
  readonly maxLatenessMs: number;
  readonly status: AyasGoalResearchJobStatus;
  readonly attempt: 0 | 1;
  readonly occurrenceId: string;
  readonly runId?: string;
  readonly startedAt?: string;
  readonly executedAt?: string;
  readonly completedAt?: string;
  readonly missedAt?: string;
  readonly reconciledAt?: string;
  readonly confirmedAt?: string;
  readonly nextAttemptAt?: string;
  readonly errorCode?: string;
  readonly findingsRecorded?: number;
}

export interface AyasResearchSchedulerState {
  readonly schemaVersion: typeof ayasResearchSchedulerStateSchemaVersion;
  readonly lastLightStartedAt?: string;
  readonly lastLightCompletedAt?: string;
  readonly nextLightAt?: string;
  readonly lastDeepStartedAt?: string;
  readonly lastDeepCompletedAt?: string;
  readonly nextDeepAt?: string;
  /** Diagnostic only — the real mutual-exclusion guarantee is the reused `AyasExecutionAuthorityLock`, not this field. Set while a run is in flight, cleared in every exit path (success, failure, or lock-busy-skip). A non-null value observed at the START of a tick means the previous process died mid-run; the tick clears it before proceeding (see `AyasResearchScheduler.ts`). */
  readonly currentRunId?: string;
  readonly currentMode?: "LIGHT" | "DEEP";
  /** A reservation is written before any source or model call. A surviving reservation is uncertain after restart and is never replayed automatically. */
  readonly currentOccurrenceId?: string;
  readonly currentScheduledFor?: string;
  readonly lastOccurrenceId?: string;
  readonly lastScheduledFor?: string;
  readonly lastAttemptAt?: string;
  readonly lastExecutedAt?: string;
  readonly lastReconciledAt?: string;
  /** Last Goal-path fault; unlike `lastError`, a later completed cadence cycle does not clear it. */
  readonly lastGoalFaultAt?: string;
  readonly lastUncertainRunId?: string;
  readonly lastMissedCount?: number;
  readonly totalMissedOccurrences?: number;
  readonly totalAttempts?: number;
  readonly goalResearchJobs?: readonly AyasGoalResearchJob[];
  readonly lastError?: string;
  readonly consecutiveFailures: number;
  readonly lastSuccessfulResearchAt?: string;
}

export const AYAS_RESEARCH_SCHEDULER_DEFAULT_STATE: AyasResearchSchedulerState = {
  schemaVersion: ayasResearchSchedulerStateSchemaVersion,
  consecutiveFailures: 0,
};

export class AyasResearchSchedulerStateError extends Error {
  constructor(readonly code: "READ_FAILED" | "MALFORMED" | "SCHEMA_MISMATCH" | "INVALID", message: string) {
    super(message);
    this.name = "AyasResearchSchedulerStateError";
  }
}

function validateState(value: unknown): AyasResearchSchedulerState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AyasResearchSchedulerStateError("INVALID", "research scheduler state has an invalid envelope");
  }
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== ayasResearchSchedulerStateSchemaVersion) {
    throw new AyasResearchSchedulerStateError("SCHEMA_MISMATCH", "research scheduler state schema is unsupported");
  }
  if (!Number.isSafeInteger(record.consecutiveFailures) || (record.consecutiveFailures as number) < 0) {
    throw new AyasResearchSchedulerStateError("INVALID", "research scheduler failure count is invalid");
  }
  const timestamps = ["lastLightStartedAt", "lastLightCompletedAt", "nextLightAt", "lastDeepStartedAt", "lastDeepCompletedAt", "nextDeepAt", "lastSuccessfulResearchAt", "currentScheduledFor", "lastScheduledFor", "lastAttemptAt", "lastExecutedAt", "lastReconciledAt", "lastGoalFaultAt"];
  if (timestamps.some((key) => record[key] !== undefined && !isAyasCanonicalUtc(record[key])) ||
    (record.currentRunId !== undefined && typeof record.currentRunId !== "string") ||
    (record.currentMode !== undefined && record.currentMode !== "LIGHT" && record.currentMode !== "DEEP") ||
    ["currentOccurrenceId", "lastOccurrenceId", "lastUncertainRunId"].some((key) => record[key] !== undefined && (typeof record[key] !== "string" || !(record[key] as string).length)) ||
    ["lastMissedCount", "totalMissedOccurrences", "totalAttempts"].some((key) => record[key] !== undefined && (!Number.isSafeInteger(record[key]) || (record[key] as number) < 0)) ||
    (record.currentOccurrenceId !== undefined && record.currentRunId === undefined) ||
    (record.currentScheduledFor !== undefined && record.currentRunId === undefined) ||
    (record.currentMode !== undefined && record.currentRunId === undefined) ||
    (record.currentRunId !== undefined && record.currentMode === undefined) ||
    (record.currentOccurrenceId !== undefined && (record.currentMode === undefined || record.currentScheduledFor === undefined ||
      record.currentOccurrenceId !== crypto.createHash("sha256").update(`ayas-research:${record.currentMode}:${record.currentScheduledFor}`).digest("hex"))) ||
    (record.lastError !== undefined && typeof record.lastError !== "string")) {
    throw new AyasResearchSchedulerStateError("INVALID", "research scheduler state has invalid fields");
  }
  if (record.goalResearchJobs !== undefined) {
    if (!Array.isArray(record.goalResearchJobs) || record.goalResearchJobs.length > AYAS_GOAL_RESEARCH_MAX_JOBS) {
      throw new AyasResearchSchedulerStateError("INVALID", "research scheduler goal jobs are invalid");
    }
    const seen = new Set<string>();
    for (const candidate of record.goalResearchJobs) {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new AyasResearchSchedulerStateError("INVALID", "research scheduler goal job is invalid");
      const job = candidate as Record<string, unknown>;
      const validIso = (key: string) => job[key] === undefined || isAyasCanonicalUtc(job[key]);
      if (typeof job.jobId !== "string" || !/^ayas-goal-research-[0-9a-f-]{36}$/i.test(job.jobId) || seen.has(job.jobId) ||
        typeof job.goalId !== "string" || !/^ayas-goal-[0-9a-f-]{36}$/i.test(job.goalId) ||
        typeof job.goalFingerprint !== "string" || !/^[0-9a-f]{64}$/.test(job.goalFingerprint) ||
        !Array.isArray(job.sourceIds) || job.sourceIds.length < 1 || job.sourceIds.length > AYAS_GOAL_RESEARCH_MAX_SOURCES ||
        job.sourceIds.some((id) => typeof id !== "string" || !/^[a-z0-9-]{1,80}$/.test(id)) || new Set(job.sourceIds).size !== job.sourceIds.length ||
        !validIso("scheduledFor") || job.scheduledFor === undefined ||
        !(AYAS_GOAL_RESEARCH_CATCH_UP_POLICIES as readonly string[]).includes(job.catchUpPolicy as string) ||
        !Number.isSafeInteger(job.maxLatenessMs) || (job.maxLatenessMs as number) < 0 || (job.maxLatenessMs as number) > AYAS_GOAL_RESEARCH_MAX_LATENESS_MS ||
        !(AYAS_GOAL_RESEARCH_JOB_STATUSES as readonly string[]).includes(job.status as string) ||
        (job.attempt !== 0 && job.attempt !== 1) ||
        typeof job.occurrenceId !== "string" || job.occurrenceId !== deriveAyasGoalResearchOccurrenceId(job.jobId, job.scheduledFor as string) ||
        ["startedAt", "executedAt", "completedAt", "missedAt", "reconciledAt", "confirmedAt", "nextAttemptAt"].some((key) => !validIso(key)) ||
        (job.runId !== undefined && (typeof job.runId !== "string" || !/^[0-9a-f-]{36}$/i.test(job.runId))) ||
        (job.errorCode !== undefined && (typeof job.errorCode !== "string" || !/^[A-Z_]{1,64}$/.test(job.errorCode))) ||
        (job.findingsRecorded !== undefined && (!Number.isSafeInteger(job.findingsRecorded) || (job.findingsRecorded as number) < 0)) ||
        (job.status === "RUNNING" && (job.attempt !== 1 || job.runId === undefined || job.startedAt === undefined)) ||
        (job.attempt === 0 && !["SCHEDULED", "AWAITING_OWNER", "SKIPPED_STALE", "CANCELLED"].includes(job.status as string)) ||
        (job.attempt === 1 && (job.runId === undefined || job.startedAt === undefined || ["SCHEDULED", "AWAITING_OWNER", "CANCELLED"].includes(job.status as string))) ||
        (["SUCCEEDED", "FAILED"].includes(job.status as string) && (job.attempt !== 1 || job.executedAt === undefined || job.completedAt === undefined)) ||
        (["SKIPPED_STALE", "CANCELLED"].includes(job.status as string) && job.completedAt === undefined)) {
        throw new AyasResearchSchedulerStateError("INVALID", "research scheduler goal job has invalid fields");
      }
      seen.add(job.jobId);
    }
  }
  return value as AyasResearchSchedulerState;
}

export interface AyasResearchSchedulerStateStoreOptions { readonly rootDir?: string }

export interface AyasResearchSchedulerStateStore {
  readonly file: string;
  read(): AyasResearchSchedulerState;
  write(state: AyasResearchSchedulerState): AyasResearchSchedulerState;
}

export function createAyasResearchSchedulerStateStore(options: AyasResearchSchedulerStateStoreOptions = {}): AyasResearchSchedulerStateStore {
  const dir = path.resolve(options.rootDir ?? path.join(process.cwd(), "data", "brain", "self-improvement", "research"));
  const file = path.join(dir, "scheduler-state.json");

  return {
    file,
    read() {
      let serialized: string;
      try {
        serialized = fs.readFileSync(file, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return AYAS_RESEARCH_SCHEDULER_DEFAULT_STATE;
        throw new AyasResearchSchedulerStateError("READ_FAILED", "research scheduler state could not be read");
      }
      let raw: unknown;
      try { raw = JSON.parse(serialized); }
      catch { throw new AyasResearchSchedulerStateError("MALFORMED", "research scheduler state is not valid JSON"); }
      return validateState(raw);
    },
    write(state) {
      validateState(state);
      fs.mkdirSync(dir, { recursive: true });
      const tmp = path.join(dir, `.scheduler-state.${process.pid}.${crypto.randomUUID()}.tmp`);
      try {
        const fd = fs.openSync(tmp, "wx");
        try { fs.writeFileSync(fd, `${JSON.stringify(state, null, 2)}\n`, "utf8"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        fs.renameSync(tmp, file);
      } catch (error) {
        try { fs.rmSync(tmp, { force: true }); } catch { /* fail closed */ }
        throw error;
      }
      return state;
    },
  };
}

/**
 * Scheduler liveness, kept apart from the scheduler state so every heartbeat
 * can record it without the research lock (a long run holding the lock must
 * not look like downtime). `liveSince` starts the current continuous live
 * streak: a gap between heartbeats longer than the grace, a clock that went
 * backwards or an unreadable record all start a new one. Work planned before
 * `liveSince` was due while AYAS was not running — that is "missed".
 */
export interface AyasResearchSchedulerHeartbeat {
  readonly schemaVersion: typeof ayasResearchSchedulerStateSchemaVersion;
  readonly lastHeartbeatAt: string;
  readonly liveSince: string;
}

export interface AyasResearchSchedulerHeartbeatStore {
  readonly file: string;
  /** `undefined` when no heartbeat was ever recorded; throws on an unreadable record. */
  read(): AyasResearchSchedulerHeartbeat | undefined;
  beat(nowIso: string, maxGapMs: number): AyasResearchSchedulerHeartbeat;
}

export function createAyasResearchSchedulerHeartbeatStore(options: AyasResearchSchedulerStateStoreOptions = {}): AyasResearchSchedulerHeartbeatStore {
  const dir = path.resolve(options.rootDir ?? path.join(process.cwd(), "data", "brain", "self-improvement", "research"));
  const file = path.join(dir, "scheduler-heartbeat.json");
  const read = (): AyasResearchSchedulerHeartbeat | undefined => {
    let raw: unknown;
    try { raw = JSON.parse(fs.readFileSync(file, "utf8")); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw new AyasResearchSchedulerStateError("MALFORMED", "research scheduler heartbeat is unreadable");
    }
    const record = raw as Record<string, unknown>;
    if (!record || record.schemaVersion !== ayasResearchSchedulerStateSchemaVersion || !isAyasCanonicalUtc(record.lastHeartbeatAt) ||
      !isAyasCanonicalUtc(record.liveSince) || Date.parse(record.liveSince) > Date.parse(record.lastHeartbeatAt)) {
      throw new AyasResearchSchedulerStateError("INVALID", "research scheduler heartbeat is invalid");
    }
    return raw as AyasResearchSchedulerHeartbeat;
  };
  return {
    file,
    read,
    beat(nowIso, maxGapMs) {
      if (!isAyasCanonicalUtc(nowIso) || !Number.isSafeInteger(maxGapMs) || maxGapMs <= 0) throw new Error("heartbeat clock or gap is invalid");
      const nowMs = Date.parse(nowIso);
      let prior: AyasResearchSchedulerHeartbeat | undefined | "unreadable";
      try { prior = read(); } catch { prior = "unreadable"; }
      const liveSince = prior === "unreadable" ? nowIso
        // First heartbeat ever: nothing is known beyond the grace itself.
        : prior === undefined ? new Date(nowMs - maxGapMs).toISOString()
          : Date.parse(prior.lastHeartbeatAt) > nowMs || nowMs - Date.parse(prior.lastHeartbeatAt) > maxGapMs ? nowIso
            : prior.liveSince;
      const next: AyasResearchSchedulerHeartbeat = { schemaVersion: ayasResearchSchedulerStateSchemaVersion, lastHeartbeatAt: nowIso, liveSince };
      fs.mkdirSync(dir, { recursive: true });
      const tmp = path.join(dir, `.scheduler-heartbeat.${process.pid}.${crypto.randomUUID()}.tmp`);
      try {
        const fd = fs.openSync(tmp, "wx");
        try { fs.writeFileSync(fd, `${JSON.stringify(next, null, 2)}\n`, "utf8"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        fs.renameSync(tmp, file);
      } catch (error) {
        try { fs.rmSync(tmp, { force: true }); } catch { /* fail closed */ }
        throw error;
      }
      return next;
    },
  };
}
