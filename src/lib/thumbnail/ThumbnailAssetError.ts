import {
  thumbnailAssetFailurePhases,
  type ThumbnailAssetErrorEvidence,
  type ThumbnailAssetFailurePhase,
} from "@/types/thumbnailError";

const EVIDENCE_KEYS = new Set([
  "kind",
  "code",
  "phase",
  "provider",
  "model",
  "providerHttpStatus",
  "providerErrorCode",
]);

const SANITIZED_CODE = /^[a-z0-9_.-]{1,64}$/;
const SAFE_MODEL = /^[a-zA-Z0-9_.:-]{1,64}$/;

export interface ThumbnailAssetErrorMetadata {
  phase?: ThumbnailAssetFailurePhase;
  provider?: "mock" | "openai";
  model?: string;
  httpStatus?: number;
  providerErrorCode?: string;
}

export function createThumbnailAssetErrorEvidence(
  metadata: ThumbnailAssetErrorMetadata = {},
): ThumbnailAssetErrorEvidence {
  return Object.freeze({
    kind: "thumbnail-asset-error" as const,
    code: "THUMBNAIL_ASSET_GENERATION_FAILED" as const,
    phase: metadata.phase && thumbnailAssetFailurePhases.includes(metadata.phase)
      ? metadata.phase
      : "unknown",
    ...(metadata.provider === "mock" || metadata.provider === "openai"
      ? { provider: metadata.provider }
      : {}),
    ...(typeof metadata.model === "string" && SAFE_MODEL.test(metadata.model)
      ? { model: metadata.model }
      : {}),
    ...(integer(metadata.httpStatus, 100, 599)
      ? { providerHttpStatus: metadata.httpStatus }
      : {}),
    ...(typeof metadata.providerErrorCode === "string" &&
      SANITIZED_CODE.test(metadata.providerErrorCode)
      ? { providerErrorCode: metadata.providerErrorCode }
      : {}),
  });
}

export function isThumbnailAssetErrorEvidence(
  value: unknown,
): value is ThumbnailAssetErrorEvidence {
  if (!value || typeof value !== "object") return false;
  const evidence = value as ThumbnailAssetErrorEvidence;
  return Object.keys(evidence).every((key) => EVIDENCE_KEYS.has(key)) &&
    evidence.kind === "thumbnail-asset-error" &&
    evidence.code === "THUMBNAIL_ASSET_GENERATION_FAILED" &&
    thumbnailAssetFailurePhases.includes(evidence.phase) &&
    (evidence.provider === undefined ||
      evidence.provider === "mock" || evidence.provider === "openai") &&
    (evidence.model === undefined ||
      (typeof evidence.model === "string" && SAFE_MODEL.test(evidence.model))) &&
    (evidence.providerHttpStatus === undefined ||
      integer(evidence.providerHttpStatus, 100, 599)) &&
    (evidence.providerErrorCode === undefined ||
      (typeof evidence.providerErrorCode === "string" &&
        SANITIZED_CODE.test(evidence.providerErrorCode)));
}

export function getThumbnailAssetErrorEvidence(
  value: unknown,
): ThumbnailAssetErrorEvidence | undefined {
  const evidence = (value as { evidence?: unknown } | null)?.evidence;
  return isThumbnailAssetErrorEvidence(evidence) ? evidence : undefined;
}

/**
 * Best-effort extraction of a short, sanitized provider error code from a raw
 * provider error message. Never returns anything that isn't `[a-z0-9_.-]{1,64}`.
 * An API key / secret can never match that shape once whitespace is required to
 * be absent, and only the first token is considered.
 */
export function sanitizeProviderErrorCode(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const firstToken = raw.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  const stripped = firstToken.replace(/[^a-z0-9_.-]/g, "");
  return stripped.length >= 3 && stripped.length <= 64 ? stripped : undefined;
}

function integer(value: number | undefined, minimum: number, maximum: number): value is number {
  return Number.isSafeInteger(value) &&
    (value as number) >= minimum && (value as number) <= maximum;
}
