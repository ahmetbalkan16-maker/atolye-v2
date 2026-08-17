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
  /**
   * Per-scene source override, only meaningful when the resolved provider is "real":
   * "ai" skips the real-photo attempt and generates directly with OpenAI; "real" disables the
   * AI fallback for that scene (a not-found real search fails the scene rather than falling
   * back). Ignored when the batch provider is "mock"/"openai" — there is nothing to override.
   */
  overrides?: Readonly<Record<number, "ai" | "real">>;
};

type NormalizedGenerationResult = {
  provider: ImageProviderName;
  model?: string;
  filePath?: string;
  url?: string;
  mimeType: ImageMimeType | "image/mock";
  byteLength?: number;
  sourceName?: string;
  sourceUrl?: string;
  license?: string;
  attribution?: string;
  selectionScore?: number;
  selectionRank?: number;
  candidateCount?: number;
  width?: number;
  height?: number;
  createdAt: string;
};

export class VisualAssetPipeline {
  static async generateAssets({
    projectId,
    projectSlug,
    visualData,
    provider,
    overrides,
  }: GenerateAssetsInput): Promise<ProjectAssets> {
    validateSceneBatch(visualData.scenes);

    const imageProvider = provider ?? ImageProviderRouter.getProvider();

    let projectAssets = AssetManager.getProjectAssets(
      projectSlug,
      projectId,
    );
    validateNoExistingGeneratedImages(projectAssets, visualData.scenes);

    let aiFallbackProvider: ImageProvider | undefined;
    const getAiFallbackProvider = () =>
      aiFallbackProvider ?? (aiFallbackProvider = ImageProviderRouter.getProvider("openai"));

    for (const scene of visualData.scenes) {
      // Overrides only apply when the batch provider is "real" — otherwise there is no
      // real-photo attempt to skip or force, and honoring them would risk an unexpected
      // real API dispatch in a mock/openai-configured environment.
      const override = imageProvider.name === "real" ? overrides?.[scene.sceneId] : undefined;
      let effectiveProvider = override === "ai" ? getAiFallbackProvider() : imageProvider;

      let result: ImageGenerationResult;

      try {
        result = await effectiveProvider.generateImage({
          prompt: scene.visualPrompt,
          style: scene.style,
          sceneId: scene.sceneId,
          projectSlug,
          searchKeywords: scene.searchKeywords,
        });
      } catch {
        persistFailedAsset({
          projectId,
          projectSlug,
          sceneId: scene.sceneId,
          providerName: effectiveProvider.name,
          prompt: scene.visualPrompt,
        });
        throw new VisualAssetGenerationError();
      }

      // A "real" attempt that found nothing (and wasn't force-real) falls back to AI so a
      // missing archival photo never blocks the whole production run.
      if (result?.success !== true && effectiveProvider.name === "real" && override !== "real") {
        effectiveProvider = getAiFallbackProvider();
        try {
          result = await effectiveProvider.generateImage({
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
            providerName: effectiveProvider.name,
            prompt: scene.visualPrompt,
          });
          throw new VisualAssetGenerationError();
        }
      }

      let normalizedResult: NormalizedGenerationResult | null;

      try {
        normalizedResult = normalizeGenerationResult(
          result,
          scene.sceneId,
          effectiveProvider.name,
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
          providerName: effectiveProvider.name,
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
        byteLength: normalizedResult.byteLength,
        sourceName: normalizedResult.sourceName,
        sourceUrl: normalizedResult.sourceUrl,
        license: normalizedResult.license,
        attribution: normalizedResult.attribution,
        selectionScore: normalizedResult.selectionScore,
        selectionRank: normalizedResult.selectionRank,
        candidateCount: normalizedResult.candidateCount,
        width: normalizedResult.width,
        height: normalizedResult.height,
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

function validateNoExistingGeneratedImages(
  assets: ProjectAssets,
  scenes: VisualData["scenes"],
) {
  const plannedSceneIds = new Set(scenes.map((scene) => scene.sceneId));
  if (assets.assets.some((asset) =>
    asset.type === "image" && asset.status === "generated" &&
    asset.sceneId !== undefined && plannedSceneIds.has(asset.sceneId)
  )) throw new VisualAssetGenerationError();
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

  if (result.provider === "real") {
    const mimeType = normalizeImageMimeType(result.mimeType);
    const filePath = normalizeSafeImagePath(result.filePath, projectSlug);
    const url = normalizeSafeImageUrl(result.url, projectSlug, filePath);
    const hasFilePath = result.filePath !== undefined;
    const hasUrl = result.url !== undefined;
    const sourceName = normalizeNonEmptyString(result.sourceName, 200);
    const sourceUrl = normalizeSourceUrl(result.sourceUrl);
    const license = normalizeNonEmptyString(result.license, 200);
    const attribution = result.attribution === undefined
      ? undefined
      : normalizeNonEmptyString(result.attribution, 300);
    const selectionScore = normalizeUnitScore(result.selectionScore);
    const selectionRank = normalizePositiveInteger(result.selectionRank);
    const candidateCount = normalizePositiveInteger(result.candidateCount);
    const width = normalizePositiveInteger(result.width);
    const height = normalizePositiveInteger(result.height);

    if (
      !mimeType ||
      (hasFilePath && !filePath) ||
      (hasUrl && !url) ||
      !filePath || !url ||
      !hasFilePath || !hasUrl ||
      !sourceName || !sourceUrl || !license ||
      (result.attribution !== undefined && !attribution) ||
      selectionScore === null || selectionRank === null || candidateCount === null ||
      width === null || height === null ||
      selectionRank > candidateCount
    ) {
      return null;
    }

    let byteLength: number | undefined;
    if (url.startsWith("/api/assets/images/")) {
      try {
        byteLength = ImageStorage.inspectStoredImage(projectSlug, filePath, mimeType).byteLength;
      } catch {
        return null;
      }
    }

    return {
      provider: "real",
      model: result.model,
      filePath,
      url,
      mimeType,
      byteLength,
      sourceName,
      sourceUrl,
      license,
      attribution: attribution ?? undefined,
      selectionScore,
      selectionRank,
      candidateCount,
      width,
      height,
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
    !filePath || !url ||
    !hasFilePath || !hasUrl
  ) {
    return null;
  }

  let byteLength: number | undefined;
  if (url.startsWith("/api/assets/images/")) {
    try {
      byteLength = ImageStorage.inspectStoredImage(projectSlug, filePath, mimeType).byteLength;
    } catch {
      return null;
    }
  }

  return {
    provider: "openai",
    model: result.model,
    filePath: filePath ?? undefined,
    url: url ?? undefined,
    mimeType,
    byteLength,
    createdAt: result.createdAt,
  };
}

function normalizeNonEmptyString(value: unknown, maximumLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= maximumLength ? trimmed : null;
}

function normalizeSourceUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

function normalizeUnitScore(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : null;
}

function normalizePositiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
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
