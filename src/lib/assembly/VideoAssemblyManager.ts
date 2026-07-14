import path from "node:path";
import { isAnimationMotionPlanData } from "@/lib/animation/AnimationMotionPlanValidation";
import { requireStoredProductionMotionPlan } from "@/lib/animation/AnimationStorage";
import { AssetManager } from "@/lib/assets/AssetManager";
import { AudioStorage } from "@/lib/assets/storage/AudioStorage";
import { ImageStorage } from "@/lib/assets/storage/ImageStorage";
import { VideoStorage } from "@/lib/assets/storage/VideoStorage";
import {
  isCompatibleVideoData,
  isSceneVideoData,
  isSceneVideoScene,
} from "@/lib/video/VideoDataValidation";
import type { AnimationData, AnimationMotionPlanScene } from "@/types/animation";
import type { AssemblyPlanData } from "@/types/assembly";
import type { Asset, ImageMimeType } from "@/types/asset";
import type { AudioData, AudioSection } from "@/types/audio";
import type { SceneData } from "@/types/scene";
import type { VideoData, VideoScene } from "@/types/video";
import type { VideoAssemblyInput, VideoAssemblyResult } from "@/types/videoAssembly";
import type { VisualData } from "@/types/visual";
import type { VideoAssemblyProvider } from "./providers/VideoAssemblyProvider";
import {
  allocateProductionSceneAudioSegments,
  validateProductionSceneAudioMapping,
} from "@/lib/production/ProductionAcceptancePreflight";
import { VideoAssemblyProviderRouter } from "./providers/VideoAssemblyProviderRouter";

const SAFE_ERROR = "Video assembly failed.";
const SAFE_ASSET_ERROR = "Video assembly failed.";
const SAFE_PROMPT = "Video assembly request.";
const IMAGE_MIME_TYPES = new Set<ImageMimeType>([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

export class VideoAssemblyError extends Error {
  readonly code = "VIDEO_ASSEMBLY_FAILED";

  constructor() {
    super(SAFE_ERROR);
    this.name = "VideoAssemblyError";
    this.stack = undefined;
  }
}

export interface RenderExistingAssetsInput {
  projectId: string;
  projectSlug: string;
  scenes: SceneData;
  visuals: VisualData;
  audio: AudioData;
  assembly: AssemblyPlanData;
  animation?: AnimationData | null;
  video?: VideoData | null;
  provider?: VideoAssemblyProvider;
  strictProductionAcceptance?: boolean;
}

export class VideoAssemblyManager {
  static async renderExistingAssets({
    projectId,
    projectSlug,
    scenes,
    visuals,
    audio,
    assembly,
    animation,
    video,
    provider,
    strictProductionAcceptance = false,
  }: RenderExistingAssetsInput): Promise<AssemblyPlanData> {
    const selected = provider ?? VideoAssemblyProviderRouter.getProvider();
    const providerName = getProviderName(selected);

    try {
      validateIdentitySets(
        scenes,
        visuals,
        audio,
        assembly,
        strictProductionAcceptance,
      );
    } catch {
      throw new VideoAssemblyError();
    }

    if (providerName === "mock") {
      const result = await safeAssemble(selected, {
        projectSlug,
        scenes: [],
      });

      if (!isExactMockResult(result)) {
        throw new VideoAssemblyError();
      }

      return {
        ...assembly,
        render: {
          ...assembly.render,
          status: "planned",
          format: "mp4",
        },
      };
    }

    let assets: ReturnType<typeof AssetManager.getProjectAssets>;

    try {
      assets = AssetManager.getProjectAssets(projectSlug, projectId);
    } catch {
      throw new VideoAssemblyError();
    }

    let renderScenes: VideoAssemblyInput["scenes"];

    try {
      const sceneVideo = resolveSceneVideoData(video);
      const audioSegments = buildAudioSegments(
        scenes,
        audio,
        assets.assets,
        projectId,
        projectSlug,
      );

      if (sceneVideo) {
        if (!isAnimationMotionPlanData(animation)) {
          throw new VideoAssemblyError();
        }
        requireOrderedIds(
          scenes.scenes.map((scene) => scene.id),
          assembly.scenes.map((scene) => scene.sceneId),
          sceneVideo.scenes.map((scene) => scene.sceneId),
          animation.scenes.map((scene) => scene.sceneId),
        );
        requireUniqueSceneVideoLocators(sceneVideo.scenes);
      }

      renderScenes = scenes.scenes.map((scene) => {
        const sceneId = scene.id;
        const segment = audioSegments.get(sceneId);
        const section = segment?.section;
        const assemblyScene = assembly.scenes.find(
          (item) => item.sceneId === sceneId,
        );

        if (!section || !segment || !assemblyScene) {
          throw new VideoAssemblyError();
        }

        const audioAsset = requireAudioAsset(
          assets.assets,
          projectId,
          projectSlug,
          segment.chapterId,
          section,
        );

        if (assemblyScene.audioAssetId !== audioAsset.id) {
          throw new VideoAssemblyError();
        }

        if (sceneVideo) {
          const videoScene = sceneVideo.scenes.find(
            (item) => item.sceneId === sceneId,
          );
          const motionPlan = (animation as AnimationData).scenes.find(
            (item) => item.sceneId === sceneId,
          ) as AnimationMotionPlanScene | undefined;

          if (!videoScene || !motionPlan) {
            throw new VideoAssemblyError();
          }

          return requireSceneVideoInput({
            assets: assets.assets,
            projectId,
            projectSlug,
            sceneId,
            videoScene,
            motionPlan,
            assemblyScene,
            audioFilePath: audioAsset.filePath as string,
            narrationDurationSeconds: segment.durationSeconds,
            chapterId: segment.chapterId,
            audioStartSeconds: segment.startSeconds,
          });
        }

        const image = requireImageAsset(
          assets.assets,
          projectId,
          projectSlug,
          sceneId,
        );

        return {
          inputType: "image" as const,
          sceneId,
          chapterId: segment.chapterId,
          imageFilePath: image.filePath as string,
          audioFilePath: audioAsset.filePath as string,
          audioStartSeconds: segment.startSeconds,
          durationSeconds: segment.durationSeconds,
        };
      });

      requireMixAsset(assets.assets, projectId, projectSlug, audio);
    } catch {
      throw new VideoAssemblyError();
    }
    let result: VideoAssemblyResult;

    try {
      result = await safeAssemble(selected, {
        projectSlug,
        scenes: renderScenes,
      });
    } catch {
      persistFailedAssetSafely(projectId, projectSlug, providerName);
      throw new VideoAssemblyError();
    }

    if (!isValidRealResult(result, projectSlug)) {
      persistFailedAssetSafely(projectId, projectSlug, providerName);
      throw new VideoAssemblyError();
    }

    try {
      const inspection = VideoStorage.inspectStoredMp4(
        projectSlug,
        result.filePath,
        8 * 1024 * 1024 * 1024,
      );

      if (inspection.byteLength !== result.byteLength) {
        throw new Error(SAFE_ERROR);
      }
    } catch {
      persistFailedAssetSafely(projectId, projectSlug, providerName);
      throw new VideoAssemblyError();
    }

    const asset = AssetManager.createAsset({
      projectId,
      projectSlug,
      type: "video",
      status: "generated",
      provider: "ffmpeg",
      model: result.model,
      prompt: SAFE_PROMPT,
      filePath: result.filePath,
      url: result.url,
      mimeType: result.mimeType,
      byteLength: result.byteLength,
      durationSeconds: result.durationSeconds,
      createdAt: result.createdAt,
    });

    try {
      AssetManager.addAsset(projectSlug, projectId, asset);
    } catch {
      throw new VideoAssemblyError();
    }

    return {
      ...assembly,
      outputAssetId: asset.id,
      render: {
        status: "rendered",
        format: "mp4",
        outputUrl: result.url,
        filePath: result.filePath,
        mimeType: "video/mp4",
        byteLength: result.byteLength,
        durationSeconds: result.durationSeconds,
        width: result.width,
        height: result.height,
        videoCodec: result.videoCodec,
        audioCodec: result.audioCodec,
      },
      updatedAt: new Date().toISOString(),
    };
  }
}

async function safeAssemble(
  provider: VideoAssemblyProvider,
  input: Parameters<VideoAssemblyProvider["assemble"]>[0],
) {
  try {
    return await provider.assemble(input);
  } catch {
    throw new VideoAssemblyError();
  }
}

function validateIdentitySets(
  scenes: SceneData,
  visuals: VisualData,
  audio: AudioData,
  assembly: AssemblyPlanData,
  strictProductionAcceptance: boolean,
) {
  const canonical = requireIds(scenes?.scenes, (value) => value?.id);
  const visualIds = requireIds(visuals?.scenes, (value) => value?.sceneId);
  const assemblyIds = requireIds(assembly?.scenes, (value) => value?.sceneId);

  if (
    !sameIds(canonical, visualIds) ||
    !sameIds(canonical, assemblyIds)
  ) {
    throw new VideoAssemblyError();
  }
  const chapterMappingPresent = scenes.scenes.some((scene) => scene.chapterId !== undefined);
  if (!strictProductionAcceptance && !chapterMappingPresent) {
    const audioIds = requireIds(audio?.sections, (value) => value?.chapterId);
    if (!sameIds(canonical, audioIds)) throw new VideoAssemblyError();
  } else {
    if (scenes.scenes.some((scene) => scene.chapterId === undefined)) {
      throw new VideoAssemblyError();
    }
    try {
      validateProductionSceneAudioMapping(scenes, audio, assembly);
    } catch {
      throw new VideoAssemblyError();
    }
  }
}

function buildAudioSegments(
  scenes: SceneData,
  audio: AudioData,
  assets: Asset[],
  projectId: string,
  projectSlug: string,
) {
  const result = new Map<number, {
    chapterId: number;
    section: AudioSection;
    startSeconds: number;
    durationSeconds: number;
  }>();
  const sections = new Map<number, AudioSection>();
  const durations = new Map<number, number>();
  for (const section of audio.sections) {
    if (sections.has(section.chapterId)) throw new VideoAssemblyError();
    sections.set(section.chapterId, section);
  }
  for (const [chapterId, section] of sections) {
    const asset = requireAudioAsset(
      assets,
      projectId,
      projectSlug,
      chapterId,
      section,
    );
    durations.set(chapterId, asset.durationSeconds as number);
  }
  let segments: ReturnType<typeof allocateProductionSceneAudioSegments>;
  try {
    segments = allocateProductionSceneAudioSegments(scenes, durations);
  } catch {
    throw new VideoAssemblyError();
  }
  for (const [sceneId, segment] of segments) {
    const section = sections.get(segment.chapterId);
    if (!section) throw new VideoAssemblyError();
    result.set(sceneId, { ...segment, section });
  }
  return result;
}

function requireIds<T>(
  values: T[] | undefined,
  select: (value: T | null | undefined) => unknown,
) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new VideoAssemblyError();
  }
  const ids: number[] = [];
  const seen = new Set<number>();

  for (const value of values) {
    const id = select(value);

    if (
      typeof id !== "number" ||
      !Number.isSafeInteger(id) ||
      id <= 0 ||
      seen.has(id)
    ) {
      throw new VideoAssemblyError();
    }
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function sameIds(left: number[], right: number[]) {
  return (
    left.length === right.length &&
    left.every((id) => right.includes(id))
  );
}

function resolveSceneVideoData(video: VideoData | null | undefined) {
  if (video === null || video === undefined) return null;
  if (isSceneVideoData(video)) return video;
  if (!isCompatibleVideoData(video)) throw new VideoAssemblyError();

  const hasV2Scene = video.scenes.some(
    (scene) =>
      scene.artifactType !== undefined ||
      scene.videoAssetId !== undefined ||
      scene.sourceImageAssetId !== undefined ||
      scene.generationMode !== undefined,
  );
  if (
    video.schemaVersion !== undefined ||
    video.artifactType !== undefined ||
    hasV2Scene
  ) {
    throw new VideoAssemblyError();
  }
  return null;
}

function requireOrderedIds(...sets: number[][]) {
  const canonical = sets[0];
  if (
    canonical.length === 0 ||
    sets.some(
      (set) =>
        set.length !== canonical.length ||
        set.some((id, index) => id !== canonical[index]),
    )
  ) {
    throw new VideoAssemblyError();
  }
}

function requireUniqueSceneVideoLocators(scenes: VideoScene[]) {
  const filePaths = new Set<string>();
  const urls = new Set<string>();

  for (const scene of scenes) {
    if (
      !isSceneVideoScene(scene) ||
      scene.generationMode !== "production" ||
      filePaths.has(scene.filePath) ||
      urls.has(scene.url)
    ) {
      throw new VideoAssemblyError();
    }
    filePaths.add(scene.filePath);
    urls.add(scene.url);
  }
}

function requireSceneVideoInput({
  assets,
  projectId,
  projectSlug,
  sceneId,
  videoScene,
  motionPlan,
  assemblyScene,
  audioFilePath,
  narrationDurationSeconds,
  chapterId,
  audioStartSeconds,
}: {
  assets: Asset[];
  projectId: string;
  projectSlug: string;
  sceneId: number;
  videoScene: VideoScene;
  motionPlan: AnimationMotionPlanScene;
  assemblyScene: AssemblyPlanData["scenes"][number];
  audioFilePath: string;
  narrationDurationSeconds: number;
  chapterId: number;
  audioStartSeconds: number;
}): VideoAssemblyInput["scenes"][number] {
  if (
    !isSceneVideoScene(videoScene) ||
    videoScene.generationMode !== "production" ||
    videoScene.provider !== "ffmpeg" ||
    motionPlan.sceneId !== sceneId ||
    videoScene.sourceImageAssetId !== motionPlan.sourceImageAssetId ||
    videoScene.animationAssetId !== motionPlan.animationAssetId ||
    assemblyScene.videoAssetId !== videoScene.videoAssetId ||
    assemblyScene.animationAssetId !== videoScene.animationAssetId
  ) {
    throw new VideoAssemblyError();
  }

  const images = assets.filter(
    (asset) =>
      asset.projectId === projectId &&
      asset.projectSlug === projectSlug &&
      asset.sceneId === sceneId &&
      asset.type === "image" &&
      asset.status === "generated",
  );
  if (
    images.length === 0 ||
    images[images.length - 1].id !== videoScene.sourceImageAssetId
  ) {
    throw new VideoAssemblyError();
  }

  const motionAssets = assets.filter(
    (asset) => asset.id === videoScene.animationAssetId,
  );
  if (
    motionAssets.length !== 1 ||
    motionAssets[0].projectId !== projectId ||
    motionAssets[0].projectSlug !== projectSlug ||
    motionAssets[0].sceneId !== sceneId ||
    motionAssets[0].type !== "animation" ||
    motionAssets[0].status !== "generated" ||
    motionAssets[0].artifactType !== "motion-plan" ||
    motionAssets[0].mimeType !== "application/vnd.atolye.motion-plan+json" ||
    motionAssets[0].sourceAssetId !== videoScene.sourceImageAssetId ||
    motionAssets[0].prompt !== motionPlan.animationPrompt ||
    motionAssets[0].durationSeconds !== motionPlan.durationSeconds ||
    motionAssets[0].provider !== motionPlan.provider ||
    motionAssets[0].generationMode !== motionPlan.generationMode ||
    motionAssets[0].url !== undefined
  ) {
    throw new VideoAssemblyError();
  }
  const motionAsset = motionAssets[0];
  if (motionPlan.generationMode === "mock") {
    if (motionAsset.filePath !== undefined || motionAsset.byteLength !== undefined) {
      throw new VideoAssemblyError();
    }
  } else {
    try {
      requireStoredProductionMotionPlan(projectSlug, motionAsset, motionPlan);
    } catch {
      throw new VideoAssemblyError();
    }
  }

  const candidates = assets.filter((asset) => asset.id === videoScene.videoAssetId);
  if (candidates.length !== 1) throw new VideoAssemblyError();
  const asset = candidates[0];
  if (
    asset.projectId !== projectId ||
    asset.projectSlug !== projectSlug ||
    asset.sceneId !== sceneId ||
    asset.type !== "video" ||
    asset.status !== "generated" ||
    asset.artifactType !== "scene-video" ||
    asset.provider !== "ffmpeg" ||
    asset.generationMode !== "production" ||
    asset.sourceAssetId !== videoScene.sourceImageAssetId ||
    asset.animationAssetId !== videoScene.animationAssetId ||
    asset.filePath !== videoScene.filePath ||
    asset.url !== videoScene.url ||
    asset.mimeType !== "video/mp4" ||
    asset.byteLength !== videoScene.byteLength ||
    asset.durationSeconds !== videoScene.durationSeconds ||
    asset.width !== videoScene.width ||
    asset.height !== videoScene.height ||
    asset.frameRate !== videoScene.frameRate
  ) {
    throw new VideoAssemblyError();
  }

  try {
    const fileName = path.posix.basename(videoScene.filePath);
    const inspection = VideoStorage.inspectStoredMp4(
      projectSlug,
      videoScene.filePath,
      8 * 1024 * 1024 * 1024,
    );
    if (
      inspection.byteLength !== videoScene.byteLength ||
      videoScene.url !== VideoStorage.getVideoUrl(projectSlug, fileName)
    ) {
      throw new Error(SAFE_ERROR);
    }
  } catch {
    throw new VideoAssemblyError();
  }

  return {
    inputType: "scene-video",
    sceneId,
    videoAssetId: videoScene.videoAssetId,
    sourceImageAssetId: videoScene.sourceImageAssetId,
    animationAssetId: videoScene.animationAssetId,
    filePath: videoScene.filePath,
    url: videoScene.url,
    durationSeconds: videoScene.durationSeconds,
    narrationDurationSeconds,
    chapterId,
    audioStartSeconds,
    byteLength: videoScene.byteLength,
    provider: "ffmpeg",
    generationMode: "production",
    status: "generated",
    audioFilePath,
  };
}

function requireImageAsset(
  assets: Asset[],
  projectId: string,
  projectSlug: string,
  sceneId: number,
) {
  const candidates = assets.filter(
    (asset) =>
      asset.projectId === projectId &&
      asset.projectSlug === projectSlug &&
      asset.type === "image" &&
      asset.status === "generated" &&
      asset.provider !== "mock" &&
      asset.sceneId === sceneId &&
      typeof asset.mimeType === "string" &&
      IMAGE_MIME_TYPES.has(asset.mimeType as ImageMimeType) &&
      typeof asset.filePath === "string" &&
      typeof asset.url === "string",
  );

  if (candidates.length !== 1) {
    throw new VideoAssemblyError();
  }

  const asset = candidates[0];

  try {
    const fileName = path.posix.basename(asset.filePath as string);
    const inspection = ImageStorage.inspectStoredImage(
      projectSlug,
      asset.filePath as string,
      asset.mimeType as ImageMimeType,
    );

    if (
      inspection.byteLength <= 0 ||
      asset.url !== ImageStorage.getImageUrl(projectSlug, fileName)
    ) {
      throw new Error(SAFE_ERROR);
    }
  } catch {
    throw new VideoAssemblyError();
  }

  return asset;
}

function requireAudioAsset(
  assets: Asset[],
  projectId: string,
  projectSlug: string,
  sceneId: number | undefined,
  sectionOrMix: AudioSection | AudioData,
) {
  const assetId = sectionOrMix.outputAssetId;
  const candidates = assets.filter((asset) => asset.id === assetId);

  if (typeof assetId !== "string" || candidates.length !== 1) {
    throw new VideoAssemblyError();
  }

  const asset = candidates[0];

  if (
    asset.projectId !== projectId ||
    asset.projectSlug !== projectSlug ||
    asset.type !== "audio" ||
    asset.status !== "generated" ||
    asset.provider === "mock" ||
    asset.sceneId !== sceneId ||
    asset.mimeType !== "audio/wav" ||
    typeof asset.filePath !== "string" ||
    typeof asset.url !== "string" ||
    !Number.isSafeInteger(asset.byteLength) ||
    (asset.byteLength as number) <= 0 ||
    !Number.isFinite(asset.durationSeconds) ||
    (asset.durationSeconds as number) <= 0
  ) {
    throw new VideoAssemblyError();
  }

  try {
    const inspection = AudioStorage.inspectStoredWav(projectSlug, asset.filePath);
    const fileName = path.posix.basename(asset.filePath);

    if (
      inspection.byteLength !== asset.byteLength ||
      Math.abs(inspection.durationSeconds - (asset.durationSeconds as number)) >
        1e-9 ||
      asset.url !== AudioStorage.getAudioUrl(projectSlug, fileName)
    ) {
      throw new Error(SAFE_ERROR);
    }
  } catch {
    throw new VideoAssemblyError();
  }

  return asset;
}

function requireMixAsset(
  assets: Asset[],
  projectId: string,
  projectSlug: string,
  audio: AudioData,
) {
  requireAudioAsset(assets, projectId, projectSlug, undefined, audio);
}

function getProviderName(provider: VideoAssemblyProvider) {
  try {
    if (provider.name === "mock" || provider.name === "ffmpeg") {
      return provider.name;
    }
  } catch {
    // Fall through to the normalized failure.
  }
  throw new VideoAssemblyError();
}

function isExactMockResult(result: VideoAssemblyResult) {
  try {
    return (
      result.success === true &&
      result.provider === "mock" &&
      result.status === "planned" &&
      result.filePath === "" &&
      result.url === "" &&
      result.mimeType === "video/mock" &&
      result.byteLength === 0 &&
      result.durationSeconds === 0 &&
      (result as { error?: unknown }).error === undefined &&
      validDate(result.createdAt)
    );
  } catch {
    return false;
  }
}

function isValidRealResult(
  result: VideoAssemblyResult,
  projectSlug: string,
): result is Extract<VideoAssemblyResult, { provider: "ffmpeg"; success: true }> {
  try {
    if (
      result.success !== true ||
      result.provider !== "ffmpeg" ||
      result.status !== "rendered" ||
      result.model !== "ffmpeg-h264-aac" ||
      result.mimeType !== "video/mp4" ||
      !Number.isSafeInteger(result.byteLength) ||
      result.byteLength <= 0 ||
      !Number.isFinite(result.durationSeconds) ||
      result.durationSeconds <= 0 ||
      result.width !== 1920 ||
      result.height !== 1080 ||
      result.videoCodec !== "h264" ||
      result.audioCodec !== "aac" ||
      !validDate(result.createdAt) ||
      (result as { error?: unknown }).error !== undefined
    ) {
      return false;
    }

    const fileName = path.posix.basename(result.filePath);

    return (
      result.filePath === VideoStorage.getVideoPath(projectSlug, fileName) &&
      result.url === VideoStorage.getVideoUrl(projectSlug, fileName)
    );
  } catch {
    return false;
  }
}

function validDate(value: unknown) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    Number.isFinite(Date.parse(value))
  );
}

function persistFailedAssetSafely(
  projectId: string,
  projectSlug: string,
  provider: "mock" | "ffmpeg",
) {
  try {
    const asset = AssetManager.createAsset({
      projectId,
      projectSlug,
      type: "video",
      status: "failed",
      provider,
      prompt: SAFE_PROMPT,
      error: SAFE_ASSET_ERROR,
    });
    AssetManager.addAsset(projectSlug, projectId, asset);
  } catch {
    // Secondary registry failure must not replace the normalized stage failure.
  }
}
