import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Durable, bounded evidence that the local self-improvement loop actually ran.
 * One record answers the important distinction between "the loop is down" and
 * "the loop ran successfully and found nothing worth proposing" without
 * retaining raw traces or external content.
 */
export const ayasLocalDiscoveryRunSchemaVersion = "1" as const;
export const AYAS_LOCAL_DISCOVERY_RECENT_RUN_LIMIT = 50;

export type AyasLocalDiscoveryRunStatus = "RUNNING" | "SUCCEEDED" | "FAILED";

export interface AyasLocalDiscoveryRun {
  readonly schemaVersion: typeof ayasLocalDiscoveryRunSchemaVersion;
  readonly runId: string;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly nextExpectedAt?: string;
  readonly status: AyasLocalDiscoveryRunStatus;
  readonly baseHead: string;
  readonly candidateCount: number;
  readonly proposalCount: number;
  readonly duplicateCount: number;
  readonly staleProposalCount: number;
  readonly staleBatchCount: number;
  readonly researchOutcome?: "NONE_DUE" | "ANOTHER_RUN_ACTIVE" | "LIGHT" | "DEEP" | "DISABLED" | "ERROR";
  /** Stable local code only; never a raw exception or external-content string. */
  readonly failureCode?: "LOCAL_DISCOVERY_FAILED";
}

export interface AyasLocalDiscoveryRunLedgerState {
  readonly schemaVersion: typeof ayasLocalDiscoveryRunSchemaVersion;
  readonly revision: number;
  readonly runs: readonly AyasLocalDiscoveryRun[];
}

export class AyasLocalDiscoveryRunLedgerError extends Error {
  constructor(readonly code: "AYAS_DISCOVERY_LEDGER_CORRUPT" | "AYAS_DISCOVERY_LEDGER_IO" | "AYAS_DISCOVERY_LEDGER_INVALID", message: string) {
    super(message);
    this.name = "AyasLocalDiscoveryRunLedgerError";
    this.stack = undefined;
  }
}

export interface AyasLocalDiscoveryRunLedgerOptions { readonly rootDir?: string }

export interface AyasLocalDiscoveryRunLedger {
  readonly stateFile: string;
  read(): AyasLocalDiscoveryRunLedgerState;
  start(input: { readonly startedAt: string; readonly baseHead: string; readonly nextExpectedAt?: string }): AyasLocalDiscoveryRun;
  complete(runId: string, input: Omit<AyasLocalDiscoveryRun, "schemaVersion" | "runId" | "startedAt" | "baseHead" | "nextExpectedAt" | "status" | "failureCode"> & { readonly completedAt: string; readonly researchOutcome?: AyasLocalDiscoveryRun["researchOutcome"] }): AyasLocalDiscoveryRun;
  fail(runId: string, completedAt: string): AyasLocalDiscoveryRun;
}

const emptyState = (): AyasLocalDiscoveryRunLedgerState => ({ schemaVersion: ayasLocalDiscoveryRunSchemaVersion, revision: 0, runs: [] });
const isIso = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
const isCount = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;

function assertRun(value: unknown): asserts value is AyasLocalDiscoveryRun {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AyasLocalDiscoveryRunLedgerError("AYAS_DISCOVERY_LEDGER_CORRUPT", "run entry is not an object");
  const run = value as Partial<AyasLocalDiscoveryRun>;
  if (run.schemaVersion !== ayasLocalDiscoveryRunSchemaVersion || typeof run.runId !== "string" || !run.runId.startsWith("ayas-local-discovery-") || !isIso(run.startedAt) || typeof run.baseHead !== "string" || !run.baseHead.trim()) {
    throw new AyasLocalDiscoveryRunLedgerError("AYAS_DISCOVERY_LEDGER_CORRUPT", "run identity is invalid");
  }
  if (!(["RUNNING", "SUCCEEDED", "FAILED"] as const).includes(run.status as AyasLocalDiscoveryRunStatus)) throw new AyasLocalDiscoveryRunLedgerError("AYAS_DISCOVERY_LEDGER_CORRUPT", "run status is invalid");
  if (run.completedAt !== undefined && !isIso(run.completedAt)) throw new AyasLocalDiscoveryRunLedgerError("AYAS_DISCOVERY_LEDGER_CORRUPT", "run completion timestamp is invalid");
  if (run.nextExpectedAt !== undefined && !isIso(run.nextExpectedAt)) throw new AyasLocalDiscoveryRunLedgerError("AYAS_DISCOVERY_LEDGER_CORRUPT", "next expected timestamp is invalid");
  for (const count of [run.candidateCount, run.proposalCount, run.duplicateCount, run.staleProposalCount, run.staleBatchCount]) {
    if (!isCount(count)) throw new AyasLocalDiscoveryRunLedgerError("AYAS_DISCOVERY_LEDGER_CORRUPT", "run counter is invalid");
  }
}

export function createAyasLocalDiscoveryRunLedger(options: AyasLocalDiscoveryRunLedgerOptions = {}): AyasLocalDiscoveryRunLedger {
  const dir = path.resolve(options.rootDir ?? path.join(process.cwd(), "data", "brain", "self-improvement", "discovery-runs"));
  const stateFile = path.join(dir, "ledger.json");

  const read = (): AyasLocalDiscoveryRunLedgerState => {
    if (!fs.existsSync(stateFile)) return emptyState();
    let parsed: unknown;
    try { parsed = JSON.parse(fs.readFileSync(stateFile, "utf8")); } catch { throw new AyasLocalDiscoveryRunLedgerError("AYAS_DISCOVERY_LEDGER_CORRUPT", "ledger is not valid JSON"); }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new AyasLocalDiscoveryRunLedgerError("AYAS_DISCOVERY_LEDGER_CORRUPT", "ledger has an invalid shape");
    const state = parsed as Partial<AyasLocalDiscoveryRunLedgerState>;
    if (state.schemaVersion !== ayasLocalDiscoveryRunSchemaVersion || !Number.isSafeInteger(state.revision) || Number(state.revision) < 0 || !Array.isArray(state.runs)) {
      throw new AyasLocalDiscoveryRunLedgerError("AYAS_DISCOVERY_LEDGER_CORRUPT", "ledger schema is invalid");
    }
    state.runs.forEach(assertRun);
    return state as AyasLocalDiscoveryRunLedgerState;
  };

  const write = (state: AyasLocalDiscoveryRunLedgerState): AyasLocalDiscoveryRunLedgerState => {
    const next = { ...state, revision: state.revision + 1, runs: state.runs.slice(-AYAS_LOCAL_DISCOVERY_RECENT_RUN_LIMIT) };
    const tmp = path.join(dir, `.ledger.${process.pid}.${crypto.randomUUID()}.tmp`);
    try {
      fs.mkdirSync(dir, { recursive: true });
      const fd = fs.openSync(tmp, "wx");
      try { fs.writeFileSync(fd, `${JSON.stringify(next, null, 2)}\n`, "utf8"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(tmp, stateFile);
      return next;
    } catch {
      try { fs.rmSync(tmp, { force: true }); } catch { /* best effort */ }
      throw new AyasLocalDiscoveryRunLedgerError("AYAS_DISCOVERY_LEDGER_IO", "unable to persist local discovery ledger");
    }
  };

  const replace = (runId: string, update: (run: AyasLocalDiscoveryRun) => AyasLocalDiscoveryRun): AyasLocalDiscoveryRun => {
    const state = read();
    const current = state.runs.find((run) => run.runId === runId);
    if (!current) throw new AyasLocalDiscoveryRunLedgerError("AYAS_DISCOVERY_LEDGER_INVALID", "run not found");
    if (current.status !== "RUNNING") throw new AyasLocalDiscoveryRunLedgerError("AYAS_DISCOVERY_LEDGER_INVALID", "run is already terminal");
    const updated = update(current);
    write({ ...state, runs: state.runs.map((run) => run.runId === runId ? updated : run) });
    return updated;
  };

  return {
    stateFile,
    read,
    start(input) {
      const state = read();
      const run: AyasLocalDiscoveryRun = {
        schemaVersion: ayasLocalDiscoveryRunSchemaVersion,
        runId: `ayas-local-discovery-${crypto.randomUUID()}`,
        startedAt: input.startedAt,
        ...(input.nextExpectedAt ? { nextExpectedAt: input.nextExpectedAt } : {}),
        status: "RUNNING",
        baseHead: input.baseHead,
        candidateCount: 0,
        proposalCount: 0,
        duplicateCount: 0,
        staleProposalCount: 0,
        staleBatchCount: 0,
      };
      write({ ...state, runs: [...state.runs, run] });
      return run;
    },
    complete(runId, input) {
      return replace(runId, (run) => ({ ...run, ...input, status: "SUCCEEDED" }));
    },
    fail(runId, completedAt) {
      return replace(runId, (run) => ({ ...run, status: "FAILED", completedAt, failureCode: "LOCAL_DISCOVERY_FAILED" }));
    },
  };
}
