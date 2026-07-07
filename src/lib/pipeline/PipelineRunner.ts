import { AIManager } from "@/lib/ai/AIManager";
import { AudioManager } from "@/lib/audio/AudioManager";
import { ProjectManager } from "@/lib/projects/ProjectManager";
import { VisualManager } from "@/lib/visuals/VisualManager";

export class PipelineRunner {
  static async run(topic: string) {
    const slug = ProjectManager.createSlug(topic);
    const project = await ProjectManager.createProject(topic);

    try {
      await ProjectManager.updateStatus(slug, "research");
      const research = await AIManager.runResearch(topic);
      await ProjectManager.saveResearch(slug, research);

      await ProjectManager.updateStatus(slug, "script");
      const script = await AIManager.runScript(topic);
      await ProjectManager.saveScript(slug, script);

      await ProjectManager.updateStatus(slug, "scenes");
      const scenes = await AIManager.runScenes(script);
      await ProjectManager.saveScenes(slug, scenes);

      await ProjectManager.updateStatus(slug, "visuals");
      const visuals = await VisualManager.generateVisualData({
        projectId: project.id,
        scenes,
      });
      await ProjectManager.saveVisuals(slug, visuals);

      await ProjectManager.updateStatus(slug, "audio");
      const audio = await AudioManager.generateAudioData(script);
      await ProjectManager.saveAudio(slug, audio);

      await ProjectManager.updateStatus(slug, "completed");

      return {
        success: true,
        slug,
        project,
        research,
        script,
        scenes,
        visuals,
        audio,
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
}
