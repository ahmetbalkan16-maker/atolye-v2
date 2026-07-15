import type { SceneData } from "@/types/scene";
import type { ScriptData } from "@/types/script";
import type {
  AIResponseObservedType,
  AIResponseSchemaEvidence,
  AIResponseSchemaIssue,
} from "@/types/aiResponse";
import { AIResponseError } from "./AIResponseError";
import { createCanonicalApplicationTimestamp } from "./CanonicalTimestamp";

export const sceneSchemaIssueLimit = 8;

const topLevelFields = ["scenes"] as const;
const sceneFields = [
  "id", "chapterId", "title", "description", "visualPrompt", "duration",
] as const;
const stringFields = Object.freeze({
  title: { minimumLength: 1, maximumLength: 300 },
  description: { minimumLength: 1, maximumLength: 2_000 },
  visualPrompt: { minimumLength: 1, maximumLength: 2_000 },
} as const);

export const canonicalSceneProviderSchema = Object.freeze({
  additionalProperties: false,
  applicationOwnedFields: ["createdAt"] as const,
  topLevelFields,
  sceneFields,
  sceneCount: { minimum: "script chapter count", maximum: 30 },
  stringFields,
  duration: { minimumExclusive: 0, maximumInclusive: 120 },
  totalDuration: { minimum: 60, maximum: 120, tolerance: 5 },
});

export function createScenesPrompt(script: ScriptData): string {
  return [
    "You are a professional documentary scene planner.",
    "Create production-ready scene data from the documentary script below.",
    "Return exactly one JSON object and nothing else: no markdown, code fence, comments, or trailing text.",
    "Use exactly one top-level key: scenes. Additional top-level or nested keys are forbidden.",
    "Do not include createdAt; the application adds it after provider validation.",
    "Each scene must use exactly these keys: id, chapterId, title, description, visualPrompt, duration.",
    "id and chapterId must be positive integers. Scene ids must be unique and sequential from 1 in array order.",
    "chapterId must reference an existing script chapter id. Keep scenes grouped in script chapter order.",
    "Create at least one scene for every script chapter; do not create ownerless or extra-chapter scenes.",
    "title, description, and visualPrompt must be non-empty strings.",
    "Limits: title 1-300 characters; description 1-2000; visualPrompt 1-2000.",
    "duration must be a finite positive number no greater than 120 seconds.",
    "Each chapter's scene duration sum must match its script chapter duration within 5 seconds.",
    "Total scene duration must be 60-120 seconds and match script estimatedDuration within 5 seconds.",
    "Create no more than 30 scenes. Do not invent fields for unknown information; use the required strings only.",
    "Write title and description in Turkish. Keep visualPrompt cinematic and historically grounded.",
    "Canonical JSON skeleton:",
    "{",
    '  "scenes": [',
    "    {",
    '      "id": 1,',
    '      "chapterId": 1,',
    '      "title": "string",',
    '      "description": "string",',
    '      "visualPrompt": "string",',
    '      "duration": 15',
    "    }",
    "  ]",
    "}",
    "Script JSON:",
    JSON.stringify({
      topic: script.topic,
      title: script.title,
      subtitle: script.subtitle,
      hook: script.hook,
      introduction: script.introduction,
      chapters: script.chapters,
      conclusion: script.conclusion,
      voiceStyle: script.voiceStyle,
      musicStyle: script.musicStyle,
      estimatedDuration: script.estimatedDuration,
    }),
  ].join("\n");
}

export function parseStrictScenesResponse(
  response: string,
  script: ScriptData,
  now: () => string = () => new Date().toISOString(),
): SceneData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.trim()) as unknown;
  } catch {
    throw new AIResponseError("AI_RESPONSE_INVALID_JSON");
  }
  const evidence = validateProviderScenes(parsed, script);
  if (evidence) throw new AIResponseError("AI_RESPONSE_SCHEMA_INVALID", evidence);
  const createdAt = createCanonicalApplicationTimestamp(now);
  return { ...(parsed as Omit<SceneData, "createdAt">), createdAt };
}

export function validateProviderScenes(
  value: unknown,
  script: ScriptData,
): AIResponseSchemaEvidence | undefined {
  const issues: AIResponseSchemaIssue[] = [];
  const add = (issue: AIResponseSchemaIssue) => {
    if (issues.length < sceneSchemaIssueLimit) issues.push(issue);
  };
  if (!isRecord(value)) {
    add({ path: "$", reason: "WRONG_TYPE", expected: "object", observedType: observedType(value) });
    return { code: "AI_RESPONSE_SCHEMA_INVALID", issues };
  }
  exactFields(value, topLevelFields, "$", add);
  validateScenes(value.scenes, script, add);
  return issues.length ? { code: "AI_RESPONSE_SCHEMA_INVALID", issues } : undefined;
}

function validateScenes(
  value: unknown,
  script: ScriptData,
  add: (issue: AIResponseSchemaIssue) => void,
) {
  if (!Array.isArray(value)) {
    if (value !== undefined) add({ path: "$.scenes", reason: "WRONG_TYPE", expected: "array", observedType: observedType(value) });
    return;
  }
  if (value.length < script.chapters.length) add({ path: "$.scenes", reason: "MIN_ITEMS", expected: `>=${script.chapters.length}` });
  if (value.length > 30) add({ path: "$.scenes", reason: "MAX_ITEMS", expected: "<=30" });
  const chapterIndex = new Map(script.chapters.map((chapter, index) => [chapter.id, index]));
  const ids = new Set<number>();
  const durationByChapter = new Map<number, number>();
  let previousChapterIndex = -1;
  let totalDuration = 0;
  value.forEach((scene, index) => {
    const path = `$.scenes[${index}]`;
    if (!isRecord(scene)) {
      add({ path, reason: "WRONG_TYPE", expected: "object", observedType: observedType(scene) });
      return;
    }
    exactFields(scene, sceneFields, path, add);
    validateId(scene.id, `${path}.id`, add);
    if (typeof scene.id === "number" && Number.isSafeInteger(scene.id)) {
      if (ids.has(scene.id)) add({ path: `${path}.id`, reason: "DUPLICATE_ID", expected: "unique scene id", observedType: "number" });
      ids.add(scene.id);
      if (scene.id !== index + 1) add({ path: `${path}.id`, reason: "INVALID_ORDER", expected: `scene id ${index + 1}`, observedType: "number" });
    }
    validateId(scene.chapterId, `${path}.chapterId`, add);
    if (typeof scene.chapterId === "number" && Number.isSafeInteger(scene.chapterId)) {
      const currentChapterIndex = chapterIndex.get(scene.chapterId);
      if (currentChapterIndex === undefined) {
        add({ path: `${path}.chapterId`, reason: "INVALID_REFERENCE", expected: "existing script chapter id", observedType: "number" });
      } else {
        if (currentChapterIndex < previousChapterIndex) add({ path: `${path}.chapterId`, reason: "INVALID_ORDER", expected: "script chapter order", observedType: "number" });
        previousChapterIndex = Math.max(previousChapterIndex, currentChapterIndex);
      }
    }
    for (const [field, spec] of Object.entries(stringFields)) validateString(scene[field], `${path}.${field}`, spec, add);
    if (validDuration(scene.duration)) {
      totalDuration += scene.duration;
      if (typeof scene.chapterId === "number" && chapterIndex.has(scene.chapterId)) {
        durationByChapter.set(scene.chapterId, (durationByChapter.get(scene.chapterId) ?? 0) + scene.duration);
      }
    } else if (scene.duration !== undefined) {
      add({ path: `${path}.duration`, reason: "INVALID_DURATION", expected: ">0 and <=120 seconds", observedType: observedType(scene.duration) });
    }
  });
  for (const chapter of script.chapters) {
    const duration = durationByChapter.get(chapter.id);
    if (duration === undefined) add({ path: "$.scenes", reason: "INVALID_REFERENCE", expected: `chapter ${chapter.id} coverage` });
    else if (Math.abs(duration - chapter.duration) > 5) add({ path: "$.scenes", reason: "INVALID_DURATION", expected: `chapter ${chapter.id} duration within 5 seconds` });
  }
  if (totalDuration < 60 || totalDuration > 120 || Math.abs(totalDuration - script.estimatedDuration) > 5) {
    add({ path: "$.scenes", reason: "INVALID_DURATION", expected: "total 60-120 seconds and within 5 seconds of script" });
  }
}

function exactFields(value: Record<string, unknown>, expected: readonly string[], path: string, add: (issue: AIResponseSchemaIssue) => void) {
  for (const field of expected) if (!Object.prototype.hasOwnProperty.call(value, field)) add({ path: `${path}.${field}`, reason: "MISSING_REQUIRED_FIELD", observedType: "missing" });
  for (const field of Object.keys(value)) if (!expected.includes(field)) add({ path: `${path}.${field}`, reason: "UNKNOWN_FIELD" });
}

function validateId(value: unknown, path: string, add: (issue: AIResponseSchemaIssue) => void) {
  if (value === undefined) return;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) add({ path, reason: "INVALID_ID", expected: "positive integer", observedType: observedType(value) });
}

function validateString(value: unknown, path: string, spec: { minimumLength: number; maximumLength: number }, add: (issue: AIResponseSchemaIssue) => void) {
  if (value === undefined) return;
  if (typeof value !== "string") {
    add({ path, reason: "WRONG_TYPE", expected: "string", observedType: observedType(value) });
    return;
  }
  if (value.length < spec.minimumLength) add({ path, reason: "MIN_LENGTH", expected: `>=${spec.minimumLength}` });
  if (value.length > spec.maximumLength) add({ path, reason: "MAX_LENGTH", expected: `<=${spec.maximumLength}` });
}

function validDuration(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 120;
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
