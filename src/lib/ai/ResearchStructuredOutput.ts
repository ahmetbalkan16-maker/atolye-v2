import type { ResearchData } from "@/types/research";
import type {
  AIResponseObservedType,
  AIResponseSchemaEvidence,
  AIResponseSchemaIssue,
} from "@/types/aiResponse";
import { AIResponseError } from "./AIResponseError";
import { createCanonicalApplicationTimestamp, isCanonicalTimestamp } from "./CanonicalTimestamp";

export const researchSchemaIssueLimit = 8;

const stringFieldSchema = Object.freeze({
  topic: { minimumLength: 1, maximumLength: 300 },
  summary: { minimumLength: 1, maximumLength: 4_000 },
  historicalContext: { minimumLength: 1, maximumLength: 4_000 },
} as const);

const arrayFieldSchema = Object.freeze({
  timeline: { minimumItems: 1, maximumItems: 20, itemMaximumLength: 1_200 },
  characters: { minimumItems: 0, maximumItems: 20, itemMaximumLength: 300 },
  locations: { minimumItems: 0, maximumItems: 20, itemMaximumLength: 300 },
  keyEvents: { minimumItems: 1, maximumItems: 20, itemMaximumLength: 1_200 },
  strategies: { minimumItems: 0, maximumItems: 20, itemMaximumLength: 1_200 },
  controversies: { minimumItems: 0, maximumItems: 12, itemMaximumLength: 1_200 },
  interestingFacts: { minimumItems: 0, maximumItems: 20, itemMaximumLength: 1_200 },
  documentaryFlow: { minimumItems: 1, maximumItems: 20, itemMaximumLength: 1_200 },
  sceneIdeas: { minimumItems: 1, maximumItems: 20, itemMaximumLength: 1_200 },
  imagePrompts: { minimumItems: 1, maximumItems: 20, itemMaximumLength: 1_500 },
  animationPrompts: { minimumItems: 0, maximumItems: 20, itemMaximumLength: 1_500 },
  musicIdeas: { minimumItems: 0, maximumItems: 12, itemMaximumLength: 600 },
  soundEffects: { minimumItems: 0, maximumItems: 20, itemMaximumLength: 600 },
  thumbnailIdeas: { minimumItems: 0, maximumItems: 12, itemMaximumLength: 1_200 },
  youtubeTitles: { minimumItems: 0, maximumItems: 12, itemMaximumLength: 300 },
  sources: { minimumItems: 1, maximumItems: 20, itemMaximumLength: 2_048, format: "absolute-http-url" },
} as const);

const stringFields = Object.keys(stringFieldSchema) as Array<keyof typeof stringFieldSchema>;
const arrayFields = Object.keys(arrayFieldSchema) as Array<keyof typeof arrayFieldSchema>;
const providerFields = [...stringFields, ...arrayFields] as const;

export const canonicalResearchProviderSchema = Object.freeze({
  additionalProperties: false,
  applicationOwnedFields: ["createdAt"] as const,
  stringFields: stringFieldSchema,
  arrayFields: arrayFieldSchema,
});

export function createResearchPrompt(topic: string): string {
  return [
    "You are a documentary research assistant.",
    "Create evidence-grounded structured research for the topic below.",
    "Return exactly one JSON object and nothing else: no markdown, code fence, comments, or trailing text.",
    `Use exactly these top-level keys: ${providerFields.join(", ")}.`,
    "Every listed key is required. Additional top-level or nested keys are forbidden.",
    "Do not include createdAt; the application adds it after validation as a canonical UTC RFC 3339 / ISO 8601 timestamp",
    "with full date and time, millisecond precision, and Z suffix, for example 2026-07-15T12:00:00.000Z.",
    "All scalar fields must be non-empty strings.",
    "All array items must be non-empty strings; objects and nested arrays are forbidden.",
    "Required non-empty arrays: timeline, keyEvents, documentaryFlow, sceneIdeas, imagePrompts, sources.",
    "Other arrays may be [] when reliable information is unavailable; do not invent information.",
    "sources items must be absolute http:// or https:// URLs without credentials.",
    "Limits:",
    ...stringFields.map((field) => {
      const spec = stringFieldSchema[field];
      return `- ${field}: ${spec.minimumLength}-${spec.maximumLength} characters.`;
    }),
    ...arrayFields.map((field) => {
      const spec = arrayFieldSchema[field];
      return `- ${field}: ${spec.minimumItems}-${spec.maximumItems} items; each item 1-${spec.itemMaximumLength} characters.`;
    }),
    "Canonical JSON skeleton:",
    "{",
    '  "topic": "string",',
    '  "summary": "string",',
    '  "historicalContext": "string",',
    '  "timeline": ["string"],',
    '  "characters": ["string"],',
    '  "locations": ["string"],',
    '  "keyEvents": ["string"],',
    '  "strategies": ["string"],',
    '  "controversies": ["string"],',
    '  "interestingFacts": ["string"],',
    '  "documentaryFlow": ["string"],',
    '  "sceneIdeas": ["string"],',
    '  "imagePrompts": ["string"],',
    '  "animationPrompts": ["string"],',
    '  "musicIdeas": ["string"],',
    '  "soundEffects": ["string"],',
    '  "thumbnailIdeas": ["string"],',
    '  "youtubeTitles": ["string"],',
    '  "sources": ["https://example.invalid/source"]',
    "}",
    `Topic: ${topic}`,
  ].join("\n");
}

export function parseStrictResearchResponse(
  response: string,
  now: () => string = () => new Date().toISOString(),
): ResearchData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.trim()) as unknown;
  } catch {
    throw new AIResponseError("AI_RESPONSE_INVALID_JSON");
  }
  const evidence = validateProviderResearch(parsed);
  if (evidence) {
    throw new AIResponseError("AI_RESPONSE_SCHEMA_INVALID", evidence);
  }
  const createdAt = createCanonicalApplicationTimestamp(now);
  return { ...(parsed as Omit<ResearchData, "createdAt">), createdAt };
}

export const isCanonicalResearchTimestamp = isCanonicalTimestamp;

export function validateProviderResearch(
  value: unknown,
): AIResponseSchemaEvidence | undefined {
  const issues: AIResponseSchemaIssue[] = [];
  const add = (issue: AIResponseSchemaIssue) => {
    if (issues.length < researchSchemaIssueLimit) issues.push(issue);
  };
  if (!isRecord(value)) {
    add({ path: "$", reason: "WRONG_TYPE", expected: "object", observedType: observedType(value) });
    return { code: "AI_RESPONSE_SCHEMA_INVALID", issues };
  }
  for (const field of providerFields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      add({ path: `$.${field}`, reason: "MISSING_REQUIRED_FIELD", expected: field in stringFieldSchema ? "string" : "array", observedType: "missing" });
    }
  }
  for (const field of Object.keys(value)) {
    if (!providerFields.includes(field as typeof providerFields[number])) {
      add({ path: `$.${field}`, reason: "UNKNOWN_FIELD" });
    }
  }
  for (const field of stringFields) validateString(value[field], `$.${field}`, stringFieldSchema[field], add);
  for (const field of arrayFields) validateArray(value[field], `$.${field}`, arrayFieldSchema[field], add);
  return issues.length ? { code: "AI_RESPONSE_SCHEMA_INVALID", issues } : undefined;
}

function validateString(
  value: unknown,
  path: string,
  spec: { minimumLength: number; maximumLength: number },
  add: (issue: AIResponseSchemaIssue) => void,
) {
  if (value === undefined) return;
  if (typeof value !== "string") {
    add({ path, reason: "WRONG_TYPE", expected: "string", observedType: observedType(value) });
    return;
  }
  if (value.length < spec.minimumLength) add({ path, reason: "MIN_LENGTH", expected: `>=${spec.minimumLength}` });
  if (value.length > spec.maximumLength) add({ path, reason: "MAX_LENGTH", expected: `<=${spec.maximumLength}` });
}

function validateArray(
  value: unknown,
  path: string,
  spec: { minimumItems: number; maximumItems: number; itemMaximumLength: number; format?: string },
  add: (issue: AIResponseSchemaIssue) => void,
) {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    add({ path, reason: "WRONG_TYPE", expected: "array", observedType: observedType(value) });
    return;
  }
  if (value.length < spec.minimumItems) add({ path, reason: "MIN_ITEMS", expected: `>=${spec.minimumItems}` });
  if (value.length > spec.maximumItems) add({ path, reason: "MAX_ITEMS", expected: `<=${spec.maximumItems}` });
  value.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    if (typeof item !== "string") {
      add({ path: itemPath, reason: "WRONG_TYPE", expected: "string", observedType: observedType(item) });
      return;
    }
    if (item.length < 1) add({ path: itemPath, reason: "MIN_LENGTH", expected: ">=1" });
    if (item.length > spec.itemMaximumLength) add({ path: itemPath, reason: "MAX_LENGTH", expected: `<=${spec.itemMaximumLength}` });
    if (spec.format === "absolute-http-url" && !isSafeAbsoluteHttpUrl(item)) {
      add({ path: itemPath, reason: "INVALID_URL", expected: "absolute http(s) URL" });
    }
  });
}

function isSafeAbsoluteHttpUrl(value: string) {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      !parsed.username && !parsed.password && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function observedType(value: unknown): AIResponseObservedType {
  if (value === undefined) return "missing";
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return "object";
}
