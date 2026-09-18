import { resolveAyasResearchSourcePolicy, resolveAyasResearchSourceRegistry, type AyasResearchSource } from "./AyasResearchSourceRegistry";
import { createAyasResearchSourceStateStore, type AyasResearchSourceCheckState, type AyasResearchSourceStateStore } from "./AyasResearchSourceStateStore";

/**
 * AYAS EXTERNAL RESEARCH INTELLIGENCE sprint — turns per-source check state
 * into a health verdict a human can act on.
 *
 * The motivating failure is precise: four official sources failed three
 * consecutive cycles each, and the only visible trace was an error string
 * repeated in four separate state files. Nothing said "four of your sources
 * have been blind for a day"; nothing distinguished "the network blipped"
 * from "this endpoint is permanently gone". Repeated failure has to become
 * EVIDENCE, not just a field that keeps getting overwritten.
 *
 * Read-only by construction — this module has no writer and no network
 * code. It is the same shape as every other `Ayas*View`-style projection in
 * this codebase: it reads durable state and reports, and it can never
 * change what it is reporting on.
 */
export type AyasResearchSourceHealthStatus = "HEALTHY" | "DEGRADED" | "FAILED" | "NEVER_CHECKED";

/** Stable, safe reason codes. Deliberately never carries raw transport detail (no URLs with credentials, no headers, no response bodies) — a health report is something that gets pasted into an issue or a report. */
export type AyasResearchSourceHealthReason =
  | "OK"
  | "OK_TRUNCATED_PREFIX"
  | "NEVER_CHECKED"
  | "TRANSIENT_FAILURE"
  | "RATE_LIMITED"
  | "ENDPOINT_FAILURE"
  | "UNSUPPORTED_CONTENT"
  | "POLICY_REFUSED"
  | "UNCLASSIFIED_FAILURE";

export interface AyasResearchSourceHealthEntry {
  readonly sourceId: string;
  readonly provider: string;
  readonly category: string;
  readonly officialSource: boolean;
  readonly status: AyasResearchSourceHealthStatus;
  readonly reason: AyasResearchSourceHealthReason;
  readonly consecutiveFailures: number;
  readonly lastCheckedAt?: string;
  readonly lastSuccessAt?: string;
  readonly lastChangedAt?: string;
  /** True when the last good read was a bounded prefix of a large feed. Reported because it is worth knowing, NOT because it is a problem. */
  readonly readTruncated?: boolean;
}

export interface AyasResearchSourceHealthReport {
  readonly generatedAt: string;
  readonly totalSources: number;
  readonly healthy: number;
  readonly degraded: number;
  readonly failed: number;
  readonly neverChecked: number;
  readonly entries: readonly AyasResearchSourceHealthEntry[];
}

function reasonFor(state: AyasResearchSourceCheckState | undefined): AyasResearchSourceHealthReason {
  if (!state) return "NEVER_CHECKED";
  if (state.status !== "ERROR") return state.lastReadTruncated === true ? "OK_TRUNCATED_PREFIX" : "OK";
  switch (state.lastFailureClass) {
    case "TRANSIENT": return "TRANSIENT_FAILURE";
    case "RATE_LIMIT": return "RATE_LIMITED";
    case "PERMANENT_ENDPOINT": return "ENDPOINT_FAILURE";
    case "UNSUPPORTED_CONTENT": return "UNSUPPORTED_CONTENT";
    case "POLICY": return "POLICY_REFUSED";
    default: return "UNCLASSIFIED_FAILURE"; // a record written before failure classes existed
  }
}

export function assessAyasResearchSourceHealth(source: AyasResearchSource, state: AyasResearchSourceCheckState | undefined): AyasResearchSourceHealthEntry {
  const policy = resolveAyasResearchSourcePolicy(source);
  const reason = reasonFor(state);
  const consecutiveFailures = state?.consecutiveFailures ?? 0;

  let status: AyasResearchSourceHealthStatus;
  if (!state) {
    status = "NEVER_CHECKED";
  } else if (state.status !== "ERROR") {
    status = "HEALTHY";
  } else if (consecutiveFailures >= policy.failedAfterConsecutiveFailures) {
    // Sustained failure is FAILED regardless of class: even a "transient"
    // error that has recurred every cycle for a day has stopped being
    // transient in any sense that matters to the owner.
    status = "FAILED";
  } else {
    status = "DEGRADED";
  }

  return {
    sourceId: source.sourceId,
    provider: source.provider,
    category: source.category,
    officialSource: source.officialSource,
    status,
    reason,
    consecutiveFailures,
    lastCheckedAt: state?.lastCheckedAt,
    lastSuccessAt: state?.lastSuccessAt,
    lastChangedAt: state?.lastChangedAt,
    ...(state?.lastReadTruncated === undefined ? {} : { readTruncated: state.lastReadTruncated }),
  };
}

export interface AyasResearchSourceHealthDeps {
  readonly sources?: readonly AyasResearchSource[];
  readonly stateStore?: AyasResearchSourceStateStore;
  readonly now?: () => string;
}

export function loadAyasResearchSourceHealthReport(deps: AyasResearchSourceHealthDeps = {}): AyasResearchSourceHealthReport {
  const sources = deps.sources ?? resolveAyasResearchSourceRegistry();
  const stateStore = deps.stateStore ?? createAyasResearchSourceStateStore();
  const now = deps.now ?? (() => new Date().toISOString());

  const entries = sources.map((source) => {
    let state: AyasResearchSourceCheckState | undefined;
    try { state = stateStore.read(source.sourceId); } catch { state = undefined; } // an unreadable record reports NEVER_CHECKED, never takes the report down
    return assessAyasResearchSourceHealth(source, state);
  });

  return {
    generatedAt: now(),
    totalSources: entries.length,
    healthy: entries.filter((e) => e.status === "HEALTHY").length,
    degraded: entries.filter((e) => e.status === "DEGRADED").length,
    failed: entries.filter((e) => e.status === "FAILED").length,
    neverChecked: entries.filter((e) => e.status === "NEVER_CHECKED").length,
    entries,
  };
}
