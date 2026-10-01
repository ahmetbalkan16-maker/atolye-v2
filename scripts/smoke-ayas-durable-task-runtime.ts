/**
 * Stage 15B — durable long-horizon task runtime.
 *
 * Every scenario works in its own TEMP journal root. No repository data, live
 * runtime or authority directory is read or written, no model, network or
 * container is used, and the activities are in-memory fakes.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  AYAS_DURABLE_TASK_DOMAINS,
  AyasDurableTaskError,
  ayasDurableAttemptId,
  decideAyasDurableTaskNext,
  defineAyasDurableTask,
  replayAyasDurableTask,
  sealAyasDurableTaskEvent,
  type AyasDurableJson,
  type AyasDurableTaskOwner,
} from "../src/lib/brain/autonomy/AyasDurableTask";
import { createAyasDurableTaskJournal, type AyasDurableTaskJournal } from "../src/lib/brain/autonomy/AyasDurableTaskJournal";
import {
  advanceAyasDurableTask,
  cancelAyasDurableTask,
  createAyasDurableTask,
  createAyasDurableTaskOwner,
  recordAyasDurableTaskOwnerSignal,
  type AyasDurableActivity,
  type AyasDurableTaskRuntimeDeps,
} from "../src/lib/brain/autonomy/AyasDurableTaskRuntime";

const base = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-durable-task-"));
assert.ok(fs.realpathSync(base).toLowerCase().startsWith(fs.realpathSync(os.tmpdir()).toLowerCase() + path.sep), "TEMP_ROOT_REQUIRED");
let scenarios = 0;
let roots = 0;

/** A clock both the journal and the runtime read, so a test can move time without waiting. */
function world(): { journal: AyasDurableTaskJournal; root: string; clock: { ms: number }; deps: (activities: Record<string, AyasDurableActivity>, owner?: AyasDurableTaskOwner, alive?: boolean) => AyasDurableTaskRuntimeDeps } {
  const root = path.join(base, `root-${++roots}`);
  const clock = { ms: Date.parse("2026-10-01T10:00:00.000Z") };
  const journal = createAyasDurableTaskJournal({ rootDir: root, now: () => new Date(clock.ms) });
  return { journal, root, clock, deps: (activities, owner = self, alive) => ({ journal, activities, owner, nowMs: () => clock.ms, ...(alive === undefined ? {} : { isOwnerAlive: async () => alive }) }) };
}
const self: AyasDurableTaskOwner = { pid: process.pid, startEpochMs: 1, nonce: "owner-self" };
const other: AyasDurableTaskOwner = { pid: 999_999, startEpochMs: 2, nonce: "owner-crashed" };
const read = (stepId: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ stepId, kind: "ACTIVITY", activity: "fake.read", effect: "READ_ONLY", exactTarget: "research:source-1", input: { query: "q" }, timeoutMs: 1000, maxAttempts: 3, retryDelayMs: 500, ...extra });
const write = (stepId: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ stepId, kind: "ACTIVITY", activity: "fake.write", effect: "SIDE_EFFECT", exactTarget: "listing:draft-7", input: { price: 12 }, timeoutMs: 1000, maxAttempts: 2, retryDelayMs: 0, ...extra });
const task = (taskKey: string, steps: unknown[], domain = "RESEARCH"): Record<string, unknown> => ({ domain, taskKey, title: "Durable task smoke", steps });
async function expectCode(code: string, work: () => unknown): Promise<void> {
  await assert.rejects(async () => { await work(); }, (error: unknown) => error instanceof AyasDurableTaskError && error.code === code, `expected ${code}`);
}
async function scenario(name: string, work: () => Promise<void> | void): Promise<void> {
  try { await work(); scenarios++; }
  catch (error) { console.error(`FAIL: ${name}`); throw error; }
}
/** A fake target system: one value per idempotency key, so a repeat is visible. */
function target(): { applied: Map<string, AyasDurableJson>; runs: string[]; rereads: number } { return { applied: new Map(), runs: [], rereads: 0 }; }

async function main(): Promise<void> {
  await scenario("contract: valid definitions, derived identities, refusals", () => {
    for (const domain of AYAS_DURABLE_TASK_DOMAINS) assert.match(defineAyasDurableTask(task("k", [read("a")], domain)).taskId, /^ayas-task-[a-f0-9]{32}$/);
    const one = defineAyasDurableTask(task("k", [read("a"), write("b")]));
    const two = defineAyasDurableTask(task("k", [read("a"), write("b")]));
    assert.deepEqual(one, two);
    assert.ok(Object.isFrozen(one) && Object.isFrozen(one.steps) && Object.isFrozen(one.steps[0]));
    assert.notEqual(defineAyasDurableTask(task("k2", [read("a")])).taskId, one.taskId);
    const [a, b] = one.steps.map((step) => (step as { idempotencyKey: string }).idempotencyKey) as [string, string];
    assert.match(a, /^[a-f0-9]{64}$/);
    assert.notEqual(a, b);
    assert.notEqual(ayasDurableAttemptId(a, 1), ayasDurableAttemptId(a, 2));
    const refused: unknown[] = [
      null, [], task("k", []), task("k", [read("a")], "MARKETING"), task("", [read("a")]), { ...task("k", [read("a")]), ownerApproval: true },
      task("k", [read("a"), read("a")]), task("k", [read("A")]), task("k", [read("a", { activity: "Run Shell" })]), task("k", [read("a", { effect: "WRITE" })]),
      task("k", [read("a", { exactTarget: "" })]), task("k", [read("a", { exactTarget: "one\ntwo" })]), task("k", [read("a", { timeoutMs: 0 })]),
      task("k", [read("a", { maxAttempts: 6 })]), task("k", [read("a", { retryDelayMs: -1 })]), task("k", [read("a", { input: { big: "x".repeat(20_000) } })]),
      task("k", [read("a", { input: { when: new Date() } })]), task("k", [read("a", { command: "git push" })]), task("k", [{ stepId: "w", kind: "OWNER_WAIT" }]),
      task("k", [{ stepId: "w", kind: "OWNER_WAIT", question: "ok?", approved: true }]), task("k", [{ stepId: "x", kind: "SHELL" }]),
      task("k", Array.from({ length: 33 }, (_, index) => read(`s${index}`))), task("k", [read("a", { idempotencyKey: "0".repeat(64) })]),
    ];
    for (const item of refused) assert.throws(() => defineAyasDurableTask(item), (error: unknown) => error instanceof AyasDurableTaskError && error.code === "AYAS_DURABLE_TASK_CONTRACT_INVALID");
  });

  await scenario("happy path: three steps, one call each, results flow forward", async () => {
    const w = world(); const system = target(); const seen: unknown[] = [];
    const activities: Record<string, AyasDurableActivity> = {
      "fake.read": { run: async (ctx) => { system.runs.push(ctx.stepId); seen.push(ctx.results); return { outcome: "SUCCEEDED", result: { found: ctx.stepId } }; } },
      "fake.write": { run: async (ctx) => { system.runs.push(ctx.stepId); system.applied.set(ctx.idempotencyKey, ctx.input); return { outcome: "SUCCEEDED", result: { applied: true } }; },
        reread: async () => ({ observation: "UNKNOWN", evidence: "not used" }) },
    };
    const created = createAyasDurableTask(w.journal, task("happy", [read("gather"), write("apply"), read("verify")], "REVENUE"));
    assert.equal(created.status, "ACTIVE");
    const first = await advanceAyasDurableTask(created.taskId, w.deps(activities));
    assert.deepEqual(first.recorded, ["ATTEMPT_STARTED", "ATTEMPT_SUCCEEDED"]);
    assert.equal(first.state.currentStepIndex, 1);
    await advanceAyasDurableTask(created.taskId, w.deps(activities));
    const done = await advanceAyasDurableTask(created.taskId, w.deps(activities));
    assert.equal(done.state.status, "COMPLETED");
    assert.deepEqual(system.runs, ["gather", "apply", "verify"]);
    assert.deepEqual(seen[1], { gather: { found: "gather" }, apply: { applied: true } });
    assert.equal(w.journal.read(created.taskId).length, 7);
    // A completed task is terminal: no call runs anything and no event is accepted.
    const after = await advanceAyasDurableTask(created.taskId, w.deps(activities));
    assert.deepEqual([after.decision, after.recorded], [{ action: "NONE", status: "COMPLETED" }, []]);
    assert.equal(system.runs.length, 3);
    await expectCode("AYAS_DURABLE_TASK_ILLEGAL_EVENT", () => cancelAyasDurableTask(w.journal, created.taskId, "too late"));
    assert.deepEqual(w.journal.list(), [created.taskId]);
  });

  await scenario("restart: a recorded result is never produced again", async () => {
    const w = world(); let calls = 0;
    const activities: Record<string, AyasDurableActivity> = { "fake.read": { run: async () => ({ outcome: "SUCCEEDED", result: ++calls }) } };
    const { taskId } = createAyasDurableTask(w.journal, task("restart", [read("one"), read("two")]));
    await advanceAyasDurableTask(taskId, w.deps(activities));
    // A new process: a fresh journal handle over the same directory and a different owner.
    const reborn = createAyasDurableTaskJournal({ rootDir: w.root, now: () => new Date(w.clock.ms) });
    const next = await advanceAyasDurableTask(taskId, { journal: reborn, activities, owner: { pid: process.pid, startEpochMs: 9, nonce: "owner-reborn" }, nowMs: () => w.clock.ms });
    assert.equal(next.decision.action === "START_ATTEMPT" && next.decision.stepId, "two");
    assert.equal(next.state.status, "COMPLETED");
    assert.equal(calls, 2);
    assert.deepEqual(next.state.stepStates.map((item) => item.result), [1, 2]);
  });

  await scenario("process crash during a read: closed as unconfirmed, then retried within the bound", async () => {
    const w = world(); let calls = 0;
    const activities: Record<string, AyasDurableActivity> = { "fake.read": { run: async (ctx) => ({ outcome: "SUCCEEDED", result: { attempt: ctx.attempt, call: ++calls } }) } };
    const created = createAyasDurableTask(w.journal, task("crash-read", [read("one", { retryDelayMs: 0 })]));
    const step = created.steps[0] as { idempotencyKey: string };
    w.journal.append(created.taskId, 1, { type: "ATTEMPT_STARTED", stepId: "one", attempt: 1, attemptId: ayasDurableAttemptId(step.idempotencyKey, 1), owner: other });
    const gone = await advanceAyasDurableTask(created.taskId, w.deps(activities, self, false));
    assert.deepEqual([gone.decision.action, gone.recorded, calls], ["RECORD_OWNER_GONE", ["ATTEMPT_UNCONFIRMED"], 0]);
    assert.equal(gone.state.stepStates[0]!.status, "RETRY_WAIT");
    const retried = await advanceAyasDurableTask(created.taskId, w.deps(activities));
    assert.equal(retried.state.status, "COMPLETED");
    assert.deepEqual(retried.state.stepStates[0]!.result, { attempt: 2, call: 1 });
  });

  await scenario("crash during a side effect that landed: reread proves it, the effect is not repeated", async () => {
    const w = world(); const system = target();
    const activities: Record<string, AyasDurableActivity> = { "fake.write": {
      run: async (ctx) => { system.runs.push(ctx.attemptId); return { outcome: "SUCCEEDED", result: { applied: true } }; },
      reread: async (ctx) => { system.rereads++; return system.applied.has(ctx.idempotencyKey) ? { observation: "APPLIED", result: { applied: true, recovered: true }, evidence: "target holds this idempotency key" } : { observation: "NOT_APPLIED", evidence: "target has no such key" }; } } };
    const created = createAyasDurableTask(w.journal, task("crash-write-landed", [write("apply")], "ATOLYE_SUPERVISION"));
    const step = created.steps[0] as { idempotencyKey: string };
    // The crashed process applied the effect and died before recording it.
    system.applied.set(step.idempotencyKey, { price: 12 });
    w.journal.append(created.taskId, 1, { type: "ATTEMPT_STARTED", stepId: "apply", attempt: 1, attemptId: ayasDurableAttemptId(step.idempotencyKey, 1), owner: other });
    const gone = await advanceAyasDurableTask(created.taskId, w.deps(activities, self, false));
    assert.equal(gone.state.stepStates[0]!.status, "NEEDS_REREAD");
    const reread = await advanceAyasDurableTask(created.taskId, w.deps(activities));
    assert.deepEqual([reread.decision.action, reread.recorded], ["REREAD_CURRENT_STATE", ["STATE_REREAD"]]);
    assert.equal(reread.state.status, "COMPLETED");
    assert.deepEqual(reread.state.stepStates[0]!.result, { applied: true, recovered: true });
    assert.deepEqual([system.runs.length, system.rereads], [0, 1]);
  });

  await scenario("crash before a side effect landed: reread proves absence, one bounded retry with the same key", async () => {
    const w = world(); const system = target(); const keys: string[] = [];
    const activities: Record<string, AyasDurableActivity> = { "fake.write": {
      run: async (ctx) => { keys.push(ctx.idempotencyKey); system.runs.push(ctx.attemptId); system.applied.set(ctx.idempotencyKey, ctx.input); return { outcome: "SUCCEEDED", result: { applied: true } }; },
      reread: async (ctx) => (system.applied.has(ctx.idempotencyKey) ? { observation: "APPLIED", result: null, evidence: "present" } : { observation: "NOT_APPLIED", evidence: "absent" }) } };
    const created = createAyasDurableTask(w.journal, task("crash-write-absent", [write("apply")], "SELF_DEVELOPMENT"));
    const step = created.steps[0] as { idempotencyKey: string };
    const firstAttempt = ayasDurableAttemptId(step.idempotencyKey, 1);
    w.journal.append(created.taskId, 1, { type: "ATTEMPT_STARTED", stepId: "apply", attempt: 1, attemptId: firstAttempt, owner: other });
    await advanceAyasDurableTask(created.taskId, w.deps(activities, self, false));
    const reread = await advanceAyasDurableTask(created.taskId, w.deps(activities));
    assert.equal(reread.state.stepStates[0]!.status, "RETRY_WAIT");
    const retried = await advanceAyasDurableTask(created.taskId, w.deps(activities));
    assert.equal(retried.state.status, "COMPLETED");
    assert.deepEqual(keys, [step.idempotencyKey]);
    assert.deepEqual(system.runs, [ayasDurableAttemptId(step.idempotencyKey, 2)]);
    assert.notEqual(system.runs[0], firstAttempt);
    assert.equal(system.applied.size, 1);
  });

  await scenario("side effect with no proof either way: UNCERTAIN, terminal, never replayed", async () => {
    const w = world(); let runs = 0;
    const activities: Record<string, AyasDurableActivity> = { "fake.write": {
      run: async () => { runs++; return { outcome: "UNKNOWN", reason: "connection dropped after the request was sent" }; },
      reread: async () => ({ observation: "UNKNOWN", evidence: "target reports neither state" }) } };
    const { taskId } = createAyasDurableTask(w.journal, task("uncertain", [write("apply"), read("after")]));
    const attempt = await advanceAyasDurableTask(taskId, w.deps(activities));
    assert.deepEqual(attempt.recorded, ["ATTEMPT_STARTED", "ATTEMPT_UNCONFIRMED"]);
    const reread = await advanceAyasDurableTask(taskId, w.deps(activities));
    assert.equal(reread.state.status, "UNCERTAIN");
    assert.match(reread.state.detail!, /unproven/);
    for (let index = 0; index < 3; index++) assert.deepEqual((await advanceAyasDurableTask(taskId, w.deps(activities))).decision, { action: "NONE", status: "UNCERTAIN" });
    assert.equal(runs, 1);
    await expectCode("AYAS_DURABLE_TASK_ILLEGAL_EVENT", () => w.journal.append(taskId, 4, { type: "TASK_CANCELLED", reason: "hide it" }));
  });

  await scenario("network loss during a reread: nothing recorded, the task waits where it is", async () => {
    const w = world(); let online = false; let runs = 0;
    const activities: Record<string, AyasDurableActivity> = { "fake.write": {
      run: async () => { runs++; throw new Error("socket hang up"); },
      reread: async () => { if (!online) throw new Error("network unreachable"); return { observation: "APPLIED", result: "ok", evidence: "confirmed once reachable" }; } } };
    const { taskId } = createAyasDurableTask(w.journal, task("network", [write("apply")]));
    await advanceAyasDurableTask(taskId, w.deps(activities));
    const before = w.journal.read(taskId).length;
    for (let index = 0; index < 3; index++) {
      const offline = await advanceAyasDurableTask(taskId, w.deps(activities));
      assert.deepEqual([offline.note, offline.recorded, offline.state.status], ["REREAD_UNAVAILABLE", [], "ACTIVE"]);
    }
    assert.equal(w.journal.read(taskId).length, before);
    online = true;
    assert.equal((await advanceAyasDurableTask(taskId, w.deps(activities))).state.status, "COMPLETED");
    assert.equal(runs, 1);
    // A reread that hangs is bounded by the step's timeout and records nothing either.
    let rereadAborted = 0;
    const hanging: Record<string, AyasDurableActivity> = { "fake.write": {
      run: async () => ({ outcome: "UNKNOWN", reason: "no answer" }),
      reread: (ctx) => new Promise((_, reject) => { ctx.signal.addEventListener("abort", () => { rereadAborted++; reject(new Error("aborted")); }); }) } };
    const hung = createAyasDurableTask(w.journal, task("hanging-reread", [write("apply", { timeoutMs: 25 })]));
    await advanceAyasDurableTask(hung.taskId, w.deps(hanging));
    const startedAt = performance.now();
    const stalled = await advanceAyasDurableTask(hung.taskId, w.deps(hanging));
    assert.ok(performance.now() - startedAt < 5_000, "the step timeout did not bound the reread");
    assert.deepEqual([stalled.note, stalled.recorded, stalled.state.stepStates[0]!.status, rereadAborted], ["REREAD_UNAVAILABLE", [], "NEEDS_REREAD", 1]);
  });

  await scenario("tool timeout: aborted, recorded, retried only up to the bound", async () => {
    const w = world(); let aborted = 0; let calls = 0;
    const activities: Record<string, AyasDurableActivity> = { "fake.read": { run: (ctx) => new Promise((_, reject) => { calls++; ctx.signal.addEventListener("abort", () => { aborted++; reject(new Error("aborted")); }); }) } };
    const { taskId } = createAyasDurableTask(w.journal, task("timeout", [read("slow", { timeoutMs: 25, maxAttempts: 2, retryDelayMs: 0 })]));
    const startedAt = performance.now();
    const first = await advanceAyasDurableTask(taskId, w.deps(activities));
    // The call returns at the step's own timeout, not whenever the activity pleases.
    assert.ok(performance.now() - startedAt < 5_000, "the step timeout did not bound the call");
    assert.deepEqual(first.recorded, ["ATTEMPT_STARTED", "ATTEMPT_UNCONFIRMED"]);
    assert.match(first.state.stepStates[0]!.detail!, /^TIMEOUT/);
    const second = await advanceAyasDurableTask(taskId, w.deps(activities));
    assert.equal(second.state.status, "FAILED");
    assert.deepEqual([calls, aborted], [2, 2]);
    assert.deepEqual((await advanceAyasDurableTask(taskId, w.deps(activities))).decision, { action: "NONE", status: "FAILED" });
    assert.equal(calls, 2);
  });

  await scenario("model restart: retryable failures wait out the delay and stop at the bound", async () => {
    const w = world(); let calls = 0;
    const activities: Record<string, AyasDurableActivity> = { "fake.read": { run: async () => (++calls < 3 ? { outcome: "FAILED_NO_EFFECT", reason: "local model is restarting", retryable: true } : { outcome: "SUCCEEDED", result: "answer" }) } };
    const { taskId } = createAyasDurableTask(w.journal, task("model-restart", [read("ask")]));
    await advanceAyasDurableTask(taskId, w.deps(activities));
    const waiting = await advanceAyasDurableTask(taskId, w.deps(activities));
    assert.deepEqual([waiting.decision.action, waiting.recorded, calls], ["WAIT_RETRY", [], 1]);
    w.clock.ms += 500;
    await advanceAyasDurableTask(taskId, w.deps(activities));
    w.clock.ms += 500;
    assert.equal((await advanceAyasDurableTask(taskId, w.deps(activities))).state.status, "COMPLETED");
    assert.equal(calls, 3);

    const bound = world(); let boundCalls = 0;
    const failing: Record<string, AyasDurableActivity> = { "fake.read": { run: async () => { boundCalls++; return { outcome: "FAILED_NO_EFFECT", reason: "still down", retryable: true }; } } };
    const exhausted = createAyasDurableTask(bound.journal, task("bound", [read("ask", { retryDelayMs: 0 })]));
    for (let index = 0; index < 6; index++) await advanceAyasDurableTask(exhausted.taskId, bound.deps(failing));
    assert.deepEqual([bound.journal.load(exhausted.taskId)!.status, boundCalls], ["FAILED", 3]);

    const fatal = world(); let fatalCalls = 0;
    const refusing: Record<string, AyasDurableActivity> = { "fake.read": { run: async () => { fatalCalls++; return { outcome: "FAILED_NO_EFFECT", reason: "source is gone for good", retryable: false }; } } };
    const stopped = createAyasDurableTask(fatal.journal, task("fatal", [read("ask")]));
    assert.equal((await advanceAyasDurableTask(stopped.taskId, fatal.deps(refusing))).state.status, "FAILED");
    assert.equal(fatalCalls, 1);
  });

  await scenario("duplicate daemon: two runtimes, one execution", async () => {
    const w = world(); let calls = 0;
    const activities: Record<string, AyasDurableActivity> = { "fake.write": {
      run: async () => { calls++; await new Promise((resolve) => setTimeout(resolve, 30)); return { outcome: "SUCCEEDED", result: calls }; },
      reread: async () => ({ observation: "UNKNOWN", evidence: "not used" }) } };
    const { taskId } = createAyasDurableTask(w.journal, task("duplicate", [write("apply")]));
    const second = createAyasDurableTaskJournal({ rootDir: w.root, now: () => new Date(w.clock.ms) });
    const twin: AyasDurableTaskOwner = { pid: process.pid, startEpochMs: 3, nonce: "owner-twin" };
    const [a, b] = await Promise.all([
      advanceAyasDurableTask(taskId, w.deps(activities, self, true)),
      advanceAyasDurableTask(taskId, { journal: second, activities, owner: twin, nowMs: () => w.clock.ms, isOwnerAlive: async () => true }),
    ]);
    assert.equal(calls, 1);
    assert.deepEqual([a.recorded.length, b.recorded.length].sort(), [0, 2]);
    assert.equal(w.journal.load(taskId)!.status, "COMPLETED");
    // The tighter race: both daemons read the same history, and the other one publishes the attempt first.
    // The exclusive link refuses the second event, so the loser runs nothing and overwrites nothing.
    const race = createAyasDurableTask(w.journal, task("race", [write("apply")]));
    const raceKey = (race.steps[0] as { idempotencyKey: string }).idempotencyKey;
    const winner = sealAyasDurableTaskEvent(race.taskId, w.journal.read(race.taskId).at(-1), new Date(w.clock.ms).toISOString(),
      { type: "ATTEMPT_STARTED", stepId: "apply", attempt: 1, attemptId: ayasDurableAttemptId(raceKey, 1), owner: twin });
    const realLink = fs.linkSync;
    fs.linkSync = ((from: fs.PathLike, to: fs.PathLike) => { fs.linkSync = realLink; fs.writeFileSync(to, `${JSON.stringify(winner, null, 2)}\n`); return realLink(from, to); }) as typeof fs.linkSync;
    let lost: Awaited<ReturnType<typeof advanceAyasDurableTask>>;
    try { lost = await advanceAyasDurableTask(race.taskId, w.deps(activities, self, true)); } finally { fs.linkSync = realLink; }
    assert.deepEqual([lost.note, lost.recorded, calls], ["LOST_RACE", [], 1]);
    assert.equal(lost.state.stepStates[0]!.owner!.nonce, "owner-twin");
    const raceFolder = path.join(w.journal.dir, race.taskId, "events");
    assert.deepEqual(fs.readdirSync(raceFolder), ["00000001.json", "00000002.json"]);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(raceFolder, "00000002.json"), "utf8")), winner);
    // Creating the same task twice is also one task; a different definition under the same key is refused.
    assert.equal(createAyasDurableTask(second, task("duplicate", [write("apply")])).lastSequence, 3);
    await expectCode("AYAS_DURABLE_TASK_KEY_CONFLICT", () => createAyasDurableTask(second, task("duplicate", [write("apply", { input: { price: 13 } })])));
  });

  await scenario("a live owner's attempt is left alone, however late", async () => {
    const w = world(); let calls = 0;
    const activities: Record<string, AyasDurableActivity> = { "fake.read": { run: async () => { calls++; return { outcome: "SUCCEEDED", result: 1 }; } } };
    const created = createAyasDurableTask(w.journal, task("live-owner", [read("one")]));
    const step = created.steps[0] as { idempotencyKey: string };
    const attemptId = ayasDurableAttemptId(step.idempotencyKey, 1);
    w.journal.append(created.taskId, 1, { type: "ATTEMPT_STARTED", stepId: "one", attempt: 1, attemptId, owner: other });
    const fresh = await advanceAyasDurableTask(created.taskId, w.deps(activities, self, true));
    assert.deepEqual(fresh.decision, { action: "AWAIT_RUNNING_ATTEMPT", stepId: "one", attemptId, overdueMs: 0 });
    w.clock.ms += 60_000;
    const late = await advanceAyasDurableTask(created.taskId, w.deps(activities, self, true));
    assert.deepEqual([late.decision.action === "AWAIT_RUNNING_ATTEMPT" && late.decision.overdueMs, late.recorded, calls], [59_000, [], 0]);
    // Unknown liveness is treated as alive: the pure decision only acts on an explicit false.
    assert.equal(decideAyasDurableTaskNext(late.state, { nowMs: w.clock.ms }).action, "AWAIT_RUNNING_ATTEMPT");
    // An attempt this very process started but is no longer executing is abandoned, not alive.
    const own = createAyasDurableTask(w.journal, task("own-abandoned", [read("one", { retryDelayMs: 0 })]));
    const ownStep = own.steps[0] as { idempotencyKey: string };
    w.journal.append(own.taskId, 1, { type: "ATTEMPT_STARTED", stepId: "one", attempt: 1, attemptId: ayasDurableAttemptId(ownStep.idempotencyKey, 1), owner: self });
    assert.equal((await advanceAyasDurableTask(own.taskId, w.deps(activities))).decision.action, "RECORD_OWNER_GONE");
  });

  await scenario("real process liveness: a dead PID is gone, this process is alive", async () => {
    const w = world();
    const child = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8", windowsHide: true });
    const deadPid = Number(child.stdout);
    assert.ok(Number.isSafeInteger(deadPid) && deadPid > 0);
    const mine = await createAyasDurableTaskOwner();
    assert.deepEqual([mine.pid, Object.isFrozen(mine)], [process.pid, true]);
    const activities: Record<string, AyasDurableActivity> = { "fake.read": { run: async () => ({ outcome: "SUCCEEDED", result: 1 }) } };
    const dead = createAyasDurableTask(w.journal, task("dead-pid", [read("one")]));
    const deadStep = dead.steps[0] as { idempotencyKey: string };
    w.journal.append(dead.taskId, 1, { type: "ATTEMPT_STARTED", stepId: "one", attempt: 1, attemptId: ayasDurableAttemptId(deadStep.idempotencyKey, 1), owner: { pid: deadPid, startEpochMs: 5, nonce: "owner-dead" } });
    assert.equal((await advanceAyasDurableTask(dead.taskId, { journal: w.journal, activities, owner: mine, nowMs: () => w.clock.ms })).decision.action, "RECORD_OWNER_GONE");
    // The same PID with this process's real start time, under another owner nonce, is a live owner.
    const live = createAyasDurableTask(w.journal, task("live-pid", [read("one")]));
    const liveStep = live.steps[0] as { idempotencyKey: string };
    w.journal.append(live.taskId, 1, { type: "ATTEMPT_STARTED", stepId: "one", attempt: 1, attemptId: ayasDurableAttemptId(liveStep.idempotencyKey, 1), owner: { ...mine, nonce: "owner-sibling" } });
    assert.equal((await advanceAyasDurableTask(live.taskId, { journal: w.journal, activities, owner: mine, nowMs: () => w.clock.ms })).decision.action, "AWAIT_RUNNING_ATTEMPT");
  });

  await scenario("owner delay of days: the task waits without expiring, then follows the signal", async () => {
    const w = world(); let calls = 0;
    const activities: Record<string, AyasDurableActivity> = { "fake.read": { run: async () => { calls++; return { outcome: "SUCCEEDED", result: calls }; } } };
    const steps = [read("prepare"), { stepId: "owner", kind: "OWNER_WAIT", question: "Publish this draft?" }, read("after")];
    const { taskId } = createAyasDurableTask(w.journal, task("owner-wait", steps, "REVENUE"));
    await advanceAyasDurableTask(taskId, w.deps(activities));
    w.clock.ms += 3 * 86_400_000;
    for (let index = 0; index < 3; index++) {
      const waiting = await advanceAyasDurableTask(taskId, w.deps(activities));
      assert.deepEqual([waiting.decision, waiting.recorded], [{ action: "WAIT_OWNER", stepId: "owner", question: "Publish this draft?" }, []]);
    }
    assert.equal(calls, 1);
    await expectCode("AYAS_DURABLE_TASK_ILLEGAL_EVENT", () => recordAyasDurableTaskOwnerSignal(w.journal, taskId, "after", "PROCEED", "approval-inbox:1"));
    await expectCode("AYAS_DURABLE_TASK_ILLEGAL_EVENT", () => w.journal.append(taskId, 3, { type: "ATTEMPT_STARTED", stepId: "owner", attempt: 1, attemptId: "x", owner: self }));
    recordAyasDurableTaskOwnerSignal(w.journal, taskId, "owner", "PROCEED", "approval-inbox:1");
    assert.equal((await advanceAyasDurableTask(taskId, w.deps(activities))).state.status, "COMPLETED");

    const rejected = createAyasDurableTask(w.journal, task("owner-reject", steps, "REVENUE"));
    await advanceAyasDurableTask(rejected.taskId, w.deps(activities));
    assert.equal(recordAyasDurableTaskOwnerSignal(w.journal, rejected.taskId, "owner", "REJECT", "approval-inbox:2").status, "REJECTED");
    assert.deepEqual((await advanceAyasDurableTask(rejected.taskId, w.deps(activities))).decision, { action: "NONE", status: "REJECTED" });
    assert.equal(calls, 3);
  });

  await scenario("journal integrity: edits, gaps, stale writers and overwrites are refused", async () => {
    const w = world();
    const activities: Record<string, AyasDurableActivity> = { "fake.read": { run: async () => ({ outcome: "SUCCEEDED", result: { value: 1 } }) } };
    const { taskId } = createAyasDurableTask(w.journal, task("integrity", [read("one"), read("two")]));
    await advanceAyasDurableTask(taskId, w.deps(activities));
    const folder = path.join(w.journal.dir, taskId, "events");
    const third = path.join(folder, "00000003.json");
    const original = fs.readFileSync(third, "utf8");
    // A leftover temp file from a crashed writer is ignored.
    fs.writeFileSync(path.join(folder, ".4.123.crashed.tmp"), "{ torn");
    assert.equal(w.journal.read(taskId).length, 3);
    await expectCode("AYAS_DURABLE_TASK_SEQUENCE_CONFLICT", () => w.journal.append(taskId, 2, { type: "TASK_CANCELLED", reason: "stale writer" }));
    assert.equal(fs.readFileSync(third, "utf8"), original);
    // An edited result no longer matches its digest.
    fs.writeFileSync(third, original.replace('"value": 1', '"value": 2'));
    await expectCode("AYAS_DURABLE_TASK_JOURNAL_CORRUPT", () => w.journal.read(taskId));
    await expectCode("AYAS_DURABLE_TASK_JOURNAL_CORRUPT", () => advanceAyasDurableTask(taskId, w.deps(activities)));
    fs.writeFileSync(third, "{ torn");
    await expectCode("AYAS_DURABLE_TASK_JOURNAL_CORRUPT", () => w.journal.load(taskId));
    fs.writeFileSync(third, original);
    assert.equal(w.journal.load(taskId)!.currentStepIndex, 1);
    // An edit to a field no result digest covers is caught by the event's own digest.
    const second = path.join(folder, "00000002.json");
    const started = fs.readFileSync(second, "utf8");
    assert.ok(started.includes('"nonce": "owner-self"'));
    fs.writeFileSync(second, started.replace('"nonce": "owner-self"', '"nonce": "owner-forged"'));
    await expectCode("AYAS_DURABLE_TASK_JOURNAL_CORRUPT", () => w.journal.read(taskId));
    fs.writeFileSync(second, started);
    // A missing middle event is a gap, never a shorter history.
    fs.renameSync(second, path.join(folder, "held-aside"));
    await expectCode("AYAS_DURABLE_TASK_JOURNAL_CORRUPT", () => w.journal.read(taskId));
    fs.renameSync(path.join(folder, "held-aside"), second);
    // A file whose name skips a sequence is a gap even when its content chains correctly.
    fs.renameSync(third, path.join(folder, "00000004.json"));
    await expectCode("AYAS_DURABLE_TASK_JOURNAL_CORRUPT", () => w.journal.read(taskId));
    fs.renameSync(path.join(folder, "00000004.json"), third);
    // Replay itself refuses a reordered or truncated-at-the-front history.
    const events = [...w.journal.read(taskId)];
    assert.equal(events.length, 3);
    assert.throws(() => replayAyasDurableTask([events[0], events[2]]), AyasDurableTaskError);
    assert.throws(() => replayAyasDurableTask(events.slice(1)), AyasDurableTaskError);
    assert.throws(() => replayAyasDurableTask([]), AyasDurableTaskError);
    // A correctly chained event that claims the wrong sequence number is refused on the number alone.
    const skipped = sealAyasDurableTaskEvent(taskId, { sequence: 4, digest: events[0]!.digest }, events[1]!.at,
      { type: "ATTEMPT_STARTED", stepId: "one", attempt: 1, attemptId: (events[1] as { attemptId: string }).attemptId, owner: self });
    assert.equal(skipped.sequence, 5);
    assert.throws(() => replayAyasDurableTask([events[0], skipped]), (error: unknown) => error instanceof AyasDurableTaskError && /out of sequence/.test(error.message));
    // A self-consistent event that does not link to the event before it is refused on the link alone.
    const unlinked = sealAyasDurableTaskEvent(taskId, { sequence: 1, digest: "f".repeat(64) }, events[1]!.at,
      { type: "ATTEMPT_STARTED", stepId: "one", attempt: 1, attemptId: (events[1] as { attemptId: string }).attemptId, owner: self });
    assert.throws(() => replayAyasDurableTask([events[0], unlinked]), (error: unknown) => error instanceof AyasDurableTaskError && /digest chain/.test(error.message));
    await expectCode("AYAS_DURABLE_TASK_CONTRACT_INVALID", () => w.journal.read("../escape"));
    await expectCode("AYAS_DURABLE_TASK_NOT_FOUND", () => advanceAyasDurableTask(`ayas-task-${"0".repeat(32)}`, w.deps(activities)));
    assert.equal(w.journal.load(`ayas-task-${"0".repeat(32)}`), undefined);
  });

  await scenario("illegal histories are refused before they reach the disk", async () => {
    const w = world();
    const created = createAyasDurableTask(w.journal, task("illegal", [write("apply", { maxAttempts: 1 }), read("after")]));
    const step = created.steps[0] as { idempotencyKey: string };
    const attemptId = ayasDurableAttemptId(step.idempotencyKey, 1);
    const id = created.taskId;
    const refused = async (sequence: number, body: Parameters<AyasDurableTaskJournal["append"]>[2]): Promise<void> => {
      await expectCode("AYAS_DURABLE_TASK_ILLEGAL_EVENT", () => w.journal.append(id, sequence, body));
      assert.equal(w.journal.read(id).length, sequence);
    };
    await refused(1, { type: "ATTEMPT_SUCCEEDED", stepId: "apply", attemptId, result: 1, resultDigest: "0".repeat(64) });
    await refused(1, { type: "ATTEMPT_STARTED", stepId: "after", attempt: 1, attemptId, owner: self });
    await refused(1, { type: "ATTEMPT_STARTED", stepId: "apply", attempt: 2, attemptId, owner: self });
    await refused(1, { type: "ATTEMPT_STARTED", stepId: "apply", attempt: 1, attemptId: "forged", owner: self });
    await refused(1, { type: "STATE_REREAD", stepId: "apply", attemptId, observation: "NOT_APPLIED", evidence: "nothing to reread" });
    await refused(1, { type: "TASK_CREATED", taskKey: "illegal", domain: "RESEARCH", title: "again", steps: created.steps });
    await refused(1, { type: "ATTEMPT_STARTED", stepId: "apply", attempt: 1, attemptId, owner: self, command: "git push" } as never);
    w.journal.append(id, 1, { type: "ATTEMPT_STARTED", stepId: "apply", attempt: 1, attemptId, owner: self });
    await refused(2, { type: "ATTEMPT_STARTED", stepId: "apply", attempt: 2, attemptId: ayasDurableAttemptId(step.idempotencyKey, 2), owner: self });
    await refused(2, { type: "ATTEMPT_SUCCEEDED", stepId: "apply", attemptId: "someone-else", result: 1, resultDigest: "0".repeat(64) });
    await refused(2, { type: "ATTEMPT_SUCCEEDED", stepId: "apply", attemptId, result: 1, resultDigest: "0".repeat(64) });
    await refused(2, { type: "TASK_CANCELLED", reason: "over a running attempt" });
    w.journal.append(id, 2, { type: "ATTEMPT_UNCONFIRMED", stepId: "apply", attemptId, cause: "ACTIVITY_ERROR", detail: "unknown outcome" });
    await refused(3, { type: "TASK_CANCELLED", reason: "over an unconfirmed side effect" });
    await refused(3, { type: "ATTEMPT_STARTED", stepId: "apply", attempt: 2, attemptId: ayasDurableAttemptId(step.idempotencyKey, 2), owner: self });
    // The retry bound holds on the reread path too: one attempt allowed, so "not applied" fails the task.
    assert.equal(w.journal.append(id, 3, { type: "STATE_REREAD", stepId: "apply", attemptId, observation: "NOT_APPLIED", evidence: "absent" }).status, "FAILED");
    await refused(4, { type: "TASK_CANCELLED", reason: "terminal" });
    // A pending task can be cancelled, exactly once.
    const idle = createAyasDurableTask(w.journal, task("cancel", [read("one")]));
    assert.equal(cancelAyasDurableTask(w.journal, idle.taskId, "owner withdrew the request").status, "CANCELLED");
    await expectCode("AYAS_DURABLE_TASK_ILLEGAL_EVENT", () => cancelAyasDurableTask(w.journal, idle.taskId, "twice"));
  });

  await scenario("registry and content guards: unregistered activities and secret-like content", async () => {
    const w = world(); let rereads = 0;
    const readOnly = createAyasDurableTask(w.journal, task("unregistered", [read("one")]));
    await expectCode("AYAS_DURABLE_TASK_ACTIVITY_NOT_REGISTERED", () => advanceAyasDurableTask(readOnly.taskId, w.deps({})));
    // Object.prototype members are not activities.
    const proto = createAyasDurableTask(w.journal, task("proto", [read("one", { activity: "constructor" })]));
    await expectCode("AYAS_DURABLE_TASK_ACTIVITY_NOT_REGISTERED", () => advanceAyasDurableTask(proto.taskId, w.deps({})));
    // A side effect without a reread cannot be made safe, so it never starts.
    const blind = createAyasDurableTask(w.journal, task("blind", [write("apply")]));
    await expectCode("AYAS_DURABLE_TASK_ACTIVITY_NOT_REGISTERED", () => advanceAyasDurableTask(blind.taskId, w.deps({ "fake.write": { run: async () => ({ outcome: "SUCCEEDED", result: 1 }) } })));
    for (const item of [readOnly, proto, blind]) assert.equal(w.journal.read(item.taskId).length, 1);

    await expectCode("AYAS_DURABLE_TASK_SECRET_REFUSED", () => createAyasDurableTask(w.journal, task("leak", [read("one", { input: { header: `Bearer ${"a".repeat(24)}` } })])));
    await expectCode("AYAS_DURABLE_TASK_SECRET_REFUSED", () => createAyasDurableTask(w.journal, task("path", [read("one", { exactTarget: "C:\\Users\\someone\\file.txt" })])));
    const leaky: Record<string, AyasDurableActivity> = {
      "fake.read": { run: async () => ({ outcome: "SUCCEEDED", result: { token: `sk-${"a".repeat(30)}` } }) },
      "fake.write": { run: async () => { throw new Error(`failed with Bearer ${"b".repeat(24)}`); }, reread: async () => { rereads++; return { observation: "APPLIED", result: `ghp_${"c".repeat(30)}`, evidence: "leaks" }; } },
    };
    const secretResult = createAyasDurableTask(w.journal, task("leaky-result", [read("one", { maxAttempts: 1 })]));
    const refusedResult = await advanceAyasDurableTask(secretResult.taskId, w.deps(leaky));
    assert.deepEqual([refusedResult.recorded, refusedResult.state.status], [["ATTEMPT_STARTED", "ATTEMPT_UNCONFIRMED"], "FAILED"]);
    const secretError = createAyasDurableTask(w.journal, task("leaky-error", [write("apply")]));
    const masked = await advanceAyasDurableTask(secretError.taskId, w.deps(leaky));
    assert.equal(masked.state.stepStates[0]!.status, "NEEDS_REREAD");
    assert.deepEqual([(await advanceAyasDurableTask(secretError.taskId, w.deps(leaky))).note, rereads], ["REREAD_UNAVAILABLE", 1]);
    const stored = fs.readdirSync(w.journal.dir).flatMap((folder) => fs.readdirSync(path.join(w.journal.dir, folder, "events")).map((name) => fs.readFileSync(path.join(w.journal.dir, folder, "events", name), "utf8"))).join("\n");
    assert.ok(!/sk-a{30}|ghp_c{30}|Bearer b{24}/.test(stored), "a secret reached the journal");
    assert.match(stored, /redacted:bearer-token/);
  });

  // Nothing was written outside the TEMP base, and no default root was created in the working directory.
  assert.ok(!fs.existsSync(path.join(process.cwd(), "data", "brain", "autonomy", "durable-tasks")), "DEFAULT_ROOT_TOUCHED");
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-durable-task-runtime", scenarios, journalRoots: roots }));
}

main().then(() => fs.rmSync(base, { recursive: true, force: true }), (error) => { fs.rmSync(base, { recursive: true, force: true }); console.error(error); process.exitCode = 1; });
