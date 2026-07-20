import {
  getAIResponseSchemaEvidence,
  isAIResponseSchemaEvidence,
} from "@/lib/ai/AIResponseError";
import {
  getAnimationMotionPlanErrorEvidence,
  isAnimationMotionPlanErrorEvidence,
} from "@/lib/animation/AnimationMotionPlanError";
import {
  getAudioAssetErrorEvidence,
  isAudioAssetErrorEvidence,
} from "@/lib/audio/AudioAssetError";
import type { PipelineErrorEvidence } from "@/types/errorEvidence";

export function getPipelineErrorEvidence(
  value: unknown,
): PipelineErrorEvidence | undefined {
  return getAIResponseSchemaEvidence(value) ??
    getAnimationMotionPlanErrorEvidence(value) ??
    getAudioAssetErrorEvidence(value);
}

export function isPipelineErrorEvidence(
  value: unknown,
): value is PipelineErrorEvidence {
  return isAIResponseSchemaEvidence(value) ||
    isAnimationMotionPlanErrorEvidence(value) ||
    isAudioAssetErrorEvidence(value);
}
