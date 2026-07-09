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
      await this.runScheduledStages(slug, pipelineRecoveryStageOrder, state);

      await ProjectManager.updateStatus(slug, "completed");

      return {
        success: true,
        slug,
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

    if (completedStages.length === 0 && stopReason) {
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
        await ProjectManager.updateStatus(projectSlug, "completed");
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

    await this.runPipelineStage(projectSlug, stage, state, "retry");

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

      await this.runPipelineStage(slug, next.stage, state, runType);
      completedStages.push(next.stage);
    }
  }

  private static async runStage<T>(
    slug: string,
    stage: ProductionStepKey,
    action: () => Promise<T>,
    runType: ProjectPackageRunType,
  ): Promise<T> {
    await ProjectManager.updateStatus(slug, stage as ProjectStatus);
    await ProjectManager.updatePackageStatus(
      slug,
      stage,
      "running",
      undefined,
      { runType },
    );
    await PipelineJobManager.markStageRunning(slug, stage);

    try {
      const result = await action();

      await PipelineJobManager.markStageCompleted(slug, stage);

      return result;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Pipeline stage failed.";

      await ProjectManager.updatePackageStatus(slug, stage, "failed", message);
      await PipelineJobManager.markStageFailed(slug, stage, message);
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
