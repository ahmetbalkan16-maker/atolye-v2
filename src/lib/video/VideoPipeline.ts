import path from "node:path";
import { isAnimationMotionPlanData } from "@/lib/animation/AnimationMotionPlanValidation";
import { AssetManager } from "@/lib/assets/AssetManager";
import { ImageStorage } from "@/lib/assets/storage/ImageStorage";
import { VideoStorage } from "@/lib/assets/storage/VideoStorage";
import type { AnimationData, AnimationMotionPlanScene } from "@/types/animation";
import type { Asset, ImageMimeType, ProjectAssets } from "@/types/asset";
import type { VideoData, VideoScene } from "@/types/video";
import type {
  VideoProvider,
  VideoProviderSceneInput,
  VideoSceneGenerationSuccess,
} from "./providers/VideoProvider";
import { VideoProviderRouter } from "./providers/VideoProviderRouter";

const SAFE_ERROR = "Scene video generation failed.";
const SCENE_VIDEO_PROMPT = "Scene video rendered from a validated image and motion plan.";
const MOTION_PLAN_MIME = "application/vnd.atolye.motion-plan+json";
const IMAGE_MIME_TYPES = new Set<ImageMimeType>([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

export class SceneVideoGenerationError extends Error {
  readonly code = "SCENE_VIDEO_GENERATION_FAILED";
  constructor() {
    super(SAFE_ERROR);
    this.name = "SceneVideoGenerationError";
    this.stack = undefined;
  }
}

type GenerateVideoInput = {
  projectId: string;
  projectSlug: string;
  animation: AnimationData;
  provider?: VideoProvider;
};

export type VideoPipelineResult = {
  video: VideoData;
  projectAssets: ProjectAssets;
};

export class VideoPipeline {
  static async generateVideo({
    projectId,
    projectSlug,
    animation,
    provider,
  }: GenerateVideoInput): Promise<VideoPipelineResult> {
    try {
      if (!isAnimationMotionPlanData(animation)) throw new SceneVideoGenerationError();
      const selectedProvider = provider ?? VideoProviderRouter.getProvider();
      const providerName = requireProviderName(selectedProvider);
      const generationMode = providerName === "mock" ? "mock" : "production";
      const currentAssets = AssetManager.getProjectAssets(projectSlug, projectId);
      const inputs = prepareInputs(
        animation.scenes as AnimationMotionPlanScene[],
        currentAssets.assets,
        projectId,
        projectSlug,
        generationMode,
      );
      const result = await selectedProvider.generateVideo({
        projectId,
        projectSlug,
        scenes: inputs,
      });
      const generated = requireValidBatch(
        result,
        inputs,
        providerName,
        generationMode,
        projectSlug,
      );
      const createdAssets: Asset[] = [];
      const scenes: VideoScene[] = generated.map((item) => {
        const asset = AssetManager.createAsset({
          projectId,
          projectSlug,
          sceneId: item.sceneId,
          type: "video",
          status: "generated",
          provider: providerName,
          model: item.model,
          prompt: SCENE_VIDEO_PROMPT,
          filePath: item.filePath,
          url: item.url,
          mimeType: item.mimeType,
          byteLength: item.byteLength,
          durationSeconds: item.durationSeconds,
          artifactType: "scene-video",
          sourceAssetId: item.sourceImageAssetId,
          animationAssetId: item.animationAssetId,
          generationMode,
          width: item.width,
          height: item.height,
          frameRate: item.frameRate,
          transition: item.transition,
          createdAt: item.createdAt,
        });
        createdAssets.push(asset);
        return {
          sceneId: item.sceneId,
          sourceAnimationAssetId: item.animationAssetId,
          sourceImageAssetId: item.sourceImageAssetId,
          animationAssetId: item.animationAssetId,
          outputAssetId: asset.id,
          videoAssetId: asset.id,
          provider: providerName,
          model: item.model,
          status: "generated",
          durationSeconds: item.durationSeconds,
          filePath: item.filePath,
          url: item.url,
          mimeType: item.mimeType,
          byteLength: item.byteLength,
          width: item.width,
          height: item.height,
          frameRate: item.frameRate,
          transition: item.transition,
          generationMode,
          artifactType: "scene-video",
        };
      });
      const projectAssets = AssetManager.saveProjectAssets(projectSlug, {
        ...currentAssets,
        projectId,
        projectSlug: currentAssets.projectSlug ?? projectSlug,
        assets: [...currentAssets.assets, ...createdAssets],
        updatedAt: new Date().toISOString(),
      });
      const video: VideoData = {
        projectId,
        schemaVersion: "2",
        artifactType: "scene-video",
        provider: providerName,
        status: "generated",
        scenes,
        createdAt: new Date().toISOString(),
      };
      return { video, projectAssets };
    } catch {
      throw new SceneVideoGenerationError();
    }
  }
}

export async function generateVideo(input: GenerateVideoInput) {
  return VideoPipeline.generateVideo(input);
}

function prepareInputs(
  plans: AnimationMotionPlanScene[],
  assets: Asset[],
  projectId: string,
  projectSlug: string,
  mode: "mock" | "production",
): VideoProviderSceneInput[] {
  const sceneIds = new Set<number>();
  const imageIds = new Set<string>();
  const animationIds = new Set<string>();
  return plans.map((plan) => {
    if (
      sceneIds.has(plan.sceneId) ||
      imageIds.has(plan.sourceImageAssetId) ||
      animationIds.has(plan.animationAssetId)
    ) {
      throw new SceneVideoGenerationError();
    }
    const images = assets.filter(
      (asset) =>
        asset.projectId === projectId &&
        asset.projectSlug === projectSlug &&
        asset.sceneId === plan.sceneId &&
        asset.type === "image" &&
        asset.status === "generated",
    );
    if (images.length === 0) throw new SceneVideoGenerationError();
    const image = images[images.length - 1];
    validateImage(image, projectSlug, mode);
    if (image.id !== plan.sourceImageAssetId) throw new SceneVideoGenerationError();
    const motionAssets = assets.filter((asset) => asset.id === plan.animationAssetId);
    if (motionAssets.length !== 1) throw new SceneVideoGenerationError();
    validateMotionAsset(motionAssets[0], plan, projectId, projectSlug);
    sceneIds.add(plan.sceneId);
    imageIds.add(image.id);
    animationIds.add(plan.animationAssetId);
    return {
      sceneId: plan.sceneId,
      sourceImageAssetId: image.id,
      animationAssetId: plan.animationAssetId,
      imageFilePath: image.filePath as string,
      imageMimeType: image.mimeType as ImageMimeType | "image/mock",
      motionPlan: plan,
    };
  });
}

function validateImage(
  asset: Asset,
  projectSlug: string,
  mode: "mock" | "production",
) {
  if (asset.provider === "mock") {
    if (
      mode !== "mock" ||
      asset.mimeType !== "image/mock" ||
      asset.filePath !== "" ||
      asset.url !== ""
    ) {
      throw new SceneVideoGenerationError();
    }
    return;
  }
  if (
    typeof asset.mimeType !== "string" ||
    !IMAGE_MIME_TYPES.has(asset.mimeType as ImageMimeType) ||
    typeof asset.filePath !== "string" ||
    typeof asset.url !== "string"
  ) {
    throw new SceneVideoGenerationError();
  }
  const fileName = path.posix.basename(asset.filePath);
  const inspection = ImageStorage.inspectStoredImage(
    projectSlug,
    asset.filePath,
    asset.mimeType as ImageMimeType,
  );
  if (
    inspection.byteLength <= 0 ||
    asset.url !== ImageStorage.getImageUrl(projectSlug, fileName)
  ) {
    throw new SceneVideoGenerationError();
  }
}

function validateMotionAsset(
  asset: Asset,
  plan: AnimationMotionPlanScene,
  projectId: string,
  projectSlug: string,
) {
  if (
    asset.projectId !== projectId ||
    asset.projectSlug !== projectSlug ||
    asset.sceneId !== plan.sceneId ||
    asset.type !== "animation" ||
    asset.status !== "generated" ||
    asset.artifactType !== "motion-plan" ||
    asset.mimeType !== MOTION_PLAN_MIME ||
    asset.sourceAssetId !== plan.sourceImageAssetId ||
    asset.prompt !== plan.animationPrompt ||
    asset.durationSeconds !== plan.durationSeconds ||
    asset.provider !== plan.provider ||
    asset.generationMode !== plan.generationMode ||
    asset.filePath !== undefined ||
    asset.url !== undefined
  ) {
    throw new SceneVideoGenerationError();
  }
}

function requireProviderName(provider: VideoProvider) {
  if (provider.name !== "mock" && provider.name !== "ffmpeg") {
    throw new SceneVideoGenerationError();
  }
  return provider.name;
}

function requireValidBatch(
  value: unknown,
  inputs: VideoProviderSceneInput[],
  provider: "mock" | "ffmpeg",
  mode: "mock" | "production",
  projectSlug: string,
) {
  const result = value as {
    success?: unknown;
    provider?: unknown;
    generationMode?: unknown;
    scenes?: unknown;
  };
  if (
    !result ||
    typeof result !== "object" ||
    result.success !== true ||
    result.provider !== provider ||
    result.generationMode !== mode ||
    !Array.isArray(result.scenes) ||
    result.scenes.length !== inputs.length
  ) {
    throw new SceneVideoGenerationError();
  }
  const seen = new Set<number>();
  const outputPaths = new Set<string>();
  const outputUrls = new Set<string>();
  const generated = result.scenes as VideoSceneGenerationSuccess[];
  for (const item of generated) {
    const input = inputs.find((candidate) => candidate.sceneId === item?.sceneId);
    if (!input || seen.has(item.sceneId)) throw new SceneVideoGenerationError();
    validateResult(item, input, provider, mode, projectSlug);
    if (
      mode === "production" &&
      (outputPaths.has(item.filePath) || outputUrls.has(item.url))
    ) {
      throw new SceneVideoGenerationError();
    }
    seen.add(item.sceneId);
    if (mode === "production") {
      outputPaths.add(item.filePath);
      outputUrls.add(item.url);
    }
  }
  return inputs.map((input) => {
    const item = generated.find((candidate) => candidate.sceneId === input.sceneId);
    if (!item) throw new SceneVideoGenerationError();
    return item;
  });
}

function validateResult(
  item: VideoSceneGenerationSuccess,
  input: VideoProviderSceneInput,
  provider: "mock" | "ffmpeg",
  mode: "mock" | "production",
  projectSlug: string,
) {
  if (
    item.sourceImageAssetId !== input.sourceImageAssetId ||
    item.animationAssetId !== input.animationAssetId ||
    item.provider !== provider ||
    item.generationMode !== mode ||
    item.status !== "generated" ||
    item.durationSeconds !== input.motionPlan.durationSeconds ||
    item.transition !== input.motionPlan.transition ||
    item.frameRate !== 30 ||
    !validDate(item.createdAt)
  ) {
    throw new SceneVideoGenerationError();
  }
  if (mode === "mock") {
    if (
      item.filePath !== "" ||
      item.url !== "" ||
      item.mimeType !== "video/mock" ||
      item.byteLength !== 0 ||
      item.width !== 0 ||
      item.height !== 0
    ) {
      throw new SceneVideoGenerationError();
    }
    return;
  }
  if (
    item.mimeType !== "video/mp4" ||
    !Number.isSafeInteger(item.byteLength) ||
    item.byteLength <= 0 ||
    item.width !== 1920 ||
    item.height !== 1080
  ) {
    throw new SceneVideoGenerationError();
  }
  const fileName = path.posix.basename(item.filePath);
  if (
    item.filePath !== VideoStorage.getVideoPath(projectSlug, fileName) ||
    item.url !== VideoStorage.getVideoUrl(projectSlug, fileName)
  ) {
    throw new SceneVideoGenerationError();
  }
  const inspection = VideoStorage.inspectStoredMp4(
    projectSlug,
    item.filePath,
    8 * 1024 * 1024 * 1024,
  );
  if (inspection.byteLength !== item.byteLength) {
    throw new SceneVideoGenerationError();
  }
}

function validDate(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}
