import { ProjectManager } from "@/lib/projects/ProjectManager";
import { PipelineJobManager } from "./PipelineJobManager";
import { PipelineQueueScheduler } from "./PipelineQueueScheduler";
import {
  PipelineRecoveryPlanner,
  pipelineRecoveryStageOrder,
} from "./PipelineRecoveryPlanner";
import { PipelineStageExecutor } from "./PipelineStageExecutor";
import { isPipelineStateError } from "./PipelineStateError";
import type {
  ProductionStepKey,
  ProjectPackageRunType,
  ProjectStatus,
} from "@/types/project";
import type {
  PipelineJobRetryExecutionResult,
  PipelineRecoveryStageKey,
  PipelineRetryResult,
  PipelineResumeResult,
} from "@/types/pipelineRecovery";

export class PipelineRunner {
  static async run(topic: string) {
    const slug = ProjectManager.createSlug(topic);
    const project = await ProjectManager.createProject(topic);
    const state = PipelineStageExecutor.createInitialState(project);

    try {
      const { stopReason } = await this.runScheduledStages(
        slug,
        pipelineRecoveryStageOrder,
        state,
      );

      if (!stopReason) {
        await PipelineJobManager.persistProjectCompletion(slug, async () => {
          await ProjectManager.updateStatus(slug, "completed");
        });
      }

      return {
        success: !stopReason,
        slug,
        stopReason,
        project,
        research: state.research,
        script: state.script,
        scenes: state.scenes,
        visuals: state.visuals,
        animation: state.animation,
        video: state.video,
        audio: state.audio,
        assembly: state.assembly,
        thumbnail: state.thumbnail,
        seo: state.seo,
        youtube: state.youtube,
        export: state.exportPackage,
      };
    } catch (error) {
      if (!isPipelineStateError(error)) {
        console.error("[PipelineRunner] Pipeline failed:", {
          slug,
          topic,
          error,
        });
      }

      throw error;
    }
  }

  static async resume(projectSlug: string): Promise<PipelineResumeResult> {
    const plan = await PipelineRecoveryPlanner.createResumePlan(projectSlug);

    if (plan.blocked || !plan.startStage) {
      return {
        success: false,
        projectSlug,
        resumedFrom: plan.startStage,
        completedStages: [],
        blocked: plan.blocked,
        reason: plan.reason,
        plan,
      };
    }

    const state = await PipelineStageExecutor.loadState(projectSlug);

    if (!state) {
      return {
        success: false,
        projectSlug,
        resumedFrom: plan.startStage,
        completedStages: [],
        blocked: true,
        reason: "Project could not be read.",
        plan,
      };
    }

    const { completedStages, stopReason } = await this.runScheduledStages(
      projectSlug,
      plan.stagesToRun,
      state,
      "resume",
    );

    if (stopReason) {
      return {
        success: false,
        projectSlug,
        resumedFrom: plan.startStage,
        completedStages,
        blocked: true,
        reason: stopReason,
        plan,
      };
    }

    if (plan.stagesToRun.length > 0) {
      const exportCompleted = await this.isStageCompleted(projectSlug, "export");

      if (exportCompleted) {
        await PipelineJobManager.persistProjectCompletion(
          projectSlug,
          async () => {
            await ProjectManager.updateStatus(projectSlug, "completed");
          },
        );
      }
    }

    return {
      success: true,
      projectSlug,
      resumedFrom: plan.startStage,
      completedStages,
      blocked: false,
      plan,
    };
  }

  static async retryStage(
    projectSlug: string,
    stage: PipelineRecoveryStageKey,
  ): Promise<PipelineRetryResult> {
    const job = await PipelineJobManager.getJobForStageReadOnly(
      projectSlug,
      stage,
    );
    const result = await this.executeJobRetry(
      projectSlug,
      job?.id ?? `${projectSlug}-${stage}`,
    );
    const plan =
      result.plan ??
      (await PipelineRecoveryPlanner.createJobRetryPlan(projectSlug, stage));

    return {
      success: result.success,
      status: result.status === 404 ? 409 : result.status,
      projectSlug,
      retriedStage: stage,
      completedStages: result.completedStages,
      blocked: result.blocked,
      reason: result.reason,
      plan,
    };
  }

  static async continueProject(
    projectSlug: string,
  ): Promise<PipelineContinuationResult> {
    const jobList = await PipelineJobManager.listJobsReadOnly(projectSlug);
    const queuedStage = pipelineRecoveryStageOrder.find((stage) =>
      jobList.jobs.some(
        (job) => job.stage === stage && job.status === "queued",
      ),
    );

    if (!queuedStage) {
      return { continued: false };
    }

    const queuedStageIndex = pipelineRecoveryStageOrder.indexOf(queuedStage);
    const scheduled = await PipelineQueueScheduler.getNextRunnableStage(
      projectSlug,
      pipelineRecoveryStageOrder.slice(0, queuedStageIndex + 1),
    );

    if (scheduled.stage !== queuedStage) {
      return {
        continued: false,
        reason: scheduled.reason,
      };
    }

    const plan = await PipelineRecoveryPlanner.createJobRetryPlan(
      projectSlug,
      queuedStage,
    );

    if (plan.blocked) {
      return {
        continued: false,
        reason: plan.reason,
      };
    }

    const state = await PipelineStageExecutor.loadState(projectSlug);

    if (!state) {
      return {
        continued: false,
        reason: "Project could not be read.",
      };
    }

    let claimed = true;
    let completed: boolean;

    try {
      completed = await this.runPipelineStage(
        projectSlug,
        queuedStage,
        state,
        "initial",
        () => {
          claimed = false;
        },
      );
    } catch (error) {
      if (isPipelineStateError(error)) {
        throw error;
      }

      return {
        continued: true,
        stage: queuedStage,
        completed: false,
        reason: "Pipeline continuation execution failed.",
      };
    }

    if (!claimed) {
      return {
        continued: false,
        reason: `Stage "${queuedStage}" could not be claimed.`,
      };
    }

    if (completed && queuedStage === "export") {
      await PipelineJobManager.persistProjectCompletion(
        projectSlug,
        async () => {
          await ProjectManager.updateStatus(projectSlug, "completed");
        },
      );
    }

    return {
      continued: true,
      stage: queuedStage,
      completed,
      reason: completed
        ? undefined
        : `Stage "${queuedStage}" was cancelled.`,
    };
  }

  static async executeJobRetry(
    projectSlug: string,
    jobId: string,
  ): Promise<PipelineJobRetryExecutionResult> {
    const existingJob = await PipelineJobManager.getJobReadOnly(
      projectSlug,
      jobId,
    );
    const stage = existingJob?.stage ?? getRetryStageFromJobId(projectSlug, jobId);

    if (!stage) {
      return {
        success: false,
        status: 404,
        projectSlug,
        jobId,
        completedStages: [],
        blocked: true,
        reason: "Pipeline job not found.",
      };
    }

    const plan = await PipelineRecoveryPlanner.createJobRetryPlan(
      projectSlug,
      stage,
    );

    if (plan.blocked) {
      return {
        success: false,
        status: 409,
        projectSlug,
        jobId,
        retriedStage: stage,
        completedStages: [],
        blocked: true,
        reason: plan.reason,
        plan,
      };
    }

    const state = await PipelineStageExecutor.loadState(projectSlug);

    if (!state) {
      return {
        success: false,
        status: 409,
        projectSlug,
        jobId,
        retriedStage: stage,
        completedStages: [],
        blocked: true,
        reason: "Project could not be read.",
        plan,
      };
    }

    const prepared = await PipelineJobManager.prepareJobRetry(
      projectSlug,
      jobId,
    );

    if (!prepared.success) {
      return {
        success: false,
        status: prepared.status,
        projectSlug,
        jobId,
        retriedStage: stage,
        completedStages: [],
        blocked: true,
        reason: prepared.error,
      };
    }

    const scheduled = await PipelineQueueScheduler.getNextRunnableStage(
      projectSlug,
      [stage],
    );

    if (scheduled.stage !== stage) {
      try {
        await PipelineJobManager.compensatePreparedRetry(
          projectSlug,
          prepared.previousJob,
          prepared.job,
        );
      } catch (error) {
        if (isPipelineStateError(error)) {
          throw error;
        }

        return {
          success: false,
          status: 500,
          projectSlug,
          jobId,
          retriedStage: stage,
          completedStages: [],
          blocked: false,
          reason: "Pipeline retry compensation failed.",
          plan,
        };
      }

      return {
        success: false,
        status: 409,
        projectSlug,
        jobId,
        retriedStage: stage,
        completedStages: [],
        blocked: true,
        reason: scheduled.reason || `Stage "${stage}" could not be scheduled.`,
        plan,
      };
    }

    let completed: boolean;

    try {
      completed = await this.runPipelineStage(
        projectSlug,
        stage,
        state,
        "retry",
      );
    } catch (error) {
      if (isPipelineStateError(error)) {
        throw error;
      }

      return {
        success: false,
        status: 500,
        projectSlug,
        jobId,
        retriedStage: stage,
        completedStages: [],
        blocked: false,
        reason: "Pipeline retry execution failed.",
        plan,
      };
    }

    if (!completed) {
      return {
        success: false,
        status: 409,
        projectSlug,
        jobId,
        retriedStage: stage,
        completedStages: [],
        blocked: true,
        reason: `Stage "${stage}" was cancelled.`,
        plan,
      };
    }

    try {
      await this.continueProject(projectSlug);
    } catch (error) {
      console.error("[PipelineRunner] Pipeline continuation after retry failed:", {
        projectSlug,
        stage,
        error,
      });
    }

    return {
      success: true,
      status: 200,
      projectSlug,
      jobId,
      retriedStage: stage,
      completedStages: [stage],
      blocked: false,
      plan,
    };
  }

  private static async runPipelineStage(
    slug: string,
    stage: ProductionStepKey,
    state: Parameters<typeof PipelineStageExecutor.execute>[2],
    runType: ProjectPackageRunType = "initial",
    onClaimConflict?: () => void,
  ) {
    return this.runStage(
      slug,
      stage,
      () => PipelineStageExecutor.execute(slug, stage, state),
      runType,
      onClaimConflict,
    );
  }

  private static async runScheduledStages(
    slug: string,
    stages: readonly PipelineRecoveryStageKey[],
    state: Parameters<typeof PipelineStageExecutor.execute>[2],
    runType: ProjectPackageRunType = "initial",
  ): Promise<{
    completedStages: PipelineRecoveryStageKey[];
    stopReason?: string;
  }> {
    const completedStages: PipelineRecoveryStageKey[] = [];

    while (true) {
      const next = await PipelineQueueScheduler.getNextRunnableStage(
        slug,
        stages,
      );

      if (!next.stage) {
        return {
          completedStages,
          stopReason:
            next.reason === "No queued stage is available."
              ? undefined
              : next.reason,
        };
      }

      const completed = await this.runPipelineStage(
        slug,
        next.stage,
        state,
        runType,
      );

      if (!completed) {
        return {
          completedStages,
          stopReason: `Stage "${next.stage}" was cancelled.`,
        };
      }

      completedStages.push(next.stage);
    }
  }

  private static async runStage(
    slug: string,
    stage: ProductionStepKey,
    action: () => Promise<boolean>,
    runType: ProjectPackageRunType,
    onClaimConflict?: () => void,
  ): Promise<boolean> {
    const started = await PipelineJobManager.startStage(
      slug,
      stage,
      async () => {
        await ProjectManager.updateStatus(slug, stage as ProjectStatus);
        await ProjectManager.updatePackageStatus(
          slug,
          stage,
          "running",
          undefined,
          { runType },
        );
      },
    );

    if (!started) {
      onClaimConflict?.();
      return false;
    }

    try {
      return await action();
    } catch (error) {
      if (isPipelineStateError(error)) {
        throw error;
      }

      const message =
        error instanceof Error ? error.message : "Pipeline stage failed.";

      await PipelineJobManager.persistStageFailure(
        slug,
        stage,
        async () => {
          await ProjectManager.updatePackageStatus(
            slug,
            stage,
            "failed",
            message,
          );
        },
        message,
      );
      console.error("[PipelineRunner] Stage failed:", {
        slug,
        stage,
        error,
      });

      throw error;
    }
  }

  private static async isStageCompleted(
    projectSlug: string,
    stage: PipelineRecoveryStageKey,
  ) {
    const manifest = await ProjectManager.getManifest(projectSlug);

    return manifest?.packages[stage].status === "completed";
  }
}

export type PipelineContinuationResult =
  | {
      continued: false;
      reason?: string;
    }
  | {
      continued: true;
      stage: PipelineRecoveryStageKey;
      completed: boolean;
      reason?: string;
    };

function getRetryStageFromJobId(
  projectSlug: string,
  jobId: string,
): PipelineRecoveryStageKey | null {
  const prefix = `${projectSlug}-`;

  if (!jobId.startsWith(prefix)) {
    return null;
  }

  const stage = jobId.slice(prefix.length) as PipelineRecoveryStageKey;

  return pipelineRecoveryStageOrder.includes(stage) ? stage : null;
}
