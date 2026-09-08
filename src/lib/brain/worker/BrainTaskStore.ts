/**
 * Atölye Brain — durable task-queue store (Sprint 182, PHASE 6).
 *
 * The persistence layer under {@link BrainTaskQueue}. The queue logic itself is
 * unchanged — this store only round-trips the *same* `BrainTask[]` /
 * `BrainTaskResult[]` through JSON files so the queue survives a restart.
 *
 *   data/brain/queue/tasks.json           { schemaVersion, updatedAt, tasks }
 *   data/brain/queue/results/<cycle>.json  { schemaVersion, cycleId, savedAt, report, results }
 *
 * Same rules as `store/BrainExperienceStore.ts` (Sprint 181):
 *  - **Atomic write** — temp file in the same dir → `fs.fsyncSync` →
 *    `fs.renameSync`. A crash mid-write leaves the previous file intact.
 *  - **Corrupt = loud.** A file that does not parse, or has the wrong shape /
 *    schema version, throws `BRAIN_TASK_STORE_CORRUPT` /
 *    `BRAIN_TASK_STORE_SCHEMA_MISMATCH`. It is NEVER silently treated as an
 *    empty queue, and it is never overwritten — the operator reviews it.
 *  - **Reject on leak.** A task / result whose text matches a secret pattern
 *    (`containsBrainSecret`) is rejected outright (`BRAIN_TASK_STORE_SECRET_LEAK`)
 *    — the store does not mask-and-keep it.
 *  - **No oversized payloads.** `payload` is capped (keys + serialized bytes);
 *    over the cap → `BRAIN_TASK_STORE_PAYLOAD_TOO_LARGE`.
 *  - **Deterministic reads.** Tasks are stored sorted by `taskId`; results by
 *    `resultId`. The same file always parses to the same ordered array.
 *  - **Idempotent writes.** `enqueue` dedupes on `taskId` (via
 *    `enqueueBrainTask`); `saveCycleResults` dedupes on `resultId` and keeps a
 *    single row per cycle file.
 *  - **All queue guarantees preserved.** Every save runs the existing
 *    `validateBrainTaskQueue` (duplicate id / unknown dependency / cycle /
 *    timestamp) and refuses to persist a structurally invalid queue.
 *
 * This does NOT connect the queue to any execution. Nothing here runs a task,
 * a model, the pipeline, or the GPU.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import { stableBrainId } from "../BrainId";
import { containsBrainSecret } from "../BrainRedaction";
import {
  applyBrainTaskResult,
  approveBrainTask,
  enqueueBrainTask,
  nextRunnableBrainTask,
  pendingApprovalBrainTasks,
  validateBrainTaskQueue,
  type BrainNextTaskOptions,
} from "./BrainTaskQueue";
import type {
  BrainTask,
  BrainTaskInput,
  BrainTaskResult,
  BrainWorkerCycleReport,
} from "@/types/brainWorker";

/** Store-envelope format version — bump only for an envelope migration. */
export const brainTaskStoreSchemaVersion = "1" as const;

/** Hard caps on what a single task may carry into durable storage. */
const MAX_PAYLOAD_KEYS = 32;
const MAX_PAYLOAD_BYTES = 4_096;
const MAX_TEXT_FIELD = 4_000;
const MAX_EVIDENCE_LINES = 200;

/* ------------------------------------------------------------------------- *
 * Errors
 * ------------------------------------------------------------------------- */

export type BrainTaskStoreErrorCode =
  | "BRAIN_TASK_STORE_CORRUPT"
  | "BRAIN_TASK_STORE_SCHEMA_MISMATCH"
  | "BRAIN_TASK_STORE_IO"
  | "BRAIN_TASK_STORE_QUEUE_INVALID"
  | "BRAIN_TASK_STORE_SECRET_LEAK"
  | "BRAIN_TASK_STORE_PAYLOAD_TOO_LARGE"
  | "BRAIN_TASK_STORE_RECORD_INVALID";

export class BrainTaskStoreError extends Error {
  constructor(
    readonly code: BrainTaskStoreErrorCode,
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "BrainTaskStoreError";
    this.stack = undefined;
  }
}

/* ------------------------------------------------------------------------- *
 * Record validation (pure, reject-on-leak)
 * ------------------------------------------------------------------------- */

export type BrainTaskStorageReasonCode =
  | "BRAIN_TASK_STORAGE_VALID"
  | "BRAIN_TASK_STORAGE_SECRET_LEAK"
  | "BRAIN_TASK_STORAGE_PAYLOAD_TOO_LARGE"
  | "BRAIN_TASK_STORAGE_TEXT_TOO_LARGE";

export interface BrainTaskStorageValidation {
  readonly valid: boolean;
  readonly reasonCode: BrainTaskStorageReasonCode;
}

/**
 * Fail-closed check applied before a task is written. Unlike the experience
 * store this does NOT redact-and-keep: a task carrying a secret is a bug in the
 * caller and is rejected so it gets fixed at source.
 */
export function validateBrainTaskForStorage(task: BrainTask): BrainTaskStorageValidation {
  if (task.title.length > MAX_TEXT_FIELD || task.rationale.length > MAX_TEXT_FIELD) {
    return { valid: false, reasonCode: "BRAIN_TASK_STORAGE_TEXT_TOO_LARGE" };
  }
  const payloadKeys = Object.keys(task.payload ?? {});
  if (payloadKeys.length > MAX_PAYLOAD_KEYS) {
    return { valid: false, reasonCode: "BRAIN_TASK_STORAGE_PAYLOAD_TOO_LARGE" };
  }
  if (Buffer.byteLength(JSON.stringify(task.payload ?? {}), "utf-8") > MAX_PAYLOAD_BYTES) {
    return { valid: false, reasonCode: "BRAIN_TASK_STORAGE_PAYLOAD_TOO_LARGE" };
  }
  const texts = [
    task.title,
    task.rationale,
    ...payloadKeys,
    ...payloadKeys.map((key) => String(task.payload[key])),
  ];
  if (texts.some((text) => containsBrainSecret(text))) {
    return { valid: false, reasonCode: "BRAIN_TASK_STORAGE_SECRET_LEAK" };
  }
  return { valid: true, reasonCode: "BRAIN_TASK_STORAGE_VALID" };
}

/** The same fail-closed check for a cycle result. */
export function validateBrainTaskResultForStorage(
  result: BrainTaskResult,
): BrainTaskStorageValidation {
  if (result.summary.length > MAX_TEXT_FIELD) {
    return { valid: false, reasonCode: "BRAIN_TASK_STORAGE_TEXT_TOO_LARGE" };
  }
  if (result.evidence.length > MAX_EVIDENCE_LINES) {
    return { valid: false, reasonCode: "BRAIN_TASK_STORAGE_PAYLOAD_TOO_LARGE" };
  }
  const texts = [result.summary, ...result.evidence, ...result.producedTaskIds];
  if (texts.some((text) => containsBrainSecret(text))) {
    return { valid: false, reasonCode: "BRAIN_TASK_STORAGE_SECRET_LEAK" };
  }
  return { valid: true, reasonCode: "BRAIN_TASK_STORAGE_VALID" };
}

/**
 * Deterministic id for a result within its cycle. Two byte-identical results
 * collide on purpose so a re-save is idempotent.
 */
export function brainTaskResultId(result: BrainTaskResult): string {
  if (result.resultId) return result.resultId;
  return stableBrainId("brain-task-result", {
    taskId: result.taskId,
    outcomeKind: result.outcomeKind,
    status: result.status,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    summary: result.summary,
  });
}

/* ------------------------------------------------------------------------- *
 * File helpers
 * ------------------------------------------------------------------------- */

function reasonToStoreCode(reason: BrainTaskStorageReasonCode): BrainTaskStoreErrorCode {
  switch (reason) {
    case "BRAIN_TASK_STORAGE_SECRET_LEAK":
      return "BRAIN_TASK_STORE_SECRET_LEAK";
    case "BRAIN_TASK_STORAGE_PAYLOAD_TOO_LARGE":
    case "BRAIN_TASK_STORAGE_TEXT_TOO_LARGE":
      return "BRAIN_TASK_STORE_PAYLOAD_TOO_LARGE";
    default:
      return "BRAIN_TASK_STORE_RECORD_INVALID";
  }
}

function normalizeLoadedTask(task: BrainTask): BrainTask {
  return {
    ...task,
    dependsOn: [...task.dependsOn],
    payload: Object.freeze({ ...task.payload }),
  };
}

/* ------------------------------------------------------------------------- *
 * Store
 * ------------------------------------------------------------------------- */

export interface BrainTaskStoreOptions {
  /** Root for all Brain durable state. Default: `<cwd>/data/brain`. */
  readonly rootDir?: string;
  /** Injectable clock for deterministic tests. */
  readonly now?: () => Date;
}

export interface BrainCycleResultsRecord {
  readonly schemaVersion: typeof brainTaskStoreSchemaVersion;
  readonly cycleId: string;
  readonly savedAt: string;
  readonly report: BrainWorkerCycleReport;
  readonly results: readonly BrainTaskResult[];
}

export interface BrainTaskStoreHandle {
  /** Read the persisted queue. `[]` when the file does not exist; THROWS on corrupt. */
  loadQueue(): readonly BrainTask[];
  /** Validate + persist a queue atomically. Throws on a leak / oversize / invalid queue. */
  saveQueue(queue: readonly BrainTask[]): readonly BrainTask[];
  /** Load → `enqueueBrainTask` (idempotent on `taskId`) → save. */
  enqueue(input: BrainTaskInput): readonly BrainTask[];
  /** Load → `applyBrainTaskResult` → save. */
  applyResult(result: BrainTaskResult): readonly BrainTask[];
  /** Load → `approveBrainTask` → save. */
  approve(taskId: string, approvedAtIso: string): readonly BrainTask[];
  /** Read-only: the single next runnable task for the given ceiling / clock. */
  nextRunnable(options: BrainNextTaskOptions): BrainTask | undefined;
  /** Read-only: tasks currently parked for the user. */
  pendingApproval(): readonly BrainTask[];
  /** Persist a worker cycle's results (idempotent per `cycleId` + `resultId`). */
  saveCycleResults(input: {
    readonly report: BrainWorkerCycleReport;
    readonly results: readonly BrainTaskResult[];
  }): BrainCycleResultsRecord;
  /** Read one cycle's persisted results. `undefined` when absent; THROWS on corrupt. */
  loadCycleResults(cycleId: string): BrainCycleResultsRecord | undefined;
  /** Deterministic list of persisted cycle ids (ascending). */
  listCycleIds(): readonly string[];
  readonly queueFile: string;
  readonly resultsDir: string;
}

export function createBrainTaskStore(
  options: BrainTaskStoreOptions = {},
): BrainTaskStoreHandle {
  const rootDir = options.rootDir
    ? path.resolve(options.rootDir)
    : path.join(process.cwd(), "data", "brain");
  const queueDir = path.join(rootDir, "queue");
  const resultsDir = path.join(queueDir, "results");
  const queueFile = path.join(queueDir, "tasks.json");
  const now = options.now ?? (() => new Date());

  function ensureDir(dir: string): void {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (error) {
      throw new BrainTaskStoreError(
        "BRAIN_TASK_STORE_IO",
        `cannot create ${dir}`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  function readJson(file: string, label: string): unknown | undefined {
    if (!fs.existsSync(file)) return undefined;
    let raw: string;
    try {
      raw = fs.readFileSync(file, "utf-8");
    } catch (error) {
      throw new BrainTaskStoreError(
        "BRAIN_TASK_STORE_IO",
        `cannot read ${file}`,
        error instanceof Error ? error.message : String(error),
      );
    }
    try {
      return JSON.parse(raw);
    } catch (error) {
      throw new BrainTaskStoreError(
        "BRAIN_TASK_STORE_CORRUPT",
        `${label} is not valid JSON — refusing to touch it (manual review needed)`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  function writeJsonAtomic(file: string, value: unknown): void {
    ensureDir(path.dirname(file));
    const tmp = path.join(
      path.dirname(file),
      `.${path.basename(file)}.${process.pid}.${crypto.randomUUID()}.tmp`,
    );
    try {
      const handle = fs.openSync(tmp, "w");
      try {
        fs.writeFileSync(handle, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
        fs.fsyncSync(handle);
      } finally {
        fs.closeSync(handle);
      }
      fs.renameSync(tmp, file);
    } catch (error) {
      try {
        fs.rmSync(tmp, { force: true });
      } catch {
        /* best effort */
      }
      throw new BrainTaskStoreError(
        "BRAIN_TASK_STORE_IO",
        `atomic write failed for ${file}`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  function assertEnvelope(
    value: unknown,
    label: string,
    requiredKeys: readonly string[],
  ): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new BrainTaskStoreError("BRAIN_TASK_STORE_CORRUPT", `${label} has an unexpected shape`);
    }
    const record = value as Record<string, unknown>;
    if (record.schemaVersion !== brainTaskStoreSchemaVersion) {
      throw new BrainTaskStoreError(
        "BRAIN_TASK_STORE_SCHEMA_MISMATCH",
        `${label} schemaVersion ${JSON.stringify(record.schemaVersion)} ≠ ${brainTaskStoreSchemaVersion} — no automatic migration`,
      );
    }
    for (const key of requiredKeys) {
      if (!(key in record)) {
        throw new BrainTaskStoreError("BRAIN_TASK_STORE_CORRUPT", `${label} is missing "${key}"`);
      }
    }
    return record;
  }

  function persistQueue(queue: readonly BrainTask[]): readonly BrainTask[] {
    const structural = validateBrainTaskQueue(queue);
    if (!structural.valid) {
      throw new BrainTaskStoreError(
        "BRAIN_TASK_STORE_QUEUE_INVALID",
        `refusing to persist a structurally invalid queue: ${structural.reasonCode}`,
        structural.reasonCode,
      );
    }
    for (const task of queue) {
      const check = validateBrainTaskForStorage(task);
      if (!check.valid) {
        throw new BrainTaskStoreError(
          reasonToStoreCode(check.reasonCode),
          `task ${task.taskId} rejected: ${check.reasonCode}`,
          check.reasonCode,
        );
      }
    }
    const ordered = [...queue].sort((left, right) => left.taskId.localeCompare(right.taskId));
    writeJsonAtomic(queueFile, {
      schemaVersion: brainTaskStoreSchemaVersion,
      updatedAt: now().toISOString(),
      tasks: ordered,
    });
    return ordered;
  }

  const handle: BrainTaskStoreHandle = {
    queueFile,
    resultsDir,

    loadQueue(): readonly BrainTask[] {
      const parsed = readJson(queueFile, "queue/tasks.json");
      if (parsed === undefined) return [];
      const envelope = assertEnvelope(parsed, "queue/tasks.json", ["tasks"]);
      if (!Array.isArray(envelope.tasks)) {
        throw new BrainTaskStoreError("BRAIN_TASK_STORE_CORRUPT", "queue/tasks.json `tasks` is not an array");
      }
      const tasks = (envelope.tasks as BrainTask[]).map(normalizeLoadedTask);
      const structural = validateBrainTaskQueue(tasks);
      if (!structural.valid) {
        throw new BrainTaskStoreError(
          "BRAIN_TASK_STORE_QUEUE_INVALID",
          `persisted queue is structurally invalid: ${structural.reasonCode}`,
          structural.reasonCode,
        );
      }
      return [...tasks].sort((left, right) => left.taskId.localeCompare(right.taskId));
    },

    saveQueue(queue: readonly BrainTask[]): readonly BrainTask[] {
      return persistQueue(queue);
    },

    enqueue(input: BrainTaskInput): readonly BrainTask[] {
      return persistQueue(enqueueBrainTask(this.loadQueue(), input));
    },

    applyResult(result: BrainTaskResult): readonly BrainTask[] {
      const check = validateBrainTaskResultForStorage(result);
      if (!check.valid) {
        throw new BrainTaskStoreError(
          reasonToStoreCode(check.reasonCode),
          `result for ${result.taskId} rejected: ${check.reasonCode}`,
          check.reasonCode,
        );
      }
      return persistQueue(applyBrainTaskResult(this.loadQueue(), result));
    },

    approve(taskId: string, approvedAtIso: string): readonly BrainTask[] {
      return persistQueue(approveBrainTask(this.loadQueue(), taskId, approvedAtIso));
    },

    nextRunnable(nextOptions: BrainNextTaskOptions): BrainTask | undefined {
      return nextRunnableBrainTask(this.loadQueue(), nextOptions);
    },

    pendingApproval(): readonly BrainTask[] {
      return pendingApprovalBrainTasks(this.loadQueue());
    },

    saveCycleResults(input): BrainCycleResultsRecord {
      const cycleId = input.report.cycleId;
      if (!cycleId || !/^[A-Za-z0-9_-]+$/.test(cycleId)) {
        throw new BrainTaskStoreError(
          "BRAIN_TASK_STORE_RECORD_INVALID",
          `cycle report has an unusable cycleId: ${JSON.stringify(cycleId)}`,
        );
      }
      for (const result of input.results) {
        const check = validateBrainTaskResultForStorage(result);
        if (!check.valid) {
          throw new BrainTaskStoreError(
            reasonToStoreCode(check.reasonCode),
            `result for ${result.taskId} rejected: ${check.reasonCode}`,
            check.reasonCode,
          );
        }
      }

      const existing = this.loadCycleResults(cycleId);
      const byId = new Map<string, BrainTaskResult>();
      for (const result of existing?.results ?? []) {
        byId.set(brainTaskResultId(result), { ...result, resultId: brainTaskResultId(result) });
      }
      for (const result of input.results) {
        const id = brainTaskResultId(result);
        byId.set(id, { ...result, resultId: id });
      }
      const merged = [...byId.values()].sort((left, right) =>
        (left.resultId ?? "").localeCompare(right.resultId ?? ""),
      );

      const record: BrainCycleResultsRecord = {
        schemaVersion: brainTaskStoreSchemaVersion,
        cycleId,
        savedAt: now().toISOString(),
        report: input.report,
        results: merged,
      };
      writeJsonAtomic(path.join(resultsDir, `${cycleId}.json`), record);
      return record;
    },

    loadCycleResults(cycleId: string): BrainCycleResultsRecord | undefined {
      if (!/^[A-Za-z0-9_-]+$/.test(cycleId)) return undefined;
      const file = path.join(resultsDir, `${cycleId}.json`);
      const parsed = readJson(file, `queue/results/${cycleId}.json`);
      if (parsed === undefined) return undefined;
      const envelope = assertEnvelope(parsed, `queue/results/${cycleId}.json`, [
        "cycleId",
        "report",
        "results",
      ]);
      if (!Array.isArray(envelope.results)) {
        throw new BrainTaskStoreError(
          "BRAIN_TASK_STORE_CORRUPT",
          `queue/results/${cycleId}.json \`results\` is not an array`,
        );
      }
      return {
        schemaVersion: brainTaskStoreSchemaVersion,
        cycleId: String(envelope.cycleId),
        savedAt: typeof envelope.savedAt === "string" ? envelope.savedAt : "",
        report: envelope.report as BrainWorkerCycleReport,
        results: (envelope.results as BrainTaskResult[]).map((result) => ({
          ...result,
          resultId: brainTaskResultId(result),
        })),
      };
    },

    listCycleIds(): readonly string[] {
      if (!fs.existsSync(resultsDir)) return [];
      return fs
        .readdirSync(resultsDir)
        .filter((name) => name.endsWith(".json") && /^[A-Za-z0-9_-]+\.json$/.test(name))
        .map((name) => name.slice(0, -".json".length))
        .sort();
    },
  };

  return handle;
}
