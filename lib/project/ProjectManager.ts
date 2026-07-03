import { FileStorage } from "@/lib/storage/FileStorage";
import type { Project, ResearchData, ScriptData } from "@/types/project";

const PROJECTS_ROOT = "data/projects";

function slugify(text: string) {
  return text
    .toLowerCase()
    .trim()
    .replaceAll("ı", "i")
    .replaceAll("ğ", "g")
    .replaceAll("ü", "u")
    .replaceAll("ş", "s")
    .replaceAll("ö", "o")
    .replaceAll("ç", "c")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function now() {
  return new Date().toISOString();
}

function projectPath(slug: string, file: string) {
  return `${PROJECTS_ROOT}/${slug}/${file}`;
}

export class ProjectManager {
  static createProject(title: string, description?: string): Project {
    const baseSlug = slugify(title);
    let slug = baseSlug;
    let counter = 1;

    while (FileStorage.exists(`${PROJECTS_ROOT}/${slug}`)) {
      slug = `${baseSlug}-${counter}`;
      counter++;
    }

    const project: Project = {
      id: slug,
      slug,
      title,
      description,
      status: "draft",
      createdAt: now(),
      updatedAt: now(),
    };

    FileStorage.saveJson(projectPath(slug, "project.json"), project);

    return project;
  }

  static listProjects(): Project[] {
    return FileStorage.listDirs(PROJECTS_ROOT)
      .map((slug) =>
        FileStorage.loadJson<Project>(projectPath(slug, "project.json"))
      )
      .filter((project): project is Project => Boolean(project))
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
  }

  static getProject(slug: string): Project | null {
    return FileStorage.loadJson<Project>(projectPath(slug, "project.json"));
  }

  static updateProject(project: Project): Project {
    const updatedProject: Project = {
      ...project,
      updatedAt: now(),
    };

    FileStorage.saveJson(
      projectPath(updatedProject.slug, "project.json"),
      updatedProject
    );

    return updatedProject;
  }

  static saveResearch(slug: string, research: ResearchData): ResearchData {
    const project = this.getProject(slug);

    if (!project) {
      throw new Error("Proje bulunamadı.");
    }

    FileStorage.saveJson(projectPath(slug, "research.json"), research);

    this.updateProject({
      ...project,
      status: "research",
    });

    return research;
  }

  static loadResearch(slug: string): ResearchData | null {
    return FileStorage.loadJson<ResearchData>(
      projectPath(slug, "research.json")
    );
  }

  static saveScript(slug: string, script: ScriptData): ScriptData {
    const project = this.getProject(slug);

    if (!project) {
      throw new Error("Proje bulunamadı.");
    }

    FileStorage.saveJson(projectPath(slug, "script.json"), script);

    this.updateProject({
      ...project,
      status: "script",
    });

    return script;
  }

  static loadScript(slug: string): ScriptData | null {
    return FileStorage.loadJson<ScriptData>(projectPath(slug, "script.json"));
  }
}