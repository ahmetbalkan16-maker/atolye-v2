import path from "node:path";

import { createAyasLocalDiscoveryRunLedger, type AyasLocalDiscoveryRunLedger } from "../../brain/autonomy/AyasLocalDiscoveryRunLedger";
import { resolveAyasExecutionAuditRoot } from "../execution/AyasExecutionAuditContext";
import { AyasExecutionAuthorizationStore, type AyasExecutionAuthorizationRecord, type AyasExecutionAuthorizationState } from "../execution/AyasExecutionAuthorization";
import { AyasExecutionGateStore } from "../execution/AyasExecutionGateStore";
import { AYAS_AUTHORIZATION_COMPACTION_DEFAULT_MIN_AGE_MS } from "./AyasAuthorizationCompaction";
import { deriveAyasLeaseEvidence, type AyasOperationEvidence } from "./AyasOperationEvidence";
import { createAyasOperationEvidenceStore, type AyasOperationEvidenceStore } from "./AyasOperationEvidenceStore";
import { summarizeAyasOperationTelemetry, type AyasOperationTelemetry } from "./AyasOperationTelemetry";
import { readAyasReliabilityState } from "./AyasReliabilityState";
import type { AyasReliabilitySloReport } from "./AyasReliabilitySlo";

/**
 * Stage 15F — the live operational state, read-only.
 *
 * One answer to "what is AYAS doing right now and how has it been going":
 * the leases that are outstanding, running or were never settled; the
 * evidence stream; telemetry for a window; the observer's last runs; the
 * execution gate.
 *
 * Every section is read independently and reports `unavailable` with a
 * closed reason code when its source cannot be read. A section never turns
 * an unreadable source into zeros.
 *
 * Nothing is written and nothing is decided here. The values are identifiers,
 * closed enums, counts and times; a lease's plan and intent are never read.
 */
export const AYAS_OPERATIONAL_STATE_MAX_LISTED = 20;
export const AYAS_OPERATIONAL_STATE_DEFAULT_WINDOW_HOURS = 24;
export const AYAS_OPERATIONAL_STATE_MAX_WINDOW_HOURS = 24 * 90;
/** A run still marked RUNNING after this long did not finish: a tick is bounded to minutes. */
export const AYAS_OBSERVER_STUCK_RUN_MS = 30 * 60 * 1000;
/** How late the next expected run may be before it is reported overdue. */
export const AYAS_OBSERVER_OVERDUE_GRACE_MS = 10 * 60 * 1000;

export type AyasStateSection<T> = { readonly status: "ok"; readonly value: T } | { readonly status: "unavailable"; readonly reason: string };

export interface AyasLeaseListing { readonly authorizationId: string; readonly action: string; readonly agent: string; readonly msToExpiry: number; }

export interface AyasLeaseState {
  readonly total: number;
  readonly byState: Readonly<Record<AyasExecutionAuthorizationState, number>>;
  /** Granted, unused, not yet expired. */
  readonly outstanding: readonly AyasLeaseListing[];
  /** Consumed, not settled, not yet expired: work in progress. */
  readonly running: readonly AyasLeaseListing[];
  /** Consumed and never settled, past expiry: the process ended without recording an outcome. */
  readonly unsettledPastExpiry: readonly AyasLeaseListing[];
  readonly counts: { readonly outstanding: number; readonly running: number; readonly unsettledPastExpiry: number; readonly unreadable: number; readonly compactable: number };
  readonly oldestCreatedAt: string | null;
}

export interface AyasEvidenceState { readonly days: number; readonly records: number; readonly rejectedLines: number; }

export interface AyasObserverState {
  readonly runsInWindow: { readonly succeeded: number; readonly failed: number; readonly running: number };
  readonly lastRun: { readonly status: string; readonly startedAt: string; readonly completedAt: string | null; readonly ageMs: number } | null;
  readonly stuckRuns: number;
  readonly nextExpectedAt: string | null;
  readonly overdue: boolean;
}

export interface AyasGateState { readonly state: string; readonly updatedAt: string; }

export interface AyasOperationalState {
  readonly generatedAt: string;
  readonly windowHours: number;
  readonly leases: AyasStateSection<AyasLeaseState>;
  readonly evidence: AyasStateSection<AyasEvidenceState>;
  readonly telemetry: AyasStateSection<AyasOperationTelemetry>;
  readonly observer: AyasStateSection<AyasObserverState>;
  readonly gate: AyasStateSection<AyasGateState>;
  readonly reliability: AyasReliabilitySloReport;
}

export interface AyasOperationalStateOptions {
  /** The audit root (`data/brain` by default). The stores below are resolved under it unless given. */
  readonly rootDir?: string;
  readonly nowMs?: number;
  readonly windowHours?: number;
  readonly authorizations?: Pick<AyasExecutionAuthorizationStore, "scan">;
  readonly evidence?: Pick<AyasOperationEvidenceStore, "read">;
  readonly discoveryLedger?: Pick<AyasLocalDiscoveryRunLedger, "read">;
  readonly gate?: Pick<AyasExecutionGateStore, "read">;
}

const REASON = /^[A-Z][A-Z0-9_]{1,63}$/;

/** A source's own stable error code when it has one; never its message, which may carry a path. */
function section<T>(read: () => T): AyasStateSection<T> {
  try { return { status: "ok", value: read() }; }
  catch (error) {
    const code = (error as { readonly code?: unknown } | null)?.code;
    return { status: "unavailable", reason: typeof code === "string" && REASON.test(code) ? code : "READ_FAILED" };
  }
}

function listing(record: AyasExecutionAuthorizationRecord, evidence: AyasOperationEvidence | undefined, nowMs: number): AyasLeaseListing {
  return { authorizationId: record.authorizationId, action: evidence?.actions[0]?.action ?? "unknown", agent: evidence?.agent ?? "unknown", msToExpiry: Date.parse(record.expiresAt) - nowMs };
}

export function readAyasOperationalState(options: AyasOperationalStateOptions = {}): AyasOperationalState {
  const rootDir = path.resolve(options.rootDir ?? resolveAyasExecutionAuditRoot());
  const nowMs = options.nowMs ?? Date.now();
  if (!Number.isFinite(nowMs) || !Number.isFinite(new Date(nowMs).getTime())) throw new Error("AYAS_OPERATIONAL_CLOCK_INVALID");
  const requested = options.windowHours ?? AYAS_OPERATIONAL_STATE_DEFAULT_WINDOW_HOURS;
  const windowHours = Number.isFinite(requested) && requested > 0 ? Math.min(requested, AYAS_OPERATIONAL_STATE_MAX_WINDOW_HOURS) : AYAS_OPERATIONAL_STATE_DEFAULT_WINDOW_HOURS;
  const sinceMs = nowMs - windowHours * 3_600_000;
  const authorizations = options.authorizations ?? new AyasExecutionAuthorizationStore({ rootDir });
  const evidenceStore = options.evidence ?? createAyasOperationEvidenceStore({ rootDir });
  const ledger = options.discoveryLedger ?? createAyasLocalDiscoveryRunLedger({ rootDir: path.join(rootDir, "self-improvement", "discovery-runs") });
  const gateStore = options.gate ?? new AyasExecutionGateStore({ rootDir });

  // Read once; the lease and telemetry sections both use it.
  const scanned = section(() => authorizations.scan());
  const stream = section(() => evidenceStore.read({ sinceDay: new Date(sinceMs).toISOString().slice(0, 10) }));

  const leases = scanned.status !== "ok" ? scanned : section((): AyasLeaseState => {
    const byState: Record<AyasExecutionAuthorizationState, number> = { granted: 0, consumed: 0, completed: 0, failed: 0, revoked: 0, expired: 0 };
    const outstanding: AyasLeaseListing[] = [];
    const running: AyasLeaseListing[] = [];
    const unsettledPastExpiry: AyasLeaseListing[] = [];
    let compactable = 0;
    for (const record of scanned.value.records) {
      byState[record.state] += 1;
      const pastExpiry = nowMs >= Date.parse(record.expiresAt);
      const awaitingSettle = record.consumedAt !== undefined && record.settledAt === undefined;
      if (!awaitingSettle && nowMs - Date.parse(record.expiresAt) >= AYAS_AUTHORIZATION_COMPACTION_DEFAULT_MIN_AGE_MS && deriveAyasLeaseEvidence(record, nowMs)) compactable += 1;
      const target = record.state === "granted" && !pastExpiry ? outstanding : awaitingSettle ? (pastExpiry ? unsettledPastExpiry : running) : undefined;
      target?.push(listing(record, deriveAyasLeaseEvidence(record, nowMs), nowMs));
    }
    return {
      total: scanned.value.records.length, byState,
      outstanding: outstanding.slice(0, AYAS_OPERATIONAL_STATE_MAX_LISTED), running: running.slice(0, AYAS_OPERATIONAL_STATE_MAX_LISTED),
      // Newest first: the most recent loss is the one to look at.
      unsettledPastExpiry: unsettledPastExpiry.slice(-AYAS_OPERATIONAL_STATE_MAX_LISTED).reverse(),
      counts: { outstanding: outstanding.length, running: running.length, unsettledPastExpiry: unsettledPastExpiry.length, unreadable: scanned.value.unreadable.length, compactable },
      oldestCreatedAt: scanned.value.records[0]?.createdAt ?? null,
    };
  });

  const evidence = stream.status !== "ok" ? stream : section((): AyasEvidenceState => ({ days: stream.value.days.length, records: stream.value.records.length, rejectedLines: stream.value.rejectedLines }));

  // Telemetry needs both sources: a lease is in the store until it is compacted into the stream.
  const telemetry = scanned.status !== "ok" ? scanned : stream.status !== "ok" ? stream : section(() => {
    const live = scanned.value.records.flatMap((record) => { const derived = deriveAyasLeaseEvidence(record, nowMs); return derived ? [derived] : []; });
    return summarizeAyasOperationTelemetry([...stream.value.records, ...live], { sinceMs, untilMs: nowMs });
  });

  const observer = section((): AyasObserverState => {
    const runs = ledger.read().runs;
    const inWindow = runs.filter((run) => { const time = Date.parse(run.completedAt ?? run.startedAt); return time >= sinceMs && time <= nowMs; });
    const last = runs[runs.length - 1];
    const nextExpectedAt = last?.nextExpectedAt ?? null;
    return {
      runsInWindow: { succeeded: inWindow.filter((run) => run.status === "SUCCEEDED").length, failed: inWindow.filter((run) => run.status === "FAILED").length, running: inWindow.filter((run) => run.status === "RUNNING").length },
      lastRun: last ? { status: last.status, startedAt: last.startedAt, completedAt: last.completedAt ?? null, ageMs: nowMs - Date.parse(last.completedAt ?? last.startedAt) } : null,
      stuckRuns: runs.filter((run) => run.status === "RUNNING" && nowMs - Date.parse(run.startedAt) >= AYAS_OBSERVER_STUCK_RUN_MS).length,
      nextExpectedAt, overdue: nextExpectedAt !== null && nowMs > Date.parse(nextExpectedAt) + AYAS_OBSERVER_OVERDUE_GRACE_MS,
    };
  });

  const gate = section((): AyasGateState => { const record = gateStore.read(); return { state: record.state, updatedAt: record.updatedAt }; });

  const reliability = readAyasReliabilityState({ rootDir, authorizations });
  return { generatedAt: new Date(nowMs).toISOString(), windowHours, leases, evidence, telemetry, observer, gate, reliability };
}
