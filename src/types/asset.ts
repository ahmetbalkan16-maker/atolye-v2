export type AssetType =
  | "image"
  | "animation"
  | "video"
  | "audio"
  | "thumbnail";

export type AssetStatus =
  | "planned"
  | "generating"
  | "generated"
  | "failed";

/**
 * Whether an asset's pixels/frames came from a real external source (a photo
 * archive, museum, government/university collection, open-licence media, a real
 * video clip) or were synthesised by an AI model. Derived deterministically from
 * the producing provider, never model-authored.
 */
export type MediaOrigin = "real" | "ai";

/**
 * Coarse kind of a real-media asset, for the documentary media-selection ladder
 * (real video > real photo/archive > map/document > AI image). "ai-image" is the
 * single bucket for anything an image model produced. "music" / "ambience" are
 * the audio-bed buckets (Faz 4) — a licence-cleared background track or an
 * ambience/room-tone bed, never AI-synthesised.
 */
export type MediaType =
  | "photo"
  | "video"
  | "map"
  | "document"
  | "archive"
  | "ai-image"
  | "music"
  | "ambience";

/**
 * Deterministic rights classification for a real-media asset, derived from the
 * source-reported licence string by `classifyMediaRightsStatus`. `verified` is
 * reserved for an explicit out-of-band human/provenance confirmation and is
 * never assigned by the automatic classifier. Production admission treats only
 * `public-domain` / `open-license` / `verified` as safe; `restricted` /
 * `unknown` fail closed rather than being pulled in silently.
 */
export type MediaRightsStatus =
  | "verified"
  | "open-license"
  | "public-domain"
  | "unknown"
  | "restricted";

export interface Asset {
  id: string;

  projectId: string;

  projectSlug?: string;

  sceneId?: number;

  type: AssetType;

  status: AssetStatus;

  provider: string;

  model?: string;

  prompt: string;

  filePath?: string;

  url?: string;

  mimeType?: string;

  byteLength?: number;

  durationSeconds?: number;

  artifactType?: "motion-plan" | "scene-video";

  sourceAssetId?: string;

  animationAssetId?: string;

  generationMode?: "mock" | "production";

  width?: number;

  height?: number;

  frameRate?: number;

  transition?: string;

  /** Real-photo sourcing only: which external archive/library provided the image. */
  sourceName?: string;

  /** Real-photo sourcing only: the source's page URL for the image (provenance/attribution). */
  sourceUrl?: string;

  /** Real-photo sourcing only: the license identifier reported by the source. */
  license?: string;

  /** Real-photo sourcing only: required attribution/credit line, when the license demands one. */
  attribution?: string;

  /** Real-photo sourcing only: 0-1 title/query word-overlap score of the chosen candidate. */
  selectionScore?: number;

  /** Real-photo sourcing only: 1-based rank of the chosen candidate among eligible candidates
   *  (2+ means earlier-ranked candidates failed download and this one was used instead). */
  selectionRank?: number;

  /** Real-photo sourcing only: how many eligible candidates were considered in total. */
  candidateCount?: number;

  /**
   * Documentary media provenance (Sprint 166, additive). Populated for assets
   * that go through the real-media path; left undefined by the existing
   * AI-image / mock paths until they are migrated, so every current asset and
   * fixture stays valid.
   */
  mediaOrigin?: MediaOrigin;

  /** Coarse media kind (photo / video / map / document / archive / ai-image). */
  mediaType?: MediaType;

  /** Deterministic rights classification derived from `license` (real media only). */
  rightsStatus?: MediaRightsStatus;

  /**
   * Short, human-readable reason this media was chosen for the scene, e.g.
   * "historical-footage-match", "archive-photo-match",
   * "no-suitable-real-media-found". Bounded, never model-authored free text.
   */
  selectionReason?: string;

  /** When the real-media candidate was discovered/selected (ISO-8601). */
  discoveredAt?: string;

  /**
   * Real-video ingestion (ADR-020 / Faz 3, additive). The direct source file URL
   * the clip was downloaded from, the SHA-256 of the downloaded bytes (download
   * integrity + deterministic identity), and — when only a slice of the source
   * was used — the in/out points in seconds. Undefined for photo / AI / mock.
   */
  mediaUrl?: string;

  checksum?: string;

  segmentStartSeconds?: number;

  segmentEndSeconds?: number;

  error?: string;

  createdAt: string;

  updatedAt?: string;
}

export interface ProjectAssets {
  projectId: string;

  projectSlug?: string;

  assets: Asset[];

  createdAt: string;

  updatedAt: string;
}

export type ImageProviderName = "mock" | "openai" | "real";

export type ImageMimeType = "image/png" | "image/jpeg" | "image/webp";

export type VideoMimeType = "video/mp4";

type ImageGenerationResultBase = {
  id?: string;
  sceneId: number;
  provider: ImageProviderName;
  model?: string;
  createdAt: string;
};

export type ImageGenerationMockSuccess = ImageGenerationResultBase & {
  success: true;
  provider: "mock";
  filePath: "";
  url: "";
  mimeType: "image/mock";
  error?: never;
};

type ImageGenerationFileLocator = {
  filePath: string;
  url?: string;
};

type ImageGenerationUrlLocator = {
  filePath?: string;
  url: string;
};

export type ImageGenerationRealSuccess = ImageGenerationResultBase &
  (ImageGenerationFileLocator | ImageGenerationUrlLocator) & {
    success: true;
    provider: "openai";
    mimeType: ImageMimeType;
    error?: never;
  };

export type ImageGenerationRealPhotoSuccess = ImageGenerationResultBase &
  (ImageGenerationFileLocator | ImageGenerationUrlLocator) & {
    success: true;
    provider: "real";
    mimeType: ImageMimeType;
    sourceName: string;
    sourceUrl: string;
    license: string;
    attribution?: string;
    selectionScore: number;
    selectionRank: number;
    candidateCount: number;
    width: number;
    height: number;
    error?: never;
  };

/**
 * Safe, bounded diagnostic detail for a failed image generation. Never carries
 * secrets (no API key, no Authorization header, no raw request body); the body
 * summary is a short, sanitized excerpt of the provider's own error object.
 */
export interface ImageGenerationErrorEvidence {
  /** HTTP status of the provider response, when the failure was an HTTP error. */
  readonly httpStatus?: number;
  /** Provider-reported error code (e.g. "content_policy_violation"), when present. */
  readonly providerErrorCode?: string;
  /** Provider-reported error type (e.g. "invalid_request_error"), when present. */
  readonly providerErrorType?: string;
  /** Short (<= 300 char), control-stripped excerpt of the provider error message/object. */
  readonly bodySummary?: string;
  /** Whether a single controlled retry is safe (429 / 5xx / timeout). */
  readonly retryable: boolean;
  /** Model the failed request targeted. */
  readonly model?: string;
  /** Scene the failed request belonged to, when known. */
  readonly sceneId?: number;
}

export type ImageGenerationFailure = ImageGenerationResultBase & {
  success: false;
  error: string;
  errorEvidence?: ImageGenerationErrorEvidence;
  filePath?: never;
  url?: never;
  mimeType?: never;
};

export type ImageGenerationResult =
  | ImageGenerationMockSuccess
  | ImageGenerationRealSuccess
  | ImageGenerationRealPhotoSuccess
  | ImageGenerationFailure;
