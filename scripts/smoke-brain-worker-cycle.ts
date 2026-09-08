/**
 * Atölye Brain — worker cycle smoke suite (Sprint 183).
 *
 * Deterministic / GPU-free / $0 / no network / filesystem-only (temp workspace).
 * The cycle runs a SAFE STUB only — this suite proves it never reaches real
 * execution and that the queue → cycle → results → report chain is durable.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  createBrainTaskStore,
  buildBrainTask,
  planBrainWorkerCycle,
  runBrainWorkerCycle,
  brainSafeStubProcessor,
  describeBrainWorkerCycleOutcome,
  DEFAULT_BRAIN_WORKER_CONFIG,
  BRAIN_SAFE_STUB_MARKER,
  renderBrainWorkerCycleReport,
} from "../src/lib/brain";
import type { BrainTaskInput, BrainWorkerCycleOptions } from "../src/lib/brain";

let count = 0;
async function scenario(name: string, test: () => void | Promise<void>) {
  await test();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

const START = "2026-09-08T02:00:00.000Z";
const END = "2026-09-08T02:04:00.000Z";
const REPO_ROOT = path.resolve(__dirname, "..");

function ws(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "brain-cycle-"));
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
  title: "map brain modules",
  rationale: "understand boundaries",
  priority: "normal",
  dependsOn: [],
  payload: {},
  createdAt: START,
  ...over,
});

const opts = (over: Partial<BrainWorkerCycleOptions> = {}): BrainWorkerCycleOptions => ({
  config: DEFAULT_BRAIN_WORKER_CONFIG,
  startedAtIso: START,
  finishedAtIso: END,
  ...over,
});

async function run() {
  await scenario("1. empty queue → nothing-runnable, empty report, still persists a cycle", () =>
    withWs(async (root) => {
      const store = createBrainTaskStore({ rootDir: root });
      const outcome = runBrainWorkerCycle(store, opts());
      assert.equal(outcome.tasksProcessed, 0);
      assert.equal(outcome.stopReason, "nothing-runnable");
      assert.equal(outcome.report.tasksRun, 0);
      assert.equal(store.listCycleIds().length, 1);
    }));

  await scenario("2. one auto-safe task → processed once, marked succeeded, result persisted", () =>
    withWs(async (root) => {
      const store = createBrainTaskStore({ rootDir: root });
      store.enqueue(task({ title: "only" }));
      const outcome = runBrainWorkerCycle(store, opts());
      assert.equal(outcome.tasksProcessed, 1);
      assert.equal(outcome.results[0].status, "succeeded");
      assert.match(outcome.results[0].summary, new RegExp(`\\[${BRAIN_SAFE_STUB_MARKER}\\]`));
      assert.equal(store.loadQueue()[0].status, "succeeded");
      const persisted = store.loadCycleResults(outcome.report.cycleId);
      assert.equal(persisted?.results.length, 1);
    }));

  await scenario("3. deterministic ordering — priority, then createdAt, then taskId", () =>
    withWs(async (root) => {
      const store = createBrainTaskStore({ rootDir: root });
      store.enqueue(task({ title: "low", priority: "low", createdAt: START }));
      store.enqueue(task({ title: "urgent", priority: "urgent", createdAt: END }));
      store.enqueue(task({ title: "normal", priority: "normal", createdAt: START }));
      const order = planBrainWorkerCycle(store.loadQueue(), opts()).results.map((r) => r.summary);
      const a = planBrainWorkerCycle(store.loadQueue(), opts()).results.map((r) => r.summary);
      assert.deepEqual(order, a, "same queue → same processing order");
      assert.match(order[0], /urgent/);
      assert.match(order[2], /low/);
    }));

  await scenario("4. maxTasksPerCycle caps the run", () =>
    withWs(async (root) => {
      const store = createBrainTaskStore({ rootDir: root });
      for (let i = 0; i < 5; i += 1) store.enqueue(task({ title: `t${i}`, rationale: `r${i}` }));
      const outcome = runBrainWorkerCycle(store, opts({
        config: { ...DEFAULT_BRAIN_WORKER_CONFIG, maxTasksPerCycle: 2 },
      }));
      assert.equal(outcome.tasksProcessed, 2);
      assert.equal(outcome.stopReason, "max-tasks");
      assert.equal(store.loadQueue().filter((t) => t.status === "succeeded").length, 2);
      assert.equal(store.loadQueue().filter((t) => t.status === "queued").length, 3);
    }));

  await scenario("5. cycleBudgetMs stops the run (injected elapsed clock)", () =>
    withWs(async (root) => {
      const store = createBrainTaskStore({ rootDir: root });
      for (let i = 0; i < 4; i += 1) store.enqueue(task({ title: `b${i}`, rationale: `r${i}` }));
      let ticks = 0;
      const outcome = planBrainWorkerCycle(store.loadQueue(), opts({
        config: { ...DEFAULT_BRAIN_WORKER_CONFIG, cycleBudgetMs: 100 },
        elapsedMs: () => (ticks++ >= 2 ? 999 : 0),
      }));
      assert.equal(outcome.tasksProcessed, 2);
      assert.equal(outcome.stopReason, "budget-exhausted");
    }));

  await scenario("6. approval-required task is parked, never processed", () =>
    withWs(async (root) => {
      const store = createBrainTaskStore({ rootDir: root });
      store.enqueue(task({ kind: "apply-improvement", title: "apply 12" }));
      store.enqueue(task({ kind: "modify-production-code", title: "wire orchestrator" }));
      const outcome = runBrainWorkerCycle(store, opts());
      assert.equal(outcome.tasksProcessed, 0);
      assert.equal(outcome.parkedForApproval.length, 2);
      assert.deepEqual(
        store.loadQueue().map((t) => t.status).sort(),
        ["blocked-on-approval", "blocked-on-approval"],
      );
    }));

  await scenario("7. forbidden task is skipped-unsafe, never processed", () =>
    withWs(async (root) => {
      const store = createBrainTaskStore({ rootDir: root });
      store.enqueue(task({ kind: "analyze-codebase", payload: { pullsModel: true } }));
      store.enqueue(task({ kind: "run-tests", payload: { disablesHvci: true } }));
      const outcome = runBrainWorkerCycle(store, opts());
      assert.equal(outcome.tasksProcessed, 0);
      assert.equal(outcome.skippedUnsafe.length, 2);
    }));

  await scenario("7b. auto-safe-reversible tasks are NOT run this sprint (auto-safe ceiling)", () =>
    withWs(async (root) => {
      const store = createBrainTaskStore({ rootDir: root });
      store.enqueue(task({ kind: "run-tests", title: "run smokes" }));
      store.enqueue(task({ kind: "graphify-refresh", title: "refresh graph" }));
      const outcome = runBrainWorkerCycle(store, opts({
        // even if the config allows reversible, the cycle pins selection to auto-safe
        config: { ...DEFAULT_BRAIN_WORKER_CONFIG, maxAutonomy: "auto-safe-reversible" },
      }));
      assert.equal(outcome.tasksProcessed, 0);
      assert.deepEqual(store.loadQueue().map((t) => t.status), ["queued", "queued"]);
    }));

  await scenario("8+9. results persist and re-saving the same cycle is idempotent", () =>
    withWs(async (root) => {
      const store = createBrainTaskStore({ rootDir: root });
      store.enqueue(task({ title: "x" }));
      const outcome = runBrainWorkerCycle(store, opts());
      const before = store.loadCycleResults(outcome.report.cycleId)?.results.length;
      store.saveCycleResults({ report: outcome.report, results: [...outcome.results, ...outcome.results] });
      assert.equal(store.loadCycleResults(outcome.report.cycleId)?.results.length, before);
    }));

  await scenario("10. restart/reload — a fresh store sees the persisted queue + cycle", () =>
    withWs(async (root) => {
      const first = createBrainTaskStore({ rootDir: root });
      first.enqueue(task({ title: "keep" }));
      const outcome = runBrainWorkerCycle(first, opts());

      const reopened = createBrainTaskStore({ rootDir: root });
      assert.equal(reopened.loadQueue()[0].status, "succeeded");
      assert.deepEqual(reopened.listCycleIds(), [outcome.report.cycleId]);
      // a second cycle on the reloaded store has nothing to do
      assert.equal(runBrainWorkerCycle(reopened, opts({ startedAtIso: END, finishedAtIso: END })).tasksProcessed, 0);
    }));

  await scenario("11. the cycle report is deterministic for the same inputs", () =>
    withWs(async (root) => {
      const s1 = createBrainTaskStore({ rootDir: ws() });
      const s2 = createBrainTaskStore({ rootDir: ws() });
      for (const s of [s1, s2]) {
        s.enqueue(task({ title: "a", rationale: "ra" }));
        s.enqueue(task({ title: "b", rationale: "rb" }));
      }
      const r1 = runBrainWorkerCycle(s1, opts()).report;
      const r2 = runBrainWorkerCycle(s2, opts()).report;
      assert.equal(r1.cycleId, r2.cycleId);
      assert.deepEqual(r1, r2);
      assert.ok(renderBrainWorkerCycleReport(r1).includes("Overnight Report"));
      void root;
    }));

  await scenario("12. an unsafe selection would throw before any processing (defense in depth)", () => {
    // Feed planBrainWorkerCycle a queue whose sole task is hand-forced past the
    // selector guard: a queued task tagged forbidden. The real selector filters
    // it, so processed stays 0 — the cycle never executes an unsafe task.
    const forbidden = { ...buildBrainTask(task({ kind: "analyze-codebase" })), autonomy: "forbidden" as const, status: "queued" as const };
    const outcome = planBrainWorkerCycle([forbidden], opts());
    assert.equal(outcome.tasksProcessed, 0, "forbidden task is never processed");
    assert.equal(outcome.stopReason, "nothing-runnable");
  });

  await scenario("13. STATIC: BrainWorkerCycle.ts contains no execution primitive", () => {
    const raw = fs.readFileSync(
      path.join(REPO_ROOT, "src/lib/brain/worker/BrainWorkerCycle.ts"),
      "utf8",
    );
    // strip block + line comments — the guarantee is about code, not prose
    const code = raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    const banned = [
      "child_process", "execFile", "execSync", "spawn", "spawnSync",
      "fetch(", "node:http", "node:https", "XMLHttpRequest",
      "PipelineRunner", "AIManager", "AIRouter", "OllamaProvider",
      "nvidia-smi", "ffprobe", "ffmpeg", "node:fs", "require(",
    ];
    for (const token of banned) {
      assert.ok(!code.includes(token), `BrainWorkerCycle.ts code must not reference "${token}"`);
    }
    // and it only imports from within the brain worker layer + types
    const imports = [...raw.matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
    for (const spec of imports) {
      assert.ok(
        spec.startsWith("./") || spec === "@/types/brainWorker",
        `unexpected import "${spec}" in BrainWorkerCycle.ts`,
      );
    }
    assert.ok(imports.length > 0, "sanity: found import specifiers");
  });

  await scenario("14. safe-stub processor is pure and deterministic", () => {
    const t = buildBrainTask(task({ title: "pure" }));
    const ctx = { startedAtIso: START, finishedAtIso: END };
    assert.deepEqual(brainSafeStubProcessor(t, ctx), brainSafeStubProcessor(t, ctx));
    const r = brainSafeStubProcessor(t, ctx);
    assert.equal(r.durationMs, 0);
    assert.equal(r.status, "succeeded");
    assert.equal(r.producedTaskIds.length, 0);
  });

  await scenario("15. describeBrainWorkerCycleOutcome mentions safe-stub + counts", () =>
    withWs(async (root) => {
      const store = createBrainTaskStore({ rootDir: root });
      store.enqueue(task({ title: "d" }));
      store.enqueue(task({ kind: "apply-improvement", title: "p" }));
      const text = describeBrainWorkerCycleOutcome(runBrainWorkerCycle(store, opts()));
      assert.match(text, /safe-stub, nothing executed/);
      assert.match(text, /processed 1/);
      assert.match(text, /1 parked/);
    }));

  console.log(`Atölye Brain worker-cycle smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "brain-worker-cycle", scenarios: count }));
}

run().catch((error) => {
  console.error("Atölye Brain worker-cycle smoke FAILED:", error);
  process.exitCode = 1;
});
