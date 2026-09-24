import crypto from "node:crypto";
import path from "node:path";

import { withAyasExecutionAuthorityLock } from "./AyasExecutionAuthorityLock";
import { createAyasGoalStore, type AyasGoal, type AyasGoalStore } from "./AyasGoalStore";
import { runAyasDeepResearchScan, type AyasDeepResearchDeps, type AyasDeepScanResult } from "./AyasDeepResearchEngine";
import { createAyasResearchNoveltyStore } from "./AyasResearchNoveltyStore";
import { createAyasExternalResearchStore } from "./AyasExternalResearchStore";
import { resolveAyasResearchSourcePolicy, resolveAyasResearchSourceRegistry, type AyasResearchSource } from "./AyasResearchSourceRegistry";
import { createAyasResearchSourceStateStore, type AyasResearchSourceStateStore } from "./AyasResearchSourceStateStore";
import {
  AYAS_GOAL_RESEARCH_CATCH_UP_POLICIES,
  AYAS_GOAL_RESEARCH_MAX_JOBS,
  AYAS_GOAL_RESEARCH_MAX_LATENESS_MS,
  AYAS_GOAL_RESEARCH_MAX_SOURCES,
  createAyasResearchSchedulerStateStore,
  deriveAyasGoalResearchOccurrenceId,
  isAyasCanonicalUtc,
  type AyasGoalResearchCatchUpPolicy,
  type AyasGoalResearchJob,
  type AyasResearchSchedulerState,
  type AyasResearchSchedulerStateStore,
} from "./AyasResearchSchedulerStateStore";

const OWNER_CONFIRMATION_VALID_MS = 24 * 60 * 60_000;
/** An owner-requested catch-up runs within a day of its planned time unless the request says otherwise. */
export const AYAS_GOAL_RESEARCH_DEFAULT_CATCH_UP_WINDOW_MS = 24 * 60 * 60_000;
/**
 * The longest gap between two scheduler heartbeats that still counts as
 * "AYAS kept running". A heartbeat comes every five minutes and a discovery
 * child may run for four more, so twenty minutes is a clear margin. A job is
 * *missed* only when the current live streak began after its planned time
 * (see `createAyasResearchSchedulerHeartbeatStore`); queueing or a long run
 * holding the lock while AYAS is up is never downtime.
 */
export const AYAS_GOAL_RESEARCH_ON_TIME_GRACE_MS = 20 * 60_000;
const UNCERTAIN_REVIEW_WINDOW_MS = 30 * 24 * 60 * 60_000;
/** A finished job this recent may be the only record of a Goal fetch, which source pacing relies on. */
const PACING_EVIDENCE_WINDOW_MS = 24 * 60 * 60_000;

export function fingerprintAyasGoalResearchScope(goal: AyasGoal): string {
  return crypto.createHash("sha256").update(JSON.stringify([goal.userIntent, goal.scope, goal.allowedDomains, goal.excludedDomains])).digest("hex");
}

function replaceJob(state: AyasResearchSchedulerState, job: AyasGoalResearchJob): AyasResearchSchedulerState {
  return { ...state, goalResearchJobs: (state.goalResearchJobs ?? []).map((existing) => existing.jobId === job.jobId ? job : existing) };
}

export interface AyasGoalResearchScheduleRequest {
  readonly sourceIds: readonly string[];
  readonly scheduledFor: string;
  readonly catchUpPolicy: AyasGoalResearchCatchUpPolicy;
  /** How late an automatic catch-up may still run. Omitted = 24 hours for CATCH_UP_ONCE, on time only otherwise. */
  readonly maxLatenessMs?: number;
}

/** The one place the owner-facing schedule rules live (the action and the panel only forward input). */
function assertScheduleRequest(input: AyasGoalResearchScheduleRequest, sources: readonly AyasResearchSource[]): number {
  const maxLatenessMs = input.maxLatenessMs ?? (input.catchUpPolicy === "CATCH_UP_ONCE" ? AYAS_GOAL_RESEARCH_DEFAULT_CATCH_UP_WINDOW_MS : 0);
  if (!isAyasCanonicalUtc(input.scheduledFor) ||
    !(AYAS_GOAL_RESEARCH_CATCH_UP_POLICIES as readonly string[]).includes(input.catchUpPolicy) ||
    !Number.isSafeInteger(maxLatenessMs) || maxLatenessMs < 0 || maxLatenessMs > AYAS_GOAL_RESEARCH_MAX_LATENESS_MS ||
    !Array.isArray(input.sourceIds) || input.sourceIds.length < 1 || input.sourceIds.length > AYAS_GOAL_RESEARCH_MAX_SOURCES ||
    new Set(input.sourceIds).size !== input.sourceIds.length) {
    throw new Error("invalid goal research schedule");
  }
  if (input.sourceIds.some((id) => !sources.some((source) => source.sourceId === id && source.officialSource))) {
    throw new Error("goal research source is not registered and official");
  }
  return maxLatenessMs;
}

const FINISHED: ReadonlySet<AyasGoalResearchJob["status"]> = new Set(["SUCCEEDED", "FAILED", "SKIPPED_STALE", "CANCELLED"]);

/**
 * Room for one more job. At capacity the oldest history goes first: finished
 * jobs without findings, then finished jobs with findings (the findings stay
 * in the research list; only their per-goal link in the view is lost), then
 * uncertain outcomes nobody reviewed for 30 days. Open jobs, and jobs that
 * started within the pacing-evidence window, are never dropped.
 */
function withRoomForOneJob(jobs: readonly AyasGoalResearchJob[], nowMs: number): AyasGoalResearchJob[] {
  if (jobs.length < AYAS_GOAL_RESEARCH_MAX_JOBS) return [...jobs];
  const settledAt = (job: AyasGoalResearchJob) => Date.parse(job.completedAt ?? job.reconciledAt ?? job.startedAt ?? job.scheduledFor);
  const pacingEvidence = (job: AyasGoalResearchJob) => job.startedAt !== undefined && nowMs - Date.parse(job.startedAt) < PACING_EVIDENCE_WINDOW_MS;
  const tiers: readonly ((job: AyasGoalResearchJob) => boolean)[] = [
    (job) => FINISHED.has(job.status) && !job.findingsRecorded,
    (job) => FINISHED.has(job.status),
    (job) => job.status === "UNCERTAIN" && nowMs - settledAt(job) > UNCERTAIN_REVIEW_WINDOW_MS,
  ];
  const excess = jobs.length - AYAS_GOAL_RESEARCH_MAX_JOBS + 1;
  const dropped = new Set<string>();
  for (const tier of tiers) {
    const candidates = jobs.filter((job) => !dropped.has(job.jobId) && !pacingEvidence(job) && tier(job))
      .sort((a, b) => settledAt(a) - settledAt(b) || a.jobId.localeCompare(b.jobId));
    for (const job of candidates) {
      if (dropped.size >= excess) break;
      dropped.add(job.jobId);
    }
  }
  if (dropped.size < excess) throw new Error("goal research schedule capacity reached");
  return jobs.filter((job) => !dropped.has(job.jobId));
}

function newJob(goal: AyasGoal, input: AyasGoalResearchScheduleRequest, maxLatenessMs: number): AyasGoalResearchJob {
  const jobId = `ayas-goal-research-${crypto.randomUUID()}`;
  return {
    jobId, goalId: goal.goalId, goalFingerprint: fingerprintAyasGoalResearchScope(goal),
    sourceIds: [...input.sourceIds], scheduledFor: input.scheduledFor,
    catchUpPolicy: input.catchUpPolicy, maxLatenessMs,
    status: "SCHEDULED", attempt: 0,
    occurrenceId: deriveAyasGoalResearchOccurrenceId(jobId, input.scheduledFor),
  };
}

export interface AyasGoalResearchScheduleDeps {
  readonly gateRoot: string;
  readonly stateStore?: AyasResearchSchedulerStateStore;
  readonly goalStore?: AyasGoalStore;
  readonly sources?: readonly AyasResearchSource[];
  readonly now?: () => string;
}

/** The caller must be an authenticated owner surface. This service grants no mutation/approval authority. */
export async function scheduleAyasGoalResearch(input: AyasGoalResearchScheduleRequest & { readonly goalId: string }, deps: AyasGoalResearchScheduleDeps): Promise<AyasGoalResearchJob> {
  if (!/^ayas-goal-[0-9a-f-]{36}$/i.test(input.goalId)) throw new Error("invalid goal research schedule");
  const maxLatenessMs = assertScheduleRequest(input, deps.sources ?? resolveAyasResearchSourceRegistry());
  const stateStore = deps.stateStore ?? createAyasResearchSchedulerStateStore({ rootDir: deps.gateRoot });
  const goalStore = deps.goalStore ?? createAyasGoalStore();
  const now = deps.now ?? (() => new Date().toISOString());
  return withAyasExecutionAuthorityLock(deps.gateRoot, async () => {
    const nowIso = now();
    if (!isAyasCanonicalUtc(nowIso) || Date.parse(input.scheduledFor) < Date.parse(nowIso)) throw new Error("goal research schedule must be in the future");
    const goal = goalStore.load(input.goalId);
    if (goal.status === "CANCELLED" || goal.status === "COMPLETED") throw new Error("goal research schedule requires an active goal");
    const state = stateStore.read();
    const job = newJob(goal, input, maxLatenessMs);
    stateStore.write({ ...state, goalResearchJobs: [...withRoomForOneJob(state.goalResearchJobs ?? [], Date.parse(nowIso)), job] });
    return job;
  });
}

/**
 * Owner request from the Brain panel: a new research Goal plus its one-shot
 * job, created under the research lock after every check, so a busy lock or a
 * rejected request leaves nothing behind. A failed job write cancels the Goal
 * it just created instead of leaving an active Goal with no job.
 */
export async function createAndScheduleAyasGoalResearch(
  input: AyasGoalResearchScheduleRequest & { readonly userIntent: string },
  deps: AyasGoalResearchScheduleDeps,
): Promise<{ readonly goal: AyasGoal; readonly job: AyasGoalResearchJob }> {
  if (typeof input.userIntent !== "string" || input.userIntent.trim().length < 5 || input.userIntent.length > 300) throw new Error("invalid research goal");
  const maxLatenessMs = assertScheduleRequest(input, deps.sources ?? resolveAyasResearchSourceRegistry());
  const stateStore = deps.stateStore ?? createAyasResearchSchedulerStateStore({ rootDir: deps.gateRoot });
  const goalStore = deps.goalStore ?? createAyasGoalStore();
  const now = deps.now ?? (() => new Date().toISOString());
  return withAyasExecutionAuthorityLock(deps.gateRoot, async () => {
    const nowIso = now();
    if (!isAyasCanonicalUtc(nowIso) || Date.parse(input.scheduledFor) < Date.parse(nowIso)) throw new Error("goal research schedule must be in the future");
    const state = stateStore.read();
    const jobs = withRoomForOneJob(state.goalResearchJobs ?? [], Date.parse(nowIso));
    const goal = goalStore.create({ userIntent: input.userIntent, scope: "Owner-requested official-source research", allowedDomains: [], successCriteria: ["Produce source-linked findings relevant to the goal"] });
    try {
      const job = newJob(goal, input, maxLatenessMs);
      stateStore.write({ ...state, goalResearchJobs: [...jobs, job] });
      return { goal, job };
    } catch (error) {
      try { goalStore.transition(goal.goalId, "CANCELLED", nowIso); } catch { /* the Goal stays visible; the original error is what matters */ }
      throw error;
    }
  });
}

/** Owner actions never touch a running/terminal job and recheck goal scope on confirmation. */
export async function controlAyasGoalResearchJob(jobId: string, action: "CONFIRM" | "CANCEL" | "SKIP", deps: AyasGoalResearchScheduleDeps): Promise<AyasGoalResearchJob> {
  if (!/^ayas-goal-research-[0-9a-f-]{36}$/i.test(jobId)) throw new Error("invalid goal research job ID");
  const stateStore = deps.stateStore ?? createAyasResearchSchedulerStateStore({ rootDir: deps.gateRoot });
  const goalStore = deps.goalStore ?? createAyasGoalStore();
  const now = deps.now ?? (() => new Date().toISOString());
  return withAyasExecutionAuthorityLock(deps.gateRoot, async () => {
    const nowIso = now();
    if (!isAyasCanonicalUtc(nowIso)) throw new Error("invalid scheduler clock");
    const state = stateStore.read();
    const job = state.goalResearchJobs?.find((item) => item.jobId === jobId);
    if (!job || (action === "CONFIRM" ? job.status !== "AWAITING_OWNER" : !["SCHEDULED", "AWAITING_OWNER"].includes(job.status))) {
      throw new Error("goal research action is not valid for this job");
    }
    if (action === "CONFIRM") {
      const goal = goalStore.load(job.goalId);
      if (goal.status === "CANCELLED" || goal.status === "COMPLETED" || fingerprintAyasGoalResearchScope(goal) !== job.goalFingerprint) {
        throw new Error("goal research scope changed; schedule a new job");
      }
    }
    // A confirmation re-plans the job from now and drops the old parking reason.
    const updated: AyasGoalResearchJob = action === "CONFIRM"
      ? { ...job, status: "SCHEDULED", confirmedAt: nowIso, reconciledAt: nowIso, nextAttemptAt: nowIso, errorCode: undefined }
      : { ...job, status: action === "CANCEL" ? "CANCELLED" : "SKIPPED_STALE", completedAt: nowIso, reconciledAt: nowIso };
    stateStore.write(replaceJob(state, updated));
    return updated;
  });
}

export interface AyasGoalResearchTickDeps extends AyasGoalResearchScheduleDeps {
  readonly repoRoot: string;
  /**
   * Start of the scheduler's current continuous live streak (from the
   * heartbeat record). A job planned before it was due while AYAS was down.
   */
  readonly liveSince: string;
  readonly sourceStateStore?: AyasResearchSourceStateStore;
  readonly deep?: Omit<AyasDeepResearchDeps, "sources">;
}

export type AyasGoalResearchTickOutcome = "GOAL_RECONCILED" | "GOAL_WAITING" | "GOAL_SKIPPED" | "GOAL_DEFERRED" | "GOAL_SUCCEEDED" | "GOAL_FAILED";

type Decision =
  | { readonly kind: "finish"; readonly status: "AWAITING_OWNER" | "SKIPPED_STALE"; readonly errorCode: string }
  | { readonly kind: "defer"; readonly until: string }
  | { readonly kind: "run"; readonly goal: AyasGoal; readonly sources: readonly AyasResearchSource[] };

/** Called only while the research scheduler owns the shared execution lock. At most one goal job is processed per heartbeat. */
export async function tickDueAyasGoalResearchJob(
  state: AyasResearchSchedulerState,
  deps: AyasGoalResearchTickDeps,
): Promise<{ readonly outcome: AyasGoalResearchTickOutcome; readonly state: AyasResearchSchedulerState; readonly deep?: AyasDeepScanResult } | undefined> {
  const stateStore = deps.stateStore ?? createAyasResearchSchedulerStateStore({ rootDir: deps.gateRoot });
  const goalStore = deps.goalStore ?? createAyasGoalStore();
  const now = deps.now ?? (() => new Date().toISOString());
  const nowIso = now();
  if (!isAyasCanonicalUtc(nowIso) || !isAyasCanonicalUtc(deps.liveSince)) throw new Error("invalid scheduler clock");
  const nowMs = Date.parse(nowIso);
  const liveSinceMs = Date.parse(deps.liveSince);
  const jobs = state.goalResearchJobs ?? [];
  const running = jobs.find((job) => job.status === "RUNNING");
  if (running) {
    const updated: AyasGoalResearchJob = { ...running, status: "UNCERTAIN", reconciledAt: nowIso, errorCode: "RESEARCH_OUTCOME_UNCERTAIN" };
    return { outcome: "GOAL_RECONCILED", state: stateStore.write(replaceJob(state, updated)) };
  }

  const dueAt = (job: AyasGoalResearchJob) => Date.parse(job.nextAttemptAt ?? job.scheduledFor);
  const due = jobs
    .filter((job) => job.status === "SCHEDULED" && Date.parse(job.scheduledFor) <= nowMs && dueAt(job) <= nowMs)
    .sort((a, b) => dueAt(a) - dueAt(b) || a.jobId.localeCompare(b.jobId));
  if (!due.length) return undefined;

  // Missed = AYAS was not running at the planned time: its current live
  // streak began after it. An owner-confirmed job was re-planned by the owner.
  const missed = (job: AyasGoalResearchJob) => !job.confirmedAt && liveSinceMs > Date.parse(job.scheduledFor);
  const registry = deps.sources ?? resolveAyasResearchSourceRegistry();
  const sourcesOf = (job: AyasGoalResearchJob): AyasResearchSource[] | null => {
    const selected = job.sourceIds.map((id) => registry.find((source) => source.sourceId === id && source.officialSource));
    return selected.every(Boolean) ? selected as AyasResearchSource[] : null;
  };
  const goals = new Map<string, AyasGoal | "GOAL_UNAVAILABLE" | "GOAL_SCOPE_STALE">();
  const goalOf = (job: AyasGoalResearchJob) => {
    let resolved = goals.get(job.jobId);
    if (resolved === undefined) {
      try {
        const goal = goalStore.load(job.goalId);
        resolved = goal.status === "CANCELLED" || goal.status === "COMPLETED" || fingerprintAyasGoalResearchScope(goal) !== job.goalFingerprint ? "GOAL_SCOPE_STALE" : goal;
      } catch { resolved = "GOAL_UNAVAILABLE"; }
      goals.set(job.jobId, resolved);
    }
    return resolved;
  };

  // A downtime backlog of automatic catch-ups for one Goal is coalesced: only
  // its latest runnable job may still run by itself; older ones wait for the
  // owner. Other goals, on-time, confirmed and skip/confirm-policy jobs follow
  // their own policy, one job per heartbeat.
  const backlog = due.filter((job) => job.catchUpPolicy === "CATCH_UP_ONCE" && missed(job) &&
    nowMs - Date.parse(job.scheduledFor) <= job.maxLatenessMs && typeof goalOf(job) !== "string" && sourcesOf(job) !== null);
  const parked = new Set<string>();
  for (const goalId of new Set(backlog.map((job) => job.goalId))) {
    const group = backlog.filter((job) => job.goalId === goalId).sort((a, b) => Date.parse(b.scheduledFor) - Date.parse(a.scheduledFor) || a.jobId.localeCompare(b.jobId));
    for (const older of group.slice(1)) parked.add(older.jobId);
  }
  if (parked.size) {
    const updated = stateStore.write({ ...state, goalResearchJobs: jobs.map((item) => parked.has(item.jobId)
      ? { ...item, status: "AWAITING_OWNER" as const, missedAt: nowIso, reconciledAt: nowIso, errorCode: "MULTIPLE_MISSED_REQUIRES_OWNER" }
      : item) });
    return { outcome: "GOAL_WAITING", state: updated };
  }

  const job = due[0]!;
  // Decide without side effects. A fault while deciding ends THIS job
  // visibly and never reaches a source, a model or the regular cadence; a
  // failed WRITE of a decision is not a decision fault — it propagates and the
  // next heartbeat decides again.
  let decision: Decision;
  try {
    const loaded = goalOf(job);
    if (typeof loaded === "string") decision = { kind: "finish", status: "SKIPPED_STALE", errorCode: loaded };
    else if (job.confirmedAt && nowMs - Date.parse(job.confirmedAt) > OWNER_CONFIRMATION_VALID_MS) decision = { kind: "finish", status: "AWAITING_OWNER", errorCode: "OWNER_CONFIRMATION_EXPIRED" };
    else if (missed(job) && job.catchUpPolicy === "REQUIRE_OWNER_CONFIRMATION") decision = { kind: "finish", status: "AWAITING_OWNER", errorCode: "MISSED_REQUIRES_OWNER" };
    else if (missed(job) && (job.catchUpPolicy === "SKIP_AS_STALE" || nowMs - Date.parse(job.scheduledFor) > job.maxLatenessMs)) decision = { kind: "finish", status: "SKIPPED_STALE", errorCode: "MISSED_STALE" };
    else {
      const sources = sourcesOf(job);
      if (!sources) decision = { kind: "finish", status: "SKIPPED_STALE", errorCode: "SOURCE_REGISTRY_CHANGED" };
      else {
        const sourceStateStore = deps.sourceStateStore ?? createAyasResearchSourceStateStore({ rootDir: path.join(deps.repoRoot, "data", "brain", "self-improvement", "research-sources") });
        const lastSourceAttempt = (sourceId: string): number => {
          const checked = Date.parse(sourceStateStore.read(sourceId)?.lastCheckedAt ?? "1970-01-01T00:00:00.000Z");
          return Math.max(
            // An unreadable check time counts as "just checked": defer rather than risk contacting the source too often.
            Number.isFinite(checked) ? checked : nowMs,
            ...jobs.filter((other) => other.sourceIds.includes(sourceId) && other.startedAt).map((other) => Date.parse(other.startedAt!)),
          );
        };
        const nextAllowed = Math.max(...sources.map((source) => lastSourceAttempt(source.sourceId) + resolveAyasResearchSourcePolicy(source).minCheckIntervalMs));
        // Source pacing may delay a job only inside the window its policy
        // allows; beyond it the policy decides, so a deferral never outlives
        // the request (and a far-future check time cannot park it for days).
        const windowEnd = job.confirmedAt
          ? Date.parse(job.confirmedAt) + OWNER_CONFIRMATION_VALID_MS
          : Date.parse(job.scheduledFor) + (job.catchUpPolicy === "CATCH_UP_ONCE" ? Math.max(AYAS_GOAL_RESEARCH_ON_TIME_GRACE_MS, job.maxLatenessMs) : AYAS_GOAL_RESEARCH_ON_TIME_GRACE_MS);
        if (nowMs >= nextAllowed) decision = { kind: "run", goal: loaded, sources };
        else if (nextAllowed <= windowEnd) decision = { kind: "defer", until: new Date(nextAllowed).toISOString() };
        else decision = job.confirmedAt || job.catchUpPolicy === "REQUIRE_OWNER_CONFIRMATION"
          ? { kind: "finish", status: "AWAITING_OWNER", errorCode: "PACING_REQUIRES_OWNER" }
          : { kind: "finish", status: "SKIPPED_STALE", errorCode: "PACING_WINDOW_EXCEEDED" };
      }
    }
  } catch {
    decision = { kind: "finish", status: "SKIPPED_STALE", errorCode: "GOAL_TICK_FAILED" };
  }

  if (decision.kind === "finish") {
    const updated: AyasGoalResearchJob = { ...job, status: decision.status, errorCode: decision.errorCode, reconciledAt: nowIso,
      ...(decision.status === "SKIPPED_STALE" ? { completedAt: nowIso } : {}), ...(missed(job) ? { missedAt: nowIso } : {}) };
    return { outcome: decision.status === "AWAITING_OWNER" ? "GOAL_WAITING" : "GOAL_SKIPPED", state: stateStore.write(replaceJob(state, updated)) };
  }
  if (decision.kind === "defer") {
    const updated: AyasGoalResearchJob = { ...job, nextAttemptAt: decision.until, reconciledAt: nowIso };
    return { outcome: "GOAL_DEFERRED", state: stateStore.write(replaceJob(state, updated)) };
  }

  const runId = crypto.randomUUID();
  const reserved: AyasGoalResearchJob = { ...job, status: "RUNNING", attempt: 1, runId, startedAt: nowIso, nextAttemptAt: undefined, errorCode: undefined, ...(missed(job) ? { missedAt: nowIso } : {}) };
  const reservedState = stateStore.write(replaceJob(state, reserved));
  const deep = await runAyasDeepResearchScan({
    ...deps.deep, sources: decision.sources, repoRoot: deps.repoRoot,
    researchStore: deps.deep?.researchStore ?? createAyasExternalResearchStore({ rootDir: path.join(deps.repoRoot, "data", "brain", "self-improvement", "external-research") }),
    noveltyStore: deps.deep?.noveltyStore ?? createAyasResearchNoveltyStore({ rootDir: path.join(deps.gateRoot, "goal-novelty", job.goalId) }),
    maxEntriesPerSource: 1,
    scheduleContext: { scheduledFor: job.scheduledFor, runId, occurrenceId: job.occurrenceId, goalId: job.goalId, goalIntent: decision.goal.userIntent },
  });
  const completedAt = now();
  if (!isAyasCanonicalUtc(completedAt)) throw new Error("invalid scheduler clock after goal research");
  // Explicit outcome codes; an empty run is never presented as an answer and
  // there is no fallback to an unselected or unregistered source. A source
  // whose error came before any entry could not be read; an error on a source
  // that produced entries happened in local analysis or recording.
  const entrySources = new Set(deep.entryOutcomes.map((entry) => entry.sourceId));
  const fetchFailed = deep.sourceErrors.some((error) => !entrySources.has(error.sourceId));
  const analysisFailed = deep.sourceErrors.some((error) => entrySources.has(error.sourceId)) ||
    deep.entryOutcomes.some((entry) => entry.outcome === "SKIPPED_ANALYSIS_ERROR" || entry.outcome === "SKIPPED_INVALID_MODEL_OUTPUT");
  const alreadyKnown = deep.findingsRecorded === 0 && deep.entryOutcomes.length > 0 &&
    deep.entryOutcomes.every((entry) => entry.outcome === "SKIPPED_DUPLICATE" || entry.outcome === "SKIPPED_UNCHANGED");
  const errorCode = fetchFailed ? "RESEARCH_SOURCE_FAILURE"
    : analysisFailed ? "RESEARCH_ANALYSIS_FAILED"
      : alreadyKnown ? "EVIDENCE_ALREADY_RECORDED"
        : deep.findingsRecorded === 0 ? "INSUFFICIENT_SOURCE_EVIDENCE"
          : undefined;
  const failed = fetchFailed || analysisFailed;
  const completed: AyasGoalResearchJob = {
    ...reserved, status: failed ? "FAILED" : "SUCCEEDED", executedAt: completedAt, completedAt,
    findingsRecorded: deep.findingsRecorded, errorCode,
  };
  return { outcome: failed ? "GOAL_FAILED" : "GOAL_SUCCEEDED", state: stateStore.write(replaceJob(reservedState, completed)), deep };
}
