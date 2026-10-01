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
    typeof r.repoRoot === "string" && r.repoRoot.length <= 4096 && path.isAbsolute(r.repoRoot) && path.resolve(r.repoRoot) === r.repoRoot &&
    typeof r.resourceRoot === "string" && r.resourceRoot.length <= 4096 && path.isAbsolute(r.resourceRoot) && path.resolve(r.resourceRoot) === r.resourceRoot &&
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
