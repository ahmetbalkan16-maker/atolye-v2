import crypto from "node:crypto";
import fs from "node:fs";
import { AyasExecutionAuthorizationError, AyasExecutionAuthorizationStore } from "./AyasExecutionAuthorization";
import { ayasCapabilityRequestDigest, ayasLocalActionClassification, canonicalAyasCapabilityScope, isAyasLocalCapabilityRoot, type AyasActionFirewallDecision, type AyasCapabilityScope } from "./AyasCapabilityScope";
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
  if (!isAyasLocalCapabilityRoot(options.repoRoot)) throw new Error("AYAS_FIREWALL_REPOSITORY_UNKNOWN");
  const repoRoot = fs.realpathSync(options.repoRoot);
  const runId = crypto.randomUUID();
  const taskId = crypto.randomUUID();
  const leases = new WeakMap<object, IssuedLease>();
  const attachedAuthorizationIds = new Set<string>();

  function snapshotRequest(raw: unknown): AyasExecutionRequest | undefined {
    const validated = validateAyasExecutionRequest(raw);
    if (!validated.ok) return undefined;
    // Isolate the adapter's input from caller/tool objects. Revalidate the plain JSON snapshot,
    // then freeze it so a later caller mutation or adapter output cannot alter admitted scope.
    const snapshot: unknown = JSON.parse(JSON.stringify(validated.request));
    const checked = validateAyasExecutionRequest(snapshot);
    if (!checked.ok) return undefined;
    const freeze = (value: unknown): void => {
      if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
    };
    freeze(checked.request);
    return checked.request;
  }

  function scopeFor(request: AyasExecutionRequest): AyasCapabilityScope {
    const classification = ayasLocalActionClassification(request.action);
    if (!classification) throw new Error("AYAS_FIREWALL_CLASSIFICATION_UNKNOWN");
    if (!options.resolveResourceRoot && (request.projectSlug || request.action === "list-production-projects")) {
      throw new Error("AYAS_FIREWALL_RESOURCE_UNKNOWN");
    }
    const resourceRoot = options.resolveResourceRoot ? options.resolveResourceRoot(request) : repoRoot;
    if (!isAyasLocalCapabilityRoot(resourceRoot)) {
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

  function issue(raw: unknown, existingAuthorizationId?: string): AyasActionFirewallRefusal | { readonly allowed: true; readonly lease: AyasCapabilityLeaseHandle } {
    if (existingAuthorizationId !== undefined && attachedAuthorizationIds.has(existingAuthorizationId)) return refuse("AYAS_FIREWALL_REPLAY");
    const decision = classify(raw);
    if (decision === "DENY" || decision === "REQUIRE_OWNER") return refuse("AYAS_FIREWALL_SCOPE_NOT_ISSUABLE", decision);
    try {
      const request = snapshotRequest(raw);
      if (!request) return refuse("AYAS_FIREWALL_REQUEST_INVALID");
      const scope = scopeFor(request);
      const grant = existingAuthorizationId === undefined ? options.authorizations.grant(request, scope)
        : options.authorizations.bindReadCapabilityScope(existingAuthorizationId, request, scope);
      const lease = Object.freeze(Object.create(null)) as AyasCapabilityLeaseHandle;
      leases.set(lease, { authorizationId: grant.authorizationId, expiresAt: grant.expiresAt, scope, consumed: false, revoked: false });
      attachedAuthorizationIds.add(grant.authorizationId);
      return { allowed: true, lease };
    } catch (error) { return refuse(error instanceof AyasExecutionAuthorizationError ? error.code : "AYAS_FIREWALL_ISSUE_FAILED"); }
  }

  function admit(lease: unknown, raw: unknown): AyasActionFirewallAdmission {
    if (!lease || typeof lease !== "object") return refuse("AYAS_FIREWALL_HANDLE_UNKNOWN");
    const issued = leases.get(lease);
    if (!issued) return refuse("AYAS_FIREWALL_HANDLE_UNKNOWN");
    if (issued.revoked) return refuse("AYAS_EXEC_AUTH_REVOKED");
    if (issued.consumed) return refuse("AYAS_FIREWALL_REPLAY");
    try {
      const request = snapshotRequest(raw);
      if (!request) return refuse("AYAS_FIREWALL_REQUEST_INVALID");
      // Resolve the adapter root again. A changed symlink/root is not the resource that received this lease.
      if (fs.realpathSync(options.repoRoot) !== repoRoot) return refuse("AYAS_FIREWALL_RESOURCE_CHANGED");
      const expectedScope = scopeFor(request);
      if (canonicalAyasCapabilityScope(expectedScope) !== canonicalAyasCapabilityScope(issued.scope)) {
        return refuse("AYAS_FIREWALL_SCOPE_CHANGED");
      }
      const current = options.authorizations.read(issued.authorizationId);
      if (current.expiresAt !== issued.expiresAt) return refuse("AYAS_FIREWALL_EXPIRY_CHANGED");
      const consumed = options.authorizations.consume(issued.authorizationId, request, expectedScope);
      issued.consumed = true;
      // consume durably records the exact scope/time/state BEFORE this allow result is returned.
      return { allowed: true, decision: issued.scope.classification === "READ" ? "ALLOW_READ" : "ALLOW_BOUNDED_LOCAL",
        authorizationId: consumed.authorizationId, executionId: consumed.executionId, request };
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
