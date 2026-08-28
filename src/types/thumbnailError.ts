export const thumbnailAssetFailurePhases = [
  "input-validation",
  "assembly-dependency",
  "provider-request",
  "provider-response",
  "provider-result-validation",
  "asset-registration",
  "persistence",
  "unknown",
] as const;

export type ThumbnailAssetFailurePhase = typeof thumbnailAssetFailurePhases[number];

/**
 * Structured, sanitized evidence for a failed `thumbnail` pipeline stage.
 * Mirrors `AudioAssetErrorEvidence` so it flows through the existing
 * `PipelineErrorEvidence` -> `persistStageFailure` history/job channel with no
 * new plumbing. Carries the real provider HTTP status / sanitized error code
 * (e.g. 401 / "invalid_api_key") that the stage previously discarded -- an API
 * key or secret is NEVER placed in any of these fields.
 */
export interface ThumbnailAssetErrorEvidence {
  kind: "thumbnail-asset-error";
  code: "THUMBNAIL_ASSET_GENERATION_FAILED";
  phase: ThumbnailAssetFailurePhase;
  provider?: "mock" | "openai";
  model?: string;
  /** Provider response HTTP status (100..599). */
  providerHttpStatus?: number;
  /** Sanitized provider error code, `[a-z0-9_.-]{1,64}` (e.g. "invalid_api_key"). */
  providerErrorCode?: string;
}

/** Diagnostics a thumbnail provider may attach to a failure result. */
export interface ThumbnailAssetProviderFailureDiagnostics {
  readonly httpStatus?: number;
  readonly providerErrorCode?: string;
}
