import {
  audioAssetFailurePhases,
  audioAssetRootErrorCodes,
  type AudioAssetErrorEvidence,
  type AudioAssetFailurePhase,
  type AudioAssetRootErrorCode,
} from "@/types/audioError";
import type { AudioGenerationTarget } from "@/types/audio";
import {
  isSafeAudioIdentifier,
  requireSafeAudioIdentifier,
} from "./AudioIdentifierPolicy";
import { isSafeAudioCompensationRef } from "./AudioCompensationStore";

const SAFE_STAGE_ERROR = "Audio asset generation failed.";
const EVIDENCE_KEYS = new Set([
  "kind",
  "code",
  "rootCode",
  "phase",
  "target",
  "chapterId",
  "provider",
  "model",
  "httpStatus",
  "responseBytes",
  "maximumResponseBytes",
  "compensation",
  "compensationRef",
  "cleanup",
]);

export type AudioAssetErrorMetadata = {
  phase?: AudioAssetFailurePhase;
  target?: AudioGenerationTarget;
  provider?: "mock" | "openai";
  model?: string;
  httpStatus?: number;
  responseBytes?: number;
  maximumResponseBytes?: number;
  compensation?: AudioAssetErrorEvidence["compensation"];
  compensationRef?: string;
  cleanup?: AudioAssetErrorEvidence["cleanup"];
};

export class AudioAssetRootError extends Error {
  readonly evidence: AudioAssetErrorEvidence;

  constructor(
    rootCode: AudioAssetRootErrorCode,
    metadata: AudioAssetErrorMetadata = {},
  ) {
    super(SAFE_STAGE_ERROR);
    this.name = "AudioAssetRootError";
    this.evidence = createAudioAssetErrorEvidence(rootCode, metadata);
    this.stack = undefined;
  }
}

export class AudioCanonicalAdmissionConflictError extends AudioAssetRootError {
  constructor() {
    super("AUDIO_STORAGE_WRITE_FAILED", { phase: "storage" });
    this.name = "AudioCanonicalAdmissionConflictError";
  }
}

export function createAudioAssetErrorEvidence(
  rootCode: AudioAssetRootErrorCode,
  metadata: AudioAssetErrorMetadata = {},
): AudioAssetErrorEvidence {
  const target = sanitizeTarget(metadata.target);
  const model = metadata.model === undefined
    ? undefined
    : requireSafeAudioIdentifier(metadata.model);
  return Object.freeze({
    kind: "audio-asset-error" as const,
    code: "AUDIO_ASSET_GENERATION_FAILED" as const,
    rootCode: audioAssetRootErrorCodes.includes(rootCode)
      ? rootCode
      : "AUDIO_PROVIDER_RESPONSE_INVALID",
    phase: metadata.phase && audioAssetFailurePhases.includes(metadata.phase)
      ? metadata.phase
      : "unknown",
    target: target.kind,
    ...(target.chapterId !== undefined ? { chapterId: target.chapterId } : {}),
    ...(metadata.provider === "mock" || metadata.provider === "openai"
      ? { provider: metadata.provider }
      : {}),
    ...(model ? { model } : {}),
    ...(integer(metadata.httpStatus, 100, 599)
      ? { httpStatus: metadata.httpStatus }
      : {}),
    ...(integer(metadata.responseBytes, 0)
      ? { responseBytes: metadata.responseBytes }
      : {}),
    ...(integer(metadata.maximumResponseBytes, 1)
      ? { maximumResponseBytes: metadata.maximumResponseBytes }
      : {}),
    ...(metadata.compensation === "not-required" ||
    metadata.compensation === "completed" ||
    metadata.compensation === "failed"
      ? { compensation: metadata.compensation }
      : {}),
    ...(isSafeAudioCompensationRef(metadata.compensationRef)
      ? { compensationRef: metadata.compensationRef }
      : {}),
    ...(metadata.cleanup === "inspection-failed" ||
    metadata.cleanup === "ownership-mismatch" ||
    metadata.cleanup === "unlink-failed" ||
    metadata.cleanup === "verification-failed" ||
    metadata.cleanup === "completed" ||
    metadata.cleanup === "not-required" ||
    metadata.cleanup === "failed" ||
    metadata.cleanup === "deferred" ||
    metadata.cleanup === "backlog-saturated"
      ? { cleanup: metadata.cleanup }
      : {}),
  });
}

export function isAudioAssetErrorEvidence(
  value: unknown,
): value is AudioAssetErrorEvidence {
  if (!value || typeof value !== "object") return false;
  const evidence = value as AudioAssetErrorEvidence;
  return Object.keys(evidence).every((key) => EVIDENCE_KEYS.has(key)) &&
    evidence.kind === "audio-asset-error" &&
    evidence.code === "AUDIO_ASSET_GENERATION_FAILED" &&
    audioAssetRootErrorCodes.includes(evidence.rootCode) &&
    audioAssetFailurePhases.includes(evidence.phase) &&
    ["section", "mix", "unknown"].includes(evidence.target) &&
    (evidence.target === "section"
      ? integer(evidence.chapterId, 1)
      : evidence.chapterId === undefined) &&
    (evidence.provider === undefined ||
      evidence.provider === "mock" ||
      evidence.provider === "openai") &&
    (evidence.model === undefined ||
      isSafeAudioIdentifier(evidence.model)) &&
    optionalInteger(evidence.httpStatus, 100, 599) &&
    optionalInteger(evidence.responseBytes, 0) &&
    optionalInteger(evidence.maximumResponseBytes, 1) &&
    (evidence.compensation === undefined ||
      evidence.compensation === "not-required" ||
      evidence.compensation === "completed" ||
      evidence.compensation === "failed") &&
    (evidence.compensationRef === undefined ||
      isSafeAudioCompensationRef(evidence.compensationRef)) &&
    (evidence.cleanup === undefined ||
      evidence.cleanup === "inspection-failed" ||
      evidence.cleanup === "ownership-mismatch" ||
      evidence.cleanup === "unlink-failed" ||
      evidence.cleanup === "verification-failed" ||
      evidence.cleanup === "completed" ||
      evidence.cleanup === "not-required" ||
      evidence.cleanup === "failed" ||
      evidence.cleanup === "deferred" ||
      evidence.cleanup === "backlog-saturated");
}

export function getAudioAssetErrorEvidence(
  value: unknown,
): AudioAssetErrorEvidence | undefined {
  const evidence = (value as { evidence?: unknown } | null)?.evidence;
  return isAudioAssetErrorEvidence(evidence) ? evidence : undefined;
}

export function serializeAudioAssetErrorEvidence(value: unknown): string[] {
  if (!isAudioAssetErrorEvidence(value)) return [];
  return [
    `audio-root:${value.rootCode}`,
    `audio-phase:${value.phase}`,
    ...(value.cleanup ? [`audio-cleanup:${value.cleanup}`] : []),
    ...(value.compensation
      ? [`audio-compensation:${value.compensation}`]
      : []),
    ...(value.compensationRef
      ? [`audio-compensation-ref:${value.compensationRef}`]
      : []),
    `audio-target:${value.target}`,
    ...(value.chapterId !== undefined
      ? [`audio-chapter:${value.chapterId}`]
      : []),
    ...(value.provider ? [`audio-provider:${value.provider}`] : []),
    ...(value.model ? [`audio-model:${value.model}`] : []),
    ...(value.httpStatus !== undefined
      ? [`audio-http:${value.httpStatus}`]
      : []),
    ...(value.responseBytes !== undefined
      ? [`audio-response-bytes:${value.responseBytes}`]
      : []),
    ...(value.maximumResponseBytes !== undefined
      ? [`audio-response-limit:${value.maximumResponseBytes}`]
      : []),
  ].slice(0, 10);
}

function sanitizeTarget(target: AudioGenerationTarget | undefined): {
  kind: AudioAssetErrorEvidence["target"];
  chapterId?: number;
} {
  if (target?.kind === "mix") return { kind: "mix" };
  if (
    target?.kind === "section" &&
    Number.isSafeInteger(target.chapterId) &&
    target.chapterId > 0
  ) {
    return { kind: "section", chapterId: target.chapterId };
  }
  return { kind: "unknown" };
}

function integer(
  value: number | undefined,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): value is number {
  return Number.isSafeInteger(value) &&
    (value as number) >= minimum &&
    (value as number) <= maximum;
}

function optionalInteger(
  value: number | undefined,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
) {
  return value === undefined || integer(value, minimum, maximum);
}
