import assert from "node:assert/strict";
import {
  ProductionHealthEngine,
  productionHealthRules,
} from "../src/lib/production/ProductionHealthEngine";
import { pipelineRecoveryStageOrder } from "../src/lib/pipeline/PipelineRecoveryPlanner";
import type { ProductionHealthFinding } from "../src/types/productionHealth";
import type {
  ProductionSnapshot,
  ProductionSnapshotConsistencyFinding,
  ProductionSnapshotStage,
  SnapshotValue,
} from "../src/types/productionSnapshot";
import type { ProductionStepKey } from "../src/types/project";

const evaluatedAt = "2026-07-11T15:00:00.000Z";

function known<T>(value: T): SnapshotValue<T> {
  return { state: "known", value };
}

function notRecorded<T>(): SnapshotValue<T> {
  return { state: "not_recorded" };
}

function stage(stageKey: ProductionStepKey): ProductionSnapshotStage {
  return {
    stage: stageKey,
    manifestStatus: known("completed"),
    jobStatus: known("completed"),
    effectiveStatus: "completed",
    startedAt: known("2026-07-11T14:59:59.000Z"),
    completedAt: known("2026-07-11T15:00:00.000Z"),
    durationMs: known(1000),
    attempts: known(1),
    retries: known(0),
    lastRunType: known("initial"),
    dependencyReady: known(true),
    outputReady: known(true),
    latestJobId: known(`project-${stageKey}`),
    latestError: notRecorded(),
    latestUsage: notRecorded(),
    consistency: [],
  };
}

function snapshot(): ProductionSnapshot {
  const stages = pipelineRecoveryStageOrder.map(stage);
  return {
    schemaVersion: 1,
    generatedAt: evaluatedAt,
    project: {
      projectSlug: "health-project",
      projectStatus: known("completed"),
      isCompleted: known(true),
      projectUpdatedAt: known(evaluatedAt),
      manifestProjectStatus: known("completed"),
      completionConsistency: "consistent_completed",
    },
    pipeline: {
      effectiveStatus: "completed",
      completedStageCount: stages.length,
      totalStageCount: stages.length,
      failedStageCount: 0,
      cancelledStageCount: 0,
      queuedStageCount: 0,
      runningStageCount: 0,
      nextRunnableStage: notRecorded(),
      blockedStage: notRecorded(),
      isTerminal: true,
      hasActiveWork: false,
    },
    stages,
    queue: {
      derivedFrom: "jobs",
      queued: [],
      running: [],
      failed: [],
      cancelled: [],
      nextCandidate: notRecorded(),
      blockedReason: notRecorded(),
      hasConflict: false,
      multipleRunningDetected: false,
    },
    history: {
      totalTerminalEvents: 0,
      completedEvents: 0,
      failedEvents: 0,
      cancelledEvents: 0,
      latestEventAt: notRecorded(),
      averageCompletedDurationMs: notRecorded(),
      successRate: notRecorded(),
      perStageSummary: Object.fromEntries(
        pipelineRecoveryStageOrder.map((stageKey) => [
          stageKey,
          {
            stage: stageKey,
            completedEvents: 0,
            failedEvents: 0,
            cancelledEvents: 0,
            latestStatus: notRecorded(),
            latestEventAt: notRecorded(),
          },
        ]),
      ) as ProductionSnapshot["history"]["perStageSummary"],
    },
    usage: {
      totalRequests: 0,
      successfulRequests: 0,
      fallbackRequests: 0,
      failedRequests: 0,
      totalDurationMs: 0,
      providerDistribution: [],
      modelDistribution: [],
      availableInputTokens: coverage(0, 0),
      availableOutputTokens: coverage(0, 0),
      availableTotalTokens: coverage(0, 0),
      availableEstimatedCost: coverage(0, 0),
      tokenCoverage: 0,
      costCoverage: 0,
      latestUsageAt: notRecorded(),
      latestStatus: notRecorded(),
    },
    findings: [],
    sourceState: {
      project: { status: "available" },
      manifest: { status: "available" },
      jobs: { status: "available" },
      history: { status: "available" },
      aiUsage: { status: "available" },
      stageOutputs: Object.fromEntries(
        pipelineRecoveryStageOrder.map((stageKey) => [stageKey, { status: "available" }]),
      ) as ProductionSnapshot["sourceState"]["stageOutputs"],
    },
  };
}

function coverage(recorded: number, total: number) {
  return {
    value: recorded === 0 ? ({ state: "not_recorded" } as const) : known(recorded),
    recordedRecords: recorded,
    totalRecords: total,
    coverage: total === 0 ? 0 : recorded / total,
  };
}

function clone(value = snapshot()) {
  return structuredClone(value);
}

function snapshotFinding(
  severity: ProductionSnapshotConsistencyFinding["severity"],
  code: ProductionSnapshotConsistencyFinding["code"] = "usage_data_partial",
  stageKey?: ProductionStepKey,
): ProductionSnapshotConsistencyFinding {
  return {
    code,
    severity,
    scope: stageKey ? "stage" : "usage",
    ...(stageKey ? { stage: stageKey } : {}),
    sources: stageKey ? ["manifest"] : ["aiUsage"],
    message: `${severity} fixture`,
    evidence: {},
    detectedAt: evaluatedAt,
  };
}

function hasCode(result: ReturnType<typeof ProductionHealthEngine.evaluate>, code: ProductionHealthFinding["code"]) {
  return result.findings.some((finding) => finding.code === code);
}

function main() {
  const healthy = ProductionHealthEngine.evaluate(snapshot(), evaluatedAt);
  assert.equal(healthy.status, "healthy");
  assert.equal(healthy.overallSeverity, "info");

  const infoOnly = snapshot();
  infoOnly.findings = [snapshotFinding("info")];
  assert.equal(ProductionHealthEngine.evaluate(infoOnly, evaluatedAt).status, "healthy");

  const warningOnly = snapshot();
  warningOnly.findings = [snapshotFinding("warning")];
  assert.equal(ProductionHealthEngine.evaluate(warningOnly, evaluatedAt).status, "warning");

  const criticalOnly = snapshot();
  criticalOnly.findings = [snapshotFinding("critical")];
  assert.equal(ProductionHealthEngine.evaluate(criticalOnly, evaluatedAt).status, "critical");

  const projectMissing = snapshot();
  projectMissing.sourceState.project = { status: "missing" };
  const projectMissingResult = ProductionHealthEngine.evaluate(projectMissing, evaluatedAt);
  assert.equal(projectMissingResult.sourceConfidence.level, "partial");
  assert.equal(projectMissingResult.sourceConfidence.missingSourceCount, 1);

  const projectMalformed = snapshot();
  projectMalformed.sourceState.project = { status: "malformed" };
  assert.equal(ProductionHealthEngine.evaluate(projectMalformed, evaluatedAt).sourceConfidence.level, "unreliable");

  const manifestUnreadable = snapshot();
  manifestUnreadable.sourceState.manifest = { status: "unreadable" };
  assert.equal(ProductionHealthEngine.evaluate(manifestUnreadable, evaluatedAt).status, "critical");

  const historyMissing = snapshot();
  historyMissing.sourceState.history = { status: "missing" };
  assert.notEqual(ProductionHealthEngine.evaluate(historyMissing, evaluatedAt).status, "critical");

  const usageMissing = snapshot();
  usageMissing.sourceState.aiUsage = { status: "missing" };
  assert.notEqual(ProductionHealthEngine.evaluate(usageMissing, evaluatedAt).status, "critical");

  const projectWithoutExport = snapshot();
  projectWithoutExport.stages.at(-1)!.effectiveStatus = "pending";
  assert.ok(hasCode(ProductionHealthEngine.evaluate(projectWithoutExport, evaluatedAt), "project_completed_export_not_completed"));

  const exportWithoutProject = snapshot();
  exportWithoutProject.project.isCompleted = known(false);
  exportWithoutProject.project.projectStatus = known("export");
  assert.ok(hasCode(ProductionHealthEngine.evaluate(exportWithoutProject, evaluatedAt), "export_completed_project_not_completed"));

  const completedActive = snapshot();
  completedActive.pipeline.hasActiveWork = true;
  completedActive.pipeline.runningStageCount = 1;
  completedActive.queue.running = ["research"];
  assert.ok(hasCode(ProductionHealthEngine.evaluate(completedActive, evaluatedAt), "completed_project_with_active_jobs"));

  const outputMissing = snapshot();
  outputMissing.findings = [snapshotFinding("critical", "completed_stage_missing_output", "research")];
  assert.ok(hasCode(ProductionHealthEngine.evaluate(outputMissing, evaluatedAt), "completed_stage_missing_output"));

  const statusMismatch = snapshot();
  statusMismatch.findings = [snapshotFinding("warning", "manifest_job_status_mismatch", "script")];
  assert.ok(hasCode(ProductionHealthEngine.evaluate(statusMismatch, evaluatedAt), "manifest_job_status_mismatch"));

  const cancelled = snapshot();
  cancelled.stages[0].effectiveStatus = "cancelled";
  assert.ok(hasCode(ProductionHealthEngine.evaluate(cancelled, evaluatedAt), "cancelled_stage"));

  const failed = snapshot();
  failed.stages[1].effectiveStatus = "failed";
  assert.ok(hasCode(ProductionHealthEngine.evaluate(failed, evaluatedAt), "failed_stage"));

  const dependencyBlocked = snapshot();
  dependencyBlocked.stages[2].effectiveStatus = "running";
  dependencyBlocked.stages[2].dependencyReady = known(false);
  assert.ok(hasCode(ProductionHealthEngine.evaluate(dependencyBlocked, evaluatedAt), "dependency_not_ready_active_stage"));

  const multipleRunning = snapshot();
  multipleRunning.queue.running = ["research", "script"];
  multipleRunning.queue.multipleRunningDetected = true;
  multipleRunning.queue.hasConflict = true;
  multipleRunning.pipeline.runningStageCount = 2;
  assert.ok(hasCode(ProductionHealthEngine.evaluate(multipleRunning, evaluatedAt), "multiple_running_jobs"));

  const blockedQueue = snapshot();
  blockedQueue.queue.queued = ["script"];
  blockedQueue.queue.blockedReason = known('Stage "research" is failed.');
  blockedQueue.pipeline.queuedStageCount = 1;
  assert.ok(hasCode(ProductionHealthEngine.evaluate(blockedQueue, evaluatedAt), "queue_prerequisite_blocked"));

  const terminalQueued = snapshot();
  terminalQueued.pipeline.hasActiveWork = true;
  terminalQueued.pipeline.queuedStageCount = 1;
  terminalQueued.queue.queued = ["export"];
  assert.ok(hasCode(ProductionHealthEngine.evaluate(terminalQueued, evaluatedAt), "terminal_pipeline_with_active_work"));

  const historySignals = snapshot();
  historySignals.history.totalTerminalEvents = 2;
  historySignals.history.failedEvents = 1;
  historySignals.history.cancelledEvents = 1;
  historySignals.history.successRate = known(0);
  const historySignalsResult = ProductionHealthEngine.evaluate(historySignals, evaluatedAt);
  assert.ok(hasCode(historySignalsResult, "history_failed_events"));
  assert.ok(hasCode(historySignalsResult, "history_cancelled_events"));

  const lowHistory = snapshot();
  lowHistory.history.totalTerminalEvents = 4;
  lowHistory.history.completedEvents = 1;
  lowHistory.history.failedEvents = 3;
  lowHistory.history.successRate = known(0.25);
  assert.ok(hasCode(ProductionHealthEngine.evaluate(lowHistory, evaluatedAt), "history_low_success_rate"));

  const highFailures = snapshot();
  setUsage(highFailures, 4, 2, 0);
  assert.ok(hasCode(ProductionHealthEngine.evaluate(highFailures, evaluatedAt), "usage_high_failure_rate"));

  const highFallback = snapshot();
  setUsage(highFallback, 4, 0, 2);
  assert.ok(hasCode(ProductionHealthEngine.evaluate(highFallback, evaluatedAt), "usage_high_fallback_rate"));

  const allFailed = snapshot();
  setUsage(allFailed, 3, 3, 0);
  assert.equal(ProductionHealthEngine.evaluate(allFailed, evaluatedAt).status, "critical");

  const tokenPartial = snapshot();
  setUsage(tokenPartial, 2, 0, 0);
  tokenPartial.usage.tokenCoverage = 0.5;
  assert.ok(hasCode(ProductionHealthEngine.evaluate(tokenPartial, evaluatedAt), "usage_token_coverage_partial"));

  const costPartial = snapshot();
  setUsage(costPartial, 2, 0, 0);
  costPartial.usage.costCoverage = 0.5;
  assert.ok(hasCode(ProductionHealthEngine.evaluate(costPartial, evaluatedAt), "usage_cost_coverage_partial"));

  const dedupe = snapshot();
  dedupe.queue.running = ["research", "script"];
  dedupe.queue.multipleRunningDetected = true;
  dedupe.queue.hasConflict = true;
  dedupe.pipeline.runningStageCount = 2;
  dedupe.findings = [{
    code: "multiple_running_jobs",
    severity: "critical",
    scope: "queue",
    sources: ["jobs"],
    message: "Multiple running jobs were detected.",
    evidence: { runningCount: 2 },
    detectedAt: evaluatedAt,
  }];
  assert.equal(ProductionHealthEngine.evaluate(dedupe, evaluatedAt).findings.filter((item) => item.code === "multiple_running_jobs").length, 1);

  const ordered = snapshot();
  ordered.findings = [snapshotFinding("info", "usage_data_partial"), snapshotFinding("critical", "completed_stage_missing_output", "youtube"), snapshotFinding("critical", "completed_stage_missing_output", "research")];
  const orderedResult = ProductionHealthEngine.evaluate(ordered, evaluatedAt);
  assert.equal(orderedResult.findings[0].severity, "critical");
  assert.deepEqual(orderedResult.affectedStages.slice(0, 2), ["research", "youtube"]);

  const counts = orderedResult.counts;
  assert.equal(counts.total, counts.info + counts.warning + counts.critical);

  const sourceCounts = ProductionHealthEngine.evaluate(snapshot(), evaluatedAt).sourceConfidence;
  assert.deepEqual(sourceCounts, { level: "complete", availableSourceCount: 6, missingSourceCount: 0, malformedSourceCount: 0, unreadableSourceCount: 0, partialSourceCount: 0 });

  const partialSource = snapshot();
  partialSource.sourceState.history = { status: "partial" };
  assert.ok(hasCode(ProductionHealthEngine.evaluate(partialSource, evaluatedAt), "source_partial"));

  const deterministic = snapshot();
  assert.deepEqual(ProductionHealthEngine.evaluate(deterministic, evaluatedAt), ProductionHealthEngine.evaluate(deterministic, evaluatedAt));

  const mutationInput = snapshot();
  const mutationBefore = clone(mutationInput);
  ProductionHealthEngine.evaluate(mutationInput, evaluatedAt);
  assert.deepEqual(mutationInput, mutationBefore);

  assert.deepEqual(
    ProductionHealthEngine.evaluate(snapshot(), evaluatedAt, productionHealthRules),
    ProductionHealthEngine.evaluate(snapshot(), evaluatedAt, [...productionHealthRules].reverse()),
  );

  const empty = snapshot();
  empty.sourceState.project = { status: "missing" };
  empty.sourceState.manifest = { status: "missing" };
  empty.sourceState.jobs = { status: "missing" };
  empty.sourceState.history = { status: "missing" };
  empty.sourceState.aiUsage = { status: "missing" };
  for (const stageKey of pipelineRecoveryStageOrder) empty.sourceState.stageOutputs[stageKey] = { status: "missing" };
  assert.notEqual(ProductionHealthEngine.evaluate(empty, evaluatedAt).status, "healthy");

  console.log("Sprint 95.4 production health rules smoke: PASS (37 scenarios)");
}

function setUsage(value: ProductionSnapshot, requests: number, failed: number, fallback: number) {
  value.usage.totalRequests = requests;
  value.usage.successfulRequests = requests - failed;
  value.usage.failedRequests = failed;
  value.usage.fallbackRequests = fallback;
  value.usage.tokenCoverage = 1;
  value.usage.costCoverage = 1;
}

main();
