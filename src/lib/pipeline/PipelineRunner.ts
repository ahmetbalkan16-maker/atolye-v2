import { ProjectManager } from "@/lib/projects/ProjectManager";
import { PipelineRecoveryPlanner } from "./PipelineRecoveryPlanner";
import { PipelineStageExecutor } from "./PipelineStageExecutor";
import type { ProductionStepKey, ProjectStatus } from "@/types/project";
import type {
  PipelineRecoveryStageKey,
  PipelineResumeResult,
} from "@/types/pipelineRecovery";

export class PipelineRunner {
  static async run(topic: string) {
    const slug = ProjectManager.createSlug(topic);
    const project = await ProjectManager.createProject(topic);
    const state = PipelineStageExecutor.createInitialState(project);

    try {
      await this.runPipelineStage(slug, "research", state);
      await this.runPipelineStage(slug, "script", state);
      await this.runPipelineStage(slug, "scenes", state);
      await this.runPipelineStage(slug, "visuals", state);
      await this.runPipelineStage(slug, "animation", state);
      await this.runPipelineStage(slug, "video", state);
      await this.runPipelineStage(slug, "audio", state);
      await this.runPipelineStage(slug, "assembly", state);
      await this.runPipelineStage(slug, "thumbnail", state);
      await this.runPipelineStage(slug, "seo", state);
      await this.runPipelineStage(slug, "youtube", state);
      await this.runPipelineStage(slug, "export", state);

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

    const completedStages: PipelineRecoveryStageKey[] = [];

    for (const stage of plan.stagesToRun) {
      if (await this.isStageCompleted(projectSlug, stage)) {
        continue;
      }

      await this.runPipelineStage(projectSlug, stage, state);
      completedStages.push(stage);
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

  private static async runPipelineStage(
    slug: string,
    stage: ProductionStepKey,
    state: Parameters<typeof PipelineStageExecutor.execute>[2],
  ) {
    return this.runStage(slug, stage, () =>
      PipelineStageExecutor.execute(slug, stage, state),
    );
  }

  private static async runStage<T>(
    slug: string,
    stage: ProductionStepKey,
    action: () => Promise<T>,
  ): Promise<T> {
    await ProjectManager.updateStatus(slug, stage as ProjectStatus);
    await ProjectManager.updatePackageStatus(slug, stage, "running");

    try {
      return await action();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Pipeline stage failed.";

      await ProjectManager.updatePackageStatus(slug, stage, "failed", message);
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
