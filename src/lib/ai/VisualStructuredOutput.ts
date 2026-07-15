import type { SceneData } from "@/types/scene";
import type { ThumbnailConcept, VisualData, VisualScene } from "@/types/visual";
import type { AIResponseObservedType, AIResponseSchemaEvidence, AIResponseSchemaIssue } from "@/types/aiResponse";
import { AIResponseError } from "./AIResponseError";
import { createCanonicalApplicationTimestamp } from "./CanonicalTimestamp";

export const visualSchemaIssueLimit = 8;

const topLevelFields = ["scenes", "thumbnail"] as const;
const visualFields = ["sceneId", "visualPrompt", "animationPrompt", "style"] as const;
const thumbnailFields = ["title", "prompt", "composition", "mood"] as const;
const visualStringFields = Object.freeze({
  visualPrompt: { minimumLength: 1, maximumLength: 2_000 },
  animationPrompt: { minimumLength: 1, maximumLength: 2_000 },
  style: { minimumLength: 1, maximumLength: 100, format: "plain-style-label" },
} as const);
const thumbnailStringFields = Object.freeze({
  title: { minimumLength: 1, maximumLength: 300 },
  prompt: { minimumLength: 1, maximumLength: 2_000 },
  composition: { minimumLength: 1, maximumLength: 1_000 },
  mood: { minimumLength: 1, maximumLength: 300 },
} as const);

export const canonicalVisualProviderSchema = Object.freeze({
  additionalProperties: false,
  applicationOwnedFields: ["createdAt", "projectId", "prompts", "generatedAt"] as const,
  topLevelFields,
  visualFields,
  thumbnailFields,
  sceneCount: { minimum: 1, maximum: 30, exact: "canonical scene count" },
  visualStringFields,
  thumbnailStringFields,
});

export type CanonicalVisualPlan = Pick<VisualData, "scenes" | "thumbnail" | "createdAt">;

export function createVisualPlanPrompt(
  scenes: SceneData,
  style = "cinematic",
): string {
  return [
    "You are a professional visual director for historical documentary production.",
    "Create the complete canonical text plan that will be sent to the production image provider.",
    "Return exactly one JSON object and nothing else: no markdown, code fence, comments, or trailing text.",
    "Use exactly these top-level keys: scenes, thumbnail. Additional top-level or nested keys are forbidden.",
    "Do not include createdAt, projectId, prompts, or generatedAt; the application owns those fields.",
    "Each scenes item must use exactly: sceneId, visualPrompt, animationPrompt, style.",
    "thumbnail must use exactly: title, prompt, composition, mood.",
    "Return exactly one visual item for every canonical scene, in canonical scene array order.",
    "sceneId must be the matching positive canonical scene id. Duplicate, missing, unknown, or reordered ids are forbidden.",
    "All strings are required and non-empty.",
    "Limits: visualPrompt 1-2000, animationPrompt 1-2000, style 1-100 characters.",
    "Thumbnail limits: title 1-300, prompt 1-2000, composition 1-1000, mood 1-300 characters.",
    "style must be a plain style label containing only letters, numbers, spaces, underscore, or hyphen.",
    "Do not produce paths, URLs, filenames, storage locators, physical asset ids, metadata, or unknown fields.",
    "Visual prompts must be realistic, historically grounded, detailed, and suitable for image generation.",
    "Animation prompts describe camera motion, atmosphere, particles, and documentary movement.",
    "Do not include text, logos, watermarks, or modern objects unless the canonical scene requires them.",
    `Preferred style: ${style}`,
    "Canonical JSON skeleton:",
    "{",
    '  "scenes": [',
    "    {",
    '      "sceneId": 1,',
    '      "visualPrompt": "string",',
    '      "animationPrompt": "string",',
    '      "style": "cinematic"',
    "    }",
    "  ],",
    '  "thumbnail": {',
    '    "title": "string",',
    '    "prompt": "string",',
    '    "composition": "string",',
    '    "mood": "string"',
    "  }",
    "}",
    "Canonical SceneData JSON:",
    JSON.stringify({ scenes: scenes.scenes }),
  ].join("\n");
}

export function parseStrictVisualPlanResponse(
  response: string,
  source: SceneData,
  now: () => string = () => new Date().toISOString(),
): CanonicalVisualPlan {
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.trim()) as unknown;
  } catch {
    throw new AIResponseError("AI_RESPONSE_INVALID_JSON");
  }
  const evidence = validateProviderVisualPlan(parsed, source);
  if (evidence) throw new AIResponseError("AI_RESPONSE_SCHEMA_INVALID", evidence);
  return {
    ...(parsed as { scenes: VisualScene[]; thumbnail: ThumbnailConcept }),
    createdAt: createCanonicalApplicationTimestamp(now),
  };
}

export function validateProviderVisualPlan(
  value: unknown,
  source: SceneData,
): AIResponseSchemaEvidence | undefined {
  const issues: AIResponseSchemaIssue[] = [];
  const add = (issue: AIResponseSchemaIssue) => { if (issues.length < visualSchemaIssueLimit) issues.push(issue); };
  if (!isRecord(value)) {
    add({ path: "$", reason: "WRONG_TYPE", expected: "object", observedType: observedType(value) });
    return { code: "AI_RESPONSE_SCHEMA_INVALID", issues };
  }
  exactFields(value, topLevelFields, "$", add);
  validateVisualScenes(value.scenes, source, add);
  validateThumbnail(value.thumbnail, add);
  return issues.length ? { code: "AI_RESPONSE_SCHEMA_INVALID", issues } : undefined;
}

function validateVisualScenes(value: unknown, source: SceneData, add: (issue: AIResponseSchemaIssue) => void) {
  if (!Array.isArray(value)) {
    if (value !== undefined) add({ path: "$.scenes", reason: "WRONG_TYPE", expected: "array", observedType: observedType(value) });
    return;
  }
  if (value.length < 1) add({ path: "$.scenes", reason: "MIN_ITEMS", expected: ">=1" });
  if (value.length > 30) add({ path: "$.scenes", reason: "MAX_ITEMS", expected: "<=30" });
  if (value.length !== source.scenes.length) add({ path: "$.scenes", reason: "INVALID_REFERENCE", expected: `exactly ${source.scenes.length} canonical scene plans` });
  const sourceIds = new Set(source.scenes.map((scene) => scene.id));
  const ids = new Set<number>();
  value.forEach((visual, index) => {
    const path = `$.scenes[${index}]`;
    if (!isRecord(visual)) {
      add({ path, reason: "WRONG_TYPE", expected: "object", observedType: observedType(visual) });
      return;
    }
    exactFields(visual, visualFields, path, add);
    const sceneId = visual.sceneId;
    if (sceneId !== undefined && (typeof sceneId !== "number" || !Number.isSafeInteger(sceneId) || sceneId < 1)) {
      add({ path: `${path}.sceneId`, reason: "INVALID_ID", expected: "positive integer", observedType: observedType(sceneId) });
    } else if (typeof sceneId === "number") {
      if (ids.has(sceneId)) add({ path: `${path}.sceneId`, reason: "DUPLICATE_ID", expected: "unique scene reference", observedType: "number" });
      ids.add(sceneId);
      if (!sourceIds.has(sceneId)) add({ path: `${path}.sceneId`, reason: "INVALID_REFERENCE", expected: "canonical scene id", observedType: "number" });
      if (sceneId !== source.scenes[index]?.id) add({ path: `${path}.sceneId`, reason: "INVALID_ORDER", expected: `canonical scene id ${source.scenes[index]?.id ?? "at index"}`, observedType: "number" });
    }
    for (const [field, spec] of Object.entries(visualStringFields)) validateString(visual[field], `${path}.${field}`, spec, add);
  });
  for (const scene of source.scenes) if (!ids.has(scene.id)) add({ path: "$.scenes", reason: "INVALID_REFERENCE", expected: `scene ${scene.id} plan coverage` });
}

function validateThumbnail(value: unknown, add: (issue: AIResponseSchemaIssue) => void) {
  if (!isRecord(value)) {
    if (value !== undefined) add({ path: "$.thumbnail", reason: "WRONG_TYPE", expected: "object", observedType: observedType(value) });
    return;
  }
  exactFields(value, thumbnailFields, "$.thumbnail", add);
  for (const [field, spec] of Object.entries(thumbnailStringFields)) validateString(value[field], `$.thumbnail.${field}`, spec, add);
}

function exactFields(value: Record<string, unknown>, expected: readonly string[], path: string, add: (issue: AIResponseSchemaIssue) => void) {
  for (const field of expected) if (!Object.prototype.hasOwnProperty.call(value, field)) add({ path: `${path}.${field}`, reason: "MISSING_REQUIRED_FIELD", observedType: "missing" });
  for (const field of Object.keys(value)) if (!expected.includes(field)) add({ path: `${path}.${field}`, reason: "UNKNOWN_FIELD" });
}

function validateString(value: unknown, path: string, spec: { minimumLength: number; maximumLength: number; format?: string }, add: (issue: AIResponseSchemaIssue) => void) {
  if (value === undefined) return;
  if (typeof value !== "string") {
    add({ path, reason: "WRONG_TYPE", expected: "string", observedType: observedType(value) });
    return;
  }
  if (value.length < spec.minimumLength) add({ path, reason: "MIN_LENGTH", expected: `>=${spec.minimumLength}` });
  if (value.length > spec.maximumLength) add({ path, reason: "MAX_LENGTH", expected: `<=${spec.maximumLength}` });
  if (spec.format === "plain-style-label" && value.length > 0 && !/^[\p{L}\p{N}][\p{L}\p{N} _-]*$/u.test(value)) {
    add({ path, reason: "INVALID_FORMAT", expected: "plain style label", observedType: "string" });
  }
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
