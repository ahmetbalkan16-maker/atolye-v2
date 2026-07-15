import {
  aiResponseSchemaIssueReasons,
  type AIResponseObservedType,
  type AIResponseSchemaEvidence,
} from "@/types/aiResponse";

export type AIResponseErrorCode =
  | "AI_PROVIDER_REQUEST_FAILED"
  | "AI_PROVIDER_REFUSAL"
  | "AI_RESPONSE_TRUNCATED"
  | "AI_RESPONSE_INCOMPLETE"
  | "AI_RESPONSE_INVALID_JSON"
  | "AI_RESPONSE_SCHEMA_INVALID"
  | "AI_USAGE_PERSISTENCE_FAILED";

export class AIResponseError extends Error {
  constructor(
    readonly code: AIResponseErrorCode,
    readonly evidence?: AIResponseSchemaEvidence,
  ) {
    super(code);
    this.name = "AIResponseError";
    this.stack = undefined;
  }
}

export function getAIResponseSchemaEvidence(
  value: unknown,
): AIResponseSchemaEvidence | undefined {
  if (!(value instanceof AIResponseError)) return undefined;
  return value.evidence;
}

export function isAIResponseSchemaEvidence(
  value: unknown,
): value is AIResponseSchemaEvidence {
  if (!value || typeof value !== "object") return false;
  const evidence = value as AIResponseSchemaEvidence;
  return evidence.code === "AI_RESPONSE_SCHEMA_INVALID" &&
    Array.isArray(evidence.issues) &&
    evidence.issues.length > 0 &&
    evidence.issues.length <= 8 &&
    evidence.issues.every((issue) =>
      Boolean(issue) &&
      typeof issue.path === "string" &&
      /^\$(?:\.[A-Za-z][A-Za-z0-9]*|\[[0-9]+\])*$/.test(issue.path) &&
      aiResponseSchemaIssueReasons.includes(issue.reason) &&
      (issue.expected === undefined ||
        (typeof issue.expected === "string" && issue.expected.length <= 80)) &&
      (issue.observedType === undefined || isObservedType(issue.observedType))
    );
}

export function serializeAIResponseSchemaIssues(value: unknown): string[] {
  if (!isAIResponseSchemaEvidence(value)) return [];
  return value.issues.map((issue) =>
    `schema-issue:${issue.path}:${issue.reason}`
  );
}

function isObservedType(value: unknown): value is AIResponseObservedType {
  return ["array", "boolean", "missing", "null", "number", "object", "string"].includes(
    value as AIResponseObservedType,
  );
}
