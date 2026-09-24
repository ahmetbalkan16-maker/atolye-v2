import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { withAyasExecutionAuthorityLock } from "./AyasExecutionAuthorityLock";
import { processIsAlive, readProcessStartEpochMs } from "./AyasProcessLiveness";
import { hashAyasExperimentEvidence, verifyAyasExperimentEvidence, type AyasExperimentEvidence, type AyasExperimentVerdict } from "./AyasResearchExperimentEvaluation";
import { AYAS_RESEARCH_IMPROVEMENT_SCHEMA_VERSION, type AyasImprovementHypothesis, type AyasLocalGapSnapshot, type AyasResearchRelevance } from "./AyasResearchImprovementLoop";
import type { AyasCapabilityCategory } from "./AyasCapabilityTaxonomy";

/**
 * Stage 8 — durable state of the research → improvement loop. Its own lock
 * root (`research-improvement/`) never contends with the execution gate or
 * the research scheduler. Records use this codebase's atomic temp+fsync+
 * rename convention; evidence packages are content-addressed and write-once.
 * Nothing stored here is an approval, authorization or execution input.
 */
/** `REPLAN_PENDING`: the finding's hypothesis was retired (strategy gone); it is re-planned on the next cycle. */
export type AyasResearchFindingOutcome = "IGNORED" | "NO_LOCAL_BENCHMARK" | "GAP_NOT_MEASURED" | "NO_LOCAL_GAP" | "NEEDS_EXPERIMENT_DESIGN" | "HYPOTHESIS" | "REPLAN_PENDING";

export interface AyasResearchIndexedFinding {
  readonly findingId: string;
  readonly domain: AyasCapabilityCategory | null;
  readonly sourceIds: readonly string[];
  readonly claimFingerprint: string;
  readonly claimTokenHashes: readonly string[];
  readonly relevance: AyasResearchRelevance | "INVALID";
  readonly reasonCode: string;
  readonly duplicateOf?: string;
  readonly outcome: AyasResearchFindingOutcome;
  readonly hypothesisId?: string;
  readonly gap?: { readonly benchmarkId: string; readonly dimension?: string; readonly measuredAtHead?: string; readonly failingTargetCount?: number };
  readonly registryDigest: string;
  readonly processedAt: string;
}

export interface AyasResearchHypothesisEntry {
  readonly hypothesis: AyasImprovementHypothesis;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Last admission refusal that cannot change until HEAD moves; avoids re-deciding it on every tick. */
  readonly settledAdmission?: { readonly head: string; readonly code: string };
  /** A time-based refusal (cool-down, recent evidence) is not re-decided before this instant. */
  readonly deferredUntil?: string;
}

export interface AyasResearchImprovementIndex {
  readonly schemaVersion: typeof AYAS_RESEARCH_IMPROVEMENT_SCHEMA_VERSION;
  readonly revision: number;
  readonly findings: Readonly<Record<string, AyasResearchIndexedFinding>>;
  readonly hypotheses: Readonly<Record<string, AyasResearchHypothesisEntry>>;
  readonly experimentStarts: readonly string[];
  /** `${benchmarkId}@${head}` → measurement attempts, so a failing benchmark is not re-run on every tick. */
  readonly measurementAttempts?: Readonly<Record<string, number>>;
  /** While the daily experiment budget is spent, no admission is attempted before this instant. */
  readonly admissionDeferredUntil?: string;
}

export type AyasExperimentStatus = "RESERVED" | "BASELINE_RUNNING" | "EXPERIMENT_RUNNING" | "COMPLETED" | "UNCERTAIN";

export interface AyasExperimentRecord {
  readonly schemaVersion: typeof AYAS_RESEARCH_IMPROVEMENT_SCHEMA_VERSION;
  readonly experimentId: string;
  readonly hypothesisId: string;
  readonly attemptKey: string;
  readonly attempt: number;
  readonly baseHead: string;
  readonly strategyId: string;
  readonly strategyVersion: number;
  readonly inputsDigest: string;
  readonly status: AyasExperimentStatus;
  readonly reservedAt: string;
  readonly updatedAt: string;
  readonly owner: { readonly pid: number; readonly processStartEpochMs: number; readonly runId: string };
  readonly leaseExpiresAt: string;
  readonly verdict?: AyasExperimentVerdict;
  readonly reasonCodes?: readonly string[];
  readonly evidenceHash?: string;
  readonly completedAt?: string;
  readonly traceId?: string;
  /** OS-TEMP sandbox owned by this attempt; removed by crash recovery if its owner died. */
  readonly sandboxRoot?: string;
}

export interface AyasResearchExperimentBudget {
  readonly maxFindingsPerCycle: number;
  readonly maxGapSnapshotsPerCycle: number;
  readonly maxExperimentsPerCycle: number;
  readonly maxConcurrentExperiments: number;
  readonly maxExperimentsPer24h: number;
  readonly maxAttemptsPerKey: number;
  readonly retryCooldownMs: number;
  readonly experimentLeaseMs: number;
  readonly minExperimentTimeBudgetMs: number;
  readonly minGapSnapshotTimeBudgetMs: number;
  readonly maxIndexedFindings: number;
  readonly maxGapSnapshots: number;
  readonly maxMeasurementAttemptsPerHead: number;
}

export const AYAS_RESEARCH_EXPERIMENT_BUDGET: AyasResearchExperimentBudget = Object.freeze({
  maxFindingsPerCycle: 25,
  maxGapSnapshotsPerCycle: 1,
  maxExperimentsPerCycle: 1,
  maxConcurrentExperiments: 1,
  maxExperimentsPer24h: 3,
  maxAttemptsPerKey: 2,
  retryCooldownMs: 6 * 60 * 60_000,
  experimentLeaseMs: 20 * 60_000,
  minExperimentTimeBudgetMs: 60_000,
  minGapSnapshotTimeBudgetMs: 30_000,
  maxIndexedFindings: 2_000,
  maxGapSnapshots: 20,
  maxMeasurementAttemptsPerHead: 2,
});

export class AyasResearchExperimentStoreError extends Error {
  constructor(readonly code: "AYAS_RESEARCH_EXPERIMENT_CORRUPT" | "AYAS_RESEARCH_EXPERIMENT_INVALID" | "AYAS_RESEARCH_EXPERIMENT_IO", message: string) {
    super(message);
    this.name = "AyasResearchExperimentStoreError";
    this.stack = undefined;
  }
}

const ACTIVE = new Set<AyasExperimentStatus>(["RESERVED", "BASELINE_RUNNING", "EXPERIMENT_RUNNING"]);
const NEGATIVE = new Set<AyasExperimentVerdict>(["NEUTRAL", "REGRESSED", "INVALID_EXPERIMENT", "UNSAFE"]);
/** An invalid run caused by the live workspace moving says nothing about the hypothesis; it is retried like an inconclusive one. */
const TRANSIENT_INVALID_REASONS = new Set(["BASE_HEAD_MOVED", "LIVE_WORKSPACE_CHANGED"]);

function isRetryableAttempt(record: AyasExperimentRecord): boolean {
  if (record.status === "UNCERTAIN") return true;
  if (record.status !== "COMPLETED") return false;
  return record.verdict === "INCONCLUSIVE" || (record.verdict === "INVALID_EXPERIMENT" && (record.reasonCodes ?? []).some((code) => TRANSIENT_INVALID_REASONS.has(code)));
}

function isNegativeResult(record: AyasExperimentRecord): boolean {
  return record.status === "COMPLETED" && record.verdict !== undefined && NEGATIVE.has(record.verdict) && !isRetryableAttempt(record);
}
const EXPERIMENT_ID = /^ayas-experiment-[0-9a-f-]{36}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const DAY_MS = 24 * 60 * 60_000;

export function isAyasExperimentActive(record: AyasExperimentRecord): boolean {
  return ACTIVE.has(record.status);
}

export type AyasExperimentAdmission =
  | { readonly admit: true; readonly attempt: number }
  | { readonly admit: false; readonly code: "ACTIVE_EXPERIMENT" | "CONCURRENCY_LIMIT" | "CYCLE_LIMIT" | "DAILY_LIMIT" | "NEGATIVE_RESULT_KNOWN" | "OWNER_REJECTED" | "EVIDENCE_CURRENT" | "EVIDENCE_RECENT" | "ATTEMPTS_EXHAUSTED" | "RETRY_COOLDOWN";
      /** For time-based refusals: when the same decision could first change, so idle ticks need not re-decide. */
      readonly retryAt?: string };

/**
 * Phases 20–22 as one pure rule. A negative result is remembered for the same
 * inputs across HEADs (no blind repetition); an owner rejection is honoured for
 * the same inputs; an interrupted or inconclusive attempt may be retried only
 * after a cool-down and within a fixed attempt budget (a run invalidated only
 * because the live workspace moved does not spend that budget); an improvement
 * is re-validated at a new HEAD at most once per day.
 */
export function decideAyasExperimentAdmission(input: {
  readonly attemptKey: string;
  readonly baseHead: string;
  readonly records: readonly AyasExperimentRecord[];
  /** Attempt keys whose evidence proposal the owner rejected. */
  readonly rejectedAttemptKeys?: ReadonlySet<string>;
  readonly experimentStarts: readonly string[];
  readonly startedThisCycle: number;
  readonly nowIso: string;
  readonly budget: AyasResearchExperimentBudget;
}): AyasExperimentAdmission {
  const { budget } = input;
  const nowMs = Date.parse(input.nowIso);
  const sameKey = input.records.filter((record) => record.attemptKey === input.attemptKey);
  if (sameKey.some(isAyasExperimentActive)) return { admit: false, code: "ACTIVE_EXPERIMENT" };
  if (input.records.filter(isAyasExperimentActive).length >= budget.maxConcurrentExperiments) return { admit: false, code: "CONCURRENCY_LIMIT" };
  if (input.startedThisCycle >= budget.maxExperimentsPerCycle) return { admit: false, code: "CYCLE_LIMIT" };
  const windowStarts = input.experimentStarts.map((at) => Date.parse(at)).filter((at) => nowMs - at < DAY_MS).sort((a, b) => a - b);
  if (windowStarts.length >= budget.maxExperimentsPer24h) return { admit: false, code: "DAILY_LIMIT", ...(windowStarts[0] === undefined ? {} : { retryAt: new Date(windowStarts[0] + DAY_MS).toISOString() }) };
  if (sameKey.some(isNegativeResult)) return { admit: false, code: "NEGATIVE_RESULT_KNOWN" };
  if (input.rejectedAttemptKeys?.has(input.attemptKey)) return { admit: false, code: "OWNER_REJECTED" };
  const improved = sameKey.filter((record) => record.status === "COMPLETED" && record.verdict === "IMPROVED");
  if (improved.some((record) => record.baseHead === input.baseHead)) return { admit: false, code: "EVIDENCE_CURRENT" };
  const lastImproved = improved.map((record) => Date.parse(record.completedAt ?? record.updatedAt)).sort((a, b) => b - a)[0];
  if (lastImproved !== undefined && nowMs - lastImproved < DAY_MS) return { admit: false, code: "EVIDENCE_RECENT", retryAt: new Date(lastImproved + DAY_MS).toISOString() };
  const retryable = sameKey.filter(isRetryableAttempt);
  const spent = sameKey.filter((record) => record.status === "UNCERTAIN" || (record.status === "COMPLETED" && record.verdict === "INCONCLUSIVE"));
  // Workspace-moved runs get a separate, larger allowance: an owner editing during runs must not kill a
  // hypothesis quickly, and nothing — including an experiment that caused the change — retries forever.
  const workspaceMoved = retryable.filter((record) => record.status === "COMPLETED" && record.verdict === "INVALID_EXPERIMENT");
  if (spent.length >= budget.maxAttemptsPerKey || workspaceMoved.length >= budget.maxAttemptsPerKey * 2) return { admit: false, code: "ATTEMPTS_EXHAUSTED" };
  const lastRetryable = retryable.map((record) => Date.parse(record.updatedAt)).sort((a, b) => b - a)[0];
  if (lastRetryable !== undefined && nowMs - lastRetryable < budget.retryCooldownMs) return { admit: false, code: "RETRY_COOLDOWN", retryAt: new Date(lastRetryable + budget.retryCooldownMs).toISOString() };
  return { admit: true, attempt: sameKey.length + 1 };
}

function emptyIndex(): AyasResearchImprovementIndex {
  return { schemaVersion: AYAS_RESEARCH_IMPROVEMENT_SCHEMA_VERSION, revision: 0, findings: {}, hypotheses: {}, experimentStarts: [] };
}

function writeAtomic(target: string, text: string, exclusive = false): void {
  const dir = path.dirname(target);
  fs.mkdirSync(dir, { recursive: true });
  if (exclusive) {
    const fd = fs.openSync(target, "wx");
    try { fs.writeFileSync(fd, text, "utf8"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    return;
  }
  const tmp = path.join(dir, `.${path.basename(target)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  try {
    const fd = fs.openSync(tmp, "wx");
    try { fs.writeFileSync(fd, text, "utf8"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, target);
  } catch (error) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* fail closed */ }
    throw new AyasResearchExperimentStoreError("AYAS_RESEARCH_EXPERIMENT_IO", error instanceof Error ? error.message : String(error));
  }
}

function isRecord(value: unknown): value is AyasExperimentRecord {
  const record = value as AyasExperimentRecord | null;
  return !!record && record.schemaVersion === AYAS_RESEARCH_IMPROVEMENT_SCHEMA_VERSION && EXPERIMENT_ID.test(String(record.experimentId))
    && HEX64.test(String(record.attemptKey)) && /^[0-9a-f]{40}$/.test(String(record.baseHead)) && ["RESERVED", "BASELINE_RUNNING", "EXPERIMENT_RUNNING", "COMPLETED", "UNCERTAIN"].includes(record.status)
    && Number.isSafeInteger(record.owner?.pid);
}

export interface AyasResearchExperimentStoreOptions { readonly rootDir?: string }

export interface AyasResearchExperimentStore {
  readonly dir: string;
  withLock<T>(operation: () => Promise<T>): Promise<T>;
  loadIndex(): AyasResearchImprovementIndex;
  saveIndex(index: AyasResearchImprovementIndex): AyasResearchImprovementIndex;
  listExperiments(): readonly AyasExperimentRecord[];
  readExperiment(experimentId: string): AyasExperimentRecord | undefined;
  writeExperiment(record: AyasExperimentRecord): void;
  writeEvidence(evidence: AyasExperimentEvidence): string;
  readEvidence(evidenceHash: string): AyasExperimentEvidence | undefined;
  listGapSnapshots(): readonly AyasLocalGapSnapshot[];
  writeGapSnapshot(snapshot: AyasLocalGapSnapshot, maxSnapshots: number): void;
}

/** Default root sits beside the research store: `data/brain/self-improvement/research-improvement/`. */
export function resolveAyasResearchImprovementRoot(repoRoot: string = process.cwd()): string {
  return path.join(repoRoot, "data", "brain", "self-improvement", "research-improvement");
}

export function createAyasResearchExperimentStore(options: AyasResearchExperimentStoreOptions = {}): AyasResearchExperimentStore {
  const dir = path.resolve(options.rootDir ?? resolveAyasResearchImprovementRoot());
  const indexFile = path.join(dir, "index.json");
  const experimentsDir = path.join(dir, "experiments");
  const evidenceDir = path.join(dir, "evidence");
  const snapshotsDir = path.join(dir, "gap-snapshots");

  const listGapSnapshots = (): readonly AyasLocalGapSnapshot[] => {
    if (!fs.existsSync(snapshotsDir)) return [];
    const out: AyasLocalGapSnapshot[] = [];
    for (const name of fs.readdirSync(snapshotsDir)) {
      if (!name.endsWith(".json") || name.startsWith(".")) continue;
      try {
        const parsed = JSON.parse(fs.readFileSync(path.join(snapshotsDir, name), "utf8")) as AyasLocalGapSnapshot;
        if (parsed?.schemaVersion === AYAS_RESEARCH_IMPROVEMENT_SCHEMA_VERSION && /^[0-9a-f]{40}$/.test(parsed.measuredAtHead) && HEX64.test(parsed.evaluatorSha256)) out.push(parsed);
      } catch { /* skip corrupt snapshot */ }
    }
    return out.sort((a, b) => b.measuredAt.localeCompare(a.measuredAt));
  };

  const listExperiments = (): readonly AyasExperimentRecord[] => {
    if (!fs.existsSync(experimentsDir)) return [];
    const out: AyasExperimentRecord[] = [];
    for (const name of fs.readdirSync(experimentsDir)) {
      if (!name.endsWith(".json") || name.startsWith(".")) continue;
      try {
        const parsed = JSON.parse(fs.readFileSync(path.join(experimentsDir, name), "utf8")) as unknown;
        if (isRecord(parsed) && `${parsed.experimentId}.json` === name) out.push(parsed);
      } catch { /* a corrupt record never hides the rest */ }
    }
    return out.sort((a, b) => a.reservedAt.localeCompare(b.reservedAt) || a.experimentId.localeCompare(b.experimentId));
  };

  return {
    dir,
    withLock: (operation) => withAyasExecutionAuthorityLock(dir, operation),
    loadIndex() {
      if (!fs.existsSync(indexFile)) return emptyIndex();
      let parsed: AyasResearchImprovementIndex;
      try { parsed = JSON.parse(fs.readFileSync(indexFile, "utf8")) as AyasResearchImprovementIndex; }
      catch { throw new AyasResearchExperimentStoreError("AYAS_RESEARCH_EXPERIMENT_CORRUPT", "research improvement index is not valid JSON"); }
      if (parsed?.schemaVersion !== AYAS_RESEARCH_IMPROVEMENT_SCHEMA_VERSION || !Number.isSafeInteger(parsed.revision) || !parsed.findings || typeof parsed.findings !== "object" || !parsed.hypotheses || typeof parsed.hypotheses !== "object" || !Array.isArray(parsed.experimentStarts)) {
        throw new AyasResearchExperimentStoreError("AYAS_RESEARCH_EXPERIMENT_CORRUPT", "research improvement index is structurally invalid");
      }
      return parsed;
    },
    saveIndex(index) {
      const next = { ...index, revision: index.revision + 1 };
      writeAtomic(indexFile, `${JSON.stringify(next, null, 2)}\n`);
      return next;
    },
    listExperiments,
    readExperiment(experimentId) {
      if (!EXPERIMENT_ID.test(experimentId)) return undefined;
      try {
        const parsed = JSON.parse(fs.readFileSync(path.join(experimentsDir, `${experimentId}.json`), "utf8")) as unknown;
        return isRecord(parsed) && parsed.experimentId === experimentId ? parsed : undefined;
      } catch { return undefined; }
    },
    writeExperiment(record) {
      if (!isRecord(record)) throw new AyasResearchExperimentStoreError("AYAS_RESEARCH_EXPERIMENT_INVALID", "experiment record is structurally invalid");
      writeAtomic(path.join(experimentsDir, `${record.experimentId}.json`), `${JSON.stringify(record, null, 2)}\n`);
    },
    writeEvidence(evidence) {
      const evidenceHash = hashAyasExperimentEvidence(evidence);
      if (!verifyAyasExperimentEvidence(evidence, evidenceHash)) throw new AyasResearchExperimentStoreError("AYAS_RESEARCH_EXPERIMENT_INVALID", "evidence package failed verification");
      const target = path.join(evidenceDir, `${evidenceHash}.json`);
      const stored = (): boolean => { try { return verifyAyasExperimentEvidence(JSON.parse(fs.readFileSync(target, "utf8")), evidenceHash); } catch { return false; } };
      if (stored()) return evidenceHash;
      try { writeAtomic(target, JSON.stringify(evidence), true); }
      catch (error) {
        // EEXIST is only benign when it is this very package already on disk (a concurrent identical write).
        if ((error as NodeJS.ErrnoException).code === "EEXIST" && stored()) return evidenceHash;
        throw new AyasResearchExperimentStoreError("AYAS_RESEARCH_EXPERIMENT_IO", error instanceof Error ? error.message : String(error));
      }
      if (!stored()) throw new AyasResearchExperimentStoreError("AYAS_RESEARCH_EXPERIMENT_IO", "evidence package did not persist");
      return evidenceHash;
    },
    readEvidence(evidenceHash) {
      if (!HEX64.test(evidenceHash)) return undefined;
      try {
        const parsed = JSON.parse(fs.readFileSync(path.join(evidenceDir, `${evidenceHash}.json`), "utf8")) as unknown;
        return verifyAyasExperimentEvidence(parsed, evidenceHash) ? parsed : undefined;
      } catch { return undefined; }
    },
    listGapSnapshots,
    writeGapSnapshot(snapshot, maxSnapshots) {
      if (!/^[a-z0-9-]{1,64}$/.test(snapshot.benchmarkId) || !/^[0-9a-f]{40}$/.test(snapshot.measuredAtHead)) throw new AyasResearchExperimentStoreError("AYAS_RESEARCH_EXPERIMENT_INVALID", "gap snapshot identity is invalid");
      writeAtomic(path.join(snapshotsDir, `${snapshot.benchmarkId}-${snapshot.measuredAtHead}.json`), `${JSON.stringify(snapshot, null, 2)}\n`);
      for (const stale of listGapSnapshots().slice(Math.max(1, maxSnapshots))) {
        try { fs.rmSync(path.join(snapshotsDir, `${stale.benchmarkId}-${stale.measuredAtHead}.json`), { force: true }); } catch { /* bounded best effort */ }
      }
    },
  };
}

/**
 * Crash recovery: an active record whose owner process is gone (PID plus
 * start time) or whose lease expired becomes UNCERTAIN. It is never promoted
 * and never retried in the same breath — admission applies a cool-down.
 * Must run under the store lock.
 */
export async function reconcileAyasInterruptedExperiments(store: AyasResearchExperimentStore, nowIso: string): Promise<readonly string[]> {
  const reconciled: string[] = [];
  for (const record of store.listExperiments()) {
    if (!isAyasExperimentActive(record)) continue;
    let alive = processIsAlive(record.owner.pid);
    if (alive) {
      try { alive = Math.abs((await readProcessStartEpochMs(record.owner.pid)) - record.owner.processStartEpochMs) <= 1_000; }
      catch { alive = true; }
    }
    if (alive && Date.parse(nowIso) < Date.parse(record.leaseExpiresAt)) continue;
    store.writeExperiment({ ...record, status: "UNCERTAIN", updatedAt: nowIso, reasonCodes: ["EXPERIMENT_INTERRUPTED"] });
    reconciled.push(record.experimentId);
  }
  return reconciled;
}
