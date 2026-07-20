export const audioAssetRootErrorCodes = [
  "AUDIO_PROVIDER_CONFIGURATION_INVALID",
  "AUDIO_PROVIDER_REQUEST_FAILED",
  "AUDIO_PROVIDER_TIMEOUT",
  "AUDIO_PROVIDER_RESPONSE_INVALID",
  "AUDIO_PROVIDER_RESPONSE_TOO_LARGE",
  "AUDIO_PROVIDER_CONTENT_TYPE_INVALID",
  "AUDIO_WAV_INVALID",
  "AUDIO_STORAGE_WRITE_FAILED",
  "AUDIO_ASSET_REGISTRY_FAILED",
] as const;

export type AudioAssetRootErrorCode =
  typeof audioAssetRootErrorCodes[number];

export const audioAssetFailurePhases = [
  "configuration",
  "request",
  "response",
  "validation",
  "storage",
  "registry",
  "unknown",
] as const;

export type AudioAssetFailurePhase = typeof audioAssetFailurePhases[number];

export interface AudioAssetErrorEvidence {
  kind: "audio-asset-error";
  code: "AUDIO_ASSET_GENERATION_FAILED";
  rootCode: AudioAssetRootErrorCode;
  phase: AudioAssetFailurePhase;
  target: "section" | "mix" | "unknown";
  chapterId?: number;
  provider?: "mock" | "openai";
  model?: string;
  httpStatus?: number;
  responseBytes?: number;
  maximumResponseBytes?: number;
  compensation?: "not-required" | "completed" | "failed";
  compensationRef?: string;
  cleanup?:
    | "inspection-failed"
    | "ownership-mismatch"
    | "unlink-failed"
    | "verification-failed"
    | "completed"
    | "not-required"
    | "failed"
    | "deferred"
    | "backlog-saturated";
}
