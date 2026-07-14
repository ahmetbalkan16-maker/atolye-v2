import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { PipelineJobManager } from "../src/lib/pipeline/PipelineJobManager";
import { PipelineQueueScheduler } from "../src/lib/pipeline/PipelineQueueScheduler";
import { PipelineRecoveryPlanner } from "../src/lib/pipeline/PipelineRecoveryPlanner";
import {
  PipelineRunner,
  type PipelineContinuationResult,
} from "../src/lib/pipeline/PipelineRunner";
import { PipelineStageExecutor } from "../src/lib/pipeline/PipelineStageExecutor";
import { ProjectManager } from "../src/lib/projects/ProjectManager";
import { ProductionRuntimeInitializer } from "../src/lib/production/ProductionRuntimeInitializer";
import { configureProductionPipelineExecution } from "../src/lib/production/ProductionPipelineExecutionFactory";
import {
  ProductionWorkerLifecycle,
  ProductionWorkerLifecycleExecutionRejectedError,
} from "../src/lib/production/ProductionWorkerLifecycle";
import type { PipelineJob, PipelineJobList } from "../src/types/pipelineJob";
import type {
  ProductionStepKey,
  ProjectPackageRunType,
} from "../src/types/project";

type RunnerHarness = {
  runPipelineStage(
    projectSlug: string,
    stage: ProductionStepKey,
    state: unknown,
    runType?: ProjectPackageRunType,
    onClaimConflict?: () => void,
  ): Promise<boolean>;
  runStage(
    projectSlug: string,
    stage: ProductionStepKey,
    action: () => Promise<boolean>,
    runType: ProjectPackageRunType,
    onClaimConflict?: () => void,
  ): Promise<boolean>;
};

type ExecutorHarness = {
  loadState(projectSlug: string): Promise<unknown>;
};

const slug = `sprint-119-continuation-${process.pid}`;
const projectFolder = path.join(process.cwd(), "data", "projects", slug);
const jobsFile = path.join(projectFolder, "pipeline-jobs.json");
const historyFile = path.join(projectFolder, "pipeline-history.json");
const now = "2026-07-14T18:00:00.000Z";
const order: ProductionStepKey[] = [
  "research",
  "script",
  "scenes",
  "visuals",
  "animation",
  "video",
  "audio",
  "assembly",
];

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
    error: status === "failed" ? "failed" : undefined,
  };
}

function jobList(jobs: PipelineJob[]): PipelineJobList {
  return { projectSlug: slug, jobs, createdAt: now, updatedAt: now };
}

async function writeJobs(jobs: PipelineJob[]) {
  await fs.mkdir(projectFolder, { recursive: true });
  await fs.writeFile(jobsFile, JSON.stringify(jobList(jobs), null, 2), "utf8");
  await fs.rm(historyFile, { force: true });
}

async function readJobs() {
  return JSON.parse(await fs.readFile(jobsFile, "utf8")) as PipelineJobList;
}

function stageJob(list: PipelineJobList, stage: ProductionStepKey) {
  return list.jobs.find((item) => item.stage === stage);
}

async function readyLifecycle() {
  const lifecycle = new ProductionWorkerLifecycle(() => now);
  const result = await new ProductionRuntimeInitializer({
    now: () => now,
    listProjectSlugs: async () => [],
    createRecoveryBootstrap: () => {
      throw new Error("unreachable");
    },
    workerLifecycle: lifecycle,
  }).initialize();
  assert.equal(result.ok, true);
  return lifecycle;
}

async function main() {
  const runner = PipelineRunner as unknown as RunnerHarness;
  const executor = PipelineStageExecutor as unknown as ExecutorHarness;
  const scheduler = PipelineQueueScheduler;
  const planner = PipelineRecoveryPlanner;
  const originals = {
    runPipelineStage: runner.runPipelineStage,
    loadState: executor.loadState,
    getNextRunnableStage: scheduler.getNextRunnableStage,
    createJobRetryPlan: planner.createJobRetryPlan,
    continueProject: PipelineRunner.continueProject,
    dispatchProjectContinuation: PipelineRunner.dispatchProjectContinuation,
  };
  const executed: ProductionStepKey[] = [];
  let failedStage: ProductionStepKey | null = null;
  let dependencyBlocked = false;
  let forceClaimConflict = false;
  let heldStage: ProductionStepKey | null = null;
  let releaseHeldStage: (() => void) | undefined;
  let heldStageStarted: (() => void) | undefined;
  let scenarios = 0;

  async function scenario(name: string, test: () => void | Promise<void>) {
    await test();
    scenarios++;
    if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${scenarios}: ${name}`);
  }

  async function reset(jobs: PipelineJob[]) {
    PipelineRunner.configureContinuationAdmission();
    failedStage = null;
    dependencyBlocked = false;
    forceClaimConflict = false;
    heldStage = null;
    releaseHeldStage = undefined;
    heldStageStarted = undefined;
    executed.length = 0;
    await fs.rm(projectFolder, { recursive: true, force: true });
    await ProjectManager.createProject(slug);
    await writeJobs(jobs);
  }

  scheduler.getNextRunnableStage = async (projectSlug, stages) => {
    const current = await PipelineJobManager.listJobsReadOnly(projectSlug);
    if (current.jobs.some((item) => item.status === "running")) {
      return { stage: null, reason: "running job conflict" };
    }
    for (const stage of stages ?? []) {
      const currentJob = current.jobs.find((item) => item.stage === stage);
      if (currentJob?.status === "failed" || currentJob?.status === "cancelled") {
        return { stage: null, reason: `Stage "${stage}" is blocked.` };
      }
      if (currentJob?.status === "completed") continue;
      if (currentJob?.status === "queued") return { stage };
    }
    return { stage: null, reason: "No queued stage is available." };
  };
  planner.createJobRetryPlan = async (projectSlug, stage) => ({
    projectSlug,
    type: "retry",
    startStage: stage,
    stagesToRun: [stage],
    blocked: dependencyBlocked,
    reason: dependencyBlocked ? "Dependency is not ready." : undefined,
    dependencies: [],
    createdAt: now,
  });
  executor.loadState = async () => ({});
  runner.runPipelineStage = async (
    projectSlug,
    stage,
    _state,
    runType = "initial",
    onClaimConflict,
  ) => {
    if (forceClaimConflict) {
      await PipelineJobManager.startStage(projectSlug, stage, async () => {});
    }
    return runner.runStage(
      projectSlug,
      stage,
      async () => {
        executed.push(stage);
        heldStageStarted?.();
        if (heldStage === stage) {
          await new Promise<void>((resolve) => {
            releaseHeldStage = resolve;
          });
        }
        if (failedStage === stage) throw new Error(`Injected ${stage} failure.`);
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

  async function expectRetryChain(
    retryStage: "visuals" | "animation" | "video" | "audio",
  ) {
    await reset([job(retryStage, "failed", 1)]);
    const result = await PipelineRunner.executeJobRetry(
      slug,
      `${slug}-${retryStage}`,
    );
    const expected = order.slice(order.indexOf(retryStage));
    assert.equal(result.status, 200);
    assert.equal(result.success, true);
    assert.deepEqual(executed, expected);
    const stored = await readJobs();
    assert.equal(stageJob(stored, "assembly")?.status, "completed");
    assert.equal(stageJob(stored, "thumbnail")?.status, "queued");
  }

  try {
    await scenario("visuals retry continues through assembly", () =>
      expectRetryChain("visuals"));
    await scenario("animation retry continues through assembly", () =>
      expectRetryChain("animation"));
    await scenario("video retry continues through assembly", () =>
      expectRetryChain("video"));
    await scenario("audio retry continues through assembly", () =>
      expectRetryChain("audio"));

    await scenario("each continuation invocation executes one stage", async () => {
      await reset([job("animation", "queued")]);
      const deltas: number[] = [];
      PipelineRunner.continueProject = async (projectSlug) => {
        const before = executed.length;
        const result = await originals.continueProject.call(
          PipelineRunner,
          projectSlug,
        );
        deltas.push(executed.length - before);
        return result;
      };
      try {
        await PipelineRunner.dispatchProjectContinuation(slug);
      } finally {
        PipelineRunner.continueProject = originals.continueProject;
      }
      assert.deepEqual(deltas, [1, 1, 1, 1]);
    });

    await scenario("duplicate dispatchers do not duplicate execution", async () => {
      await reset([job("animation", "queued")]);
      await Promise.all([
        PipelineRunner.dispatchProjectContinuation(slug),
        PipelineRunner.dispatchProjectContinuation(slug),
      ]);
      for (const stage of ["animation", "video", "audio", "assembly"] as const) {
        assert.equal(executed.filter((item) => item === stage).length, 1);
      }
    });

    await scenario("assembly boundary race cannot execute thumbnail", async () => {
      await reset([job("assembly", "queued")]);
      let injected = false;
      PipelineRunner.continueProject = async (projectSlug, stages) => {
        if (!injected) {
          injected = true;
          await originals.continueProject.call(
            PipelineRunner,
            projectSlug,
            stages,
          );
        }
        return originals.continueProject.call(
          PipelineRunner,
          projectSlug,
          stages,
        );
      };
      try {
        await PipelineRunner.dispatchProjectContinuation(slug);
      } finally {
        PipelineRunner.continueProject = originals.continueProject;
      }
      assert.deepEqual(executed, ["assembly"]);
      assert.equal(stageJob(await readJobs(), "thumbnail")?.status, "queued");
    });

    await scenario("existing claim conflict stops safely", async () => {
      await reset([job("animation", "queued")]);
      forceClaimConflict = true;
      const result = await PipelineRunner.dispatchProjectContinuation(slug);
      assert.equal(result.completedStages.length, 0);
      assert.match(result.reason ?? "", /could not be claimed/i);
      assert.equal(stageJob(await readJobs(), "animation")?.status, "running");
    });

    await scenario("stage failure stops chain", async () => {
      await reset([job("animation", "queued")]);
      failedStage = "video";
      const result = await PipelineRunner.dispatchProjectContinuation(slug);
      assert.deepEqual(result.completedStages, ["animation"]);
      assert.equal(stageJob(await readJobs(), "video")?.status, "failed");
      assert.equal(stageJob(await readJobs(), "audio"), undefined);
    });

    await scenario("blocked dependency stops chain", async () => {
      await reset([job("animation", "queued")]);
      dependencyBlocked = true;
      const result = await PipelineRunner.dispatchProjectContinuation(slug);
      assert.equal(result.completedStages.length, 0);
      assert.equal(executed.length, 0);
      assert.equal(stageJob(await readJobs(), "animation")?.status, "queued");
    });

    await scenario("terminal assembly is write-free no-op", async () => {
      await reset([job("assembly", "completed")]);
      const before = await fs.readFile(jobsFile, "utf8");
      const result = await PipelineRunner.dispatchProjectContinuation(slug);
      assert.deepEqual(result, { completedStages: [], iterations: 0 });
      assert.equal(await fs.readFile(jobsFile, "utf8"), before);
    });

    await scenario("no queued stage is write-free no-op", async () => {
      await reset([]);
      const before = await fs.readFile(jobsFile, "utf8");
      const result = await PipelineRunner.dispatchProjectContinuation(slug);
      assert.deepEqual(result, { completedStages: [], iterations: 0 });
      assert.equal(await fs.readFile(jobsFile, "utf8"), before);
    });

    await scenario("dispatch trigger failure preserves completed retry and queue", async () => {
      await reset([job("visuals", "failed", 1)]);
      PipelineRunner.dispatchProjectContinuation = async () => {
        throw new Error("Injected dispatch trigger failure.");
      };
      let result;
      try {
        result = await PipelineRunner.executeJobRetry(slug, `${slug}-visuals`);
      } finally {
        PipelineRunner.dispatchProjectContinuation =
          originals.dispatchProjectContinuation;
      }
      assert.equal(result.status, 200);
      assert.equal(result.success, true);
      const stored = await readJobs();
      assert.equal(stageJob(stored, "visuals")?.status, "completed");
      assert.equal(stageJob(stored, "animation")?.status, "queued");
    });

    await scenario("draining runtime rejects continuation admission", async () => {
      await reset([job("animation", "queued")]);
      const lifecycle = await readyLifecycle();
      await lifecycle.drain();
      assert.equal(
        configureProductionPipelineExecution({ enabled: false, lifecycle }),
        false,
      );
      await assert.rejects(
        PipelineRunner.dispatchProjectContinuation(slug),
        ProductionWorkerLifecycleExecutionRejectedError,
      );
      assert.equal(executed.length, 0);
    });

    await scenario("stopped runtime rejects continuation admission", async () => {
      await reset([job("animation", "queued")]);
      const lifecycle = await readyLifecycle();
      await lifecycle.stop();
      PipelineRunner.configureContinuationAdmission(lifecycle);
      await assert.rejects(
        PipelineRunner.dispatchProjectContinuation(slug),
        ProductionWorkerLifecycleExecutionRejectedError,
      );
    });

    await scenario("failed runtime rejects continuation admission", async () => {
      await reset([job("animation", "queued")]);
      const lifecycle = await readyLifecycle();
      lifecycle.fail("TEST_FAILURE");
      PipelineRunner.configureContinuationAdmission(lifecycle);
      await assert.rejects(
        PipelineRunner.dispatchProjectContinuation(slug),
        ProductionWorkerLifecycleExecutionRejectedError,
      );
    });

    await scenario("drain waits for active continuation", async () => {
      await reset([job("animation", "queued")]);
      const lifecycle = await readyLifecycle();
      PipelineRunner.configureContinuationAdmission(lifecycle);
      heldStage = "animation";
      const started = new Promise<void>((resolve) => {
        heldStageStarted = resolve;
      });
      const dispatch = PipelineRunner.dispatchProjectContinuation(slug);
      await started;
      const drain = lifecycle.drain();
      let drained = false;
      void drain.then(() => {
        drained = true;
      });
      await Promise.resolve();
      assert.equal(lifecycle.snapshot().activeExecutions, 1);
      assert.equal(drained, false);
      releaseHeldStage?.();
      await drain;
      await assert.rejects(dispatch, ProductionWorkerLifecycleExecutionRejectedError);
      assert.equal(stageJob(await readJobs(), "video")?.status, "queued");
    });

    await scenario("persisted queue resumes after simulated restart", async () => {
      await reset([job("animation", "queued")]);
      const first = await PipelineRunner.continueProject(slug);
      assert.equal(first.continued && first.stage, "animation");
      PipelineRunner.configureContinuationAdmission();
      executed.length = 0;
      const resumed = await PipelineRunner.dispatchProjectContinuation(slug);
      assert.deepEqual(resumed.completedStages, ["video", "audio", "assembly"]);
    });

    await scenario("completed replay calls no stage provider", async () => {
      await reset([job("assembly", "completed")]);
      await PipelineRunner.dispatchProjectContinuation(slug);
      await PipelineRunner.dispatchProjectContinuation(slug);
      assert.equal(executed.length, 0);
    });

    await scenario("canonical bound prevents infinite loop", async () => {
      await reset([job("research", "queued")]);
      PipelineRunner.continueProject = async (): Promise<PipelineContinuationResult> => ({
        continued: true,
        stage: "research",
        completed: true,
      });
      let result;
      try {
        result = await PipelineRunner.dispatchProjectContinuation(slug);
      } finally {
        PipelineRunner.continueProject = originals.continueProject;
      }
      assert.equal(result.iterations, order.length);
      assert.match(result.reason ?? "", /iteration limit/i);
    });

    await scenario("initial run and resume entrypoints remain untouched", async () => {
      await reset([]);
      const run = PipelineRunner.run;
      const resume = PipelineRunner.resume;
      await PipelineRunner.dispatchProjectContinuation(slug);
      assert.strictEqual(PipelineRunner.run, run);
      assert.strictEqual(PipelineRunner.resume, resume);
    });

    await scenario("retry status contracts remain stable", async () => {
      await reset([]);
      const missing = await PipelineRunner.executeJobRetry(slug, `${slug}-visuals`);
      assert.equal(missing.status, 409);
      await reset([job("visuals", "failed", 1)]);
      dependencyBlocked = true;
      const blocked = await PipelineRunner.executeJobRetry(
        slug,
        `${slug}-visuals`,
      );
      assert.equal(blocked.status, 409);
      assert.equal(blocked.blocked, true);
    });

    assert.equal(scenarios, 22);
    console.log(
      `Sprint 119 retry and standalone continuation hardening smoke: PASS (${scenarios} scenarios)`,
    );
  } finally {
    PipelineRunner.continueProject = originals.continueProject;
    PipelineRunner.dispatchProjectContinuation =
      originals.dispatchProjectContinuation;
    PipelineRunner.configureContinuationAdmission();
    runner.runPipelineStage = originals.runPipelineStage;
    executor.loadState = originals.loadState;
    scheduler.getNextRunnableStage = originals.getNextRunnableStage;
    planner.createJobRetryPlan = originals.createJobRetryPlan;
    await fs.rm(projectFolder, { recursive: true, force: true });
  }
}

void main();
