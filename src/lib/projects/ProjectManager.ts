import { ProjectWriter } from "./ProjectWriter";
import { ProjectReader } from "./ProjectReader";
import type { ProjectStatus } from "@/types/project";

export class ProjectManager {
  static createSlug(text: string) {
    return text
      .toLowerCase()
      .trim()
      .replace(/ğ/g, "g")
      .replace(/ü/g, "u")
      .replace(/ş/g, "s")
      .replace(/ı/g, "i")
      .replace(/ö/g, "o")
      .replace(/ç/g, "c")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  static async createProject(topic: string, description?: string) {
    const slug = this.createSlug(topic);
    const now = new Date().toISOString();

    const project = {
      id: crypto.randomUUID(),
      slug,
      title: topic,
      description,
      status: "draft" as ProjectStatus,
      createdAt: now,
      updatedAt: now,
    };

    await ProjectWriter.writeJSON(slug, "project.json", project);

    return project;
  }

  static async saveResearch(slug: string, research: unknown) {
    await ProjectWriter.writeJSON(slug, "research.json", research);
  }

  static async saveScript(slug: string, script: unknown) {
    await ProjectWriter.writeJSON(slug, "script.json", script);
  }

  static async saveScenes(slug: string, scenes: unknown) {
    await ProjectWriter.writeJSON(slug, "scenes.json", scenes);
  }

  static async saveVisuals(slug: string, visuals: unknown) {
    await ProjectWriter.writeJSON(slug, "visuals.json", visuals);
  }

  static async saveAudio(slug: string, audio: unknown) {
    await ProjectWriter.writeJSON(slug, "audio.json", audio);
  }

  static async getProject(slug: string) {
    return ProjectReader.readJSON(slug, "project.json");
  }

  static async getResearch(slug: string) {
    return ProjectReader.readJSON(slug, "research.json");
  }

  static async getScript(slug: string) {
    return ProjectReader.readJSON(slug, "script.json");
  }

  static async getScenes(slug: string) {
    return ProjectReader.readJSON(slug, "scenes.json");
  }

  static async getVisuals(slug: string) {
    return ProjectReader.readJSON(slug, "visuals.json");
  }

  static async getAudio(slug: string) {
    return ProjectReader.readJSON(slug, "audio.json");
  }

  static async updateStatus(slug: string, status: ProjectStatus) {
    const project = await this.getProject(slug);

    if (!project) {
      return null;
    }

    const updatedProject = {
      ...project,
      status,
      updatedAt: new Date().toISOString(),
    };

    await ProjectWriter.writeJSON(slug, "project.json", updatedProject);

    return updatedProject;
  }
}
