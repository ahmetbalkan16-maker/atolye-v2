export const animationMotionPlanErrorCodes = [
  "ANIMATION_MOTION_PLAN_FAILED",
  "ANIMATION_RESPONSE_EMPTY",
  "ANIMATION_RESPONSE_INVALID_JSON",
  "ANIMATION_RESPONSE_SCHEMA_INVALID",
  "ANIMATION_RESPONSE_TRUNCATED",
  "ANIMATION_RESPONSE_INCOMPLETE",
  "ANIMATION_PROVIDER_REFUSAL",
  "ANIMATION_PROVIDER_HTTP_FAILED",
  "ANIMATION_PROVIDER_TIMEOUT",
  "ANIMATION_PROVIDER_RETRY_EXHAUSTED",
  "ANIMATION_RESPONSE_TOO_LARGE",
] as const;

export type AnimationMotionPlanErrorCode =
  typeof animationMotionPlanErrorCodes[number];

export const animationFailurePhases = [
  "input-validation",
  "asset-preflight",
  "provider-request",
  "provider-response",
  "plan-validation",
  "persistence",
  "settlement",
  "unknown",
] as const;

export type AnimationFailurePhase = typeof animationFailurePhases[number];

export const animationFinishReasons = [
  "stop",
  "length",
  "content-filter",
  "tool-calls",
  "unknown",
] as const;

export type AnimationFinishReason = typeof animationFinishReasons[number];

export const animationSchemaIssueCodes = [
  "MISSING_REQUIRED_FIELD",
  "UNKNOWN_FIELD",
  "WRONG_TYPE",
  "INVALID_ENUM",
  "OUT_OF_RANGE",
  "NON_FINITE",
] as const;

export type AnimationSchemaIssueCode = typeof animationSchemaIssueCodes[number];

export const animationSchemaValueCategories = [
  "array", "boolean", "crop-bounds", "crop-size", "finite-number",
  "forbidden", "missing", "motion-type", "null", "number", "object",
  "scale", "string", "transition-type", "translation", "unknown",
  "normalized-number",
] as const;

export type AnimationSchemaValueCategory =
  typeof animationSchemaValueCategories[number];

export interface AnimationSchemaIssue {
  path: string;
  code: AnimationSchemaIssueCode;
  expected: AnimationSchemaValueCategory;
  received: AnimationSchemaValueCategory;
}

export interface AnimationProviderDiagnosticMetadata {
  sceneId: number;
  phase: AnimationFailurePhase;
  provider?: string;
  model?: string;
  reason?: string;
  httpStatus?: number;
  finishReason?: AnimationFinishReason;
  responseLength?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  durationMs?: number;
  retryCount?: number;
  issueCount?: number;
  schemaIssues?: readonly AnimationSchemaIssue[];
}

export interface AnimationMotionPlanErrorEvidence
  extends AnimationProviderDiagnosticMetadata {
  kind: "animation-motion-plan-error";
  code: AnimationMotionPlanErrorCode;
}
