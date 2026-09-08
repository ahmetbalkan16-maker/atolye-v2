/**
 * Atölye Brain — worker cycle (Sprint 183, PHASE 6).
 *
 * The safe skeleton of the PC-off Brain Worker. One cycle:
 *
 *   load queue → pick the runnable `auto-safe` tasks (in deterministic order,
 *   under `maxTasksPerCycle` + `cycleBudgetMs`) → run a DETERMINISTIC SAFE STUB
 *   for each → persist the queue + the cycle results → build the morning report.
 *
 * What this deliberately does NOT do (the security gate is still closed):
 *  - it runs **no real work**. The default processor is a pure no-op stub; it
 *    calls no model, no GPU, no pipeline, no shell, no network, no filesystem.
 *  - it never touches a `requires-user-approval` task (parked) or a `forbidden`
 *    task (skipped-unsafe). Selection is hard-pinned to `auto-safe` regardless
 *    of `config.maxAutonomy`.
 *  - it does not loosen `BrainAutonomyPolicy` / `BrainTaskQueue` — it only
 *    composes their existing pure functions.
 *
 * This module imports nothing that can execute: only the queue model, the
 * report builder, the store handle type, and the worker types. There is no
 * `child_process`, `fetch`, `http`, `fs`, `PipelineRunner`, or `AIManager`
 * import anywhere in it — `scripts/smoke-brain-worker-cycle.ts` asserts that
 * statically.
 */

import {
  applyBrainTaskResult,
  nextRunnableBrainTask,
} from "./BrainTaskQueue";
import { buildBrainWorkerCycleReport } from "./BrainWorkerReport";
import type { BrainTaskStoreHandle } from "./BrainTaskStore";
import {
  brainWorkerSchemaVersion,
  type BrainTask,
  type BrainTaskOutcomeKind,
  type BrainTaskResult,
  type BrainWorkerConfig,
  type BrainWorkerCycleReport,
} from "@/types/brainWorker";

/** Marker every safe-stub result carries so it can never be mistaken for real work. */
export const BRAIN_SAFE_STUB_MARKER = "safe-stub" as const;

/**
 * Default worker config. `allowGpuTasks: false` and `maxAutonomy: "auto-safe"`
 * are not tunable knobs this sprint — they describe what the cycle actually is.
 */
export const DEFAULT_BRAIN_WORKER_CONFIG: BrainWorkerConfig = Object.freeze({
  schemaVersion: brainWorkerSchemaVersion,
  maxTasksPerCycle: 8,
  cycleBudgetMs: 5 * 60_000,
  allowGpuTasks: false,
  gpuHardStopCelsius: 60,
  gpuCooldownMs: 20_000,
  maxAutonomy: "auto-safe",
});

/* ------------------------------------------------------------------------- *
 * Errors
 * ------------------------------------------------------------------------- */

export type BrainWorkerCycleErrorCode =
  | "BRAIN_WORKER_CYCLE_UNSAFE_SELECTION"
  | "BRAIN_WORKER_CYCLE_BAD_RESULT";

export class BrainWorkerCycleError extends Error {
  constructor(
    readonly code: BrainWorkerCycleErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "BrainWorkerCycleError";
    this.stack = undefined;
  }
}

/* ------------------------------------------------------------------------- *
 * The safe stub processor
 * ------------------------------------------------------------------------- */

export interface BrainSafeTaskContext {
  readonly startedAtIso: string;
  readonly finishedAtIso: string;
}

export type BrainSafeTaskProcessor = (
  task: BrainTask,
  context: BrainSafeTaskContext,
) => BrainTaskResult;

const ANALYSIS_KINDS: ReadonlySet<BrainTask["kind"]> = new Set([
  "analyze-codebase",
  "diagnose-failure",
  "review-graph-staleness",
  "quality-review",
  "research-topic",
  "security-audit",
  "dependency-audit",
  "health-check",
]);

const VALID_RESULT_STATUS: ReadonlySet<BrainTaskResult["status"]> = new Set([
  "succeeded",
  "failed",
  "blocked-on-approval",
  "skipped-unsafe",
]);

/**
 * The default processor. Deterministic, side-effect-free, and honest: it marks
 * the task `succeeded` with a `[safe-stub]` summary and does nothing else. It
 * exists so the full queue → cycle → results → report chain is exercisable
 * before any real (separately-approved) processor is wired in.
 */
export function brainSafeStubProcessor(
  task: BrainTask,
  context: BrainSafeTaskContext,
): BrainTaskResult {
  const outcomeKind: BrainTaskOutcomeKind = ANALYSIS_KINDS.has(task.kind)
    ? "analysis"
    : "no-op";
  return {
    taskId: task.taskId,
    outcomeKind,
    status: "succeeded",
    summary:
      `[${BRAIN_SAFE_STUB_MARKER}] ${task.kind}: "${task.title}" — deterministic no-op. ` +
      "Nothing was executed (no model, GPU, pipeline, shell, or network).",
    evidence: [
      `autonomy=${task.autonomy}`,
      `priority=${task.priority}`,
      `mode=${BRAIN_SAFE_STUB_MARKER}`,
    ],
    producedTaskIds: [],
    startedAt: context.startedAtIso,
    finishedAt: context.finishedAtIso,
    durationMs: 0,
  };
}

/* ------------------------------------------------------------------------- *
 * Cycle
 * ------------------------------------------------------------------------- */

export interface BrainWorkerCycleOptions {
  readonly config: BrainWorkerConfig;
  readonly startedAtIso: string;
  readonly finishedAtIso: string;
  /** Clock for `notBefore` checks. Default: `startedAtIso`. */
  readonly nowIso?: string;
  /** Elapsed-ms accessor for `cycleBudgetMs` accounting. Default: `() => 0`. */
  readonly elapsedMs?: () => number;
  /**
   * Processor for each selected task. Default: {@link brainSafeStubProcessor}.
   * A real processor is a later, separately-approved phase — even then the
   * cycle only ever hands it `auto-safe` tasks.
   */
  readonly processTask?: BrainSafeTaskProcessor;
  readonly nextSingleStep?: string;
}

export type BrainWorkerCycleStopReason =
  | "nothing-runnable"
  | "queue-drained"
  | "max-tasks"
  | "budget-exhausted";

export interface BrainWorkerCycleOutcome {
  readonly report: BrainWorkerCycleReport;
  readonly results: readonly BrainTaskResult[];
  readonly queueAfter: readonly BrainTask[];
  readonly tasksProcessed: number;
  readonly stopReason: BrainWorkerCycleStopReason;
  /** taskIds parked for the user (never run). */
  readonly parkedForApproval: readonly string[];
  /** taskIds classified `forbidden` and skipped (never run). */
  readonly skippedUnsafe: readonly string[];
}

/** The cycle only ever selects at this ceiling this sprint — not `config.maxAutonomy`. */
const SELECTION_CEILING = "auto-safe" as const;

/**
 * Run one cycle over an **in-memory** queue. Pure (given a pure `processTask`) —
 * no IO. `runBrainWorkerCycle` is the store-bound wrapper.
 */
export function planBrainWorkerCycle(
  queueAtStart: readonly BrainTask[],
  options: BrainWorkerCycleOptions,
): BrainWorkerCycleOutcome {
  const nowIso = options.nowIso ?? options.startedAtIso;
  const elapsedMs = options.elapsedMs ?? (() => 0);
  const context: BrainSafeTaskContext = {
    startedAtIso: options.startedAtIso,
    finishedAtIso: options.finishedAtIso,
  };
  const processTask: BrainSafeTaskProcessor = options.processTask ?? brainSafeStubProcessor;
  const maxTasks = Math.max(0, Math.floor(options.config.maxTasksPerCycle));
  const budgetMs = Math.max(0, options.config.cycleBudgetMs);

  let queue: readonly BrainTask[] = [...queueAtStart];
  const results: BrainTaskResult[] = [];
  let stopReason: BrainWorkerCycleStopReason = "nothing-runnable";

  for (;;) {
    if (results.length >= maxTasks) {
      stopReason = "max-tasks";
      break;
    }
    if (elapsedMs() >= budgetMs) {
      stopReason = "budget-exhausted";
      break;
    }
    const next = nextRunnableBrainTask(queue, { maxAutonomy: SELECTION_CEILING, nowIso });
    if (!next) {
      stopReason = results.length === 0 ? "nothing-runnable" : "queue-drained";
      break;
    }
    // The security gate — this must be unreachable, but if the selector ever
    // hands back anything but a queued auto-safe task, stop rather than run it.
    if (next.autonomy !== "auto-safe" || next.status !== "queued") {
      throw new BrainWorkerCycleError(
        "BRAIN_WORKER_CYCLE_UNSAFE_SELECTION",
        `selector returned ${next.autonomy}/${next.status} for ${next.taskId} — refusing to process`,
      );
    }
    const produced = processTask(next, context);
    const result: BrainTaskResult = { ...produced, taskId: next.taskId };
    if (!VALID_RESULT_STATUS.has(result.status)) {
      throw new BrainWorkerCycleError(
        "BRAIN_WORKER_CYCLE_BAD_RESULT",
        `processor returned an invalid status "${result.status}" for ${next.taskId}`,
      );
    }
    results.push(result);
    queue = applyBrainTaskResult(queue, result);
  }

  const parkedForApproval = queue
    .filter((task) => task.status === "blocked-on-approval")
    .map((task) => task.taskId)
    .sort();
  const skippedUnsafe = queue
    .filter((task) => task.status === "skipped-unsafe")
    .map((task) => task.taskId)
    .sort();

  const report = buildBrainWorkerCycleReport({
    startedAt: options.startedAtIso,
    finishedAt: options.finishedAtIso,
    queueAtStart,
    results,
    nextSingleStep:
      options.nextSingleStep ?? defaultNextStep(stopReason, parkedForApproval.length),
  });

  return {
    report,
    results,
    queueAfter: queue,
    tasksProcessed: results.length,
    stopReason,
    parkedForApproval,
    skippedUnsafe,
  };
}

/**
 * Store-bound cycle: load the persisted queue, run {@link planBrainWorkerCycle},
 * then persist the mutated queue and the cycle results (both atomic, via
 * `BrainTaskStore`). Reads/writes only the Brain's own `data/brain/queue/`
 * subtree — no production data, no execution.
 */
export function runBrainWorkerCycle(
  store: BrainTaskStoreHandle,
  options: BrainWorkerCycleOptions,
): BrainWorkerCycleOutcome {
  const queueAtStart = store.loadQueue();
  const outcome = planBrainWorkerCycle(queueAtStart, options);
  // Queue first: if the results write then fails, tasks are marked done and a
  // re-run simply processes nothing (no duplicate result rows).
  store.saveQueue(outcome.queueAfter);
  store.saveCycleResults({ report: outcome.report, results: outcome.results });
  return outcome;
}

function defaultNextStep(reason: BrainWorkerCycleStopReason, parked: number): string {
  if (parked > 0) {
    return `${parked} task(s) are parked for your approval — review them before the next cycle.`;
  }
  switch (reason) {
    case "max-tasks":
      return "Cycle hit maxTasksPerCycle — run another cycle to continue the queue.";
    case "budget-exhausted":
      return "Cycle hit cycleBudgetMs — run another cycle to continue the queue.";
    case "queue-drained":
      return "All runnable auto-safe tasks are done. Add tasks or approve parked ones.";
    default:
      return "Nothing runnable. Add auto-safe tasks to the queue.";
  }
}

/** Human-readable one-liner for logs / the UI. */
export function describeBrainWorkerCycleOutcome(outcome: BrainWorkerCycleOutcome): string {
  return (
    `cycle ${outcome.report.cycleId}: processed ${outcome.tasksProcessed} ` +
    `(stop: ${outcome.stopReason})` +
    (outcome.parkedForApproval.length ? `, ${outcome.parkedForApproval.length} parked` : "") +
    (outcome.skippedUnsafe.length ? `, ${outcome.skippedUnsafe.length} skipped-unsafe` : "") +
    " — safe-stub, nothing executed"
  );
}
