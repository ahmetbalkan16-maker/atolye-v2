/**
 * AYAS M26 (Phase 1) — Self-Improvement Health: a pure, deterministic verdict
 * on "is the self-improvement loop alive, and is it making progress?".
 *
 * Why this exists: three separate silent outages (M23 autostart exiting 0
 * without starting anything, M24 four sources failing without a trace, M25 no
 * crash-restart) were each noticed only because the owner saw *nothing
 * happening* and asked. Every fact needed to answer the question was already
 * durable — daemon heartbeat, observer lock owner, research cadence, research
 * lock, Graphify head — but nothing evaluated them together, so each incident
 * needed a manual forensic chain. This module is that evaluation, and it is
 * the deterministic signal a later owner-notification phase can act on.
 *
 * What it deliberately does NOT do: read files, spawn processes, call git,
 * touch a lock, stop or restart anything, or import any approval / execution /
 * mutation / patch / git module. It is handed already-collected facts and
 * returns a verdict; detection here never becomes a second authority path.
 * Every input is untrusted state read from disk, so findings carry only closed
 * codes, numbers, booleans and phase names from a fixed vocabulary — never raw
 * `lastError` text or any other free-form field (pinned by test).
 *
 * Fail-closed in the one direction that matters: an unreadable or malformed
 * fact is never reported as healthy. It becomes a finding, and an unusable
 * clock or unreadable observer state becomes `UNKNOWN`.
 */

/** Heartbeat older than this many observer intervals means the observer has stopped ticking (one tick can legitimately run ~4 min inside a 5 min interval). */
export const AYAS_HEALTH_HEARTBEAT_STALE_FACTOR = 3;
/** A due research cycle is not reported until it is this late — covers the observer interval, the discovery child's own runtime and the execution-authority lock's stale window. */
export const AYAS_HEALTH_RESEARCH_OVERDUE_GRACE_MS = 30 * 60_000;
export const AYAS_HEALTH_RESEARCH_FAILURE_WARN = 3;
export const AYAS_HEALTH_RESEARCH_FAILURE_CRITICAL = 6;
/** A research cycle really runs ~2 minutes; a lock held by a LIVE owner this long is a hang, not work. */
export const AYAS_HEALTH_RESEARCH_LOCK_LONG_HOLD_MS = 60 * 60_000;
/** Mirrors `AyasExecutionAuthorityLock`'s default stale window (pinned against its source by test so the two cannot drift). */
export const AYAS_HEALTH_LOCK_STALE_AFTER_MS = 10 * 60_000;

/** Kept as a local list (not imported) so this module has no dependency on the daemon; a test pins it against `AyasAutonomyDaemonPhase`. */
export const AYAS_HEALTH_KNOWN_OBSERVER_PHASES = [
  "STARTING", "OBSERVING", "PROPOSAL_PENDING", "WAITING_APPROVAL", "APPROVED_PENDING_EXECUTION", "EXECUTING", "WAITING_REVIEW",
  "DEFERRED", "PAUSED_MACHINE_HEALTH", "PAUSED_DIRTY_REPO", "BACKOFF", "ERROR", "STOPPED",
] as const;

export type AyasHealthOwnerStatus = "alive" | "dead" | "unknown";
export type AyasHealthFact<T> =
  | { readonly kind: "unreadable" }
  | { readonly kind: "ok"; readonly value: T };
export type AyasHealthFileFact<T> =
  | { readonly kind: "absent" }
  | { readonly kind: "unreadable" }
  | { readonly kind: "ok"; readonly value: T };

export interface AyasHealthObserverState { readonly schemaVersion: "1"; readonly phase: string; readonly updatedAt: string; readonly heartbeatCount: number }
export interface AyasHealthObserverFacts {
  readonly intervalMs: number;
  readonly state: AyasHealthFileFact<AyasHealthObserverState>;
  /** The observer singleton lock's recorded owner, already classified by the collector. */
  readonly lock: AyasHealthFileFact<{ readonly ownerStatus: AyasHealthOwnerStatus }>;
}

export interface AyasHealthResearchState {
  readonly schemaVersion: "1";
  readonly consecutiveFailures: number;
  readonly nextLightAt?: string;
  readonly nextDeepAt?: string;
  readonly currentRunId?: string;
}
export interface AyasHealthResearchLockFacts {
  /** `missing` = no owner.json; `unreadable` = I/O failed; `invalid` = bytes were read but are not a valid owner record. */
  readonly ownerStatus: AyasHealthOwnerStatus | "missing" | "unreadable" | "invalid";
  readonly ageMs: number;
}
export interface AyasHealthResearchFacts {
  readonly enabled: boolean;
  readonly lightIntervalMs: number;
  readonly deepIntervalMs: number;
  readonly state: AyasHealthFileFact<AyasHealthResearchState>;
  /** An absent lock directory is the normal idle case; read failures remain explicit and fail closed. */
  readonly lock: AyasHealthFileFact<AyasHealthResearchLockFacts>;
}
export interface AyasHealthRepoFacts {
  readonly head: AyasHealthFact<string>;
  readonly clean: AyasHealthFact<boolean>;
  /** Graphify branch metadata is required for this health check; absence and unreadability are distinct. */
  readonly graph: AyasHealthFileFact<string>;
}
export interface AyasSelfImprovementHealthInput {
  readonly now: string;
  readonly observer: AyasHealthObserverFacts;
  readonly research: AyasHealthResearchFacts;
  readonly repo: AyasHealthRepoFacts;
}

export type AyasHealthSeverity = "INFO" | "WARN" | "CRITICAL";
export type AyasHealthVerdict = "HEALTHY" | "DEGRADED" | "STALLED" | "DOWN" | "UNKNOWN";
export type AyasHealthFindingCode =
  | "INPUT_CLOCK_INVALID"
  | "OBSERVER_STATE_ABSENT" | "OBSERVER_STATE_UNREADABLE" | "OBSERVER_HEARTBEAT_UNREADABLE" | "OBSERVER_HEARTBEAT_STALE"
  | "OBSERVER_LOCK_ABSENT" | "OBSERVER_LOCK_UNREADABLE" | "OBSERVER_OWNER_DEAD" | "OBSERVER_OWNER_UNVERIFIABLE"
  | "OBSERVER_PAUSED_DIRTY_REPO" | "OBSERVER_PAUSED_MACHINE_HEALTH" | "OBSERVER_IN_ERROR" | "OBSERVER_PHASE_UNRECOGNIZED"
  | "RESEARCH_DISABLED_BY_ENV" | "RESEARCH_CONFIG_UNREADABLE" | "RESEARCH_STATE_ABSENT" | "RESEARCH_STATE_UNREADABLE"
  | "RESEARCH_LIGHT_OVERDUE" | "RESEARCH_DEEP_OVERDUE" | "RESEARCH_CONSECUTIVE_FAILURES"
  | "RESEARCH_RUN_IN_PROGRESS" | "RESEARCH_RUN_INTERRUPTED"
  | "RESEARCH_LOCK_UNREADABLE" | "RESEARCH_LOCK_HELD_LONG" | "RESEARCH_LOCK_OWNER_DEAD" | "RESEARCH_LOCK_OWNER_UNVERIFIABLE"
  | "RESEARCH_LOCK_OWNER_UNREADABLE_YOUNG" | "RESEARCH_LOCK_UNRECOVERABLE"
  | "REPO_HEAD_UNREADABLE" | "REPO_STATUS_UNREADABLE" | "REPO_DIRTY"
  | "GRAPH_METADATA_ABSENT" | "GRAPH_METADATA_UNREADABLE" | "GRAPH_STALE_VS_HEAD";
export type AyasHealthSubject = "input" | "observer" | "research" | "repo" | "graph";

export interface AyasHealthFinding {
  readonly code: AyasHealthFindingCode;
  readonly severity: AyasHealthSeverity;
  readonly subject: AyasHealthSubject;
  readonly message: string;
  /** Closed-vocabulary facts only: numbers, booleans and fixed strings — never raw file text. */
  readonly evidence: Readonly<Record<string, string | number | boolean>>;
}
export interface AyasSelfImprovementHealth {
  readonly verdict: AyasHealthVerdict;
  /** `true` for DOWN / STALLED / UNKNOWN — the states where the loop is not doing its job and a human should look. DEGRADED is informational. */
  readonly ownerActionRecommended: boolean;
  readonly findings: readonly AyasHealthFinding[];
}

const SEVERITY_RANK: Readonly<Record<AyasHealthSeverity, number>> = { CRITICAL: 0, WARN: 1, INFO: 2 };
const KNOWN_PHASES: ReadonlySet<string> = new Set(AYAS_HEALTH_KNOWN_OBSERVER_PHASES);

/** Locale-independent ordering: `localeCompare` would sort differently under a Turkish locale, breaking the "same input, same output" guarantee across machines. */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Echoes a commit id only when it really is one — the value comes from a file on disk, so anything else must not be carried into a finding. */
function shortSha(value: string): string {
  return /^[0-9a-f]{7,40}$/.test(value) ? value.slice(0, 12) : "invalid-format";
}

function finding(code: AyasHealthFindingCode, severity: AyasHealthSeverity, subject: AyasHealthSubject, message: string, evidence: AyasHealthFinding["evidence"] = {}): AyasHealthFinding {
  return { code, severity, subject, message, evidence };
}

function evaluateObserver(observer: AyasHealthObserverFacts, nowMs: number, out: AyasHealthFinding[]): void {
  if (!observer.state || !(["absent", "unreadable", "ok"] as const).includes(observer.state.kind)) {
    out.push(finding("OBSERVER_STATE_UNREADABLE", "CRITICAL", "observer", "the observer state fact is missing or invalid"));
  } else if (observer.state.kind === "absent") {
    out.push(finding("OBSERVER_STATE_ABSENT", "CRITICAL", "observer", "no observer state file exists — the observer has never recorded a heartbeat"));
  } else if (observer.state.kind === "unreadable") {
    out.push(finding("OBSERVER_STATE_UNREADABLE", "CRITICAL", "observer", "the observer state file exists but could not be read as valid state"));
  }

  if (!observer.lock || !(["absent", "unreadable", "ok"] as const).includes(observer.lock.kind)) {
    out.push(finding("OBSERVER_LOCK_UNREADABLE", "WARN", "observer", "the observer lock fact is missing or invalid"));
  } else if (observer.lock.kind === "absent") {
    out.push(finding("OBSERVER_LOCK_ABSENT", "CRITICAL", "observer", "no observer singleton lock — no process is claiming to be the observer"));
  } else if (observer.lock.kind === "unreadable") {
    out.push(finding("OBSERVER_LOCK_UNREADABLE", "WARN", "observer", "the observer lock exists but its owner could not be read"));
  } else if (!observer.lock.value || !(["alive", "dead", "unknown"] as const).includes(observer.lock.value.ownerStatus)) {
    out.push(finding("OBSERVER_LOCK_UNREADABLE", "WARN", "observer", "the observer lock owner status is invalid"));
  } else if (observer.lock.value.ownerStatus === "dead") {
    out.push(finding("OBSERVER_OWNER_DEAD", "CRITICAL", "observer", "the observer lock names a process that is no longer running"));
  } else if (observer.lock.value.ownerStatus === "unknown") {
    out.push(finding("OBSERVER_OWNER_UNVERIFIABLE", "WARN", "observer", "the observer lock's owner is alive but its identity could not be verified"));
  }

  if (!observer.state || observer.state.kind !== "ok") return;
  const { schemaVersion, phase, updatedAt, heartbeatCount } = observer.state.value ?? {} as AyasHealthObserverState;
  if (schemaVersion !== "1" || typeof phase !== "string" || typeof updatedAt !== "string" || !Number.isSafeInteger(heartbeatCount) || heartbeatCount < 0) {
    out.push(finding("OBSERVER_STATE_UNREADABLE", "CRITICAL", "observer", "the observer state file exists but could not be read as valid state"));
    return;
  }
  const updatedMs = Date.parse(updatedAt);
  if (!Number.isFinite(updatedMs)) {
    out.push(finding("OBSERVER_HEARTBEAT_UNREADABLE", "CRITICAL", "observer", "the observer heartbeat timestamp is not a valid time"));
  } else {
    const ageMs = nowMs - updatedMs;
    if (ageMs < 0) {
      out.push(finding("OBSERVER_HEARTBEAT_UNREADABLE", "CRITICAL", "observer", "the observer heartbeat timestamp is in the future"));
      return;
    }
    if (!Number.isFinite(observer.intervalMs) || observer.intervalMs <= 0) {
      out.push(finding("OBSERVER_HEARTBEAT_UNREADABLE", "CRITICAL", "observer", "the observer heartbeat interval is not a valid positive duration"));
      return;
    }
    const thresholdMs = observer.intervalMs * AYAS_HEALTH_HEARTBEAT_STALE_FACTOR;
    if (ageMs > thresholdMs) {
      // A dead/absent owner already explains a stale heartbeat, so it is evidence there, not a second alarm.
      const explained = observer.lock?.kind === "absent" || (observer.lock?.kind === "ok" && observer.lock.value?.ownerStatus === "dead");
      out.push(finding("OBSERVER_HEARTBEAT_STALE", explained ? "WARN" : "CRITICAL", "observer", "the observer heartbeat has not advanced within the allowed window", { heartbeatAgeMs: ageMs, thresholdMs }));
    }
  }

  if (!KNOWN_PHASES.has(phase)) {
    out.push(finding("OBSERVER_PHASE_UNRECOGNIZED", "WARN", "observer", "the observer reports a phase outside the known vocabulary"));
  } else if (phase === "PAUSED_DIRTY_REPO") {
    out.push(finding("OBSERVER_PAUSED_DIRTY_REPO", "WARN", "observer", "discovery is paused by design because the working tree is dirty — commit or clean to resume", { phase }));
  } else if (phase === "PAUSED_MACHINE_HEALTH") {
    out.push(finding("OBSERVER_PAUSED_MACHINE_HEALTH", "WARN", "observer", "the observer is paused by Machine Health", { phase }));
  } else if (phase === "ERROR") {
    out.push(finding("OBSERVER_IN_ERROR", "WARN", "observer", "the observer last reported the ERROR phase", { phase }));
  }
}

function evaluateResearchCadence(mode: "LIGHT" | "DEEP", nextAt: string | undefined, intervalMs: number, nowMs: number, out: AyasHealthFinding[]): void {
  if (nextAt === undefined) return; // never scheduled: the scheduler treats it as due on its next tick, which is not an anomaly by itself
  const dueMs = Date.parse(nextAt);
  if (!Number.isFinite(dueMs)) return;
  const overdueMs = nowMs - dueMs;
  if (overdueMs <= AYAS_HEALTH_RESEARCH_OVERDUE_GRACE_MS) return;
  // Late by a whole cadence interval means a full cycle was missed, not merely delayed.
  const missedWholeCycle = overdueMs >= intervalMs;
  out.push(finding(mode === "LIGHT" ? "RESEARCH_LIGHT_OVERDUE" : "RESEARCH_DEEP_OVERDUE", missedWholeCycle ? "CRITICAL" : "WARN", "research", `the ${mode} research cycle is overdue`, { overdueMs, graceMs: AYAS_HEALTH_RESEARCH_OVERDUE_GRACE_MS, intervalMs }));
}

function evaluateResearch(research: AyasHealthResearchFacts, nowMs: number, out: AyasHealthFinding[]): void {
  if (typeof research.enabled !== "boolean") {
    out.push(finding("RESEARCH_CONFIG_UNREADABLE", "WARN", "research", "the research scheduler enabled flag is missing or invalid"));
    return;
  }
  if (!research.enabled) {
    out.push(finding("RESEARCH_DISABLED_BY_ENV", "INFO", "research", "the research scheduler is disabled by AYAS_RESEARCH_SCHEDULER_ENABLED=0"));
    return;
  }

  const lockFact = research.lock;
  let lock: AyasHealthResearchLockFacts | undefined;
  if (!lockFact || lockFact.kind === "unreadable") {
    out.push(finding("RESEARCH_LOCK_UNREADABLE", "WARN", "research", "the research lock location could not be read reliably"));
  } else if (lockFact.kind === "ok") {
    lock = lockFact.value;
    const knownOwner = (["alive", "dead", "unknown", "missing", "unreadable", "invalid"] as const).includes(lock.ownerStatus);
    if (!knownOwner || !Number.isFinite(lock.ageMs) || lock.ageMs < 0) {
      out.push(finding("RESEARCH_LOCK_UNREADABLE", "WARN", "research", "the research lock facts are invalid"));
      lock = undefined;
    }
  }
  if (lock) {
    if (lock.ownerStatus === "alive") {
      if (lock.ageMs >= AYAS_HEALTH_RESEARCH_LOCK_LONG_HOLD_MS) out.push(finding("RESEARCH_LOCK_HELD_LONG", "WARN", "research", "a live process has held the research lock far longer than a research cycle takes", { ageMs: lock.ageMs, thresholdMs: AYAS_HEALTH_RESEARCH_LOCK_LONG_HOLD_MS }));
    } else if (lock.ownerStatus === "dead") {
      out.push(finding("RESEARCH_LOCK_OWNER_DEAD", "WARN", "research", "the research lock's owner is dead; it becomes reclaimable once the stale window passes", { ageMs: lock.ageMs, reclaimableInMs: Math.max(0, AYAS_HEALTH_LOCK_STALE_AFTER_MS - lock.ageMs) }));
    } else if (lock.ownerStatus === "unknown") {
      out.push(finding("RESEARCH_LOCK_OWNER_UNVERIFIABLE", "WARN", "research", "the research lock's owner identity could not be verified; it stays held (fail-closed)", { ageMs: lock.ageMs }));
    } else if (lock.ageMs > AYAS_HEALTH_LOCK_STALE_AFTER_MS) {
      // No valid owner record and older than any legitimate publication window: nothing in the lock's own protocol can ever reclaim this, so it needs a human.
      out.push(finding("RESEARCH_LOCK_UNRECOVERABLE", "CRITICAL", "research", "the research lock has no valid owner record and will never be reclaimed automatically — manual removal is required", { ownerRecord: lock.ownerStatus, ageMs: lock.ageMs }));
    } else {
      out.push(finding("RESEARCH_LOCK_OWNER_UNREADABLE_YOUNG", "WARN", "research", "the research lock has no valid owner record yet; this can be transient during acquisition but cannot be reported healthy", { ownerRecord: lock.ownerStatus, ageMs: lock.ageMs }));
    }
  }

  if (!research.state || !(["absent", "unreadable", "ok"] as const).includes(research.state.kind)) {
    out.push(finding("RESEARCH_STATE_UNREADABLE", "WARN", "research", "the research scheduler state fact is missing or invalid"));
    return;
  }
  if (research.state.kind === "absent") {
    out.push(finding("RESEARCH_STATE_ABSENT", "WARN", "research", "no research scheduler state exists — cadence cannot be verified"));
    return;
  }
  if (research.state.kind === "unreadable") {
    out.push(finding("RESEARCH_STATE_UNREADABLE", "WARN", "research", "the research scheduler state exists but could not be read as valid state"));
    return;
  }

  const state = research.state.value;
  if (typeof state !== "object" || state === null || Array.isArray(state)) {
    out.push(finding("RESEARCH_STATE_UNREADABLE", "WARN", "research", "the research scheduler state exists but could not be read as valid state"));
    return;
  }
  const validTimestamp = (value: unknown): value is string | undefined => value === undefined || (typeof value === "string" && Number.isFinite(Date.parse(value)));
  const stateValid = state.schemaVersion === "1" && Number.isSafeInteger(state.consecutiveFailures) && state.consecutiveFailures >= 0
    && validTimestamp(state.nextLightAt) && validTimestamp(state.nextDeepAt)
    && (state.currentRunId === undefined || (typeof state.currentRunId === "string" && state.currentRunId.trim().length > 0))
    && Number.isFinite(research.lightIntervalMs) && research.lightIntervalMs > 0
    && Number.isFinite(research.deepIntervalMs) && research.deepIntervalMs > 0;
  if (!stateValid) {
    out.push(finding("RESEARCH_STATE_UNREADABLE", "WARN", "research", "the research scheduler state exists but could not be read as valid state"));
    return;
  }
  evaluateResearchCadence("LIGHT", state.nextLightAt, research.lightIntervalMs, nowMs, out);
  evaluateResearchCadence("DEEP", state.nextDeepAt, research.deepIntervalMs, nowMs, out);

  const failures = state.consecutiveFailures;
  if (failures >= AYAS_HEALTH_RESEARCH_FAILURE_WARN) {
    out.push(finding("RESEARCH_CONSECUTIVE_FAILURES", failures >= AYAS_HEALTH_RESEARCH_FAILURE_CRITICAL ? "CRITICAL" : "WARN", "research", "research cycles are failing repeatedly (the schedule still advances, so this is a fault, not a retry storm)", { consecutiveFailures: failures, warnAt: AYAS_HEALTH_RESEARCH_FAILURE_WARN, criticalAt: AYAS_HEALTH_RESEARCH_FAILURE_CRITICAL }));
  }

  if (state.currentRunId) {
    const ownerAlive = lock?.ownerStatus === "alive";
    out.push(ownerAlive
      ? finding("RESEARCH_RUN_IN_PROGRESS", "INFO", "research", "a research run is in progress")
      : finding("RESEARCH_RUN_INTERRUPTED", "INFO", "research", "a research run was interrupted; the scheduler recovers its diagnostic fields on the next tick"));
  }
}

function evaluateRepo(repo: AyasHealthRepoFacts, out: AyasHealthFinding[]): void {
  const headOk = repo.head?.kind === "ok" && typeof repo.head.value === "string" && /^[0-9a-f]{40}$/.test(repo.head.value);
  if (!headOk) out.push(finding("REPO_HEAD_UNREADABLE", "WARN", "repo", "Git HEAD could not be read, so repository and Graphify freshness cannot be verified"));
  const cleanOk = repo.clean?.kind === "ok" && typeof repo.clean.value === "boolean";
  if (!cleanOk) out.push(finding("REPO_STATUS_UNREADABLE", "WARN", "repo", "Git worktree status could not be read, so repository cleanliness cannot be verified"));
  else if (!repo.clean.value) out.push(finding("REPO_DIRTY", "WARN", "repo", "the working tree has uncommitted changes, so the fail-closed discovery gate is closed", { clean: false }));
  if (!repo.graph || repo.graph.kind === "unreadable") {
    out.push(finding("GRAPH_METADATA_UNREADABLE", "WARN", "graph", "Graphify branch metadata could not be read, so graph freshness cannot be verified"));
  } else if (repo.graph.kind === "absent") {
    out.push(finding("GRAPH_METADATA_ABSENT", "WARN", "graph", "Graphify branch metadata is absent, so graph freshness cannot be verified"));
  } else if (!/^[0-9a-f]{40}$/.test(repo.graph.value)) {
    out.push(finding("GRAPH_METADATA_UNREADABLE", "WARN", "graph", "Graphify branch metadata does not contain a valid analyzed HEAD"));
  } else if (headOk && repo.graph.value !== repo.head.value) {
    // The daemons' `graphifyFresh` gate (lastAnalyzedHead === HEAD && !stale) closes here too; this finding makes the
    // resulting pause visible and names the refresh that reopens it (Stage 10A).
    out.push(finding("GRAPH_STALE_VS_HEAD", "WARN", "graph", "the Graphify graph was analyzed at a different commit than HEAD, so graph-dependent discovery is paused until `graphify update --scope all --no-description --no-label .` runs", { head: shortSha(repo.head.value), analyzedHead: shortSha(repo.graph.value) }));
  }
}

export function evaluateAyasSelfImprovementHealth(input: AyasSelfImprovementHealthInput): AyasSelfImprovementHealth {
  const nowMs = Date.parse(input.now);
  if (!Number.isFinite(nowMs)) {
    return { verdict: "UNKNOWN", ownerActionRecommended: true, findings: [finding("INPUT_CLOCK_INVALID", "CRITICAL", "input", "the evaluation time is not a valid timestamp, so no age can be computed")] };
  }

  const collected: AyasHealthFinding[] = [];
  evaluateObserver(input.observer, nowMs, collected);
  evaluateResearch(input.research, nowMs, collected);
  evaluateRepo(input.repo, collected);
  const findings = collected.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || compareText(a.subject, b.subject) || compareText(a.code, b.code));

  const has = (code: AyasHealthFindingCode): boolean => findings.some((entry) => entry.code === code);
  const observerDown = has("OBSERVER_STATE_ABSENT") || has("OBSERVER_LOCK_ABSENT") || has("OBSERVER_OWNER_DEAD");
  const verdict: AyasHealthVerdict = observerDown ? "DOWN"
    : has("OBSERVER_STATE_UNREADABLE") ? "UNKNOWN"
      : findings.some((entry) => entry.severity === "CRITICAL") ? "STALLED"
        : findings.some((entry) => entry.severity === "WARN") ? "DEGRADED"
          : "HEALTHY";
  return { verdict, ownerActionRecommended: verdict === "DOWN" || verdict === "STALLED" || verdict === "UNKNOWN", findings };
}
