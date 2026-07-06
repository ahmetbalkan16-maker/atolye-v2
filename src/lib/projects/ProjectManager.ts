import { ProjectWriter } from "./ProjectWriter";
import { ProjectReader } from "./ProjectReader";

export class ProjectManager {
  static createSlug(text: string) {
    return text
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-");
  }

  static async createProject(topic: string) {
    const slug = this.createSlug(topic);

    const project = {
      id: crypto.randomUUID(),
      slug,
      title: topic,
      status: "draft",
      createdAt: new Date().toISOString(),
    };

    await ProjectWriter.writeJSON(slug, "project.json", project);

    return project;
  }

  static async saveResearch(slug: string, research: any) {
    await ProjectWriter.writeJSON(slug, "research.json", research);
  }

  static async getProject(slug: string) {
    return ProjectReader.readJSON(slug, "project.json");
  }

  static async getResearch(slug: string) {
    return ProjectReader.readJSON(slug, "research.json");
  }
}