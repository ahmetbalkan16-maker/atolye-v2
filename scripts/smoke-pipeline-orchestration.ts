import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { PipelineJobManager } from "../src/lib/pipeline/PipelineJobManager";
import { getNextPipelineStage } from "../src/lib/pipeline/PipelineRecoveryPlanner";
import { ProjectWriter } from "../src/lib/projects/ProjectWriter";
import type { PipelineJob, PipelineJobList } from "../src/types/pipelineJob";
import type { ProductionStepKey } from "../src/types/project";

const slug = `sprint-93-orchestration-${process.pid}`;
const projectFolder = path.join(process.cwd(), "data", "projects", slug);
const jobsFile = path.join(projectFolder, "pipeline-jobs.json");
const historyFile = path.join(projectFolder, "pipeline-history.json");
const now = "2026-07-11T00:00:00.000Z";

function job(
  stage: ProductionStepKey,
  status: PipelineJob["status"],
  attempts = 0,
): PipelineJob {
  return {
    id: `${slug}-${stage}`,
    projectSlug: slug,
    stage,
    title: stage,
    status,
    attempts,
    createdAt: now,
    updatedAt: now,
    startedAt: status === "running" ? now : undefined,
    completedAt:
      status === "completed" || status === "failed" || status === "cancelled"
        ? now
        : undefined,
    cancelRequestedAt: status === "cancelled" ? now : undefined,
    error: status === "failed" ? "failed" : undefined,
  };
}

function jobList(jobs: PipelineJob[]): PipelineJobList {
  return {
    projectSlug: slug,
    jobs,
    createdAt: now,
    updatedAt: now,
  };
}

async function writeJobs(jobs: PipelineJob[]) {
  await fs.mkdir(projectFolder, { recursive: true });
  await fs.writeFile(
    jobsFile,
    JSON.stringify(jobList(jobs), null, 2),
    "utf-8",
  );
  await fs.rm(historyFile, { force: true });
}

async function readJobs() {
  return JSON.parse(await fs.readFile(jobsFile, "utf-8")) as PipelineJobList;
}

function jobsForStage(list: PipelineJobList, stage: ProductionStepKey) {
  return list.jobs.filter((item) => item.stage === stage);
}

async function testNextStageResolver() {
  assert.equal(getNextPipelineStage("research"), "script");
  assert.equal(getNextPipelineStage("youtube"), "export");
  assert.equal(getNextPipelineStage("export"), null);
}

async function testCompletedEnqueuesNextStage() {
  await writeJobs([job("research", "running")]);

  assert.equal(
    await PipelineJobManager.persistStageSuccess(slug, "research", async () => {}),
    true,
  );

  const stored = await readJobs();
  assert.equal(jobsForStage(stored, "research")[0].status, "completed");
  const downstream = jobsForStage(stored, "script");
  assert.equal(downstream.length, 1);
  assert.equal(downstream[0].status, "queued");
  assert.equal(downstream[0].attempts, 0);
}

async function testDuplicateCompletionDoesNotDuplicate() {
  await writeJobs([job("research", "running")]);

  assert.equal(
    await PipelineJobManager.persistStageSuccess(slug, "research", async () => {}),
    true,
  );
  assert.equal(
    await PipelineJobManager.persistStageSuccess(slug, "research", async () => {}),
    false,
  );

  const stored = await readJobs();
  assert.equal(jobsForStage(stored, "script").length, 1);
}

async function testFailureDoesNotEnqueue() {
  await writeJobs([job("research", "running")]);

  assert.equal(
    await PipelineJobManager.persistStageFailure(
      slug,
      "research",
      async () => {},
      "failed",
    ),
    true,
  );

  const stored = await readJobs();
  assert.equal(jobsForStage(stored, "research")[0].status, "failed");
  assert.equal(jobsForStage(stored, "script").length, 0);
}

async function testCancellationDoesNotEnqueue() {
  const running = job("research", "running");
  await writeJobs([running]);

  const result = await PipelineJobManager.applyAction(
    slug,
    running.id,
    "cancel",
  );
  assert.equal(result.success, true);

  const stored = await readJobs();
  assert.equal(jobsForStage(stored, "research")[0].status, "cancelled");
  assert.equal(jobsForStage(stored, "script").length, 0);
}

async function testIncompleteStageDoesNotEnqueue() {
  await writeJobs([job("research", "queued")]);
  let persistenceCalls = 0;

  assert.equal(
    await PipelineJobManager.persistStageSuccess(slug, "research", async () => {
      persistenceCalls += 1;
    }),
    false,
  );

  const stored = await readJobs();
  assert.equal(persistenceCalls, 0);
  assert.equal(jobsForStage(stored, "research")[0].status, "queued");
  assert.equal(jobsForStage(stored, "script").length, 0);
}

async function testFinalStageDoesNotEnqueue() {
  await writeJobs([job("export", "running")]);

  assert.equal(
    await PipelineJobManager.persistStageSuccess(slug, "export", async () => {}),
    true,
  );

  const stored = await readJobs();
  assert.equal(stored.jobs.length, 1);
  assert.equal(stored.jobs[0].stage, "export");
  assert.equal(stored.jobs[0].status, "completed");
}

async function testExistingActiveDownstreamDoesNotDuplicate() {
  for (const status of ["queued", "running"] as const) {
    const downstream = job("script", status);
    await writeJobs([job("research", "running"), downstream]);

    assert.equal(
      await PipelineJobManager.persistStageSuccess(
        slug,
        "research",
        async () => {},
      ),
      true,
    );

    const stored = await readJobs();
    const downstreamJobs = jobsForStage(stored, "script");
    assert.equal(downstreamJobs.length, 1);
    assert.deepEqual(
      downstreamJobs[0],
      JSON.parse(JSON.stringify(downstream)) as PipelineJob,
    );
  }
}

async function testRetryCompletionDoesNotMultiplyDownstream() {
  const downstream = job("script", "queued");
  await writeJobs([job("research", "running", 2), downstream]);

  assert.equal(
    await PipelineJobManager.persistStageSuccess(slug, "research", async () => {}),
    true,
  );
  assert.equal(
    await PipelineJobManager.persistStageSuccess(slug, "research", async () => {}),
    false,
  );

  const stored = await readJobs();
  assert.equal(jobsForStage(stored, "research")[0].attempts, 2);
  assert.equal(jobsForStage(stored, "script").length, 1);
  assert.deepEqual(
    jobsForStage(stored, "script")[0],
    JSON.parse(JSON.stringify(downstream)) as PipelineJob,
  );
}

async function testHistoryWriteFailureKeepsOrchestrationPersistence() {
  await writeJobs([job("research", "running")]);
  const originalWriteJSONAtomically = ProjectWriter.writeJSONAtomically;
  const historyWriteError = new Error(
    "Injected pipeline history persistence failure.",
  );

  ProjectWriter.writeJSONAtomically = async (
    projectSlug,
    fileName,
    data,
  ) => {
    if (fileName === "pipeline-history.json") {
      throw historyWriteError;
    }

    return originalWriteJSONAtomically.call(
      ProjectWriter,
      projectSlug,
      fileName,
      data,
    );
  };

  try {
    await assert.rejects(
      PipelineJobManager.persistStageSuccess(
        slug,
        "research",
        async () => {},
      ),
      (error) => error === historyWriteError,
      "History persistence should propagate the exact injected error.",
    );
  } finally {
    ProjectWriter.writeJSONAtomically = originalWriteJSONAtomically;
  }

  const stored = await readJobs();
  assert.equal(
    jobsForStage(stored, "research")[0].status,
    "completed",
    "Completed source state should remain persisted after history failure.",
  );
  const downstream = jobsForStage(stored, "script");
  assert.equal(
    downstream.length,
    1,
    "History failure should not roll back or duplicate the downstream job.",
  );
  assert.equal(
    downstream[0].status,
    "queued",
    "Persisted downstream job should remain queued.",
  );
  await assert.rejects(
    fs.access(historyFile),
    "Failed history persistence should not create a history file.",
  );
}

async function testConcurrentCompletionIsIdempotent() {
  await writeJobs([job("research", "running")]);

  const results = await Promise.all([
    PipelineJobManager.persistStageSuccess(slug, "research", async () => {}),
    PipelineJobManager.persistStageSuccess(slug, "research", async () => {}),
  ]);

  assert.deepEqual(
    [...results].sort(),
    [false, true],
    "Concurrent completion should allow exactly one real transition.",
  );

  const stored = await readJobs();
  assert.equal(
    jobsForStage(stored, "research")[0].status,
    "completed",
    "Concurrent completion should persist the source as completed.",
  );
  const downstream = jobsForStage(stored, "script");
  assert.equal(
    downstream.length,
    1,
    "Concurrent completion should create exactly one downstream job.",
  );
  assert.equal(
    downstream[0].status,
    "queued",
    "Concurrent completion should leave the downstream job queued.",
  );
}

async function main() {
  try {
    await testNextStageResolver();
    await testCompletedEnqueuesNextStage();
    await testDuplicateCompletionDoesNotDuplicate();
    await testFailureDoesNotEnqueue();
    await testCancellationDoesNotEnqueue();
    await testIncompleteStageDoesNotEnqueue();
    await testFinalStageDoesNotEnqueue();
    await testExistingActiveDownstreamDoesNotDuplicate();
    await testRetryCompletionDoesNotMultiplyDownstream();
    await testHistoryWriteFailureKeepsOrchestrationPersistence();
    await testConcurrentCompletionIsIdempotent();
    console.log("Sprint 93 pipeline orchestration smoke: PASS (10 scenarios)");
  } finally {
    await fs.rm(projectFolder, { recursive: true, force: true });
  }
}

void main();
