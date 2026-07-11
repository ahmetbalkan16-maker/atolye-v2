import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { ProjectManager } from "../src/lib/projects/ProjectManager";
import { PipelineJobManager } from "../src/lib/pipeline/PipelineJobManager";
import { PipelineQueueScheduler } from "../src/lib/pipeline/PipelineQueueScheduler";
import {
  PipelineRecoveryPlanner,
} from "../src/lib/pipeline/PipelineRecoveryPlanner";
import { PipelineRunner } from "../src/lib/pipeline/PipelineRunner";
import { PipelineStageExecutor } from "../src/lib/pipeline/PipelineStageExecutor";
import { PipelineStateError } from "../src/lib/pipeline/PipelineStateError";
import type { PipelineJob, PipelineJobList } from "../src/types/pipelineJob";
import type { ProductionStepKey, ProjectPackageRunType, ProjectStatus } from "../src/types/project";

type PipelineExecutorHarness = { loadState(projectSlug: string): Promise<unknown> };
type PipelineRunnerHarness = {
  runPipelineStage(projectSlug: string, stage: ProductionStepKey, state: unknown, runType?: ProjectPackageRunType, onClaimConflict?: () => void): Promise<boolean>;
  runStage(projectSlug: string, stage: ProductionStepKey, action: () => Promise<boolean>, runType: ProjectPackageRunType, onClaimConflict?: () => void): Promise<boolean>;
};

const slug = `sprint-94-continuation-${process.pid}`;
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

async function readHistory() {
  return JSON.parse(await fs.readFile(historyFile, "utf-8")) as {
    events: Array<{ stage: ProductionStepKey; status: string }>;
  };
}

function jobsForStage(list: PipelineJobList, stage: ProductionStepKey) {
  return list.jobs.filter((item) => item.stage === stage);
}

async function main() {
  const scheduler = PipelineQueueScheduler;
  const planner = PipelineRecoveryPlanner;
  const executor = PipelineStageExecutor as unknown as PipelineExecutorHarness;
  const runner = PipelineRunner as unknown as PipelineRunnerHarness;
  const projectManager = ProjectManager;
  const originals = {
    getNextRunnableStage: scheduler.getNextRunnableStage,
    createJobRetryPlan: planner.createJobRetryPlan,
    loadState: executor.loadState,
    runPipelineStage: runner.runPipelineStage,
    updateStatus: projectManager.updateStatus,
  };
  let dependencyBlocked = false;
  let forceSchedulerConflict = false;
  let failedExecutionStage: ProductionStepKey | null = null;
  let cancelledExecutionStage: ProductionStepKey | null = null;
  let forceClaimConflict = false;
  let schedulerErrorAfterCall: { call: number; error: unknown } | null = null;
  let loadStateErrorAfterCall: { call: number; error: unknown } | null = null;
  let schedulerCalls = 0;
  let loadStateCalls = 0;
  let failProjectCompletion = false;
  const executedStages: ProductionStepKey[] = [];

  projectManager.updateStatus = async (
    projectSlug: string,
    status: ProjectStatus,
  ) => {
    if (failProjectCompletion && status === "completed") {
      throw new Error("Injected project completion failure.");
    }

    return originals.updateStatus.call(ProjectManager, projectSlug, status);
  };

  scheduler.getNextRunnableStage = async (
    projectSlug: string,
    stages: readonly ProductionStepKey[],
  ) => {
    schedulerCalls += 1;

    if (schedulerErrorAfterCall?.call === schedulerCalls) {
      throw schedulerErrorAfterCall.error;
    }

    if (forceSchedulerConflict) {
      return { stage: null, reason: "scheduler conflict" };
    }

    const current = await PipelineJobManager.listJobsReadOnly(projectSlug);

    if (current.jobs.some((item) => item.status === "running")) {
      return { stage: null, reason: "running job conflict" };
    }

    for (const stage of stages) {
      const currentJob = current.jobs.find((item) => item.stage === stage);

      if (currentJob?.status === "failed" || currentJob?.status === "cancelled") {
        return { stage: null, reason: `Stage "${stage}" is blocked.` };
      }

      if (currentJob?.status === "completed") {
        continue;
      }

      if (currentJob?.status === "queued") {
        return { stage };
      }
    }

    return { stage: null, reason: "No queued stage is available." };
  };
  planner.createJobRetryPlan = async (
    projectSlug: string,
    stage: ProductionStepKey,
  ) => ({
    projectSlug,
    type: "retry",
    startStage: stage,
    stagesToRun: [stage],
    blocked: dependencyBlocked,
    reason: dependencyBlocked ? "Dependency is not ready." : undefined,
    dependencies: [],
    createdAt: now,
  });
  executor.loadState = async () => {
    loadStateCalls += 1;

    if (loadStateErrorAfterCall?.call === loadStateCalls) {
      throw loadStateErrorAfterCall.error;
    }

    return {};
  };
  runner.runPipelineStage = async (
    projectSlug: string,
    stage: ProductionStepKey,
    _state: unknown,
    runType = "initial",
    onClaimConflict?: () => void,
  ) => {
    if (forceClaimConflict) {
      await PipelineJobManager.startStage(projectSlug, stage, async () => {});
    }

    return runner.runStage(
      projectSlug,
      stage,
      async () => {
        executedStages.push(stage);

        if (failedExecutionStage === stage) {
          throw new Error(`Injected ${stage} execution failure.`);
        }

        if (cancelledExecutionStage === stage) {
          await PipelineJobManager.applyAction(
            projectSlug,
            `${projectSlug}-${stage}`,
            "cancel",
          );
        }

        return PipelineJobManager.persistStageSuccess(
          projectSlug,
          stage,
          async () => {
            await ProjectManager.updatePackageStatus(
              projectSlug,
              stage,
              "completed",
            );
          },
        );
      },
      runType,
      onClaimConflict,
    );
  };

  async function reset(jobs: PipelineJob[]) {
    dependencyBlocked = false;
    forceSchedulerConflict = false;
    failedExecutionStage = null;
    cancelledExecutionStage = null;
    forceClaimConflict = false;
    schedulerErrorAfterCall = null;
    loadStateErrorAfterCall = null;
    schedulerCalls = 0;
    loadStateCalls = 0;
    failProjectCompletion = false;
    executedStages.length = 0;
    await fs.rm(projectFolder, { recursive: true, force: true });
    await ProjectManager.createProject(slug);
    await writeJobs(jobs);
  }

  try {
    await reset([job("research", "running")]);
    await PipelineJobManager.persistStageSuccess(slug, "research", async () => {});
    const continued = await PipelineRunner.continueProject(slug);
    assert.equal(continued.continued, true);
    assert.equal(continued.continued && continued.stage, "script");
    assert.equal(continued.continued && continued.completed, true);
    assert.deepEqual(executedStages, ["script"]);
    let stored = await readJobs();
    assert.equal(jobsForStage(stored, "script")[0].status, "completed");

    await reset([]);
    const emptyBefore = await fs.readFile(jobsFile, "utf-8");
    assert.deepEqual(await PipelineRunner.continueProject(slug), {
      continued: false,
    });
    assert.equal(schedulerCalls, 0);
    assert.equal(await fs.readFile(jobsFile, "utf-8"), emptyBefore);

    await reset([job("export", "completed")]);
    const finalBefore = await fs.readFile(jobsFile, "utf-8");
    assert.deepEqual(await PipelineRunner.continueProject(slug), {
      continued: false,
    });
    assert.equal(executedStages.length, 0);
    assert.equal(await fs.readFile(jobsFile, "utf-8"), finalBefore);

    await reset([job("export", "queued")]);
    const exportResult = await PipelineRunner.continueProject(slug);
    assert.equal(exportResult.continued, true);
    assert.equal(exportResult.continued && exportResult.completed, true);
    assert.equal((await ProjectManager.getProject(slug))?.status, "completed");
    assert.equal(
      (await readHistory()).events.filter(
        (event) => event.stage === "export" && event.status === "completed",
      ).length,
      1,
    );
    const completedProjectBefore = await fs.readFile(
      path.join(projectFolder, "project.json"),
      "utf-8",
    );
    const completedHistoryBefore = await fs.readFile(historyFile, "utf-8");
    assert.deepEqual(await PipelineRunner.continueProject(slug), {
      continued: false,
    });
    assert.equal(
      await fs.readFile(path.join(projectFolder, "project.json"), "utf-8"),
      completedProjectBefore,
    );
    assert.equal(await fs.readFile(historyFile, "utf-8"), completedHistoryBefore);

    await reset([job("export", "queued")]);
    failProjectCompletion = true;
    await assert.rejects(
      PipelineRunner.continueProject(slug),
      /Injected project completion failure/,
    );
    stored = await readJobs();
    assert.equal(jobsForStage(stored, "export")[0].status, "completed");
    assert.equal(
      (await ProjectManager.getManifest(slug))?.packages.export.status,
      "completed",
    );
    assert.equal(
      (await readHistory()).events.filter(
        (event) => event.stage === "export" && event.status === "completed",
      ).length,
      1,
    );
    assert.notEqual((await ProjectManager.getProject(slug))?.status, "completed");

    await reset([job("research", "failed"), job("script", "queued")]);
    assert.equal((await PipelineRunner.continueProject(slug)).continued, false);
    assert.equal(executedStages.length, 0);

    await reset([job("research", "completed"), job("script", "queued")]);
    cancelledExecutionStage = "script";
    const cancelled = await PipelineRunner.continueProject(slug);
    assert.equal(cancelled.continued, true);
    assert.equal(cancelled.continued && cancelled.completed, false);
    assert.match(cancelled.reason ?? "", /cancelled/i);

    await reset([job("research", "cancelled"), job("script", "queued")]);
    assert.equal((await PipelineRunner.continueProject(slug)).continued, false);
    assert.equal(executedStages.length, 0);

    await reset([job("research", "completed"), job("script", "queued")]);
    dependencyBlocked = true;
    const blocked = await PipelineRunner.continueProject(slug);
    assert.equal(blocked.continued, false);
    assert.equal(blocked.reason, "Dependency is not ready.");
    assert.equal(executedStages.length, 0);

    await reset([job("research", "completed"), job("script", "queued")]);
    const concurrent = await Promise.all([
      PipelineRunner.continueProject(slug),
      PipelineRunner.continueProject(slug),
    ]);
    assert.equal(executedStages.filter((stage) => stage === "script").length, 1);
    assert.equal(
      concurrent.filter(
        (result) => result.continued && result.completed,
      ).length,
      1,
    );
    const concurrentNoOp = concurrent.find((result) => !result.continued);
    assert.ok(concurrentNoOp);
    assert.doesNotMatch(concurrentNoOp.reason ?? "", /cancelled/i);
    stored = await readJobs();
    assert.equal(jobsForStage(stored, "script")[0].status, "completed");

    await reset([job("research", "completed"), job("script", "queued")]);
    forceSchedulerConflict = true;
    const conflict = await PipelineRunner.continueProject(slug);
    assert.equal(conflict.continued, false);
    assert.equal(executedStages.length, 0);
    assert.equal(jobsForStage(await readJobs(), "script")[0].status, "queued");

    await reset([job("research", "completed"), job("script", "queued")]);
    forceClaimConflict = true;
    const staleClaim = await PipelineRunner.continueProject(slug);
    assert.equal(staleClaim.continued, false);
    assert.match(staleClaim.reason ?? "", /could not be claimed/i);
    assert.doesNotMatch(staleClaim.reason ?? "", /cancelled/i);
    assert.equal(executedStages.length, 0);

    await reset([job("research", "completed"), job("script", "queued")]);
    failedExecutionStage = "script";
    const failed = await PipelineRunner.continueProject(slug);
    assert.equal(failed.continued, true);
    assert.equal(failed.continued && failed.completed, false);
    assert.equal(failed.reason, "Pipeline continuation execution failed.");
    stored = await readJobs();
    assert.equal(jobsForStage(stored, "research")[0].status, "completed");
    assert.equal(jobsForStage(stored, "script")[0].status, "failed");
    assert.equal(jobsForStage(stored, "scenes").length, 0);

    await reset([job("research", "failed", 1)]);
    const retryResult = await PipelineRunner.executeJobRetry(
      slug,
      `${slug}-research`,
    );
    assert.equal(retryResult.status, 200);
    assert.equal(retryResult.success, true);
    assert.deepEqual(executedStages, ["research", "script"]);
    stored = await readJobs();
    assert.equal(jobsForStage(stored, "research")[0].status, "completed");
    assert.equal(jobsForStage(stored, "script")[0].status, "completed");
    assert.equal(jobsForStage(stored, "scenes").length, 1);

    await reset([job("research", "failed", 1)]);
    loadStateErrorAfterCall = {
      call: 2,
      error: new PipelineStateError(
        "jobs",
        "read-failed",
        "pipeline-jobs.json",
      ),
    };
    const typedContinuationFailure = await PipelineRunner.executeJobRetry(
      slug,
      `${slug}-research`,
    );
    assert.equal(typedContinuationFailure.status, 200);
    assert.equal(typedContinuationFailure.success, true);

    await reset([job("research", "failed", 1)]);
    schedulerErrorAfterCall = {
      call: 2,
      error: new Error("Injected continuation scheduler failure."),
    };
    const genericContinuationFailure = await PipelineRunner.executeJobRetry(
      slug,
      `${slug}-research`,
    );
    assert.equal(genericContinuationFailure.status, 200);
    assert.equal(genericContinuationFailure.success, true);

    await reset([job("youtube", "failed", 1), job("export", "queued")]);
    failProjectCompletion = true;
    let finalizationFailureLogged = false;
    const originalConsoleError = console.error;
    console.error = (...args: unknown[]) => {
      if (
        args[0] ===
        "[PipelineRunner] Pipeline continuation after retry failed:"
      ) {
        finalizationFailureLogged = true;
      }

      originalConsoleError(...args);
    };
    let retryFinalizationFailure;

    try {
      retryFinalizationFailure = await PipelineRunner.executeJobRetry(
        slug,
        `${slug}-youtube`,
      );
    } finally {
      console.error = originalConsoleError;
    }

    assert.equal(retryFinalizationFailure.status, 200);
    assert.equal(retryFinalizationFailure.success, true);
    assert.equal(finalizationFailureLogged, true);
    stored = await readJobs();
    assert.equal(jobsForStage(stored, "youtube")[0].status, "completed");
    assert.equal(jobsForStage(stored, "export")[0].status, "completed");
    assert.equal(
      (await ProjectManager.getManifest(slug))?.packages.export.status,
      "completed",
    );
    assert.notEqual((await ProjectManager.getProject(slug))?.status, "completed");

    console.log("Sprint 94 pipeline auto-continuation smoke: PASS (18 scenarios)");
  } finally {
    scheduler.getNextRunnableStage = originals.getNextRunnableStage;
    planner.createJobRetryPlan = originals.createJobRetryPlan;
    executor.loadState = originals.loadState;
    runner.runPipelineStage = originals.runPipelineStage;
    projectManager.updateStatus = originals.updateStatus;
    await fs.rm(projectFolder, { recursive: true, force: true });
  }
}

void main();
