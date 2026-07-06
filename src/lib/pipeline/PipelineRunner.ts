import { ProjectManager } from "@/lib/projects/ProjectManager";
import { AIManager } from "@/lib/ai/AIManager";

export class PipelineRunner {
  static async run(topic: string) {
    const slug = ProjectManager.createSlug(topic);

    // 1. PROJE OLUŞTUR
    const project = await ProjectManager.createProject(topic);

    // 2. RESEARCH
    const research = await AIManager.runResearch(topic);
    await ProjectManager.saveResearch(slug, research);

    // 3. SCRIPT
    const script = await AIManager.runScript(topic);
    await ProjectManager.saveScript(slug, script);

    // 4. SCENES
    const scenes = await AIManager.runScenes(script);
    await ProjectManager.saveScenes(slug, scenes);

    return {
      success: true,
      slug,
      project,
      research,
      script,
      scenes,
    };
  }
}
