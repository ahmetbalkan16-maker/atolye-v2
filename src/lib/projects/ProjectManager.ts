import { ProjectWriter } from "./ProjectWriter";
import { ProjectReader } from "./ProjectReader";
import { validateYouTubePublishingPackage } from "@/lib/youtube/YouTubePackageValidation";
import { validateYouTubePublishRecord } from "@/lib/youtube/publish/YouTubePublishValidation";
import type {
  PackageStatus,
  ProductionStepKey,
  Project,
  ProjectManifest,
  ProjectPackageAttemptMetadata,
  ProjectPackageManifest,
  ProjectPackageRunType,
  ProjectPackageUsage,
  ProjectStatus,
} from "@/types/project";

type UpdatePackageStatusOptions = {
  runType?: ProjectPackageRunType;
};

export class ProjectManager {
  private static readonly packageFiles: Record<ProductionStepKey, string> = {
    research: "research.json",
    script: "script.json",
    scenes: "scenes.json",
    visuals: "visuals.json",
    animation: "animation.json",
    video: "video.json",
    audio: "audio.json",
    assembly: "assembly.json",
    thumbnail: "thumbnail.json",
    seo: "seo.json",
    youtube: "youtube.json",
    export: "export.json",
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
    options?: UpdatePackageStatusOptions,
  ) {
    const manifest = await this.ensureManifest(slug);

    if (!manifest) {
      return null;
    }

    const now = new Date().toISOString();
    const currentPackage = manifest.packages[packageKey];
    const startedAt =
      status === "running" ? now : currentPackage.startedAt;
    const completedAt =
      status === "completed" || status === "failed"
        ? now
        : undefined;
    const durationMs =
      startedAt && completedAt
        ? new Date(completedAt).getTime() - new Date(startedAt).getTime()
        : undefined;
    const attempts = this.updateAttemptMetadata(
      currentPackage.attempts,
      status,
      now,
      options?.runType,
    );
    const updatedPackage = this.createPackageManifest(
      packageKey,
      status,
      now,
      error,
    );

    const updatedManifest: ProjectManifest = {
      ...manifest,
      packages: {
        ...manifest.packages,
        [packageKey]: {
          ...updatedPackage,
          startedAt,
          completedAt,
          durationMs:
            typeof durationMs === "number" && durationMs >= 0
              ? durationMs
              : undefined,
          attempts,
          usage: currentPackage.usage,
        },
      },
      updatedAt: now,
    };

    await ProjectWriter.writeJSON(slug, "manifest.json", updatedManifest);

    return updatedManifest;
  }

  static async updatePackageUsage(
    slug: string,
    packageKey: ProductionStepKey,
    usage: ProjectPackageUsage,
  ) {
    const manifest = await this.ensureManifest(slug);

    if (!manifest) {
      return null;
    }

    const now = new Date().toISOString();
    const currentPackage = manifest.packages[packageKey];
    const nextUsage = this.mergePackageUsage(currentPackage.usage, usage, now);
    const updatedManifest: ProjectManifest = {
      ...manifest,
      packages: {
        ...manifest.packages,
        [packageKey]: {
          ...currentPackage,
          usage: nextUsage,
        },
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

  static async saveAnimation(slug: string, animation: unknown) {
    await ProjectWriter.writeJSON(slug, "animation.json", animation);
    await this.updatePackageStatus(slug, "animation", "completed");
  }

  static async saveVideo(slug: string, video: unknown) {
    await ProjectWriter.writeJSON(slug, "video.json", video);
    await this.updatePackageStatus(slug, "video", "completed");
  }

  static async saveAudio(slug: string, audio: unknown) {
    await ProjectWriter.writeJSON(slug, "audio.json", audio);
    await this.updatePackageStatus(slug, "audio", "completed");
  }

  static async saveThumbnail(slug: string, thumbnail: unknown) {
    await ProjectWriter.writeJSONAtomically(slug, "thumbnail.json", thumbnail);
    await this.updatePackageStatus(slug, "thumbnail", "completed");
  }

  static async saveSEO(slug: string, seo: unknown) {
    await ProjectWriter.writeJSON(slug, "seo.json", seo);
    await this.updatePackageStatus(slug, "seo", "completed");
  }

  static async saveYouTube(
    slug: string,
    youtube: unknown,
    options?: { reuseExisting?: boolean; updatePackageStatus?: boolean },
  ) {
    validateYouTubePublishingPackage(youtube, { slug });
    if (!options?.reuseExisting) {
      await ProjectWriter.writeJSONAtomically(slug, "youtube.json", youtube);
    }
    const readback = await ProjectReader.readJSON<unknown>(slug, "youtube.json");
    validateYouTubePublishingPackage(readback, { slug });
    if (JSON.stringify(readback) !== JSON.stringify(youtube)) {
      throw new Error("YouTube package persistence failed.");
    }
    if (options?.updatePackageStatus !== false) {
      await this.updatePackageStatus(slug, "youtube", "completed");
    }
  }

  static async saveYouTubePublish(slug: string, publish: unknown) {
    validateYouTubePublishRecord(publish, { slug });
    await ProjectWriter.writeJSONAtomically(slug, "youtube-publish.json", publish);
    const readback = await ProjectReader.readJSON<unknown>(slug, "youtube-publish.json");
    validateYouTubePublishRecord(readback, { slug });
    if (JSON.stringify(readback) !== JSON.stringify(publish)) {
      throw new Error("YouTube publish persistence failed.");
    }
  }

  static async saveYouTubePublishRecovery(slug: string, publish: unknown) {
    validateYouTubePublishRecord(publish, { slug });
    if ((publish as { status?: unknown }).status !== "published") {
      throw new Error("YouTube publish recovery record is invalid.");
    }
    await ProjectWriter.writeJSONAtomically(
      slug,
      "youtube-publish-recovery.json",
      publish,
    );
    const readback = await ProjectReader.readJSON<unknown>(
      slug,
      "youtube-publish-recovery.json",
    );
    validateYouTubePublishRecord(readback, { slug });
    if (
      (readback as { status?: unknown }).status !== "published" ||
      JSON.stringify(readback) !== JSON.stringify(publish)
    ) {
      throw new Error("YouTube publish recovery persistence failed.");
    }
  }

  static getYouTubePublishState(slug: string) {
    return ProjectReader.readJSONState<unknown>(slug, "youtube-publish.json");
  }

  static getYouTubePublishRecoveryState(slug: string) {
    return ProjectReader.readJSONState<unknown>(
      slug,
      "youtube-publish-recovery.json",
    );
  }

  static async getYouTubePublish(slug: string) {
    return ProjectReader.readJSON(slug, "youtube-publish.json");
  }

  static async removeYouTubePublish(slug: string) {
    await ProjectWriter.removeJSON(slug, "youtube-publish.json");
  }

  static async removeYouTubePublishRecovery(slug: string) {
    await ProjectWriter.removeJSON(slug, "youtube-publish-recovery.json");
  }

  static async markYouTubePublished(slug: string) {
    await this.updatePackageStatus(slug, "youtube", "completed");
  }

  static async removeYouTube(slug: string) {
    await ProjectWriter.removeJSON(slug, "youtube.json");
  }

  static async restoreYouTube(slug: string, youtube: unknown) {
    validateYouTubePublishingPackage(youtube, { slug });
    await ProjectWriter.writeJSONAtomically(slug, "youtube.json", youtube);
  }

  static async saveExport(slug: string, exportPackage: unknown) {
    await ProjectWriter.writeJSON(slug, "export.json", exportPackage);
    await this.updatePackageStatus(slug, "export", "completed");
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

  static async getAnimation(slug: string) {
    return ProjectReader.readJSON(slug, "animation.json");
  }

  static async getVideo(slug: string) {
    return ProjectReader.readJSON(slug, "video.json");
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

  static async getYouTube(slug: string) {
    return ProjectReader.readJSON(slug, "youtube.json");
  }

  static async getExport(slug: string) {
    return ProjectReader.readJSON(slug, "export.json");
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
          const packageManifest = this.createPackageManifest(
            key,
            this.normalizePackageStatus(packageValue.status),
            typeof packageValue.updatedAt === "string"
              ? packageValue.updatedAt
              : undefined,
            typeof packageValue.error === "string"
              ? packageValue.error
              : undefined,
          );
          const startedAt =
            typeof packageValue.startedAt === "string"
              ? packageValue.startedAt
              : undefined;
          const completedAt =
            typeof packageValue.completedAt === "string"
              ? packageValue.completedAt
              : undefined;
          const durationMs =
            typeof packageValue.durationMs === "number" &&
            Number.isFinite(packageValue.durationMs)
              ? packageValue.durationMs
              : undefined;
          const usage = this.normalizePackageUsage(packageValue.usage);
          const attempts = this.normalizeAttemptMetadata(
            packageValue.attempts,
          );

          acc[key] = {
            ...packageManifest,
            startedAt,
            completedAt,
            durationMs,
            attempts,
            usage,
          };

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

  private static normalizePackageUsage(
    value: unknown,
  ): ProjectPackageUsage | undefined {
    if (!this.isRecord(value)) {
      return undefined;
    }

    const usage: ProjectPackageUsage = {
      provider: typeof value.provider === "string" ? value.provider : undefined,
      model: typeof value.model === "string" ? value.model : undefined,
      operation:
        typeof value.operation === "string" ? value.operation : undefined,
      status: typeof value.status === "string" ? value.status : undefined,
      fallbackUsed:
        typeof value.fallbackUsed === "boolean"
          ? value.fallbackUsed
          : undefined,
      requestCount: this.getOptionalNumber(value.requestCount),
      durationMs: this.getOptionalNumber(value.durationMs),
      promptTokens: this.getOptionalNumber(value.promptTokens),
      completionTokens: this.getOptionalNumber(value.completionTokens),
      totalTokens: this.getOptionalNumber(value.totalTokens),
      estimatedCost: this.getOptionalNumber(value.estimatedCost),
      updatedAt:
        typeof value.updatedAt === "string" ? value.updatedAt : undefined,
    };

    return Object.values(usage).some((usageValue) => usageValue !== undefined)
      ? usage
      : undefined;
  }

  private static getOptionalNumber(value: unknown) {
    return typeof value === "number" && Number.isFinite(value)
      ? value
      : undefined;
  }

  private static normalizeAttemptMetadata(
    value: unknown,
  ): ProjectPackageAttemptMetadata | undefined {
    if (!this.isRecord(value)) {
      return undefined;
    }

    const total = this.getOptionalNumber(value.total);
    const retry = this.getOptionalNumber(value.retry);

    if (total === undefined && retry === undefined) {
      return undefined;
    }

    const lastRunType = this.normalizeRunType(value.lastRunType);

    return {
      total: total ?? 0,
      retry: retry ?? 0,
      lastAttemptAt:
        typeof value.lastAttemptAt === "string"
          ? value.lastAttemptAt
          : undefined,
      lastRunType,
    };
  }

  private static updateAttemptMetadata(
    current: ProjectPackageAttemptMetadata | undefined,
    status: PackageStatus,
    now: string,
    runType?: ProjectPackageRunType,
  ): ProjectPackageAttemptMetadata | undefined {
    if (status !== "running") {
      return current;
    }

    const nextRunType = runType ?? current?.lastRunType ?? "initial";
    const total = (current?.total ?? 0) + 1;
    const retry = (current?.retry ?? 0) + (nextRunType === "retry" ? 1 : 0);

    return {
      total,
      retry,
      lastAttemptAt: now,
      lastRunType: nextRunType,
    };
  }

  private static mergePackageUsage(
    current: ProjectPackageUsage | undefined,
    next: ProjectPackageUsage,
    now: string,
  ): ProjectPackageUsage {
    return {
      ...current,
      ...next,
      requestCount: (current?.requestCount ?? 0) + 1,
      updatedAt: now,
    };
  }

  private static normalizeRunType(
    value: unknown,
  ): ProjectPackageRunType | undefined {
    if (value === "initial" || value === "resume" || value === "retry") {
      return value;
    }

    return undefined;
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
      "animation",
      "video",
      "audio",
      "assembly",
      "thumbnail",
      "seo",
      "youtube",
      "export",
    ];
  }

  private static isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object";
  }
}
