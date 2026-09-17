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
      try {
        const raw = JSON.parse(fs.readFileSync(file, "utf8")) as AyasResearchSchedulerState;
        return raw?.schemaVersion === ayasResearchSchedulerStateSchemaVersion ? raw : AYAS_RESEARCH_SCHEDULER_DEFAULT_STATE;
      } catch {
        return AYAS_RESEARCH_SCHEDULER_DEFAULT_STATE;
      }
    },
    write(state) {
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
