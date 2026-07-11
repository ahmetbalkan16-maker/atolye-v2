import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { PipelineJobManager } from "../src/lib/pipeline/PipelineJobManager";
import { PipelineQueueScheduler } from "../src/lib/pipeline/PipelineQueueScheduler";
import { PipelineRecoveryPlanner } from "../src/lib/pipeline/PipelineRecoveryPlanner";
import { PipelineRunner } from "../src/lib/pipeline/PipelineRunner";
import { PipelineStageExecutor } from "../src/lib/pipeline/PipelineStageExecutor";
import type { PipelineJob, PipelineJobList } from "../src/types/pipelineJob";
import type { ProductionStepKey, ProjectPackageRunType } from "../src/types/project";

type PipelineExecutorHarness = { loadState(projectSlug: string): Promise<unknown> };
type PipelineRunnerHarness = {
  runPipelineStage(projectSlug: string, stage: ProductionStepKey, state: unknown, runType?: ProjectPackageRunType, onClaimConflict?: () => void): Promise<boolean>;
};

const slug = `sprint-89-smoke-${process.pid}`;
const projectFolder = path.join(process.cwd(), "data", "projects", slug);
const jobsFile = path.join(projectFolder, "pipeline-jobs.json");
const now = "2026-07-11T00:00:00.000Z";
const previousJob: PipelineJob = {
  id: `${slug}-research`,
  projectSlug: slug,
  stage: "research",
  title: "Research",
  status: "failed",
  attempts: 1,
  createdAt: now,
  updatedAt: now,
  completedAt: now,
  error: "failed",
};
const preparedJob: PipelineJob = {
  ...previousJob,
  status: "queued",
  attempts: 2,
  completedAt: undefined,
  error: undefined,
};
const plan = {
  projectSlug: slug,
  type: "retry" as const,
  startStage: "research" as const,
  stagesToRun: ["research" as const],
  blocked: false,
  dependencies: [],
  createdAt: now,
};

function jobList(job: PipelineJob): PipelineJobList {
  return {
    projectSlug: slug,
    jobs: [job],
    createdAt: now,
    updatedAt: now,
  };
}

async function writeJobs(job: PipelineJob) {
  await fs.mkdir(projectFolder, { recursive: true });
  await fs.writeFile(jobsFile, JSON.stringify(jobList(job), null, 2), "utf-8");
}

async function testPreparationWriteFailure() {
  await writeJobs(previousJob);
  const original = await fs.readFile(jobsFile, "utf-8");
  const originalRename = fs.rename;

  fs.rename = (async () => {
    throw new Error("injected rename failure");
  }) as typeof fs.rename;

  try {
    await assert.rejects(
      PipelineJobManager.prepareJobRetry(slug, previousJob.id),
      /injected rename failure/,
    );
  } finally {
    fs.rename = originalRename;
  }

  assert.equal(await fs.readFile(jobsFile, "utf-8"), original);
  assert.equal(
    (await fs.readdir(projectFolder)).some((file) => file.endsWith(".tmp")),
    false,
  );
}

async function testCompensationGuards() {
  await writeJobs(preparedJob);
  assert.equal(
    await PipelineJobManager.compensatePreparedRetry(
      slug,
      previousJob,
      preparedJob,
    ),
    true,
  );
  const restored = JSON.parse(
    await fs.readFile(jobsFile, "utf-8"),
  ) as PipelineJobList;
  assert.deepEqual(restored.jobs[0], previousJob);

  const originalAtomicWrite = PipelineJobManager["writeJobList"];
  let writes = 0;
  PipelineJobManager["writeJobList"] = (async (_slug, list) => {
    writes += 1;
    return list;
  }) as typeof originalAtomicWrite;

  try {
    for (const guardedJob of [
      { ...preparedJob, status: "cancelled" as const, cancelRequestedAt: now },
      { ...preparedJob, status: "running" as const },
      { ...preparedJob, attempts: preparedJob.attempts + 1 },
    ]) {
      await writeJobs(guardedJob);
      assert.equal(
        await PipelineJobManager.compensatePreparedRetry(
          slug,
          previousJob,
          preparedJob,
        ),
        false,
      );
    }
  } finally {
    PipelineJobManager["writeJobList"] = originalAtomicWrite;
  }

  assert.equal(writes, 0);
}

async function testRunnerContracts() {
  const manager = PipelineJobManager;
  const planner = PipelineRecoveryPlanner;
  const scheduler = PipelineQueueScheduler;
  const executor = PipelineStageExecutor as unknown as PipelineExecutorHarness;
  const runner = PipelineRunner as unknown as PipelineRunnerHarness;
  const originals = {
    getJobReadOnly: manager.getJobReadOnly,
    prepareJobRetry: manager.prepareJobRetry,
    compensatePreparedRetry: manager.compensatePreparedRetry,
    createJobRetryPlan: planner.createJobRetryPlan,
    getNextRunnableStage: scheduler.getNextRunnableStage,
    loadState: executor.loadState,
    runPipelineStage: runner.runPipelineStage,
  };

  manager.getJobReadOnly = async () => previousJob;
  manager.prepareJobRetry = async () => ({
    success: true,
    job: preparedJob,
    previousJob,
    jobs: jobList(preparedJob),
  });
  planner.createJobRetryPlan = async () => plan;
  executor.loadState = async () => ({});
  runner.runPipelineStage = async () => true;

  try {
    let compensated = false;
    scheduler.getNextRunnableStage = async () => ({
      stage: null,
      reason: "scheduler blocked",
    });
    manager.compensatePreparedRetry = async () => {
      compensated = true;
      return true;
    };
    const blocked = await PipelineRunner.executeJobRetry(slug, previousJob.id);
    assert.equal(blocked.status, 409);
    assert.equal(blocked.blocked, true);
    assert.equal(compensated, true);

    manager.compensatePreparedRetry = async () => {
      throw new Error("injected compensation write failure");
    };
    const failedCompensation = await PipelineRunner.executeJobRetry(
      slug,
      previousJob.id,
    );
    assert.equal(failedCompensation.status, 500);
    assert.equal(failedCompensation.blocked, false);

    scheduler.getNextRunnableStage = async () => ({ stage: "research" });
    const successful = await PipelineRunner.executeJobRetry(
      slug,
      previousJob.id,
    );
    assert.equal(successful.status, 200);
    assert.equal(successful.success, true);
  } finally {
    Object.assign(manager, {
      getJobReadOnly: originals.getJobReadOnly,
      prepareJobRetry: originals.prepareJobRetry,
      compensatePreparedRetry: originals.compensatePreparedRetry,
    });
    planner.createJobRetryPlan = originals.createJobRetryPlan;
    scheduler.getNextRunnableStage = originals.getNextRunnableStage;
    executor.loadState = originals.loadState;
    runner.runPipelineStage = originals.runPipelineStage;
  }
}

async function main() {
  try {
    await testPreparationWriteFailure();
    await testRunnerContracts();
    await testCompensationGuards();
    console.log("Sprint 89 retry persistence smoke: PASS (5 scenario groups)");
  } finally {
    await fs.rm(projectFolder, { recursive: true, force: true });
  }
}

void main();
