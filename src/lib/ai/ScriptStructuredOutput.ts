import type { ScriptData } from "@/types/script";
import type {
  AIResponseObservedType,
  AIResponseSchemaEvidence,
  AIResponseSchemaIssue,
} from "@/types/aiResponse";
import { AIResponseError } from "./AIResponseError";
import { createCanonicalApplicationTimestamp } from "./CanonicalTimestamp";
import { DEFAULT_CHARACTERS_PER_SECOND } from "./NarrationDurationEstimator";
import {
  isExplicitQualityPreset,
  resolveScriptChapterCount,
} from "@/lib/production/QualityPreset";
import { resolveProductionAcceptanceDuration } from "@/lib/production/ProductionAcceptancePreflight";

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
  // Default (no explicit ATOLYE_QUALITY_PRESET) contract. An explicit preset
  // scales the chapter count and the per-chapter narration ceiling — the strict
  // validator reads those from `resolveScriptContentBudget(env)` so the schema
  // it enforces always matches the chapter count the strict prompt
  // (`AIManager.strictScriptDurationPromptLines`) asks the model for.
  chapterCount: { minimum: 4, maximum: 7 },
  seoKeywordCount: { minimum: 1, maximum: 20 },
  stringLimits,
  chapterStringLimits,
});

/**
 * The strict-script content budget for the active quality preset. Single source
 * of truth shared by the strict script PROMPT
 * (`AIManager.strictScriptDurationPromptLines`) and the strict script SCHEMA
 * VALIDATOR (`validateProviderScript` below), so the two can never drift — the
 * exact drift that let the preset-parametric prompt (Sprint 173 P2) ask for 9
 * chapters while this validator still hard-capped at 7 (the Sprint 178 probe
 * `AI_RESPONSE_SCHEMA_INVALID`).
 *
 * With NO explicit `ATOLYE_QUALITY_PRESET` the values are the frozen legacy
 * constants (5-chapter ~90 s prompt / {4,7}-chapter, 1200-char validator),
 * byte-identical to the pre-P2 behaviour.
 */
export interface ScriptContentBudget {
  /** Chapters the strict prompt asks the model to create. */
  readonly chapterCount: number;
  /** Prompt per-chapter narration character bounds. */
  readonly perChapterMinChars: number;
  readonly perChapterMaxChars: number;
  /** Prompt total-narration character bounds. */
  readonly totalLowChars: number;
  readonly totalHighChars: number;
  /** Validator chapter-count bounds (a small tolerance around `chapterCount`). */
  readonly schemaChapterMin: number;
  readonly schemaChapterMax: number;
  /** Validator per-chapter narration hard ceiling. */
  readonly schemaNarrationMaxLength: number;
}

/**
 * Hand-tuned legacy contract (the pre-P2 "short ~90 s documentary"). The prompt
 * bounds are deliberately tighter than a pure char-rate computation — kept as
 * literals so the un-configured pipeline is byte-identical.
 */
const LEGACY_SCRIPT_CONTENT_BUDGET: ScriptContentBudget = Object.freeze({
  chapterCount: 5,
  perChapterMinChars: 260,
  perChapterMaxChars: 340,
  totalLowChars: 1_300,
  totalHighChars: 1_450,
  schemaChapterMin: 4,
  schemaChapterMax: 7,
  schemaNarrationMaxLength: 1_200,
});

export function resolveScriptContentBudget(
  env: NodeJS.ProcessEnv = process.env,
): ScriptContentBudget {
  if (!isExplicitQualityPreset(env)) return LEGACY_SCRIPT_CONTENT_BUDGET;
  const cps = DEFAULT_CHARACTERS_PER_SECOND;
  const band = resolveProductionAcceptanceDuration(env);
  const chapterCount = resolveScriptChapterCount(env);
  const perChapterChars = Math.round((band.targetSeconds / chapterCount) * cps);
  const perChapterMaxChars = Math.round(perChapterChars * 1.2);
  return Object.freeze({
    chapterCount,
    perChapterMinChars: Math.round(perChapterChars * 0.82),
    perChapterMaxChars,
    totalLowChars: Math.round(band.minimumSeconds * cps),
    totalHighChars: Math.round(band.maximumSeconds * cps),
    // Mirror the legacy relation (asked 5, allowed 4..7 = [-1, +2]) so a model
    // that lands a chapter or two off the requested count still validates; the
    // finished-length gate is validateProductionAcceptanceScriptDuration.
    schemaChapterMin: Math.max(4, chapterCount - 1),
    schemaChapterMax: chapterCount + 2,
    // Per-chapter narration hard ceiling: 35 % over the prompt's own per-chapter
    // maximum, never below the legacy 1200. Rejects pathological over-generation
    // without contradicting the prompt the model was given.
    schemaNarrationMaxLength: Math.max(1_200, Math.round(perChapterMaxChars * 1.35)),
  });
}

/**
 * The canonical strict-script schema for the active quality preset. With no
 * EXPLICIT `ATOLYE_QUALITY_PRESET` this is deep-equal to
 * {@link canonicalScriptProviderSchema}; an explicit preset scales
 * `chapterCount` and the per-chapter `narration` ceiling from
 * {@link resolveScriptContentBudget}. Mirrors
 * `SceneStructuredOutput.resolveCanonicalSceneProviderSchema`.
 */
export function resolveCanonicalScriptProviderSchema(
  env: NodeJS.ProcessEnv = process.env,
) {
  const budget = resolveScriptContentBudget(env);
  return Object.freeze({
    additionalProperties: false,
    applicationOwnedFields: ["createdAt"] as const,
    chapterCount: { minimum: budget.schemaChapterMin, maximum: budget.schemaChapterMax },
    seoKeywordCount: { minimum: 1, maximum: 20 },
    stringLimits,
    chapterStringLimits: {
      ...chapterStringLimits,
      narration: budget.schemaNarrationMaxLength,
    },
  });
}

export function parseStrictScriptResponse(
  response: string,
  now: () => string = () => new Date().toISOString(),
  env: NodeJS.ProcessEnv = process.env,
): ScriptData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.trim()) as unknown;
  } catch {
    throw new AIResponseError("AI_RESPONSE_INVALID_JSON");
  }
  const evidence = validateProviderScript(parsed, env);
  if (evidence) throw new AIResponseError("AI_RESPONSE_SCHEMA_INVALID", evidence);
  const createdAt = createCanonicalApplicationTimestamp(now);
  return { ...(parsed as Omit<ScriptData, "createdAt">), createdAt };
}

export function validateProviderScript(
  value: unknown,
  env: NodeJS.ProcessEnv = process.env,
): AIResponseSchemaEvidence | undefined {
  const budget = resolveScriptContentBudget(env);
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
  validateChapters(value.chapters, budget, add);
  return issues.length ? { code: "AI_RESPONSE_SCHEMA_INVALID", issues } : undefined;
}

function validateChapters(
  value: unknown,
  budget: ScriptContentBudget,
  add: (issue: AIResponseSchemaIssue) => void,
) {
  if (!Array.isArray(value)) {
    add({ path: "$.chapters", reason: "WRONG_TYPE", expected: "array", observedType: observedType(value) });
    return;
  }
  if (value.length < budget.schemaChapterMin) {
    add({ path: "$.chapters", reason: "MIN_ITEMS", expected: `>=${budget.schemaChapterMin}` });
  }
  if (value.length > budget.schemaChapterMax) {
    add({ path: "$.chapters", reason: "MAX_ITEMS", expected: `<=${budget.schemaChapterMax}` });
  }
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
      const cap = field === "narration" ? budget.schemaNarrationMaxLength : maximumLength;
      validateString(chapter[field], `${path}.${field}`, cap, add);
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
