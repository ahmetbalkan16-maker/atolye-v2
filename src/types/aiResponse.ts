export const aiResponseSchemaIssueReasons = [
  "MISSING_REQUIRED_FIELD",
  "UNKNOWN_FIELD",
  "WRONG_TYPE",
  "MIN_ITEMS",
  "MAX_ITEMS",
  "MIN_LENGTH",
  "MAX_LENGTH",
  "INVALID_URL",
  "INVALID_ID",
  "DUPLICATE_ID",
  "INVALID_REFERENCE",
  "INVALID_DURATION",
  "INVALID_ORDER",
  "INVALID_FORMAT",
] as const;

export type AIResponseSchemaIssueReason =
  typeof aiResponseSchemaIssueReasons[number];

export type AIResponseObservedType =
  | "array"
  | "boolean"
  | "missing"
  | "null"
  | "number"
  | "object"
  | "string";

export interface AIResponseSchemaIssue {
  path: string;
  reason: AIResponseSchemaIssueReason;
  expected?: string;
  observedType?: AIResponseObservedType;
}

export interface AIResponseSchemaEvidence {
  code: "AI_RESPONSE_SCHEMA_INVALID";
  issues: AIResponseSchemaIssue[];
}
