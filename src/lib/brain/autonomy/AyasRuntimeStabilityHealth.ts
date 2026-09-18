import type { AyasRuntimeStabilitySnapshot } from "./AyasRuntimeStabilitySnapshot";

/**
 * AYAS RUNTIME STABILITY GUARD — Part D: health that is not just "HTTP 200".
 *
 * The concrete failure this prevents: :3000 answers 200 while the autonomous
 * execution gate has silently reverted, the research scheduler has stopped
 * advancing, or a proposal executed that nobody approved. An HTTP probe is
 * blind to all three, so every one of them is checked here as a first-class
 * invariant, and an unknown/unprovable check counts as a FAILURE rather than
 * a pass — `unknown` is the state a broken probe reports, and treating it as
 * healthy is how a guard becomes decorative.
 */
export type AyasHealthCheckId =
  | "service-reachable"
  | "service-ownership"
  | "execution-gate"
  | "owner-approval-required"
  | "research-scheduler"
  | "runtime-root"
  | "repo-state"
  | "no-unexpected-execution"
  | "snapshot-complete";

export type AyasHealthCheckStatus = "PASS" | "FAIL" | "SKIPPED";

export interface AyasHealthCheckResult {
  readonly id: AyasHealthCheckId;
  readonly status: AyasHealthCheckStatus;
  readonly detail: string;
}

export interface AyasRuntimeHealthDecision {
  readonly healthy: boolean;
  readonly checks: readonly AyasHealthCheckResult[];
  readonly failures: readonly string[];
}

export interface AyasRuntimeHealthExpectations {
  /** Ports that must still be listening, with the HTTP probe result for each (undefined = not probed). */
  readonly requiredPorts?: readonly number[];
  readonly httpStatusByPort?: Readonly<Record<number, number | undefined>>;
  /** Ports whose owning process must have CHANGED (a deliberate restart) — everything else must be identical. */
  readonly restartedPorts?: readonly number[];
  readonly expectAutonomousExecutionEnabled?: boolean;
  /** The scheduler must not have gone backwards: its cadence fields must still be present and no new failure recorded. */
  readonly requireSchedulerOperational?: boolean;
  readonly expectRepoHead?: string;
  readonly expectRepoClean?: boolean;
  /** Proposal ids that must still be exactly PENDING and carry no decision/result. */
  readonly expectStillPending?: readonly string[];
}

/**
 * `before` is the pre-change snapshot, `after` the post-change one. Several
 * checks are genuinely relational (a restart must change the owning pid on
 * the restarted port and only there), which is why this takes both rather
 * than grading `after` in isolation.
 */
export function evaluateAyasRuntimeStabilityHealth(
  before: AyasRuntimeStabilitySnapshot,
  after: AyasRuntimeStabilitySnapshot,
  expectations: AyasRuntimeHealthExpectations = {},
): AyasRuntimeHealthDecision {
  const checks: AyasHealthCheckResult[] = [];
  const check = (id: AyasHealthCheckId, ok: boolean, detail: string): void => { checks.push({ id, status: ok ? "PASS" : "FAIL", detail }); };
  const skip = (id: AyasHealthCheckId, detail: string): void => { checks.push({ id, status: "SKIPPED", detail }); };

  // 1 + 2: service reachable, and owned by the process we expect.
  const requiredPorts = expectations.requiredPorts ?? [];
  if (requiredPorts.length === 0) skip("service-reachable", "no ports declared");
  else {
    for (const port of requiredPorts) {
      const service = after.services.find((entry) => entry.port === port);
      const httpStatus = expectations.httpStatusByPort?.[port];
      const listening = service?.listening === true;
      const httpOk = httpStatus === undefined || (httpStatus >= 200 && httpStatus < 400);
      check("service-reachable", listening && httpOk, `port ${port} listening=${listening}${httpStatus === undefined ? "" : ` http=${httpStatus}`}`);
    }
  }

  const restartedPorts = expectations.restartedPorts ?? [];
  for (const service of after.services) {
    const previous = before.services.find((entry) => entry.port === service.port);
    if (!previous) continue;
    if (restartedPorts.includes(service.port)) {
      // A restarted port must be listening again under a NEW pid. Same pid means the restart silently did not happen.
      const restarted = service.listening && service.pid !== undefined && service.pid !== previous.pid;
      check("service-ownership", restarted, `port ${service.port} restarted pid ${previous.pid ?? "none"} -> ${service.pid ?? "none"}`);
      continue;
    }
    // Every other port must be untouched — this is the "restart :3000 must not kill :3101" invariant.
    const untouched = previous.listening === service.listening && previous.pid === service.pid;
    check("service-ownership", untouched, `port ${service.port} unrelated listener ${untouched ? "intact" : `disturbed (${previous.pid ?? "none"} -> ${service.pid ?? "none"})`}`);
  }
  if (after.services.length === 0) skip("service-ownership", "no services observed");

  // 3: the execution gate is exactly what was asked for.
  if (expectations.expectAutonomousExecutionEnabled === undefined) skip("execution-gate", "no expectation declared");
  else check("execution-gate", after.gate.autonomousExecutionEnabled === expectations.expectAutonomousExecutionEnabled, `autonomous execution enabled=${after.gate.autonomousExecutionEnabled}, expected=${expectations.expectAutonomousExecutionEnabled}`);

  // 4: owner approval is structurally mandatory and was never weakened.
  check("owner-approval-required", after.gate.ownerApprovalRequired && before.gate.ownerApprovalRequired, `owner approval required=${after.gate.ownerApprovalRequired}`);

  // 5: the scheduler still has a live cadence and did not regress.
  if (expectations.requireSchedulerOperational !== true) skip("research-scheduler", "not required by this operation");
  else {
    const cadencePresent = after.scheduler.nextLightAt !== undefined && after.scheduler.nextDeepAt !== undefined;
    const noNewFailures = after.scheduler.consecutiveFailures <= Math.max(before.scheduler.consecutiveFailures, 0);
    const notLost = after.scheduler.stateFilePresent;
    check("research-scheduler", cadencePresent && noNewFailures && notLost, `cadence=${cadencePresent} statePresent=${notLost} consecutiveFailures ${before.scheduler.consecutiveFailures} -> ${after.scheduler.consecutiveFailures}`);
  }

  // 6: the storage authority did not move under us.
  check("runtime-root", before.runtimeRootFingerprint === after.runtimeRootFingerprint, before.runtimeRootFingerprint === after.runtimeRootFingerprint ? "runtime root unchanged" : "runtime root CHANGED");

  // 7: repo is where it should be.
  const headOk = expectations.expectRepoHead === undefined || after.repo.head === expectations.expectRepoHead;
  const cleanOk = expectations.expectRepoClean === undefined || after.repo.clean === expectations.expectRepoClean;
  if (expectations.expectRepoHead === undefined && expectations.expectRepoClean === undefined) skip("repo-state", "no expectation declared");
  else check("repo-state", headOk && cleanOk, `head=${after.repo.head.slice(0, 7)} clean=${after.repo.clean}`);

  // 8: nothing executed that nobody approved.
  const stillPending = expectations.expectStillPending ?? [];
  if (stillPending.length === 0) skip("no-unexpected-execution", "no proposal pinned");
  else {
    for (const proposalId of stillPending) {
      const pinned = after.proposals.pendingProposalIds.includes(proposalId);
      const noNewDecisions = after.proposals.decisionCount === before.proposals.decisionCount;
      const noNewResults = after.proposals.resultCount === before.proposals.resultCount;
      check("no-unexpected-execution", pinned && noNewDecisions && noNewResults, `${proposalId} pending=${pinned} decisions ${before.proposals.decisionCount}->${after.proposals.decisionCount} results ${before.proposals.resultCount}->${after.proposals.resultCount}`);
    }
  }

  // 9: an incomplete snapshot cannot certify anything. Fail closed.
  check("snapshot-complete", before.gaps.length === 0 && after.gaps.length === 0, before.gaps.length + after.gaps.length === 0 ? "snapshots complete" : `gaps: ${[...before.gaps, ...after.gaps].join("; ")}`);

  const failures = checks.filter((entry) => entry.status === "FAIL").map((entry) => `${entry.id}: ${entry.detail}`);
  return Object.freeze({ healthy: failures.length === 0, checks: Object.freeze(checks), failures: Object.freeze(failures) });
}
