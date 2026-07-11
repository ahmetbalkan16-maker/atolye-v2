import assert from "node:assert/strict";
import {
  calculateCoverage,
  createCanonicalStageOrder,
  createSourceState,
  resolveEffectiveStageStatus,
  resolveProjectCompletionConsistency,
} from "../src/lib/production/ProductionSnapshotContract";
import { pipelineRecoveryStageOrder } from "../src/lib/pipeline/PipelineRecoveryPlanner";
import type {
  ProductionSnapshotConsistencyFinding,
  ProductionSnapshotQueue,
  ProductionSnapshotStage,
  SnapshotValue,
} from "../src/types/productionSnapshot";

const detectedAt = "2026-07-11T00:00:00.000Z";

function notRecorded<T>(): SnapshotValue<T> {
  return { state: "not_recorded" };
}

function stageFixture(
  overrides: Partial<ProductionSnapshotStage> = {},
): ProductionSnapshotStage {
  return {
    stage: "research",
    manifestStatus: { state: "known", value: "pending" },
    jobStatus: notRecorded(),
    effectiveStatus: "pending",
    startedAt: notRecorded(),
    completedAt: notRecorded(),
    durationMs: notRecorded(),
    attempts: { state: "known", value: 0 },
    retries: { state: "known", value: 0 },
    lastRunType: notRecorded(),
    dependencyReady: { state: "known", value: true },
    outputReady: { state: "known", value: false },
    latestJobId: notRecorded(),
    latestError: notRecorded(),
    latestUsage: notRecorded(),
    consistency: [],
    ...overrides,
  };
}

function main() {
  assert.equal(
    resolveProjectCompletionConsistency("completed", "completed"),
    "consistent_completed",
  );

  assert.equal(
    resolveProjectCompletionConsistency("export", "completed"),
    "project_incomplete_manifest_completed",
  );

  assert.equal(
    resolveEffectiveStageStatus({
      manifestStatus: "completed",
      jobStatus: "completed",
      outputReady: true,
    }),
    "completed",
  );

  const missingOutputFinding: ProductionSnapshotConsistencyFinding = {
    code: "completed_stage_missing_output",
    severity: "critical",
    scope: "stage",
    stage: "research",
    sources: ["manifest", "stageOutputs"],
    message: "Completed stage output is missing.",
    evidence: { manifestStatus: "completed", outputReady: false },
    detectedAt,
  };
  assert.equal(
    resolveEffectiveStageStatus({
      manifestStatus: "completed",
      jobStatus: "completed",
      outputReady: false,
    }),
    "inconsistent",
  );
  assert.equal(missingOutputFinding.code, "completed_stage_missing_output");

  assert.equal(
    resolveEffectiveStageStatus({
      manifestStatus: "completed",
      jobStatus: "running",
      outputReady: true,
    }),
    "inconsistent",
  );

  assert.equal(
    resolveEffectiveStageStatus({
      manifestStatus: "completed",
      jobStatus: "cancelled",
      outputReady: true,
    }),
    "cancelled",
  );

  const missingJobsState = createSourceState("missing", {
    detail: "pipeline-jobs.json is absent.",
  });
  const partialQueue: ProductionSnapshotQueue = {
    derivedFrom: "jobs",
    queued: [],
    running: [],
    failed: [],
    cancelled: [],
    nextCandidate: { state: "source_missing" },
    blockedReason: { state: "source_missing" },
    hasConflict: false,
    multipleRunningDetected: false,
  };
  assert.equal(missingJobsState.status, "missing");
  assert.equal(partialQueue.nextCandidate.state, "source_missing");

  const malformedHistoryState = createSourceState("malformed");
  assert.deepEqual(malformedHistoryState, { status: "malformed" });

  const absentTokens = calculateCoverage([undefined, undefined]);
  assert.equal(absentTokens.value.state, "not_recorded");
  assert.equal(absentTokens.coverage, 0);

  const partialTokens = calculateCoverage([10, undefined, 0, 5]);
  assert.deepEqual(partialTokens, {
    value: { state: "known", value: 15 },
    recordedRecords: 3,
    totalRecords: 4,
    coverage: 0.75,
  });

  const multipleRunningFinding: ProductionSnapshotConsistencyFinding = {
    code: "multiple_running_jobs",
    severity: "critical",
    scope: "queue",
    sources: ["jobs"],
    message: "Multiple running jobs were detected.",
    evidence: { runningCount: 2 },
    detectedAt,
  };
  assert.equal(multipleRunningFinding.evidence.runningCount, 2);

  assert.deepEqual(createCanonicalStageOrder(), pipelineRecoveryStageOrder);

  const mutableInput = {
    manifestStatus: "completed" as const,
    jobStatus: "completed" as const,
    outputReady: true as const,
  };
  const before = structuredClone(mutableInput);
  resolveEffectiveStageStatus(mutableInput);
  assert.deepEqual(mutableInput, before);

  const deterministicInput = [4, undefined, 6] as const;
  assert.deepEqual(
    calculateCoverage(deterministicInput),
    calculateCoverage(deterministicInput),
  );

  const zeroIsKnown = calculateCoverage([0]);
  assert.deepEqual(zeroIsKnown.value, { state: "known", value: 0 });

  const inconsistentStage = stageFixture({
    manifestStatus: { state: "known", value: "completed" },
    jobStatus: { state: "known", value: "running" },
    effectiveStatus: "inconsistent",
    outputReady: { state: "known", value: true },
    consistency: [
      {
        code: "manifest_job_status_mismatch",
        severity: "warning",
        scope: "stage",
        stage: "research",
        sources: ["manifest", "jobs"],
        message: "Manifest and job status disagree.",
        evidence: { manifestStatus: "completed", jobStatus: "running" },
        detectedAt,
      },
    ],
  });
  assert.equal(inconsistentStage.consistency.length, 1);

  console.log("Sprint 95.2 production snapshot contract smoke: PASS (16 scenarios)");
}

main();
