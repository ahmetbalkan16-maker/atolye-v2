/**
 * Atölye Brain — durable task-queue store smoke suite (Sprint 182).
 *
 * Deterministic / GPU-free / $0 / no network / filesystem-only. All store IO
 * happens under a fresh `os.tmpdir()` workspace — never `data/brain/`.
 *
 * Covers: enqueue→persist→read, restart/reload, taskId + result idempotency,
 * deterministic ordering, dependency + notBefore persistence + resolution,
 * cycle detection, approval parking, forbidden tasks, corrupt-store loud
 * failure, secret / oversized-payload rejection, atomic write, schemaVersion,
 * empty queue, multi-cycle results, full queue-state round-trip.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  createBrainTaskStore,
  BrainTaskStoreError,
  brainTaskResultId,
  brainTaskStoreSchemaVersion,
  buildBrainTask,
  buildBrainWorkerCycleReport,
} from "../src/lib/brain";
import type { BrainTaskInput, BrainTaskResult } from "../src/lib/brain";

let count = 0;
async function scenario(name: string, test: () => void | Promise<void>) {
  await test();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

const T0 = "2026-09-08T01:00:00.000Z";
const T1 = "2026-09-08T01:30:00.000Z";
const T2 = "2026-09-08T02:00:00.000Z";

function ws(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "brain-task-store-"));
}
async function withWs(body: (root: string) => Promise<void>): Promise<void> {
  const root = ws();
  try {
    await body(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const task = (over: Partial<BrainTaskInput> = {}): BrainTaskInput => ({
  kind: "analyze-codebase",
  title: "map src/lib/brain",
  rationale: "understand module boundaries",
  priority: "normal",
  dependsOn: [],
  payload: {},
  createdAt: T0,
  ...over,
});

const result = (over: Partial<BrainTaskResult> = {}): BrainTaskResult => ({
  taskId: "brain-task-x",
  outcomeKind: "analysis",
  status: "succeeded",
  summary: "17 brain modules, 0 imports from pipeline/production",
  evidence: ["grep: 0 matches"],
  producedTaskIds: [],
  startedAt: T0,
  finishedAt: T1,
  durationMs: 10,
  ...over,
});

async function run() {
  await scenario("1. enqueue → persist → read", () =>
    withWs(async (root) => {
      const store = createBrainTaskStore({ rootDir: root, now: () => new Date(T0) });
      store.enqueue(task({ title: "a" }));
      assert.ok(fs.existsSync(store.queueFile));
      const loaded = store.loadQueue();
      assert.equal(loaded.length, 1);
      assert.equal(loaded[0].title, "a");
      assert.equal(loaded[0].status, "queued");
      const env = JSON.parse(fs.readFileSync(store.queueFile, "utf8"));
      assert.equal(env.schemaVersion, brainTaskStoreSchemaVersion);
      assert.ok(Array.isArray(env.tasks));
    }));

  await scenario("2. restart/reload — a fresh handle on the same dir sees the same queue", () =>
    withWs(async (root) => {
      createBrainTaskStore({ rootDir: root }).enqueue(task({ title: "persist-me" }));
      const reopened = createBrainTaskStore({ rootDir: root });
      const loaded = reopened.loadQueue();
      assert.equal(loaded.length, 1);
      assert.equal(loaded[0].title, "persist-me");
    }));

  await scenario("3. duplicate taskId is idempotent — no duplicate row", () =>
    withWs(async (root) => {
      const store = createBrainTaskStore({ rootDir: root });
      store.enqueue(task({ title: "same" }));
      store.enqueue(task({ title: "same" }));
      assert.equal(store.loadQueue().length, 1);
    }));

  await scenario("4. duplicate result within a cycle is idempotent", () =>
    withWs(async (root) => {
      const store = createBrainTaskStore({ rootDir: root });
      const report = buildBrainWorkerCycleReport({
        startedAt: T0, finishedAt: T2, queueAtStart: [], results: [result()],
        nextSingleStep: "n",
      });
      store.saveCycleResults({ report, results: [result()] });
      const again = store.saveCycleResults({ report, results: [result(), result()] });
      assert.equal(again.results.length, 1, "same result → one row");
      assert.equal(store.loadCycleResults(report.cycleId)?.results.length, 1);
    }));

  await scenario("5. deterministic ordering — stored sorted by taskId, stable across reloads", () =>
    withWs(async (root) => {
      const store = createBrainTaskStore({ rootDir: root });
      store.enqueue(task({ title: "zeta" }));
      store.enqueue(task({ title: "alpha" }));
      store.enqueue(task({ title: "mu" }));
      const first = store.loadQueue().map((t) => t.taskId);
      const second = createBrainTaskStore({ rootDir: root }).loadQueue().map((t) => t.taskId);
      assert.deepEqual(first, second);
      assert.deepEqual(first, [...first].sort());
    }));

  await scenario("6+7. dependency persists and still resolves after a reload", () =>
    withWs(async (root) => {
      const store = createBrainTaskStore({ rootDir: root });
      const first = buildBrainTask(task({ title: "analyze", priority: "high" }));
      const second = buildBrainTask(task({ title: "diagnose", dependsOn: [first.taskId], priority: "urgent" }));
      store.saveQueue([first, second]);

      const reopened = createBrainTaskStore({ rootDir: root });
      const dep = reopened.loadQueue().find((t) => t.title === "diagnose");
      assert.deepEqual(dep?.dependsOn, [first.taskId], "dependsOn survived the round trip");

      // urgent 'second' still cannot run before its dependency succeeds
      assert.equal(
        reopened.nextRunnable({ maxAutonomy: "auto-safe-reversible", nowIso: T1 })?.taskId,
        first.taskId,
      );
      reopened.applyResult(result({ taskId: first.taskId, finishedAt: T1 }));
      assert.equal(
        createBrainTaskStore({ rootDir: root }).nextRunnable({ maxAutonomy: "auto-safe-reversible", nowIso: T1 })?.taskId,
        second.taskId,
      );
    }));

  await scenario("8. a dependency cycle is refused on save AND flagged loud on load", () =>
    withWs(async (root) => {
      const store = createBrainTaskStore({ rootDir: root });
      const a = buildBrainTask(task({ title: "a" }));
      const b = buildBrainTask(task({ title: "b", dependsOn: [a.taskId] }));
      const aCycled = { ...a, dependsOn: [b.taskId] };
      assert.throws(
        () => store.saveQueue([aCycled, b]),
        (e: unknown) => e instanceof BrainTaskStoreError && e.code === "BRAIN_TASK_STORE_QUEUE_INVALID",
      );
      // hand-write a cyclic file, then load
      fs.mkdirSync(path.dirname(store.queueFile), { recursive: true });
      fs.writeFileSync(store.queueFile, JSON.stringify({
        schemaVersion: brainTaskStoreSchemaVersion, updatedAt: T0, tasks: [aCycled, b],
      }), "utf8");
      assert.throws(
        () => store.loadQueue(),
        (e: unknown) => e instanceof BrainTaskStoreError && e.code === "BRAIN_TASK_STORE_QUEUE_INVALID",
      );
    }));

  await scenario("9. notBefore persists and holds the task until its clock after reload", () =>
    withWs(async (root) => {
      const store = createBrainTaskStore({ rootDir: root });
      store.enqueue(task({ title: "later", notBefore: T2 }));
      const reopened = createBrainTaskStore({ rootDir: root });
      assert.equal(reopened.loadQueue()[0].notBefore, T2);
      assert.equal(reopened.nextRunnable({ maxAutonomy: "auto-safe", nowIso: T1 }), undefined);
      assert.ok(reopened.nextRunnable({ maxAutonomy: "auto-safe", nowIso: T2 }));
    }));

  await scenario("10. approval-required task is parked (persisted) and invisible to the runner", () =>
    withWs(async (root) => {
      const store = createBrainTaskStore({ rootDir: root });
      store.enqueue(task({ kind: "apply-improvement", title: "apply proposal 12" }));
      const reopened = createBrainTaskStore({ rootDir: root });
      assert.equal(reopened.loadQueue()[0].status, "blocked-on-approval");
      assert.equal(reopened.loadQueue()[0].autonomy, "requires-user-approval");
      assert.equal(reopened.pendingApproval().length, 1);
      assert.equal(reopened.nextRunnable({ maxAutonomy: "auto-safe-reversible", nowIso: T2 }), undefined);
      // approving persists the transition but the unattended runner still won't touch it
      reopened.approve(reopened.loadQueue()[0].taskId, T2);
      assert.equal(createBrainTaskStore({ rootDir: root }).loadQueue()[0].status, "queued");
      assert.equal(
        createBrainTaskStore({ rootDir: root }).nextRunnable({ maxAutonomy: "auto-safe-reversible", nowIso: T2 }),
        undefined,
      );
    }));

  await scenario("11. forbidden task is persisted skipped-unsafe and never becomes runnable", () =>
    withWs(async (root) => {
      const store = createBrainTaskStore({ rootDir: root });
      store.enqueue(task({ kind: "analyze-codebase", payload: { pullsModel: true } }));
      const reopened = createBrainTaskStore({ rootDir: root });
      assert.equal(reopened.loadQueue()[0].status, "skipped-unsafe");
      assert.equal(reopened.loadQueue()[0].autonomy, "forbidden");
      assert.equal(reopened.nextRunnable({ maxAutonomy: "auto-safe-reversible", nowIso: T2 }), undefined);
    }));

  await scenario("12. corrupt tasks.json → loud BRAIN_TASK_STORE_CORRUPT, not an empty queue", () =>
    withWs(async (root) => {
      const store = createBrainTaskStore({ rootDir: root });
      fs.mkdirSync(path.dirname(store.queueFile), { recursive: true });
      fs.writeFileSync(store.queueFile, "{ not json", "utf8");
      assert.throws(
        () => store.loadQueue(),
        (e: unknown) => e instanceof BrainTaskStoreError && e.code === "BRAIN_TASK_STORE_CORRUPT",
      );
    }));

  await scenario("13. corrupt result shard → loud failure", () =>
    withWs(async (root) => {
      const store = createBrainTaskStore({ rootDir: root });
      fs.mkdirSync(store.resultsDir, { recursive: true });
      fs.writeFileSync(path.join(store.resultsDir, "cycle-abc.json"), "]]not json[[", "utf8");
      assert.throws(
        () => store.loadCycleResults("cycle-abc"),
        (e: unknown) => e instanceof BrainTaskStoreError && e.code === "BRAIN_TASK_STORE_CORRUPT",
      );
    }));

  await scenario("14. a task carrying a secret is rejected, nothing written", () =>
    withWs(async (root) => {
      const store = createBrainTaskStore({ rootDir: root });
      assert.throws(
        () => store.enqueue(task({
          kind: "analyze-codebase",
          rationale: "check the leaked key sk-ant-api03-AAAABBBBCCCCDDDDEEEEFFFF in scratch",
        })),
        (e: unknown) => e instanceof BrainTaskStoreError && e.code === "BRAIN_TASK_STORE_SECRET_LEAK",
      );
      assert.ok(!fs.existsSync(store.queueFile), "no file written on rejection");
      // a secret in the payload is caught too
      assert.throws(
        () => store.enqueue(task({ payload: { note: "Authorization: Bearer abcdef0123456789abcdef" } })),
        (e: unknown) => e instanceof BrainTaskStoreError && e.code === "BRAIN_TASK_STORE_SECRET_LEAK",
      );
    }));

  await scenario("14b. an oversized payload is rejected", () =>
    withWs(async (root) => {
      const store = createBrainTaskStore({ rootDir: root });
      const big: Record<string, string> = {};
      for (let i = 0; i < 40; i += 1) big[`k${i}`] = "x";
      assert.throws(
        () => store.enqueue(task({ payload: big })),
        (e: unknown) => e instanceof BrainTaskStoreError && e.code === "BRAIN_TASK_STORE_PAYLOAD_TOO_LARGE",
      );
      assert.throws(
        () => store.enqueue(task({ payload: { blob: "y".repeat(5000) } })),
        (e: unknown) => e instanceof BrainTaskStoreError && e.code === "BRAIN_TASK_STORE_PAYLOAD_TOO_LARGE",
      );
    }));

  await scenario("15. atomic write — no .tmp left; a rejected save leaves the old file intact", () =>
    withWs(async (root) => {
      const store = createBrainTaskStore({ rootDir: root });
      store.enqueue(task({ title: "good" }));
      const before = fs.readFileSync(store.queueFile, "utf8");
      const dirFiles = fs.readdirSync(path.dirname(store.queueFile));
      assert.deepEqual(dirFiles, ["tasks.json"], "no .tmp leftover");
      // a save that fails validation must not touch the existing file
      assert.throws(() => store.saveQueue([
        ...store.loadQueue(),
        buildBrainTask(task({ title: "leaky", rationale: "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789" })),
      ]));
      assert.equal(fs.readFileSync(store.queueFile, "utf8"), before, "old queue unchanged after a rejected save");
    }));

  await scenario("16. schemaVersion — present on write; a mismatched envelope fails loud", () =>
    withWs(async (root) => {
      const store = createBrainTaskStore({ rootDir: root });
      store.saveQueue([]);
      fs.writeFileSync(store.queueFile, JSON.stringify({ schemaVersion: "999", updatedAt: T0, tasks: [] }), "utf8");
      assert.throws(
        () => store.loadQueue(),
        (e: unknown) => e instanceof BrainTaskStoreError && e.code === "BRAIN_TASK_STORE_SCHEMA_MISMATCH",
      );
    }));

  await scenario("17. an empty queue persists and reloads as []", () =>
    withWs(async (root) => {
      const store = createBrainTaskStore({ rootDir: root });
      store.saveQueue([]);
      assert.ok(fs.existsSync(store.queueFile));
      assert.deepEqual(createBrainTaskStore({ rootDir: root }).loadQueue(), []);
      // loadQueue with no file at all is also [] (not an error)
      const fresh = createBrainTaskStore({ rootDir: ws() });
      assert.deepEqual(fresh.loadQueue(), []);
    }));

  await scenario("18. multiple cycle results persist as separate, sorted files", () =>
    withWs(async (root) => {
      const store = createBrainTaskStore({ rootDir: root });
      for (const c of ["cycle-b", "cycle-a", "cycle-c"]) {
        const report = { ...buildBrainWorkerCycleReport({ startedAt: T0, finishedAt: T2, queueAtStart: [], results: [], nextSingleStep: "n" }), cycleId: c };
        store.saveCycleResults({ report, results: [result({ taskId: `t-${c}` })] });
      }
      assert.deepEqual(store.listCycleIds(), ["cycle-a", "cycle-b", "cycle-c"]);
      assert.equal(createBrainTaskStore({ rootDir: root }).loadCycleResults("cycle-b")?.results[0].taskId, "t-cycle-b");
    }));

  await scenario("19. full queue state (status / attempts / updatedAt) survives a reload", () =>
    withWs(async (root) => {
      const store = createBrainTaskStore({ rootDir: root, now: () => new Date(T0) });
      const a = buildBrainTask(task({ title: "a" }));
      const b = buildBrainTask(task({ title: "b" }));
      store.saveQueue([a, b]);
      store.applyResult(result({ taskId: a.taskId, status: "succeeded", finishedAt: T1 }));
      store.applyResult(result({ taskId: b.taskId, status: "failed", finishedAt: T2 }));

      const reloaded = createBrainTaskStore({ rootDir: root }).loadQueue();
      const ra = reloaded.find((t) => t.taskId === a.taskId)!;
      const rb = reloaded.find((t) => t.taskId === b.taskId)!;
      assert.equal(ra.status, "succeeded");
      assert.equal(ra.attempts, 1);
      assert.equal(ra.updatedAt, T1);
      assert.equal(rb.status, "failed");
      assert.equal(rb.updatedAt, T2);
      // every declared field round-trips
      for (const key of ["taskId", "kind", "priority", "createdAt", "dependsOn", "autonomy", "schemaVersion"] as const) {
        assert.deepEqual(ra[key], a[key], `field ${key} preserved`);
      }
    }));

  await scenario("20. derived resultId is stable and dedupe-safe", () => {
    const r1 = result();
    const r2 = result();
    assert.equal(brainTaskResultId(r1), brainTaskResultId(r2));
    assert.notEqual(brainTaskResultId(r1), brainTaskResultId(result({ finishedAt: T2 })));
    assert.equal(brainTaskResultId({ ...r1, resultId: "explicit" }), "explicit");
  });

  console.log(`Atölye Brain task-store smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "brain-task-store", scenarios: count }));
}

run().catch((error) => {
  console.error("Atölye Brain task-store smoke FAILED:", error);
  process.exitCode = 1;
});
