import crypto from "node:crypto";
import path from "node:path";
import { AYAS_EXECUTION_ALLOWLIST, canonicalAyasExecutionRequest, type AyasExecutionRequest } from "./AyasExecutionPolicy";

/** Data contract only. A parsed scope is never an issuer, owner approval or lease handle. */
export const AYAS_CAPABILITY_MAX_TTL_MS = 5 * 60 * 1000;
export type AyasActionFirewallDecision = "ALLOW_READ" | "ALLOW_BOUNDED_LOCAL" | "REQUIRE_OWNER" | "DENY";
export type AyasActionClassification = "READ" | "BOUNDED_LOCAL" | "WRITE" | "FINANCIAL" | "PRODUCTION";

export interface AyasCapabilityScope {
  readonly schemaVersion: "1";
  readonly agentId: "ayas-server";
  readonly runId: string;
  readonly taskId: string;
  /** Built-in delegation permits the existing local allowlist only; this is NOT an owner identity. */
  readonly ownerId: null;
  readonly delegationId: "builtin-bounded-local-v1";
  readonly capabilities: readonly [AyasExecutionRequest["action"]];
  readonly resource: {
    readonly repoRoot: string;
    readonly resourceRoot: string;
    readonly platform: "LOCAL";
    readonly requestDigest: string;
    readonly projectSlug: string | null;
  };
  readonly costClass: "ZERO_LOCAL";
  readonly classification: "READ" | "BOUNDED_LOCAL";
}

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
/** LOCAL/ZERO_LOCAL does not cover an undeclared network share or device namespace. */
export function isAyasLocalCapabilityRoot(value: unknown): value is string {
  return typeof value === "string" && value.length <= 4096 && !value.includes("\0") &&
    !value.startsWith("\\\\") && !value.startsWith("//") && path.isAbsolute(value) && path.resolve(value) === value;
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

/** Closed registry classification: process-based validation is bounded local, despite historical write=false. */
export function ayasLocalActionClassification(action: string): "READ" | "BOUNDED_LOCAL" | undefined {
  if (!Object.hasOwn(AYAS_EXECUTION_ALLOWLIST, action)) return undefined;
  const spec = AYAS_EXECUTION_ALLOWLIST[action as AyasExecutionRequest["action"]];
  if (spec.write !== false || spec.destructive !== false) return undefined;
  return action === "run-developer-validation" ? "BOUNDED_LOCAL" : "READ";
}

export function isAyasCapabilityScope(raw: unknown): raw is AyasCapabilityScope {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const s = raw as Record<string, unknown>;
  if (!exactKeys(s, ["schemaVersion", "agentId", "runId", "taskId", "ownerId", "delegationId", "capabilities", "resource", "costClass", "classification"]) ||
      s.schemaVersion !== "1" || s.agentId !== "ayas-server" || s.ownerId !== null || s.delegationId !== "builtin-bounded-local-v1" ||
      typeof s.runId !== "string" || !UUID.test(s.runId) || typeof s.taskId !== "string" || !UUID.test(s.taskId) ||
      s.costClass !== "ZERO_LOCAL" || (s.classification !== "READ" && s.classification !== "BOUNDED_LOCAL") || !Array.isArray(s.capabilities) || s.capabilities.length !== 1 ||
      typeof s.capabilities[0] !== "string" || ayasLocalActionClassification(s.capabilities[0]) !== s.classification ||
      !s.resource || typeof s.resource !== "object" || Array.isArray(s.resource)) return false;
  const r = s.resource as Record<string, unknown>;
  return exactKeys(r, ["repoRoot", "resourceRoot", "platform", "requestDigest", "projectSlug"]) &&
    isAyasLocalCapabilityRoot(r.repoRoot) && isAyasLocalCapabilityRoot(r.resourceRoot) &&
    r.platform === "LOCAL" && typeof r.requestDigest === "string" && HASH.test(r.requestDigest) &&
    (r.projectSlug === null || (typeof r.projectSlug === "string" && /^[a-z0-9][a-z0-9_-]{0,127}$/i.test(r.projectSlug)));
}

export function ayasCapabilityRequestDigest(request: AyasExecutionRequest): string {
  return crypto.createHash("sha256").update(canonicalAyasExecutionRequest(request), "utf8").digest("hex");
}

/** Fixed serialization ignores property order. Validate before calling; callers must not hash unknown data. */
export function canonicalAyasCapabilityScope(scope: AyasCapabilityScope): string {
  return JSON.stringify([
    scope.schemaVersion, scope.agentId, scope.runId, scope.taskId, scope.ownerId, scope.delegationId,
    scope.capabilities, scope.resource.repoRoot, scope.resource.resourceRoot, scope.resource.platform, scope.resource.requestDigest,
    scope.resource.projectSlug, scope.costClass, scope.classification,
  ]);
}

/** Data only: the existing owner decision/reservation remains the authority. */
export interface AyasSelfDevelopmentCapabilityRequest {
  readonly action: "self-development.apply-approved-proposal";
  readonly proposalId: string;
  readonly proposalHash: string;
  readonly baseHead: string;
  readonly exactFiles: readonly string[];
  readonly mutationKind: string;
  readonly authorizationId: string;
  readonly reservationId: string;
}
export interface AyasRepairCapabilityRequest {
  readonly action: "guided-repair.apply-approved-scope";
  readonly proposalId: string;
  readonly proposalFingerprint: string;
  readonly issueFingerprint: string;
  readonly workspaceId: string;
  readonly authorizationId: string;
  readonly exactFiles: readonly string[];
  readonly operationClasses: readonly string[];
  readonly validationActions: readonly string[];
  readonly boundsDigest: string;
  readonly patchDigest: string;
}
export type AyasOwnerCapabilityRequest = AyasSelfDevelopmentCapabilityRequest | AyasRepairCapabilityRequest;
export interface AyasOwnerCapabilityProof {
  /** The app has one shared-passcode owner role, no named user accounts. */
  readonly ownerId: "shared-passcode-owner";
  readonly decisionId: string;
  readonly reservedAt: string;
  /** Existing repair approvals may have a shorter TTL; a lease must never renew it. */
  readonly expiresAt?: string;
  readonly request: AyasOwnerCapabilityRequest;
}
export interface AyasOwnerCapabilityScope {
  readonly schemaVersion: "1";
  readonly agentId: "ayas-server";
  readonly runId: string;
  readonly taskId: string;
  readonly ownerId: AyasOwnerCapabilityProof["ownerId"];
  readonly delegationId: string;
  readonly capabilities: readonly [AyasOwnerCapabilityRequest["action"]];
  readonly resource: { readonly repoRoot: string; readonly platform: "LOCAL"; readonly request: AyasOwnerCapabilityRequest };
  readonly costClass: "ZERO_LOCAL";
  readonly classification: "WRITE";
}
export interface AyasOwnerCapabilityLeaseAudit {
  readonly leaseId: string;
  readonly scope: AyasOwnerCapabilityScope;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly state: "granted" | "consumed" | "revoked";
  readonly consumedAt?: string;
}
const ID = /^[a-zA-Z0-9._:-]{1,200}$/;
export function isAyasOwnerCapabilityRequest(raw: unknown): raw is AyasOwnerCapabilityRequest {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const r = raw as Record<string, unknown>;
  const filesValid = Array.isArray(r.exactFiles) && r.exactFiles.length > 0 && r.exactFiles.length <= 100 && new Set(r.exactFiles).size === r.exactFiles.length &&
    r.exactFiles.every((f) => typeof f === "string" && f.length > 0 && f.length <= 4096 && !/[\\:\0]/.test(f) &&
      !f.startsWith("/") && f !== "." && f !== ".." && !f.startsWith("../") && path.posix.normalize(f) === f);
  if (r.action === "guided-repair.apply-approved-scope") {
    const labels = (v: unknown, max: number): boolean => Array.isArray(v) && v.length <= max && new Set(v).size === v.length && v.every((s) => typeof s === "string" && ID.test(s));
    return exactKeys(r, ["action", "proposalId", "proposalFingerprint", "issueFingerprint", "workspaceId", "authorizationId", "exactFiles", "operationClasses", "validationActions", "boundsDigest", "patchDigest"]) &&
      [r.proposalId, r.authorizationId].every((v) => typeof v === "string" && ID.test(v)) &&
      [r.proposalFingerprint, r.boundsDigest, r.patchDigest].every((v) => typeof v === "string" && HASH.test(v)) &&
      [r.issueFingerprint, r.workspaceId].every((v) => typeof v === "string" && v.length > 0 && v.length <= 200 && !v.includes("\0")) &&
      filesValid && labels(r.operationClasses, 5) && labels(r.validationActions, 7);
  }
  return exactKeys(r, ["action", "proposalId", "proposalHash", "baseHead", "exactFiles", "mutationKind", "authorizationId", "reservationId"]) &&
    r.action === "self-development.apply-approved-proposal" && [r.proposalId, r.mutationKind, r.authorizationId, r.reservationId].every((id) => typeof id === "string" && ID.test(id)) &&
    typeof r.proposalHash === "string" && HASH.test(r.proposalHash) && typeof r.baseHead === "string" && /^[a-f0-9]{40,64}$/.test(r.baseHead) &&
    filesValid;
}
export function canonicalAyasOwnerCapabilityRequest(r: AyasOwnerCapabilityRequest): string {
  if (r.action === "guided-repair.apply-approved-scope") return JSON.stringify([r.action, r.proposalId, r.proposalFingerprint, r.issueFingerprint, r.workspaceId,
    r.authorizationId, r.exactFiles, r.operationClasses, r.validationActions, r.boundsDigest, r.patchDigest]);
  return JSON.stringify([r.action, r.proposalId, r.proposalHash, r.baseHead, r.exactFiles, r.mutationKind, r.authorizationId, r.reservationId]);
}
export function canonicalAyasOwnerCapabilityScope(s: AyasOwnerCapabilityScope): string {
  return JSON.stringify([s.schemaVersion, s.agentId, s.runId, s.taskId, s.ownerId, s.delegationId, s.capabilities,
    s.resource.repoRoot, s.resource.platform, canonicalAyasOwnerCapabilityRequest(s.resource.request), s.costClass, s.classification]);
}
export function isAyasOwnerCapabilityLeaseAudit(raw: unknown): raw is AyasOwnerCapabilityLeaseAudit {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const a = raw as Record<string, unknown>;
  const consumed = a.state === "consumed";
  if (!exactKeys(a, ["leaseId", "scope", "createdAt", "expiresAt", "state", ...(consumed ? ["consumedAt"] : [])]) ||
      typeof a.leaseId !== "string" || !UUID.test(a.leaseId) || !["granted", "consumed", "revoked"].includes(String(a.state)) ||
      typeof a.createdAt !== "string" || typeof a.expiresAt !== "string" || !a.scope || typeof a.scope !== "object" || Array.isArray(a.scope)) return false;
  const start = Date.parse(a.createdAt), end = Date.parse(a.expiresAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > AYAS_CAPABILITY_MAX_TTL_MS ||
      (consumed && (typeof a.consumedAt !== "string" || !Number.isFinite(Date.parse(a.consumedAt)) || Date.parse(a.consumedAt) < start || Date.parse(a.consumedAt) >= end))) return false;
  const s = a.scope as Record<string, unknown>;
  if (!exactKeys(s, ["schemaVersion", "agentId", "runId", "taskId", "ownerId", "delegationId", "capabilities", "resource", "costClass", "classification"]) ||
      s.schemaVersion !== "1" || s.agentId !== "ayas-server" || typeof s.runId !== "string" || !UUID.test(s.runId) || typeof s.taskId !== "string" || !UUID.test(s.taskId) ||
      s.ownerId !== "shared-passcode-owner" || typeof s.delegationId !== "string" || !ID.test(s.delegationId) || s.costClass !== "ZERO_LOCAL" || s.classification !== "WRITE" ||
      !Array.isArray(s.capabilities) || s.capabilities.length !== 1 || !["self-development.apply-approved-proposal", "guided-repair.apply-approved-scope"].includes(String(s.capabilities[0])) ||
      !s.resource || typeof s.resource !== "object" || Array.isArray(s.resource)) return false;
  const r = s.resource as Record<string, unknown>;
  return exactKeys(r, ["repoRoot", "platform", "request"]) && isAyasLocalCapabilityRoot(r.repoRoot) && r.platform === "LOCAL" && isAyasOwnerCapabilityRequest(r.request) && r.request.action === s.capabilities[0];
}
