import type { ImageGenerationResult, ImageMimeType } from "@/types/asset";
import { createProviderDispatchAdapter } from "@/lib/providers/ProviderDispatchAdapterAuthority";
import { ImageStorage } from "../storage/ImageStorage";
import { getRealImageProviderConfig } from "./ImageProviderConfig";
import type { ImageGenerationInput, ConfiguredImageProvider } from "./ImageProvider";
import {
  WikimediaCommonsClient,
  type WikimediaCommonsCandidate,
} from "./sources/WikimediaCommonsClient";

const NOT_FOUND_ERROR = "No matching real photo found.";

type EligibleCandidate = WikimediaCommonsCandidate & {
  license: string;
  mimeType: ImageMimeType;
};

/**
 * "Real" image provider: searches free/openly-licensed photo archives for a scene before any
 * AI generation is attempted. Currently backed by Wikimedia Commons only; future sources
 * (Openverse, Library of Congress/Archive.org, NASA, Pexels/Pixabay/Unsplash) are added as
 * additional internal source clients here, not as new top-level ImageProviderName values —
 * see ADR-019.
 *
 * When no acceptable real photo is found, this returns success:false rather than silently
 * generating an AI image itself; VisualAssetPipeline decides whether to fall back to the
 * "openai" provider so the persisted asset's provider/model fields stay an honest record of
 * what actually produced each image.
 */
export class RealPhotoImageProvider implements ConfiguredImageProvider {
  readonly name = "real" as const;
  private readonly client: WikimediaCommonsClient;

  constructor(options: { fetcher?: typeof fetch; client?: WikimediaCommonsClient } = {}) {
    const config = getRealImageProviderConfig();
    this.client = options.client ?? new WikimediaCommonsClient({
      fetcher: options.fetcher,
      timeoutMs: config.timeoutMs,
      maxResponseBytes: config.maximumResponseBytes,
    });
  }

  createImmutableImageDispatchAdapter() {
    return createProviderDispatchAdapter(this, {
      metadata: { name: this.name }, requiredMethods: ["generateImage"],
    });
  }

  async generateImage(
    input: ImageGenerationInput,
  ): Promise<ImageGenerationResult> {
    const createdAt = new Date().toISOString();
    const query = buildSearchQuery(input.searchKeywords);

    if (!query || !input.projectSlug) {
      return notFoundResult(input.sceneId, createdAt);
    }

    const config = getRealImageProviderConfig();
    let candidates: WikimediaCommonsCandidate[];
    try {
      candidates = await this.client.search(query, config.searchResultLimit);
    } catch {
      return notFoundResult(input.sceneId, createdAt);
    }

    const eligible = candidates.filter(
      (candidate): candidate is EligibleCandidate =>
        toSafeImageMimeType(candidate.mimeType) !== null &&
        candidate.width >= config.minimumWidth &&
        candidate.height >= config.minimumHeight &&
        isFreeLicense(candidate.license),
    );

    if (eligible.length === 0) {
      return notFoundResult(input.sceneId, createdAt);
    }

    const best = eligible.reduce((winner, candidate) =>
      candidate.width * candidate.height > winner.width * winner.height ? candidate : winner,
    );
    const mimeType = toSafeImageMimeType(best.mimeType);
    if (!mimeType) {
      return notFoundResult(input.sceneId, createdAt);
    }

    let bytes: Buffer;
    try {
      bytes = await this.client.downloadImage(best.imageUrl);
    } catch {
      return notFoundResult(input.sceneId, createdAt);
    }

    try {
      const savedImage = ImageStorage.saveImage({
        projectSlug: input.projectSlug,
        data: bytes,
        mimeType,
      });
      const inspection = ImageStorage.inspectStoredImage(
        input.projectSlug,
        savedImage.filePath,
        mimeType,
      );
      if (
        inspection.byteLength !== bytes.byteLength ||
        savedImage.url !== ImageStorage.getImageUrl(input.projectSlug, savedImage.fileName) ||
        savedImage.filePath !== ImageStorage.getImagePath(input.projectSlug, savedImage.fileName)
      ) {
        return notFoundResult(input.sceneId, createdAt);
      }

      return {
        success: true,
        sceneId: input.sceneId,
        provider: "real",
        model: best.sourceName,
        filePath: savedImage.filePath,
        url: savedImage.url,
        mimeType,
        sourceName: best.sourceName,
        sourceUrl: best.pageUrl,
        license: best.license,
        attribution: best.attribution,
        createdAt,
      };
    } catch {
      return notFoundResult(input.sceneId, createdAt);
    }
  }
}

function buildSearchQuery(keywords: string[] | undefined): string | null {
  if (!keywords || keywords.length === 0) return null;
  const cleaned = keywords.map((keyword) => keyword.trim()).filter(Boolean);
  if (cleaned.length === 0) return null;
  return cleaned.join(" ").slice(0, 300);
}

function toSafeImageMimeType(value: string): ImageMimeType | null {
  return value === "image/png" || value === "image/jpeg" || value === "image/webp"
    ? value
    : null;
}

function isFreeLicense(license: string | undefined): boolean {
  if (!license) return false;
  const normalized = license.trim().toLowerCase();
  if (!normalized) return false;
  if (normalized.includes("public domain")) return true;
  if (/^pd(-|$)/.test(normalized)) return true;
  if (normalized.startsWith("cc0")) return true;
  if (/^cc[\s-]by(?:[\s-]sa)?[\s-]?\d/.test(normalized)) return true;
  return false;
}

function notFoundResult(sceneId: number, createdAt: string): ImageGenerationResult {
  return {
    success: false,
    sceneId,
    provider: "real",
    createdAt,
    error: NOT_FOUND_ERROR,
  };
}
