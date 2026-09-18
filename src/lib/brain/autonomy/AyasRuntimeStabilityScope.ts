import type { AyasRuntimeStabilitySnapshot } from "./AyasRuntimeStabilitySnapshot";

/**
 * AYAS RUNTIME STABILITY GUARD — Part B: the impact declaration.
 *
 * Every controlled operation states UP FRONT which dimensions of the system
 * it is allowed to move. Anything it moves that it did not declare is a
 * violation, full stop — that is the whole mechanism by which "I only
 * restarted :3000" stops being a claim and becomes a checked property.
 *
 * The dimension list is deliberately coarse and closed. A coarse dimension
 * ("proposal-state" rather than a per-proposal assertion) keeps the
 * comparison total: every field of the snapshot maps to exactly one
 * dimension, so a newly added snapshot field cannot quietly fall outside the
 * diff and become invisible. The smoke suite pins that totality — it asserts
 * that a mutation of each snapshot section produces a change, so adding a
 * field without diffing it fails the test rather than silently widening what
 * a controlled operation may break.
 */
export type AyasRuntimeImpactDimension =
  | "source"
  | "git-history"
  | "runtime-config"
  | "service"
  | "research-scheduler"
  | "proposal-state"
  | "runtime-root";

export const AYAS_RUNTIME_IMPACT_DIMENSIONS: readonly AyasRuntimeImpactDimension[] = Object.freeze([
  "source",
  "git-history",
  "runtime-config",
  "service",
  "research-scheduler",
  "proposal-state",
  "runtime-root",
]);

export interface AyasRuntimeImpactScope {
  readonly operation: string;
  readonly allowed: readonly AyasRuntimeImpactDimension[];
  /** Ports this operation may restart. A service change on any other port is a violation even when "service" is allowed. */
  readonly allowedPorts: readonly number[];
  /**
   * The impact classification this scope was derived from, when a caller
   * derives its scope rather than hand-writing one (see
   * `AyasProposalRuntimeImpact`). Recorded so a durable transaction proves
   * WHICH declaration produced this dimension list, not merely the list.
   */
  readonly impactClass?: string;
  /**
   * Checks the declared impact makes inapplicable, in plain language (e.g.
   * "this class can never restart a service"). Persisted onto the
   * transaction so that a check which correctly did not run is a visible,
   * reviewable claim rather than an invisible absence — the difference
   * between a lightweight guard decision and a silent bypass.
   */
  readonly notApplicable?: readonly string[];
}

/** Optional provenance recorded alongside a declared scope. Purely descriptive: nothing here widens or narrows what the scope permits. */
export interface AyasRuntimeImpactScopeAnnotations {
  readonly impactClass?: string;
  readonly notApplicable?: readonly string[];
}

export interface AyasRuntimeImpactChange {
  readonly dimension: AyasRuntimeImpactDimension;
  readonly detail: string;
}

export function declareAyasRuntimeImpactScope(
  operation: string,
  allowed: readonly AyasRuntimeImpactDimension[],
  allowedPorts: readonly number[] = [],
  annotations: AyasRuntimeImpactScopeAnnotations = {},
): AyasRuntimeImpactScope {
  return Object.freeze({
    operation,
    allowed: Object.freeze([...allowed]),
    allowedPorts: Object.freeze([...allowedPorts]),
    ...(annotations.impactClass === undefined ? {} : { impactClass: annotations.impactClass }),
    ...(annotations.notApplicable === undefined ? {} : { notApplicable: Object.freeze([...annotations.notApplicable]) }),
  });
}

/**
 * Every dimension that actually moved between two snapshots. Pure comparison
 * — it neither knows nor cares what was declared; `findAyasOutOfScopeViolations`
 * applies the policy.
 */
export function diffAyasRuntimeStabilitySnapshots(before: AyasRuntimeStabilitySnapshot, after: AyasRuntimeStabilitySnapshot): readonly AyasRuntimeImpactChange[] {
  const changes: AyasRuntimeImpactChange[] = [];

  // source / git-history: a HEAD move is history, a dirty-tree move is source.
  if (before.repo.head !== after.repo.head) changes.push({ dimension: "git-history", detail: `HEAD ${short(before.repo.head)} -> ${short(after.repo.head)}` });
  if (before.repo.branch !== after.repo.branch) changes.push({ dimension: "git-history", detail: `branch ${before.repo.branch} -> ${after.repo.branch}` });
  if (before.repo.clean !== after.repo.clean || before.repo.dirtyEntryCount !== after.repo.dirtyEntryCount) {
    changes.push({ dimension: "source", detail: `working tree ${before.repo.dirtyEntryCount} -> ${after.repo.dirtyEntryCount} dirty entr${after.repo.dirtyEntryCount === 1 ? "y" : "ies"}` });
  }

  // service: listening state, owning pid, or process identity moved.
  for (const beforeService of before.services) {
    const afterService = after.services.find((service) => service.port === beforeService.port);
    if (!afterService) {
      changes.push({ dimension: "service", detail: `port ${beforeService.port} no longer observed` });
      continue;
    }
    if (beforeService.listening !== afterService.listening) changes.push({ dimension: "service", detail: `port ${beforeService.port} listening ${beforeService.listening} -> ${afterService.listening}` });
    else if (beforeService.pid !== afterService.pid) changes.push({ dimension: "service", detail: `port ${beforeService.port} pid ${beforeService.pid ?? "none"} -> ${afterService.pid ?? "none"}` });
    else if (beforeService.commandFingerprint !== afterService.commandFingerprint) changes.push({ dimension: "service", detail: `port ${beforeService.port} process identity changed` });
  }
  for (const afterService of after.services) {
    if (!before.services.some((service) => service.port === afterService.port)) changes.push({ dimension: "service", detail: `port ${afterService.port} newly observed` });
  }

  // runtime-config: the gate flag and any tracked env var.
  if (before.gate.autonomousExecutionEnabled !== after.gate.autonomousExecutionEnabled) {
    changes.push({ dimension: "runtime-config", detail: `autonomous execution ${before.gate.autonomousExecutionEnabled} -> ${after.gate.autonomousExecutionEnabled}` });
  }
  if (before.gate.ownerApprovalRequired !== after.gate.ownerApprovalRequired) {
    changes.push({ dimension: "runtime-config", detail: `owner approval required ${before.gate.ownerApprovalRequired} -> ${after.gate.ownerApprovalRequired}` });
  }
  for (const beforeVar of before.env) {
    const afterVar = after.env.find((entry) => entry.name === beforeVar.name);
    if (!afterVar) { changes.push({ dimension: "runtime-config", detail: `env ${beforeVar.name} no longer tracked` }); continue; }
    if (beforeVar.set !== afterVar.set || beforeVar.valueFingerprint !== afterVar.valueFingerprint) {
      changes.push({ dimension: "runtime-config", detail: `env ${beforeVar.name} changed` });
    }
  }
  for (const afterVar of after.env) {
    if (!before.env.some((entry) => entry.name === afterVar.name)) changes.push({ dimension: "runtime-config", detail: `env ${afterVar.name} newly tracked` });
  }

  // research-scheduler: cadence, health, or in-flight state moved.
  if (before.scheduler.nextLightAt !== after.scheduler.nextLightAt) changes.push({ dimension: "research-scheduler", detail: `nextLightAt ${before.scheduler.nextLightAt ?? "none"} -> ${after.scheduler.nextLightAt ?? "none"}` });
  if (before.scheduler.nextDeepAt !== after.scheduler.nextDeepAt) changes.push({ dimension: "research-scheduler", detail: `nextDeepAt ${before.scheduler.nextDeepAt ?? "none"} -> ${after.scheduler.nextDeepAt ?? "none"}` });
  if (before.scheduler.consecutiveFailures !== after.scheduler.consecutiveFailures) changes.push({ dimension: "research-scheduler", detail: `consecutiveFailures ${before.scheduler.consecutiveFailures} -> ${after.scheduler.consecutiveFailures}` });
  if (before.scheduler.runInFlight !== after.scheduler.runInFlight) changes.push({ dimension: "research-scheduler", detail: `runInFlight ${before.scheduler.runInFlight} -> ${after.scheduler.runInFlight}` });
  if (before.scheduler.stateFilePresent !== after.scheduler.stateFilePresent) changes.push({ dimension: "research-scheduler", detail: `scheduler state presence ${before.scheduler.stateFilePresent} -> ${after.scheduler.stateFilePresent}` });
  if (before.scheduler.lastSuccessfulResearchAt !== after.scheduler.lastSuccessfulResearchAt) changes.push({ dimension: "research-scheduler", detail: "lastSuccessfulResearchAt changed" });

  // proposal-state: any status count, pending/approved membership, or ledger growth.
  if (!sameCounts(before.proposals.statusCounts, after.proposals.statusCounts)) changes.push({ dimension: "proposal-state", detail: `status counts ${render(before.proposals.statusCounts)} -> ${render(after.proposals.statusCounts)}` });
  if (!sameList(before.proposals.pendingProposalIds, after.proposals.pendingProposalIds)) changes.push({ dimension: "proposal-state", detail: "PENDING membership changed" });
  if (!sameList(before.proposals.approvedProposalIds, after.proposals.approvedProposalIds)) changes.push({ dimension: "proposal-state", detail: "APPROVED membership changed" });
  if (before.proposals.decisionCount !== after.proposals.decisionCount) changes.push({ dimension: "proposal-state", detail: `decisions ${before.proposals.decisionCount} -> ${after.proposals.decisionCount}` });
  if (before.proposals.resultCount !== after.proposals.resultCount) changes.push({ dimension: "proposal-state", detail: `results ${before.proposals.resultCount} -> ${after.proposals.resultCount}` });

  // runtime-root: the storage authority itself moved.
  if (before.runtimeRootFingerprint !== after.runtimeRootFingerprint) changes.push({ dimension: "runtime-root", detail: "runtime storage root changed" });

  return Object.freeze(changes);
}

export interface AyasScopeViolation extends AyasRuntimeImpactChange {
  readonly reasonCode: "DIMENSION_NOT_DECLARED" | "PORT_NOT_DECLARED";
}

/**
 * The policy call. A change is a violation when its dimension was not
 * declared, or when it is a service change on a port the operation never
 * claimed — the specific failure mode where "restart :3000" quietly takes an
 * unrelated listener down with it.
 */
export function findAyasOutOfScopeViolations(
  before: AyasRuntimeStabilitySnapshot,
  after: AyasRuntimeStabilitySnapshot,
  scope: AyasRuntimeImpactScope,
): readonly AyasScopeViolation[] {
  const violations: AyasScopeViolation[] = [];
  for (const change of diffAyasRuntimeStabilitySnapshots(before, after)) {
    if (!scope.allowed.includes(change.dimension)) {
      violations.push({ ...change, reasonCode: "DIMENSION_NOT_DECLARED" });
      continue;
    }
    if (change.dimension === "service") {
      const port = parsePort(change.detail);
      if (port !== undefined && !scope.allowedPorts.includes(port)) violations.push({ ...change, reasonCode: "PORT_NOT_DECLARED" });
    }
  }
  return Object.freeze(violations);
}

function parsePort(detail: string): number | undefined {
  const match = /port (\d+)/.exec(detail);
  return match ? Number(match[1]) : undefined;
}

function short(sha: string): string {
  return sha.length > 7 ? sha.slice(0, 7) : sha;
}

function sameCounts(a: Readonly<Record<string, number | undefined>>, b: Readonly<Record<string, number | undefined>>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) if ((a[key] ?? 0) !== (b[key] ?? 0)) return false;
  return true;
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function render(counts: Readonly<Record<string, number | undefined>>): string {
  return Object.entries(counts).filter(([, value]) => value).map(([key, value]) => `${key}=${value}`).sort().join(",") || "none";
}
