import path from "node:path";

import { redactBrainText } from "../BrainRedaction";
import {
  AyasDurableTaskError,
  type AyasDurableActivityStep,
  type AyasDurableTaskDecision,
  type AyasDurableTaskDomain,
  type AyasDurableTaskEventBody,
  type AyasDurableTaskState,
  type AyasDurableTaskStatus,
} from "./AyasDurableTask";
import { advanceAyasDurableTask, inspectAyasDurableTask, resolveAyasDurableActivity, type AyasDurableTaskRuntimeDeps } from "./AyasDurableTaskRuntime";
import { AyasExecutionAuthorityLockError, withAyasExecutionAuthorityLock, type AyasExecutionAuthorityLockOptions } from "./AyasExecutionAuthorityLock";

/**
 * Stage 15B — the recovery sweep over the durable task journal.
 *
 * One call is one daemon tick. It inspects every task journal, reports what
 * it finds, and advances each task that can move by at most one bounded step
 * (`advanceAyasDurableTask`). It adds no second recovery mechanism: every
 * rule about a crashed attempt, a recorded result or an unproven side effect
 * is the contract's; the sweep only decides the order and the budget.
 *
 *  - **One sweeper.** The sweep holds `AyasExecutionAuthorityLock` on the
 *    journal directory, the same PID plus start-time lock the research
 *    scheduler uses. A second daemon gets `ANOTHER_SWEEP_ACTIVE`; a crashed
 *    sweeper's lock is reclaimed. The journal's exclusive link stays the
 *    guarantee underneath if the lock is ever bypassed.
 *  - **Recovery before new work.** Dead owners' attempts are closed first,
 *    then unconfirmed side effects are reread, and only then do new attempts
 *    start, oldest task first.
 *  - **Bounded.** Activity calls run one after another, never in parallel,
 *    and stop at `maxActivityCalls` or `budgetMs`. The rest waits for the
 *    next tick.
 *  - **No side effect by default.** A sweep starts `SIDE_EFFECT` attempts
 *    only when its caller enables that in code. Rereads always run.
 *  - **One bad task never stops the sweep.** A corrupt journal, an
 *    unregistered activity or a storage fault is reported for that task and
 *    the sweep moves on. Nothing is repaired, taken over or cancelled here.
 *  - **Dry run.** Reads only: no lock, no event, no activity call.
 *
 * The live journal, the directory the autonomy observer uses by default,
 * accepts an applying sweep only while `ayasDurableTaskLiveBinding()` says
 * the owner approved it.
 */
export type AyasDurableTaskLiveBinding = "REQUIRE_OWNER" | "OWNER_APPROVED";

/**
 * Whether a sweep may write to the live journal. An owner decision, changed only by a reviewed source change.
 *
 * `OWNER_APPROVED` since 2026-10-01: the owner approved binding the sweep, with the first activity set, to the
 * autonomy observer's tick (`LIVE_BINDING_REVIEW_PACKET.md`). The approval covers that one read-only activity; it
 * does not enable side-effect starts. Returning `REQUIRE_OWNER` again turns the live sweep off.
 */
export function ayasDurableTaskLiveBinding(): AyasDurableTaskLiveBinding { return "OWNER_APPROVED"; }

/** `true` for the journal directory a production caller gets by default (`data/brain/autonomy` under the working directory). */
export function isAyasDurableTaskLiveJournal(journalDir: string, cwd: string = process.cwd()): boolean {
  return path.resolve(journalDir).toLowerCase() === path.join(path.resolve(cwd), "data", "brain", "autonomy", "durable-tasks").toLowerCase();
}

/** Refuses an applying sweep over the live journal unless the binding is approved. A dry run is allowed in any state. */
export function assertAyasDurableTaskSweepAllowed(binding: AyasDurableTaskLiveBinding, journalDir: string, dryRun: boolean, cwd: string = process.cwd()): void {
  if (!dryRun && binding !== "OWNER_APPROVED" && isAyasDurableTaskLiveJournal(journalDir, cwd)) {
    throw new AyasDurableTaskError("AYAS_DURABLE_TASK_LIVE_BINDING_REQUIRES_OWNER", "the live durable task journal accepts no sweep until the owner approves the binding");
  }
}

export type AyasDurableTaskSweepOutcome =
  /** This sweep recorded at least one event for the task. */
  | "ADVANCED"
  /** Dry run only: what an applying sweep would do. */
  | "PLANNED"
  | "WAITING_RETRY"
  | "WAITING_OWNER"
  /** A live process owns the attempt and it is within its deadline. */
  | "RUNNING"
  /** A live process owns the attempt and it is past its deadline. Reported, never taken over. */
  | "OVERDUE"
  | "REREAD_UNAVAILABLE"
  | "LOST_RACE"
  | "DEFERRED_BUDGET"
  /** The step may not start under this sweep: side effects not enabled, activity missing, or declaration mismatch. */
  | "REFUSED"
  | "TERMINAL"
  /** The journal failed replay. */
  | "UNREADABLE"
  | "FAULT";

export interface AyasDurableTaskSweepEntry {
  readonly taskId: string;
  readonly outcome: AyasDurableTaskSweepOutcome;
  readonly status: AyasDurableTaskStatus | "UNREADABLE";
  readonly domain?: AyasDurableTaskDomain;
  readonly stepId?: string;
  readonly decision?: AyasDurableTaskDecision["action"];
  readonly recorded: readonly AyasDurableTaskEventBody["type"][];
  /** Time since the task's last event. */
  readonly idleMs?: number;
  readonly overdueMs?: number;
  /** An active task, not waiting for the owner, with no event for longer than `staleAfterMs`. */
  readonly stale: boolean;
  readonly detail?: string;
}

export interface AyasDurableTaskSweepReport {
  readonly mode: "DRY_RUN" | "APPLY";
  readonly result: "SWEPT" | "ANOTHER_SWEEP_ACTIVE";
  readonly at: string;
  readonly journals: number;
  readonly inspected: number;
  /** `true` when more journals exist than one sweep inspects: the remainder was not looked at. */
  readonly truncated: boolean;
  readonly activityCalls: number;
  readonly outcomes: Readonly<Partial<Record<AyasDurableTaskSweepOutcome, number>>>;
  readonly statuses: Readonly<Partial<Record<AyasDurableTaskStatus | "UNREADABLE", number>>>;
  /** Tasks that will not resolve on their own: unproven side effects, broken journals, stuck or refused steps. */
  readonly needsReview: readonly string[];
  /** Every inspected task except cleanly finished ones (completed, cancelled, rejected). */
  readonly entries: readonly AyasDurableTaskSweepEntry[];
}

export interface AyasDurableTaskSweepOptions {
  readonly dryRun?: boolean;
  /** Activity calls (attempts and rereads) one sweep may make. Default 4. */
  readonly maxActivityCalls?: number;
  /** No further activity call starts once the sweep has run this long. Default two minutes. */
  readonly budgetMs?: number;
  /** Journals inspected in one sweep. Default 5000. */
  readonly maxTasks?: number;
  /** Default one day. */
  readonly staleAfterMs?: number;
  /** Lets this sweep start `SIDE_EFFECT` attempts. Off by default. */
  readonly allowSideEffectStarts?: boolean;
  readonly lock?: AyasExecutionAuthorityLockOptions;
}

const DEFAULT_LOCK: AyasExecutionAuthorityLockOptions = { acquireRetryLimit: 5, acquireRetryDelayMs: 20 };
const ACTION_RANK: Partial<Record<AyasDurableTaskDecision["action"], number>> = { RECORD_OWNER_GONE: 0, REREAD_CURRENT_STATE: 1, START_ATTEMPT: 2 };
const SIDE_EFFECT_REFUSAL = "side-effect starts are not enabled for this sweep";
const BUDGET_REFUSAL = "sweep budget is spent";

function option(value: number | undefined, fallback: number, min: number, max: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < min || resolved > max) throw new AyasDurableTaskError("AYAS_DURABLE_TASK_CONTRACT_INVALID", `${label} must be an integer in ${min}..${max}`);
  return resolved;
}
function line(value: unknown): string {
  const raw = value instanceof Error ? value.message : String(value);
  return redactBrainText([...raw].map((char) => (char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? " " : char)).join("")).text.trim().slice(0, 300) || "no detail";
}

/** One daemon tick over the durable task journal. See the module comment. */
export async function sweepAyasDurableTasks(deps: AyasDurableTaskRuntimeDeps, options: AyasDurableTaskSweepOptions = {}): Promise<AyasDurableTaskSweepReport> {
  const dryRun = options.dryRun === true;
  const maxActivityCalls = option(options.maxActivityCalls, 4, 0, 64, "maxActivityCalls");
  const budgetMs = option(options.budgetMs, 120_000, 1, 3_600_000, "budgetMs");
  const maxTasks = option(options.maxTasks, 5_000, 1, 100_000, "maxTasks");
  const staleAfterMs = option(options.staleAfterMs, 86_400_000, 1, 366 * 86_400_000, "staleAfterMs");
  const allowSideEffectStarts = options.allowSideEffectStarts === true;
  const { journal } = deps;
  // Checked before the first disk access: a refused sweep leaves no trace in the live directory.
  assertAyasDurableTaskSweepAllowed(ayasDurableTaskLiveBinding(), journal.dir, dryRun);
  const nowMs = deps.nowMs ?? Date.now;
  const at = new Date(nowMs()).toISOString();
  const report = (result: AyasDurableTaskSweepReport["result"], journals: number, entries: readonly AyasDurableTaskSweepEntry[], activityCalls: number): AyasDurableTaskSweepReport => {
    const outcomes: Partial<Record<AyasDurableTaskSweepOutcome, number>> = {};
    const statuses: Partial<Record<AyasDurableTaskStatus | "UNREADABLE", number>> = {};
    for (const entry of entries) { outcomes[entry.outcome] = (outcomes[entry.outcome] ?? 0) + 1; statuses[entry.status] = (statuses[entry.status] ?? 0) + 1; }
    const review = (entry: AyasDurableTaskSweepEntry): boolean => entry.stale || entry.status === "UNCERTAIN" || ["UNREADABLE", "OVERDUE", "REFUSED", "FAULT"].includes(entry.outcome);
    const clean = (entry: AyasDurableTaskSweepEntry): boolean => entry.outcome === "TERMINAL" && ["COMPLETED", "CANCELLED", "REJECTED"].includes(entry.status);
    return Object.freeze({ mode: dryRun ? "DRY_RUN" : "APPLY", result, at, journals, inspected: entries.length, truncated: journals > maxTasks, activityCalls,
      outcomes, statuses, needsReview: entries.filter(review).map((entry) => entry.taskId), entries: entries.filter((entry) => !clean(entry)) });
  };

  const sweep = async (): Promise<AyasDurableTaskSweepReport> => {
    const ids = journal.list();
    const entries = new Map<string, AyasDurableTaskSweepEntry>();
    const startedAt = performance.now();
    let activityCalls = 0;
    const describe = (taskId: string, state: AyasDurableTaskState, decision: AyasDurableTaskDecision, outcome: AyasDurableTaskSweepOutcome, extra: Partial<AyasDurableTaskSweepEntry> = {}): AyasDurableTaskSweepEntry => {
      const idleMs = Math.max(0, nowMs() - Date.parse(state.updatedAt));
      const step = state.steps[state.currentStepIndex];
      return { taskId, outcome, status: state.status, domain: state.domain, ...(step ? { stepId: step.stepId } : {}), decision: decision.action, recorded: [], idleMs,
        ...(decision.action === "AWAIT_RUNNING_ATTEMPT" ? { overdueMs: decision.overdueMs } : {}),
        stale: state.status === "ACTIVE" && decision.action !== "WAIT_OWNER" && idleMs > staleAfterMs, ...(state.detail ? { detail: state.detail } : {}), ...extra };
    };
    const waiting = (decision: AyasDurableTaskDecision): AyasDurableTaskSweepOutcome =>
      decision.action === "NONE" ? "TERMINAL" : decision.action === "WAIT_OWNER" ? "WAITING_OWNER" : decision.action === "WAIT_RETRY" ? "WAITING_RETRY"
        : decision.action === "AWAIT_RUNNING_ATTEMPT" ? (decision.overdueMs > 0 ? "OVERDUE" : "RUNNING") : "PLANNED";
    const faulted = (taskId: string, error: unknown, known?: { state: AyasDurableTaskState; decision: AyasDurableTaskDecision }): AyasDurableTaskSweepEntry => {
      const code = error instanceof AyasDurableTaskError ? error.code : "UNEXPECTED";
      const outcome: AyasDurableTaskSweepOutcome = code === "AYAS_DURABLE_TASK_JOURNAL_CORRUPT" ? "UNREADABLE"
        : code === "AYAS_DURABLE_TASK_ACTIVITY_NOT_REGISTERED" || code === "AYAS_DURABLE_TASK_ACTIVITY_MISMATCH" ? "REFUSED" : "FAULT";
      const detail = `${code}: ${line(error)}`;
      return known && outcome !== "UNREADABLE" ? describe(taskId, known.state, known.decision, outcome, { detail }) : { taskId, outcome, status: "UNREADABLE", recorded: [], stale: false, detail };
    };
    /** Why a new attempt may not start under this sweep, if it may not. */
    const refusedStart = (step: AyasDurableActivityStep): string | undefined => (step.effect === "SIDE_EFFECT" && !allowSideEffectStarts ? SIDE_EFFECT_REFUSAL : undefined);
    const outOfBudget = (): boolean => activityCalls >= maxActivityCalls || performance.now() - startedAt > budgetMs;

    const actionable: { readonly taskId: string; readonly state: AyasDurableTaskState; readonly decision: AyasDurableTaskDecision }[] = [];
    for (const taskId of ids.slice(0, maxTasks)) {
      try {
        const seen = await inspectAyasDurableTask(taskId, deps);
        if (ACTION_RANK[seen.decision.action] === undefined) entries.set(taskId, describe(taskId, seen.state, seen.decision, waiting(seen.decision)));
        else actionable.push({ taskId, ...seen });
      } catch (error) { entries.set(taskId, faulted(taskId, error)); }
    }
    actionable.sort((a, b) => ACTION_RANK[a.decision.action]! - ACTION_RANK[b.decision.action]!
      || Date.parse(a.state.updatedAt) - Date.parse(b.state.updatedAt) || a.taskId.localeCompare(b.taskId));

    for (const item of actionable) {
      const { taskId, state, decision } = item;
      const step = state.steps[state.currentStepIndex] as AyasDurableActivityStep;
      const callsActivity = decision.action !== "RECORD_OWNER_GONE";
      try {
        if (callsActivity) {
          resolveAyasDurableActivity(state, step, deps.activities);
          const refusal = decision.action === "START_ATTEMPT" ? refusedStart(step) : undefined;
          if (refusal) { entries.set(taskId, describe(taskId, state, decision, "REFUSED", { detail: refusal })); continue; }
          if (outOfBudget()) { entries.set(taskId, describe(taskId, state, decision, "DEFERRED_BUDGET")); continue; }
        }
        if (dryRun) { if (callsActivity) activityCalls++; entries.set(taskId, describe(taskId, state, decision, "PLANNED")); continue; }
        // The state may have moved since it was inspected, so the start policy is enforced again inside the call.
        const advance = await advanceAyasDurableTask(taskId, { ...deps, admitStart: (candidate, latest) => refusedStart(candidate) ?? (outOfBudget() ? BUDGET_REFUSAL : deps.admitStart?.(candidate, latest)) });
        if (advance.recorded.includes("ATTEMPT_STARTED") || advance.decision.action === "REREAD_CURRENT_STATE") activityCalls++;
        const outcome: AyasDurableTaskSweepOutcome = advance.note === "LOST_RACE" ? "LOST_RACE" : advance.note === "REREAD_UNAVAILABLE" ? "REREAD_UNAVAILABLE"
          : advance.note === "START_NOT_ADMITTED" ? (advance.refusal === BUDGET_REFUSAL ? "DEFERRED_BUDGET" : "REFUSED")
            : advance.recorded.length > 0 ? "ADVANCED" : waiting(advance.decision);
        entries.set(taskId, describe(taskId, advance.state, advance.decision, outcome, { recorded: advance.recorded, ...(advance.refusal ? { detail: advance.refusal } : {}) }));
      } catch (error) { entries.set(taskId, faulted(taskId, error, item)); }
    }
    // A dry run only counted what it planned; it called nothing.
    return report("SWEPT", ids.length, ids.slice(0, maxTasks).map((taskId) => entries.get(taskId)!), dryRun ? 0 : activityCalls);
  };

  // Nothing to advance and nothing to lock: an idle tick creates no file.
  const journals = journal.list().length;
  if (dryRun || journals === 0) return sweep();
  try { return await withAyasExecutionAuthorityLock(journal.dir, sweep, { ...DEFAULT_LOCK, ...options.lock }); }
  catch (error) {
    if (error instanceof AyasExecutionAuthorityLockError && error.code === "AYAS_LOCK_BUSY") return report("ANOTHER_SWEEP_ACTIVE", journals, [], 0);
    throw error;
  }
}
