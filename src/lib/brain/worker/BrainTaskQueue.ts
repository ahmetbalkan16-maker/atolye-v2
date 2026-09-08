/**
 * Atölye Brain — task queue (pure model).
 *
 * A deterministic, in-memory model of the work queue the server-side Brain
 * Worker drains while the PC is off. The durable JSON-file store and the actual
 * runner are later, separately-approved phases; this module only decides
 * *what is runnable next* and *how a result updates the queue*.
 *
 * Guarantees:
 *  - a task never runs before its `dependsOn` tasks have `succeeded`;
 *  - a task classified above the deployment's autonomy ceiling is parked as
 *    `blocked-on-approval`, never executed;
 *  - ordering is stable (priority, then `createdAt`, then id).
 */

import { stableBrainId } from "../BrainId";
import {
  classifyBrainTaskAutonomy,
  isBrainTaskRunnableUnattended,
} from "./BrainAutonomyPolicy";
import {
  brainWorkerSchemaVersion,
  type BrainTask,
  type BrainTaskInput,
  type BrainTaskPriority,
  type BrainTaskQueueValidation,
  type BrainTaskResult,
} from "@/types/brainWorker";

const PRIORITY_RANK: Readonly<Record<BrainTaskPriority, number>> = Object.freeze({
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
});

function isIsoInstant(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

/** Build a canonical task. Deterministic id; autonomy classified up front. */
export function buildBrainTask(input: BrainTaskInput): BrainTask {
  const canonical: BrainTaskInput = {
    kind: input.kind,
    title: input.title.trim(),
    rationale: input.rationale.trim(),
    priority: input.priority,
    dependsOn: [...new Set(input.dependsOn)].sort(),
    payload: Object.freeze({ ...input.payload }),
    createdAt: input.createdAt,
    ...(input.notBefore ? { notBefore: input.notBefore } : {}),
  };
  const autonomy = classifyBrainTaskAutonomy(canonical);
  return {
    schemaVersion: brainWorkerSchemaVersion,
    ...canonical,
    taskId: stableBrainId("brain-task", canonical),
    autonomy,
    status:
      autonomy === "requires-user-approval"
        ? "blocked-on-approval"
        : autonomy === "forbidden"
          ? "skipped-unsafe"
          : "queued",
    attempts: 0,
    updatedAt: input.createdAt,
  };
}

export function enqueueBrainTask(
  queue: readonly BrainTask[],
  input: BrainTaskInput,
): readonly BrainTask[] {
  const task = buildBrainTask(input);
  if (queue.some((existing) => existing.taskId === task.taskId)) return queue;
  return [...queue, task];
}

/** Fail-closed structural validation of the whole queue. */
export function validateBrainTaskQueue(
  queue: readonly BrainTask[],
): BrainTaskQueueValidation {
  const ids = new Set<string>();
  for (const task of queue) {
    if (ids.has(task.taskId)) {
      return { valid: false, reasonCode: "BRAIN_TASK_QUEUE_DUPLICATE_ID" };
    }
    ids.add(task.taskId);
    if (!isIsoInstant(task.createdAt) || !isIsoInstant(task.updatedAt)) {
      return { valid: false, reasonCode: "BRAIN_TASK_QUEUE_TIMESTAMP_INVALID" };
    }
    if (task.notBefore && !isIsoInstant(task.notBefore)) {
      return { valid: false, reasonCode: "BRAIN_TASK_QUEUE_TIMESTAMP_INVALID" };
    }
  }
  for (const task of queue) {
    for (const dependency of task.dependsOn) {
      if (!ids.has(dependency)) {
        return { valid: false, reasonCode: "BRAIN_TASK_QUEUE_UNKNOWN_DEPENDENCY" };
      }
    }
  }
  if (hasDependencyCycle(queue)) {
    return { valid: false, reasonCode: "BRAIN_TASK_QUEUE_DEPENDENCY_CYCLE" };
  }
  return { valid: true, reasonCode: "BRAIN_TASK_QUEUE_VALID" };
}

function hasDependencyCycle(queue: readonly BrainTask[]): boolean {
  const byId = new Map(queue.map((task) => [task.taskId, task] as const));
  const state = new Map<string, 0 | 1 | 2>();
  const visit = (id: string): boolean => {
    const current = state.get(id) ?? 0;
    if (current === 1) return true;
    if (current === 2) return false;
    state.set(id, 1);
    for (const dependency of byId.get(id)?.dependsOn ?? []) {
      if (byId.has(dependency) && visit(dependency)) return true;
    }
    state.set(id, 2);
    return false;
  };
  return [...byId.keys()].some(visit);
}

export interface BrainNextTaskOptions {
  readonly maxAutonomy: "auto-safe" | "auto-safe-reversible";
  /** ISO instant used to honour `notBefore`. */
  readonly nowIso: string;
}

/**
 * The single next task the worker should run, or `undefined` when nothing is
 * runnable (all done / all blocked / all waiting on dependencies or clock).
 */
export function nextRunnableBrainTask(
  queue: readonly BrainTask[],
  options: BrainNextTaskOptions,
): BrainTask | undefined {
  const validation = validateBrainTaskQueue(queue);
  if (!validation.valid) return undefined;

  const now = Date.parse(options.nowIso);
  const succeeded = new Set(
    queue.filter((task) => task.status === "succeeded").map((task) => task.taskId),
  );

  const runnable = queue
    .filter((task) => task.status === "queued")
    .filter((task) => isBrainTaskRunnableUnattended(task.autonomy, options.maxAutonomy))
    .filter((task) => task.dependsOn.every((dependency) => succeeded.has(dependency)))
    .filter((task) => !task.notBefore || Date.parse(task.notBefore) <= now)
    .sort(
      (left, right) =>
        PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority] ||
        Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
        left.taskId.localeCompare(right.taskId),
    );

  return runnable[0];
}

/** Apply a result: mark the task, and re-evaluate dependents that were blocked. */
export function applyBrainTaskResult(
  queue: readonly BrainTask[],
  result: BrainTaskResult,
): readonly BrainTask[] {
  return queue.map((task) => {
    if (task.taskId !== result.taskId) return task;
    return {
      ...task,
      status: result.status,
      attempts: task.attempts + 1,
      updatedAt: result.finishedAt,
    };
  });
}

/** Tasks currently parked for the user. */
export function pendingApprovalBrainTasks(
  queue: readonly BrainTask[],
): readonly BrainTask[] {
  return queue
    .filter((task) => task.status === "blocked-on-approval")
    .sort(
      (left, right) =>
        PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority] ||
        left.taskId.localeCompare(right.taskId),
    );
}

/** Move an approved task from `blocked-on-approval` back into the runnable set. */
export function approveBrainTask(
  queue: readonly BrainTask[],
  taskId: string,
  approvedAtIso: string,
): readonly BrainTask[] {
  return queue.map((task) =>
    task.taskId === taskId && task.status === "blocked-on-approval"
      ? { ...task, status: "queued" as const, updatedAt: approvedAtIso }
      : task,
  );
}
