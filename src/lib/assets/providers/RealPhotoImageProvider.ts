import type { ImageGenerationResult, ImageMimeType } from "@/types/asset";
import { createProviderDispatchAdapter } from "@/lib/providers/ProviderDispatchAdapterAuthority";
import { ImageStorage } from "../storage/ImageStorage";
import { getRealImageProviderConfig } from "./ImageProviderConfig";
import type { ImageGenerationInput, ConfiguredImageProvider } from "./ImageProvider";
import {
  WikimediaCommonsClient,
  WikimediaCommonsRateLimitedError,
  type WikimediaCommonsCandidate,
} from "./sources/WikimediaCommonsClient";

const NOT_FOUND_ERROR = "No matching real photo found.";

/**
 * Wikimedia's standard attribution placeholder for images mass-extracted from Internet Archive
 * book/document scans by the "Internet Archive Book Images" bot. These pages share the scanned
 * book's title regardless of what the individual page illustration actually depicts, so a title
 * match alone cannot be trusted for them — they are excluded rather than ranked (Sprint 130.1).
 */
const BOOK_SCAN_ATTRIBUTION = "internet archive book images";

type RankedCandidate = WikimediaCommonsCandidate & {
  license: string;
  mimeType: ImageMimeType;
  score: number;
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
  private readonly delayFn: (ms: number) => Promise<void>;
  private readonly now: () => number;
  /** Wall-clock time of the last dispatched scene, for inter-scene pacing (Sprint 130.2). */
  private lastRequestAt: number | null = null;

  constructor(options: {
    fetcher?: typeof fetch;
    client?: WikimediaCommonsClient;
    delayFn?: (ms: number) => Promise<void>;
    /** Injectable clock for deterministic scene-budget tests; defaults to Date.now. */
    now?: () => number;
  } = {}) {
    const config = getRealImageProviderConfig();
    this.delayFn = options.delayFn ??
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = options.now ?? (() => Date.now());
    this.client = options.client ?? new WikimediaCommonsClient({
      fetcher: options.fetcher,
      timeoutMs: config.timeoutMs,
      maxResponseBytes: config.maximumResponseBytes,
      retryDelayMs: config.retryDelayMs,
      delayFn: this.delayFn,
    });
  }

  createImmutableImageDispatchAdapter() {
    return createProviderDispatchAdapter(this, {
      metadata: { name: this.name }, requiredMethods: ["generateImage"],
    });
  }

  private async paceRequest(minIntervalMs: number): Promise<void> {
    if (minIntervalMs > 0 && this.lastRequestAt !== null) {
      const wait = minIntervalMs - (this.now() - this.lastRequestAt);
      if (wait > 0) await this.delayFn(wait);
    }
    this.lastRequestAt = this.now();
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
    // A batch of scenes fired back-to-back with no gap can trip Wikimedia's burst rate limiting
    // even though each request individually is well inside quota — space consecutive scenes on
    // this provider instance apart by a minimum interval (Sprint 130.2). Scenes with no keywords
    // never reach this point, so purely-AI scenes are never delayed.
    await this.paceRequest(config.minRequestIntervalMs);

    let candidates: WikimediaCommonsCandidate[];
    try {
      candidates = await this.client.search(query, config.searchResultLimit, config.targetDownloadWidth);
    } catch {
      return notFoundResult(input.sceneId, createdAt);
    }

    const ranked = rankEligibleCandidates(candidates, query, config);
    if (ranked.length === 0) {
      return notFoundResult(input.sceneId, createdAt);
    }

    // Sprint 130.2: the whole scene (all candidate attempts combined) is bounded by a single
    // wall-clock deadline, so a slow/failing candidate can never eat the entire per-attempt
    // timeout for every remaining candidate — it eats only its fair share of what's left.
    const deadline = this.now() + config.sceneBudgetMs;
    const attemptLimit = Math.min(ranked.length, config.candidateAttemptLimit);
    const perCandidateTimeoutMs = Math.max(
      1_000,
      Math.min(config.timeoutMs, Math.floor(config.sceneBudgetMs / attemptLimit)),
    );

    for (let index = 0; index < attemptLimit; index += 1) {
      if (this.now() >= deadline) break;

      const candidate = ranked[index];
      if (index > 0) {
        const pacing = Math.min(config.retryDelayMs, Math.max(0, deadline - this.now()));
        if (pacing > 0) await this.delayFn(pacing);
        if (this.now() >= deadline) break;
      }

      const attemptTimeoutMs = Math.min(perCandidateTimeoutMs, Math.max(0, deadline - this.now()));
      if (attemptTimeoutMs <= 0) break;

      let bytes: Buffer;
      try {
        bytes = await this.client.downloadImage(candidate.imageUrl, attemptTimeoutMs);
      } catch (error) {
        // A rate limit applies to the whole host, not this one file — trying more candidates
        // would just collect more 429s. Stop the scene here rather than compound it.
        if (error instanceof WikimediaCommonsRateLimitedError) break;
        continue;
      }

      const saved = trySaveCandidate(input.projectSlug, bytes, candidate.mimeType);
      if (!saved) continue;

      return {
        success: true,
        sceneId: input.sceneId,
        provider: "real",
        model: candidate.sourceName,
        filePath: saved.filePath,
        url: saved.url,
        mimeType: candidate.mimeType,
        sourceName: candidate.sourceName,
        sourceUrl: candidate.pageUrl,
        license: candidate.license,
        attribution: candidate.attribution,
        selectionScore: candidate.score,
        selectionRank: index + 1,
        candidateCount: ranked.length,
        width: candidate.width,
        height: candidate.height,
        createdAt,
      };
    }

    return notFoundResult(input.sceneId, createdAt);
  }
}

function trySaveCandidate(
  projectSlug: string,
  bytes: Buffer,
  mimeType: ImageMimeType,
): { filePath: string; url: string } | null {
  try {
    const savedImage = ImageStorage.saveImage({ projectSlug, data: bytes, mimeType });
    const inspection = ImageStorage.inspectStoredImage(projectSlug, savedImage.filePath, mimeType);
    if (
      inspection.byteLength !== bytes.byteLength ||
      savedImage.url !== ImageStorage.getImageUrl(projectSlug, savedImage.fileName) ||
      savedImage.filePath !== ImageStorage.getImagePath(projectSlug, savedImage.fileName)
    ) {
      return null;
    }
    return { filePath: savedImage.filePath, url: savedImage.url };
  } catch {
    return null;
  }
}

/**
 * Filters to eligible candidates (safe MIME, minimum resolution, free license, not a book-scan
 * artifact) and ranks them by title/query word-overlap score first, resolution second. A pure
 * "highest resolution wins" rule can pick a technically-eligible but semantically wrong match
 * (e.g. "Little Hagia Sophia" for a plain "Hagia Sophia" query); word-overlap scoring prefers
 * the candidate whose title actually covers the query terms (Sprint 130.1).
 */
function rankEligibleCandidates(
  candidates: WikimediaCommonsCandidate[],
  query: string,
  config: ReturnType<typeof getRealImageProviderConfig>,
): RankedCandidate[] {
  const queryWords = tokenize(query);
  return candidates
    .filter((candidate) => !isBookScanArtifact(candidate))
    .filter((candidate): candidate is WikimediaCommonsCandidate & { license: string; mimeType: ImageMimeType } =>
      toSafeImageMimeType(candidate.mimeType) !== null &&
      candidate.width >= config.minimumWidth &&
      candidate.height >= config.minimumHeight &&
      isFreeLicense(candidate.license))
    .map((candidate) => ({ ...candidate, score: titleMatchScore(queryWords, candidate.title) }))
    .sort((a, b) => b.score - a.score || b.width * b.height - a.width * a.height);
}

function isBookScanArtifact(candidate: WikimediaCommonsCandidate): boolean {
  return candidate.attribution?.trim().toLowerCase() === BOOK_SCAN_ATTRIBUTION;
}

function tokenize(value: string): string[] {
  return value.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

/** Fraction (0-1) of distinct query words that appear as whole words in the candidate title. */
function titleMatchScore(queryWords: string[], title: string): number {
  const distinctQueryWords = Array.from(new Set(queryWords));
  if (distinctQueryWords.length === 0) return 0;
  const titleWords = new Set(tokenize(title));
  const matched = distinctQueryWords.filter((word) => titleWords.has(word)).length;
  return matched / distinctQueryWords.length;
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
