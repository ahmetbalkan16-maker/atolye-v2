import path from "node:path";
import { AssetManager } from "@/lib/assets/AssetManager";
import { AudioStorage } from "@/lib/assets/storage/AudioStorage";
import { ImageStorage } from "@/lib/assets/storage/ImageStorage";
import { VideoStorage } from "@/lib/assets/storage/VideoStorage";
import type { AssemblyPlanData } from "@/types/assembly";
import type { Asset, ImageMimeType } from "@/types/asset";
import type { AudioData, AudioSection } from "@/types/audio";
import type { SceneData } from "@/types/scene";
import type { VideoAssemblyResult } from "@/types/videoAssembly";
import type { VisualData } from "@/types/visual";
import type { VideoAssemblyProvider } from "./providers/VideoAssemblyProvider";
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
  provider?: VideoAssemblyProvider;
}

export class VideoAssemblyManager {
  static async renderExistingAssets({
    projectId,
    projectSlug,
    scenes,
    visuals,
    audio,
    assembly,
    provider,
  }: RenderExistingAssetsInput): Promise<AssemblyPlanData> {
    const selected = provider ?? VideoAssemblyProviderRouter.getProvider();
    const providerName = getProviderName(selected);

    try {
      validateIdentitySets(scenes, visuals, audio, assembly);
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

    let renderScenes: Array<{
      sceneId: number;
      imageFilePath: string;
      audioFilePath: string;
      durationSeconds: number;
    }>;

    try {
      renderScenes = scenes.scenes.map((scene) => {
        const sceneId = scene.id;
        const section = audio.sections.find((item) => item.chapterId === sceneId);
        const assemblyScene = assembly.scenes.find(
          (item) => item.sceneId === sceneId,
        );

        if (!section || !assemblyScene) {
          throw new VideoAssemblyError();
        }

        const image = requireImageAsset(
          assets.assets,
          projectId,
          projectSlug,
          sceneId,
        );
        const audioAsset = requireAudioAsset(
          assets.assets,
          projectId,
          projectSlug,
          sceneId,
          section,
        );

        if (assemblyScene.audioAssetId !== audioAsset.id) {
          throw new VideoAssemblyError();
        }

        return {
          sceneId,
          imageFilePath: image.filePath as string,
          audioFilePath: audioAsset.filePath as string,
          durationSeconds: audioAsset.durationSeconds as number,
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
) {
  const canonical = requireIds(scenes?.scenes, (value) => value?.id);
  const visualIds = requireIds(visuals?.scenes, (value) => value?.sceneId);
  const audioIds = requireIds(audio?.sections, (value) => value?.chapterId);
  const assemblyIds = requireIds(assembly?.scenes, (value) => value?.sceneId);

  if (
    !sameIds(canonical, visualIds) ||
    !sameIds(canonical, audioIds) ||
    !sameIds(canonical, assemblyIds)
  ) {
    throw new VideoAssemblyError();
  }
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
