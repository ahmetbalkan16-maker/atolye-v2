import type { AIResponseSchemaEvidence } from "./aiResponse";
import type { AnimationMotionPlanErrorEvidence } from "./animationError";
import type { AudioAssetErrorEvidence } from "./audioError";

export type PipelineErrorEvidence =
  | AIResponseSchemaEvidence
  | AnimationMotionPlanErrorEvidence
  | AudioAssetErrorEvidence;
