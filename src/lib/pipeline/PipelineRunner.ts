import { ProjectManager } from "@/lib/projects/ProjectManager";
import { PipelineJobManager } from "./PipelineJobManager";
import { PipelineQueueScheduler } from "./PipelineQueueScheduler";
import {
  PipelineRecoveryPlanner,
  pipelineRecoveryStageOrder,
} from "./PipelineRecoveryPlanner";
import { PipelineStageExecutor } from "./PipelineStageExecutor";
import type {
  ProductionStepKey,
  ProjectPackageRunType,
  ProjectStatus,
} from "@/types/project";
import type {
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
      console.error("[PipelineRunner] Pipeline failed:", {
        slug,
        topic,
        error,
      });

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
    const plan = await PipelineRecoveryPlanner.createRetryPlan(
      projectSlug,
      stage,
    );

    if (plan.blocked) {
      return {
        success: false,
        projectSlug,
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
        projectSlug,
        retriedStage: stage,
        completedStages: [],
        blocked: true,
        reason: "Project could not be read.",
        plan,
      };
    }

    const queued = await PipelineJobManager.queueStageRetry(
      projectSlug,
      stage,
    );

    if (!queued) {
      return {
        success: false,
        projectSlug,
        retriedStage: stage,
        completedStages: [],
        blocked: true,
        reason: `Stage "${stage}" could not be queued for retry.`,
        plan,
      };
    }

    const completed = await this.runPipelineStage(
      projectSlug,
      stage,
      state,
      "retry",
    );

    if (!completed) {
      return {
        success: false,
        projectSlug,
        retriedStage: stage,
        completedStages: [],
        blocked: true,
        reason: `Stage "${stage}" was cancelled.`,
        plan,
      };
    }

    return {
      success: true,
      projectSlug,
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
  ) {
    return this.runStage(slug, stage, () =>
      PipelineStageExecutor.execute(slug, stage, state),
      runType,
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
      return false;
    }

    try {
      return await action();
    } catch (error) {
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
