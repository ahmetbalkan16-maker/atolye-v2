import { AssetManager } from "@/lib/assets/AssetManager";
import fs from "node:fs";
import { AudioStorage } from "@/lib/assets/storage/AudioStorage";
import { ImageStorage } from "@/lib/assets/storage/ImageStorage";
import { VideoStorage } from "@/lib/assets/storage/VideoStorage";
import { ThumbnailStorage } from "@/lib/thumbnail/ThumbnailStorage";
import { PipelineJobManager } from "@/lib/pipeline/PipelineJobManager";
import { pipelineRecoveryStageOrder } from "@/lib/pipeline/PipelineRecoveryPlanner";
import { ProjectManager } from "@/lib/projects/ProjectManager";
import type { Asset } from "@/types/asset";
import type { ProductionStepKey } from "@/types/project";
import type { ProductionRuntimeStatus } from "@/types/productionRuntimeStatus";

export type ProductionEndToEndValidationCode =
  | "RUNTIME_NOT_READY"
  | "VALIDATION_INTERNAL_ERROR"
  | "SNAPSHOT_CHANGED"
  | "STAGE_ORDER_INVALID"
  | "JOB_STATE_INVALID"
  | "HISTORY_STATE_INVALID"
  | "MANIFEST_STATE_INVALID"
  | "STAGE_OUTPUT_MISSING"
  | "ASSET_ID_DUPLICATE"
  | "VISUAL_ASSET_INVALID"
  | "AUDIO_ASSET_INVALID"
  | "SCENE_VIDEO_ASSET_INVALID"
  | "FINAL_VIDEO_INVALID"
  | "THUMBNAIL_ASSET_INVALID"
  | "PUBLISH_PACKAGE_INVALID";

export class ProductionEndToEndValidationError extends Error {
  constructor(readonly code: ProductionEndToEndValidationCode) {
    super(`Production end-to-end validation failed: ${code}.`);
    this.name = "ProductionEndToEndValidationError";
    this.stack = undefined;
  }
}

export interface ProductionEndToEndValidationResult {
  ok: true;
  projectSlug: string;
  stages: readonly ProductionStepKey[];
  assetCount: number;
  productionReady: false;
  videoValidation: {
    mode: "structural-only";
    reasonCode: "FFPROBE_NOT_EXECUTED";
  };
}

export async function validateProductionEndToEnd(
  projectSlug: string,
  options: { runtimeStatus: ProductionRuntimeStatus },
): Promise<ProductionEndToEndValidationResult> {
  requireValid(
    options.runtimeStatus.lifecycleState === "ready" &&
      options.runtimeStatus.initialized &&
      options.runtimeStatus.recoveryCompleted &&
      options.runtimeStatus.workerReady &&
      options.runtimeStatus.acceptingExecutions &&
      !options.runtimeStatus.draining &&
      options.runtimeStatus.initializationFailure === null,
    "RUNTIME_NOT_READY",
  );
  try {
    return await PipelineJobManager.withProjectLock(projectSlug, () =>
      validateSnapshot(projectSlug),
    );
  } catch (error) {
    if (error instanceof ProductionEndToEndValidationError) throw error;
    throw new ProductionEndToEndValidationError("VALIDATION_INTERNAL_ERROR");
  }
}

async function validateSnapshot(
  projectSlug: string,
): Promise<ProductionEndToEndValidationResult> {
  const project = await ProjectManager.getProject(projectSlug);
  const manifest = await ProjectManager.getManifest(projectSlug);
  requireValid(Boolean(project && manifest && project.slug === projectSlug), "MANIFEST_STATE_INVALID");

  const [jobs, history] = await Promise.all([
    PipelineJobManager.listJobsReadOnly(projectSlug),
    PipelineJobManager.listHistory(projectSlug),
  ]);
  requireValid(
    jobs.jobs.length === pipelineRecoveryStageOrder.length &&
      new Set(jobs.jobs.map((job) => job.id)).size === jobs.jobs.length &&
      new Set(jobs.jobs.map((job) => job.stage)).size === jobs.jobs.length &&
      jobs.jobs.every((job, index) =>
        job.stage === pipelineRecoveryStageOrder[index] &&
        job.status === "completed" &&
        Number.isSafeInteger(job.attempts) && job.attempts >= 0 &&
        Boolean(job.startedAt && job.completedAt),
      ),
    "JOB_STATE_INVALID",
  );
  const completedEvents = history.events.filter((event) => event.status === "completed");
  requireValid(
    completedEvents.length === pipelineRecoveryStageOrder.length &&
      completedEvents.every((event, index) =>
        event.stage === pipelineRecoveryStageOrder[index] && event.status === "completed",
      ),
    completedEvents.length === pipelineRecoveryStageOrder.length ? "STAGE_ORDER_INVALID" : "HISTORY_STATE_INVALID",
  );
  requireValid(
    jobs.jobs.every((job) => {
      const events = history.events.filter((event) => event.jobId === job.id);
      return events.length === job.attempts + 1 && events.at(-1)?.status === "completed";
    }),
    "HISTORY_STATE_INVALID",
  );
  requireValid(
    pipelineRecoveryStageOrder.every((stage) => manifest!.packages[stage].status === "completed"),
    "MANIFEST_STATE_INVALID",
  );

  const outputs = await Promise.all([
    ProjectManager.getResearch(projectSlug), ProjectManager.getScript(projectSlug),
    ProjectManager.getScenes(projectSlug), ProjectManager.getVisuals(projectSlug),
    ProjectManager.getAnimation(projectSlug), ProjectManager.getVideo(projectSlug),
    ProjectManager.getAudio(projectSlug), ProjectManager.getAssembly(projectSlug),
    ProjectManager.getThumbnail(projectSlug), ProjectManager.getSEO(projectSlug),
    ProjectManager.getYouTube(projectSlug), ProjectManager.getExport(projectSlug),
  ]);
  requireValid(outputs.every(Boolean), "STAGE_OUTPUT_MISSING");
  const [, , scenes, , animation, video, audio, assembly, thumbnail, , youtube] = outputs;
  const projectAssets = AssetManager.getProjectAssets(projectSlug, project!.id);
  requireValid(Array.isArray(projectAssets.assets), "ASSET_ID_DUPLICATE");
  const assets = projectAssets.assets;
  requireValid(new Set(assets.map((asset) => asset.id)).size === assets.length, "ASSET_ID_DUPLICATE");

  requireValid(isRecord(scenes) && Array.isArray(scenes.scenes), "STAGE_OUTPUT_MISSING");
  requireValid(isRecord(animation) && Array.isArray(animation.scenes), "STAGE_OUTPUT_MISSING");
  const sceneIds = (scenes.scenes as Array<{ id: number }>).map((scene) => scene.id);
  const animationScenes = animation.scenes as Array<{ sceneId: number; sourceImageAssetId?: string }>;
  requireValid(animationScenes.length === sceneIds.length, "VISUAL_ASSET_INVALID");
  for (const sceneId of sceneIds) {
    const activeImageId = animationScenes.find((scene) => scene.sceneId === sceneId)?.sourceImageAssetId;
    inspectImage(projectSlug, requireAsset(assets, activeImageId, "image", "VISUAL_ASSET_INVALID"));
  }

  requireValid(isRecord(audio) && Array.isArray(audio.sections), "STAGE_OUTPUT_MISSING");
  const audioData = audio as unknown as { outputAssetId?: string; sections: Array<{ chapterId: number; outputAssetId?: string }> };
  const audioIds = [audioData.outputAssetId, ...audioData.sections.map((section) => section.outputAssetId)];
  requireValid(audioIds.every(Boolean) && new Set(audioIds).size === audioIds.length, "AUDIO_ASSET_INVALID");
  for (const id of audioIds) inspectAudio(projectSlug, requireAsset(assets, id, "audio", "AUDIO_ASSET_INVALID"));

  requireValid(isRecord(video) && Array.isArray(video.scenes), "STAGE_OUTPUT_MISSING");
  const videoData = video as unknown as { scenes: Array<{ sceneId: number; outputAssetId?: string }> };
  requireValid(videoData.scenes.length === sceneIds.length, "SCENE_VIDEO_ASSET_INVALID");
  for (const scene of videoData.scenes) {
    requireValid(sceneIds.includes(scene.sceneId), "SCENE_VIDEO_ASSET_INVALID");
    inspectVideo(projectSlug, requireAsset(assets, scene.outputAssetId, "video", "SCENE_VIDEO_ASSET_INVALID"), "SCENE_VIDEO_ASSET_INVALID");
  }

  requireValid(isRecord(assembly) && Array.isArray(assembly.scenes), "STAGE_OUTPUT_MISSING");
  const assemblyData = assembly as unknown as { outputAssetId?: string; scenes: Array<{ sceneId: number; videoAssetId?: string; audioAssetId?: string }> };
  requireValid(
    assemblyData.scenes.length === sceneIds.length && assemblyData.scenes.every((scene) =>
      videoData.scenes.some((videoScene) => videoScene.sceneId === scene.sceneId && videoScene.outputAssetId === scene.videoAssetId) &&
      audioIds.includes(scene.audioAssetId)),
    "FINAL_VIDEO_INVALID",
  );
  inspectVideo(projectSlug, requireAsset(assets, assemblyData.outputAssetId, "video", "FINAL_VIDEO_INVALID"), "FINAL_VIDEO_INVALID");

  requireValid(isRecord(thumbnail), "STAGE_OUTPUT_MISSING");
  const thumbnailData = thumbnail as { outputAssetId?: string; generation?: { assetId?: string } };
  requireValid(thumbnailData.outputAssetId === thumbnailData.generation?.assetId, "THUMBNAIL_ASSET_INVALID");
  inspectThumbnail(projectSlug, requireAsset(assets, thumbnailData.outputAssetId, "thumbnail", "THUMBNAIL_ASSET_INVALID"));

  requireValid(isRecord(youtube), "STAGE_OUTPUT_MISSING");
  const publishingPackage = youtube as { videoAssetId?: string; thumbnailAssetId?: string; title?: string; description?: string };
  requireValid(
    publishingPackage.videoAssetId === assemblyData.outputAssetId &&
      publishingPackage.thumbnailAssetId === thumbnailData.outputAssetId &&
      Boolean(publishingPackage.title?.trim() && publishingPackage.description?.trim()),
    "PUBLISH_PACKAGE_INVALID",
  );
  const [jobsAfter, historyAfter, manifestAfter] = await Promise.all([
    PipelineJobManager.listJobsReadOnly(projectSlug),
    PipelineJobManager.listHistory(projectSlug),
    ProjectManager.getManifest(projectSlug),
  ]);
  const assetsAfter = AssetManager.getProjectAssets(projectSlug, project!.id);
  requireValid(
    sameState(jobsAfter, jobs) &&
      sameState(historyAfter, history) &&
      sameState(manifestAfter, manifest) &&
      sameState(assetsAfter, projectAssets),
    "SNAPSHOT_CHANGED",
  );
  return {
    ok: true,
    projectSlug,
    stages: pipelineRecoveryStageOrder,
    assetCount: assets.length,
    productionReady: false,
    videoValidation: { mode: "structural-only", reasonCode: "FFPROBE_NOT_EXECUTED" },
  };
}

function sameState(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireAsset(assets: Asset[], id: string | undefined, type: Asset["type"], code: ProductionEndToEndValidationCode) {
  const matches = assets.filter((asset) => asset.id === id && asset.type === type && asset.status === "generated");
  requireValid(matches.length === 1, code);
  return matches[0];
}

function inspectImage(projectSlug: string, asset: Asset, code: ProductionEndToEndValidationCode = "VISUAL_ASSET_INVALID") {
  try {
    requireValid(["image/png", "image/jpeg", "image/webp"].includes(asset.mimeType ?? ""), code);
    ImageStorage.inspectStoredImage(projectSlug, asset.filePath ?? "", asset.mimeType as "image/png" | "image/jpeg" | "image/webp");
  } catch (error) { if (error instanceof ProductionEndToEndValidationError) throw error; throw new ProductionEndToEndValidationError(code); }
}

function inspectAudio(projectSlug: string, asset: Asset) {
  try {
    requireValid(asset.mimeType === "audio/wav", "AUDIO_ASSET_INVALID");
    const inspection = AudioStorage.inspectStoredWav(projectSlug, asset.filePath ?? "");
    requireValid(inspection.byteLength === asset.byteLength && inspection.durationSeconds === asset.durationSeconds, "AUDIO_ASSET_INVALID");
  } catch (error) { if (error instanceof ProductionEndToEndValidationError) throw error; throw new ProductionEndToEndValidationError("AUDIO_ASSET_INVALID"); }
}

function inspectThumbnail(projectSlug: string, asset: Asset) {
  try {
    requireValid(["image/png", "image/jpeg", "image/webp"].includes(asset.mimeType ?? ""), "THUMBNAIL_ASSET_INVALID");
    const inspection = ThumbnailStorage.inspectStoredThumbnail(projectSlug, asset.filePath ?? "", asset.mimeType as "image/png" | "image/jpeg" | "image/webp");
    requireValid(inspection.byteLength === asset.byteLength && inspection.width === asset.width && inspection.height === asset.height, "THUMBNAIL_ASSET_INVALID");
  } catch (error) { if (error instanceof ProductionEndToEndValidationError) throw error; throw new ProductionEndToEndValidationError("THUMBNAIL_ASSET_INVALID"); }
}

function inspectVideo(projectSlug: string, asset: Asset, code: ProductionEndToEndValidationCode) {
  try {
    requireValid(asset.mimeType === "video/mp4", code);
    const inspection = VideoStorage.inspectStoredMp4(projectSlug, asset.filePath ?? "", 8 * 1024 * 1024 * 1024);
    const streams = inspectStructuralStreams(inspection.realPath);
    requireValid(
      inspection.byteLength === asset.byteLength &&
        Boolean(inspection.durationSeconds && inspection.durationSeconds > 0) &&
        streams.hasVideoStream &&
        (code !== "FINAL_VIDEO_INVALID" || streams.hasAudioStream),
      code,
    );
  } catch (error) { if (error instanceof ProductionEndToEndValidationError) throw error; throw new ProductionEndToEndValidationError(code); }
}

function inspectStructuralStreams(filePath: string) {
  const buffer = fs.readFileSync(filePath);
  return {
    hasVideoStream: hasHandler(buffer, "vide"),
    hasAudioStream: hasHandler(buffer, "soun"),
  };
}

function hasHandler(buffer: Buffer, handler: "vide" | "soun") {
  for (let offset = 0; offset + 20 <= buffer.length; offset += 1) {
    if (buffer.toString("ascii", offset + 4, offset + 8) === "hdlr" && buffer.toString("ascii", offset + 16, offset + 20) === handler) return true;
  }
  return false;
}

function requireValid(condition: unknown, code: ProductionEndToEndValidationCode): asserts condition {
  if (!condition) throw new ProductionEndToEndValidationError(code);
}
