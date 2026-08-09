import { ProjectWriter } from "./ProjectWriter";
import { ProjectReader } from "./ProjectReader";
import { validateYouTubePublishingPackage } from "@/lib/youtube/YouTubePackageValidation";
import { validateYouTubePublishRecord } from "@/lib/youtube/publish/YouTubePublishValidation";
import { isPipelineErrorEvidence } from "@/lib/pipeline/PipelineErrorEvidence";
import type { PipelineErrorEvidence } from "@/types/errorEvidence";
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
import { isRegenerationPackageCanonical, recordRegeneratedPackageCompletion,
  validateRegeneratedPackageCompletionPrecommit } from
  "@/lib/production/ProductionCompletedStageRegenerationStore";
import type { RuntimeStorageContext } from "@/lib/runtime/RuntimeStoragePaths";

type UpdatePackageStatusOptions = {
  runType?: ProjectPackageRunType;
  errorEvidence?: PipelineErrorEvidence;
};

export class ScriptArtifactConflictError extends Error {
  readonly code = "SCRIPT_ARTIFACT_CONFLICT";

  constructor() {
    super("Persisted script artifact conflicts with the proposed artifact.");
    this.name = "ScriptArtifactConflictError";
    this.stack = undefined;
  }
}

export class ScenesArtifactConflictError extends Error {
  readonly code = "SCENES_ARTIFACT_CONFLICT";

  constructor() {
    super("Persisted scenes artifact conflicts with the proposed artifact.");
    this.name = "ScenesArtifactConflictError";
    this.stack = undefined;
  }
}

export class VisualsArtifactConflictError extends Error {
  readonly code = "VISUALS_ARTIFACT_CONFLICT";

  constructor() {
    super("Persisted visuals artifact conflicts with the proposed artifact.");
    this.name = "VisualsArtifactConflictError";
    this.stack = undefined;
  }
}

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

  static async getManifest(slug: string, context?: RuntimeStorageContext) {
    const storedManifest = await ProjectReader.readJSON<unknown>(
      slug,
      "manifest.json", context,
    );

    if (!storedManifest) {
      return null;
    }

    const project =
      (await this.getProject(slug, context)) ??
      this.getProjectFromManifest(storedManifest);

    if (!project) {
      return null;
    }

    return this.normalizeManifest(storedManifest, project);
  }

  static async ensureManifest(slug: string, context?: RuntimeStorageContext) {
    const manifest = await this.getManifest(slug, context);

    if (manifest) {
      return manifest;
    }

    return this.syncManifestFromFiles(slug, context);
  }

  static async syncManifestFromFiles(slug: string, context?: RuntimeStorageContext) {
    const project = await this.getProject(slug, context);

    if (!project) {
      return null;
    }

    const now = new Date().toISOString();
    const manifest = this.createBaseManifest(project, "missing", now);

    await Promise.all(
      this.getProductionStepKeys().map(async (key) => {
        const data = await ProjectReader.readJSON<unknown>(
          slug,
          this.packageFiles[key], context,
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

    await ProjectWriter.writeJSON(slug, "manifest.json", manifest, context);

    return manifest;
  }

  static async updatePackageStatus(
    slug: string,
    packageKey: ProductionStepKey,
    status: PackageStatus,
    error?: string,
    options?: UpdatePackageStatusOptions,
    context?: RuntimeStorageContext,
  ) {
    const manifest = await this.ensureManifest(slug, context);

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
          errorEvidence: options?.errorEvidence,
          generationOrdinal: currentPackage.generationOrdinal,
          regenerationId: currentPackage.regenerationId,
        },
      },
      updatedAt: now,
    };

    await ProjectWriter.writeJSON(slug, "manifest.json", updatedManifest, context);

    return updatedManifest;
  }

  static async updatePackageUsage(
    slug: string,
    packageKey: ProductionStepKey,
    usage: ProjectPackageUsage,
    context?: RuntimeStorageContext,
  ) {
    const manifest = await this.ensureManifest(slug, context);

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

    await ProjectWriter.writeJSON(slug, "manifest.json", updatedManifest, context);

    return updatedManifest;
  }

  static async saveResearch(slug: string, research: unknown, context?: RuntimeStorageContext) {
    await ProjectWriter.writeJSON(slug, "research.json", research, context);
    await this.updatePackageStatus(slug, "research", "completed", undefined, undefined, context);
  }

  static async saveScript(slug: string, script: unknown, context?: RuntimeStorageContext) {
    const existing = await ProjectReader.readJSON<unknown>(slug, "script.json", context);
    if (existing !== null) {
      if (JSON.stringify(existing) !== JSON.stringify(script)) {
        throw new ScriptArtifactConflictError();
      }
      return;
    }
    try {
      await ProjectWriter.writeJSONOnce(slug, "script.json", script, context);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const raced = await ProjectReader.readJSON<unknown>(slug, "script.json", context);
      if (JSON.stringify(raced) !== JSON.stringify(script)) {
        throw new ScriptArtifactConflictError();
      }
      return;
    }
    await this.updatePackageStatus(slug, "script", "completed", undefined, undefined, context);
  }

  static async saveScenes(slug: string, scenes: unknown, context?: RuntimeStorageContext) {
    const existing = await ProjectReader.readJSON<unknown>(slug, "scenes.json", context);
    if (existing !== null) {
      if (JSON.stringify(existing) !== JSON.stringify(scenes)) {
        throw new ScenesArtifactConflictError();
      }
      return;
    }
    try {
      await ProjectWriter.writeJSONOnce(slug, "scenes.json", scenes, context);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const raced = await ProjectReader.readJSON<unknown>(slug, "scenes.json", context);
      if (JSON.stringify(raced) !== JSON.stringify(scenes)) {
        throw new ScenesArtifactConflictError();
      }
      return;
    }
    await this.updatePackageStatus(slug, "scenes", "completed", undefined, undefined, context);
  }

  static async saveVisuals(slug: string, visuals: unknown, context?: RuntimeStorageContext) {
    await this.persistVisualsArtifact(slug, visuals, context);
    await this.updatePackageStatus(slug, "visuals", "completed", undefined, undefined, context);
  }

  static async persistVisualsArtifact(slug: string, visuals: unknown, context?: RuntimeStorageContext) {
    const existing = await ProjectReader.readJSON<unknown>(slug, "visuals.json", context);
    if (existing !== null) {
      if (JSON.stringify(existing) !== JSON.stringify(visuals)) throw new VisualsArtifactConflictError();
      return;
    }
    try {
      await ProjectWriter.writeJSONOnce(slug, "visuals.json", visuals, context);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const raced = await ProjectReader.readJSON<unknown>(slug, "visuals.json", context);
      if (JSON.stringify(raced) !== JSON.stringify(visuals)) throw new VisualsArtifactConflictError();
    }
  }

  static async saveAnimation(slug: string, animation: unknown, context?: RuntimeStorageContext) {
    await ProjectWriter.writeJSON(slug, "animation.json", animation, context);
    await this.updatePackageStatus(slug, "animation", "completed", undefined, undefined, context);
  }

  static async saveVideo(slug: string, video: unknown, context?: RuntimeStorageContext) {
    validateRegeneratedPackageCompletionPrecommit(slug, "video", context);
    await ProjectWriter.writeJSON(slug, "video.json", video, context);
    await this.updatePackageStatus(slug, "video", "completed", undefined, undefined, context);
    recordRegeneratedPackageCompletion(
      slug, "video", `${ProjectReader.getProjectFolder(slug, context)}/video.json`, context);
  }

  static async saveAudio(slug: string, audio: unknown, context?: RuntimeStorageContext) {
    await ProjectWriter.writeJSON(slug, "audio.json", audio, context);
    await this.updatePackageStatus(slug, "audio", "completed", undefined, undefined, context);
  }

  static async saveThumbnail(slug: string, thumbnail: unknown, context?: RuntimeStorageContext) {
    await ProjectWriter.writeJSONAtomically(slug, "thumbnail.json", thumbnail, context);
    await this.updatePackageStatus(slug, "thumbnail", "completed", undefined, undefined, context);
    recordRegeneratedPackageCompletion(
      slug, "thumbnail", `${ProjectReader.getProjectFolder(slug, context)}/thumbnail.json`, context);
  }

  static async saveSEO(slug: string, seo: unknown, context?: RuntimeStorageContext) {
    await ProjectWriter.writeJSON(slug, "seo.json", seo, context);
    await this.updatePackageStatus(slug, "seo", "completed", undefined, undefined, context);
    recordRegeneratedPackageCompletion(
      slug, "seo", `${ProjectReader.getProjectFolder(slug, context)}/seo.json`, context);
  }

  static async saveYouTube(
    slug: string,
    youtube: unknown,
    options?: { reuseExisting?: boolean; updatePackageStatus?: boolean },
    context?: RuntimeStorageContext,
  ) {
    validateYouTubePublishingPackage(youtube, { slug });
    if (!options?.reuseExisting) {
      await ProjectWriter.writeJSONAtomically(slug, "youtube.json", youtube, context);
    }
    const readback = await ProjectReader.readJSON<unknown>(slug, "youtube.json", context);
    validateYouTubePublishingPackage(readback, { slug });
    if (JSON.stringify(readback) !== JSON.stringify(youtube)) {
      throw new Error("YouTube package persistence failed.");
    }
    if (options?.updatePackageStatus !== false) {
      await this.updatePackageStatus(slug, "youtube", "completed", undefined, undefined, context);
      recordRegeneratedPackageCompletion(
        slug, "youtube", `${ProjectReader.getProjectFolder(slug, context)}/youtube.json`, context);
    }
  }

  static async saveYouTubePublish(slug: string, publish: unknown, context?: RuntimeStorageContext) {
    validateYouTubePublishRecord(publish, { slug });
    await ProjectWriter.writeJSONAtomically(slug, "youtube-publish.json", publish, context);
    const readback = await ProjectReader.readJSON<unknown>(slug, "youtube-publish.json", context);
    validateYouTubePublishRecord(readback, { slug });
    if (JSON.stringify(readback) !== JSON.stringify(publish)) {
      throw new Error("YouTube publish persistence failed.");
    }
  }

  static async saveYouTubePublishRecovery(slug: string, publish: unknown, context?: RuntimeStorageContext) {
    validateYouTubePublishRecord(publish, { slug });
    if ((publish as { status?: unknown }).status !== "published") {
      throw new Error("YouTube publish recovery record is invalid.");
    }
    await ProjectWriter.writeJSONAtomically(
      slug,
      "youtube-publish-recovery.json",
      publish,
      context,
    );
    const readback = await ProjectReader.readJSON<unknown>(
      slug,
      "youtube-publish-recovery.json",
      context,
    );
    validateYouTubePublishRecord(readback, { slug });
    if (
      (readback as { status?: unknown }).status !== "published" ||
      JSON.stringify(readback) !== JSON.stringify(publish)
    ) {
      throw new Error("YouTube publish recovery persistence failed.");
    }
  }

  static getYouTubePublishState(slug: string, context?: RuntimeStorageContext) {
    return ProjectReader.readJSONState<unknown>(slug, "youtube-publish.json", context);
  }

  static getYouTubePublishRecoveryState(slug: string, context?: RuntimeStorageContext) {
    return ProjectReader.readJSONState<unknown>(
      slug,
      "youtube-publish-recovery.json",
      context,
    );
  }

  static async getYouTubePublish(slug: string, context?: RuntimeStorageContext) {
    return ProjectReader.readJSON(slug, "youtube-publish.json", context);
  }

  static async removeYouTubePublish(slug: string, context?: RuntimeStorageContext) {
    await ProjectWriter.removeJSON(slug, "youtube-publish.json", context);
  }

  static async removeYouTubePublishRecovery(slug: string, context?: RuntimeStorageContext) {
    await ProjectWriter.removeJSON(slug, "youtube-publish-recovery.json", context);
  }

  static async markYouTubePublished(slug: string, context?: RuntimeStorageContext) {
    await this.updatePackageStatus(slug, "youtube", "completed", undefined, undefined, context);
  }

  static async removeYouTube(slug: string, context?: RuntimeStorageContext) {
    await ProjectWriter.removeJSON(slug, "youtube.json", context);
  }

  static async restoreYouTube(slug: string, youtube: unknown, context?: RuntimeStorageContext) {
    validateYouTubePublishingPackage(youtube, { slug });
    await ProjectWriter.writeJSONAtomically(slug, "youtube.json", youtube, context);
  }

  static async saveExport(slug: string, exportPackage: unknown, context?: RuntimeStorageContext) {
    await ProjectWriter.writeJSON(slug, "export.json", exportPackage, context);
    await this.updatePackageStatus(slug, "export", "completed", undefined, undefined, context);
    recordRegeneratedPackageCompletion(
      slug, "export", `${ProjectReader.getProjectFolder(slug, context)}/export.json`, context);
  }

  static async saveAssembly(slug: string, assembly: unknown, context?: RuntimeStorageContext) {
    validateRegeneratedPackageCompletionPrecommit(slug, "assembly", context);
    await ProjectWriter.writeJSON(slug, "assembly.json", assembly, context);
    await this.updatePackageStatus(slug, "assembly", "completed", undefined, undefined, context);
    recordRegeneratedPackageCompletion(
      slug, "assembly", `${ProjectReader.getProjectFolder(slug, context)}/assembly.json`, context);
  }

  static async getProject(slug: string, context?: RuntimeStorageContext) {
    return ProjectReader.readJSON<Project>(slug, "project.json", context);
  }

  static async getResearch(slug: string, context?: RuntimeStorageContext) {
    return ProjectReader.readJSON(slug, "research.json", context);
  }

  static async getScript(slug: string, context?: RuntimeStorageContext) {
    return ProjectReader.readJSON(slug, "script.json", context);
  }

  static async getScenes(slug: string, context?: RuntimeStorageContext) {
    return ProjectReader.readJSON(slug, "scenes.json", context);
  }

  static async getVisuals(slug: string, context?: RuntimeStorageContext) {
    return ProjectReader.readJSON(slug, "visuals.json", context);
  }

  static async getAnimation(slug: string, context?: RuntimeStorageContext) {
    return ProjectReader.readJSON(slug, "animation.json", context);
  }

  static async getVideo(slug: string, context?: RuntimeStorageContext) {
    return this.readGenerationAwarePackage(slug, "video", "video.json", context);
  }

  static async getAudio(slug: string, context?: RuntimeStorageContext) {
    return ProjectReader.readJSON(slug, "audio.json", context);
  }

  static async getThumbnail(slug: string, context?: RuntimeStorageContext) {
    return this.readGenerationAwarePackage(slug, "thumbnail", "thumbnail.json", context);
  }

  static async getSEO(slug: string, context?: RuntimeStorageContext) {
    return this.readGenerationAwarePackage(slug, "seo", "seo.json", context);
  }

  static async getYouTube(slug: string, context?: RuntimeStorageContext) {
    return this.readGenerationAwarePackage(slug, "youtube", "youtube.json", context);
  }

  static async getExport(slug: string, context?: RuntimeStorageContext) {
    return this.readGenerationAwarePackage(slug, "export", "export.json", context);
  }

  static async getAssembly(slug: string, context?: RuntimeStorageContext) {
    return this.readGenerationAwarePackage(slug, "assembly", "assembly.json", context);
  }

  private static async readGenerationAwarePackage(
    slug: string,
    stage: Extract<ProductionStepKey, "video" | "assembly" | "thumbnail" | "seo" | "youtube" | "export">,
    fileName: string,
    context?: RuntimeStorageContext,
  ) {
    const data = await ProjectReader.readJSON(slug, fileName, context);
    if (data === null) return null;
    const packagePath = `${ProjectReader.getProjectFolder(slug, context)}/${fileName}`;
    return isRegenerationPackageCanonical(slug, stage, packagePath, context) ? data : null;
  }

  static async updateStatus(slug: string, status: ProjectStatus, context?: RuntimeStorageContext) {
    const project = await this.getProject(slug, context);

    if (!project) {
      return null;
    }

    const updatedProject = {
      ...project,
      status,
      updatedAt: new Date().toISOString(),
    };

    await ProjectWriter.writeJSON(slug, "project.json", updatedProject, context);

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
          const errorEvidence = isPipelineErrorEvidence(packageValue.errorEvidence)
            ? packageValue.errorEvidence
            : undefined;
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
            errorEvidence,
            generationOrdinal:
              typeof packageValue.generationOrdinal === "number" &&
                Number.isSafeInteger(packageValue.generationOrdinal) &&
                packageValue.generationOrdinal >= 0
                ? packageValue.generationOrdinal
                : undefined,
            regenerationId:
              typeof packageValue.regenerationId === "string"
                ? packageValue.regenerationId
                : undefined,
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
