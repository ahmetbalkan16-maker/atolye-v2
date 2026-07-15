import type { ScriptData } from "@/types/script";
import type {
  AIResponseObservedType,
  AIResponseSchemaEvidence,
  AIResponseSchemaIssue,
} from "@/types/aiResponse";
import { AIResponseError } from "./AIResponseError";
import { createCanonicalApplicationTimestamp } from "./CanonicalTimestamp";

const issueLimit = 8;
const topLevelFields = [
  "topic", "title", "subtitle", "hook", "introduction", "chapters",
  "conclusion", "callToAction", "estimatedDuration", "narrationWordCount",
  "targetAudience", "language", "voiceStyle", "musicStyle", "thumbnailIdea",
  "seoKeywords",
] as const;
const chapterFields = [
  "id", "title", "narration", "duration", "visualGoal", "emotion", "transition",
] as const;
const stringLimits: Readonly<Record<string, number>> = {
  topic: 300, title: 300, subtitle: 500, hook: 1_500, introduction: 2_500,
  conclusion: 2_000, callToAction: 1_000, targetAudience: 300, language: 10,
  voiceStyle: 300, musicStyle: 300, thumbnailIdea: 1_200,
};
const chapterStringLimits: Readonly<Record<string, number>> = {
  title: 300, narration: 1_200, visualGoal: 1_200, emotion: 300, transition: 500,
};

export const canonicalScriptProviderSchema = Object.freeze({
  additionalProperties: false,
  applicationOwnedFields: ["createdAt"] as const,
  chapterCount: { minimum: 4, maximum: 7 },
  seoKeywordCount: { minimum: 1, maximum: 20 },
  stringLimits,
  chapterStringLimits,
});

export function parseStrictScriptResponse(
  response: string,
  now: () => string = () => new Date().toISOString(),
): ScriptData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.trim()) as unknown;
  } catch {
    throw new AIResponseError("AI_RESPONSE_INVALID_JSON");
  }
  const evidence = validateProviderScript(parsed);
  if (evidence) throw new AIResponseError("AI_RESPONSE_SCHEMA_INVALID", evidence);
  const createdAt = createCanonicalApplicationTimestamp(now);
  return { ...(parsed as Omit<ScriptData, "createdAt">), createdAt };
}

export function validateProviderScript(value: unknown): AIResponseSchemaEvidence | undefined {
  const issues: AIResponseSchemaIssue[] = [];
  const add = (issue: AIResponseSchemaIssue) => {
    if (issues.length < issueLimit) issues.push(issue);
  };
  if (!isRecord(value)) {
    add({ path: "$", reason: "WRONG_TYPE", expected: "object", observedType: observedType(value) });
    return { code: "AI_RESPONSE_SCHEMA_INVALID", issues };
  }
  exactFields(value, topLevelFields, "$", add);
  for (const [field, maximumLength] of Object.entries(stringLimits)) {
    validateString(value[field], `$.${field}`, maximumLength, add);
  }
  validatePositiveInteger(value.estimatedDuration, "$.estimatedDuration", add);
  validatePositiveInteger(value.narrationWordCount, "$.narrationWordCount", add);
  validateKeywords(value.seoKeywords, add);
  validateChapters(value.chapters, add);
  return issues.length ? { code: "AI_RESPONSE_SCHEMA_INVALID", issues } : undefined;
}

function validateChapters(value: unknown, add: (issue: AIResponseSchemaIssue) => void) {
  if (!Array.isArray(value)) {
    add({ path: "$.chapters", reason: "WRONG_TYPE", expected: "array", observedType: observedType(value) });
    return;
  }
  if (value.length < 4) add({ path: "$.chapters", reason: "MIN_ITEMS", expected: ">=4" });
  if (value.length > 7) add({ path: "$.chapters", reason: "MAX_ITEMS", expected: "<=7" });
  const ids = new Set<number>();
  value.forEach((chapter, index) => {
    const path = `$.chapters[${index}]`;
    if (!isRecord(chapter)) {
      add({ path, reason: "WRONG_TYPE", expected: "object", observedType: observedType(chapter) });
      return;
    }
    exactFields(chapter, chapterFields, path, add);
    validatePositiveInteger(chapter.id, `${path}.id`, add);
    if (typeof chapter.id === "number" && ids.has(chapter.id)) {
      add({ path: `${path}.id`, reason: "WRONG_TYPE", expected: "unique chapter id", observedType: "number" });
    }
    if (typeof chapter.id === "number") ids.add(chapter.id);
    for (const [field, maximumLength] of Object.entries(chapterStringLimits)) {
      validateString(chapter[field], `${path}.${field}`, maximumLength, add);
    }
    validatePositiveInteger(chapter.duration, `${path}.duration`, add);
  });
}

function validateKeywords(value: unknown, add: (issue: AIResponseSchemaIssue) => void) {
  if (!Array.isArray(value)) {
    add({ path: "$.seoKeywords", reason: "WRONG_TYPE", expected: "array", observedType: observedType(value) });
    return;
  }
  if (value.length < 1) add({ path: "$.seoKeywords", reason: "MIN_ITEMS", expected: ">=1" });
  if (value.length > 20) add({ path: "$.seoKeywords", reason: "MAX_ITEMS", expected: "<=20" });
  value.forEach((item, index) => validateString(item, `$.seoKeywords[${index}]`, 100, add));
}

function exactFields(value: Record<string, unknown>, expected: readonly string[], path: string, add: (issue: AIResponseSchemaIssue) => void) {
  for (const field of expected) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      add({ path: `${path}.${field}`, reason: "MISSING_REQUIRED_FIELD", observedType: "missing" });
    }
  }
  for (const field of Object.keys(value)) {
    if (!expected.includes(field)) add({ path: `${path}.${field}`, reason: "UNKNOWN_FIELD" });
  }
}

function validateString(value: unknown, path: string, maximumLength: number, add: (issue: AIResponseSchemaIssue) => void) {
  if (value === undefined) return;
  if (typeof value !== "string") {
    add({ path, reason: "WRONG_TYPE", expected: "string", observedType: observedType(value) });
    return;
  }
  if (value.length < 1) add({ path, reason: "MIN_LENGTH", expected: ">=1" });
  if (value.length > maximumLength) add({ path, reason: "MAX_LENGTH", expected: `<=${maximumLength}` });
}

function validatePositiveInteger(value: unknown, path: string, add: (issue: AIResponseSchemaIssue) => void) {
  if (value === undefined) return;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    add({ path, reason: "WRONG_TYPE", expected: "integer", observedType: observedType(value) });
  } else if (value < 1) add({ path, reason: "WRONG_TYPE", expected: "positive integer", observedType: "number" });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function observedType(value: unknown): AIResponseObservedType {
  if (value === undefined) return "missing";
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (["string", "number", "boolean"].includes(typeof value)) return typeof value as AIResponseObservedType;
  return "object";
}
