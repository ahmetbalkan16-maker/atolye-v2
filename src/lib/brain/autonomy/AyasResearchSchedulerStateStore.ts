import fs from "node:fs";
import path from "node:path";

/**
 * AYAS CONTINUOUS EXTERNAL INTELLIGENCE sprint, Part B — the scheduler's own
 * durable state: a single JSON file (atomic write, schema-versioned — this
 * codebase's standard durable-store convention). One scheduler, one state
 * file; concurrent-run exclusion is NOT this store's job (that is
 * `AyasResearchScheduler.ts`'s reused `AyasExecutionAuthorityLock`) — this
 * module only persists what has already been decided.
 */
export const ayasResearchSchedulerStateSchemaVersion = "1" as const;

export interface AyasResearchSchedulerState {
  readonly schemaVersion: typeof ayasResearchSchedulerStateSchemaVersion;
  readonly lastLightStartedAt?: string;
  readonly lastLightCompletedAt?: string;
  readonly nextLightAt?: string;
  readonly lastDeepStartedAt?: string;
  readonly lastDeepCompletedAt?: string;
  readonly nextDeepAt?: string;
  /** Diagnostic only — the real mutual-exclusion guarantee is the reused `AyasExecutionAuthorityLock`, not this field. Set while a run is in flight, cleared in every exit path (success, failure, or lock-busy-skip). A non-null value observed at the START of a tick means the previous process died mid-run; the tick clears it before proceeding (see `AyasResearchScheduler.ts`). */
  readonly currentRunId?: string;
  readonly currentMode?: "LIGHT" | "DEEP";
  readonly lastError?: string;
  readonly consecutiveFailures: number;
  readonly lastSuccessfulResearchAt?: string;
}

export const AYAS_RESEARCH_SCHEDULER_DEFAULT_STATE: AyasResearchSchedulerState = {
  schemaVersion: ayasResearchSchedulerStateSchemaVersion,
  consecutiveFailures: 0,
};

export class AyasResearchSchedulerStateError extends Error {
  constructor(readonly code: "READ_FAILED" | "MALFORMED" | "SCHEMA_MISMATCH" | "INVALID", message: string) {
    super(message);
    this.name = "AyasResearchSchedulerStateError";
  }
}

function validateState(value: unknown): AyasResearchSchedulerState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AyasResearchSchedulerStateError("INVALID", "research scheduler state has an invalid envelope");
  }
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== ayasResearchSchedulerStateSchemaVersion) {
    throw new AyasResearchSchedulerStateError("SCHEMA_MISMATCH", "research scheduler state schema is unsupported");
  }
  if (!Number.isSafeInteger(record.consecutiveFailures) || (record.consecutiveFailures as number) < 0) {
    throw new AyasResearchSchedulerStateError("INVALID", "research scheduler failure count is invalid");
  }
  const timestamps = ["lastLightStartedAt", "lastLightCompletedAt", "nextLightAt", "lastDeepStartedAt", "lastDeepCompletedAt", "nextDeepAt", "lastSuccessfulResearchAt"];
  if (timestamps.some((key) => record[key] !== undefined && (typeof record[key] !== "string" || !Number.isFinite(Date.parse(record[key])))) ||
    (record.currentRunId !== undefined && typeof record.currentRunId !== "string") ||
    (record.currentMode !== undefined && record.currentMode !== "LIGHT" && record.currentMode !== "DEEP") ||
    (record.lastError !== undefined && typeof record.lastError !== "string")) {
    throw new AyasResearchSchedulerStateError("INVALID", "research scheduler state has invalid fields");
  }
  return value as AyasResearchSchedulerState;
}

export interface AyasResearchSchedulerStateStoreOptions { readonly rootDir?: string }

export interface AyasResearchSchedulerStateStore {
  readonly file: string;
  read(): AyasResearchSchedulerState;
  write(state: AyasResearchSchedulerState): AyasResearchSchedulerState;
}

export function createAyasResearchSchedulerStateStore(options: AyasResearchSchedulerStateStoreOptions = {}): AyasResearchSchedulerStateStore {
  const dir = path.resolve(options.rootDir ?? path.join(process.cwd(), "data", "brain", "self-improvement", "research"));
  const file = path.join(dir, "scheduler-state.json");

  return {
    file,
    read() {
      let serialized: string;
      try {
        serialized = fs.readFileSync(file, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return AYAS_RESEARCH_SCHEDULER_DEFAULT_STATE;
        throw new AyasResearchSchedulerStateError("READ_FAILED", "research scheduler state could not be read");
      }
      let raw: unknown;
      try { raw = JSON.parse(serialized); }
      catch { throw new AyasResearchSchedulerStateError("MALFORMED", "research scheduler state is not valid JSON"); }
      return validateState(raw);
    },
    write(state) {
      validateState(state);
      fs.mkdirSync(dir, { recursive: true });
      const tmp = path.join(dir, `.scheduler-state.${process.pid}.tmp`);
      try {
        const fd = fs.openSync(tmp, "w");
        try { fs.writeFileSync(fd, `${JSON.stringify(state, null, 2)}\n`, "utf8"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        fs.renameSync(tmp, file);
      } catch (error) {
        try { fs.rmSync(tmp, { force: true }); } catch { /* fail closed */ }
        throw error;
      }
      return state;
    },
  };
}
