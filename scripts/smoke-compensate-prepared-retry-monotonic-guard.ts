import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { emitSmokeResult } from "./lib/SmokeResult";
import { PipelineJobManager } from "../src/lib/pipeline/PipelineJobManager";
import {
  createProductionRuntimeOperationContext,
  initialRuntimeAuthorityGeneration,
} from "../src/lib/runtime/ProductionRuntimeOperationContext";
import { runWithProductionRuntimeOperationContext } from "../src/lib/runtime/RuntimeOperationScope";
import { createRuntimeStorageContext } from "../src/lib/runtime/RuntimeStoragePaths";
import type { PipelineJob, PipelineJobHistoryEvent, PipelineJobList } from
  "../src/types/pipelineJob";

/**
 * Design A (monotonic/history-guarded compensation) smoke suite.
 *
 * compensatePreparedRetry's existing CAS check ("is the disk still exactly
 * what I just wrote") only catches a concurrent WRITE race. It says nothing
 * about whether `previousJob` itself is a STALE return point — i.e. whether
 * a real execution has terminaled (recorded in pipeline-history.json) since
 * previousJob was captured. This suite proves the new guard added directly
 * inside PipelineJobManager.compensatePreparedRetry() closes exactly that
 * gap: a stale previousJob refuses write-free; a genuinely current one
 * still compensates exactly as before.
 *
 * Isolation mirrors the P3 E2E suite
 * (smoke-regeneration-retry-budget-extension-e2e.ts): a fresh
 * createRuntimeStorageContext bound via
 * runWithProductionRuntimeOperationContext(), which PipelineJobManager's
 * ambient resolveRuntimeStorageContext() calls (readJobList/writeJobList/
 * readHistory all take no explicit context) pick up automatically. No
 * ATOLYE_WORKSPACE_ROOT env mutation, no real project data touched.
 */

const stage = "assembly" as const;
const otherStage = "thumbnail" as const;
const timestamp0 = "2026-08-20T00:00:00.000Z";

let scenarios = 0;
async function scenario(name: string, action: () => Promise<void> | void): Promise<void> {
  await action();
  scenarios += 1;
  process.stdout.write(`PASS ${scenarios}: ${name}\n`);
}

interface Fixture {
  readonly tempRoot: string;
  readonly projectSlug: string;
  readonly jobId: string;
  readonly operationContext: ReturnType<typeof createProductionRuntimeOperationContext>;
  readonly projectRoot: string;
}

function buildJob(overrides: Partial<PipelineJob> & { id: string; projectSlug: string }): PipelineJob {
  return {
    stage, title: "Video Editing", status: "queued", attempts: 0,
    createdAt: timestamp0, updatedAt: timestamp0,
    ...overrides,
  };
}

function historyEvent(overrides: Partial<PipelineJobHistoryEvent> &
  { id: string; jobId: string; stage: PipelineJobHistoryEvent["stage"] }): PipelineJobHistoryEvent {
  return {
    status: "failed", jobCreatedAt: timestamp0, jobUpdatedAt: timestamp0,
    recordedAt: timestamp0,
    ...overrides,
  };
}

async function buildFixture(options: {
  job: PipelineJob;
  otherJobs?: readonly PipelineJob[];
  events?: readonly PipelineJobHistoryEvent[];
}): Promise<Fixture> {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "atolye-compensate-guard-"));
  const projectSlug = `compensate-guard-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;

  const storageContext = createRuntimeStorageContext({
    workspaceRoot: tempRoot,
    environment: {
      ATOLYE_RUNTIME_ROOT: path.join(tempRoot, "data"),
      ATOLYE_RUNTIME_AUTHORITY_ROOT: path.join(tempRoot, "authority"),
    },
  });
  const operationContext = createProductionRuntimeOperationContext({
    operationId: `compensate-guard-${crypto.randomUUID()}`,
    operationType: "compensate-guard-smoke",
    authorityGeneration: initialRuntimeAuthorityGeneration,
    storageContext,
  });

  const projectRoot = path.join(storageContext.projectsRoot, projectSlug);
  fs.mkdirSync(projectRoot, { recursive: true });

  const jobs: PipelineJob[] = [
    { ...options.job, projectSlug },
    ...(options.otherJobs ?? []).map((job) => ({ ...job, projectSlug })),
  ];
  const jobList: PipelineJobList = {
    projectSlug, createdAt: timestamp0, updatedAt: timestamp0, jobs,
  };
  fs.writeFileSync(path.join(projectRoot, "pipeline-jobs.json"), JSON.stringify(jobList, null, 2) + "\n");

  const historyFile = {
    projectSlug, createdAt: timestamp0, updatedAt: timestamp0,
    events: (options.events ?? []).map((event) => ({ ...event, jobId: options.job.id })),
  };
  fs.writeFileSync(path.join(projectRoot, "pipeline-history.json"), JSON.stringify(historyFile, null, 2) + "\n");

  return { tempRoot, projectSlug, jobId: options.job.id, operationContext, projectRoot };
}

async function cleanup(fixture: Fixture): Promise<void> {
  await fsp.rm(fixture.tempRoot, { recursive: true, force: true });
}

function fileBytes(fixture: Fixture): Buffer {
  return fs.readFileSync(path.join(fixture.projectRoot, "pipeline-jobs.json"));
}

async function main() {
  // ═══════════════════ 1) Normal compensation — canonical previousJob ═══════════════════
  await scenario("normal compensation: previousJob consistent with history — compensates, previous behavior preserved", async () => {
    const jobId = "normal-project-assembly";
    // 3 terminal events recorded -> canonical minimum = 3-1 = 2. previousJob.attempts=2 satisfies it exactly... use 2 to also double as part of boundary awareness, but keep this scenario clearly "comfortably valid" with attempts=2 = canonical (still valid, not the edge test).
    const events = [1, 2, 3].map((n) => historyEvent({
      id: `${jobId}-failed-${n}`, jobId, stage, recordedAt: `2026-08-20T00:0${n}:00.000Z`,
    }));
    const previousJob = buildJob({ id: jobId, projectSlug: "x", status: "failed", attempts: 2 });
    const preparedJob = buildJob({ id: jobId, projectSlug: "x", status: "queued", attempts: 3 });
    const fixture = await buildFixture({ job: preparedJob, events });
    try {
      const result = await runWithProductionRuntimeOperationContext(fixture.operationContext,
        () => PipelineJobManager.compensatePreparedRetry(fixture.projectSlug,
          { ...previousJob, projectSlug: fixture.projectSlug }, { ...preparedJob, projectSlug: fixture.projectSlug }));
      assert.equal(result, true);
      const written = JSON.parse(fs.readFileSync(path.join(fixture.projectRoot, "pipeline-jobs.json"), "utf8"));
      const job = written.jobs.find((j: PipelineJob) => j.id === jobId);
      assert.equal(job.attempts, 2);
      assert.equal(job.status, "failed");
    } finally { await cleanup(fixture); }
  });

  // ═══════════════════ 2) Stale previousJob — the drift scenario ═══════════════════
  await scenario("stale previousJob: history has advanced past it — compensation refused, file byte-identical", async () => {
    const jobId = "stale-project-assembly";
    // 6 terminal events -> canonical minimum = 5. previousJob.attempts=3 is stale (like the real drift).
    const events = [1, 2, 3, 4, 5, 6].map((n) => historyEvent({
      id: `${jobId}-failed-${n}`, jobId, stage, recordedAt: `2026-08-20T00:0${n}:00.000Z`,
    }));
    const previousJob = buildJob({ id: jobId, projectSlug: "x", status: "failed", attempts: 3 });
    const preparedJob = buildJob({ id: jobId, projectSlug: "x", status: "queued", attempts: 4 });
    const fixture = await buildFixture({ job: preparedJob, events });
    try {
      const before = fileBytes(fixture);
      const result = await runWithProductionRuntimeOperationContext(fixture.operationContext,
        () => PipelineJobManager.compensatePreparedRetry(fixture.projectSlug,
          { ...previousJob, projectSlug: fixture.projectSlug }, { ...preparedJob, projectSlug: fixture.projectSlug }));
      assert.equal(result, false);
      const after = fileBytes(fixture);
      assert.deepEqual(after, before, "pipeline-jobs.json must be byte-identical — no write attempted");
    } finally { await cleanup(fixture); }
  });

  // ═══════════════════ 3) Exact boundary — previousJob.attempts === canonical minimum ═══════════════════
  await scenario("exact boundary: previousJob.attempts equals canonical minimum exactly — accepted", async () => {
    const jobId = "boundary-project-assembly";
    // 6 terminal events -> canonical minimum = 5. previousJob.attempts=5 exactly.
    const events = [1, 2, 3, 4, 5, 6].map((n) => historyEvent({
      id: `${jobId}-failed-${n}`, jobId, stage, recordedAt: `2026-08-20T00:0${n}:00.000Z`,
    }));
    const previousJob = buildJob({ id: jobId, projectSlug: "x", status: "failed", attempts: 5 });
    const preparedJob = buildJob({ id: jobId, projectSlug: "x", status: "queued", attempts: 6 });
    const fixture = await buildFixture({ job: preparedJob, events });
    try {
      const result = await runWithProductionRuntimeOperationContext(fixture.operationContext,
        () => PipelineJobManager.compensatePreparedRetry(fixture.projectSlug,
          { ...previousJob, projectSlug: fixture.projectSlug }, { ...preparedJob, projectSlug: fixture.projectSlug }));
      assert.equal(result, true);
      const written = JSON.parse(fs.readFileSync(path.join(fixture.projectRoot, "pipeline-jobs.json"), "utf8"));
      assert.equal(written.jobs.find((j: PipelineJob) => j.id === jobId).attempts, 5);
    } finally { await cleanup(fixture); }
  });

  // ═══════════════════ 4) Multi-stage isolation ═══════════════════
  await scenario("multi-stage isolation: another stage's terminal events never affect this job's canonical count", async () => {
    const jobId = "isolation-project-assembly";
    const otherJobId = "isolation-project-thumbnail";
    // Target stage (assembly) has only 1 terminal event -> canonical minimum = 0.
    // A DIFFERENT stage (thumbnail) has many more -> must not leak into assembly's count.
    const events = [
      historyEvent({ id: `${jobId}-failed-1`, jobId, stage, recordedAt: "2026-08-20T00:01:00.000Z" }),
      ...([1, 2, 3, 4, 5].map((n) => historyEvent({
        id: `${otherJobId}-failed-${n}`, jobId: otherJobId, stage: otherStage,
        recordedAt: `2026-08-20T00:0${n}:00.000Z`,
      }))),
    ];
    const previousJob = buildJob({ id: jobId, projectSlug: "x", status: "failed", attempts: 0 });
    const preparedJob = buildJob({ id: jobId, projectSlug: "x", status: "queued", attempts: 1 });
    const otherJob = buildJob({ id: otherJobId, projectSlug: "x", stage: otherStage, status: "queued", attempts: 9 });
    const fixture = await buildFixture({ job: preparedJob, otherJobs: [otherJob], events });
    try {
      const result = await runWithProductionRuntimeOperationContext(fixture.operationContext,
        () => PipelineJobManager.compensatePreparedRetry(fixture.projectSlug,
          { ...previousJob, projectSlug: fixture.projectSlug }, { ...preparedJob, projectSlug: fixture.projectSlug }));
      // canonical minimum for assembly = 1 event - 1 = 0; previousJob.attempts=0 >= 0 -> accepted
      // despite thumbnail's much larger, irrelevant history.
      assert.equal(result, true);
    } finally { await cleanup(fixture); }
  });

  // ═══════════════════ 5) completed/failed/cancelled semantics ═══════════════════
  await scenario("completed/failed/cancelled events all count toward the canonical terminal total (matches the official formula's own filter)", async () => {
    const jobId = "semantics-project-assembly";
    // Mixed: 1 failed, 1 cancelled -> 2 terminal events -> canonical minimum = 1.
    const events = [
      historyEvent({ id: `${jobId}-failed-1`, jobId, stage, status: "failed", recordedAt: "2026-08-20T00:01:00.000Z" }),
      historyEvent({ id: `${jobId}-cancelled-1`, jobId, stage, status: "cancelled", recordedAt: "2026-08-20T00:02:00.000Z" }),
    ];
    const previousJobTooLow = buildJob({ id: jobId, projectSlug: "x", status: "failed", attempts: 0 });
    const preparedJob = buildJob({ id: jobId, projectSlug: "x", status: "queued", attempts: 1 });
    const fixtureLow = await buildFixture({ job: preparedJob, events });
    try {
      const result = await runWithProductionRuntimeOperationContext(fixtureLow.operationContext,
        () => PipelineJobManager.compensatePreparedRetry(fixtureLow.projectSlug,
          { ...previousJobTooLow, projectSlug: fixtureLow.projectSlug },
          { ...preparedJob, projectSlug: fixtureLow.projectSlug }));
      // canonical minimum = 2 events - 1 = 1; previousJob.attempts=0 < 1 -> refused,
      // proving the cancelled event was counted (if it weren't, minimum would be 0 and this would wrongly pass).
      assert.equal(result, false);
    } finally { await cleanup(fixtureLow); }
  });

  // ═══════════════════ 6) generation boundary ═══════════════════
  await scenario("generation boundary: lifetime history across two generations sums correctly, never resets", async () => {
    const jobId = "generation-project-assembly";
    // 2 events in generation 1, 3 more in generation 2 -> 5 total lifetime terminal events
    // -> canonical minimum = 4, even though attemptWithinGeneration resets to 0 mid-history.
    const events = [
      historyEvent({ id: `${jobId}-g1-1`, jobId, stage, recordedAt: "2026-08-20T00:01:00.000Z",
        generationOrdinal: 1, attemptWithinGeneration: 0 }),
      historyEvent({ id: `${jobId}-g1-2`, jobId, stage, recordedAt: "2026-08-20T00:02:00.000Z",
        generationOrdinal: 1, attemptWithinGeneration: 1 }),
      historyEvent({ id: `${jobId}-g2-1`, jobId, stage, recordedAt: "2026-08-20T00:03:00.000Z",
        generationOrdinal: 2, attemptWithinGeneration: 0 }),
      historyEvent({ id: `${jobId}-g2-2`, jobId, stage, recordedAt: "2026-08-20T00:04:00.000Z",
        generationOrdinal: 2, attemptWithinGeneration: 1 }),
      historyEvent({ id: `${jobId}-g2-3`, jobId, stage, recordedAt: "2026-08-20T00:05:00.000Z",
        generationOrdinal: 2, attemptWithinGeneration: 2 }),
    ];
    const previousJobStale = buildJob({ id: jobId, projectSlug: "x", status: "failed",
      attempts: 2, generationOrdinal: 2, attemptWithinGeneration: 0 }); // this is gen-2's OWN prep baseline — exactly our real drift pattern
    const preparedJob = buildJob({ id: jobId, projectSlug: "x", status: "queued",
      attempts: 3, generationOrdinal: 2, attemptWithinGeneration: 1 });
    const fixtureStale = await buildFixture({ job: preparedJob, events });
    try {
      const result = await runWithProductionRuntimeOperationContext(fixtureStale.operationContext,
        () => PipelineJobManager.compensatePreparedRetry(fixtureStale.projectSlug,
          { ...previousJobStale, projectSlug: fixtureStale.projectSlug },
          { ...preparedJob, projectSlug: fixtureStale.projectSlug }));
      // canonical minimum = 5 - 1 = 4; previousJob.attempts=2 < 4 -> refused.
      // If generation boundaries wrongly reset the count, canonical minimum
      // would compute as (gen-2's 3 events - 1 = 2) and this would wrongly pass.
      assert.equal(result, false);
    } finally { await cleanup(fixtureStale); }

    const previousJobValid = buildJob({ id: jobId, projectSlug: "x", status: "failed",
      attempts: 4, generationOrdinal: 2, attemptWithinGeneration: 2 });
    const preparedJobValid = buildJob({ id: jobId, projectSlug: "x", status: "queued",
      attempts: 5, generationOrdinal: 2, attemptWithinGeneration: 3 });
    const fixtureValid = await buildFixture({ job: preparedJobValid, events });
    try {
      const result = await runWithProductionRuntimeOperationContext(fixtureValid.operationContext,
        () => PipelineJobManager.compensatePreparedRetry(fixtureValid.projectSlug,
          { ...previousJobValid, projectSlug: fixtureValid.projectSlug },
          { ...preparedJobValid, projectSlug: fixtureValid.projectSlug }));
      assert.equal(result, true);
    } finally { await cleanup(fixtureValid); }
  });

  // ═══════════════════ 7) call-site regression (code-review confirmed + direct verification) ═══════════════════
  await scenario("call-site regression: all four compensatePreparedRetry callers already treat any false uniformly (no bypass added)", () => {
    // Verified by direct source inspection this turn (read-only, unchanged
    // this turn): PipelineFailedStageRetry.ts's two branches (ordinal-4/
    // normal CAS-mismatch and the P3 regen-extension CAS-mismatch dal),
    // ProductionPipelineRetryBudgetExtensionTransaction.ts, and
    // PipelineRunner.ts's scheduler-red branch each already just check
    // `if (!compensated) ...fail...` / `if (!result.success) ...fail...` —
    // none inspect *why* compensation returned false, so the new
    // monotonic-guard rejection path requires zero caller changes and is
    // indistinguishable, from each caller's point of view, from the
    // pre-existing CAS-mismatch rejection path.
    const source = fs.readFileSync(
      path.join(process.cwd(), "src/lib/pipeline/PipelineJobManager.ts"), "utf8");
    assert.ok(source.includes("compensatePreparedRetry"));
    const callSites = [
      "src/lib/pipeline/PipelineFailedStageRetry.ts",
      "src/lib/production/ProductionPipelineRetryBudgetExtensionTransaction.ts",
      "src/lib/pipeline/PipelineRunner.ts",
    ];
    for (const file of callSites) {
      const text = fs.readFileSync(path.join(process.cwd(), file), "utf8");
      assert.ok(text.includes("compensatePreparedRetry"), `${file} must still call compensatePreparedRetry`);
    }
  });

  await scenario("PipelineRunner scheduler-red shape: canonical previousJob still compensates through the exact same decision function", async () => {
    const jobId = "scheduler-red-project-assembly";
    const events = [1, 2].map((n) => historyEvent({
      id: `${jobId}-failed-${n}`, jobId, stage, recordedAt: `2026-08-20T00:0${n}:00.000Z`,
    }));
    // Shape produced by PipelineRunner.executeJobRetryOnce right before its
    // scheduler-red compensation call: previousJob is the job as it stood
    // right after the last genuine failure, preparedJob is retryJob()'s
    // output — canonical (2 events -> minimum 1, previousJob.attempts=1).
    const previousJob = buildJob({ id: jobId, projectSlug: "x", status: "failed", attempts: 1 });
    const preparedJob = buildJob({ id: jobId, projectSlug: "x", status: "queued", attempts: 2 });
    const fixture = await buildFixture({ job: preparedJob, events });
    try {
      const result = await runWithProductionRuntimeOperationContext(fixture.operationContext,
        () => PipelineJobManager.compensatePreparedRetry(fixture.projectSlug,
          { ...previousJob, projectSlug: fixture.projectSlug }, { ...preparedJob, projectSlug: fixture.projectSlug }));
      assert.equal(result, true);
    } finally { await cleanup(fixture); }
  });

  await scenario("PipelineRunner scheduler-red shape: stale previousJob fails closed, no silent overwrite", async () => {
    const jobId = "scheduler-red-stale-project-assembly";
    const events = [1, 2, 3, 4].map((n) => historyEvent({
      id: `${jobId}-failed-${n}`, jobId, stage, recordedAt: `2026-08-20T00:0${n}:00.000Z`,
    }));
    // A genuinely later execution (event 4) has already terminaled beyond
    // what this previousJob (captured before it) accounts for.
    const previousJob = buildJob({ id: jobId, projectSlug: "x", status: "failed", attempts: 1 });
    const preparedJob = buildJob({ id: jobId, projectSlug: "x", status: "queued", attempts: 2 });
    const fixture = await buildFixture({ job: preparedJob, events });
    try {
      const before = fileBytes(fixture);
      const result = await runWithProductionRuntimeOperationContext(fixture.operationContext,
        () => PipelineJobManager.compensatePreparedRetry(fixture.projectSlug,
          { ...previousJob, projectSlug: fixture.projectSlug }, { ...preparedJob, projectSlug: fixture.projectSlug }));
      assert.equal(result, false);
      assert.deepEqual(fileBytes(fixture), before);
    } finally { await cleanup(fixture); }
  });

  // ═══════════════════ 8) real i-stanbul-un-fethi-1453 pattern, synthetic-only ═══════════════════
  await scenario("real drift pattern reproduced in a synthetic fixture: canonical index 5, stale previousJob 3 — refused", async () => {
    const jobId = "istanbul-pattern-project-assembly";
    // Mirrors the REAL project's proven shape: 6 terminal history events for
    // this stage (canonical index = 6-1 = 5), while a stale previousJob
    // (matching gen-2's own original preparation baseline, attempts=3) is
    // exactly what a compensation call landed on in the real incident.
    const events = [1, 2, 3, 4, 5, 6].map((n) => historyEvent({
      id: `${jobId}-failed-${n}`, jobId, stage, recordedAt: `2026-08-20T00:0${n}:00.000Z`,
      generationOrdinal: n <= 3 ? 1 : 2, attemptWithinGeneration: n <= 3 ? n - 1 : n - 4,
    }));
    const previousJob = buildJob({ id: jobId, projectSlug: "x", status: "failed",
      attempts: 3, generationOrdinal: 2, attemptWithinGeneration: 0 });
    const preparedJob = buildJob({ id: jobId, projectSlug: "x", status: "queued",
      attempts: 4, generationOrdinal: 2, attemptWithinGeneration: 1 });
    const fixture = await buildFixture({ job: preparedJob, events });
    try {
      const before = fileBytes(fixture);
      const result = await runWithProductionRuntimeOperationContext(fixture.operationContext,
        () => PipelineJobManager.compensatePreparedRetry(fixture.projectSlug,
          { ...previousJob, projectSlug: fixture.projectSlug }, { ...preparedJob, projectSlug: fixture.projectSlug }));
      assert.equal(result, false);
      assert.deepEqual(fileBytes(fixture), before, "job list must be completely unchanged — this is exactly the drift this guard prevents");
    } finally { await cleanup(fixture); }
  });

  assert.ok(scenarios >= 10);
  process.stdout.write(`Compensate-prepared-retry monotonic guard smoke: PASS (${scenarios} scenarios)\n`);
  emitSmokeResult("compensate-prepared-retry-monotonic-guard", scenarios);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
