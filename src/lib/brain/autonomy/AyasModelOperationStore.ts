import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { AyasSafeModeBlockedError, ayasSafeModeHold } from "../../ayas/safety/AyasSafeModeReader";
import { AYAS_MODEL_WATCH_CANDIDATES, ayasModelSwitchHash, compareAyasChatModels, currentAyasModelResult, type AyasModelVerdict, type AyasModelWatchState } from "./AyasModelWatch";
import {
  ayasUsedOwnerActionRefs, checkAyasOwnerAdmissionBinding, sealAyasOwnerDecision, verifyAyasOwnerDecisionSeal,
  type AyasOwnerAdmission, type AyasOwnerAdmissionSubject,
} from "./AyasOwnerApprovalAdmission";

/**
 * Owner model operations from Gelişim Merkezi (owner decisions 2026-10-15 item 4, design approved 2026-10-16): the
 * model counterpart of the update radar's "dene, sonra uygula".
 *
 * - "İndir ve ölç" records consent to download one watched model, bound to the registry manifest digest the owner
 *   saw, and to measure it with the frozen AYAS chat benchmark. The live application is not touched.
 * - "Bu modele geç" is the one approval for switching AYAS chat to a model measured better than the current one,
 *   bound to both measurements (ayasModelSwitchHash).
 *
 * Recording is the only effect here. The observer's executor carries the decisions out (AyasModelTrialRunner,
 * AyasModelSwitchRunner) and writes the job records. Decisions and jobs are two files, so the server action and the
 * executor never rewrite each other's file. Append-only decisions: a withdrawal is a new decision.
 */
export interface AyasModelTrialDecisionRecord {
  readonly decisionId: string;
  readonly tag: string;
  readonly registryDigest: string;
  /** Informative (the registry's layer total when the owner clicked); the digest is what binds. */
  readonly totalBytes: number;
  readonly decision: "APPROVE" | "WITHDRAW";
  readonly decidedAt: string;
  readonly ownerAdmission: AyasOwnerAdmission;
  readonly ownerDecisionSeal: string;
}

export interface AyasModelSwitchDecisionRecord {
  readonly decisionId: string;
  readonly tag: string;
  readonly switchHash: string;
  readonly fromModel: string;
  readonly decision: "SWITCH";
  readonly decidedAt: string;
  readonly ownerAdmission: AyasOwnerAdmission;
  readonly ownerDecisionSeal: string;
}

export interface AyasModelDecisionState {
  readonly schemaVersion: 1;
  readonly trialDecisions: readonly AyasModelTrialDecisionRecord[];
  readonly switchDecisions: readonly AyasModelSwitchDecisionRecord[];
}

/** PULLING and MEASURING continue over several executor runs; MEASURED and FAILED are final for their decision. */
export type AyasModelTrialStatus = "PULLING" | "MEASURING" | "MEASURED" | "FAILED";
export interface AyasModelTrialRecord {
  readonly schemaVersion: 1;
  readonly trialId: string;
  readonly decisionId: string;
  readonly tag: string;
  readonly registryDigest: string;
  readonly status: AyasModelTrialStatus;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly finishedAt?: string;
  readonly totalBytes?: number;
  readonly completedBytes?: number;
  /** Executor runs spent downloading; each is bounded so the observer keeps its rhythm. */
  readonly slices: number;
  readonly consecutiveErrors: number;
  readonly lastError?: string;
  readonly failureReason?: string;
  readonly installedDigest?: string;
  readonly measured?: { readonly passed: number; readonly total: number; readonly incumbentModel: string; readonly verdict?: AyasModelVerdict };
}

/** DEFERRED: the live application had a running job, nothing was changed; tried again on a later run, bounded. */
export type AyasModelSwitchStatus = "RUNNING" | "DEFERRED" | "SWITCHED" | "ROLLED_BACK" | "REFUSED" | "FAILED" | "ABANDONED" | "RECOVERY_REQUIRED";
export interface AyasModelSwitchRecord {
  readonly schemaVersion: 1;
  readonly switchId: string;
  readonly decisionId: string;
  readonly tag: string;
  readonly fromModel: string;
  readonly status: AyasModelSwitchStatus;
  readonly attempts: number;
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly steps: readonly { readonly name: string; readonly ok: boolean; readonly summary: string }[];
  readonly reasons?: readonly string[];
}

export interface AyasModelJobState {
  readonly schemaVersion: 1;
  readonly trials: readonly AyasModelTrialRecord[];
  readonly switches: readonly AyasModelSwitchRecord[];
}

export interface AyasModelOperationStore {
  readonly rootDir: string;
  loadDecisions(): AyasModelDecisionState;
  appendTrialDecision(record: AyasModelTrialDecisionRecord): void;
  appendSwitchDecision(record: AyasModelSwitchDecisionRecord): void;
  loadJobs(): AyasModelJobState;
  /** Inserts or replaces the record with the same trialId. */
  upsertTrial(record: AyasModelTrialRecord): void;
  /** Inserts or replaces the record with the same switchId. */
  upsertSwitch(record: AyasModelSwitchRecord): void;
}

function writeAtomic(dir: string, file: string, value: unknown): void {
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  const fd = fs.openSync(tmp, "w");
  try { fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, "utf8"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}

/** Two JSON files written atomically (temp + fsync + rename): decisions (server action) and jobs (executor). */
export function createAyasModelOperationStore(options: { readonly rootDir?: string } = {}): AyasModelOperationStore {
  const dir = path.resolve(options.rootDir ?? path.join(process.cwd(), "data", "brain", "self-improvement", "model-operations"));
  const decisionsFile = path.join(dir, "decisions.json");
  const jobsFile = path.join(dir, "jobs.json");
  const loadDecisions = (): AyasModelDecisionState => {
    let raw: string;
    try { raw = fs.readFileSync(decisionsFile, "utf8"); } catch { return { schemaVersion: 1, trialDecisions: [], switchDecisions: [] }; }
    const parsed = JSON.parse(raw) as AyasModelDecisionState;
    if (parsed?.schemaVersion !== 1 || !Array.isArray(parsed.trialDecisions) || !Array.isArray(parsed.switchDecisions)) throw new Error("model-operations decisions have an unknown schema");
    return parsed;
  };
  const loadJobs = (): AyasModelJobState => {
    let raw: string;
    try { raw = fs.readFileSync(jobsFile, "utf8"); } catch { return { schemaVersion: 1, trials: [], switches: [] }; }
    const parsed = JSON.parse(raw) as AyasModelJobState;
    if (parsed?.schemaVersion !== 1 || !Array.isArray(parsed.trials) || !Array.isArray(parsed.switches)) throw new Error("model-operations jobs have an unknown schema");
    return parsed;
  };
  const replace = <T>(list: readonly T[], record: T, same: (entry: T) => boolean): T[] => list.some(same) ? list.map((entry) => (same(entry) ? record : entry)) : [...list, record];
  return {
    rootDir: dir,
    loadDecisions,
    // Synchronous read-modify-write: no other decision in this process can interleave.
    appendTrialDecision(record) { const state = loadDecisions(); writeAtomic(dir, decisionsFile, { ...state, trialDecisions: [...state.trialDecisions, record] }); },
    appendSwitchDecision(record) { const state = loadDecisions(); writeAtomic(dir, decisionsFile, { ...state, switchDecisions: [...state.switchDecisions, record] }); },
    loadJobs,
    upsertTrial(record) { const state = loadJobs(); writeAtomic(dir, jobsFile, { ...state, trials: replace(state.trials, record, (entry) => entry.trialId === record.trialId) }); },
    upsertSwitch(record) { const state = loadJobs(); writeAtomic(dir, jobsFile, { ...state, switches: replace(state.switches, record, (entry) => entry.switchId === record.switchId) }); },
  };
}

export type AyasModelOperationErrorCode =
  | "MODEL_OPERATION_INVALID_INPUT"
  | "MODEL_OPERATION_NOT_A_CANDIDATE"
  | "MODEL_TRIAL_REGISTRY_UNKNOWN"
  | "MODEL_TRIAL_REGISTRY_CHANGED"
  | "MODEL_TRIAL_ALREADY_APPROVED"
  | "MODEL_TRIAL_NOT_APPROVED"
  | "MODEL_OPERATION_DECISION_CHANGED"
  | "MODEL_SWITCH_NOT_BETTER"
  | "MODEL_SWITCH_CHANGED"
  | "MODEL_SWITCH_ALREADY_DECIDED"
  | "MODEL_SWITCH_BUSY"
  | "MODEL_OPERATION_ADMISSION_REJECTED";

/** The message is the code, so a caller that reports `error.message` reports the reason. */
export class AyasModelOperationError extends Error {
  constructor(readonly code: AyasModelOperationErrorCode) { super(code); this.name = "AyasModelOperationError"; this.stack = undefined; }
}

const HEX64 = /^[0-9a-f]{64}$/;
const isCandidate = (tag: unknown): tag is string => typeof tag === "string" && AYAS_MODEL_WATCH_CANDIDATES.some((candidate) => candidate.tag === tag);
const trialSubject = (record: Pick<AyasModelTrialDecisionRecord, "tag" | "registryDigest" | "decision">): AyasOwnerAdmissionSubject =>
  ({ kind: "model-trial", tag: record.tag, registryDigest: record.registryDigest, decision: record.decision });
const switchSubject = (record: Pick<AyasModelSwitchDecisionRecord, "tag" | "switchHash">): AyasOwnerAdmissionSubject =>
  ({ kind: "model-switch", tag: record.tag, switchHash: record.switchHash, decision: "SWITCH" });

/** True when the record carries an intact owner seal and an admission for exactly this subject at its decision time. */
export function isAyasModelTrialDecisionAdmitted(record: AyasModelTrialDecisionRecord): boolean {
  try {
    return isCandidate(record.tag) && verifyAyasOwnerDecisionSeal(record)
      && checkAyasOwnerAdmissionBinding(record.ownerAdmission, { subject: trialSubject(record), at: record.decidedAt, usedActionRefs: new Set() }).ok;
  } catch { return false; }
}

export function isAyasModelSwitchDecisionAdmitted(record: AyasModelSwitchDecisionRecord): boolean {
  try {
    return record.decision === "SWITCH" && isCandidate(record.tag) && verifyAyasOwnerDecisionSeal(record)
      && checkAyasOwnerAdmissionBinding(record.ownerAdmission, { subject: switchSubject(record), at: record.decidedAt, usedActionRefs: new Set() }).ok;
  } catch { return false; }
}

/** The latest owner-admitted trial decision per tag; an unverifiable record is ignored, never trusted. */
function latestTrialDecisionByTag(decisions: readonly AyasModelTrialDecisionRecord[]): Map<string, AyasModelTrialDecisionRecord> {
  const latest = new Map<string, AyasModelTrialDecisionRecord>();
  for (const record of decisions) if (isAyasModelTrialDecisionAdmitted(record)) latest.set(record.tag, record);
  return latest;
}

const usedRefs = (state: AyasModelDecisionState) => ayasUsedOwnerActionRefs([...state.trialDecisions, ...state.switchDecisions]);

interface DecideDeps {
  readonly store: AyasModelOperationStore;
  /** The model-watch state the owner's card was built from (registry digests, measurements). */
  readonly watch: AyasModelWatchState | undefined;
  /** The model AYAS chat uses now. */
  readonly incumbentModel: string;
  /** Builds the owner admission for this exact subject from the verified session (server side). */
  readonly admit: (subject: AyasOwnerAdmissionSubject) => Promise<AyasOwnerAdmission>;
  readonly now?: () => string;
  readonly safeModeHold?: () => "AYAS_SAFE_READ_ONLY" | "AYAS_SAFE_MODE_UNAVAILABLE" | undefined;
}

/** "İndir ve ölç" (APPROVE) or its withdrawal. Recording is the only effect. */
export async function decideAyasModelTrial(input: { readonly tag: string; readonly registryDigest: string; readonly decision: "APPROVE" | "WITHDRAW" }, deps: DecideDeps): Promise<AyasModelTrialDecisionRecord> {
  if (!input || typeof input.registryDigest !== "string" || !HEX64.test(input.registryDigest) || (input.decision !== "APPROVE" && input.decision !== "WITHDRAW")) {
    throw new AyasModelOperationError("MODEL_OPERATION_INVALID_INPUT");
  }
  if (!isCandidate(input.tag) || input.tag === deps.incumbentModel) throw new AyasModelOperationError("MODEL_OPERATION_NOT_A_CANDIDATE");
  const hold = (deps.safeModeHold ?? (() => ayasSafeModeHold()))();
  if (hold) throw new AyasSafeModeBlockedError(hold);
  const now = deps.now ?? (() => new Date().toISOString());

  const activeBefore = latestTrialDecisionByTag(deps.store.loadDecisions().trialDecisions).get(input.tag);
  let fields: Pick<AyasModelTrialDecisionRecord, "tag" | "registryDigest" | "totalBytes">;
  if (input.decision === "APPROVE") {
    const observation = deps.watch?.registry[input.tag];
    if (!observation) throw new AyasModelOperationError("MODEL_TRIAL_REGISTRY_UNKNOWN");
    if (observation.digest !== input.registryDigest) throw new AyasModelOperationError("MODEL_TRIAL_REGISTRY_CHANGED");
    if (activeBefore?.decision === "APPROVE" && activeBefore.registryDigest === input.registryDigest) throw new AyasModelOperationError("MODEL_TRIAL_ALREADY_APPROVED");
    fields = { tag: input.tag, registryDigest: input.registryDigest, totalBytes: observation.totalBytes };
  } else {
    if (activeBefore?.decision !== "APPROVE" || activeBefore.registryDigest !== input.registryDigest) throw new AyasModelOperationError("MODEL_TRIAL_NOT_APPROVED");
    fields = { tag: activeBefore.tag, registryDigest: activeBefore.registryDigest, totalBytes: activeBefore.totalBytes };
  }

  const subject = trialSubject({ ...fields, decision: input.decision });
  const ownerAdmission = await deps.admit(subject);
  const state = deps.store.loadDecisions();
  // Another decision on this model landed while the session was verified: refuse rather than decide on old state.
  if (latestTrialDecisionByTag(state.trialDecisions).get(input.tag)?.decisionId !== activeBefore?.decisionId) throw new AyasModelOperationError("MODEL_OPERATION_DECISION_CHANGED");
  const decidedAt = now();
  if (!checkAyasOwnerAdmissionBinding(ownerAdmission, { subject, at: decidedAt, usedActionRefs: usedRefs(state) }).ok) throw new AyasModelOperationError("MODEL_OPERATION_ADMISSION_REJECTED");
  const decisionId = `ayas-model-trial-decision-${crypto.randomUUID()}`;
  const record: AyasModelTrialDecisionRecord = Object.freeze({
    decisionId, ...fields, decision: input.decision, decidedAt, ownerAdmission,
    ownerDecisionSeal: sealAyasOwnerDecision({ decisionId, decidedAt, ownerAdmission }),
  });
  deps.store.appendTrialDecision(record);
  return record;
}

/**
 * "Bu modele geç". Refused unless the candidate and the current model are both measured on their installed bytes under
 * the frozen set, the candidate is better, the click's hash still matches those measurements, it was not decided
 * before, and no other switch is under way. Recording is the only effect; the executor's switch runner carries it out.
 */
export async function decideAyasModelSwitch(input: { readonly tag: string; readonly switchHash: string }, deps: DecideDeps & { readonly jobs?: () => AyasModelJobState }): Promise<AyasModelSwitchDecisionRecord> {
  if (!input || typeof input.switchHash !== "string" || !HEX64.test(input.switchHash)) throw new AyasModelOperationError("MODEL_OPERATION_INVALID_INPUT");
  if (!isCandidate(input.tag) || input.tag === deps.incumbentModel) throw new AyasModelOperationError("MODEL_OPERATION_NOT_A_CANDIDATE");
  const hold = (deps.safeModeHold ?? (() => ayasSafeModeHold()))();
  if (hold) throw new AyasSafeModeBlockedError(hold);
  const now = deps.now ?? (() => new Date().toISOString());
  const check = (): void => {
    const candidate = currentAyasModelResult(deps.watch, input.tag);
    const incumbent = currentAyasModelResult(deps.watch, deps.incumbentModel);
    if (!candidate || !incumbent || compareAyasChatModels(incumbent, candidate).verdict !== "BETTER") throw new AyasModelOperationError("MODEL_SWITCH_NOT_BETTER");
    if (ayasModelSwitchHash({ candidate, incumbentModel: deps.incumbentModel, incumbent }) !== input.switchHash) throw new AyasModelOperationError("MODEL_SWITCH_CHANGED");
    if (deps.store.loadDecisions().switchDecisions.some((entry) => entry.switchHash === input.switchHash && isAyasModelSwitchDecisionAdmitted(entry))) throw new AyasModelOperationError("MODEL_SWITCH_ALREADY_DECIDED");
    if ((deps.jobs ?? (() => deps.store.loadJobs()))().switches.some((entry) => entry.status === "RUNNING" || entry.status === "DEFERRED")) throw new AyasModelOperationError("MODEL_SWITCH_BUSY");
  };
  check();
  const subject = switchSubject({ tag: input.tag, switchHash: input.switchHash });
  const ownerAdmission = await deps.admit(subject);
  // Re-checked after the session was verified: another click in between wins.
  check();
  const state = deps.store.loadDecisions();
  const decidedAt = now();
  if (!checkAyasOwnerAdmissionBinding(ownerAdmission, { subject, at: decidedAt, usedActionRefs: usedRefs(state) }).ok) throw new AyasModelOperationError("MODEL_OPERATION_ADMISSION_REJECTED");
  const decisionId = `ayas-model-switch-decision-${crypto.randomUUID()}`;
  const record: AyasModelSwitchDecisionRecord = Object.freeze({
    decisionId, tag: input.tag, switchHash: input.switchHash, fromModel: deps.incumbentModel, decision: "SWITCH" as const, decidedAt, ownerAdmission,
    ownerDecisionSeal: sealAyasOwnerDecision({ decisionId, decidedAt, ownerAdmission }),
  });
  deps.store.appendSwitchDecision(record);
  return record;
}

/** A switch deferred while the live application had a running job is tried again on later runs, at most this often. */
export const AYAS_MODEL_SWITCH_MAX_ATTEMPTS = 12;
/** Consecutive download errors (network, registry) before a trial fails; a slice that made progress resets it. */
export const AYAS_MODEL_TRIAL_MAX_ERRORS = 5;

export type AyasModelJob =
  | { readonly kind: "SWITCH"; readonly decision: AyasModelSwitchDecisionRecord; readonly previous?: AyasModelSwitchRecord }
  | { readonly kind: "TRIAL"; readonly decision: AyasModelTrialDecisionRecord; readonly trial?: AyasModelTrialRecord }
  | { readonly kind: "NONE" };

/**
 * The next model job, the owner's switch click first. Only owner-admitted decisions count. A switch runs once per
 * decision (a DEFERRED or ABANDONED one again, bounded); a trial continues while the latest decision for its model is
 * APPROVE and the trial has not finished.
 */
export function selectAyasModelJob(input: { readonly decisions: AyasModelDecisionState; readonly jobs: AyasModelJobState }): AyasModelJob {
  for (const decision of input.decisions.switchDecisions) {
    if (!isAyasModelSwitchDecisionAdmitted(decision)) continue;
    const record = input.jobs.switches.filter((entry) => entry.decisionId === decision.decisionId).at(-1);
    if (!record) return { kind: "SWITCH", decision };
    if ((record.status === "DEFERRED" || record.status === "ABANDONED") && record.attempts < AYAS_MODEL_SWITCH_MAX_ATTEMPTS) return { kind: "SWITCH", decision, previous: record };
  }
  for (const decision of latestTrialDecisionByTag(input.decisions.trialDecisions).values()) {
    if (decision.decision !== "APPROVE") continue;
    const trial = input.jobs.trials.find((entry) => entry.decisionId === decision.decisionId);
    if (!trial) return { kind: "TRIAL", decision };
    if (trial.status === "PULLING" || trial.status === "MEASURING") return { kind: "TRIAL", decision, trial };
  }
  return { kind: "NONE" };
}

export interface AyasModelOperationsView {
  /** The active "İndir ve ölç" approval per model. */
  readonly trialApprovals: readonly { readonly decisionId: string; readonly tag: string; readonly registryDigest: string; readonly totalBytes: number; readonly approvedAt: string }[];
  /** The trial of each active approval. */
  readonly trials: readonly AyasModelTrialRecord[];
  readonly switchDecisions: readonly { readonly decisionId: string; readonly tag: string; readonly switchHash: string; readonly fromModel: string; readonly decidedAt: string }[];
  /** Newest first. */
  readonly switches: readonly AyasModelSwitchRecord[];
}

export function buildAyasModelOperationsView(input: { readonly decisions: AyasModelDecisionState; readonly jobs: AyasModelJobState }): AyasModelOperationsView {
  const trialApprovals = [...latestTrialDecisionByTag(input.decisions.trialDecisions).values()].filter((entry) => entry.decision === "APPROVE")
    .map((entry) => ({ decisionId: entry.decisionId, tag: entry.tag, registryDigest: entry.registryDigest, totalBytes: entry.totalBytes, approvedAt: entry.decidedAt }));
  return Object.freeze({
    trialApprovals,
    trials: input.jobs.trials.filter((trial) => trialApprovals.some((approval) => approval.decisionId === trial.decisionId)),
    switchDecisions: input.decisions.switchDecisions.filter(isAyasModelSwitchDecisionAdmitted)
      .map((entry) => ({ decisionId: entry.decisionId, tag: entry.tag, switchHash: entry.switchHash, fromModel: entry.fromModel, decidedAt: entry.decidedAt })),
    switches: [...input.jobs.switches].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 10),
  });
}

/** The /brain view; undefined when either file cannot be read (the panel then hides the model buttons). */
export function loadAyasModelOperationsView(store: AyasModelOperationStore = createAyasModelOperationStore()): AyasModelOperationsView | undefined {
  try { return buildAyasModelOperationsView({ decisions: store.loadDecisions(), jobs: store.loadJobs() }); } catch { return undefined; }
}
