import { Project, ResearchData, ScriptData, ScenesFile } from "@/types/project";
import { ProjectWriter } from "./ProjectWriter";
import { ProjectReader } from "./ProjectReader";

function createSlug(text: string) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[ğ]/g, "g")
    .replace(/[ü]/g, "u")
    .replace(/[ş]/g, "s")
    .replace(/[ı]/g, "i")
    .replace(/[ö]/g, "o")
    .replace(/[ç]/g, "c")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export class ProjectManager {
  static createSlug(text: string) {
    return createSlug(text);
  }

  static async createProject(topic: string): Promise<Project> {
    const now = new Date().toISOString();
    const slug = createSlug(topic);

    const project: Project = {
      id: crypto.randomUUID(),
      slug,
      title: topic,
      description: "",
      status: "draft",
      createdAt: now,
      updatedAt: now,
    };

    await ProjectWriter.writeJSON(slug, "project.json", project);

    return project;
  }

  static async saveProject(project: Project) {
    const updatedProject: Project = {
      ...project,
      updatedAt: new Date().toISOString(),
    };

    await ProjectWriter.writeJSON(
      updatedProject.slug,
      "project.json",
      updatedProject
    );

    return updatedProject;
  }

  static async getProject(slug: string) {
    return ProjectReader.readJSON<Project>(slug, "project.json");
  }

  static async saveResearch(slug: string, research: ResearchData) {
    await ProjectWriter.writeJSON(slug, "research.json", research);

    const project = await this.getProject(slug);

    if (project) {
      await this.saveProject({
        ...project,
        status: "research",
      });
    }
  }

  static async getResearch(slug: string) {
    return ProjectReader.readJSON<ResearchData>(slug, "research.json");
  }

  static async saveScript(slug: string, script: ScriptData) {
    await ProjectWriter.writeJSON(slug, "script.json", script);

    const project = await this.getProject(slug);

    if (project) {
      await this.saveProject({
        ...project,
        status: "script",
      });
    }
  }

  static async getScript(slug: string) {
    return ProjectReader.readJSON<ScriptData>(slug, "script.json");
  }

  static async saveScenes(slug: string, scenes: ScenesFile) {
    await ProjectWriter.writeJSON(slug, "scene.json", scenes);

    const project = await this.getProject(slug);

    if (project) {
      await this.saveProject({
        ...project,
        status: "scenes",
      });
    }
  }

  static async getScenes(slug: string) {
  return ProjectReader.readJSON<ScenesFile>(slug, "scene.json");
}

static async listProjects() {
  return [];
}
}