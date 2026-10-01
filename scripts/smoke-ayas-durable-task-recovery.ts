/**
 * Stage 15B.2 — durable task recovery sweep and the first activity set.
 *
 * Every scenario works in its own TEMP journal root. No repository data, live
 * runtime or authority directory is read or written, no model, network or
 * container is used. Activities are in-memory fakes, except the first
 * activity set, which runs against fixed facts and against a TEMP directory
 * that is not a repository.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import type { AyasGraphifyFacts } from "../src/lib/ayas/developer/AyasGraphifyState";
import {
  AyasDurableTaskError,
  ayasDurableAttemptId,
  defineAyasDurableTask,
  sealAyasDurableTaskEvent,
  type AyasDurableJson,
  type AyasDurableTaskOwner,
} from "../src/lib/brain/autonomy/AyasDurableTask";
import {
  AYAS_GRAPHIFY_STATE_ACTIVITY,
  AYAS_GRAPHIFY_STATE_TARGET,
  ayasGraphifyStateTaskInput,
  createAyasFirstDurableActivitySet,
} from "../src/lib/brain/autonomy/AyasDurableTaskActivities";
import { createAyasDurableTaskJournal, type AyasDurableTaskJournal } from "../src/lib/brain/autonomy/AyasDurableTaskJournal";
import {
  ayasDurableTaskLiveBinding,
  isAyasDurableTaskLiveJournal,
  sweepAyasDurableTasks,
  type AyasDurableTaskSweepEntry,
  type AyasDurableTaskSweepOptions,
  type AyasDurableTaskSweepReport,
} from "../src/lib/brain/autonomy/AyasDurableTaskRecovery";
import {
  advanceAyasDurableTask,
  createAyasDurableTask,
  inspectAyasDurableTask,
  recordAyasDurableTaskOwnerSignal,
  type AyasDurableActivity,
  type AyasDurableTaskRuntimeDeps,
} from "../src/lib/brain/autonomy/AyasDurableTaskRuntime";

const repo = process.cwd();
const base = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-durable-recovery-"));
assert.ok(fs.realpathSync(base).toLowerCase().startsWith(fs.realpathSync(os.tmpdir()).toLowerCase() + path.sep), "TEMP_ROOT_REQUIRED");
let scenarios = 0;
let roots = 0;

type World = { journal: AyasDurableTaskJournal; root: string; clock: { ms: number }; deps: (activities: Record<string, AyasDurableActivity>, owner?: AyasDurableTaskOwner, alive?: boolean) => AyasDurableTaskRuntimeDeps };
/**
 * A clock both the journal and the runtime read, so a test can move time without waiting. Passing an existing world
 * gives a second journal handle over the same directory and clock: another process.
 */
function world(same?: World): World {
  const root = same?.root ?? path.join(base, `root-${++roots}`);
  const clock = same?.clock ?? { ms: Date.parse("2026-10-01T10:00:00.000Z") };
  const journal = createAyasDurableTaskJournal({ rootDir: root, now: () => new Date(clock.ms) });
  return { journal, root, clock, deps: (activities, owner = self, alive) => ({ journal, activities, owner, nowMs: () => clock.ms, ...(alive === undefined ? {} : { isOwnerAlive: async () => alive }) }) };
}
const self: AyasDurableTaskOwner = { pid: process.pid, startEpochMs: 1, nonce: "owner-self" };
const other: AyasDurableTaskOwner = { pid: 999_999, startEpochMs: 2, nonce: "owner-crashed" };
const quick = { acquireRetryLimit: 2, acquireRetryDelayMs: 5 };
const read = (stepId: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ stepId, kind: "ACTIVITY", activity: "fake.read", effect: "READ_ONLY", exactTarget: "research:source-1", input: { query: "q" }, timeoutMs: 1000, maxAttempts: 3, retryDelayMs: 500, ...extra });
const write = (stepId: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ stepId, kind: "ACTIVITY", activity: "fake.write", effect: "SIDE_EFFECT", exactTarget: "listing:draft-7", input: { price: 12 }, timeoutMs: 1000, maxAttempts: 2, retryDelayMs: 0, ...extra });
const task = (taskKey: string, steps: unknown[], domain = "RESEARCH"): Record<string, unknown> => ({ domain, taskKey, title: "Durable recovery smoke", steps });
const sweep = (w: World, activities: Record<string, AyasDurableActivity>, options: AyasDurableTaskSweepOptions = {}, alive?: boolean, owner?: AyasDurableTaskOwner): Promise<AyasDurableTaskSweepReport> =>
  sweepAyasDurableTasks(w.deps(activities, owner, alive), { lock: quick, ...options });
const entry = (report: AyasDurableTaskSweepReport, taskId: string): AyasDurableTaskSweepEntry => {
  const found = report.entries.find((item) => item.taskId === taskId);
  assert.ok(found, `no entry for ${taskId}`);
  return found;
};
const key = (state: { steps: readonly unknown[] }, index = 0): string => (state.steps[index] as { idempotencyKey: string }).idempotencyKey;
async function expectCode(code: string, work: () => unknown): Promise<void> {
  await assert.rejects(async () => { await work(); }, (error: unknown) => error instanceof AyasDurableTaskError && error.code === code, `expected ${code}`);
}
async function scenario(name: string, work: () => Promise<void> | void): Promise<void> {
  try { await work(); scenarios++; }
  catch (error) { console.error(`FAIL: ${name}`); throw error; }
}
/** Every file under a directory with a digest of its bytes: equal snapshots mean nothing was written. */
function snapshot(dir: string): string {
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const item of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(current, item.name);
      if (item.isDirectory()) { out.push(`${path.relative(dir, full)}/`); walk(full); }
      else out.push(`${path.relative(dir, full)}:${crypto.createHash("sha256").update(fs.readFileSync(full)).digest("hex")}`);
    }
  };
  walk(dir);
  return out.join("\n");
}
/** A fake target system: one value per idempotency key, so a repeat is visible. */
function target(): { applied: Map<string, AyasDurableJson>; runs: string[]; rereads: number; activities: Record<string, AyasDurableActivity> } {
  const system = { applied: new Map<string, AyasDurableJson>(), runs: [] as string[], rereads: 0, activities: {} as Record<string, AyasDurableActivity> };
  system.activities = { "fake.write": {
    run: async (ctx) => { system.runs.push(ctx.idempotencyKey); system.applied.set(ctx.idempotencyKey, ctx.input); return { outcome: "SUCCEEDED", result: { applied: true } }; },
    reread: async (ctx) => { system.rereads++; return system.applied.has(ctx.idempotencyKey) ? { observation: "APPLIED", result: { applied: true, recovered: true }, evidence: "target holds this idempotency key" } : { observation: "NOT_APPLIED", evidence: "target has no such key" }; } } };
  return system;
}
function deadPid(): number {
  const child = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8", windowsHide: true });
  const pid = Number(child.stdout);
  assert.ok(Number.isSafeInteger(pid) && pid > 0);
  return pid;
}
const head = "a".repeat(40);
const facts = (over: Partial<AyasGraphifyFacts> = {}): AyasGraphifyFacts => ({
  sourceHead: head, dirtyPaths: [], dirtyUncoveredPaths: [], worktreeFingerprint: null,
  branch: { lastSeenHead: head, lastAnalyzedHead: head, stale: false, staleReason: null },
  graph: { builtFromHead: head, nodes: 10, links: 20, duplicateIds: 0, duplicateEdges: 0, dangling: 0, selfLoops: 0 },
  needsUpdateFlag: false, semanticPendingMarker: false, extractionGaps: [], projectConfig: "ABSENT", cli: { available: true, version: "0.17.1" }, localMcpServerAvailable: false, consumers: [], ...over });

async function main(): Promise<void> {
  await scenario("sweep: one step per task per tick, oldest task first, finished tasks cost no call", async () => {
    const w = world(); const calls: string[] = [];
    const activities: Record<string, AyasDurableActivity> = { "fake.read": { run: async (ctx) => { calls.push(`${ctx.taskId}:${ctx.stepId}`); return { outcome: "SUCCEEDED", result: ctx.stepId }; } } };
    // Created in descending ID order, so "oldest first" differs from the journal's own listing order.
    const inputs = ["a", "b", "c"].map((name) => task(name, [read("one"), read("two")]));
    const order = inputs.map((input) => ({ input, taskId: defineAyasDurableTask(input).taskId })).sort((a, b) => b.taskId.localeCompare(a.taskId));
    for (const item of order) { createAyasDurableTask(w.journal, item.input); w.clock.ms += 1000; }
    assert.notDeepEqual(order.map((item) => item.taskId), w.journal.list());
    const first = await sweep(w, activities, { maxActivityCalls: 8 });
    assert.deepEqual([first.mode, first.result, first.journals, first.inspected, first.truncated, first.activityCalls, first.outcomes, first.needsReview], ["APPLY", "SWEPT", 3, 3, false, 3, { ADVANCED: 3 }, []]);
    assert.deepEqual(calls, order.map((item) => `${item.taskId}:one`));
    for (const item of order) assert.equal(w.journal.load(item.taskId)!.currentStepIndex, 1);
    assert.ok(Object.isFrozen(first));
    const second = await sweep(w, activities, { maxActivityCalls: 8 });
    assert.deepEqual([second.activityCalls, second.statuses, calls.length], [3, { COMPLETED: 3 }, 6]);
    const third = await sweep(w, activities, { maxActivityCalls: 8 });
    assert.deepEqual([third.activityCalls, third.outcomes, third.entries, third.needsReview, calls.length], [0, { TERMINAL: 3 }, [], [], 6]);
    // An idle tick over an empty journal creates nothing, not even the lock directory.
    const empty = world();
    const idle = await sweep(empty, activities);
    assert.deepEqual([idle.result, idle.journals, idle.inspected, fs.existsSync(empty.root)], ["SWEPT", 0, 0, false]);
  });

  await scenario("budget: calls are bounded per tick, the rest waits, invalid options are refused", async () => {
    const w = world(); let calls = 0;
    const activities: Record<string, AyasDurableActivity> = { "fake.read": { run: async () => ({ outcome: "SUCCEEDED", result: ++calls }) } };
    const ids: string[] = [];
    for (const name of ["a", "b", "c"]) { ids.push(createAyasDurableTask(w.journal, task(name, [read("one")])).taskId); w.clock.ms += 1000; }
    const limited = await sweep(w, activities, { maxActivityCalls: 2 });
    assert.deepEqual([limited.activityCalls, limited.outcomes, calls], [2, { ADVANCED: 2, DEFERRED_BUDGET: 1 }, 2]);
    // The youngest task is the one that waits, and waiting records nothing.
    assert.deepEqual([entry(limited, ids[2]!).outcome, w.journal.read(ids[2]!).length], ["DEFERRED_BUDGET", 1]);
    const none = await sweep(w, activities, { maxActivityCalls: 0 });
    assert.deepEqual([none.activityCalls, entry(none, ids[2]!).outcome, calls], [0, "DEFERRED_BUDGET", 2]);
    const defaults = await sweep(w, activities);
    assert.deepEqual([defaults.activityCalls, w.journal.load(ids[2]!)!.status], [1, "COMPLETED"]);
    // The default budget is four calls.
    const many = world(); let manyCalls = 0;
    const counting: Record<string, AyasDurableActivity> = { "fake.read": { run: async () => ({ outcome: "SUCCEEDED", result: ++manyCalls }) } };
    for (let index = 0; index < 6; index++) createAyasDurableTask(many.journal, task(`t${index}`, [read("one")]));
    assert.deepEqual([(await sweep(many, counting)).outcomes, manyCalls], [{ ADVANCED: 4, DEFERRED_BUDGET: 2 }, 4]);
    // More journals than one sweep inspects is said out loud.
    const capped = await sweep(many, counting, { maxTasks: 2, dryRun: true });
    assert.deepEqual([capped.journals, capped.inspected, capped.truncated], [6, 2, true]);
    // The cap bounds what is advanced, not only what is reported.
    const few = world(); let fewCalls = 0;
    const fewActivities: Record<string, AyasDurableActivity> = { "fake.read": { run: async () => ({ outcome: "SUCCEEDED", result: ++fewCalls }) } };
    for (const name of ["a", "b", "c"]) createAyasDurableTask(few.journal, task(name, [read("one")]));
    const partial = await sweep(few, fewActivities, { maxTasks: 1 });
    assert.deepEqual([partial.journals, partial.inspected, partial.truncated, partial.activityCalls, fewCalls], [3, 1, true, 1, 1]);
    assert.deepEqual(few.journal.list().map((taskId) => few.journal.read(taskId).length), [3, 1, 1]);
    for (const bad of [{ maxActivityCalls: -1 }, { maxActivityCalls: 1.5 }, { maxActivityCalls: 65 }, { budgetMs: 0 }, { maxTasks: 0 }, { staleAfterMs: 0 }, { staleAfterMs: Number.NaN }]) {
      await expectCode("AYAS_DURABLE_TASK_CONTRACT_INVALID", () => sweep(many, counting, bad));
    }
    assert.equal(manyCalls, 4);
    // The time budget stops new calls too: a sweep that has already run too long starts nothing further.
    const slow = world(); let slowCalls = 0;
    const sleeping: Record<string, AyasDurableActivity> = { "fake.read": { run: async () => { slowCalls++; await new Promise((resolve) => setTimeout(resolve, 500)); return { outcome: "SUCCEEDED", result: 1 }; } } };
    for (const name of ["a", "b"]) createAyasDurableTask(slow.journal, task(name, [read("one", { timeoutMs: 5000 })]));
    assert.deepEqual([(await sweep(slow, sleeping, { budgetMs: 300 })).outcomes, slowCalls], [{ ADVANCED: 1, DEFERRED_BUDGET: 1 }, 1]);
  });

  await scenario("dry run: reads only, plans exactly what the applying sweep then does", async () => {
    const w = world(); const system = target(); let reads = 0;
    const activities: Record<string, AyasDurableActivity> = { ...system.activities, "fake.read": { run: async () => ({ outcome: "SUCCEEDED", result: ++reads }) } };
    const pending = createAyasDurableTask(w.journal, task("pending", [read("one")]));
    const crashedRead = createAyasDurableTask(w.journal, task("crashed-read", [read("one")]));
    w.journal.append(crashedRead.taskId, 1, { type: "ATTEMPT_STARTED", stepId: "one", attempt: 1, attemptId: ayasDurableAttemptId(key(crashedRead), 1), owner: other });
    const unconfirmed = createAyasDurableTask(w.journal, task("unconfirmed", [write("apply")]));
    const attemptId = ayasDurableAttemptId(key(unconfirmed), 1);
    w.journal.append(unconfirmed.taskId, 1, { type: "ATTEMPT_STARTED", stepId: "apply", attempt: 1, attemptId, owner: other });
    w.journal.append(unconfirmed.taskId, 2, { type: "ATTEMPT_UNCONFIRMED", stepId: "apply", attemptId, cause: "OWNER_GONE", detail: "crashed" });
    const waiting = createAyasDurableTask(w.journal, task("owner", [{ stepId: "ask", kind: "OWNER_WAIT", question: "Proceed?" }]));
    const before = snapshot(w.root);
    const plan = await sweep(w, activities, { dryRun: true }, false);
    assert.deepEqual([plan.mode, plan.result, plan.activityCalls, plan.outcomes], ["DRY_RUN", "SWEPT", 0, { PLANNED: 3, WAITING_OWNER: 1 }]);
    assert.deepEqual([pending, crashedRead, unconfirmed, waiting].map((item) => entry(plan, item.taskId).decision), ["START_ATTEMPT", "RECORD_OWNER_GONE", "REREAD_CURRENT_STATE", "WAIT_OWNER"]);
    assert.ok(plan.entries.every((item) => item.recorded.length === 0));
    assert.equal(snapshot(w.root), before);
    assert.ok(!fs.existsSync(path.join(w.journal.dir, "execution")), "a dry run took the lock");
    assert.deepEqual([reads, system.runs.length, system.rereads], [0, 0, 0]);
    // A dry run does not wait for the lock either: it reports while another sweeper holds it.
    fs.mkdirSync(path.join(w.journal.dir, "execution", ".authority-lock"), { recursive: true });
    assert.equal((await sweep(w, activities, { dryRun: true }, false)).result, "SWEPT");
    assert.equal((await sweep(w, activities, {}, false)).result, "ANOTHER_SWEEP_ACTIVE");
    fs.rmSync(path.join(w.journal.dir, "execution"), { recursive: true });
    const applied = await sweep(w, activities, {}, false);
    for (const item of [pending, crashedRead, unconfirmed]) assert.deepEqual([entry(applied, item.taskId).outcome, entry(applied, item.taskId).decision], ["ADVANCED", entry(plan, item.taskId).decision]);
    assert.deepEqual([entry(applied, pending.taskId).recorded, entry(applied, crashedRead.taskId).recorded, entry(applied, unconfirmed.taskId).recorded],
      [["ATTEMPT_STARTED", "ATTEMPT_SUCCEEDED"], ["ATTEMPT_UNCONFIRMED"], ["STATE_REREAD"]]);
    // Closing a dead owner's attempt is journal bookkeeping: it is not an activity call.
    assert.deepEqual([applied.activityCalls, reads, system.rereads, system.runs.length], [2, 1, 1, 0]);
  });

  await scenario("process crash: the attempt is closed first, retried on a later tick, within the bound", async () => {
    const w = world(); let calls = 0;
    const activities: Record<string, AyasDurableActivity> = { "fake.read": { run: async (ctx) => ({ outcome: "SUCCEEDED", result: { attempt: ctx.attempt, call: ++calls } }) } };
    const created = createAyasDurableTask(w.journal, task("crash", [read("one", { retryDelayMs: 0 })]));
    w.journal.append(created.taskId, 1, { type: "ATTEMPT_STARTED", stepId: "one", attempt: 1, attemptId: ayasDurableAttemptId(key(created), 1), owner: other });
    const closed = await sweep(w, activities, {}, false);
    assert.deepEqual([entry(closed, created.taskId).recorded, closed.activityCalls, calls, w.journal.load(created.taskId)!.stepStates[0]!.status], [["ATTEMPT_UNCONFIRMED"], 0, 0, "RETRY_WAIT"]);
    const retried = await sweep(w, activities, {}, false);
    assert.deepEqual([retried.activityCalls, w.journal.load(created.taskId)!.status, w.journal.load(created.taskId)!.stepStates[0]!.result], [1, "COMPLETED", { attempt: 2, call: 1 }]);
  });

  await scenario("reboot: every owner is gone at once, recovery runs first and nothing is produced twice", async () => {
    const w = world(); const system = target(); let reads = 0;
    const activities: Record<string, AyasDurableActivity> = { ...system.activities, "fake.read": { run: async (ctx) => ({ outcome: "SUCCEEDED", result: `${ctx.stepId}-${++reads}` }) } };
    // Before the reboot: one task finished, one mid-read, one whose side effect landed, one whose side effect did
    // not, one waiting for the owner. The sweeper itself died holding the lock.
    const finished = createAyasDurableTask(w.journal, task("finished", [read("one")]));
    await advanceAyasDurableTask(finished.taskId, w.deps(activities));
    const started = (state: { taskId: string; steps: readonly unknown[] }, stepId: string): void => {
      w.journal.append(state.taskId, 1, { type: "ATTEMPT_STARTED", stepId, attempt: 1, attemptId: ayasDurableAttemptId(key(state), 1), owner: other });
    };
    const reading = createAyasDurableTask(w.journal, task("reading", [read("one", { retryDelayMs: 0 })]));
    started(reading, "one");
    const landed = createAyasDurableTask(w.journal, task("landed", [write("apply")], "REVENUE"));
    system.applied.set(key(landed), { price: 12 });
    started(landed, "apply");
    const lost = createAyasDurableTask(w.journal, task("lost", [write("apply", { exactTarget: "listing:draft-8" })], "REVENUE"));
    started(lost, "apply");
    const waiting = createAyasDurableTask(w.journal, task("waiting", [{ stepId: "ask", kind: "OWNER_WAIT", question: "Proceed?" }]));
    const lockDir = path.join(w.journal.dir, "execution", ".authority-lock");
    fs.mkdirSync(lockDir, { recursive: true });
    fs.writeFileSync(path.join(lockDir, "owner.json"), `${JSON.stringify({ schemaVersion: "1", gateRoot: w.journal.dir, ownerNonce: "sweeper-before-reboot", pid: deadPid(), processStartEpochMs: 5, acquiredAt: "2026-10-01T09:00:00.000Z" })}\n`);
    const old = new Date(Date.now() - 3_600_000);
    fs.utimesSync(lockDir, old, old);
    w.clock.ms += 600_000;

    // First tick after the reboot: only bookkeeping. Every dead attempt is closed and no activity is called.
    const first = await sweep(world(w), activities, {}, false, { pid: process.pid, startEpochMs: 7, nonce: "owner-after-reboot" });
    assert.deepEqual([first.result, first.activityCalls, first.outcomes], ["SWEPT", 0, { ADVANCED: 3, WAITING_OWNER: 1, TERMINAL: 1 }]);
    for (const item of [reading, landed, lost]) assert.deepEqual(entry(first, item.taskId).recorded, ["ATTEMPT_UNCONFIRMED"]);
    assert.deepEqual([reads, system.runs.length, system.rereads], [1, 0, 0]);
    // Second tick: both side effects are reread before the interrupted read is tried again.
    const second = await sweep(w, activities, {}, false);
    assert.deepEqual([entry(second, landed.taskId).recorded, entry(second, lost.taskId).recorded, entry(second, reading.taskId).recorded, second.activityCalls],
      [["STATE_REREAD"], ["STATE_REREAD"], ["ATTEMPT_STARTED", "ATTEMPT_SUCCEEDED"], 3]);
    assert.deepEqual([w.journal.load(landed.taskId)!.status, w.journal.load(landed.taskId)!.stepStates[0]!.result, w.journal.load(lost.taskId)!.stepStates[0]!.status, w.journal.load(reading.taskId)!.stepStates[0]!.result],
      ["COMPLETED", { applied: true, recovered: true }, "RETRY_WAIT", "one-2"]);
    // Third tick: the side effect that never landed is a new start, which a default sweep does not make.
    const third = await sweep(w, activities, {}, false);
    assert.deepEqual([entry(third, lost.taskId).outcome, third.needsReview, third.activityCalls], ["REFUSED", [lost.taskId], 0]);
    assert.deepEqual([reads, system.runs.length, system.rereads, system.applied.size], [2, 0, 2, 1]);
    assert.deepEqual([w.journal.load(finished.taskId)!.stepStates[0]!.result, w.journal.read(waiting.taskId).length, entry(third, waiting.taskId).outcome], ["one-1", 1, "WAITING_OWNER"]);
  });

  await scenario("restart: a persisted result is never produced again, with or without its acknowledgement", async () => {
    const w = world(); let calls = 0;
    const activities: Record<string, AyasDurableActivity> = { "fake.read": { run: async (ctx) => ({ outcome: "SUCCEEDED", result: `${ctx.stepId}-${++calls}` }) } };
    const midway = createAyasDurableTask(w.journal, task("midway", [read("one"), read("two")]));
    const last = createAyasDurableTask(w.journal, task("last", [read("one")]));
    // The earlier process recorded both results and died before anything acted on them.
    await advanceAyasDurableTask(midway.taskId, w.deps(activities));
    await advanceAyasDurableTask(last.taskId, w.deps(activities));
    assert.equal(calls, 2);
    const reborn = world(w);
    const after = await sweep(reborn, activities, {}, undefined, { pid: process.pid, startEpochMs: 9, nonce: "owner-reborn" });
    assert.deepEqual([after.activityCalls, calls, entry(after, midway.taskId).stepId, after.statuses], [1, 3, undefined, { COMPLETED: 2 }]);
    assert.deepEqual(reborn.journal.load(midway.taskId)!.stepStates.map((item) => item.result), ["one-1", "two-3"]);
    assert.deepEqual(reborn.journal.load(last.taskId)!.stepStates.map((item) => item.result), ["one-2"]);
    assert.deepEqual([(await sweep(reborn, activities)).activityCalls, calls], [0, 3]);

    // The other half: the effect reached the target, its acknowledgement never reached the journal.
    const s = world(); const system = target();
    const landed = createAyasDurableTask(s.journal, task("landed", [write("apply")], "ATOLYE_SUPERVISION"));
    system.applied.set(key(landed), { price: 12 });
    s.journal.append(landed.taskId, 1, { type: "ATTEMPT_STARTED", stepId: "apply", attempt: 1, attemptId: ayasDurableAttemptId(key(landed), 1), owner: other });
    await sweep(s, system.activities, {}, false);
    const reread = await sweep(s, system.activities, {}, false);
    assert.deepEqual([entry(reread, landed.taskId).recorded, s.journal.load(landed.taskId)!.status, s.journal.load(landed.taskId)!.stepStates[0]!.result], [["STATE_REREAD"], "COMPLETED", { applied: true, recovered: true }]);
    assert.deepEqual([system.runs.length, system.rereads, system.applied.size], [0, 1, 1]);
  });

  await scenario("uncertain side effect: reread before anything else, UNCERTAIN is terminal and stays reported", async () => {
    const w = world(); let runs = 0; let rereads = 0;
    const activities: Record<string, AyasDurableActivity> = { "fake.write": {
      run: async () => { runs++; return { outcome: "UNKNOWN", reason: "connection dropped after the request was sent" }; },
      reread: async () => { rereads++; return { observation: "UNKNOWN", evidence: "target reports neither state" }; } } };
    const { taskId } = createAyasDurableTask(w.journal, task("uncertain", [write("apply"), read("after")]));
    const started = await sweep(w, activities, { allowSideEffectStarts: true });
    assert.deepEqual([entry(started, taskId).recorded, w.journal.load(taskId)!.stepStates[0]!.status], [["ATTEMPT_STARTED", "ATTEMPT_UNCONFIRMED"], "NEEDS_REREAD"]);
    const reread = await sweep(w, activities, { allowSideEffectStarts: true });
    assert.deepEqual([entry(reread, taskId).status, reread.needsReview, runs, rereads], ["UNCERTAIN", [taskId], 1, 1]);
    for (let index = 0; index < 3; index++) {
      const later = await sweep(w, activities, { allowSideEffectStarts: true });
      assert.deepEqual([entry(later, taskId).outcome, entry(later, taskId).status, later.needsReview, later.activityCalls], ["TERMINAL", "UNCERTAIN", [taskId], 0]);
      assert.match(entry(later, taskId).detail!, /unproven/);
    }
    assert.deepEqual([runs, rereads, w.journal.read(taskId).length], [1, 1, 4]);

    // Recovery outranks new work: with one call to spend, the reread runs and the new attempt waits.
    const o = world(); const system = target(); let reads = 0;
    const mixed: Record<string, AyasDurableActivity> = { ...system.activities, "fake.read": { run: async () => ({ outcome: "SUCCEEDED", result: ++reads }) } };
    const fresh = createAyasDurableTask(o.journal, task("fresh", [read("one")]));
    o.clock.ms += 1000;
    const pendingReread = createAyasDurableTask(o.journal, task("needs-reread", [write("apply")]));
    const attemptId = ayasDurableAttemptId(key(pendingReread), 1);
    o.journal.append(pendingReread.taskId, 1, { type: "ATTEMPT_STARTED", stepId: "apply", attempt: 1, attemptId, owner: other });
    o.journal.append(pendingReread.taskId, 2, { type: "ATTEMPT_UNCONFIRMED", stepId: "apply", attemptId, cause: "TIMEOUT", detail: "no result" });
    const one = await sweep(o, mixed, { maxActivityCalls: 1 });
    assert.deepEqual([entry(one, pendingReread.taskId).outcome, entry(one, fresh.taskId).outcome, system.rereads, reads], ["ADVANCED", "DEFERRED_BUDGET", 1, 0]);
  });

  await scenario("duplicate daemon: one sweeper at a time, a crashed sweeper's lock is reclaimed", async () => {
    const w = world(); let calls = 0;
    // The winner's activity holds until the other sweep has returned, so the two always overlap.
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const slow: Record<string, AyasDurableActivity> = { "fake.read": { run: async () => { calls++; await held; return { outcome: "SUCCEEDED", result: calls }; } } };
    const { taskId } = createAyasDurableTask(w.journal, task("duplicate", [read("one", { timeoutMs: 120_000 })]));
    const both = [sweep(w, slow, {}, true), sweep(world(w), slow, {}, true, { pid: process.pid, startEpochMs: 3, nonce: "owner-twin" })];
    const loser = await Promise.race(both);
    assert.deepEqual([loser.result, loser.journals, loser.inspected, loser.activityCalls, loser.entries], ["ANOTHER_SWEEP_ACTIVE", 1, 0, 0, []]);
    release();
    const [a, b] = await Promise.all(both);
    assert.deepEqual([a!.result, b!.result].sort(), ["ANOTHER_SWEEP_ACTIVE", "SWEPT"]);
    assert.deepEqual([calls, w.journal.load(taskId)!.status, w.journal.read(taskId).length], [1, "COMPLETED", 3]);
    const lockDir = path.join(w.journal.dir, "execution", ".authority-lock");
    assert.ok(!fs.existsSync(lockDir), "the lock was not released");

    // A sweeper that died holding the lock: a fresh lock is respected, an old one with a dead owner is reclaimed.
    const next = createAyasDurableTask(w.journal, task("after-crash", [read("one")]));
    fs.mkdirSync(lockDir, { recursive: true });
    fs.writeFileSync(path.join(lockDir, "owner.json"), `${JSON.stringify({ schemaVersion: "1", gateRoot: w.journal.dir, ownerNonce: "crashed-sweeper", pid: deadPid(), processStartEpochMs: 5, acquiredAt: "2026-10-01T09:00:00.000Z" })}\n`);
    assert.equal((await sweep(w, slow)).result, "ANOTHER_SWEEP_ACTIVE");
    assert.equal(w.journal.read(next.taskId).length, 1);
    const old = new Date(Date.now() - 3_600_000);
    fs.utimesSync(lockDir, old, old);
    const reclaimed = await sweep(w, slow);
    assert.deepEqual([reclaimed.result, w.journal.load(next.taskId)!.status, calls, fs.existsSync(lockDir)], ["SWEPT", "COMPLETED", 2, false]);
    // The lock directory is not a task.
    assert.deepEqual(w.journal.list(), [next.taskId, taskId].sort());
  });

  await scenario("concurrent writer: the task that loses the race runs nothing, the sweep goes on", async () => {
    const w = world(); const calls: string[] = [];
    const activities: Record<string, AyasDurableActivity> = { "fake.read": { run: async (ctx) => { calls.push(ctx.taskId); return { outcome: "SUCCEEDED", result: 1 }; } } };
    const raced = createAyasDurableTask(w.journal, task("raced", [read("one")]));
    w.clock.ms += 1000;
    const quiet = createAyasDurableTask(w.journal, task("quiet", [read("one")]));
    const winner = sealAyasDurableTaskEvent(raced.taskId, w.journal.read(raced.taskId).at(-1), new Date(w.clock.ms).toISOString(),
      { type: "ATTEMPT_STARTED", stepId: "one", attempt: 1, attemptId: ayasDurableAttemptId(key(raced), 1), owner: { pid: process.pid, startEpochMs: 3, nonce: "owner-twin" } });
    const realLink = fs.linkSync;
    fs.linkSync = ((from: fs.PathLike, to: fs.PathLike) => { fs.linkSync = realLink; fs.writeFileSync(to, `${JSON.stringify(winner, null, 2)}\n`); return realLink(from, to); }) as typeof fs.linkSync;
    let report: AyasDurableTaskSweepReport;
    try { report = await sweep(w, activities, {}, true); } finally { fs.linkSync = realLink; }
    assert.deepEqual([entry(report, raced.taskId).outcome, entry(report, raced.taskId).recorded, entry(report, quiet.taskId).outcome], ["LOST_RACE", [], "ADVANCED"]);
    assert.deepEqual([calls, report.activityCalls, w.journal.load(raced.taskId)!.stepStates[0]!.owner!.nonce], [[quiet.taskId], 1, "owner-twin"]);
    // The winner is alive, so the next tick leaves its attempt alone.
    assert.deepEqual([entry(await sweep(w, activities, {}, true), raced.taskId).outcome, calls.length], ["RUNNING", 1]);
  });

  await scenario("timeout and retry bound: a hanging tool is cut off, retries stop at maxAttempts", async () => {
    const w = world(); let aborted = 0; let calls = 0;
    const hanging: Record<string, AyasDurableActivity> = { "fake.read": { run: (ctx) => new Promise((_, reject) => { calls++; ctx.signal.addEventListener("abort", () => { aborted++; reject(new Error("aborted")); }); }) } };
    const { taskId } = createAyasDurableTask(w.journal, task("timeout", [read("slow", { timeoutMs: 25, maxAttempts: 2, retryDelayMs: 0 })]));
    const startedAt = performance.now();
    const first = await sweep(w, hanging);
    assert.ok(performance.now() - startedAt < 10_000, "the step timeout did not bound the sweep");
    assert.deepEqual([entry(first, taskId).recorded, entry(first, taskId).status], [["ATTEMPT_STARTED", "ATTEMPT_UNCONFIRMED"], "ACTIVE"]);
    const second = await sweep(w, hanging);
    assert.deepEqual([entry(second, taskId).status, second.statuses, calls, aborted], ["FAILED", { FAILED: 1 }, 2, 2]);
    // A failed task is a definite outcome: it stays visible, is never retried, and is not an unproven state.
    const third = await sweep(w, hanging);
    assert.deepEqual([entry(third, taskId).outcome, third.needsReview, third.activityCalls, calls], ["TERMINAL", [], 0, 2]);

    // Model restart or network loss: a definite failure waits out its delay, without a call in between.
    const r = world(); let attempts = 0;
    const flaky: Record<string, AyasDurableActivity> = { "fake.read": { run: async () => (++attempts < 3 ? { outcome: "FAILED_NO_EFFECT", reason: "local model is restarting", retryable: true } : { outcome: "SUCCEEDED", result: "answer" }) } };
    const retry = createAyasDurableTask(r.journal, task("retry", [read("ask")]));
    await sweep(r, flaky);
    const waiting = await sweep(r, flaky);
    assert.deepEqual([entry(waiting, retry.taskId).outcome, waiting.activityCalls, attempts], ["WAITING_RETRY", 0, 1]);
    r.clock.ms += 500; await sweep(r, flaky);
    r.clock.ms += 500;
    assert.deepEqual([entry(await sweep(r, flaky), retry.taskId).status, attempts], ["COMPLETED", 3]);
    const x = world(); let down = 0;
    const dead: Record<string, AyasDurableActivity> = { "fake.read": { run: async () => { down++; return { outcome: "FAILED_NO_EFFECT", reason: "still down", retryable: true }; } } };
    const exhausted = createAyasDurableTask(x.journal, task("exhausted", [read("ask", { retryDelayMs: 0 })]));
    for (let index = 0; index < 6; index++) await sweep(x, dead);
    assert.deepEqual([x.journal.load(exhausted.taskId)!.status, down], ["FAILED", 3]);
  });

  await scenario("owner delay and stale tasks: waiting is not stale, a stuck step is reported and never taken over", async () => {
    const w = world(); let calls = 0;
    const activities: Record<string, AyasDurableActivity> = { "fake.read": { run: async () => ({ outcome: "SUCCEEDED", result: ++calls }) }, "fake.write": {
      run: async () => ({ outcome: "UNKNOWN", reason: "no answer" }), reread: async () => { throw new Error("network unreachable"); } } };
    const waiting = createAyasDurableTask(w.journal, task("owner-wait", [{ stepId: "owner", kind: "OWNER_WAIT", question: "Publish this draft?" }, read("after")], "REVENUE"));
    const stuck = createAyasDurableTask(w.journal, task("stuck", [read("one")]));
    w.journal.append(stuck.taskId, 1, { type: "ATTEMPT_STARTED", stepId: "one", attempt: 1, attemptId: ayasDurableAttemptId(key(stuck), 1), owner: other });
    const offline = createAyasDurableTask(w.journal, task("offline", [write("apply")]));
    const attemptId = ayasDurableAttemptId(key(offline), 1);
    w.journal.append(offline.taskId, 1, { type: "ATTEMPT_STARTED", stepId: "apply", attempt: 1, attemptId, owner: other });
    w.journal.append(offline.taskId, 2, { type: "ATTEMPT_UNCONFIRMED", stepId: "apply", attemptId, cause: "TIMEOUT", detail: "no result" });
    const early = await sweep(w, activities, {}, true);
    assert.deepEqual([entry(early, waiting.taskId).outcome, entry(early, stuck.taskId).outcome, entry(early, offline.taskId).outcome, early.needsReview], ["WAITING_OWNER", "RUNNING", "REREAD_UNAVAILABLE", []]);
    w.clock.ms += 2 * 3_600_000;
    const overdue = await sweep(w, activities, {}, true);
    assert.deepEqual([entry(overdue, stuck.taskId).outcome, entry(overdue, stuck.taskId).overdueMs, entry(overdue, stuck.taskId).stale, overdue.needsReview], ["OVERDUE", 2 * 3_600_000 - 1000, false, [stuck.taskId]]);
    w.clock.ms += 3 * 86_400_000;
    const days = await sweep(w, activities, {}, true);
    assert.deepEqual([entry(days, waiting.taskId).outcome, entry(days, waiting.taskId).stale, entry(days, waiting.taskId).idleMs], ["WAITING_OWNER", false, 3 * 86_400_000 + 2 * 3_600_000]);
    assert.deepEqual([entry(days, stuck.taskId).stale, entry(days, offline.taskId).outcome, entry(days, offline.taskId).stale], [true, "REREAD_UNAVAILABLE", true]);
    assert.deepEqual([...days.needsReview].sort(), [stuck.taskId, offline.taskId].sort());
    // Nothing was taken over, replayed or cancelled while it waited.
    assert.deepEqual([w.journal.read(waiting.taskId).length, w.journal.read(stuck.taskId).length, w.journal.read(offline.taskId).length, calls], [1, 2, 3, 0]);
    assert.equal((await sweep(w, activities, { staleAfterMs: 366 * 86_400_000 }, true)).needsReview.includes(offline.taskId), false);
    recordAyasDurableTaskOwnerSignal(w.journal, waiting.taskId, "owner", "PROCEED", "approval-inbox:1");
    assert.deepEqual([entry(await sweep(w, activities, {}, true), waiting.taskId).status, calls], ["COMPLETED", 1]);
  });

  await scenario("corrupt journal: reported for that task, untouched, and the sweep goes on", async () => {
    const w = world(); let calls = 0;
    const activities: Record<string, AyasDurableActivity> = { "fake.read": { run: async () => ({ outcome: "SUCCEEDED", result: { value: ++calls } }) } };
    const damaged = createAyasDurableTask(w.journal, task("damaged", [read("one"), read("two")]));
    await advanceAyasDurableTask(damaged.taskId, w.deps(activities));
    const healthy = createAyasDurableTask(w.journal, task("healthy", [read("one")]));
    const file = path.join(w.journal.dir, damaged.taskId, "events", "00000003.json");
    const original = fs.readFileSync(file, "utf8");
    const edited = original.replace('"value": 1', '"value": 7');
    assert.notEqual(edited, original);
    fs.writeFileSync(file, edited);
    for (const dryRun of [true, false]) {
      const report = await sweep(w, activities, { dryRun });
      assert.deepEqual([entry(report, damaged.taskId).outcome, entry(report, damaged.taskId).status, report.needsReview, report.statuses.UNREADABLE], ["UNREADABLE", "UNREADABLE", [damaged.taskId], 1]);
      assert.match(entry(report, damaged.taskId).detail!, /^AYAS_DURABLE_TASK_JOURNAL_CORRUPT: /);
    }
    assert.deepEqual([w.journal.load(healthy.taskId)!.status, calls, fs.readFileSync(file, "utf8"), fs.readdirSync(path.dirname(file)).length], ["COMPLETED", 2, edited, 3]);
    // A broken hash link and a missing event are the same finding; neither is read as a shorter history.
    fs.writeFileSync(file, original);
    fs.renameSync(path.join(path.dirname(file), "00000002.json"), path.join(path.dirname(file), "held-aside"));
    assert.equal(entry(await sweep(w, activities), damaged.taskId).outcome, "UNREADABLE");
    fs.renameSync(path.join(path.dirname(file), "held-aside"), path.join(path.dirname(file), "00000002.json"));
    assert.deepEqual([entry(await sweep(w, activities), damaged.taskId).outcome, w.journal.load(damaged.taskId)!.status, calls], ["ADVANCED", "COMPLETED", 3]);
    // A storage fault while recording is reported for that task and does not stop the others.
    const f = world();
    const first = createAyasDurableTask(f.journal, task("first", [read("one")]));
    f.clock.ms += 1000;
    const second = createAyasDurableTask(f.journal, task("second", [read("one")]));
    const realLink = fs.linkSync;
    fs.linkSync = (() => { fs.linkSync = realLink; throw Object.assign(new Error("disk full"), { code: "ENOSPC" }); }) as typeof fs.linkSync;
    let faulted: AyasDurableTaskSweepReport;
    try { faulted = await sweep(f, activities); } finally { fs.linkSync = realLink; }
    assert.deepEqual([entry(faulted, first.taskId).outcome, entry(faulted, second.taskId).outcome, faulted.needsReview], ["FAULT", "ADVANCED", [first.taskId]]);
    assert.match(entry(faulted, first.taskId).detail!, /^AYAS_DURABLE_TASK_IO: /);
  });

  await scenario("side effects: never started by a default sweep, recovered by any sweep, same key when enabled", async () => {
    const w = world(); const system = target();
    const pending = createAyasDurableTask(w.journal, task("pending", [write("apply")], "REVENUE"));
    const crashed = createAyasDurableTask(w.journal, task("crashed", [write("apply")], "REVENUE"));
    w.journal.append(crashed.taskId, 1, { type: "ATTEMPT_STARTED", stepId: "apply", attempt: 1, attemptId: ayasDurableAttemptId(key(crashed), 1), owner: other });
    const first = await sweep(w, system.activities, {}, false);
    assert.deepEqual([entry(first, pending.taskId).outcome, entry(first, pending.taskId).recorded, entry(first, crashed.taskId).recorded], ["REFUSED", [], ["ATTEMPT_UNCONFIRMED"]]);
    assert.match(entry(first, pending.taskId).detail!, /side-effect starts are not enabled/);
    assert.ok(first.needsReview.includes(pending.taskId));
    // The reread is recovery and runs; the retry it allows is a new side effect and does not.
    const second = await sweep(w, system.activities, {}, false);
    assert.deepEqual([entry(second, crashed.taskId).recorded, w.journal.load(crashed.taskId)!.stepStates[0]!.status], [["STATE_REREAD"], "RETRY_WAIT"]);
    const third = await sweep(w, system.activities, {}, false);
    assert.deepEqual([entry(third, crashed.taskId).outcome, entry(third, pending.taskId).outcome, system.runs.length, system.rereads], ["REFUSED", "REFUSED", 0, 1]);
    assert.deepEqual([w.journal.read(pending.taskId).length, w.journal.read(crashed.taskId).length], [1, 4]);
    assert.equal((await sweep(w, system.activities, { dryRun: true }, false)).outcomes.REFUSED, 2);
    // The caller's own admission hook is asked too, and its refusal records nothing.
    const hooked = await sweepAyasDurableTasks({ ...w.deps(system.activities), admitStart: () => "capability lease missing" }, { lock: quick, allowSideEffectStarts: true });
    assert.deepEqual([hooked.outcomes, entry(hooked, pending.taskId).detail, system.runs.length], [{ REFUSED: 2 }, "capability lease missing", 0]);
    const enabled = await sweep(w, system.activities, { allowSideEffectStarts: true }, false);
    assert.deepEqual([enabled.outcomes, enabled.statuses], [{ ADVANCED: 2 }, { COMPLETED: 2 }]);
    // Idempotency: the retry after the crash carried the first attempt's key, and each target was written once.
    assert.deepEqual([...system.runs].sort(), [key(pending), key(crashed)].sort());
    assert.equal(system.applied.size, 2);
    assert.deepEqual([(await sweep(w, system.activities, { allowSideEffectStarts: true })).activityCalls, system.runs.length], [0, 2]);

    // The policy holds when the task moves between inspection and action. The sweep inspects a task as "needs a
    // reread"; before it acts, another writer records that reread as "not applied", which makes the next step a new
    // side-effect start. The sweep must not start it.
    const m = world(); const moved = target();
    const shifting = createAyasDurableTask(m.journal, task("shifting", [write("apply")], "REVENUE"));
    const attemptId = ayasDurableAttemptId(key(shifting), 1);
    m.journal.append(shifting.taskId, 1, { type: "ATTEMPT_STARTED", stepId: "apply", attempt: 1, attemptId, owner: other });
    m.journal.append(shifting.taskId, 2, { type: "ATTEMPT_UNCONFIRMED", stepId: "apply", attemptId, cause: "TIMEOUT", detail: "no result" });
    // A running task that is inspected after `shifting`: its liveness check is the moment the other writer acts.
    let decoyKey = 0;
    while (defineAyasDurableTask(task(`decoy-${decoyKey}`, [read("one")])).taskId < shifting.taskId) decoyKey++;
    const decoy = createAyasDurableTask(m.journal, task(`decoy-${decoyKey}`, [read("one")]));
    m.journal.append(decoy.taskId, 1, { type: "ATTEMPT_STARTED", stepId: "one", attempt: 1, attemptId: ayasDurableAttemptId(key(decoy), 1), owner: other });
    let interleaved = 0;
    const racing = await sweepAyasDurableTasks({ ...m.deps(moved.activities), isOwnerAlive: async () => {
      if (interleaved++ === 0) m.journal.append(shifting.taskId, 3, { type: "STATE_REREAD", stepId: "apply", attemptId, observation: "NOT_APPLIED", evidence: "another writer reread it" });
      return true;
    } }, { lock: quick });
    assert.deepEqual([interleaved > 0, entry(racing, shifting.taskId).outcome, entry(racing, shifting.taskId).decision, entry(racing, shifting.taskId).recorded], [true, "REFUSED", "START_ATTEMPT", []]);
    assert.deepEqual([moved.runs.length, moved.rereads, m.journal.read(shifting.taskId).length], [0, 0, 4]);
  });

  await scenario("activity declarations: a step that disagrees with its activity never runs", async () => {
    const w = world(); let runs = 0;
    const activities: Record<string, AyasDurableActivity> = {
      "fake.write": { declared: { effect: "SIDE_EFFECT", domains: ["REVENUE"], targets: ["listing:draft-7"] }, run: async () => { runs++; return { outcome: "SUCCEEDED", result: 1 }; }, reread: async () => ({ observation: "UNKNOWN", evidence: "not used" }) },
      "fake.read": { run: async () => ({ outcome: "SUCCEEDED", result: 1 }) },
    };
    // A side effect described as a read would be retried without a reread.
    const lie = createAyasDurableTask(w.journal, task("lie", [read("one", { activity: "fake.write", exactTarget: "listing:draft-7" })], "REVENUE"));
    const wrongDomain = createAyasDurableTask(w.journal, task("wrong-domain", [write("apply")], "RESEARCH"));
    const wrongTarget = createAyasDurableTask(w.journal, task("wrong-target", [write("apply", { exactTarget: "listing:draft-8" })], "REVENUE"));
    const missing = createAyasDurableTask(w.journal, task("missing", [read("one", { activity: "fake.missing" })]));
    const fine = createAyasDurableTask(w.journal, task("fine", [read("one")]));
    for (const dryRun of [true, false]) {
      const report = await sweep(w, activities, { allowSideEffectStarts: true, dryRun });
      for (const item of [lie, wrongDomain, wrongTarget]) {
        assert.equal(entry(report, item.taskId).outcome, "REFUSED");
        assert.match(entry(report, item.taskId).detail!, /^AYAS_DURABLE_TASK_ACTIVITY_MISMATCH: /);
      }
      assert.match(entry(report, missing.taskId).detail!, /^AYAS_DURABLE_TASK_ACTIVITY_NOT_REGISTERED: /);
      assert.deepEqual([entry(report, fine.taskId).outcome, [...report.needsReview].sort()], [dryRun ? "PLANNED" : "ADVANCED", [lie, wrongDomain, wrongTarget, missing].map((item) => item.taskId).sort()]);
    }
    assert.equal(runs, 0);
    for (const item of [lie, wrongDomain, wrongTarget, missing]) assert.equal(w.journal.read(item.taskId).length, 1);
    await expectCode("AYAS_DURABLE_TASK_ACTIVITY_MISMATCH", () => advanceAyasDurableTask(lie.taskId, w.deps(activities)));
    // An unconfirmed attempt of a mismatched step is not reread through the wrong activity either.
    const attemptId = ayasDurableAttemptId(key(wrongTarget), 1);
    w.journal.append(wrongTarget.taskId, 1, { type: "ATTEMPT_STARTED", stepId: "apply", attempt: 1, attemptId, owner: other });
    w.journal.append(wrongTarget.taskId, 2, { type: "ATTEMPT_UNCONFIRMED", stepId: "apply", attemptId, cause: "OWNER_GONE", detail: "crashed" });
    assert.equal(entry(await sweep(w, activities, { allowSideEffectStarts: true }), wrongTarget.taskId).outcome, "REFUSED");
    // The matching step runs.
    const match = createAyasDurableTask(w.journal, task("match", [write("apply")], "REVENUE"));
    assert.deepEqual([entry(await sweep(w, activities, { allowSideEffectStarts: true }), match.taskId).outcome, runs], ["ADVANCED", 1]);
    // Inspecting a task reads only.
    const before = snapshot(w.root);
    assert.equal((await inspectAyasDurableTask(lie.taskId, w.deps(activities))).decision.action, "START_ATTEMPT");
    assert.equal(snapshot(w.root), before);
  });

  await scenario("first activity set: one read-only Graphify state read, recorded once per commit", async () => {
    const w = world(); let collected = 0; let current = facts();
    const givenRoot = path.join(base, "not-read"); const readRoots = new Set<string>();
    const set = createAyasFirstDurableActivitySet({ repoRoot: givenRoot, collectFacts: async (root) => { collected++; readRoots.add(root); return current; } });
    assert.deepEqual(Object.keys(set), [AYAS_GRAPHIFY_STATE_ACTIVITY]);
    assert.ok(Object.isFrozen(set) && Object.isFrozen(set[AYAS_GRAPHIFY_STATE_ACTIVITY]) && Object.isFrozen(set[AYAS_GRAPHIFY_STATE_ACTIVITY]!.declared));
    assert.deepEqual(set[AYAS_GRAPHIFY_STATE_ACTIVITY]!.declared, { effect: "READ_ONLY", domains: ["SELF_DEVELOPMENT"], targets: [AYAS_GRAPHIFY_STATE_TARGET] });
    assert.equal(set[AYAS_GRAPHIFY_STATE_ACTIVITY]!.reread, undefined);
    const input = ayasGraphifyStateTaskInput(head);
    assert.deepEqual([input.domain, input.taskKey, input.steps.length], ["SELF_DEVELOPMENT", `graphify-state:${head}`, 1]);
    for (const bad of ["", "HEAD", head.slice(1), `${head}0`, head.toUpperCase(), `${head.slice(0, 39)}\n`]) assert.throws(() => ayasGraphifyStateTaskInput(bad), /AYAS_GRAPHIFY_STATE_TASK_HEAD_INVALID/);
    const created = createAyasDurableTask(w.journal, input);
    assert.equal(createAyasDurableTask(w.journal, ayasGraphifyStateTaskInput(head)).taskId, created.taskId);
    // The default sweep, with no side-effect permission, is enough for this set.
    const done = await sweep(w, set);
    assert.deepEqual([entry(done, created.taskId).recorded, done.activityCalls, collected], [["ATTEMPT_STARTED", "ATTEMPT_SUCCEEDED"], 1, 1]);
    assert.deepEqual(w.journal.load(created.taskId)!.stepStates[0]!.result, {
      sourceHead: head, lastAnalyzedHead: head, graphBuiltFromHead: head, boundToHead: true, stale: false, needsUpdate: false, worktreeState: "CLEAN",
      structuralStatus: "CURRENT", structuralReasons: [], semanticStatus: "CURRENT", classification: "GRAPH_CURRENT",
      nodes: 10, edges: 20, duplicateNodes: 0, duplicateEdges: 0, danglingEdges: 0, selfLoops: 0, incompleteCodeFiles: 0, criticalIncompleteFiles: 0 });
    assert.deepEqual([(await sweep(w, set)).activityCalls, collected], [0, 1]);

    // The activity reports what it sees; a graph that is behind is a recorded result, not a failure.
    const report = async (over: Partial<AyasGraphifyFacts>, commit: string): Promise<Record<string, unknown>> => {
      current = facts({ sourceHead: commit, ...over });
      const { taskId } = createAyasDurableTask(w.journal, ayasGraphifyStateTaskInput(commit));
      await sweep(w, set);
      const state = w.journal.load(taskId)!;
      assert.equal(state.status, "COMPLETED");
      return state.stepStates[0]!.result as Record<string, unknown>;
    };
    const behind = await report({}, "b".repeat(40));
    assert.deepEqual([behind.boundToHead, behind.sourceHead, behind.lastAnalyzedHead], [false, "b".repeat(40), head]);
    assert.equal((await report({ branch: { lastSeenHead: "c".repeat(40), lastAnalyzedHead: "c".repeat(40), stale: true, staleReason: "worktree changed" } }, "c".repeat(40))).boundToHead, false);
    assert.equal((await report({ branch: { lastSeenHead: "d".repeat(40), lastAnalyzedHead: "d".repeat(40), stale: false, staleReason: null }, needsUpdateFlag: true }, "d".repeat(40))).boundToHead, false);
    const absent = await report({ branch: "ABSENT", graph: "UNREADABLE" }, "e".repeat(40));
    assert.deepEqual([absent.boundToHead, absent.stale, absent.nodes, absent.lastAnalyzedHead], [false, null, null, null]);

    // No readable HEAD is a definite failure with no effect: retried after its delay, then failed at the bound.
    current = facts({ sourceHead: null });
    const noHead = createAyasDurableTask(w.journal, ayasGraphifyStateTaskInput("f".repeat(40)));
    await sweep(w, set);
    assert.deepEqual([entry(await sweep(w, set), noHead.taskId).outcome, w.journal.load(noHead.taskId)!.stepStates[0]!.attempts], ["WAITING_RETRY", 1]);
    for (let index = 0; index < 2; index++) { w.clock.ms += 60_000; await sweep(w, set); }
    assert.deepEqual([w.journal.load(noHead.taskId)!.status, w.journal.load(noHead.taskId)!.stepStates[0]!.attempts], ["FAILED", 3]);

    // Task input cannot steer the activity: any input is refused before the collector runs, and other targets,
    // domains or effects do not match the declaration.
    current = facts();
    const before = collected;
    const step = input.steps[0] as Record<string, unknown>;
    const steered = createAyasDurableTask(w.journal, { ...input, taskKey: "steered", steps: [{ ...step, input: { repoRoot: "elsewhere" } }] });
    await sweep(w, set);
    assert.deepEqual([w.journal.load(steered.taskId)!.status, collected], ["FAILED", before]);
    const variants = [
      createAyasDurableTask(w.journal, { ...input, taskKey: "other-target", steps: [{ ...step, exactTarget: "repository:other" }] }),
      createAyasDurableTask(w.journal, { ...input, taskKey: "other-domain", domain: "REVENUE" }),
      createAyasDurableTask(w.journal, { ...input, taskKey: "as-side-effect", steps: [{ ...step, effect: "SIDE_EFFECT" }] }),
    ];
    const refused = await sweep(w, set, { allowSideEffectStarts: true });
    for (const item of variants) assert.equal(entry(refused, item.taskId).outcome, "REFUSED");
    assert.equal(collected, before);
    // Every read went to the root the caller gave in code.
    assert.deepEqual([...readRoots], [givenRoot]);

    // The real collector against a TEMP directory that is not a repository: read-only, and a definite failure.
    const emptyDir = path.join(base, "not-a-repository");
    fs.mkdirSync(emptyDir);
    const real = world();
    const realTask = createAyasDurableTask(real.journal, ayasGraphifyStateTaskInput(head));
    await sweep(real, createAyasFirstDurableActivitySet({ repoRoot: emptyDir }));
    assert.deepEqual([real.journal.load(realTask.taskId)!.stepStates[0]!.status, fs.readdirSync(emptyDir)], ["RETRY_WAIT", []]);
    assert.match(real.journal.load(realTask.taskId)!.stepStates[0]!.detail!, /repository HEAD could not be read/);
    // Nothing the set recorded holds a path.
    const stored = [w, real].flatMap((item) => item.journal.list().flatMap((taskId) => item.journal.read(taskId).map((event) => JSON.stringify(event)))).join("\n");
    assert.ok(!stored.includes(base) && !stored.toLowerCase().includes(repo.toLowerCase()) && !/[A-Za-z]:\\\\/.test(stored), "a path reached the journal");
  });

  await scenario("live binding: REQUIRE_OWNER, refused before any disk access, no daemon wired", async () => {
    assert.equal(ayasDurableTaskLiveBinding(), "REQUIRE_OWNER");
    const cwd = path.join(base, "checkout");
    const liveDir = path.join(cwd, "data", "brain", "autonomy", "durable-tasks");
    assert.deepEqual([isAyasDurableTaskLiveJournal(liveDir, cwd), isAyasDurableTaskLiveJournal(liveDir.toUpperCase(), cwd), isAyasDurableTaskLiveJournal(path.join(liveDir, "..", "durable-tasks"), cwd),
      isAyasDurableTaskLiveJournal(path.join(cwd, "data", "brain", "autonomy"), cwd), isAyasDurableTaskLiveJournal(path.join(base, "root-1", "durable-tasks"), cwd)], [true, true, true, false, false]);
    // The default journal of this checkout is the live one. Building the handle touches no disk; the sweep refuses it first.
    const live = createAyasDurableTaskJournal();
    assert.ok(isAyasDurableTaskLiveJournal(live.dir));
    let listed = 0;
    const guarded: AyasDurableTaskJournal = { ...live, list: () => { listed++; return []; } };
    await expectCode("AYAS_DURABLE_TASK_LIVE_BINDING_REQUIRES_OWNER", () => sweepAyasDurableTasks({ journal: guarded, activities: {}, owner: self }));
    await expectCode("AYAS_DURABLE_TASK_LIVE_BINDING_REQUIRES_OWNER", () => sweepAyasDurableTasks({ journal: guarded, activities: {}, owner: self }, { allowSideEffectStarts: true }));
    assert.equal(listed, 0);

    // The operator script: dry run by default, --apply refused for the live journal, usable against another root.
    const script = path.join(repo, "scripts", "ayas-durable-task-recovery.ts");
    const cli = (cwdDir: string, args: readonly string[]): { status: number | null; stdout: string; stderr: string } => {
      const run = spawnSync(process.execPath, [path.join(repo, "node_modules", "tsx", "dist", "cli.mjs"), "--tsconfig", path.join(repo, "tsconfig.json"), script, ...args], { cwd: cwdDir, encoding: "utf8", windowsHide: true, timeout: 120_000 });
      return { status: run.status, stdout: run.stdout, stderr: run.stderr };
    };
    fs.mkdirSync(cwd, { recursive: true });
    const refused = cli(cwd, ["--apply"]);
    assert.deepEqual([refused.status, JSON.parse(refused.stdout)], [2, { status: "REQUIRE_OWNER", code: "AYAS_DURABLE_TASK_LIVE_BINDING_REQUIRES_OWNER" }]);
    assert.equal(cli(cwd, ["--apply", "--enqueue-graphify-check"]).status, 2);
    assert.deepEqual(fs.readdirSync(cwd), []);
    const w = world();
    const queued = createAyasDurableTask(w.journal, ayasGraphifyStateTaskInput(head));
    const before = snapshot(w.root);
    const dry = cli(cwd, ["--root", w.root]);
    const plan = JSON.parse(dry.stdout) as { status: string; liveBinding: string; report: AyasDurableTaskSweepReport };
    assert.deepEqual([dry.status, plan.status, plan.liveBinding, plan.report.mode, plan.report.outcomes, snapshot(w.root)], [0, "OK", "REQUIRE_OWNER", "DRY_RUN", { PLANNED: 1 }, before]);
    // --apply against a TEMP root runs the real set; the script's working directory is not a repository.
    const applied = cli(cwd, ["--root", w.root, "--apply"]);
    assert.deepEqual([applied.status, (JSON.parse(applied.stdout) as { report: AyasDurableTaskSweepReport }).report.outcomes, w.journal.load(queued.taskId)!.stepStates[0]!.status], [0, { ADVANCED: 1 }, "RETRY_WAIT"]);
    assert.equal(cli(cwd, ["--publish"]).status, 1);
    assert.deepEqual(fs.readdirSync(cwd), []);
    // In a real (TEMP) repository: enqueueing is a write, so it needs --apply, and a dry run creates no task.
    const checkout = path.join(base, "git-checkout");
    fs.mkdirSync(checkout);
    const git = (...args: string[]): string => {
      const run = spawnSync("git", args, { cwd: checkout, encoding: "utf8", windowsHide: true, timeout: 30_000 });
      assert.equal(run.status, 0, run.stderr);
      return run.stdout.trim();
    };
    git("init", "-q"); git("config", "user.email", "f@example.invalid"); git("config", "user.name", "fixture");
    fs.writeFileSync(path.join(checkout, "README.md"), "fixture\n");
    git("add", "README.md"); git("commit", "-q", "-m", "fixture");
    const checkoutHead = git("rev-parse", "HEAD");
    assert.equal(cli(checkout, ["--enqueue-graphify-check"]).status, 1);
    assert.equal(cli(checkout, ["--root", path.join(checkout, "journal"), "--enqueue-graphify-check"]).status, 1);
    assert.deepEqual(fs.readdirSync(checkout).sort(), [".git", "README.md"]);
    // The whole non-live path with the real collector: enqueue the task for this HEAD, read the state, record it once.
    const journalRoot = path.join(base, "git-checkout-journal");
    const run = cli(checkout, ["--root", journalRoot, "--apply", "--enqueue-graphify-check"]);
    assert.deepEqual([run.status, (JSON.parse(run.stdout) as { report: AyasDurableTaskSweepReport }).report.outcomes], [0, { ADVANCED: 1 }]);
    const recorded = createAyasDurableTaskJournal({ rootDir: journalRoot });
    const state = recorded.load(defineAyasDurableTask(ayasGraphifyStateTaskInput(checkoutHead)).taskId)!;
    const result = state.stepStates[0]!.result as Record<string, unknown>;
    // The fixture has no graph: the activity records that, it does not fail and it creates nothing in the checkout.
    assert.deepEqual([state.status, result.sourceHead, result.boundToHead, result.structuralStatus, result.classification, result.worktreeState], ["COMPLETED", checkoutHead, false, "MISSING", "GRAPH_MISSING", "CLEAN"]);
    const again = cli(checkout, ["--root", journalRoot, "--apply", "--enqueue-graphify-check"]);
    assert.deepEqual([again.status, (JSON.parse(again.stdout) as { report: AyasDurableTaskSweepReport }).report.activityCalls, recorded.read(state.taskId).length], [0, 0, 3]);
    assert.deepEqual(fs.readdirSync(checkout).sort(), [".git", "README.md"]);

    // Nothing but the operator script and the smoke suites imports the runtime: no daemon, route or autostart is bound.
    const modules = /AyasDurableTask(?:Recovery|Activities|Runtime|Journal)?\b|ayas-durable-task-recovery/;
    const allowed = new Set(["src/lib/brain/autonomy/AyasDurableTask.ts", "src/lib/brain/autonomy/AyasDurableTaskJournal.ts", "src/lib/brain/autonomy/AyasDurableTaskRuntime.ts", "src/lib/brain/autonomy/AyasDurableTaskRecovery.ts",
      "src/lib/brain/autonomy/AyasDurableTaskActivities.ts", "scripts/ayas-durable-task-recovery.ts", "scripts/smoke-ayas-durable-task-runtime.ts", "scripts/smoke-ayas-durable-task-recovery.ts"]);
    const importers: string[] = [];
    const walk = (dir: string): void => {
      for (const item of fs.readdirSync(path.join(repo, dir), { withFileTypes: true })) {
        const relative = `${dir}/${item.name}`;
        if (item.isDirectory()) { if (item.name !== "node_modules" && !item.name.startsWith(".")) walk(relative); }
        else if (/\.(?:ts|tsx|mts|cts|js|mjs|cjs|ps1|cmd|bat|json)$/.test(item.name) && !allowed.has(relative) && modules.test(fs.readFileSync(path.join(repo, relative), "utf8"))) importers.push(relative);
      }
    };
    for (const dir of ["src", "app", "scripts", "deploy"]) if (fs.existsSync(path.join(repo, dir))) walk(dir);
    assert.deepEqual(importers, []);
    assert.ok(!modules.test(fs.readFileSync(path.join(repo, "package.json"), "utf8")), "package.json runs the recovery script");
  });

  // Nothing was written outside the TEMP base, and no default root was created in the working directory.
  assert.ok(!fs.existsSync(path.join(repo, "data", "brain", "autonomy", "durable-tasks")), "DEFAULT_ROOT_TOUCHED");
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-durable-task-recovery", scenarios, journalRoots: roots }));
}

main().then(() => fs.rmSync(base, { recursive: true, force: true }), (error) => { fs.rmSync(base, { recursive: true, force: true }); console.error(error); process.exitCode = 1; });
