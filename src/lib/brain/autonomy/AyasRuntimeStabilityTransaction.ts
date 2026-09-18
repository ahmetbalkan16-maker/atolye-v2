import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { AyasRuntimeStabilitySnapshot } from "./AyasRuntimeStabilitySnapshot";
import type { AyasRuntimeImpactScope } from "./AyasRuntimeStabilityScope";

/**
 * AYAS RUNTIME STABILITY GUARD — Part C: the durable transaction.
 *
 * A controlled operation is not an instant; it is a window in which the
 * system is knowingly inconsistent (config written but not loaded, service
 * stopped but not restarted). If the process dies inside that window, the
 * next run must be able to tell — deterministically, from disk, not from a
 * human's memory — what was in flight and whether a mutation could have
 * landed. That is the entire reason this file persists anything at all.
 *
 * States, and what each one means for recovery:
 *   PREPARED    — snapshot taken, nothing touched yet. A crash here is free:
 *                 recovery ABANDONs it, because no mutation was possible.
 *   APPLYING    — the mutation may have landed, fully or partially. A crash
 *                 here is the dangerous case: recovery marks it
 *                 RECOVERY_REQUIRED and refuses to guess.
 *   VERIFYING   — mutation finished, invariants being checked. A crash here
 *                 is also RECOVERY_REQUIRED: the change is real but unproven.
 *   COMPLETED / ROLLED_BACK / FAILED / ABANDONED / RECOVERY_REQUIRED — terminal.
 *
 * The state names and the "terminal states are never re-decidable" rule are
 * taken from `AyasApprovalInboxStore`'s proposal lifecycle on purpose: this
 * codebase already has one durable state machine with those semantics, and a
 * second one with subtly different rules would be exactly the kind of drift
 * this guard exists to catch.
 */
export const ayasRuntimeStabilityTransactionSchemaVersion = "1" as const;

export type AyasStabilityTransactionState =
  | "PREPARED"
  | "APPLYING"
  | "VERIFYING"
  | "COMPLETED"
  | "ROLLING_BACK"
  | "ROLLED_BACK"
  | "FAILED"
  | "ABANDONED"
  | "RECOVERY_REQUIRED";

export const AYAS_STABILITY_TERMINAL_STATES: readonly AyasStabilityTransactionState[] = Object.freeze(["COMPLETED", "ROLLED_BACK", "FAILED", "ABANDONED", "RECOVERY_REQUIRED"]);

/** The only legal moves. Anything else is rejected rather than recorded — a state machine that accepts an impossible transition cannot be trusted to describe what happened. */
const LEGAL_TRANSITIONS: Readonly<Record<AyasStabilityTransactionState, readonly AyasStabilityTransactionState[]>> = Object.freeze({
  PREPARED: ["APPLYING", "ABANDONED", "FAILED"],
  APPLYING: ["VERIFYING", "ROLLING_BACK", "FAILED", "RECOVERY_REQUIRED"],
  VERIFYING: ["COMPLETED", "ROLLING_BACK", "FAILED", "RECOVERY_REQUIRED"],
  ROLLING_BACK: ["ROLLED_BACK", "RECOVERY_REQUIRED", "FAILED"],
  COMPLETED: [],
  ROLLED_BACK: [],
  FAILED: [],
  ABANDONED: [],
  RECOVERY_REQUIRED: [],
});

export interface AyasStabilityTransactionEvent {
  readonly at: string;
  readonly state: AyasStabilityTransactionState;
  readonly note?: string;
}

export interface AyasStabilityTransaction {
  readonly schemaVersion: typeof ayasRuntimeStabilityTransactionSchemaVersion;
  readonly transactionId: string;
  readonly operation: string;
  readonly scope: AyasRuntimeImpactScope;
  readonly state: AyasStabilityTransactionState;
  readonly createdAt: string;
  readonly lastUpdatedAt: string;
  /** Owning process identity — lets recovery distinguish "still running elsewhere" from "died mid-flight". */
  readonly ownerPid: number;
  readonly before: AyasRuntimeStabilitySnapshot;
  readonly after?: AyasRuntimeStabilitySnapshot;
  readonly violations?: readonly string[];
  readonly healthFailures?: readonly string[];
  readonly rollbackPerformed?: boolean;
  readonly reason?: string;
  readonly history: readonly AyasStabilityTransactionEvent[];
}

export interface AyasStabilityTransactionLog {
  readonly schemaVersion: typeof ayasRuntimeStabilityTransactionSchemaVersion;
  readonly transactions: readonly AyasStabilityTransaction[];
}

export class AyasStabilityTransactionError extends Error {
  constructor(readonly code: "ILLEGAL_TRANSITION" | "NOT_FOUND" | "STORE_CORRUPT", message: string) {
    super(message);
    this.name = "AyasStabilityTransactionError";
  }
}

export interface AyasStabilityTransactionStoreOptions {
  readonly rootDir?: string;
  readonly now?: () => string;
  readonly pid?: number;
}

export interface AyasStabilityTransactionStore {
  readonly file: string;
  load(): AyasStabilityTransactionLog;
  begin(operation: string, scope: AyasRuntimeImpactScope, before: AyasRuntimeStabilitySnapshot): AyasStabilityTransaction;
  transition(transactionId: string, next: AyasStabilityTransactionState, patch?: Partial<Pick<AyasStabilityTransaction, "after" | "violations" | "healthFailures" | "rollbackPerformed" | "reason">>, note?: string): AyasStabilityTransaction;
  get(transactionId: string): AyasStabilityTransaction | undefined;
}

const EMPTY_LOG: AyasStabilityTransactionLog = { schemaVersion: ayasRuntimeStabilityTransactionSchemaVersion, transactions: [] };

export function createAyasStabilityTransactionStore(options: AyasStabilityTransactionStoreOptions = {}): AyasStabilityTransactionStore {
  const dir = path.resolve(options.rootDir ?? path.join(process.cwd(), "data", "brain", "autonomy", "stability"));
  const file = path.join(dir, "stability-transactions.json");
  const now = options.now ?? (() => new Date().toISOString());
  const ownerPid = options.pid ?? process.pid;

  const load = (): AyasStabilityTransactionLog => {
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8")) as AyasStabilityTransactionLog;
      if (raw?.schemaVersion !== ayasRuntimeStabilityTransactionSchemaVersion || !Array.isArray(raw.transactions)) return EMPTY_LOG;
      return raw;
    } catch (error) {
      // A missing file is the ordinary first-run case. A present-but-unreadable
      // file is not: silently treating a corrupt ledger as "no history" would
      // let an interrupted APPLYING transaction disappear, which is precisely
      // the state recovery must never lose.
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return EMPTY_LOG;
      throw new AyasStabilityTransactionError("STORE_CORRUPT", `stability-transactions.json unreadable: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const write = (log: AyasStabilityTransactionLog): void => {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, `.stability-transactions.${process.pid}.${crypto.randomUUID()}.tmp`);
    try {
      const fd = fs.openSync(tmp, "w");
      try { fs.writeFileSync(fd, `${JSON.stringify(log, null, 2)}\n`, "utf8"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(tmp, file);
    } catch (error) {
      try { fs.rmSync(tmp, { force: true }); } catch { /* fail closed */ }
      throw error;
    }
  };

  return {
    file,
    load,
    get(transactionId) {
      return load().transactions.find((entry) => entry.transactionId === transactionId);
    },
    begin(operation, scope, before) {
      const at = now();
      const transaction: AyasStabilityTransaction = {
        schemaVersion: ayasRuntimeStabilityTransactionSchemaVersion,
        transactionId: `ayas-stability-${crypto.randomUUID()}`,
        operation,
        scope,
        state: "PREPARED",
        createdAt: at,
        lastUpdatedAt: at,
        ownerPid,
        before,
        history: [{ at, state: "PREPARED" }],
      };
      const log = load();
      write({ ...log, transactions: [...log.transactions, transaction] });
      return transaction;
    },
    transition(transactionId, next, patch, note) {
      const log = load();
      const index = log.transactions.findIndex((entry) => entry.transactionId === transactionId);
      if (index < 0) throw new AyasStabilityTransactionError("NOT_FOUND", `transaction ${transactionId} not found`);
      const current = log.transactions[index]!;
      if (!LEGAL_TRANSITIONS[current.state].includes(next)) {
        throw new AyasStabilityTransactionError("ILLEGAL_TRANSITION", `cannot move ${current.state} -> ${next} for ${transactionId}`);
      }
      const at = now();
      const updated: AyasStabilityTransaction = {
        ...current,
        ...patch,
        state: next,
        lastUpdatedAt: at,
        history: [...current.history, { at, state: next, ...(note === undefined ? {} : { note }) }],
      };
      const transactions = [...log.transactions];
      transactions[index] = updated;
      write({ ...log, transactions });
      return updated;
    },
  };
}

export interface AyasStabilityRecoveryOutcome {
  readonly transactionId: string;
  readonly previousState: AyasStabilityTransactionState;
  readonly recoveredState: AyasStabilityTransactionState;
  readonly reason: string;
}

export interface AyasStabilityRecoveryDeps {
  readonly store: AyasStabilityTransactionStore;
  /** Whether a pid is a live process. Injected so the deterministic recovery rule can be tested without spawning anything. */
  readonly isProcessAlive?: (pid: number) => boolean;
  readonly currentPid?: number;
}

/**
 * Deterministic crash recovery. Same input ledger, same output, every time —
 * there is no timeout, no heuristic, and no "probably fine" branch.
 *
 * The rule: a non-terminal transaction whose owning process is gone is
 * resolved by WHERE it died. PREPARED could not have mutated anything, so it
 * is ABANDONED and the system is provably untouched. APPLYING, VERIFYING and
 * ROLLING_BACK all mean a mutation may exist in an unverified state, so they
 * become RECOVERY_REQUIRED — a human-visible terminal state that the guard
 * refuses to auto-resolve, for the same reason
 * `AyasApprovalInboxStore.RECOVERY_REQUIRED` exists: auto-continuing a
 * half-applied change is how one broken subsystem becomes two.
 */
export function recoverInterruptedAyasStabilityTransactions(deps: AyasStabilityRecoveryDeps): readonly AyasStabilityRecoveryOutcome[] {
  const isProcessAlive = deps.isProcessAlive ?? defaultIsProcessAlive;
  const currentPid = deps.currentPid ?? process.pid;
  const outcomes: AyasStabilityRecoveryOutcome[] = [];

  for (const transaction of deps.store.load().transactions) {
    if (AYAS_STABILITY_TERMINAL_STATES.includes(transaction.state)) continue;
    if (transaction.ownerPid === currentPid || isProcessAlive(transaction.ownerPid)) continue;

    const recoveredState: AyasStabilityTransactionState = transaction.state === "PREPARED" ? "ABANDONED" : "RECOVERY_REQUIRED";
    const reason = transaction.state === "PREPARED"
      ? `owner pid ${transaction.ownerPid} gone before any mutation was possible`
      : `owner pid ${transaction.ownerPid} gone during ${transaction.state}; mutation may have landed unverified`;
    deps.store.transition(transaction.transactionId, recoveredState, { reason }, "crash recovery");
    outcomes.push({ transactionId: transaction.transactionId, previousState: transaction.state, recoveredState, reason });
  }

  return Object.freeze(outcomes);
}

function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to another user — alive for
    // our purposes, and treating it as dead would let two processes believe
    // they own the same transaction.
    return (error as NodeJS.ErrnoException)?.code === "EPERM";
  }
}
