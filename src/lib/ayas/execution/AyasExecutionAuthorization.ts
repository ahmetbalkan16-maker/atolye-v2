/**
 * AYAS Execution Authorization — durable, single-use grants (spec §6, §7, §17).
 *
 *   data/brain/execution/authorizations/<authorizationId>.json
 *
 * A validated `AyasExecutionRequest` (from `AyasExecutionPolicy`) is turned into
 * a durable authorization *only* by the deterministic layer — never by the LLM.
 * Each authorization:
 *  - is bound to the canonical request (`requestDigest`) — a different plan can't reuse it;
 *  - has a hard `expiresAt` (default 5 min) — an expired grant is `AYAS_EXEC_AUTH_EXPIRED`;
 *  - is single-use — `consume` marks it, a second `consume` is `AYAS_EXEC_AUTH_REPLAY`;
 *  - carries the full audit identity (spec §6): `executionId`, `authorizationId`,
 *    `createdAt`, `requestedBy`, `action`, `projectSlug`, `intent`, `plan`, `state`.
 *
 * Written with an exclusive open (`wx`); atomic update via temp→fsync→rename.
 * Corrupt / unknown / expired / replayed → fail closed.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import {
  canonicalAyasExecutionRequest,
  type AyasExecutionActionId,
  type AyasExecutionRequest,
} from "./AyasExecutionPolicy";

export type AyasExecutionAuthorizationErrorCode =
  | "AYAS_EXEC_AUTH_IO"
  | "AYAS_EXEC_AUTH_CORRUPT"
  | "AYAS_EXEC_AUTH_UNKNOWN"
  | "AYAS_EXEC_AUTH_EXPIRED"
  | "AYAS_EXEC_AUTH_REPLAY"
  | "AYAS_EXEC_AUTH_BINDING_MISMATCH"
  | "AYAS_EXEC_AUTH_CONFLICT";

export class AyasExecutionAuthorizationError extends Error {
  constructor(
    readonly code: AyasExecutionAuthorizationErrorCode,
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "AyasExecutionAuthorizationError";
  }
}

export type AyasExecutionAuthorizationState =
  | "granted"
  | "consumed"
  | "completed"
  | "failed"
  | "expired";

export interface AyasExecutionAuthorizationRecord {
  readonly schemaVersion: "1";
  readonly authorizationId: string;
  readonly executionId: string;
  readonly requestDigest: string;
  readonly action: AyasExecutionActionId;
  readonly requestedBy: string;
  readonly intent: string;
  readonly plan: Readonly<Record<string, unknown>>;
  readonly projectSlug?: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly state: AyasExecutionAuthorizationState;
  readonly consumedAt?: string;
  readonly settledAt?: string;
  readonly resultDigest?: string;
  readonly failureReason?: string;
}

export interface AyasExecutionAuthorizationStoreOptions {
  readonly rootDir?: string;
  readonly now?: () => Date;
  readonly ttlMs?: number;
}

const DEFAULT_TTL_MS = 5 * 60 * 1000;

export class AyasExecutionAuthorizationStore {
  private readonly dir: string;
  private readonly now: () => Date;
  private readonly ttlMs: number;

  constructor(options: AyasExecutionAuthorizationStoreOptions = {}) {
    const rootDir = options.rootDir
      ? path.resolve(options.rootDir)
      : path.join(process.cwd(), "data", "brain");
    this.dir = path.join(rootDir, "execution", "authorizations");
    this.now = options.now ?? (() => new Date());
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  }

  /** Deterministic layer only: mint a single-use grant bound to this exact request. */
  grant(request: AyasExecutionRequest): AyasExecutionAuthorizationRecord {
    const createdAt = this.now();
    const requestDigest = sha256(canonicalAyasExecutionRequest(request));
    const executionId = "exec-" + sha256(requestDigest + "|" + createdAt.toISOString()).slice(0, 24);
    const authorizationId = "authz-" + crypto.randomUUID();
    const record: AyasExecutionAuthorizationRecord = {
      schemaVersion: "1",
      authorizationId,
      executionId,
      requestDigest,
      action: request.action,
      requestedBy: request.requestedBy,
      intent: request.intent,
      plan: request.plan,
      ...(request.projectSlug ? { projectSlug: request.projectSlug } : {}),
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + this.ttlMs).toISOString(),
      state: "granted",
    };
    this.ensureDir();
    this.writeExclusive(authorizationId, record);
    return record;
  }

  read(authorizationId: string): AyasExecutionAuthorizationRecord {
    const file = this.fileFor(authorizationId);
    if (!fs.existsSync(file)) {
      throw new AyasExecutionAuthorizationError("AYAS_EXEC_AUTH_UNKNOWN", `no authorization ${authorizationId}`);
    }
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(file, "utf-8"));
    } catch (error) {
      throw new AyasExecutionAuthorizationError(
        "AYAS_EXEC_AUTH_CORRUPT",
        `${authorizationId} is not valid JSON`,
        error instanceof Error ? error.message : String(error),
      );
    }
    return this.validate(raw, authorizationId);
  }

  /**
   * Single-use: verify binding + expiry, mark `consumed`. A second call is a
   * replay. Returns the consumed record.
   */
  consume(authorizationId: string, request: AyasExecutionRequest): AyasExecutionAuthorizationRecord {
    const record = this.read(authorizationId);
    if (record.state !== "granted") {
      throw new AyasExecutionAuthorizationError(
        "AYAS_EXEC_AUTH_REPLAY",
        `authorization ${authorizationId} is already ${record.state}`,
      );
    }
    if (record.requestDigest !== sha256(canonicalAyasExecutionRequest(request))) {
      throw new AyasExecutionAuthorizationError(
        "AYAS_EXEC_AUTH_BINDING_MISMATCH",
        `authorization ${authorizationId} is bound to a different request`,
      );
    }
    const nowMs = this.now().getTime();
    if (nowMs >= Date.parse(record.expiresAt)) {
      this.update(authorizationId, { ...record, state: "expired" });
      throw new AyasExecutionAuthorizationError(
        "AYAS_EXEC_AUTH_EXPIRED",
        `authorization ${authorizationId} expired at ${record.expiresAt}`,
      );
    }
    const consumed: AyasExecutionAuthorizationRecord = {
      ...record,
      state: "consumed",
      consumedAt: this.now().toISOString(),
    };
    this.update(authorizationId, consumed);
    return consumed;
  }

  /** Record the terminal outcome for the audit trail. */
  settle(
    authorizationId: string,
    outcome: { ok: true; resultDigest: string } | { ok: false; failureReason: string },
  ): AyasExecutionAuthorizationRecord {
    const record = this.read(authorizationId);
    const settled: AyasExecutionAuthorizationRecord = {
      ...record,
      state: outcome.ok ? "completed" : "failed",
      settledAt: this.now().toISOString(),
      ...(outcome.ok ? { resultDigest: outcome.resultDigest } : { failureReason: outcome.failureReason }),
    };
    this.update(authorizationId, settled);
    return settled;
  }

  list(): readonly AyasExecutionAuthorizationRecord[] {
    if (!fs.existsSync(this.dir)) return [];
    return fs
      .readdirSync(this.dir)
      .filter((n) => n.endsWith(".json"))
      .map((n) => this.read(n.replace(/\.json$/, "")))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /* ------------------------------------------------------------- internals --- */

  private fileFor(authorizationId: string): string {
    if (!/^authz-[a-zA-Z0-9-]{8,80}$/.test(authorizationId)) {
      throw new AyasExecutionAuthorizationError("AYAS_EXEC_AUTH_UNKNOWN", "malformed authorizationId");
    }
    return path.join(this.dir, `${authorizationId}.json`);
  }

  private ensureDir(): void {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
    } catch (error) {
      throw new AyasExecutionAuthorizationError(
        "AYAS_EXEC_AUTH_IO",
        `cannot create ${this.dir}`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private validate(raw: unknown, authorizationId: string): AyasExecutionAuthorizationRecord {
    if (!raw || typeof raw !== "object") {
      throw new AyasExecutionAuthorizationError("AYAS_EXEC_AUTH_CORRUPT", `${authorizationId} is not an object`);
    }
    const r = raw as Record<string, unknown>;
    const states: AyasExecutionAuthorizationState[] = ["granted", "consumed", "completed", "failed", "expired"];
    if (
      r.schemaVersion !== "1" ||
      r.authorizationId !== authorizationId ||
      typeof r.executionId !== "string" ||
      typeof r.requestDigest !== "string" ||
      typeof r.action !== "string" ||
      typeof r.requestedBy !== "string" ||
      typeof r.createdAt !== "string" ||
      typeof r.expiresAt !== "string" ||
      typeof r.state !== "string" ||
      !states.includes(r.state as AyasExecutionAuthorizationState) ||
      !r.plan || typeof r.plan !== "object"
    ) {
      throw new AyasExecutionAuthorizationError("AYAS_EXEC_AUTH_CORRUPT", `${authorizationId} has an invalid shape`);
    }
    return raw as AyasExecutionAuthorizationRecord;
  }

  private writeExclusive(authorizationId: string, record: AyasExecutionAuthorizationRecord): void {
    const file = this.fileFor(authorizationId);
    try {
      const handle = fs.openSync(file, "wx");
      try {
        fs.writeFileSync(handle, `${JSON.stringify(record, null, 2)}\n`, "utf-8");
        fs.fsyncSync(handle);
      } finally {
        fs.closeSync(handle);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "EEXIST") {
        throw new AyasExecutionAuthorizationError("AYAS_EXEC_AUTH_CONFLICT", `${authorizationId} already exists`);
      }
      throw new AyasExecutionAuthorizationError(
        "AYAS_EXEC_AUTH_IO",
        `cannot write ${authorizationId}`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private update(authorizationId: string, record: AyasExecutionAuthorizationRecord): void {
    const file = this.fileFor(authorizationId);
    const tmp = path.join(this.dir, `.${authorizationId}.${process.pid}.${crypto.randomUUID()}.tmp`);
    try {
      const handle = fs.openSync(tmp, "w");
      try {
        fs.writeFileSync(handle, `${JSON.stringify(record, null, 2)}\n`, "utf-8");
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
      throw new AyasExecutionAuthorizationError(
        "AYAS_EXEC_AUTH_IO",
        `cannot update ${authorizationId}`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}
