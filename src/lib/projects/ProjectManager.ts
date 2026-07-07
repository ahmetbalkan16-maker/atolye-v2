import { ProjectWriter } from "./ProjectWriter";
import { ProjectReader } from "./ProjectReader";
import type {
  PackageStatus,
  ProductionStepKey,
  Project,
  ProjectManifest,
  ProjectPackageManifest,
  ProjectStatus,
} from "@/types/project";

export class ProjectManager {
  private static readonly packageFiles: Record<ProductionStepKey, string> = {
    research: "research.json",
    script: "script.json",
    scenes: "scenes.json",
    visuals: "visuals.json",
    audio: "audio.json",
    thumbnail: "thumbnail.json",
    seo: "seo.json",
    assembly: "assembly.json",
  };

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

    const project: Project = {
      id: crypto.randomUUID(),
      slug,
      title: topic,
      description,
      status: "draft" as ProjectStatus,
      createdAt: now,
      updatedAt: now,
    };

    await ProjectWriter.writeJSON(slug, "project.json", project);
    await this.createManifest(project);

    return project;
  }

  static async createManifest(project: Project) {
    const now = new Date().toISOString();
    const manifest = this.createBaseManifest(project, "pending", now);

    await ProjectWriter.writeJSON(project.slug, "manifest.json", manifest);

    return manifest;
  }

  static async getManifest(slug: string) {
    const storedManifest = await ProjectReader.readJSON<unknown>(
      slug,
      "manifest.json",
    );

    if (!storedManifest) {
      return null;
    }

    const project =
      (await this.getProject(slug)) ??
      this.getProjectFromManifest(storedManifest);

    if (!project) {
      return null;
    }

    return this.normalizeManifest(storedManifest, project);
  }

  static async ensureManifest(slug: string) {
    const manifest = await this.getManifest(slug);

    if (manifest) {
      return manifest;
    }

    return this.syncManifestFromFiles(slug);
  }

  static async syncManifestFromFiles(slug: string) {
    const project = await this.getProject(slug);

    if (!project) {
      return null;
    }

    const now = new Date().toISOString();
    const manifest = this.createBaseManifest(project, "missing", now);

    await Promise.all(
      this.getProductionStepKeys().map(async (key) => {
        const data = await ProjectReader.readJSON<unknown>(
          slug,
          this.packageFiles[key],
        );

        const isCompleted = data !== null;

        manifest.packages[key] = this.createPackageManifest(
          key,
          isCompleted ? "completed" : "missing",
          isCompleted ? now : undefined,
        );
      }),
    );

    manifest.updatedAt = now;

    await ProjectWriter.writeJSON(slug, "manifest.json", manifest);

    return manifest;
  }

  static async updatePackageStatus(
    slug: string,
    packageKey: ProductionStepKey,
    status: PackageStatus,
    error?: string,
  ) {
    const manifest = await this.ensureManifest(slug);

    if (!manifest) {
      return null;
    }

    const now = new Date().toISOString();
    const updatedManifest: ProjectManifest = {
      ...manifest,
      packages: {
        ...manifest.packages,
        [packageKey]: this.createPackageManifest(
          packageKey,
          status,
          now,
          error,
        ),
      },
      updatedAt: now,
    };

    await ProjectWriter.writeJSON(slug, "manifest.json", updatedManifest);

    return updatedManifest;
  }

  static async saveResearch(slug: string, research: unknown) {
    await ProjectWriter.writeJSON(slug, "research.json", research);
    await this.updatePackageStatus(slug, "research", "completed");
  }

  static async saveScript(slug: string, script: unknown) {
    await ProjectWriter.writeJSON(slug, "script.json", script);
    await this.updatePackageStatus(slug, "script", "completed");
  }

  static async saveScenes(slug: string, scenes: unknown) {
    await ProjectWriter.writeJSON(slug, "scenes.json", scenes);
    await this.updatePackageStatus(slug, "scenes", "completed");
  }

  static async saveVisuals(slug: string, visuals: unknown) {
    await ProjectWriter.writeJSON(slug, "visuals.json", visuals);
    await this.updatePackageStatus(slug, "visuals", "completed");
  }

  static async saveAudio(slug: string, audio: unknown) {
    await ProjectWriter.writeJSON(slug, "audio.json", audio);
    await this.updatePackageStatus(slug, "audio", "completed");
  }

  static async saveThumbnail(slug: string, thumbnail: unknown) {
    await ProjectWriter.writeJSON(slug, "thumbnail.json", thumbnail);
    await this.updatePackageStatus(slug, "thumbnail", "completed");
  }

  static async saveSEO(slug: string, seo: unknown) {
    await ProjectWriter.writeJSON(slug, "seo.json", seo);
    await this.updatePackageStatus(slug, "seo", "completed");
  }

  static async saveAssembly(slug: string, assembly: unknown) {
    await ProjectWriter.writeJSON(slug, "assembly.json", assembly);
    await this.updatePackageStatus(slug, "assembly", "completed");
  }

  static async getProject(slug: string) {
    return ProjectReader.readJSON<Project>(slug, "project.json");
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

  static async getThumbnail(slug: string) {
    return ProjectReader.readJSON(slug, "thumbnail.json");
  }

  static async getSEO(slug: string) {
    return ProjectReader.readJSON(slug, "seo.json");
  }

  static async getAssembly(slug: string) {
    return ProjectReader.readJSON(slug, "assembly.json");
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

  private static createBaseManifest(
    project: Project,
    defaultStatus: PackageStatus,
    now: string,
  ): ProjectManifest {
    const packages = this.getProductionStepKeys().reduce(
      (acc, key) => ({
        ...acc,
        [key]: this.createPackageManifest(key, defaultStatus),
      }),
      {} as Record<ProductionStepKey, ProjectPackageManifest>,
    );

    return {
      project,
      projectId: project.id,
      slug: project.slug,
      version: 1,
      packages,
      createdAt: project.createdAt,
      updatedAt: now,
    };
  }

  private static createPackageManifest(
    key: ProductionStepKey,
    status: PackageStatus,
    updatedAt?: string,
    error?: string,
  ): ProjectPackageManifest {
    return {
      key,
      status,
      fileName: this.packageFiles[key],
      updatedAt,
      error,
    };
  }

  private static normalizeManifest(
    value: unknown,
    project: Project,
  ): ProjectManifest {
    const record = this.isRecord(value) ? value : {};
    const updatedAt =
      typeof record.updatedAt === "string" ? record.updatedAt : project.updatedAt;
    const createdAt =
      typeof record.createdAt === "string" ? record.createdAt : project.createdAt;
    const packages = this.normalizePackages(record.packages, updatedAt);

    return {
      project,
      projectId:
        typeof record.projectId === "string" ? record.projectId : project.id,
      slug: typeof record.slug === "string" ? record.slug : project.slug,
      version: 1,
      packages,
      createdAt,
      updatedAt,
    };
  }

  private static normalizePackages(
    value: unknown,
    manifestUpdatedAt: string,
  ): Record<ProductionStepKey, ProjectPackageManifest> {
    const record = this.isRecord(value) ? value : {};

    return this.getProductionStepKeys().reduce(
      (acc, key) => {
        const packageValue = record[key];

        if (typeof packageValue === "boolean") {
          acc[key] = this.createPackageManifest(
            key,
            packageValue ? "completed" : "missing",
            packageValue ? manifestUpdatedAt : undefined,
          );

          return acc;
        }

        if (this.isRecord(packageValue)) {
          acc[key] = this.createPackageManifest(
            key,
            this.normalizePackageStatus(packageValue.status),
            typeof packageValue.updatedAt === "string"
              ? packageValue.updatedAt
              : undefined,
            typeof packageValue.error === "string"
              ? packageValue.error
              : undefined,
          );

          return acc;
        }

        acc[key] = this.createPackageManifest(key, "missing");
        return acc;
      },
      {} as Record<ProductionStepKey, ProjectPackageManifest>,
    );
  }

  private static normalizePackageStatus(value: unknown): PackageStatus {
    if (
      value === "pending" ||
      value === "running" ||
      value === "completed" ||
      value === "failed" ||
      value === "missing"
    ) {
      return value;
    }

    return "missing";
  }

  private static getProjectFromManifest(value: unknown): Project | null {
    if (!this.isRecord(value) || !this.isRecord(value.project)) {
      return null;
    }

    const project = value.project;

    if (
      typeof project.id !== "string" ||
      typeof project.slug !== "string" ||
      typeof project.title !== "string" ||
      typeof project.status !== "string" ||
      typeof project.createdAt !== "string" ||
      typeof project.updatedAt !== "string"
    ) {
      return null;
    }

    return {
      id: project.id,
      slug: project.slug,
      title: project.title,
      description:
        typeof project.description === "string" ? project.description : undefined,
      status: project.status as ProjectStatus,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    };
  }

  private static getProductionStepKeys(): ProductionStepKey[] {
    return [
      "research",
      "script",
      "scenes",
      "visuals",
      "audio",
      "thumbnail",
      "seo",
      "assembly",
    ];
  }

  private static isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object";
  }
}
