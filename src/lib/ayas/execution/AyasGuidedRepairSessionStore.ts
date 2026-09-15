/**
 * AYAS Durable Guided-Repair Session Persistence (Durable Workflow / Schema-Bound Planner sprint).
 *
 *   data/brain/execution/repair-sessions/<sessionId>.json
 *     { storeSchemaVersion, sessionId, workspaceId, updatedAt, pending }
 *
 * Same atomic-write / corrupt-fail-closed idiom as `AyasDeveloperWorkflowStore.ts`
 * (itself mirroring `AyasExecutionGateStore.ts`) — a third application of the
 * one proven pattern, not a new one.
 *
 * Deliberately does NOT duplicate the full `AyasDeveloperWorkflow` object:
 * a pending repair's `workflow` (when one exists) is referenced here by its
 * `workflowId` only — the workflow's own full state (history, repairHistory,
 * budgets) already lives durably in `AyasDeveloperWorkflowStore`, which is
 * the single source of truth for it. Recovery loads both and reunites them
 * (`AyasDurableGuidedRepairSessionRuntime`) rather than trusting two
 * divergent copies of the same object (Phase 15 — bounded, non-duplicated
 * evidence retention).
 *
 * `sessionId` here is the SAME sha256-hex session key the product route
 * already derives from the session cookie (`app/api/ayas/chat/stream/route.ts`)
 * — never a raw cookie value, never a secret.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import type { AyasRepairProposal, AyasPatch } from "./AyasGuidedRepair";
import { isAyasRepairProposalAuthentic } from "./AyasGuidedRepair";
import { isValidAyasWorkflowId } from "./AyasDeveloperWorkflowStore";

export type AyasRepairSessionStoreErrorCode =
  | "AYAS_REPAIR_SESSION_STORE_IO"
  | "AYAS_REPAIR_SESSION_STORE_CORRUPT"
  | "AYAS_REPAIR_SESSION_STORE_UNSUPPORTED_SCHEMA"
  | "AYAS_REPAIR_SESSION_STORE_INVALID_ID"
  | "AYAS_REPAIR_SESSION_STORE_OVERSIZE";

export class AyasRepairSessionStoreError extends Error {
  constructor(
    readonly code: AyasRepairSessionStoreErrorCode,
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "AyasRepairSessionStoreError";
  }
}

export const ayasRepairSessionStoreSchemaVersion = "1" as const;

export interface AyasRepairSessionPending {
  readonly proposal: AyasRepairProposal;
  readonly patches: readonly AyasPatch[];
  readonly remediationPatches?: readonly AyasPatch[];
  /** Reference only — the full workflow lives in `AyasDeveloperWorkflowStore`. */
  readonly workflowId?: string;
  readonly createdAtMs: number;
}

export interface AyasRepairSessionRecord {
  readonly storeSchemaVersion: typeof ayasRepairSessionStoreSchemaVersion;
  readonly sessionId: string;
  readonly workspaceId: string;
  readonly updatedAt: string;
  readonly pending: AyasRepairSessionPending | null;
}

export interface AyasRepairSessionStoreOptions {
  readonly rootDir?: string;
  readonly now?: () => Date;
  readonly maxRecordBytes?: number;
}

/** A sha256 hex digest (the product route's own session-key shape) OR a plain safe id — never a raw path segment. */
const SESSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const DEFAULT_MAX_RECORD_BYTES = 1_000_000;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isValidAyasRepairSessionId(value: unknown): value is string {
  return typeof value === "string" && SESSION_ID_RE.test(value) && !value.includes("..");
}

export class AyasGuidedRepairSessionStore {
  private readonly dir: string;
  private readonly now: () => Date;
  private readonly maxRecordBytes: number;

  constructor(options: AyasRepairSessionStoreOptions = {}) {
    const rootDir = options.rootDir ? path.resolve(options.rootDir) : path.join(process.cwd(), "data", "brain");
    this.dir = path.join(rootDir, "execution", "repair-sessions");
    this.now = options.now ?? (() => new Date());
    this.maxRecordBytes = options.maxRecordBytes ?? DEFAULT_MAX_RECORD_BYTES;
  }

  get directory(): string {
    return this.dir;
  }

  private fileFor(sessionId: string): string {
    if (!isValidAyasRepairSessionId(sessionId)) {
      throw new AyasRepairSessionStoreError("AYAS_REPAIR_SESSION_STORE_INVALID_ID", `"${String(sessionId)}" is not a safe session id`);
    }
    const file = path.join(this.dir, `${sessionId}.json`);
    const relative = path.relative(this.dir, file);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new AyasRepairSessionStoreError("AYAS_REPAIR_SESSION_STORE_INVALID_ID", "session id resolved outside the session store directory");
    }
    return file;
  }

  tryLoad(sessionId: string): AyasRepairSessionRecord | undefined {
    const file = this.fileFor(sessionId);
    if (!fs.existsSync(file)) return undefined;
    return this.readAndValidate(file);
  }

  save(sessionId: string, workspaceId: string, pending: AyasRepairSessionPending | undefined): AyasRepairSessionRecord {
    const file = this.fileFor(sessionId);
    if (pending?.workflowId !== undefined && !isValidAyasWorkflowId(pending.workflowId)) {
      throw new AyasRepairSessionStoreError("AYAS_REPAIR_SESSION_STORE_CORRUPT", "pending.workflowId is not a safe workflow id");
    }
    const record: AyasRepairSessionRecord = {
      storeSchemaVersion: ayasRepairSessionStoreSchemaVersion,
      sessionId,
      workspaceId,
      updatedAt: this.now().toISOString(),
      pending: pending ?? null,
    };
    const serialized = JSON.stringify(record, null, 2);
    if (Buffer.byteLength(serialized, "utf8") > this.maxRecordBytes) {
      throw new AyasRepairSessionStoreError("AYAS_REPAIR_SESSION_STORE_OVERSIZE", `session ${sessionId} record exceeds ${this.maxRecordBytes} bytes`);
    }
    this.writeAtomic(file, serialized);
    return record;
  }

  clear(sessionId: string): void {
    const file = this.fileFor(sessionId);
    try {
      fs.rmSync(file, { force: true });
    } catch (error) {
      throw new AyasRepairSessionStoreError("AYAS_REPAIR_SESSION_STORE_IO", `cannot delete ${file}`, error instanceof Error ? error.message : String(error));
    }
  }

  /* ------------------------------------------------------------- internals --- */

  private readAndValidate(file: string): AyasRepairSessionRecord {
    let raw: string;
    try {
      raw = fs.readFileSync(file, "utf-8");
    } catch (error) {
      throw new AyasRepairSessionStoreError("AYAS_REPAIR_SESSION_STORE_IO", `cannot read ${file}`, error instanceof Error ? error.message : String(error));
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new AyasRepairSessionStoreError("AYAS_REPAIR_SESSION_STORE_CORRUPT", `${file} is not valid JSON — refusing to touch it`, error instanceof Error ? error.message : String(error));
    }
    return validateRepairSessionRecord(parsed, file);
  }

  private writeAtomic(file: string, serialized: string): void {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
    } catch (error) {
      throw new AyasRepairSessionStoreError("AYAS_REPAIR_SESSION_STORE_IO", `cannot create ${this.dir}`, error instanceof Error ? error.message : String(error));
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
      throw new AyasRepairSessionStoreError("AYAS_REPAIR_SESSION_STORE_IO", `cannot write ${file}`, error instanceof Error ? error.message : String(error));
    }
  }
}

export function validateRepairSessionRecord(raw: unknown, sourceLabel = "session-record"): AyasRepairSessionRecord {
  if (!isPlainObject(raw)) throw new AyasRepairSessionStoreError("AYAS_REPAIR_SESSION_STORE_CORRUPT", `${sourceLabel} is not an object`);
  if (raw.storeSchemaVersion !== ayasRepairSessionStoreSchemaVersion) {
    throw new AyasRepairSessionStoreError("AYAS_REPAIR_SESSION_STORE_UNSUPPORTED_SCHEMA", `${sourceLabel} storeSchemaVersion is ${String(raw.storeSchemaVersion)}, expected ${ayasRepairSessionStoreSchemaVersion}`);
  }
  if (!isValidAyasRepairSessionId(raw.sessionId)) throw new AyasRepairSessionStoreError("AYAS_REPAIR_SESSION_STORE_CORRUPT", `${sourceLabel} sessionId is invalid`);
  if (typeof raw.workspaceId !== "string" || !raw.workspaceId.trim()) throw new AyasRepairSessionStoreError("AYAS_REPAIR_SESSION_STORE_CORRUPT", `${sourceLabel} workspaceId is invalid`);
  if (typeof raw.updatedAt !== "string" || Number.isNaN(Date.parse(raw.updatedAt))) throw new AyasRepairSessionStoreError("AYAS_REPAIR_SESSION_STORE_CORRUPT", `${sourceLabel} updatedAt is invalid`);
  if (raw.pending !== null) {
    if (!isPlainObject(raw.pending)) throw new AyasRepairSessionStoreError("AYAS_REPAIR_SESSION_STORE_CORRUPT", `${sourceLabel} pending is invalid`);
    const pending = raw.pending as Record<string, unknown>;
    if (!isPlainObject(pending.proposal)) throw new AyasRepairSessionStoreError("AYAS_REPAIR_SESSION_STORE_CORRUPT", `${sourceLabel} pending.proposal is invalid`);
    if (!isAyasRepairProposalAuthentic(pending.proposal as unknown as AyasRepairProposal)) {
      throw new AyasRepairSessionStoreError("AYAS_REPAIR_SESSION_STORE_CORRUPT", `${sourceLabel} pending.proposal fingerprint mismatch`);
    }
    if (!Array.isArray(pending.patches)) throw new AyasRepairSessionStoreError("AYAS_REPAIR_SESSION_STORE_CORRUPT", `${sourceLabel} pending.patches is invalid`);
    if (pending.remediationPatches !== undefined && !Array.isArray(pending.remediationPatches)) throw new AyasRepairSessionStoreError("AYAS_REPAIR_SESSION_STORE_CORRUPT", `${sourceLabel} pending.remediationPatches is invalid`);
    if (pending.workflowId !== undefined && !isValidAyasWorkflowId(pending.workflowId)) throw new AyasRepairSessionStoreError("AYAS_REPAIR_SESSION_STORE_CORRUPT", `${sourceLabel} pending.workflowId is invalid`);
    if (typeof pending.createdAtMs !== "number" || !Number.isSafeInteger(pending.createdAtMs) || pending.createdAtMs < 0) throw new AyasRepairSessionStoreError("AYAS_REPAIR_SESSION_STORE_CORRUPT", `${sourceLabel} pending.createdAtMs is invalid`);
  }
  return {
    storeSchemaVersion: ayasRepairSessionStoreSchemaVersion,
    sessionId: raw.sessionId,
    workspaceId: raw.workspaceId,
    updatedAt: raw.updatedAt,
    pending: raw.pending as AyasRepairSessionPending | null,
  };
}
