import fs from "node:fs";
import path from "node:path";

export const ayasAutonomyObserverSchemaVersion = "1" as const;
export type AyasAutonomyObserverPhase = "STARTING" | "OBSERVING" | "PAUSED_MACHINE_HEALTH" | "PAUSED_DIRTY_REPO";

export interface AyasAutonomyObserverState {
  readonly schemaVersion: typeof ayasAutonomyObserverSchemaVersion;
  readonly phase: AyasAutonomyObserverPhase;
  readonly updatedAt: string;
  readonly lastObservationAt?: string;
  /** Exact repository binding of the last observation, so a closure receipt can attest which HEAD the Observer actually saw. Optional: state files written before this field existed still load. */
  readonly lastObservationHead?: string;
  readonly lastObservationBranch?: string;
  readonly lastObservationGraphifyFresh?: boolean;
  readonly lastError?: string;
  readonly heartbeatCount: number;
}

export interface AyasAutonomyObserverObservation {
  readonly now: string;
  readonly branch: string;
  readonly head: string;
  readonly repoClean: boolean;
  readonly graphifyFresh: boolean;
  readonly machineAction: "ALLOW" | "THROTTLE" | "PAUSE" | "STOP OWN WORKLOAD" | "BLOCK NEW HEAVY WORK";
  readonly gaps: readonly string[];
}

export interface AyasAutonomyObserverOptions {
  readonly stateFile?: string;
  readonly now?: () => string;
}

const initialState = (now: string): AyasAutonomyObserverState => ({ schemaVersion: ayasAutonomyObserverSchemaVersion, phase: "STARTING", updatedAt: now, heartbeatCount: 0 });

/** Note: checks git-repo presence only, not working-tree cleanliness — mirrors the pre-existing helper this was extracted from. */
export function isRepoClean(rootDir = process.cwd()): boolean {
  const gitDir = path.join(rootDir, ".git");
  return fs.existsSync(gitDir);
}

/**
 * Stage 7A observer: reads machine/repo/graphify signals and records a
 * pause/observing phase. It has no import of the execution gate, the
 * approval inbox, or any mutation callback — it cannot mint or consume
 * authorization and cannot open or transition an execution gate.
 */
export function createAyasAutonomyObserver(options: AyasAutonomyObserverOptions = {}) {
  const now = options.now ?? (() => new Date().toISOString());
  const stateFile = options.stateFile ? path.resolve(options.stateFile) : undefined;
  let state: AyasAutonomyObserverState = initialState(now());
  if (stateFile && fs.existsSync(stateFile)) {
    const parsed = JSON.parse(fs.readFileSync(stateFile, "utf8")) as Partial<AyasAutonomyObserverState>;
    if (parsed.schemaVersion !== ayasAutonomyObserverSchemaVersion || typeof parsed.phase !== "string" || typeof parsed.heartbeatCount !== "number") throw new Error("AYAS_OBSERVER_STATE_CORRUPT");
    state = parsed as AyasAutonomyObserverState;
  }

  const persist = (): void => { if (!stateFile) return; fs.mkdirSync(path.dirname(stateFile), { recursive: true }); const tmp = `${stateFile}.${process.pid}.tmp`; fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8"); fs.renameSync(tmp, stateFile); };
  const transition = (phase: AyasAutonomyObserverPhase, extra: Partial<AyasAutonomyObserverState> = {}): AyasAutonomyObserverState => { state = { ...state, ...extra, phase, updatedAt: now(), heartbeatCount: state.heartbeatCount + 1 }; persist(); return state; };
  const observe = (observation: AyasAutonomyObserverObservation): AyasAutonomyObserverState => {
    const observed = { lastObservationAt: observation.now, lastObservationHead: observation.head, lastObservationBranch: observation.branch, lastObservationGraphifyFresh: observation.graphifyFresh };
    if (observation.machineAction === "PAUSE" || observation.machineAction === "STOP OWN WORKLOAD") return transition("PAUSED_MACHINE_HEALTH", { ...observed, lastError: `Machine Health: ${observation.machineAction}` });
    if (!observation.repoClean) return transition("PAUSED_DIRTY_REPO", { ...observed, lastError: "working tree is dirty — no mutation allowed" });
    return transition("OBSERVING", { ...observed, lastError: undefined });
  };

  return { get state() { return state; }, observe };
}
