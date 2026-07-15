import {
  animationFailurePhases,
  animationFinishReasons,
  animationMotionPlanErrorCodes,
  type AnimationMotionPlanErrorCode,
  type AnimationMotionPlanErrorEvidence,
  type AnimationProviderDiagnosticMetadata,
} from "@/types/animationError";

const SAFE_ERROR = "Animation motion plan generation failed.";
const SAFE_VALUE = /^[a-zA-Z0-9._:-]{1,200}$/;

export class AnimationMotionPlanError extends Error {
  readonly evidence: AnimationMotionPlanErrorEvidence;

  constructor(
    readonly code: AnimationMotionPlanErrorCode = "ANIMATION_MOTION_PLAN_FAILED",
    metadata: AnimationProviderDiagnosticMetadata = {
      sceneId: 0,
      phase: "unknown",
    },
  ) {
    super(SAFE_ERROR);
    this.name = "AnimationMotionPlanError";
    this.evidence = Object.freeze({
      kind: "animation-motion-plan-error" as const,
      code,
      ...sanitizeMetadata(metadata),
    });
    this.stack = undefined;
  }
}

export function getAnimationMotionPlanErrorEvidence(
  value: unknown,
): AnimationMotionPlanErrorEvidence | undefined {
  return value instanceof AnimationMotionPlanError ? value.evidence : undefined;
}

export function isAnimationMotionPlanErrorEvidence(
  value: unknown,
): value is AnimationMotionPlanErrorEvidence {
  if (!value || typeof value !== "object") return false;
  const evidence = value as AnimationMotionPlanErrorEvidence;
  return evidence.kind === "animation-motion-plan-error" &&
    animationMotionPlanErrorCodes.includes(evidence.code) &&
    Number.isSafeInteger(evidence.sceneId) && evidence.sceneId >= 0 &&
    animationFailurePhases.includes(evidence.phase) &&
    optionalSafe(evidence.provider) && optionalSafe(evidence.model) &&
    optionalSafe(evidence.reason) && optionalInteger(evidence.httpStatus, 100, 599) &&
    (evidence.finishReason === undefined || animationFinishReasons.includes(evidence.finishReason)) &&
    optionalInteger(evidence.responseLength, 0) &&
    optionalInteger(evidence.promptTokens, 0) &&
    optionalInteger(evidence.completionTokens, 0) &&
    optionalInteger(evidence.totalTokens, 0) &&
    optionalInteger(evidence.durationMs, 0) &&
    optionalInteger(evidence.retryCount, 0);
}

export function serializeAnimationMotionPlanEvidence(
  value: unknown,
): string[] {
  if (!isAnimationMotionPlanErrorEvidence(value)) return [];
  const evidence = value;
  return [
    `animation-scene:${evidence.sceneId}`,
    `animation-phase:${durablePhase(evidence.phase)}`,
    ...(evidence.provider ? [`animation-provider:${evidence.provider}`] : []),
    ...(evidence.model ? [`animation-model:${evidence.model}`] : []),
    ...(evidence.reason ? [`animation-reason:${evidence.reason}`] : []),
    ...(evidence.httpStatus ? [`animation-http:${evidence.httpStatus}`] : []),
    ...(evidence.finishReason ? [`animation-finish:${evidence.finishReason}`] : []),
    ...(evidence.responseLength !== undefined
      ? [`animation-response-length:${evidence.responseLength}`]
      : []),
    ...(evidence.durationMs !== undefined
      ? [`animation-duration-ms:${evidence.durationMs}`]
      : []),
    ...(evidence.retryCount !== undefined
      ? [`animation-retry-count:${evidence.retryCount}`]
      : []),
  ].slice(0, 10);
}

function durablePhase(phase: AnimationProviderDiagnosticMetadata["phase"]) {
  return phase === "provider-response" ? "provider-result" : phase;
}

function sanitizeMetadata(
  metadata: AnimationProviderDiagnosticMetadata,
): AnimationProviderDiagnosticMetadata {
  return {
    sceneId: Number.isSafeInteger(metadata.sceneId) && metadata.sceneId > 0
      ? metadata.sceneId
      : 0,
    phase: animationFailurePhases.includes(metadata.phase)
      ? metadata.phase
      : "unknown",
    ...(safe(metadata.provider) ? { provider: metadata.provider } : {}),
    ...(safe(metadata.model) ? { model: metadata.model } : {}),
    ...(safe(metadata.reason) ? { reason: metadata.reason } : {}),
    ...(integer(metadata.httpStatus, 100, 599)
      ? { httpStatus: metadata.httpStatus }
      : {}),
    ...(metadata.finishReason && animationFinishReasons.includes(metadata.finishReason)
      ? { finishReason: metadata.finishReason }
      : {}),
    ...(integer(metadata.responseLength, 0)
      ? { responseLength: metadata.responseLength }
      : {}),
    ...(integer(metadata.promptTokens, 0)
      ? { promptTokens: metadata.promptTokens }
      : {}),
    ...(integer(metadata.completionTokens, 0)
      ? { completionTokens: metadata.completionTokens }
      : {}),
    ...(integer(metadata.totalTokens, 0)
      ? { totalTokens: metadata.totalTokens }
      : {}),
    ...(integer(metadata.durationMs, 0) ? { durationMs: metadata.durationMs } : {}),
    ...(integer(metadata.retryCount, 0) ? { retryCount: metadata.retryCount } : {}),
  };
}

function safe(value: string | undefined): value is string {
  return typeof value === "string" && SAFE_VALUE.test(value);
}

function optionalSafe(value: string | undefined) {
  return value === undefined || safe(value);
}

function integer(value: number | undefined, minimum: number, maximum = Number.MAX_SAFE_INTEGER) {
  return Number.isSafeInteger(value) && (value as number) >= minimum &&
    (value as number) <= maximum;
}

function optionalInteger(value: number | undefined, minimum: number, maximum = Number.MAX_SAFE_INTEGER) {
  return value === undefined || integer(value, minimum, maximum);
}
