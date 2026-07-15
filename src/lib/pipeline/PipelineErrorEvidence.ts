import {
  getAIResponseSchemaEvidence,
  isAIResponseSchemaEvidence,
} from "@/lib/ai/AIResponseError";
import {
  getAnimationMotionPlanErrorEvidence,
  isAnimationMotionPlanErrorEvidence,
} from "@/lib/animation/AnimationMotionPlanError";
import type { PipelineErrorEvidence } from "@/types/errorEvidence";

export function getPipelineErrorEvidence(
  value: unknown,
): PipelineErrorEvidence | undefined {
  return getAIResponseSchemaEvidence(value) ??
    getAnimationMotionPlanErrorEvidence(value);
}

export function isPipelineErrorEvidence(
  value: unknown,
): value is PipelineErrorEvidence {
  return isAIResponseSchemaEvidence(value) ||
    isAnimationMotionPlanErrorEvidence(value);
}
