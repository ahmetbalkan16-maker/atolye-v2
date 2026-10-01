import crypto from "node:crypto";

import { containsBrainSecret, redactBrainText } from "../BrainRedaction";
import {
  AyasDurableTaskError,
  ayasDurableCanonicalJson,
  ayasDurableResultDigest,
  decideAyasDurableTaskNext,
  defineAyasDurableTask,
  type AyasDurableActivityStep,
  type AyasDurableJson,
  type AyasDurableTaskDecision,
  type AyasDurableTaskDomain,
  type AyasDurableTaskEventBody,
  type AyasDurableTaskOwner,
  type AyasDurableTaskState,
} from "./AyasDurableTask";
import type { AyasDurableTaskJournal } from "./AyasDurableTaskJournal";
import { isSameLiveProcess, readProcessStartEpochMs } from "./AyasProcessLiveness";

/**
 * Stage 15B — the non-deterministic half of the durable task runtime.
 *
 * `advanceAyasDurableTask` reads the journal, asks the pure contract what may
 * happen next and performs at most one bounded action: start and finish one
 * attempt, record that a dead owner's attempt ended unconfirmed, or reread
 * the current state of an unconfirmed side effect. It never loops and never
 * runs two steps in one call, so a caller's tick advances a task by one step.
 *
 * Everything it knows comes from the journal. A new process after a crash or
 * a reboot continues from the recorded events:
 *  - a step whose result is recorded is never run again;
 *  - an attempt started by a process that no longer exists is closed as
 *    unconfirmed, never assumed finished and never assumed lost;
 *  - an unconfirmed side effect is reread before anything else, and an
 *    unreachable reread (network loss) leaves the task exactly where it is;
 *  - an attempt owned by a live process is left alone, however late it is.
 *
 * Activities come from a registry the caller passes in code. A step names
 * one; nothing here derives an activity, a command or a target from model or
 * tool output. This module registers no production activity and touches no
 * approval store, execution gate or daemon.
 */
export interface AyasDurableActivityContext {
  readonly taskId: string;
  readonly domain: AyasDurableTaskDomain;
  readonly stepId: string;
  readonly attempt: number;
  readonly attemptId: string;
  /** The same key on every attempt of this step: pass it to the target so a repeat can be recognised. */
  readonly idempotencyKey: string;
  readonly exactTarget: string;
  readonly input: AyasDurableJson;
  /** Recorded results of the steps before this one, by step ID. */
  readonly results: Readonly<Record<string, AyasDurableJson>>;
  /** Aborted when the step's timeout elapses. An activity must stop working when it fires. */
  readonly signal: AbortSignal;
}

export type AyasDurableActivityOutcome =
  | { readonly outcome: "SUCCEEDED"; readonly result: AyasDurableJson }
  /** A definite failure that changed nothing. */
  | { readonly outcome: "FAILED_NO_EFFECT"; readonly reason: string; readonly retryable: boolean }
  /** The activity cannot say whether its effect landed. */
  | { readonly outcome: "UNKNOWN"; readonly reason: string };

export type AyasDurableRereadOutcome =
  | { readonly observation: "APPLIED"; readonly result: AyasDurableJson; readonly evidence: string }
  | { readonly observation: "NOT_APPLIED" | "UNKNOWN"; readonly evidence: string };

export interface AyasDurableActivity {
  run(context: AyasDurableActivityContext): Promise<AyasDurableActivityOutcome>;
  /** Looks at the target's current state. Required for a `SIDE_EFFECT` step; throw if the state cannot be observed right now. */
  reread?(context: AyasDurableActivityContext): Promise<AyasDurableRereadOutcome>;
}

export interface AyasDurableTaskRuntimeDeps {
  readonly journal: AyasDurableTaskJournal;
  readonly activities: Readonly<Record<string, AyasDurableActivity>>;
  readonly owner: AyasDurableTaskOwner;
  readonly nowMs?: () => number;
  /** Whether the process that started a running attempt still exists. Defaults to a PID plus start-time check. */
  readonly isOwnerAlive?: (owner: AyasDurableTaskOwner) => Promise<boolean>;
}

export interface AyasDurableTaskAdvance {
  readonly decision: AyasDurableTaskDecision;
  /** Event types this call recorded, in order. Empty when it only waited. */
  readonly recorded: readonly AyasDurableTaskEventBody["type"][];
  readonly state: AyasDurableTaskState;
  /** `LOST_RACE`: another writer recorded the step first. `REREAD_UNAVAILABLE`: the current state could not be observed; nothing was recorded. */
  readonly note?: "LOST_RACE" | "REREAD_UNAVAILABLE";
}

/** This process's identity for the attempts it starts. The start time makes a reused PID distinguishable. */
export async function createAyasDurableTaskOwner(): Promise<AyasDurableTaskOwner> {
  const startEpochMs = await readProcessStartEpochMs(process.pid).catch(() => Date.now() - Math.floor(process.uptime() * 1000));
  return Object.freeze({ pid: process.pid, startEpochMs, nonce: crypto.randomUUID() });
}

/** Attempts this process is executing right now. One of its own attempts that is not here was abandoned by a failed call. */
const inFlight = new Set<string>();

function isConflict(error: unknown): boolean { return error instanceof AyasDurableTaskError && error.code === "AYAS_DURABLE_TASK_SEQUENCE_CONFLICT"; }
/** One bounded, secret-free line for the journal. */
function line(value: unknown): string {
  const raw = value instanceof Error ? value.message : typeof value === "string" ? value : String(value);
  const clean = redactBrainText([...raw].map((char) => (char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? " " : char)).join("")).text.trim();
  return clean.slice(0, 400) || "no detail";
}
function requireState(journal: AyasDurableTaskJournal, taskId: string): AyasDurableTaskState {
  const state = journal.load(taskId);
  if (!state) throw new AyasDurableTaskError("AYAS_DURABLE_TASK_NOT_FOUND", `task ${taskId} does not exist`);
  return state;
}

/**
 * Creates a task, or returns the existing one when the same definition was
 * already created under this domain and key. A different definition under an
 * existing key is refused, never merged.
 */
export function createAyasDurableTask(journal: AyasDurableTaskJournal, input: unknown): AyasDurableTaskState {
  const definition = defineAyasDurableTask(input);
  const created: AyasDurableTaskEventBody = { type: "TASK_CREATED", taskKey: definition.taskKey, domain: definition.domain, title: definition.title, steps: definition.steps };
  const existing = (): AyasDurableTaskState => {
    const state = requireState(journal, definition.taskId);
    const same = ayasDurableCanonicalJson({ title: state.title, steps: state.steps }) === ayasDurableCanonicalJson({ title: definition.title, steps: definition.steps });
    if (!same) throw new AyasDurableTaskError("AYAS_DURABLE_TASK_KEY_CONFLICT", `task key already names a different task (${definition.taskId})`);
    return state;
  };
  if (journal.read(definition.taskId).length > 0) return existing();
  try { return journal.append(definition.taskId, 0, created); }
  catch (error) { if (isConflict(error)) return existing(); throw error; }
}

/**
 * Releases a waiting step. `evidenceRef` names the record of the owner's
 * decision; this call does not make that decision and grants no approval.
 */
export function recordAyasDurableTaskOwnerSignal(journal: AyasDurableTaskJournal, taskId: string, stepId: string, outcome: "PROCEED" | "REJECT", evidenceRef: string): AyasDurableTaskState {
  return journal.append(taskId, requireState(journal, taskId).lastSequence, { type: "OWNER_SIGNAL_RECORDED", stepId, outcome, evidenceRef });
}

/** Refused by the contract while an attempt is running or a side effect is unconfirmed. */
export function cancelAyasDurableTask(journal: AyasDurableTaskJournal, taskId: string, reason: string): AyasDurableTaskState {
  return journal.append(taskId, requireState(journal, taskId).lastSequence, { type: "TASK_CANCELLED", reason });
}

function contextFor(state: AyasDurableTaskState, step: AyasDurableActivityStep, attempt: number, attemptId: string, signal: AbortSignal): AyasDurableActivityContext {
  const results: Record<string, AyasDurableJson> = {};
  state.stepStates.forEach((item) => { if (item.status === "SUCCEEDED" && item.result !== undefined) results[item.stepId] = item.result; });
  return Object.freeze({ taskId: state.taskId, domain: state.domain, stepId: step.stepId, attempt, attemptId, idempotencyKey: step.idempotencyKey,
    exactTarget: step.exactTarget, input: step.input, results: Object.freeze(results), signal });
}

/** Runs `work` against the step's timeout. A late rejection of an abandoned call is swallowed, never left unhandled. */
async function bounded<T>(timeoutMs: number, work: (signal: AbortSignal) => Promise<T>): Promise<{ readonly value: T } | "TIMEOUT"> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<"TIMEOUT">((resolve) => { timer = setTimeout(() => { controller.abort(); resolve("TIMEOUT"); }, timeoutMs); });
  const running = Promise.resolve().then(() => work(controller.signal)).then((value) => ({ value }));
  running.catch(() => undefined);
  try { return await Promise.race([running, timeout]); } finally { clearTimeout(timer); }
}

/** A storable result, or the reason it cannot be stored. */
function storable(result: unknown): { readonly resultDigest: string } | { readonly refused: string } {
  try {
    const resultDigest = ayasDurableResultDigest(result);
    return containsBrainSecret(ayasDurableCanonicalJson(result)) ? { refused: "result carries secret-like or absolute-path content" } : { resultDigest };
  } catch (error) { return { refused: line(error) }; }
}

async function attemptOutcome(step: AyasDurableActivityStep, activity: AyasDurableActivity, context: (signal: AbortSignal) => AyasDurableActivityContext, attemptId: string): Promise<AyasDurableTaskEventBody> {
  const unconfirmed = (cause: "TIMEOUT" | "ACTIVITY_ERROR", detail: string): AyasDurableTaskEventBody => ({ type: "ATTEMPT_UNCONFIRMED", stepId: step.stepId, attemptId, cause, detail });
  let settled: { readonly value: AyasDurableActivityOutcome } | "TIMEOUT";
  try { settled = await bounded(step.timeoutMs, (signal) => activity.run(context(signal))); }
  catch (error) { return unconfirmed("ACTIVITY_ERROR", line(error)); }
  if (settled === "TIMEOUT") return unconfirmed("TIMEOUT", `no result within ${step.timeoutMs} ms`);
  const outcome = settled.value as { outcome?: unknown; result?: unknown; reason?: unknown; retryable?: unknown } | null | undefined;
  if (outcome?.outcome === "SUCCEEDED") {
    const stored = storable(outcome.result);
    return "refused" in stored ? unconfirmed("ACTIVITY_ERROR", stored.refused)
      : { type: "ATTEMPT_SUCCEEDED", stepId: step.stepId, attemptId, result: outcome.result as AyasDurableJson, resultDigest: stored.resultDigest };
  }
  if (outcome?.outcome === "FAILED_NO_EFFECT" && typeof outcome.retryable === "boolean") {
    return { type: "ATTEMPT_FAILED", stepId: step.stepId, attemptId, reason: line(outcome.reason), retryable: outcome.retryable };
  }
  return unconfirmed("ACTIVITY_ERROR", outcome?.outcome === "UNKNOWN" ? line(outcome.reason) : "activity returned an unrecognised outcome");
}

/** Advances one task by at most one bounded step. See the module comment for what each decision does. */
export async function advanceAyasDurableTask(taskId: string, deps: AyasDurableTaskRuntimeDeps): Promise<AyasDurableTaskAdvance> {
  const { journal } = deps;
  const state = requireState(journal, taskId);
  const step = state.steps[state.currentStepIndex];
  const current = state.stepStates[state.currentStepIndex];
  let runningOwnerAlive: boolean | undefined;
  if (state.status === "ACTIVE" && current?.status === "RUNNING" && current.owner) {
    runningOwnerAlive = current.owner.nonce === deps.owner.nonce
      ? inFlight.has(`${taskId}:${current.attemptId}`)
      : await (deps.isOwnerAlive ?? ((owner) => isSameLiveProcess(owner.pid, owner.startEpochMs)))(current.owner);
  }
  const decision = decideAyasDurableTaskNext(state, { nowMs: (deps.nowMs ?? Date.now)(), runningOwnerAlive });
  const waited = (note?: AyasDurableTaskAdvance["note"], latest: AyasDurableTaskState = state): AyasDurableTaskAdvance => ({ decision, recorded: [], state: latest, ...(note ? { note } : {}) });
  const lostRace = (): AyasDurableTaskAdvance => waited("LOST_RACE", requireState(journal, taskId));

  if (decision.action === "RECORD_OWNER_GONE") {
    try {
      const next = journal.append(taskId, state.lastSequence, { type: "ATTEMPT_UNCONFIRMED", stepId: decision.stepId, attemptId: decision.attemptId, cause: "OWNER_GONE", detail: "the process that started this attempt is no longer running it" });
      return { decision, recorded: ["ATTEMPT_UNCONFIRMED"], state: next };
    } catch (error) { if (isConflict(error)) return lostRace(); throw error; }
  }
  if (decision.action !== "START_ATTEMPT" && decision.action !== "REREAD_CURRENT_STATE") return waited();

  // Both remaining decisions need the step's registered activity. A missing one is a deployment fault: nothing is recorded.
  const activityStep = step as AyasDurableActivityStep;
  const activity = Object.hasOwn(deps.activities, activityStep.activity) ? deps.activities[activityStep.activity] : undefined;
  if (!activity || typeof activity.run !== "function" || (activityStep.effect === "SIDE_EFFECT" && typeof activity.reread !== "function")) {
    throw new AyasDurableTaskError("AYAS_DURABLE_TASK_ACTIVITY_NOT_REGISTERED", `activity ${activityStep.activity} is not registered${activityStep.effect === "SIDE_EFFECT" ? " with a reread" : ""}`);
  }

  if (decision.action === "REREAD_CURRENT_STATE") {
    let observed: AyasDurableRereadOutcome | undefined;
    try {
      const settled = await bounded(activityStep.timeoutMs, (signal) => activity.reread!(contextFor(state, activityStep, current!.attempts, decision.attemptId, signal)));
      observed = settled === "TIMEOUT" ? undefined : settled.value;
    } catch { observed = undefined; }
    const applied = observed?.observation === "APPLIED" ? storable(observed.result) : undefined;
    if (!observed || !["APPLIED", "NOT_APPLIED", "UNKNOWN"].includes(observed.observation) || (applied && "refused" in applied)) return waited("REREAD_UNAVAILABLE");
    const base = { type: "STATE_REREAD", stepId: decision.stepId, attemptId: decision.attemptId, evidence: line(observed.evidence) } as const;
    try {
      const next = journal.append(taskId, state.lastSequence, observed.observation === "APPLIED"
        ? { ...base, observation: "APPLIED", result: observed.result, resultDigest: (applied as { resultDigest: string }).resultDigest }
        : { ...base, observation: observed.observation });
      return { decision, recorded: ["STATE_REREAD"], state: next };
    } catch (error) { if (isConflict(error)) return lostRace(); throw error; }
  }

  let started: AyasDurableTaskState;
  try { started = journal.append(taskId, state.lastSequence, { type: "ATTEMPT_STARTED", stepId: decision.stepId, attempt: decision.attempt, attemptId: decision.attemptId, owner: deps.owner }); }
  catch (error) { if (isConflict(error)) return lostRace(); throw error; }
  const key = `${taskId}:${decision.attemptId}`;
  inFlight.add(key);
  try {
    const ended = await attemptOutcome(activityStep, activity, (signal) => contextFor(state, activityStep, decision.attempt, decision.attemptId, signal), decision.attemptId);
    const next = journal.append(taskId, started.lastSequence, ended);
    return { decision, recorded: ["ATTEMPT_STARTED", ended.type], state: next };
  } finally { inFlight.delete(key); }
}
