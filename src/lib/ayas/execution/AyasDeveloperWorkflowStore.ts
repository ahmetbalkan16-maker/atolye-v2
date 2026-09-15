/**
 * AYAS Durable Workflow Persistence (Durable Workflow / Schema-Bound Planner sprint).
 *
 *   data/brain/execution/workflows/<workflowId>.json   { storeSchemaVersion, workflowId, revision, updatedAt, workflow }
 *
 * Mirrors `AyasExecutionGateStore.ts`'s proven durability idiom exactly — this
 * is NOT a new persistence abstraction, it is the same one applied to a
 * second record type:
 *
 *  - **Fail-closed on read.** A missing file is a normal "not found" (the
 *    caller decides what that means); a malformed/corrupt file throws a
 *    typed error and is NEVER auto-repaired or silently reinterpreted.
 *  - **Atomic write.** temp file (pid+uuid suffix) → `fsync` → `rename`, the
 *    same idiom as `AyasExecutionGateStore`/`BrainTaskStore`.
 *  - **Optimistic concurrency.** `save({ expectedRevision })` refuses a stale
 *    caller (`AYAS_WORKFLOW_STORE_REVISION_CONFLICT`) — the smallest
 *    protection against two processes/sessions resuming the same workflow
 *    concurrently (Phase 28) without a distributed lock.
 *  - **Schema-versioned.** An unsupported `storeSchemaVersion` or an
 *    unsupported `workflow.schemaVersion` both fail closed
 *    (`AYAS_WORKFLOW_STORE_UNSUPPORTED_SCHEMA`) rather than being
 *    reinterpreted.
 *  - **Deep-validated.** Every persisted field the recovery layer would rely
 *    on is checked on read: workflow id shape, state, budget/usage shape AND
 *    usage-never-exceeds-ceiling, step/dependency structure (delegated to
 *    the existing `validateAyasDeveloperWorkflowPlan`, not re-implemented),
 *    and — for any repair-kind step — the proposal's own fingerprint
 *    authenticity (`isAyasRepairProposalAuthentic`, reused, not
 *    re-implemented).
 *  - **Bounded.** Oversize records are rejected on write (defense in depth —
 *    the workflow's own `budget.maxOutputChars` already bounds this in
 *    normal operation, but a corrupted/tampered record could claim
 *    otherwise).
 *  - **Storage-path-safe.** A workflow id is validated against a strict
 *    pattern before it is ever used to build a filesystem path — it can
 *    never traverse, escape the store directory, or be absolute.
 *
 * This store persists NO secrets and no raw environment: `AyasDeveloperWorkflow`
 * already carries only structured plan/result/evidence data (see that file's
 * own doc comment) — the store is a byte-for-byte durable mirror of that
 * object, nothing more.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import { validateAyasDeveloperWorkflowPlan, type AyasDeveloperWorkflow, type AyasWorkflowState, type AyasWorkflowStepState } from "./AyasDeveloperWorkflow";
import { isAyasRepairProposalAuthentic } from "./AyasGuidedRepair";

export type AyasWorkflowStoreErrorCode =
  | "AYAS_WORKFLOW_STORE_IO"
  | "AYAS_WORKFLOW_STORE_CORRUPT"
  | "AYAS_WORKFLOW_STORE_UNSUPPORTED_SCHEMA"
  | "AYAS_WORKFLOW_STORE_INVALID_ID"
  | "AYAS_WORKFLOW_STORE_OVERSIZE"
  | "AYAS_WORKFLOW_STORE_REVISION_CONFLICT";

export class AyasWorkflowStoreError extends Error {
  constructor(
    readonly code: AyasWorkflowStoreErrorCode,
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "AyasWorkflowStoreError";
  }
}

export const ayasWorkflowStoreSchemaVersion = "1" as const;

export interface AyasWorkflowStoreRecord {
  readonly storeSchemaVersion: typeof ayasWorkflowStoreSchemaVersion;
  readonly workflowId: string;
  /** Monotonic per-workflow revision — the CAS guard for `save({ expectedRevision })`. */
  readonly revision: number;
  readonly updatedAt: string;
  readonly workflow: AyasDeveloperWorkflow;
}

export interface AyasWorkflowStoreOptions {
  readonly rootDir?: string;
  readonly now?: () => Date;
  /** Defense in depth — the workflow's own budget already bounds normal growth. */
  readonly maxRecordBytes?: number;
}

/** Same shape discipline as `AyasExecutionPolicy.ts`'s project-slug validation — a workflow id is never trusted as a raw path segment. */
const WORKFLOW_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const WORKFLOW_STATES: readonly AyasWorkflowState[] = ["planned", "running", "awaiting-authorization", "validating", "succeeded", "failed", "rejected", "budget-exhausted", "repair-non-convergent", "cancelled"];
const STEP_STATES: readonly AyasWorkflowStepState[] = ["pending", "ready", "running", "awaiting-authorization", "succeeded", "failed", "rejected", "skipped"];
const BUDGET_KEYS = ["maxSteps", "maxActions", "maxGraphifyQueries", "maxValidations", "maxRepairAttempts", "maxWrites", "maxReadRetries", "maxOutputChars"] as const;
/** `AyasWorkflowUsage` key → the budget ceiling key it must never exceed. */
const USAGE_CEILING_MAP: Readonly<Record<string, (typeof BUDGET_KEYS)[number]>> = Object.freeze({
  actions: "maxActions", graphifyQueries: "maxGraphifyQueries", validations: "maxValidations",
  repairAttempts: "maxRepairAttempts", writes: "maxWrites", readRetries: "maxReadRetries", outputChars: "maxOutputChars",
});
const DEFAULT_MAX_RECORD_BYTES = 2_000_000;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validated once, reused by every caller that needs a filesystem-safe workflow id. */
export function isValidAyasWorkflowId(value: unknown): value is string {
  return typeof value === "string" && WORKFLOW_ID_RE.test(value) && !value.includes("..");
}

export class AyasDeveloperWorkflowStore {
  private readonly dir: string;
  private readonly now: () => Date;
  private readonly maxRecordBytes: number;

  constructor(options: AyasWorkflowStoreOptions = {}) {
    const rootDir = options.rootDir ? path.resolve(options.rootDir) : path.join(process.cwd(), "data", "brain");
    this.dir = path.join(rootDir, "execution", "workflows");
    this.now = options.now ?? (() => new Date());
    this.maxRecordBytes = options.maxRecordBytes ?? DEFAULT_MAX_RECORD_BYTES;
  }

  get directory(): string {
    return this.dir;
  }

  private fileFor(workflowId: string): string {
    if (!isValidAyasWorkflowId(workflowId)) {
      throw new AyasWorkflowStoreError("AYAS_WORKFLOW_STORE_INVALID_ID", `"${String(workflowId)}" is not a safe workflow id`);
    }
    const file = path.join(this.dir, `${workflowId}.json`);
    // Belt-and-suspenders: the resolved path must stay inside the store directory.
    const relative = path.relative(this.dir, file);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new AyasWorkflowStoreError("AYAS_WORKFLOW_STORE_INVALID_ID", "workflow id resolved outside the workflow store directory");
    }
    return file;
  }

  /** `undefined` when no record exists yet — never a thrown "not found". */
  tryLoad(workflowId: string): AyasWorkflowStoreRecord | undefined {
    const file = this.fileFor(workflowId);
    if (!fs.existsSync(file)) return undefined;
    return this.readAndValidate(file);
  }

  /** Throws `AYAS_WORKFLOW_STORE_IO` (as "not found" detail) when absent — used where absence is itself an error for the caller. */
  load(workflowId: string): AyasWorkflowStoreRecord {
    const record = this.tryLoad(workflowId);
    if (!record) throw new AyasWorkflowStoreError("AYAS_WORKFLOW_STORE_IO", `no persisted workflow "${workflowId}"`);
    return record;
  }

  /** Every persisted workflow id (unvalidated — corrupt entries are reported by `tryLoad`, not silently skipped). */
  list(): readonly string[] {
    if (!fs.existsSync(this.dir)) return [];
    let names: string[];
    try {
      names = fs.readdirSync(this.dir);
    } catch (error) {
      throw new AyasWorkflowStoreError("AYAS_WORKFLOW_STORE_IO", `cannot read ${this.dir}`, error instanceof Error ? error.message : String(error));
    }
    return names.filter((n) => n.endsWith(".json")).map((n) => n.slice(0, -".json".length));
  }

  /**
   * Persists a checkpoint. `expectedRevision`, when supplied, must equal the
   * currently persisted revision (0 for "no record yet") — a stale caller
   * (e.g. a second process resuming the same workflow) is refused rather
   * than silently overwriting newer state (Phase 28).
   */
  save(workflow: AyasDeveloperWorkflow, options: { readonly expectedRevision?: number } = {}): AyasWorkflowStoreRecord {
    const file = this.fileFor(workflow.workflowId);
    const current = fs.existsSync(file) ? this.readAndValidate(file) : undefined;
    const currentRevision = current?.revision ?? 0;
    if (options.expectedRevision !== undefined && options.expectedRevision !== currentRevision) {
      throw new AyasWorkflowStoreError(
        "AYAS_WORKFLOW_STORE_REVISION_CONFLICT",
        `expected revision ${options.expectedRevision} but the store is at ${currentRevision}`,
        `workflow ${workflow.workflowId} was updated by another writer`,
      );
    }
    const record: AyasWorkflowStoreRecord = {
      storeSchemaVersion: ayasWorkflowStoreSchemaVersion,
      workflowId: workflow.workflowId,
      revision: currentRevision + 1,
      updatedAt: this.now().toISOString(),
      workflow: structuredClone(workflow),
    };
    const serialized = JSON.stringify(record, null, 2);
    if (Buffer.byteLength(serialized, "utf8") > this.maxRecordBytes) {
      throw new AyasWorkflowStoreError("AYAS_WORKFLOW_STORE_OVERSIZE", `workflow ${workflow.workflowId} record exceeds ${this.maxRecordBytes} bytes`);
    }
    this.writeAtomic(file, serialized);
    return record;
  }

  delete(workflowId: string): void {
    const file = this.fileFor(workflowId);
    try {
      fs.rmSync(file, { force: true });
    } catch (error) {
      throw new AyasWorkflowStoreError("AYAS_WORKFLOW_STORE_IO", `cannot delete ${file}`, error instanceof Error ? error.message : String(error));
    }
  }

  /* ------------------------------------------------------------- internals --- */

  private readAndValidate(file: string): AyasWorkflowStoreRecord {
    let raw: string;
    try {
      raw = fs.readFileSync(file, "utf-8");
    } catch (error) {
      throw new AyasWorkflowStoreError("AYAS_WORKFLOW_STORE_IO", `cannot read ${file}`, error instanceof Error ? error.message : String(error));
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new AyasWorkflowStoreError("AYAS_WORKFLOW_STORE_CORRUPT", `${file} is not valid JSON — refusing to touch it`, error instanceof Error ? error.message : String(error));
    }
    return validateWorkflowStoreRecord(parsed, file);
  }

  private writeAtomic(file: string, serialized: string): void {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
    } catch (error) {
      throw new AyasWorkflowStoreError("AYAS_WORKFLOW_STORE_IO", `cannot create ${this.dir}`, error instanceof Error ? error.message : String(error));
    }
    const tmp = path.join(this.dir, `.${path.basename(file)}.${process.pid}.${crypto.randomUUID()}.tmp`);
    try {
      const handle = fs.openSync(tmp, "w");
      try {
        fs.writeFileSync(handle, `${serialized}\n`, "utf-8");
        fs.fsyncSync(handle);
      } finally {
        fs.closeSync(handle);
      }
      fs.renameSync(tmp, file);
    } catch (error) {
      try {
        fs.rmSync(tmp, { force: true });
      } catch {
        /* ignore */
      }
      throw new AyasWorkflowStoreError("AYAS_WORKFLOW_STORE_IO", `cannot write ${file}`, error instanceof Error ? error.message : String(error));
    }
  }
}

/**
 * Deep validation of a persisted record — exported so the recovery layer and
 * tests can validate a raw fixture without going through the filesystem.
 * Fails closed: any unrecognised shape throws, never "best-effort repaired".
 */
export function validateWorkflowStoreRecord(raw: unknown, sourceLabel = "record"): AyasWorkflowStoreRecord {
  if (!isPlainObject(raw)) throw new AyasWorkflowStoreError("AYAS_WORKFLOW_STORE_CORRUPT", `${sourceLabel} is not an object`);
  if (raw.storeSchemaVersion !== ayasWorkflowStoreSchemaVersion) {
    throw new AyasWorkflowStoreError("AYAS_WORKFLOW_STORE_UNSUPPORTED_SCHEMA", `${sourceLabel} storeSchemaVersion is ${String(raw.storeSchemaVersion)}, expected ${ayasWorkflowStoreSchemaVersion}`);
  }
  if (!isValidAyasWorkflowId(raw.workflowId)) throw new AyasWorkflowStoreError("AYAS_WORKFLOW_STORE_CORRUPT", `${sourceLabel} workflowId is invalid`);
  if (typeof raw.revision !== "number" || !Number.isSafeInteger(raw.revision) || raw.revision < 1) {
    throw new AyasWorkflowStoreError("AYAS_WORKFLOW_STORE_CORRUPT", `${sourceLabel} revision is invalid`);
  }
  if (typeof raw.updatedAt !== "string" || Number.isNaN(Date.parse(raw.updatedAt))) {
    throw new AyasWorkflowStoreError("AYAS_WORKFLOW_STORE_CORRUPT", `${sourceLabel} updatedAt is invalid`);
  }
  const workflow = validateWorkflowShape(raw.workflow, sourceLabel);
  if (workflow.workflowId !== raw.workflowId) {
    throw new AyasWorkflowStoreError("AYAS_WORKFLOW_STORE_CORRUPT", `${sourceLabel} envelope/workflow id mismatch`);
  }
  return {
    storeSchemaVersion: ayasWorkflowStoreSchemaVersion,
    workflowId: raw.workflowId,
    revision: raw.revision,
    updatedAt: raw.updatedAt,
    workflow,
  };
}

/** Structural validation of the `AyasDeveloperWorkflow` payload itself. Reuses `validateAyasDeveloperWorkflowPlan` and `isAyasRepairProposalAuthentic` rather than re-implementing their checks. */
export function validateWorkflowShape(raw: unknown, sourceLabel = "workflow"): AyasDeveloperWorkflow {
  if (!isPlainObject(raw)) throw new AyasWorkflowStoreError("AYAS_WORKFLOW_STORE_CORRUPT", `${sourceLabel}.workflow is not an object`);
  if (raw.schemaVersion !== "1") {
    throw new AyasWorkflowStoreError("AYAS_WORKFLOW_STORE_UNSUPPORTED_SCHEMA", `${sourceLabel}.workflow.schemaVersion is ${String(raw.schemaVersion)}, expected "1"`);
  }
  if (!isValidAyasWorkflowId(raw.workflowId)) throw new AyasWorkflowStoreError("AYAS_WORKFLOW_STORE_CORRUPT", `${sourceLabel}.workflow.workflowId is invalid`);
  if (raw.kind !== "developer" && raw.kind !== "automatic-repair") throw new AyasWorkflowStoreError("AYAS_WORKFLOW_STORE_CORRUPT", `${sourceLabel}.workflow.kind is invalid`);
  if (typeof raw.goal !== "string" || !raw.goal.trim()) throw new AyasWorkflowStoreError("AYAS_WORKFLOW_STORE_CORRUPT", `${sourceLabel}.workflow.goal is invalid`);
  if (typeof raw.createdAt !== "string" || Number.isNaN(Date.parse(raw.createdAt))) throw new AyasWorkflowStoreError("AYAS_WORKFLOW_STORE_CORRUPT", `${sourceLabel}.workflow.createdAt is invalid`);
  if (typeof raw.state !== "string" || !WORKFLOW_STATES.includes(raw.state as AyasWorkflowState)) throw new AyasWorkflowStoreError("AYAS_WORKFLOW_STORE_CORRUPT", `${sourceLabel}.workflow.state is invalid`);
  if (!Array.isArray(raw.steps) || raw.steps.length === 0) throw new AyasWorkflowStoreError("AYAS_WORKFLOW_STORE_CORRUPT", `${sourceLabel}.workflow.steps is invalid`);
  if (!isPlainObject(raw.budget)) throw new AyasWorkflowStoreError("AYAS_WORKFLOW_STORE_CORRUPT", `${sourceLabel}.workflow.budget is invalid`);
  for (const key of BUDGET_KEYS) {
    const value = (raw.budget as Record<string, unknown>)[key];
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
      throw new AyasWorkflowStoreError("AYAS_WORKFLOW_STORE_CORRUPT", `${sourceLabel}.workflow.budget.${key} is invalid`);
    }
  }
  if (!isPlainObject(raw.usage)) throw new AyasWorkflowStoreError("AYAS_WORKFLOW_STORE_CORRUPT", `${sourceLabel}.workflow.usage is invalid`);
  const budget = raw.budget as Record<string, number>;
  const usage = raw.usage as Record<string, unknown>;
  for (const [usageKey, ceilingKey] of Object.entries(USAGE_CEILING_MAP)) {
    const value = usage[usageKey];
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
      throw new AyasWorkflowStoreError("AYAS_WORKFLOW_STORE_CORRUPT", `${sourceLabel}.workflow.usage.${usageKey} is invalid`);
    }
    // Impossible usage > ceiling combinations must fail closed, not be
    // silently clamped or trusted (Phase 5).
    if (value > budget[ceilingKey]!) {
      throw new AyasWorkflowStoreError("AYAS_WORKFLOW_STORE_CORRUPT", `${sourceLabel}.workflow.usage.${usageKey} (${value}) exceeds budget.${ceilingKey} (${budget[ceilingKey]})`);
    }
  }
  if (!Array.isArray(raw.history)) throw new AyasWorkflowStoreError("AYAS_WORKFLOW_STORE_CORRUPT", `${sourceLabel}.workflow.history is invalid`);
  if (!Array.isArray(raw.repairHistory)) throw new AyasWorkflowStoreError("AYAS_WORKFLOW_STORE_CORRUPT", `${sourceLabel}.workflow.repairHistory is invalid`);
  const stepRecords = (raw.steps as unknown[]).map((entry, index) => validateStepRecordShape(entry, `${sourceLabel}.workflow.steps[${index}]`));

  // Structural step/dependency/kind-action/budget-ceiling correctness is
  // ALREADY fully implemented by the runtime's own plan validator — reused
  // here rather than re-checked by hand, so the two can never drift apart.
  const planCheck = validateAyasDeveloperWorkflowPlan({ kind: raw.kind, goal: raw.goal, steps: stepRecords.map((r) => r.step), budget: raw.budget as never });
  if (!planCheck.ok) {
    throw new AyasWorkflowStoreError("AYAS_WORKFLOW_STORE_CORRUPT", `${sourceLabel}.workflow steps/dependencies invalid: ${planCheck.failure.detail}`);
  }
  // Any repair-kind step's proposal must still hash-authenticate — a
  // tampered/hand-edited proposal is corruption, not a legitimate replan.
  for (const record of stepRecords) {
    if (record.step.kind === "repair" && !isAyasRepairProposalAuthentic(record.step.proposal)) {
      throw new AyasWorkflowStoreError("AYAS_WORKFLOW_STORE_CORRUPT", `${sourceLabel}.workflow step "${record.step.id}" proposal fingerprint mismatch`);
    }
  }

  return raw as unknown as AyasDeveloperWorkflow;
}

function validateStepRecordShape(raw: unknown, sourceLabel: string): { readonly step: AyasDeveloperWorkflow["steps"][number]["step"] } {
  if (!isPlainObject(raw)) throw new AyasWorkflowStoreError("AYAS_WORKFLOW_STORE_CORRUPT", `${sourceLabel} is not an object`);
  if (typeof raw.state !== "string" || !STEP_STATES.includes(raw.state as AyasWorkflowStepState)) throw new AyasWorkflowStoreError("AYAS_WORKFLOW_STORE_CORRUPT", `${sourceLabel}.state is invalid`);
  if (typeof raw.attempts !== "number" || !Number.isInteger(raw.attempts) || raw.attempts < 0) throw new AyasWorkflowStoreError("AYAS_WORKFLOW_STORE_CORRUPT", `${sourceLabel}.attempts is invalid`);
  if (!isPlainObject(raw.step)) throw new AyasWorkflowStoreError("AYAS_WORKFLOW_STORE_CORRUPT", `${sourceLabel}.step is invalid`);
  const step = raw.step as Record<string, unknown>;
  if (typeof step.id !== "string" || !step.id.trim()) throw new AyasWorkflowStoreError("AYAS_WORKFLOW_STORE_CORRUPT", `${sourceLabel}.step.id is invalid`);
  if (step.kind !== "read" && step.kind !== "graphify" && step.kind !== "validation" && step.kind !== "repair") {
    throw new AyasWorkflowStoreError("AYAS_WORKFLOW_STORE_CORRUPT", `${sourceLabel}.step.kind is invalid`);
  }
  if (step.kind === "repair") {
    if (!isPlainObject(step.proposal) || !Array.isArray(step.patches)) throw new AyasWorkflowStoreError("AYAS_WORKFLOW_STORE_CORRUPT", `${sourceLabel}.step repair proposal/patches missing`);
  } else if (!isPlainObject(step.request) || typeof (step.request as Record<string, unknown>).action !== "string") {
    throw new AyasWorkflowStoreError("AYAS_WORKFLOW_STORE_CORRUPT", `${sourceLabel}.step request/action missing`);
  }
  return { step: step as never };
}
