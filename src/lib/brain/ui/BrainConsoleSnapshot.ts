/**
 * Atölye Brain — Brain Core console snapshot (Sprint 184, PHASE 6).
 *
 * A **read-only** aggregate of the Brain's real durable state for the Brain Core
 * UI: the task queue, the last worker cycle, the experience store, and a
 * conservative safety verdict. It reads the same `data/brain/` files the CLI and
 * the worker cycle use — and writes nothing, runs nothing.
 *
 *  - No probe (`nvidia-smi` etc.) — the safety snapshot is always `"unavailable"`,
 *    which the Safety Governor treats conservatively. The UI never opens the
 *    execution gate.
 *  - A corrupt store surfaces as an `errors[]` entry + a disconnected section,
 *    not a page crash.
 *  - When a store file does not exist yet the matching `connected.*` flag is
 *    `false` and the section is an honest empty state — never mock data.
 */

import fs from "node:fs";

import {
  createBrainTaskStore,
  BrainTaskStoreError,
} from "@/lib/brain/worker/BrainTaskStore";
import {
  createBrainExperienceStore,
  BrainExperienceStoreError,
} from "@/lib/brain/store/BrainExperienceStore";
import {
  evaluateBrainSafety,
  resolveBrainHardwareProfile,
} from "@/lib/brain/BrainSafetyGovernor";
import type { BrainSafetyDecision } from "@/types/brain";
import type { BrainTask, BrainTaskStatus } from "@/types/brainWorker";

export const BRAIN_CONSOLE_TASK_LIMIT = 40;

export interface BrainConsoleTaskView {
  readonly taskId: string;
  readonly kind: string;
  readonly title: string;
  readonly priority: BrainTask["priority"];
  readonly status: BrainTaskStatus;
  readonly autonomy: BrainTask["autonomy"];
  readonly requiresApproval: boolean;
  readonly blocked: boolean;
  readonly createdAt: string;
}

export interface BrainConsoleSnapshot {
  readonly generatedAt: string;
  readonly executionGate: "CLOSED";
  readonly connected: {
    readonly tasks: boolean;
    readonly cycles: boolean;
    readonly experience: boolean;
  };
  readonly errors: readonly string[];
  readonly tasks: {
    readonly total: number;
    readonly byStatus: Readonly<Record<BrainTaskStatus, number>>;
    readonly pendingApproval: number;
    readonly skippedUnsafe: number;
    readonly items: readonly BrainConsoleTaskView[];
  };
  readonly lastCycle?: {
    readonly cycleId: string;
    readonly startedAt: string;
    readonly finishedAt: string;
    readonly tasksConsidered: number;
    readonly tasksRun: number;
    readonly problemsFound: number;
    readonly awaitingApproval: number;
    readonly nextSingleStep: string;
  };
  readonly cyclesRecorded: number;
  readonly experience: {
    readonly total: number;
    readonly lastTopic?: string;
    readonly lastCompletedAt?: string;
    readonly lastMode?: string;
  };
  readonly safety: {
    readonly decision: BrainSafetyDecision;
    readonly snapshotSource: "unavailable";
    readonly reasons: readonly string[];
    readonly hardwareProfileId: string;
  };
}

const EMPTY_BY_STATUS: Readonly<Record<BrainTaskStatus, number>> = Object.freeze({
  queued: 0,
  running: 0,
  "blocked-on-dependency": 0,
  "blocked-on-approval": 0,
  succeeded: 0,
  failed: 0,
  cancelled: 0,
  "skipped-unsafe": 0,
});

export interface LoadBrainConsoleSnapshotOptions {
  readonly rootDir?: string;
  readonly nowIso?: string;
  readonly hardwareProfileId?: string;
}

export async function loadBrainConsoleSnapshot(
  options: LoadBrainConsoleSnapshotOptions = {},
): Promise<BrainConsoleSnapshot> {
  const generatedAt = options.nowIso ?? new Date().toISOString();
  const hardwareProfileId = options.hardwareProfileId ?? "gtx-1650-4gb";
  const rootOpt = options.rootDir ? { rootDir: options.rootDir } : {};
  const errors: string[] = [];

  /* ---- tasks ---- */
  const taskStore = createBrainTaskStore(rootOpt);
  let tasksConnected = false;
  let queue: readonly BrainTask[] = [];
  try {
    queue = taskStore.loadQueue();
    tasksConnected = pathExists(taskStore.queueFile);
  } catch (error) {
    errors.push(describeError("task queue", error));
  }

  const byStatus: Record<BrainTaskStatus, number> = { ...EMPTY_BY_STATUS };
  for (const task of queue) byStatus[task.status] = (byStatus[task.status] ?? 0) + 1;

  const items: BrainConsoleTaskView[] = [...queue]
    .sort(
      (left, right) =>
        Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
        left.taskId.localeCompare(right.taskId),
    )
    .slice(0, BRAIN_CONSOLE_TASK_LIMIT)
    .map((task) => ({
      taskId: task.taskId,
      kind: task.kind,
      title: task.title,
      priority: task.priority,
      status: task.status,
      autonomy: task.autonomy,
      requiresApproval: task.autonomy === "requires-user-approval",
      blocked:
        task.status === "blocked-on-approval" || task.status === "blocked-on-dependency",
      createdAt: task.createdAt,
    }));

  /* ---- worker cycles ---- */
  let cyclesRecorded = 0;
  let lastCycle: BrainConsoleSnapshot["lastCycle"];
  try {
    const cycleIds = taskStore.listCycleIds();
    cyclesRecorded = cycleIds.length;
    const latest = cycleIds[cycleIds.length - 1];
    if (latest) {
      const record = taskStore.loadCycleResults(latest);
      if (record) {
        lastCycle = {
          cycleId: record.report.cycleId,
          startedAt: record.report.startedAt,
          finishedAt: record.report.finishedAt,
          tasksConsidered: record.report.tasksConsidered,
          tasksRun: record.report.tasksRun,
          problemsFound: record.report.problemsFound.length,
          awaitingApproval: record.report.awaitingUserApproval.length,
          nextSingleStep: record.report.nextSingleStep,
        };
      }
    }
  } catch (error) {
    errors.push(describeError("worker cycles", error));
  }

  /* ---- experience ---- */
  let experienceConnected = false;
  let experience: BrainConsoleSnapshot["experience"] = { total: 0 };
  try {
    const expStore = createBrainExperienceStore(rootOpt);
    if (pathExists(expStore.experienceDir)) {
      experienceConnected = true;
      const records = await expStore.list({ includeDryRun: true });
      if (records.length > 0) {
        const latest = records[0];
        experience = {
          total: records.length,
          lastTopic: latest.topic,
          lastCompletedAt: latest.completedAt,
          lastMode: latest.mode ?? "production",
        };
      } else {
        experience = { total: 0 };
      }
    }
  } catch (error) {
    errors.push(describeError("experience store", error));
  }

  /* ---- safety (no probe — conservative) ---- */
  const profile = resolveBrainHardwareProfile(hardwareProfileId);
  const verdict = evaluateBrainSafety(profile, {
    observedAt: generatedAt,
    source: "unavailable",
  });

  return {
    generatedAt,
    executionGate: "CLOSED",
    connected: {
      tasks: tasksConnected,
      cycles: cyclesRecorded > 0,
      experience: experienceConnected,
    },
    errors,
    tasks: {
      total: queue.length,
      byStatus,
      pendingApproval: byStatus["blocked-on-approval"] ?? 0,
      skippedUnsafe: byStatus["skipped-unsafe"] ?? 0,
      items,
    },
    ...(lastCycle ? { lastCycle } : {}),
    cyclesRecorded,
    experience,
    safety: {
      decision: verdict.decision,
      snapshotSource: "unavailable",
      reasons: verdict.reasons,
      hardwareProfileId,
    },
  };
}

function pathExists(target: string): boolean {
  try {
    return fs.existsSync(target);
  } catch {
    return false;
  }
}

function describeError(label: string, error: unknown): string {
  if (error instanceof BrainTaskStoreError || error instanceof BrainExperienceStoreError) {
    return `${label}: ${error.code} — ${error.message}`;
  }
  return `${label}: ${error instanceof Error ? error.message : String(error)}`;
}
