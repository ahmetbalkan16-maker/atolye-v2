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
  type AyasExecutionRequest,
} from "./AyasExecutionPolicy";
import { AYAS_CAPABILITY_MAX_TTL_MS, canonicalAyasCapabilityScope, isAyasCapabilityScope, type AyasCapabilityScope } from "./AyasCapabilityScope";

/**
 * A grant can be minted from a validated read-only `AyasExecutionRequest` or
 * from any deterministic-layer descriptor that supplies its own canonical
 * binding string (the write path uses `canonicalAyasResumeStageRequest`).
 */
export interface AyasExecutionGrantDescriptor {
  readonly action: string;
  readonly requestedBy: string;
  readonly intent: string;
  readonly projectSlug?: string;
  readonly plan?: Readonly<Record<string, unknown>>;
  /** The exact canonical string this grant is bound to. */
  readonly canonical: string;
}

function toDescriptor(
  input: AyasExecutionRequest | AyasExecutionGrantDescriptor,
): AyasExecutionGrantDescriptor {
  if ("canonical" in input) return input;
  return {
    action: input.action,
    requestedBy: input.requestedBy,
    intent: input.intent,
    ...(input.projectSlug ? { projectSlug: input.projectSlug } : {}),
    plan: input.plan,
    canonical: canonicalAyasExecutionRequest(input),
  };
}

export type AyasExecutionAuthorizationErrorCode =
  | "AYAS_EXEC_AUTH_IO"
  | "AYAS_EXEC_AUTH_CORRUPT"
  | "AYAS_EXEC_AUTH_UNKNOWN"
  | "AYAS_EXEC_AUTH_EXPIRED"
  | "AYAS_EXEC_AUTH_REPLAY"
  | "AYAS_EXEC_AUTH_BINDING_MISMATCH"
  | "AYAS_EXEC_AUTH_REVOKED"
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
  | "revoked"
  | "expired";

export interface AyasExecutionAuthorizationRecord {
  readonly schemaVersion: "1";
  readonly authorizationId: string;
  readonly executionId: string;
  readonly requestDigest: string;
  readonly action: string;
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
  /** Optional additive binding. Legacy grants never imply a capability lease. */
  readonly capabilityScope?: AyasCapabilityScope;
  readonly capabilityScopeDigest?: string;
  readonly revokedAt?: string;
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
    if (!Number.isSafeInteger(this.ttlMs) || this.ttlMs <= 0 || this.ttlMs > AYAS_CAPABILITY_MAX_TTL_MS) {
      throw new AyasExecutionAuthorizationError("AYAS_EXEC_AUTH_CORRUPT", "authorization TTL must be a positive integer no greater than five minutes");
    }
  }

  /** Deterministic layer only: mint a single-use grant bound to this exact request. */
  grant(
    input: AyasExecutionRequest | AyasExecutionGrantDescriptor,
    capabilityScope?: AyasCapabilityScope,
  ): AyasExecutionAuthorizationRecord {
    const descriptor = toDescriptor(input);
    if (capabilityScope !== undefined && (!isAyasCapabilityScope(capabilityScope) ||
        capabilityScope.capabilities[0] !== descriptor.action || capabilityScope.resource.requestDigest !== sha256(descriptor.canonical) ||
        capabilityScope.resource.projectSlug !== (descriptor.projectSlug ?? null))) {
      throw new AyasExecutionAuthorizationError("AYAS_EXEC_AUTH_BINDING_MISMATCH", "capability scope does not match the exact request");
    }
    const createdAt = this.now();
    const requestDigest = sha256(descriptor.canonical);
    const executionId = "exec-" + sha256(requestDigest + "|" + createdAt.toISOString()).slice(0, 24);
    const authorizationId = "authz-" + crypto.randomUUID();
    const record: AyasExecutionAuthorizationRecord = {
      schemaVersion: "1",
      authorizationId,
      executionId,
      requestDigest,
      action: descriptor.action,
      requestedBy: descriptor.requestedBy,
      intent: descriptor.intent,
      plan: descriptor.plan ?? {},
      ...(descriptor.projectSlug ? { projectSlug: descriptor.projectSlug } : {}),
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + this.ttlMs).toISOString(),
      state: "granted",
      ...(capabilityScope ? {
        // Snapshot: later changes to a caller's object cannot widen a persisted grant.
        capabilityScope: JSON.parse(JSON.stringify(capabilityScope)) as AyasCapabilityScope,
        capabilityScopeDigest: sha256(canonicalAyasCapabilityScope(capabilityScope)),
      } : {}),
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
  consume(
    authorizationId: string,
    input: AyasExecutionRequest | AyasExecutionGrantDescriptor,
    expectedScope?: AyasCapabilityScope,
  ): AyasExecutionAuthorizationRecord {
    return this.withRecordLock(authorizationId, () => this.consumeLocked(authorizationId, input, expectedScope));
  }

  private consumeLocked(
    authorizationId: string,
    input: AyasExecutionRequest | AyasExecutionGrantDescriptor,
    expectedScope?: AyasCapabilityScope,
  ): AyasExecutionAuthorizationRecord {
    const record = this.read(authorizationId);
    if (record.state === "revoked" || record.revokedAt) {
      throw new AyasExecutionAuthorizationError("AYAS_EXEC_AUTH_REVOKED", "authorization was revoked");
    }
    if (record.state !== "granted") {
      throw new AyasExecutionAuthorizationError(
        "AYAS_EXEC_AUTH_REPLAY",
        `authorization ${authorizationId} is already ${record.state}`,
      );
    }
    if (record.requestDigest !== sha256(toDescriptor(input).canonical)) {
      throw new AyasExecutionAuthorizationError(
        "AYAS_EXEC_AUTH_BINDING_MISMATCH",
        `authorization ${authorizationId} is bound to a different request`,
      );
    }
    if ((record.capabilityScope !== undefined || expectedScope !== undefined) &&
        (!record.capabilityScope || !expectedScope || !isAyasCapabilityScope(expectedScope) ||
        record.capabilityScopeDigest !== sha256(canonicalAyasCapabilityScope(expectedScope)))) {
      throw new AyasExecutionAuthorizationError("AYAS_EXEC_AUTH_BINDING_MISMATCH", "capability run/task/resource binding differs");
    }
    const nowMs = this.now().getTime();
    if (!Number.isFinite(nowMs) || nowMs < Date.parse(record.createdAt)) {
      throw new AyasExecutionAuthorizationError("AYAS_EXEC_AUTH_CORRUPT", "authorization clock is invalid or precedes issuance");
    }
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
    return this.withRecordLock(authorizationId, () => {
      const record = this.read(authorizationId);
      if (record.settledAt !== undefined || (record.state !== "consumed" && !(record.state === "revoked" && record.consumedAt))) {
        throw new AyasExecutionAuthorizationError("AYAS_EXEC_AUTH_REPLAY", "only a consumed authorization can settle");
      }
      const settled: AyasExecutionAuthorizationRecord = {
        ...record,
        state: record.revokedAt ? "revoked" : outcome.ok ? "completed" : "failed",
        settledAt: this.now().toISOString(),
        ...(outcome.ok ? { resultDigest: outcome.resultDigest } : { failureReason: outcome.failureReason }),
      };
      this.update(authorizationId, settled);
      return settled;
    });
  }

  /** Revocation is monotonic. It prevents new admission; it cannot undo an already running effect. */
  revoke(authorizationId: string): AyasExecutionAuthorizationRecord {
    return this.withRecordLock(authorizationId, () => {
      const record = this.read(authorizationId);
      if (record.state === "revoked") return record;
      if (record.state === "completed" || record.state === "failed" || record.state === "expired") {
        throw new AyasExecutionAuthorizationError("AYAS_EXEC_AUTH_REPLAY", "terminal authorization cannot be revoked");
      }
      const revoked = { ...record, state: "revoked" as const, revokedAt: this.now().toISOString() };
      this.update(authorizationId, revoked);
      return revoked;
    });
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
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new AyasExecutionAuthorizationError("AYAS_EXEC_AUTH_CORRUPT", `${authorizationId} is not an object`);
    }
    const r = raw as Record<string, unknown>;
    const states: AyasExecutionAuthorizationState[] = ["granted", "consumed", "completed", "failed", "expired", "revoked"];
    const fields = new Set(["schemaVersion", "authorizationId", "executionId", "requestDigest", "action", "requestedBy", "intent", "plan", "projectSlug", "createdAt", "expiresAt", "state", "consumedAt", "settledAt", "resultDigest", "failureReason", "capabilityScope", "capabilityScopeDigest", "revokedAt"]);
    if (
      Object.keys(r).some((key) => !fields.has(key)) ||
      r.schemaVersion !== "1" ||
      r.authorizationId !== authorizationId ||
      typeof r.executionId !== "string" ||
      typeof r.requestDigest !== "string" ||
      !/^[a-f0-9]{64}$/.test(r.requestDigest) ||
      typeof r.action !== "string" ||
      typeof r.requestedBy !== "string" ||
      typeof r.intent !== "string" ||
      typeof r.createdAt !== "string" ||
      typeof r.expiresAt !== "string" ||
      typeof r.state !== "string" ||
      !states.includes(r.state as AyasExecutionAuthorizationState) ||
      !r.plan || typeof r.plan !== "object" || Array.isArray(r.plan) ||
      !isIso(r.createdAt) || !isIso(r.expiresAt) || Date.parse(r.expiresAt as string) <= Date.parse(r.createdAt as string) ||
      Date.parse(r.expiresAt as string) - Date.parse(r.createdAt as string) > AYAS_CAPABILITY_MAX_TTL_MS ||
      (r.consumedAt !== undefined && !isIso(r.consumedAt)) || (r.revokedAt !== undefined && !isIso(r.revokedAt)) ||
      (r.settledAt !== undefined && !isIso(r.settledAt)) ||
      ((r.state === "consumed" || r.state === "completed" || r.state === "failed") && !isIso(r.consumedAt)) ||
      ((r.state === "completed" || r.state === "failed") && !isIso(r.settledAt)) ||
      (r.state === "granted" && (r.consumedAt !== undefined || r.revokedAt !== undefined || r.settledAt !== undefined)) ||
      (r.state === "revoked" && !isIso(r.revokedAt)) ||
      ((r.capabilityScope !== undefined || r.capabilityScopeDigest !== undefined) &&
        (!isAyasCapabilityScope(r.capabilityScope) || r.capabilityScopeDigest !== sha256(canonicalAyasCapabilityScope(r.capabilityScope)) ||
          r.capabilityScope.resource.requestDigest !== r.requestDigest || r.capabilityScope.capabilities[0] !== r.action ||
          r.capabilityScope.resource.projectSlug !== (r.projectSlug ?? null)))
    ) {
      throw new AyasExecutionAuthorizationError("AYAS_EXEC_AUTH_CORRUPT", `${authorizationId} has an invalid shape`);
    }
    return raw as AyasExecutionAuthorizationRecord;
  }

  /** Same exclusive-create primitive as the existing gate/journal; no wait, stale takeover or second authority store. */
  private withRecordLock<T>(authorizationId: string, operation: () => T): T {
    const lock = this.fileFor(authorizationId) + ".lock";
    this.ensureDir();
    let handle: number;
    try { handle = fs.openSync(lock, "wx"); }
    catch (error) {
      throw new AyasExecutionAuthorizationError((error as NodeJS.ErrnoException).code === "EEXIST" ? "AYAS_EXEC_AUTH_CONFLICT" : "AYAS_EXEC_AUTH_IO", "authorization mutation lock unavailable");
    }
    try { return operation(); }
    finally {
      fs.closeSync(handle);
      fs.unlinkSync(lock);
    }
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

function isIso(value: unknown): boolean {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
