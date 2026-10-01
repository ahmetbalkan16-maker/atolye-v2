import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { AyasExecutionAuthorizationError, AyasExecutionAuthorizationStore } from "./AyasExecutionAuthorization";
import { ayasCapabilityRequestDigest, ayasLocalActionClassification, type AyasActionFirewallDecision, type AyasCapabilityScope } from "./AyasCapabilityScope";
import { AYAS_EXECUTION_RESERVED_ACTIONS, validateAyasExecutionRequest, type AyasExecutionRequest } from "./AyasExecutionPolicy";

/** Opaque server object. Its serialization/clone has no authority; even a real handle from another run is refused. */
declare const leaseBrand: unique symbol;
export interface AyasCapabilityLeaseHandle { readonly [leaseBrand]: true; }

export type AyasActionFirewallRefusal = {
  readonly allowed: false;
  readonly decision: "REQUIRE_OWNER" | "DENY";
  readonly reason: string;
};
export type AyasActionFirewallAdmission = AyasActionFirewallRefusal | {
  readonly allowed: true;
  readonly decision: "ALLOW_READ" | "ALLOW_BOUNDED_LOCAL";
  readonly authorizationId: string;
  readonly executionId: string;
  readonly request: AyasExecutionRequest;
};

interface IssuedLease {
  readonly authorizationId: string;
  readonly expiresAt: string;
  readonly scope: AyasCapabilityScope;
  consumed: boolean;
  revoked: boolean;
}

export interface AyasActionFirewallOptions {
  /** Trusted code only. Must be the root the adapter actually uses, never a request field. */
  readonly repoRoot: string;
  readonly authorizations: AyasExecutionAuthorizationStore;
  /** Trusted adapter resolver, re-evaluated at admission. Project/catalog targets fail closed if absent. */
  readonly resolveResourceRoot?: (request: AyasExecutionRequest) => string;
}

/**
 * Stage 15D additive admission layer over the ONE existing authorization store/allowlist.
 * No write activation, financial issuer, owner approval state or alternative authority store.
 * Instantiate once per bounded server task. A restart loses all live handles; durable records
 * remain audit evidence and never silently restore authority. Call admit immediately before dispatch.
 */
export function createAyasActionFirewall(options: AyasActionFirewallOptions) {
  const repoRoot = fs.realpathSync(options.repoRoot);
  const runId = crypto.randomUUID();
  const taskId = crypto.randomUUID();
  const leases = new WeakMap<object, IssuedLease>();

  function scopeFor(request: AyasExecutionRequest): AyasCapabilityScope {
    const classification = ayasLocalActionClassification(request.action);
    if (!classification) throw new Error("AYAS_FIREWALL_CLASSIFICATION_UNKNOWN");
    if (!options.resolveResourceRoot && (request.projectSlug || request.action === "list-production-projects")) {
      throw new Error("AYAS_FIREWALL_RESOURCE_UNKNOWN");
    }
    const resourceRoot = options.resolveResourceRoot ? options.resolveResourceRoot(request) : repoRoot;
    if (typeof resourceRoot !== "string" || !path.isAbsolute(resourceRoot) || path.resolve(resourceRoot) !== resourceRoot) {
      throw new Error("AYAS_FIREWALL_RESOURCE_UNKNOWN");
    }
    return {
      schemaVersion: "1", agentId: "ayas-server", runId, taskId,
      ownerId: null, delegationId: "builtin-bounded-local-v1",
      capabilities: [request.action],
      resource: { repoRoot, resourceRoot, platform: "LOCAL", requestDigest: ayasCapabilityRequestDigest(request), projectSlug: request.projectSlug ?? null },
      costClass: "ZERO_LOCAL", classification,
    };
  }

  function refuse(reason: string, decision: "REQUIRE_OWNER" | "DENY" = "DENY"): AyasActionFirewallRefusal {
    return { allowed: false, decision, reason };
  }

  /** Pure classification is informative, never a permission. Reserved effects retain owner control. */
  function classify(raw: unknown): AyasActionFirewallDecision {
    const action = raw && typeof raw === "object" ? (raw as { action?: unknown }).action : undefined;
    if (typeof action === "string" && AYAS_EXECUTION_RESERVED_ACTIONS.includes(action)) return "REQUIRE_OWNER";
    const v = validateAyasExecutionRequest(raw);
    if (!v.ok) return "DENY";
    const classification = ayasLocalActionClassification(v.request.action);
    return classification === "READ" ? "ALLOW_READ" : classification === "BOUNDED_LOCAL" ? "ALLOW_BOUNDED_LOCAL" : "DENY";
  }

  function issue(raw: unknown): AyasActionFirewallRefusal | { readonly allowed: true; readonly lease: AyasCapabilityLeaseHandle } {
    const decision = classify(raw);
    if (decision === "DENY" || decision === "REQUIRE_OWNER") return refuse("AYAS_FIREWALL_SCOPE_NOT_ISSUABLE", decision);
    const v = validateAyasExecutionRequest(raw);
    if (!v.ok) return refuse("AYAS_FIREWALL_REQUEST_INVALID");
    try {
      const scope = scopeFor(v.request);
      const grant = options.authorizations.grant(v.request, scope);
      const lease = Object.freeze(Object.create(null)) as AyasCapabilityLeaseHandle;
      leases.set(lease, { authorizationId: grant.authorizationId, expiresAt: grant.expiresAt, scope, consumed: false, revoked: false });
      return { allowed: true, lease };
    } catch { return refuse("AYAS_FIREWALL_ISSUE_FAILED"); }
  }

  function admit(lease: unknown, raw: unknown): AyasActionFirewallAdmission {
    if (!lease || typeof lease !== "object") return refuse("AYAS_FIREWALL_HANDLE_UNKNOWN");
    const issued = leases.get(lease);
    if (!issued) return refuse("AYAS_FIREWALL_HANDLE_UNKNOWN");
    if (issued.revoked) return refuse("AYAS_EXEC_AUTH_REVOKED");
    if (issued.consumed) return refuse("AYAS_FIREWALL_REPLAY");
    const v = validateAyasExecutionRequest(raw);
    if (!v.ok) return refuse("AYAS_FIREWALL_REQUEST_INVALID");
    try {
      // Resolve the adapter root again. A changed symlink/root is not the resource that received this lease.
      if (fs.realpathSync(options.repoRoot) !== repoRoot) return refuse("AYAS_FIREWALL_RESOURCE_CHANGED");
      const current = options.authorizations.read(issued.authorizationId);
      if (current.expiresAt !== issued.expiresAt) return refuse("AYAS_FIREWALL_EXPIRY_CHANGED");
      const consumed = options.authorizations.consume(issued.authorizationId, v.request, scopeFor(v.request));
      issued.consumed = true;
      // consume durably records the exact scope/time/state BEFORE this allow result is returned.
      return { allowed: true, decision: issued.scope.classification === "READ" ? "ALLOW_READ" : "ALLOW_BOUNDED_LOCAL",
        authorizationId: consumed.authorizationId, executionId: consumed.executionId, request: v.request };
    } catch (error) {
      return refuse(error instanceof AyasExecutionAuthorizationError ? error.code : "AYAS_FIREWALL_ADMISSION_FAILED");
    }
  }

  function revoke(lease: unknown): AyasActionFirewallRefusal | { readonly allowed: true } {
    const issued = lease && typeof lease === "object" ? leases.get(lease) : undefined;
    if (!issued) return refuse("AYAS_FIREWALL_HANDLE_UNKNOWN");
    try { options.authorizations.revoke(issued.authorizationId); issued.revoked = true; return { allowed: true }; }
    catch { return refuse("AYAS_FIREWALL_REVOCATION_FAILED"); }
  }

  return Object.freeze({ classify, issue, admit, revoke });
}
