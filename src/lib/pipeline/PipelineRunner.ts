import { AIManager } from "@/lib/ai/AIManager";
import { AnimationAssetPipeline } from "@/lib/animation/AnimationAssetPipeline";
import { AnimationPromptGenerator } from "@/lib/animation/prompts/AnimationPromptGenerator";
import { AssemblyManager } from "@/lib/assembly/AssemblyManager";
import { AudioManager } from "@/lib/audio/AudioManager";
import { AudioPipeline } from "@/lib/audio/AudioPipeline";
import { ExportEngine } from "@/lib/export/ExportEngine";
import { ProjectManager } from "@/lib/projects/ProjectManager";
import { SEOManager } from "@/lib/seo/SEOManager";
import { ThumbnailEngine } from "@/lib/thumbnail/ThumbnailEngine";
import { VideoPipeline } from "@/lib/video/VideoPipeline";
import { VisualManager } from "@/lib/visuals/VisualManager";
import { YouTubeEngine } from "@/lib/youtube/YouTubeEngine";
import type { ProductionStepKey, ProjectStatus } from "@/types/project";

export class PipelineRunner {
  static async run(topic: string) {
    const slug = ProjectManager.createSlug(topic);
    const project = await ProjectManager.createProject(topic);

    try {
      const research = await this.runStage(slug, "research", async () => {
        const data = await AIManager.runResearch(topic, {
          projectSlug: slug,
          stage: "research",
          operation: "research",
        });
        await ProjectManager.saveResearch(slug, data);
        return data;
      });

      const script = await this.runStage(slug, "script", async () => {
        const data = await AIManager.runScript(topic, {
          projectSlug: slug,
          stage: "script",
          operation: "script",
        });
        await ProjectManager.saveScript(slug, data);
        return data;
      });

      const scenes = await this.runStage(slug, "scenes", async () => {
        const data = await AIManager.runScenes(script, {
          projectSlug: slug,
          stage: "scenes",
          operation: "scenes",
        });
        await ProjectManager.saveScenes(slug, data);
        return data;
      });

      const visuals = await this.runStage(slug, "visuals", async () => {
        const data = await VisualManager.generateVisualData({
          projectId: project.id,
          projectSlug: slug,
          scenes,
          aiContext: {
            projectSlug: slug,
            stage: "visuals",
            operation: "visuals",
          },
        });
        await ProjectManager.saveVisuals(slug, data);
        return data;
      });

      const animation = await this.runStage(slug, "animation", async () => {
        const animationPlan = await AnimationPromptGenerator.generateAnimationData({
          projectId: project.id,
          projectSlug: slug,
          scenes,
          visuals,
          aiContext: {
            projectSlug: slug,
            stage: "animation",
            operation: "animation-prompt",
          },
        });
        const { updatedScenes } =
          await AnimationAssetPipeline.generateAnimationAssets({
            projectId: project.id,
            projectSlug: slug,
            scenes: animationPlan.scenes,
          });
        const data = {
          ...animationPlan,
          scenes: updatedScenes,
        };

        await ProjectManager.saveAnimation(slug, data);
        return data;
      });

      const video = await this.runStage(slug, "video", async () => {
        const { video: data } = await VideoPipeline.generateVideo({
          projectId: project.id,
          projectSlug: slug,
          animation,
        });

        await ProjectManager.saveVideo(slug, data);
        return data;
      });

      const audio = await this.runStage(slug, "audio", async () => {
        const audioPlan = await AudioManager.generateAudioData(script, {
          projectSlug: slug,
          stage: "audio",
          operation: "audio-plan",
        });
        const { audio: data } = await AudioPipeline.generateAudio({
          projectId: project.id,
          projectSlug: slug,
          audio: audioPlan,
        });

        await ProjectManager.saveAudio(slug, data);
        return data;
      });

      const assembly = await this.runStage(slug, "assembly", async () => {
        const data = await AssemblyManager.generateAssemblyPlan(
          script,
          scenes,
          visuals,
          audio,
          {
            project,
            animation,
            video,
          },
          {
            projectSlug: slug,
            stage: "assembly",
            operation: "assembly-plan",
          },
        );

        await ProjectManager.saveAssembly(slug, data);
        return data;
      });

      const thumbnail = await this.runStage(slug, "thumbnail", async () => {
        const data = await new ThumbnailEngine().generateThumbnailPlan({
          projectId: project.id,
          projectSlug: slug,
          title: project.title,
          assembly,
          video,
          audio,
        });

        await ProjectManager.saveThumbnail(slug, data);
        return data;
      });

      const seo = await this.runStage(slug, "seo", async () => {
        const data = await SEOManager.generateSEOData(
          project.title,
          script,
          thumbnail,
          {
            projectSlug: slug,
            stage: "seo",
            operation: "seo-plan",
          },
        );

        await ProjectManager.saveSEO(slug, data);
        return data;
      });

      const youtube = await this.runStage(slug, "youtube", async () => {
        const data = await new YouTubeEngine().generatePublishingPackage({
          projectId: project.id,
          projectSlug: slug,
          title: project.title,
          video,
          audio,
          assembly,
          thumbnail,
        });

        await ProjectManager.saveYouTube(slug, data);
        return data;
      });

      const exportPackage = await this.runStage(slug, "export", async () => {
        const data = await new ExportEngine().generateExportPackage({
          projectId: project.id,
          projectSlug: slug,
          title: project.title,
          project,
          video,
          audio,
          assembly,
          thumbnail,
          youtube,
          seo,
        });

        await ProjectManager.saveExport(slug, data);
        return data;
      });

      await ProjectManager.updateStatus(slug, "completed");

      return {
        success: true,
        slug,
        project,
        research,
        script,
        scenes,
        visuals,
        animation,
        video,
        audio,
        assembly,
        thumbnail,
        seo,
        youtube,
        export: exportPackage,
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
}
