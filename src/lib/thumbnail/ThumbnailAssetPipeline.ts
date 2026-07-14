import path from "node:path";
import { AssetManager } from "@/lib/assets/AssetManager";
import { VideoStorage } from "@/lib/assets/storage/VideoStorage";
import { ProjectWriter } from "@/lib/projects/ProjectWriter";
import type { Asset } from "@/types/asset";
import type { AssemblyPlanData } from "@/types/assembly";
import type { ThumbnailData, ThumbnailMimeType } from "@/types/thumbnail";
import type {
  ThumbnailAssetGenerationResult,
  ThumbnailProvider,
} from "./providers/ThumbnailProvider";
import { ThumbnailProviderRouter } from "./ThumbnailProviderRouter";
import { ThumbnailStorage } from "./ThumbnailStorage";

const SAFE_ERROR = "Thumbnail asset generation failed.";
const MIME_TYPES = new Set<ThumbnailMimeType>([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

export class ThumbnailAssetGenerationError extends Error {
  readonly code = "THUMBNAIL_ASSET_GENERATION_FAILED";

  constructor() {
    super(SAFE_ERROR);
    this.name = "ThumbnailAssetGenerationError";
    this.stack = undefined;
  }
}

export interface GenerateThumbnailAssetInput {
  projectId: string;
  projectSlug: string;
  title: string;
  assembly: AssemblyPlanData;
  thumbnail: ThumbnailData;
  previousThumbnail?: ThumbnailData | null;
  provider?: ThumbnailProvider;
}

export class ThumbnailAssetPipeline {
  static async generateThumbnail({
    projectId,
    projectSlug,
    title,
    assembly,
    thumbnail,
    previousThumbnail,
    provider,
  }: GenerateThumbnailAssetInput): Promise<ThumbnailData> {
    const selected = provider ?? new ThumbnailProviderRouter().getProvider();
    let providerName: "mock" | "openai";

    try {
      const candidateProviderName = selected.name;
      if (candidateProviderName !== "mock" && candidateProviderName !== "openai") {
        throw new ThumbnailAssetGenerationError();
      }
      providerName = candidateProviderName;
      validateInputs(projectId, projectSlug, title, assembly, thumbnail);
      validateAssemblyDependency(
        projectId,
        projectSlug,
        assembly,
        providerName,
      );
      await prepareThumbnailAttempt(
        projectId,
        projectSlug,
        thumbnail,
        previousThumbnail,
      );
    } catch {
      throw new ThumbnailAssetGenerationError();
    }

    let result: ThumbnailAssetGenerationResult;
    try {
      result = await selected.generateThumbnailAsset({
        projectId,
        projectSlug,
        title,
        prompt: thumbnail.imagePrompt,
        thumbnail,
        assembly,
      });
    } catch {
      throw new ThumbnailAssetGenerationError();
    }

    let assets: ReturnType<typeof AssetManager.getProjectAssets>;
    try {
      assets = AssetManager.getProjectAssets(projectSlug, projectId);
      validateProviderResult(result, providerName, projectSlug, assets.assets);
    } catch {
      cleanupUnregisteredResult(result, projectSlug, projectId);
      throw new ThumbnailAssetGenerationError();
    }

    const success = result as Extract<ThumbnailAssetGenerationResult, { success: true }>;
    const asset = AssetManager.createAsset({
      id: success.assetId,
      projectId,
      projectSlug,
      type: "thumbnail",
      status: "generated",
      provider: success.provider,
      model: success.model,
      prompt: thumbnail.imagePrompt,
      filePath: success.filePath,
      url: success.url,
      mimeType: success.mimeType,
      byteLength: success.byteLength,
      sourceAssetId: assembly.outputAssetId,
      generationMode: success.generationMode,
      width: success.width,
      height: success.height,
      createdAt: success.createdAt,
    });

    try {
      AssetManager.addAssetAtomically(projectSlug, projectId, asset);
    } catch {
      cleanupUnregisteredResult(result, projectSlug, projectId);
      throw new ThumbnailAssetGenerationError();
    }

    return {
      ...thumbnail,
      provider: success.provider,
      model: success.model,
      status: "generated",
      sourceAssemblyAssetId: assembly.outputAssetId,
      outputAssetId: success.assetId,
      generation: {
        provider: success.provider,
        model: success.model,
        assetId: success.assetId,
        fileName: success.fileName,
        filePath: success.filePath,
        imageUrl: success.url,
        mimeType: success.mimeType,
        width: success.width,
        height: success.height,
        byteLength: success.byteLength,
        generationMode: success.generationMode,
        status: "generated",
      },
      updatedAt: new Date().toISOString(),
    };
  }

  static async compensatePersistenceFailure(
    projectId: string,
    projectSlug: string,
    thumbnail: ThumbnailData,
  ): Promise<void> {
    try {
      await demoteGeneratedThumbnailAssets(
        projectId,
        projectSlug,
        thumbnail.outputAssetId ? new Set([thumbnail.outputAssetId]) : undefined,
      );
    } catch {
      // Retry preparation repeats reconciliation if compensation cannot persist.
    }

    try {
      await ProjectWriter.writeJSONAtomically(
        projectSlug,
        "thumbnail.json",
        createNonCanonicalThumbnail(thumbnail, "failed"),
      );
    } catch {
      // The stage failure remains authoritative; retry reconciliation is durable.
    }
  }
}

async function prepareThumbnailAttempt(
  projectId: string,
  projectSlug: string,
  nextPlan: ThumbnailData,
  previousThumbnail: ThumbnailData | null | undefined,
) {
  const reconciled = await demoteGeneratedThumbnailAssets(
    projectId,
    projectSlug,
  );
  if (
    reconciled > 0 ||
    previousThumbnail?.status === "generated" ||
    typeof previousThumbnail?.outputAssetId === "string"
  ) {
    await ProjectWriter.writeJSONAtomically(
      projectSlug,
      "thumbnail.json",
      createNonCanonicalThumbnail(nextPlan, "planned"),
    );
  }
}

async function demoteGeneratedThumbnailAssets(
  projectId: string,
  projectSlug: string,
  onlyAssetIds?: Set<string>,
) {
  const current = AssetManager.getProjectAssets(projectSlug, projectId);
  const stale = current.assets.filter(
    (asset) =>
      asset.type === "thumbnail" &&
      asset.status === "generated" &&
      (!onlyAssetIds || onlyAssetIds.has(asset.id)),
  );
  if (stale.length === 0) return 0;

  const staleIds = new Set(stale.map((asset) => asset.id));
  const now = new Date().toISOString();
  AssetManager.saveProjectAssetsAtomically(projectSlug, {
    ...current,
    assets: current.assets.map((asset) =>
      staleIds.has(asset.id)
        ? {
            ...asset,
            status: "failed" as const,
            filePath: undefined,
            url: undefined,
            mimeType: undefined,
            byteLength: undefined,
            width: undefined,
            height: undefined,
            error: SAFE_ERROR,
            updatedAt: now,
          }
        : asset,
    ),
    updatedAt: now,
  });

  for (const asset of stale) {
    if (typeof asset.filePath !== "string") continue;
    try {
      ThumbnailStorage.removeStoredThumbnail(projectSlug, asset.filePath);
    } catch {
      // A failed registry entry cannot become canonical; cleanup is best effort.
    }
  }
  return stale.length;
}

function createNonCanonicalThumbnail(
  thumbnail: ThumbnailData,
  status: "planned" | "failed",
): ThumbnailData {
  return {
    ...thumbnail,
    status,
    outputAssetId: undefined,
    generation: {
      provider: thumbnail.generation?.provider ?? thumbnail.provider,
      model: thumbnail.generation?.model ?? thumbnail.model,
      status,
    },
    updatedAt: new Date().toISOString(),
  };
}

function validateInputs(
  projectId: string,
  projectSlug: string,
  title: string,
  assembly: AssemblyPlanData,
  thumbnail: ThumbnailData,
) {
  if (
    !projectId.trim() ||
    !/^[a-zA-Z0-9-_]+$/.test(projectSlug) ||
    !title.trim() ||
    !thumbnail.imagePrompt?.trim() ||
    !thumbnail.mainSubject?.trim() ||
    !Array.isArray(thumbnail.variants) ||
    thumbnail.variants.length === 0 ||
    !assembly ||
    assembly.status !== "assembled" ||
    !Array.isArray(assembly.scenes) ||
    assembly.scenes.length === 0 ||
    !assembly.render
  ) {
    throw new ThumbnailAssetGenerationError();
  }

  const sceneIds = new Set<number>();
  for (const scene of assembly.scenes) {
    if (
      !Number.isSafeInteger(scene?.sceneId) ||
      scene.sceneId <= 0 ||
      sceneIds.has(scene.sceneId) ||
      !scene.duration?.trim() ||
      !scene.visualReference?.trim() ||
      !scene.audioReference?.trim()
    ) throw new ThumbnailAssetGenerationError();
    sceneIds.add(scene.sceneId);
  }
}

function validateAssemblyDependency(
  projectId: string,
  projectSlug: string,
  assembly: AssemblyPlanData,
  providerName: "mock" | "openai",
) {
  if (providerName === "mock") {
    if (
      assembly.render?.status !== "planned" ||
      assembly.render.format !== "mp4" ||
      assembly.outputAssetId !== undefined ||
      assembly.render.filePath !== undefined ||
      assembly.render.outputUrl !== undefined
    ) throw new ThumbnailAssetGenerationError();
    return;
  }

  const render = assembly.render;
  if (
    render?.status !== "rendered" ||
    render.format !== "mp4" ||
    render.mimeType !== "video/mp4" ||
    typeof assembly.outputAssetId !== "string" ||
    !assembly.outputAssetId ||
    typeof render.filePath !== "string" ||
    typeof render.outputUrl !== "string" ||
    !Number.isSafeInteger(render.byteLength) ||
    (render.byteLength as number) <= 0 ||
    !Number.isSafeInteger(render.width) ||
    (render.width as number) <= 0 ||
    !Number.isSafeInteger(render.height) ||
    (render.height as number) <= 0
  ) throw new ThumbnailAssetGenerationError();

  const assets = AssetManager.getProjectAssets(projectSlug, projectId).assets;
  const matches = assets.filter((asset) => asset.id === assembly.outputAssetId);
  if (matches.length !== 1) throw new ThumbnailAssetGenerationError();
  const asset = matches[0];
  if (
    asset.projectId !== projectId ||
    asset.projectSlug !== projectSlug ||
    asset.type !== "video" ||
    asset.status !== "generated" ||
    asset.mimeType !== "video/mp4" ||
    asset.filePath !== render.filePath ||
    asset.url !== render.outputUrl ||
    asset.byteLength !== render.byteLength
  ) throw new ThumbnailAssetGenerationError();

  const fileName = path.posix.basename(render.filePath);
  const inspection = VideoStorage.inspectStoredMp4(
    projectSlug,
    render.filePath,
    8 * 1024 * 1024 * 1024,
  );
  if (
    inspection.byteLength !== render.byteLength ||
    render.outputUrl !== VideoStorage.getVideoUrl(projectSlug, fileName)
  ) throw new ThumbnailAssetGenerationError();
}

function validateProviderResult(
  result: ThumbnailAssetGenerationResult,
  providerName: "mock" | "openai",
  projectSlug: string,
  assets: Asset[],
) {
  try {
    if (
      result.success !== true ||
      result.status !== "generated" ||
      result.provider !== providerName ||
      result.generationMode !== (providerName === "mock" ? "mock" : "production") ||
      !/^[a-zA-Z0-9-_]+$/.test(result.assetId) ||
      !/^[a-zA-Z0-9-_.]+$/.test(result.fileName) ||
      result.fileName.includes("..") ||
      !MIME_TYPES.has(result.mimeType) ||
      !Number.isSafeInteger(result.width) ||
      result.width <= 0 ||
      !Number.isSafeInteger(result.height) ||
      result.height <= 0 ||
      !Number.isSafeInteger(result.byteLength) ||
      result.byteLength <= 0 ||
      !validDate(result.createdAt) ||
      assets.some((asset) => asset.id === result.assetId) ||
      (result as { error?: unknown }).error !== undefined
    ) throw new ThumbnailAssetGenerationError();

    const expectedPath = ThumbnailStorage.getThumbnailPath(projectSlug, result.fileName);
    const expectedUrl = ThumbnailStorage.getThumbnailUrl(projectSlug, result.fileName);
    const expectedExtension =
      result.mimeType === "image/png" ? ".png" :
        result.mimeType === "image/jpeg" ? [".jpg", ".jpeg"] : [".webp"];
    const actualExtension = path.extname(result.fileName).toLowerCase();
    const expectedFileName = `${result.assetId}${actualExtension}`;
    if (
      result.fileName !== expectedFileName ||
      result.filePath !== expectedPath ||
      result.url !== expectedUrl ||
      (Array.isArray(expectedExtension)
        ? !expectedExtension.includes(actualExtension)
        : actualExtension !== expectedExtension)
    ) throw new ThumbnailAssetGenerationError();

    const inspection = ThumbnailStorage.inspectStoredThumbnail(
      projectSlug,
      result.filePath,
      result.mimeType,
    );
    if (
      inspection.width !== result.width ||
      inspection.height !== result.height ||
      inspection.byteLength !== result.byteLength
    ) throw new ThumbnailAssetGenerationError();
  } catch {
    throw new ThumbnailAssetGenerationError();
  }
}

function cleanupUnregisteredResult(
  result: ThumbnailAssetGenerationResult,
  projectSlug: string,
  projectId: string,
) {
  try {
    if (
      result.success !== true ||
      !/^[a-zA-Z0-9-_]+$/.test(result.assetId) ||
      !/^[a-zA-Z0-9-_.]+$/.test(result.fileName)
    ) return;
    const extension = path.extname(result.fileName).toLowerCase();
    if (
      result.fileName !== `${result.assetId}${extension}` ||
      result.filePath !== ThumbnailStorage.getThumbnailPath(projectSlug, result.fileName) ||
      result.url !== ThumbnailStorage.getThumbnailUrl(projectSlug, result.fileName)
    ) return;
    const current = AssetManager.getProjectAssets(projectSlug, projectId);
    if (current.assets.some((asset) => asset.id === result.assetId)) return;
    ThumbnailStorage.removeStoredThumbnail(projectSlug, result.filePath);
  } catch {
    // Untrusted provider locators are never used for broad cleanup.
  }
}

function validDate(value: unknown) {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}
