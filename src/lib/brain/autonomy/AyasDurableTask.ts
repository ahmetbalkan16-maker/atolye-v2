import crypto from "node:crypto";

/**
 * Stage 15B — the shared durable task contract (pure).
 *
 * One contract for self-development, research, revenue and Atölye
 * supervision tasks. A task is an ordered list of steps and an append-only
 * event journal; its state is never stored, only replayed from the events.
 * This module holds the deterministic half: the contract, the reducer and
 * the decision about what may happen next. It performs no I/O, runs no
 * activity and grants no authority.
 *
 * Rules the reducer enforces, so that no caller can record an impossible
 * history:
 *  - Events form a hash chain from a fixed genesis digest. A gap, a reordered
 *    or an edited event fails replay.
 *  - Steps run in order. An event may only target the current step.
 *  - An attempt has a deterministic identity derived from the step's
 *    idempotency key and the attempt number, so two daemons racing for the
 *    same attempt write the same event at the same sequence and one loses.
 *  - A recorded result is final: a succeeded step never starts again.
 *  - A side effect whose outcome was not recorded is never retried on a
 *    guess. It needs a current-state reread: applied, not applied, or
 *    unknown. Unknown ends the task as UNCERTAIN for human review.
 *  - Retries are bounded by `maxAttempts`; a terminal task accepts no event.
 *
 * `OWNER_SIGNAL_RECORDED` only releases a waiting step. It is a reference to
 * a decision made elsewhere, never an approval: an activity that needs owner
 * approval must verify it in the approval store itself.
 */
export const ayasDurableTaskSchemaVersion = "1" as const;

export const AYAS_DURABLE_TASK_DOMAINS = ["SELF_DEVELOPMENT", "RESEARCH", "REVENUE", "ATOLYE_SUPERVISION"] as const;
export type AyasDurableTaskDomain = (typeof AYAS_DURABLE_TASK_DOMAINS)[number];

export type AyasDurableJson = null | boolean | number | string | readonly AyasDurableJson[] | { readonly [key: string]: AyasDurableJson };

export type AyasDurableTaskErrorCode =
  | "AYAS_DURABLE_TASK_CONTRACT_INVALID"
  | "AYAS_DURABLE_TASK_JOURNAL_CORRUPT"
  | "AYAS_DURABLE_TASK_ILLEGAL_EVENT"
  | "AYAS_DURABLE_TASK_SEQUENCE_CONFLICT"
  | "AYAS_DURABLE_TASK_KEY_CONFLICT"
  | "AYAS_DURABLE_TASK_NOT_FOUND"
  | "AYAS_DURABLE_TASK_ACTIVITY_NOT_REGISTERED"
  | "AYAS_DURABLE_TASK_ACTIVITY_MISMATCH"
  | "AYAS_DURABLE_TASK_LIVE_BINDING_REQUIRES_OWNER"
  | "AYAS_DURABLE_TASK_SECRET_REFUSED"
  | "AYAS_DURABLE_TASK_IO";

export class AyasDurableTaskError extends Error {
  constructor(readonly code: AyasDurableTaskErrorCode, message: string) {
    super(message);
    this.name = "AyasDurableTaskError";
    this.stack = undefined;
  }
}

export interface AyasDurableActivityStep {
  readonly stepId: string;
  readonly kind: "ACTIVITY";
  /** Name in the caller's closed activity registry. Model or tool text never selects it. */
  readonly activity: string;
  readonly effect: "READ_ONLY" | "SIDE_EFFECT";
  readonly exactTarget: string;
  readonly input: AyasDurableJson;
  readonly timeoutMs: number;
  readonly maxAttempts: number;
  readonly retryDelayMs: number;
  /** Stable across attempts: derived from the task, step, activity, effect, target and input. */
  readonly idempotencyKey: string;
}
export interface AyasDurableOwnerWaitStep {
  readonly stepId: string;
  readonly kind: "OWNER_WAIT";
  readonly question: string;
}
export type AyasDurableTaskStep = AyasDurableActivityStep | AyasDurableOwnerWaitStep;

export interface AyasDurableTaskDefinitionInput {
  readonly domain: AyasDurableTaskDomain;
  /** Caller's dedupe key: the same domain and key always name the same task. */
  readonly taskKey: string;
  readonly title: string;
  readonly steps: readonly (Omit<AyasDurableActivityStep, "idempotencyKey"> | AyasDurableOwnerWaitStep)[];
}
export interface AyasDurableTaskDefinition {
  readonly taskId: string;
  readonly taskKey: string;
  readonly domain: AyasDurableTaskDomain;
  readonly title: string;
  readonly steps: readonly AyasDurableTaskStep[];
}

export interface AyasDurableTaskOwner {
  readonly pid: number;
  readonly startEpochMs: number;
  readonly nonce: string;
}

export type AyasDurableTaskEventBody =
  | { readonly type: "TASK_CREATED"; readonly taskKey: string; readonly domain: AyasDurableTaskDomain; readonly title: string; readonly steps: readonly AyasDurableTaskStep[] }
  | { readonly type: "ATTEMPT_STARTED"; readonly stepId: string; readonly attempt: number; readonly attemptId: string; readonly owner: AyasDurableTaskOwner }
  | { readonly type: "ATTEMPT_SUCCEEDED"; readonly stepId: string; readonly attemptId: string; readonly result: AyasDurableJson; readonly resultDigest: string }
  | { readonly type: "ATTEMPT_FAILED"; readonly stepId: string; readonly attemptId: string; readonly reason: string; readonly retryable: boolean }
  | { readonly type: "ATTEMPT_UNCONFIRMED"; readonly stepId: string; readonly attemptId: string; readonly cause: "TIMEOUT" | "OWNER_GONE" | "ACTIVITY_ERROR"; readonly detail: string }
  | { readonly type: "STATE_REREAD"; readonly stepId: string; readonly attemptId: string; readonly observation: "APPLIED"; readonly evidence: string; readonly result: AyasDurableJson; readonly resultDigest: string }
  | { readonly type: "STATE_REREAD"; readonly stepId: string; readonly attemptId: string; readonly observation: "NOT_APPLIED" | "UNKNOWN"; readonly evidence: string }
  | { readonly type: "OWNER_SIGNAL_RECORDED"; readonly stepId: string; readonly outcome: "PROCEED" | "REJECT"; readonly evidenceRef: string }
  | { readonly type: "TASK_CANCELLED"; readonly reason: string };

export type AyasDurableTaskEvent = AyasDurableTaskEventBody & {
  readonly schemaVersion: typeof ayasDurableTaskSchemaVersion;
  readonly taskId: string;
  readonly sequence: number;
  readonly at: string;
  readonly previousDigest: string;
  readonly digest: string;
};

export type AyasDurableStepStatus = "PENDING" | "RUNNING" | "RETRY_WAIT" | "NEEDS_REREAD" | "SUCCEEDED" | "FAILED" | "UNCERTAIN" | "REJECTED";
export type AyasDurableTaskStatus = "ACTIVE" | "COMPLETED" | "FAILED" | "UNCERTAIN" | "REJECTED" | "CANCELLED";

export interface AyasDurableStepState {
  readonly stepId: string;
  readonly status: AyasDurableStepStatus;
  readonly attempts: number;
  /** The running or unconfirmed attempt. */
  readonly attemptId?: string;
  readonly deadlineAtMs?: number;
  readonly owner?: AyasDurableTaskOwner;
  readonly retryAtMs?: number;
  readonly result?: AyasDurableJson;
  readonly detail?: string;
}
export interface AyasDurableTaskState extends AyasDurableTaskDefinition {
  readonly status: AyasDurableTaskStatus;
  /** Index of the first step that has not succeeded; `steps.length` once all have. */
  readonly currentStepIndex: number;
  readonly stepStates: readonly AyasDurableStepState[];
  readonly detail?: string;
  readonly lastSequence: number;
  readonly lastDigest: string;
  readonly updatedAt: string;
}

export type AyasDurableTaskDecision =
  | { readonly action: "START_ATTEMPT"; readonly stepId: string; readonly attempt: number; readonly attemptId: string }
  | { readonly action: "WAIT_RETRY"; readonly stepId: string; readonly retryAtMs: number }
  | { readonly action: "AWAIT_RUNNING_ATTEMPT"; readonly stepId: string; readonly attemptId: string; readonly overdueMs: number }
  | { readonly action: "RECORD_OWNER_GONE"; readonly stepId: string; readonly attemptId: string }
  | { readonly action: "REREAD_CURRENT_STATE"; readonly stepId: string; readonly attemptId: string }
  | { readonly action: "WAIT_OWNER"; readonly stepId: string; readonly question: string }
  | { readonly action: "NONE"; readonly status: Exclude<AyasDurableTaskStatus, "ACTIVE"> };

export const AYAS_DURABLE_TASK_GENESIS_DIGEST = "0".repeat(64);
export const AYAS_DURABLE_TASK_ID = /^ayas-task-[a-f0-9]{32}$/;
/** Largest canonical JSON a step input, a result or one whole event may carry. */
export const AYAS_DURABLE_TASK_MAX_JSON_BYTES = 16_384;

const MAX_STEPS = 32;
const MAX_TIMEOUT_MS = 4 * 3_600_000;
const MAX_ATTEMPTS = 5;
const MAX_RETRY_DELAY_MS = 86_400_000;
const STEP_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ACTIVITY_NAME = /^[a-z][a-z0-9.-]{0,63}$/;
const HEX_64 = /^[a-f0-9]{64}$/;

type Code = "AYAS_DURABLE_TASK_CONTRACT_INVALID" | "AYAS_DURABLE_TASK_JOURNAL_CORRUPT";
const CORRUPT = "AYAS_DURABLE_TASK_JOURNAL_CORRUPT" as const;

function fail(code: AyasDurableTaskErrorCode, message: string): never { throw new AyasDurableTaskError(code, message); }
function illegal(message: string): never { return fail("AYAS_DURABLE_TASK_ILLEGAL_EVENT", message); }
const sha = (value: string): string => crypto.createHash("sha256").update(value, "utf8").digest("hex");

function record(value: unknown, code: Code, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code, `${label} is not an object`);
  return value as Record<string, unknown>;
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[], code: Code, label: string): void {
  const actual = Object.keys(value);
  if (actual.length !== keys.length || !keys.every((key) => Object.hasOwn(value, key))) fail(code, `${label} has unexpected or missing fields`);
}
/** One printable line: no control characters, so a stored text can never carry a second instruction line. */
function text(value: unknown, max: number, code: Code, label: string): string {
  if (typeof value !== "string" || value.length < 1 || value.length > max
    || [...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) fail(code, `${label} must be one line of 1..${max} characters`);
  return value as string;
}
function matching(value: unknown, pattern: RegExp, code: Code, label: string): string {
  if (typeof value !== "string" || !pattern.test(value)) fail(code, `${label} is malformed`);
  return value as string;
}
function integer(value: unknown, min: number, max: number, code: Code, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) fail(code, `${label} must be an integer in ${min}..${max}`);
  return value as number;
}
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const item of Object.values(value as object)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}

/** Key-sorted JSON of plain data only. The same value always yields the same bytes, so digests are reproducible. */
export function ayasDurableCanonicalJson(value: unknown, code: Code = "AYAS_DURABLE_TASK_CONTRACT_INVALID", depth = 0): string {
  if (depth > 16) fail(code, "JSON value is nested too deeply");
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value) : fail(code, "JSON number is not finite");
  if (Array.isArray(value)) return `[${value.map((item) => ayasDurableCanonicalJson(item, code, depth + 1)).join(",")}]`;
  if (typeof value === "object" && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    const item = value as Record<string, unknown>;
    return `{${Object.keys(item).sort().map((key) => `${JSON.stringify(key)}:${ayasDurableCanonicalJson(item[key], code, depth + 1)}`).join(",")}}`;
  }
  return fail(code, "value is not plain JSON");
}
function boundedJson(value: unknown, code: Code, label: string): string {
  const json = ayasDurableCanonicalJson(value, code);
  if (Buffer.byteLength(json, "utf8") > AYAS_DURABLE_TASK_MAX_JSON_BYTES) fail(code, `${label} exceeds ${AYAS_DURABLE_TASK_MAX_JSON_BYTES} bytes`);
  return json;
}
export function ayasDurableResultDigest(result: unknown): string { return sha(boundedJson(result, "AYAS_DURABLE_TASK_CONTRACT_INVALID", "result")); }
export function ayasDurableAttemptId(idempotencyKey: string, attempt: number): string { return sha(`${idempotencyKey}\0${attempt}`).slice(0, 32); }

function parseDefinition(value: unknown, code: Code): AyasDurableTaskDefinition {
  const input = record(value, code, "task definition");
  exactKeys(input, ["domain", "taskKey", "title", "steps"], code, "task definition");
  if (!AYAS_DURABLE_TASK_DOMAINS.includes(input.domain as AyasDurableTaskDomain)) fail(code, "unknown task domain");
  const domain = input.domain as AyasDurableTaskDomain;
  const taskKey = text(input.taskKey, 200, code, "taskKey");
  const taskId = `ayas-task-${sha(`${domain}\0${taskKey}`).slice(0, 32)}`;
  if (!Array.isArray(input.steps) || input.steps.length < 1 || input.steps.length > MAX_STEPS) fail(code, `steps must hold 1..${MAX_STEPS} entries`);
  const seen = new Set<string>();
  const steps = (input.steps as unknown[]).map((raw, index): AyasDurableTaskStep => {
    const step = record(raw, code, `step ${index}`);
    const stepId = matching(step.stepId, STEP_ID, code, "stepId");
    if (seen.has(stepId)) fail(code, `duplicate stepId ${stepId}`);
    seen.add(stepId);
    if (step.kind === "OWNER_WAIT") {
      exactKeys(step, ["stepId", "kind", "question"], code, `step ${stepId}`);
      return { stepId, kind: "OWNER_WAIT", question: text(step.question, 500, code, "question") };
    }
    if (step.kind !== "ACTIVITY") fail(code, `step ${stepId} has an unknown kind`);
    const stored = Object.hasOwn(step, "idempotencyKey");
    exactKeys(step, ["stepId", "kind", "activity", "effect", "exactTarget", "input", "timeoutMs", "maxAttempts", "retryDelayMs", ...(stored ? ["idempotencyKey"] : [])], code, `step ${stepId}`);
    const activity = matching(step.activity, ACTIVITY_NAME, code, "activity");
    if (step.effect !== "READ_ONLY" && step.effect !== "SIDE_EFFECT") fail(code, `step ${stepId} has an unknown effect`);
    const effect = step.effect as "READ_ONLY" | "SIDE_EFFECT";
    const exactTarget = text(step.exactTarget, 512, code, "exactTarget");
    const input = boundedJson(step.input, code, "step input");
    const idempotencyKey = sha([taskId, stepId, activity, effect, exactTarget, input].join("\0"));
    if (stored && step.idempotencyKey !== idempotencyKey) fail(code, `step ${stepId} idempotency key does not match its derivation`);
    return { stepId, kind: "ACTIVITY", activity, effect, exactTarget, input: JSON.parse(input) as AyasDurableJson,
      timeoutMs: integer(step.timeoutMs, 1, MAX_TIMEOUT_MS, code, "timeoutMs"), maxAttempts: integer(step.maxAttempts, 1, MAX_ATTEMPTS, code, "maxAttempts"),
      retryDelayMs: integer(step.retryDelayMs, 0, MAX_RETRY_DELAY_MS, code, "retryDelayMs"), idempotencyKey };
  });
  return deepFreeze({ taskId, taskKey, domain, title: text(input.title, 200, code, "title"), steps });
}

/** Validates a caller's task definition and derives its task ID and idempotency keys. Unknown fields are refused. */
export function defineAyasDurableTask(input: unknown): AyasDurableTaskDefinition {
  return parseDefinition(input, "AYAS_DURABLE_TASK_CONTRACT_INVALID");
}

/** Builds the next event of a chain. `previous` is the journal's last event, or `undefined` for the first one. */
export function sealAyasDurableTaskEvent(taskId: string, previous: { readonly sequence: number; readonly digest: string } | undefined, at: string, body: AyasDurableTaskEventBody): AyasDurableTaskEvent {
  const unsigned = { ...body, schemaVersion: ayasDurableTaskSchemaVersion, taskId, sequence: (previous?.sequence ?? 0) + 1, at, previousDigest: previous?.digest ?? AYAS_DURABLE_TASK_GENESIS_DIGEST };
  return deepFreeze({ ...unsigned, digest: sha(ayasDurableCanonicalJson(unsigned)) }) as AyasDurableTaskEvent;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
interface Work extends Mutable<Omit<AyasDurableTaskState, "stepStates">> { stepStates: Mutable<AyasDurableStepState>[] }

const BASE_KEYS = ["schemaVersion", "taskId", "sequence", "at", "previousDigest", "digest", "type"] as const;
function body(event: Record<string, unknown>, keys: readonly string[]): void { exactKeys(event, [...BASE_KEYS, ...keys], CORRUPT, `event ${String(event.sequence)}`); }

function succeed(work: Work, state: Mutable<AyasDurableStepState>, result: AyasDurableJson | undefined): void {
  state.status = "SUCCEEDED";
  if (result !== undefined) state.result = result;
  delete state.attemptId; delete state.deadlineAtMs; delete state.owner; delete state.retryAtMs;
  work.currentStepIndex += 1;
  if (work.currentStepIndex === work.steps.length) work.status = "COMPLETED";
}
function retryOrFail(work: Work, step: AyasDurableActivityStep, state: Mutable<AyasDurableStepState>, atMs: number, detail: string, retryable = true): void {
  delete state.attemptId; delete state.deadlineAtMs; delete state.owner;
  state.detail = detail;
  if (retryable && state.attempts < step.maxAttempts) { state.status = "RETRY_WAIT"; state.retryAtMs = atMs + step.retryDelayMs; return; }
  state.status = "FAILED"; work.status = "FAILED"; work.detail = detail;
}
function recordedResult(event: Record<string, unknown>): AyasDurableJson {
  const json = boundedJson(event.result, CORRUPT, "result");
  if (event.resultDigest !== sha(json)) fail(CORRUPT, `event ${String(event.sequence)} result does not match its digest`);
  return deepFreeze(JSON.parse(json) as AyasDurableJson);
}

function applyEvent(work: Work, event: Record<string, unknown>, atMs: number): void {
  if (work.status !== "ACTIVE") illegal(`task is ${work.status}; a terminal task accepts no event`);
  const step = work.steps[work.currentStepIndex]!;
  const state = work.stepStates[work.currentStepIndex]!;
  if (event.type === "TASK_CANCELLED") {
    body(event, ["reason"]);
    if (state.status === "RUNNING" || state.status === "NEEDS_REREAD") illegal("an attempt is running or unconfirmed; the task cannot be cancelled over it");
    work.status = "CANCELLED"; work.detail = text(event.reason, 500, CORRUPT, "reason");
    return;
  }
  if (event.stepId !== step.stepId) illegal(`event targets step ${String(event.stepId)} but the current step is ${step.stepId}`);
  if (event.type === "OWNER_SIGNAL_RECORDED") {
    body(event, ["stepId", "outcome", "evidenceRef"]);
    if (step.kind !== "OWNER_WAIT") illegal(`step ${step.stepId} does not wait for the owner`);
    text(event.evidenceRef, 200, CORRUPT, "evidenceRef");
    if (event.outcome === "PROCEED") { succeed(work, state, undefined); return; }
    if (event.outcome !== "REJECT") fail(CORRUPT, "unknown owner signal outcome");
    state.status = "REJECTED"; work.status = "REJECTED"; work.detail = `owner rejected step ${step.stepId}`;
    return;
  }
  if (step.kind !== "ACTIVITY") illegal(`step ${step.stepId} waits for the owner and runs no attempt`);
  if (event.type === "ATTEMPT_STARTED") {
    body(event, ["stepId", "attempt", "attemptId", "owner"]);
    if (state.status !== "PENDING" && state.status !== "RETRY_WAIT") illegal(`step ${step.stepId} is ${state.status}; a new attempt cannot start`);
    if (event.attempt !== state.attempts + 1 || state.attempts >= step.maxAttempts) illegal(`attempt ${String(event.attempt)} is out of order or beyond the retry bound`);
    if (state.retryAtMs !== undefined && atMs < state.retryAtMs) illegal("the retry delay has not elapsed");
    if (event.attemptId !== ayasDurableAttemptId(step.idempotencyKey, state.attempts + 1)) illegal("attempt identity does not match its derivation");
    const owner = record(event.owner, CORRUPT, "owner");
    exactKeys(owner, ["pid", "startEpochMs", "nonce"], CORRUPT, "owner");
    state.owner = { pid: integer(owner.pid, 1, Number.MAX_SAFE_INTEGER, CORRUPT, "owner pid"), startEpochMs: integer(owner.startEpochMs, 0, Number.MAX_SAFE_INTEGER, CORRUPT, "owner start"), nonce: text(owner.nonce, 100, CORRUPT, "owner nonce") };
    state.status = "RUNNING"; state.attempts += 1; state.attemptId = event.attemptId as string; state.deadlineAtMs = atMs + step.timeoutMs;
    delete state.retryAtMs; delete state.detail;
    return;
  }
  if (event.type === "STATE_REREAD") {
    body(event, event.observation === "APPLIED" ? ["stepId", "attemptId", "observation", "evidence", "result", "resultDigest"] : ["stepId", "attemptId", "observation", "evidence"]);
    if (state.status !== "NEEDS_REREAD" || event.attemptId !== state.attemptId) illegal(`step ${step.stepId} has no unconfirmed attempt ${String(event.attemptId)}`);
    const evidence = text(event.evidence, 500, CORRUPT, "evidence");
    if (event.observation === "APPLIED") { succeed(work, state, recordedResult(event)); return; }
    if (event.observation === "NOT_APPLIED") { retryOrFail(work, step, state, atMs, `not applied: ${evidence}`); return; }
    if (event.observation !== "UNKNOWN") fail(CORRUPT, "unknown reread observation");
    state.status = "UNCERTAIN"; state.detail = evidence;
    work.status = "UNCERTAIN"; work.detail = `side effect of step ${step.stepId} is unproven: ${evidence}`;
    return;
  }
  if (event.type !== "ATTEMPT_SUCCEEDED" && event.type !== "ATTEMPT_FAILED" && event.type !== "ATTEMPT_UNCONFIRMED") fail(CORRUPT, `event ${String(event.sequence)} has an unknown type`);
  if (state.status !== "RUNNING" || event.attemptId !== state.attemptId) illegal(`step ${step.stepId} has no running attempt ${String(event.attemptId)}`);
  if (event.type === "ATTEMPT_SUCCEEDED") {
    body(event, ["stepId", "attemptId", "result", "resultDigest"]);
    succeed(work, state, recordedResult(event));
  } else if (event.type === "ATTEMPT_FAILED") {
    body(event, ["stepId", "attemptId", "reason", "retryable"]);
    if (typeof event.retryable !== "boolean") fail(CORRUPT, "retryable must be a boolean");
    retryOrFail(work, step, state, atMs, text(event.reason, 500, CORRUPT, "reason"), event.retryable as boolean);
  } else {
    body(event, ["stepId", "attemptId", "cause", "detail"]);
    if (!["TIMEOUT", "OWNER_GONE", "ACTIVITY_ERROR"].includes(event.cause as string)) fail(CORRUPT, "unknown unconfirmed cause");
    const detail = `${String(event.cause)}: ${text(event.detail, 500, CORRUPT, "detail")}`;
    // An unrecorded read can simply be read again. An unrecorded side effect may have landed: only a reread may say.
    if (step.effect === "SIDE_EFFECT") { state.status = "NEEDS_REREAD"; state.detail = detail; delete state.deadlineAtMs; delete state.owner; }
    else retryOrFail(work, step, state, atMs, detail);
  }
}

/**
 * Rebuilds a task's state from its complete event list. Throws on a broken
 * chain, a malformed event or a transition the contract does not allow, so a
 * damaged journal is never read as a shorter or a different history.
 */
export function replayAyasDurableTask(events: readonly unknown[]): AyasDurableTaskState {
  if (events.length === 0) fail(CORRUPT, "a task journal cannot be empty");
  let work: Work | undefined;
  let previousDigest = AYAS_DURABLE_TASK_GENESIS_DIGEST;
  events.forEach((raw, index) => {
    const event = record(raw, CORRUPT, `event ${index + 1}`);
    const { digest, ...unsigned } = event;
    if (event.schemaVersion !== ayasDurableTaskSchemaVersion) fail(CORRUPT, `event ${index + 1} has an unsupported schema`);
    if (event.sequence !== index + 1) fail(CORRUPT, `event ${index + 1} is out of sequence`);
    if (event.previousDigest !== previousDigest || typeof digest !== "string" || !HEX_64.test(digest) || digest !== sha(ayasDurableCanonicalJson(unsigned, CORRUPT))) fail(CORRUPT, `event ${index + 1} breaks the digest chain`);
    const atMs = typeof event.at === "string" ? Date.parse(event.at) : Number.NaN;
    if (!Number.isFinite(atMs)) fail(CORRUPT, `event ${index + 1} has no valid time`);
    const taskId = matching(event.taskId, AYAS_DURABLE_TASK_ID, CORRUPT, "taskId");
    if (!work) {
      if (event.type !== "TASK_CREATED") fail(CORRUPT, "the first event must create the task");
      body(event, ["taskKey", "domain", "title", "steps"]);
      const definition = parseDefinition({ domain: event.domain, taskKey: event.taskKey, title: event.title, steps: event.steps }, CORRUPT);
      if (definition.taskId !== taskId) fail(CORRUPT, "task ID does not match its domain and key");
      work = { ...definition, status: "ACTIVE", currentStepIndex: 0, stepStates: definition.steps.map((step) => ({ stepId: step.stepId, status: "PENDING", attempts: 0 })), lastSequence: 0, lastDigest: previousDigest, updatedAt: event.at as string };
    } else {
      if (taskId !== work.taskId) fail(CORRUPT, `event ${index + 1} belongs to another task`);
      if (event.type === "TASK_CREATED") illegal("a task is created exactly once");
      applyEvent(work, event, atMs);
    }
    previousDigest = digest as string;
    work.lastSequence = index + 1; work.lastDigest = previousDigest; work.updatedAt = event.at as string;
  });
  return deepFreeze(work!) as AyasDurableTaskState;
}

/**
 * The deterministic orchestration decision: what, if anything, may happen
 * next. `runningOwnerAlive` is the one outside observation it needs; anything
 * but an explicit `false` is treated as a live owner, so a possibly-running
 * attempt is never started a second time.
 */
export function decideAyasDurableTaskNext(state: AyasDurableTaskState, input: { readonly nowMs: number; readonly runningOwnerAlive?: boolean }): AyasDurableTaskDecision {
  if (state.status !== "ACTIVE") return { action: "NONE", status: state.status };
  const step = state.steps[state.currentStepIndex]!;
  const current = state.stepStates[state.currentStepIndex]!;
  if (step.kind === "OWNER_WAIT") return { action: "WAIT_OWNER", stepId: step.stepId, question: step.question };
  if (current.status === "RUNNING") {
    if (input.runningOwnerAlive === false) return { action: "RECORD_OWNER_GONE", stepId: step.stepId, attemptId: current.attemptId! };
    return { action: "AWAIT_RUNNING_ATTEMPT", stepId: step.stepId, attemptId: current.attemptId!, overdueMs: Math.max(0, input.nowMs - current.deadlineAtMs!) };
  }
  if (current.status === "NEEDS_REREAD") return { action: "REREAD_CURRENT_STATE", stepId: step.stepId, attemptId: current.attemptId! };
  if (current.status === "RETRY_WAIT" && input.nowMs < current.retryAtMs!) return { action: "WAIT_RETRY", stepId: step.stepId, retryAtMs: current.retryAtMs! };
  return { action: "START_ATTEMPT", stepId: step.stepId, attempt: current.attempts + 1, attemptId: ayasDurableAttemptId(step.idempotencyKey, current.attempts + 1) };
}
