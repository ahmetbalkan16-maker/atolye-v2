import path from "node:path";
import { AssetManager } from "@/lib/assets/AssetManager";
import { ImageStorage } from "@/lib/assets/storage/ImageStorage";
import type {
  Asset,
  ImageGenerationResult,
  ImageMimeType,
  ImageProviderName,
  ProjectAssets,
} from "@/types/asset";
import type { VisualData } from "@/types/visual";
import type { ImageProvider } from "./providers/ImageProvider";
import { ImageProviderRouter } from "./providers/ImageProviderRouter";

const SAFE_ASSET_ERROR = "Image asset generation failed.";
const SAFE_PIPELINE_ERROR = "Visual asset generation failed.";
const SAFE_IMAGE_MIME_TYPES = new Set<ImageMimeType>([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

export class VisualAssetGenerationError extends Error {
  readonly code = "VISUAL_ASSET_GENERATION_FAILED";

  constructor() {
    super(SAFE_PIPELINE_ERROR);
    this.name = "VisualAssetGenerationError";
    this.stack = undefined;
  }
}

type GenerateAssetsInput = {
  projectId: string;
  projectSlug: string;
  visualData: VisualData;
  provider?: ImageProvider;
};

type NormalizedGenerationResult = {
  provider: ImageProviderName;
  model?: string;
  filePath?: string;
  url?: string;
  mimeType: ImageMimeType | "image/mock";
  createdAt: string;
};

export class VisualAssetPipeline {
  static async generateAssets({
    projectId,
    projectSlug,
    visualData,
    provider,
  }: GenerateAssetsInput): Promise<ProjectAssets> {
    validateSceneBatch(visualData.scenes);

    const imageProvider = provider ?? ImageProviderRouter.getProvider();
    const selectedProvider = imageProvider.name;

    let projectAssets = AssetManager.getProjectAssets(
      projectSlug,
      projectId,
    );

    for (const scene of visualData.scenes) {
      let result: ImageGenerationResult;

      try {
        result = await imageProvider.generateImage({
          prompt: scene.visualPrompt,
          style: scene.style,
          sceneId: scene.sceneId,
          projectSlug,
        });
      } catch {
        persistFailedAsset({
          projectId,
          projectSlug,
          sceneId: scene.sceneId,
          providerName: selectedProvider,
          prompt: scene.visualPrompt,
        });
        throw new VisualAssetGenerationError();
      }

      let normalizedResult: NormalizedGenerationResult | null;

      try {
        normalizedResult = normalizeGenerationResult(
          result,
          scene.sceneId,
          selectedProvider,
          projectSlug,
        );
      } catch {
        normalizedResult = null;
      }

      if (!normalizedResult) {
        persistFailedAsset({
          projectId,
          projectSlug,
          sceneId: scene.sceneId,
          providerName: selectedProvider,
          prompt: scene.visualPrompt,
        });
        throw new VisualAssetGenerationError();
      }

      const asset = AssetManager.createAsset({
        projectId,
        projectSlug,
        sceneId: scene.sceneId,
        type: "image",
        status: "generated",
        provider: normalizedResult.provider,
        model: normalizedResult.model,
        prompt: scene.visualPrompt,
        filePath: normalizedResult.filePath,
        url: normalizedResult.url,
        mimeType: normalizedResult.mimeType,
        createdAt: normalizedResult.createdAt,
      });

      projectAssets = AssetManager.addAsset(
        projectSlug,
        projectId,
        asset,
      );
    }

    return projectAssets;
  }
}

function normalizeGenerationResult(
  result: ImageGenerationResult | null | undefined,
  expectedSceneId: number,
  providerName: ImageProviderName,
  projectSlug: string,
): NormalizedGenerationResult | null {
  if (
    !result ||
    result.success !== true ||
    result.sceneId !== expectedSceneId ||
    result.provider !== providerName
  ) {
    return null;
  }

  if (providerName === "mock") {
    if (
      result.provider !== "mock" ||
      result.mimeType !== "image/mock" ||
      result.filePath !== "" ||
      result.url !== "" ||
      typeof result.createdAt !== "string" ||
      !result.createdAt
    ) {
      return null;
    }

    return {
      provider: "mock",
      model: result.model,
      filePath: result.filePath,
      url: result.url,
      mimeType: result.mimeType,
      createdAt: result.createdAt,
    };
  }

  if (result.provider !== "openai") {
    return null;
  }

  const mimeType = normalizeImageMimeType(result.mimeType);
  const filePath = normalizeSafeImagePath(result.filePath, projectSlug);
  const url = normalizeSafeImageUrl(result.url, projectSlug, filePath);
  const hasFilePath = result.filePath !== undefined;
  const hasUrl = result.url !== undefined;

  if (
    !mimeType ||
    (hasFilePath && !filePath) ||
    (hasUrl && !url) ||
    (!filePath && !url)
  ) {
    return null;
  }

  return {
    provider: "openai",
    model: result.model,
    filePath: filePath ?? undefined,
    url: url ?? undefined,
    mimeType,
    createdAt: result.createdAt,
  };
}

function persistFailedAsset({
  projectId,
  projectSlug,
  sceneId,
  providerName,
  prompt,
}: {
  projectId: string;
  projectSlug: string;
  sceneId: number;
  providerName: ImageProviderName;
  prompt: string;
}): Asset {
  const asset = AssetManager.createAsset({
    projectId,
    projectSlug,
    sceneId,
    type: "image",
    status: "failed",
    provider: providerName,
    prompt,
    error: SAFE_ASSET_ERROR,
  });

  AssetManager.addAsset(projectSlug, projectId, asset);
  return asset;
}

function validateSceneBatch(scenes: VisualData["scenes"]): void {
  if (!Array.isArray(scenes) || scenes.length === 0) {
    throw new VisualAssetGenerationError();
  }

  const sceneIds = new Set<number>();

  for (const scene of scenes) {
    const sceneId = (scene as { sceneId?: unknown } | null)?.sceneId;

    if (
      typeof sceneId !== "number" ||
      !Number.isSafeInteger(sceneId) ||
      sceneId <= 0 ||
      sceneIds.has(sceneId)
    ) {
      throw new VisualAssetGenerationError();
    }

    sceneIds.add(sceneId);
  }
}

function normalizeImageMimeType(value: unknown): ImageMimeType | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase() as ImageMimeType;
  return SAFE_IMAGE_MIME_TYPES.has(normalized) ? normalized : null;
}

function normalizeSafeImageUrl(
  value: unknown,
  projectSlug: string,
  filePath: string | null,
): string | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const candidate = value.trim();

  if (candidate.startsWith("/")) {
    return normalizeSafeLocalImageUrl(candidate, projectSlug, filePath);
  }

  try {
    const normalized = new URL(candidate);

    if (normalized.protocol !== "http:" && normalized.protocol !== "https:") {
      return null;
    }

    return normalized.toString();
  } catch {
    return null;
  }
}

function normalizeSafeLocalImageUrl(
  candidate: string,
  projectSlug: string,
  filePath: string | null,
): string | null {
  const match = /^\/api\/assets\/images\/([^/?#]+)\/([^/?#]+)$/.exec(candidate);

  if (!match) {
    return null;
  }

  let slug: string;
  let fileName: string;

  try {
    slug = decodeURIComponent(match[1]);
    fileName = decodeURIComponent(match[2]);
  } catch {
    return null;
  }

  const expectedFileName = filePath
    ? filePath.slice(filePath.lastIndexOf("/") + 1)
    : fileName;

  if (
    !/^[a-zA-Z0-9-_]+$/.test(slug) ||
    !/^[a-zA-Z0-9-_.]+$/.test(fileName) ||
    fileName.includes("..") ||
    fileName !== expectedFileName ||
    ImageStorage.getImageUrl(projectSlug, fileName) !== candidate
  ) {
    return null;
  }

  return candidate;
}

function normalizeSafeImagePath(
  value: unknown,
  projectSlug: string,
): string | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const candidate = value.trim();

  if (
    candidate.includes("\\") ||
    path.posix.isAbsolute(candidate) ||
    path.win32.isAbsolute(candidate)
  ) {
    return null;
  }

  const normalized = path.posix.normalize(candidate);
  const imageRoot = ImageStorage.getImagesDir(projectSlug);
  const expectedPrefix = `${imageRoot}/`;
  const fileName = normalized.slice(expectedPrefix.length);

  if (
    normalized !== candidate ||
    !normalized.startsWith(expectedPrefix) ||
    !fileName ||
    fileName.includes("/") ||
    !/^[a-zA-Z0-9-_.]+$/.test(fileName) ||
    fileName === "." ||
    fileName === ".."
  ) {
    return null;
  }

  return normalized;
}
