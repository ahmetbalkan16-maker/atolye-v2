/**
 * Atölye Brain — Worker smoke suite (the PC-off task queue + morning report).
 *
 * Pure, deterministic, GPU-free. Covers:
 *  A. Autonomy gate — fixed table; forbidden / escalating payloads.
 *  B. Task queue — dependency ordering, approval parking, cycle rejection,
 *     approve → runnable, result application.
 *  C. Worker cycle report — structured + rendered "overnight" brief, redaction.
 */

import assert from "node:assert/strict";
import {
  classifyBrainTaskAutonomy,
  isBrainTaskRunnableUnattended,
  buildBrainTask,
  enqueueBrainTask,
  validateBrainTaskQueue,
  nextRunnableBrainTask,
  applyBrainTaskResult,
  pendingApprovalBrainTasks,
  approveBrainTask,
  buildBrainWorkerCycleReport,
  renderBrainWorkerCycleReport,
} from "../src/lib/brain";
import type { BrainTask, BrainTaskInput, BrainTaskResult } from "../src/lib/brain";

let count = 0;
function scenario(name: string, test: () => void) {
  test();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

const T0 = "2026-09-08T01:00:00.000Z";
const T1 = "2026-09-08T01:30:00.000Z";
const T2 = "2026-09-08T02:00:00.000Z";

const task = (over: Partial<BrainTaskInput>): BrainTaskInput => ({
  kind: "analyze-codebase",
  title: "t",
  rationale: "r",
  priority: "normal",
  dependsOn: [],
  payload: {},
  createdAt: T0,
  ...over,
});

function run() {
  /* ------------------------------- A. Autonomy ------------------------- */

  scenario("read-only kinds are auto-safe; test/graphify are reversible", () => {
    assert.equal(classifyBrainTaskAutonomy(task({ kind: "analyze-codebase" })), "auto-safe");
    assert.equal(classifyBrainTaskAutonomy(task({ kind: "security-audit" })), "auto-safe");
    assert.equal(classifyBrainTaskAutonomy(task({ kind: "run-tests" })), "auto-safe-reversible");
    assert.equal(classifyBrainTaskAutonomy(task({ kind: "graphify-refresh" })), "auto-safe-reversible");
    assert.equal(classifyBrainTaskAutonomy(task({ kind: "draft-improvement-proposal" })), "auto-safe-reversible");
  });

  scenario("production / security / gpu / data / push kinds require approval", () => {
    for (const kind of ["modify-production-code", "modify-security-policy", "run-video-pipeline", "gpu-inference-test", "delete-or-mutate-data", "git-push", "apply-improvement"] as const) {
      assert.equal(classifyBrainTaskAutonomy(task({ kind })), "requires-user-approval", kind);
    }
  });

  scenario("forbidden payload flags override everything", () => {
    assert.equal(classifyBrainTaskAutonomy(task({ kind: "analyze-codebase", payload: { changesPowerLimit: true } })), "forbidden");
    assert.equal(classifyBrainTaskAutonomy(task({ kind: "run-tests", payload: { disablesHvci: true } })), "forbidden");
    assert.equal(classifyBrainTaskAutonomy(task({ kind: "analyze-codebase", payload: { pullsModel: true } })), "forbidden");
  });

  scenario("escalating payload flags push an otherwise-safe task to approval", () => {
    assert.equal(classifyBrainTaskAutonomy(task({ kind: "run-tests", payload: { runsGpu: true } })), "requires-user-approval");
    assert.equal(classifyBrainTaskAutonomy(task({ kind: "analyze-codebase", payload: { touchesEnvLocal: true } })), "requires-user-approval");
    assert.equal(classifyBrainTaskAutonomy(task({ kind: "run-tests", payload: { writesOutsideWorkspace: true } })), "requires-user-approval");
  });

  scenario("unattended ceiling gate", () => {
    assert.equal(isBrainTaskRunnableUnattended("auto-safe", "auto-safe"), true);
    assert.equal(isBrainTaskRunnableUnattended("auto-safe-reversible", "auto-safe"), false);
    assert.equal(isBrainTaskRunnableUnattended("auto-safe-reversible", "auto-safe-reversible"), true);
    assert.equal(isBrainTaskRunnableUnattended("requires-user-approval", "auto-safe-reversible"), false);
  });

  /* ------------------------------- B. Task queue ---------------------- */

  scenario("build parks approval / forbidden tasks off the runnable path", () => {
    assert.equal(buildBrainTask(task({ kind: "analyze-codebase" })).status, "queued");
    assert.equal(buildBrainTask(task({ kind: "modify-production-code" })).status, "blocked-on-approval");
    assert.equal(buildBrainTask(task({ kind: "analyze-codebase", payload: { pullsModel: true } })).status, "skipped-unsafe");
  });

  scenario("queue is deterministic and dedupes identical tasks", () => {
    let queue: readonly BrainTask[] = [];
    queue = enqueueBrainTask(queue, task({ title: "same" }));
    queue = enqueueBrainTask(queue, task({ title: "same" }));
    assert.equal(queue.length, 1);
  });

  scenario("dependency ordering — dependent waits until its prerequisite succeeds", () => {
    const first = buildBrainTask(task({ title: "analyze", priority: "high" }));
    const second = buildBrainTask(task({ title: "diagnose", dependsOn: [first.taskId], priority: "urgent" }));
    const queue = [first, second];
    assert.equal(validateBrainTaskQueue(queue).valid, true);
    // urgent 'second' still cannot run first — dependency not satisfied
    const next = nextRunnableBrainTask(queue, { maxAutonomy: "auto-safe-reversible", nowIso: T1 });
    assert.equal(next?.taskId, first.taskId);
    // after first succeeds, second becomes runnable
    const result: BrainTaskResult = {
      taskId: first.taskId, outcomeKind: "analysis", status: "succeeded",
      summary: "done", evidence: [], producedTaskIds: [], startedAt: T0, finishedAt: T1, durationMs: 10,
    };
    const advanced = applyBrainTaskResult(queue, result);
    assert.equal(nextRunnableBrainTask(advanced, { maxAutonomy: "auto-safe-reversible", nowIso: T1 })?.taskId, second.taskId);
  });

  scenario("queue rejects unknown dependency and dependency cycles", () => {
    const t = buildBrainTask(task({ title: "x", dependsOn: ["brain-task-doesnotexist"] }));
    assert.equal(validateBrainTaskQueue([t]).reasonCode, "BRAIN_TASK_QUEUE_UNKNOWN_DEPENDENCY");
  });

  scenario("approval task is invisible to the unattended runner until approved", () => {
    const analyze = buildBrainTask(task({ title: "a" }));
    const apply = buildBrainTask(task({ kind: "apply-improvement", title: "apply x" }));
    let queue: readonly BrainTask[] = [analyze, apply];
    assert.equal(pendingApprovalBrainTasks(queue).length, 1);
    // unattended runner never returns the approval task
    const next = nextRunnableBrainTask(queue, { maxAutonomy: "auto-safe-reversible", nowIso: T1 });
    assert.equal(next?.taskId, analyze.taskId);
    queue = applyBrainTaskResult(queue, {
      taskId: analyze.taskId, outcomeKind: "analysis", status: "succeeded",
      summary: "s", evidence: [], producedTaskIds: [], startedAt: T0, finishedAt: T1, durationMs: 1,
    });
    // still nothing runnable — apply is parked
    assert.equal(nextRunnableBrainTask(queue, { maxAutonomy: "auto-safe-reversible", nowIso: T1 }), undefined);
    // user approves → it becomes runnable (but only above the ceiling)
    queue = approveBrainTask(queue, apply.taskId, T2);
    assert.equal(queue.find((x) => x.taskId === apply.taskId)?.status, "queued");
    // an unattended runner still won't run it — its autonomy is requires-user-approval
    assert.equal(nextRunnableBrainTask(queue, { maxAutonomy: "auto-safe-reversible", nowIso: T2 }), undefined);
  });

  scenario("notBefore holds a task until its clock", () => {
    const later = buildBrainTask(task({ title: "later", notBefore: T2 }));
    assert.equal(nextRunnableBrainTask([later], { maxAutonomy: "auto-safe", nowIso: T1 }), undefined);
    assert.equal(nextRunnableBrainTask([later], { maxAutonomy: "auto-safe", nowIso: T2 })?.taskId, later.taskId);
  });

  /* ------------------------------- C. Cycle report ------------------- */

  scenario("overnight report groups outcomes and lists pending approvals", () => {
    const analyze = buildBrainTask(task({ title: "map src/lib/brain" }));
    const apply = buildBrainTask(task({ kind: "modify-production-code", title: "wire orchestrator", rationale: "connect planBrainRun to PipelineRunner" }));
    const queueAtStart = [analyze, apply];
    const results: BrainTaskResult[] = [
      { taskId: analyze.taskId, outcomeKind: "analysis", status: "succeeded", summary: "17 brain modules, 0 imports from pipeline/production", evidence: [], producedTaskIds: [], startedAt: T0, finishedAt: T1, durationMs: 5 },
      { taskId: "t-diag", outcomeKind: "diagnosis", status: "succeeded", summary: "youtube stage flaky on qwen2.5:3b JSON", evidence: [], producedTaskIds: [], startedAt: T0, finishedAt: T1, durationMs: 5 },
      { taskId: "t-test", outcomeKind: "test-run", status: "succeeded", summary: "smoke-brain-foundation PASS (25)", evidence: [], producedTaskIds: [], startedAt: T0, finishedAt: T1, durationMs: 5 },
      { taskId: "t-prop", outcomeKind: "proposal", status: "succeeded", summary: "grammar-constrain OllamaYouTubeProvider", evidence: [], producedTaskIds: [], startedAt: T0, finishedAt: T1, durationMs: 5 },
      { taskId: "t-sec", outcomeKind: "security-finding", status: "succeeded", summary: "no rate limiting — needed before internet exposure", evidence: [], producedTaskIds: [], startedAt: T0, finishedAt: T1, durationMs: 5 },
    ];
    const report = buildBrainWorkerCycleReport({
      startedAt: T0, finishedAt: T2, queueAtStart, results,
      nextSingleStep: "Get approval to wire planBrainRun into a read-only dry-run endpoint.",
    });
    assert.equal(report.tasksConsidered, 2);
    assert.ok(report.analyses.length >= 1);
    assert.ok(report.problemsFound.some((p) => /youtube/.test(p)));
    assert.ok(report.testsRun.some((t) => /PASS \(25\)/.test(t)));
    assert.ok(report.improvementsProposed.length === 1);
    assert.ok(report.securityRisks.length === 1);
    assert.ok(report.notDoneNeedingApproval.some((n) => /wire orchestrator/.test(n)));
    const text = renderBrainWorkerCycleReport(report);
    assert.match(text, /# Atölye Brain — Overnight Report/);
    assert.match(text, /NOT done — needs your approval/);
    assert.match(text, /Next single step/);
  });

  scenario("cycle report redacts a leaked secret in a task summary", () => {
    const report = buildBrainWorkerCycleReport({
      startedAt: T0, finishedAt: T2, queueAtStart: [],
      results: [
        { taskId: "x", outcomeKind: "analysis", status: "succeeded", summary: "found OPENAI_API_KEY=sk-proj-abcdef0123456789abcdef in a scratch note", evidence: [], producedTaskIds: [], startedAt: T0, finishedAt: T1, durationMs: 1 },
      ],
      nextSingleStep: "n",
    });
    assert.ok(report.analyses.every((a) => !/sk-proj-abcdef/.test(a)));
    assert.ok(report.analyses.some((a) => /\[redacted:/.test(a)));
  });

  scenario("gpu block in the report carries peak/duration/power/cooldown/fault", () => {
    const report = buildBrainWorkerCycleReport({
      startedAt: T0, finishedAt: T2, queueAtStart: [], results: [],
      gpu: { used: true, peakCelsius: 58, durationMs: 4200, powerWatts: 68, cooldownMs: 20000, throttleOrFault: false },
      nextSingleStep: "n",
    });
    const text = renderBrainWorkerCycleReport(report);
    assert.match(text, /peak: 58 °C/);
    assert.match(text, /throttle \/ TDR \/ WHEA: none/);
  });

  console.log(`Atölye Brain worker smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "brain-worker", scenarios: count }));
}

try {
  run();
} catch (error) {
  console.error("Atölye Brain worker smoke FAILED:", error);
  process.exitCode = 1;
}
