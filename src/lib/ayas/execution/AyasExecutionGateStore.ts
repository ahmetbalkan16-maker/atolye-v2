/**
 * AYAS Execution Gate — durable store (AYAS MASTER FULL ACTIVATION sprint).
 *
 *   data/brain/execution/gate.json          { schemaVersion, sequence, state, activationAuthorizationId?, updatedAt }
 *   data/brain/execution/gate-log/<seq>.json append-once transition record
 *
 * Properties (spec §6, §10, §21):
 *  - **Fail-closed default.** No `gate.json` → the gate is `CLOSED`.
 *  - **Atomic write.** temp file → `fsync` → `rename` (same idiom as `BrainTaskStore`).
 *  - **Monotonic sequence.** Every accepted transition bumps `sequence` by exactly 1.
 *  - **Replay-safe.** `transition({ expectedSequence })` refuses a stale caller
 *    (`AYAS_EXECUTION_GATE_SEQUENCE_CONFLICT`) — a replayed request cannot re-fire.
 *  - **Append-only audit.** `gate-log/<seq>.json` is written with an exclusive
 *    open (`wx`); a duplicate sequence is `AYAS_EXECUTION_GATE_LOG_CONFLICT`.
 *  - **Corrupt = loud, and still fail-closed.** A malformed `gate.json` throws on
 *    an explicit read, and `readGateStateFailClosed()` degrades to `CLOSED` for a
 *    *decision* without ever overwriting the file.
 *  - **Crash-safe.** A crash mid-write leaves the previous `gate.json` intact; a
 *    leftover temp file is ignored on the next read.
 *  - **Restart-safe.** All state is in the files; a fresh store instance reloads it.
 *  - **fault always lands CLOSED**, whatever the persisted state was.
 *
 * This store runs nothing. It only records the gate's position.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import {
  AYAS_EXECUTION_GATE_DEFAULT,
  ayasExecutionGateSchemaVersion,
  nextAyasExecutionGateState,
  type AyasExecutionGateEvent,
  type AyasExecutionGateState,
  type AyasExecutionGateTransitionContext,
} from "./AyasExecutionGate";

export type AyasExecutionGateStoreErrorCode =
  | "AYAS_EXECUTION_GATE_IO"
  | "AYAS_EXECUTION_GATE_CORRUPT"
  | "AYAS_EXECUTION_GATE_SCHEMA_MISMATCH"
  | "AYAS_EXECUTION_GATE_SEQUENCE_CONFLICT"
  | "AYAS_EXECUTION_GATE_LOG_CONFLICT";

export class AyasExecutionGateStoreError extends Error {
  constructor(
    readonly code: AyasExecutionGateStoreErrorCode,
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "AyasExecutionGateStoreError";
  }
}

export interface AyasExecutionGateRecord {
  readonly schemaVersion: typeof ayasExecutionGateSchemaVersion;
  readonly sequence: number;
  readonly state: AyasExecutionGateState;
  readonly activationAuthorizationId?: string;
  readonly updatedAt: string;
}

export interface AyasExecutionGateLogEntry extends AyasExecutionGateRecord {
  readonly from: AyasExecutionGateState;
  readonly event: AyasExecutionGateEvent;
  readonly faulted: boolean;
  readonly reason?: string;
}

export interface AyasExecutionGateTransitionInput {
  readonly event: AyasExecutionGateEvent;
  /** Optimistic-concurrency guard: must equal the persisted `sequence`. */
  readonly expectedSequence?: number;
  readonly activationAuthorizationId?: string;
  /** Free-text audit note (never a secret). */
  readonly reason?: string;
}

export interface AyasExecutionGateStoreOptions {
  readonly rootDir?: string;
  readonly now?: () => Date;
}

const STATES: readonly AyasExecutionGateState[] = [
  "CLOSED", "ARMED", "READY", "OPEN", "EXECUTING", "COMPLETED",
];

export class AyasExecutionGateStore {
  private readonly dir: string;
  private readonly logDir: string;
  private readonly gateFile: string;
  private readonly now: () => Date;

  constructor(options: AyasExecutionGateStoreOptions = {}) {
    const rootDir = options.rootDir
      ? path.resolve(options.rootDir)
      : path.join(process.cwd(), "data", "brain");
    this.dir = path.join(rootDir, "execution");
    this.logDir = path.join(this.dir, "gate-log");
    this.gateFile = path.join(this.dir, "gate.json");
    this.now = options.now ?? (() => new Date());
  }

  get file(): string {
    return this.gateFile;
  }

  /** The persisted record, or a synthetic CLOSED record when absent. Throws on corruption. */
  read(): AyasExecutionGateRecord {
    const raw = this.readJson();
    if (raw === undefined) {
      return {
        schemaVersion: ayasExecutionGateSchemaVersion,
        sequence: 0,
        state: AYAS_EXECUTION_GATE_DEFAULT,
        updatedAt: new Date(0).toISOString(),
      };
    }
    return this.validate(raw);
  }

  /**
   * The current state for a *decision*. Never throws: a corrupt / unreadable
   * store degrades to `CLOSED` (fail-closed) and is left untouched for review.
   */
  readStateFailClosed(): { state: AyasExecutionGateState; degraded: boolean; detail?: string } {
    try {
      return { state: this.read().state, degraded: false };
    } catch (error) {
      return {
        state: "CLOSED",
        degraded: true,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** Ordered append-only transition log (oldest first). */
  readLog(): readonly AyasExecutionGateLogEntry[] {
    let names: string[];
    try {
      names = fs.existsSync(this.logDir) ? fs.readdirSync(this.logDir) : [];
    } catch (error) {
      throw new AyasExecutionGateStoreError(
        "AYAS_EXECUTION_GATE_IO",
        `cannot read ${this.logDir}`,
        error instanceof Error ? error.message : String(error),
      );
    }
    return names
      .filter((n) => /^\d+\.json$/.test(n))
      .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10))
      .map((n) => {
        const parsed = this.readJson(path.join(this.logDir, n));
        return this.validateLog(parsed, n);
      });
  }

  /**
   * Apply one transition. Returns the new record. `fault` / `close` always
   * succeed and land on `CLOSED`. Every other outcome is CAS-guarded on
   * `expectedSequence` when supplied.
   */
  transition(input: AyasExecutionGateTransitionInput): AyasExecutionGateRecord {
    const current = this.read();
    if (
      typeof input.expectedSequence === "number" &&
      input.expectedSequence !== current.sequence
    ) {
      throw new AyasExecutionGateStoreError(
        "AYAS_EXECUTION_GATE_SEQUENCE_CONFLICT",
        `expected sequence ${input.expectedSequence} but the gate is at ${current.sequence}`,
      );
    }

    const ctx: AyasExecutionGateTransitionContext = input.activationAuthorizationId
      ? { activationAuthorizationId: input.activationAuthorizationId }
      : {};
    const step = nextAyasExecutionGateState(current.state, input.event, ctx);

    // A refused open (no id / not from READY) is a no-op — do NOT bump the sequence.
    if (step.from === step.to && !step.faulted && input.event === "open") {
      return current;
    }

    const sequence = current.sequence + 1;
    const updatedAt = this.now().toISOString();
    const record: AyasExecutionGateRecord = {
      schemaVersion: ayasExecutionGateSchemaVersion,
      sequence,
      state: step.to,
      updatedAt,
      ...(step.to === "OPEN" && input.activationAuthorizationId
        ? { activationAuthorizationId: input.activationAuthorizationId }
        : {}),
    };

    const logEntry: AyasExecutionGateLogEntry = {
      ...record,
      from: step.from,
      event: step.event,
      faulted: step.faulted,
      ...(input.reason ? { reason: input.reason } : {}),
    };

    this.ensureDir(this.logDir);
    this.appendLogExclusive(sequence, logEntry);
    this.writeJsonAtomic(this.gateFile, record);
    return record;
  }

  /* ------------------------------------------------------------- internals --- */

  private ensureDir(dir: string): void {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (error) {
      throw new AyasExecutionGateStoreError(
        "AYAS_EXECUTION_GATE_IO",
        `cannot create ${dir}`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private readJson(file: string = this.gateFile): unknown | undefined {
    if (!fs.existsSync(file)) return undefined;
    let raw: string;
    try {
      raw = fs.readFileSync(file, "utf-8");
    } catch (error) {
      throw new AyasExecutionGateStoreError(
        "AYAS_EXECUTION_GATE_IO",
        `cannot read ${file}`,
        error instanceof Error ? error.message : String(error),
      );
    }
    try {
      return JSON.parse(raw);
    } catch (error) {
      throw new AyasExecutionGateStoreError(
        "AYAS_EXECUTION_GATE_CORRUPT",
        `${file} is not valid JSON — refusing to touch it (manual review)`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private validate(raw: unknown): AyasExecutionGateRecord {
    if (!raw || typeof raw !== "object") {
      throw new AyasExecutionGateStoreError("AYAS_EXECUTION_GATE_CORRUPT", "gate.json is not an object");
    }
    const record = raw as Record<string, unknown>;
    if (record.schemaVersion !== ayasExecutionGateSchemaVersion) {
      throw new AyasExecutionGateStoreError(
        "AYAS_EXECUTION_GATE_SCHEMA_MISMATCH",
        `gate.json schemaVersion is ${String(record.schemaVersion)}, expected ${ayasExecutionGateSchemaVersion}`,
      );
    }
    if (typeof record.sequence !== "number" || !Number.isSafeInteger(record.sequence) || record.sequence < 0) {
      throw new AyasExecutionGateStoreError("AYAS_EXECUTION_GATE_CORRUPT", "gate.json sequence is invalid");
    }
    if (typeof record.state !== "string" || !STATES.includes(record.state as AyasExecutionGateState)) {
      throw new AyasExecutionGateStoreError("AYAS_EXECUTION_GATE_CORRUPT", `gate.json state "${String(record.state)}" is invalid`);
    }
    if (typeof record.updatedAt !== "string" || Number.isNaN(Date.parse(record.updatedAt))) {
      throw new AyasExecutionGateStoreError("AYAS_EXECUTION_GATE_CORRUPT", "gate.json updatedAt is invalid");
    }
    if (record.activationAuthorizationId !== undefined && typeof record.activationAuthorizationId !== "string") {
      throw new AyasExecutionGateStoreError("AYAS_EXECUTION_GATE_CORRUPT", "gate.json activationAuthorizationId is invalid");
    }
    return {
      schemaVersion: ayasExecutionGateSchemaVersion,
      sequence: record.sequence,
      state: record.state as AyasExecutionGateState,
      updatedAt: record.updatedAt,
      ...(typeof record.activationAuthorizationId === "string"
        ? { activationAuthorizationId: record.activationAuthorizationId }
        : {}),
    };
  }

  private validateLog(raw: unknown, name: string): AyasExecutionGateLogEntry {
    if (!raw || typeof raw !== "object") {
      throw new AyasExecutionGateStoreError("AYAS_EXECUTION_GATE_CORRUPT", `gate-log/${name} is not an object`);
    }
    const base = this.validate({ ...(raw as object) });
    const record = raw as Record<string, unknown>;
    if (typeof record.from !== "string" || !STATES.includes(record.from as AyasExecutionGateState)) {
      throw new AyasExecutionGateStoreError("AYAS_EXECUTION_GATE_CORRUPT", `gate-log/${name} from is invalid`);
    }
    if (typeof record.event !== "string") {
      throw new AyasExecutionGateStoreError("AYAS_EXECUTION_GATE_CORRUPT", `gate-log/${name} event is invalid`);
    }
    return {
      ...base,
      from: record.from as AyasExecutionGateState,
      event: record.event as AyasExecutionGateEvent,
      faulted: record.faulted === true,
      ...(typeof record.reason === "string" ? { reason: record.reason } : {}),
    };
  }

  private appendLogExclusive(sequence: number, entry: AyasExecutionGateLogEntry): void {
    const file = path.join(this.logDir, `${sequence}.json`);
    try {
      const handle = fs.openSync(file, "wx");
      try {
        fs.writeFileSync(handle, `${JSON.stringify(entry, null, 2)}\n`, "utf-8");
        fs.fsyncSync(handle);
      } finally {
        fs.closeSync(handle);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "EEXIST") {
        throw new AyasExecutionGateStoreError(
          "AYAS_EXECUTION_GATE_LOG_CONFLICT",
          `gate-log/${sequence}.json already exists — a replay or concurrent writer`,
        );
      }
      throw new AyasExecutionGateStoreError(
        "AYAS_EXECUTION_GATE_IO",
        `cannot append gate-log/${sequence}.json`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private writeJsonAtomic(file: string, value: unknown): void {
    this.ensureDir(path.dirname(file));
    const tmp = path.join(
      path.dirname(file),
      `.${path.basename(file)}.${process.pid}.${crypto.randomUUID()}.tmp`,
    );
    try {
      const handle = fs.openSync(tmp, "w");
      try {
        fs.writeFileSync(handle, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
        fs.fsyncSync(handle);
      } finally {
        fs.closeSync(handle);
      }
      fs.renameSync(tmp, file);
    } catch (error) {
      try {
        fs.rmSync(tmp, { force: true });
      } catch {
        /* ignore */
      }
      throw new AyasExecutionGateStoreError(
        "AYAS_EXECUTION_GATE_IO",
        `cannot write ${file}`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}
