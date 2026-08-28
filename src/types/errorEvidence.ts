import type { AIResponseSchemaEvidence } from "./aiResponse";
import type { AnimationMotionPlanErrorEvidence } from "./animationError";
import type { AudioAssetErrorEvidence } from "./audioError";
import type { ThumbnailAssetErrorEvidence } from "./thumbnailError";

export type PipelineErrorEvidence =
  | AIResponseSchemaEvidence
  | AnimationMotionPlanErrorEvidence
  | AudioAssetErrorEvidence
  | ThumbnailAssetErrorEvidence;
