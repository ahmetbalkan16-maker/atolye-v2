import type { SceneData } from "@/types/scene";
import type { ScriptData } from "@/types/script";
import type { ResearchData } from "@/types/research";
import { formatResearchForScenePrompt } from "./ResearchPromptContext";
import type {
  AIResponseObservedType,
  AIResponseSchemaEvidence,
  AIResponseSchemaIssue,
} from "@/types/aiResponse";
import { AIResponseError } from "./AIResponseError";
import { createCanonicalApplicationTimestamp } from "./CanonicalTimestamp";
import { resolveProductionAcceptanceDuration } from "@/lib/production/ProductionAcceptancePreflight";
import {
  isExplicitQualityPreset,
  resolveMaxSceneCount,
  resolveQualityPreset,
} from "@/lib/production/QualityPreset";

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

/** The legacy 60–120 s / 30-scene canonical schema (P2: still the default). */
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

/**
 * P2: the canonical scene schema for the active quality preset. With no
 * EXPLICIT `ATOLYE_QUALITY_PRESET` this is byte-identical to
 * {@link canonicalSceneProviderSchema}; an explicit preset widens
 * `sceneCount.maximum` and the `totalDuration` band (per-scene `duration` cap
 * stays 120 s — a single shot is never that long).
 */
export function resolveCanonicalSceneProviderSchema(env: NodeJS.ProcessEnv = process.env) {
  const duration = resolveProductionAcceptanceDuration(env);
  return Object.freeze({
    additionalProperties: false,
    applicationOwnedFields: ["createdAt"] as const,
    topLevelFields,
    sceneFields,
    sceneCount: { minimum: "script chapter count", maximum: resolveMaxSceneCount(env) },
    stringFields,
    duration: { minimumExclusive: 0, maximumInclusive: 120 },
    totalDuration: {
      minimum: duration.minimumSeconds,
      maximum: duration.maximumSeconds,
      tolerance: duration.toleranceSeconds,
    },
  });
}

/**
 * P2: the scene-count / total-duration guidance lines. With no EXPLICIT
 * `ATOLYE_QUALITY_PRESET` these are the historical strings verbatim (the
 * multi-shot smokes assert them); an explicit preset scales them from the band
 * and `sceneDensityPerMinute`.
 */
function scenePacingGuidance(env: NodeJS.ProcessEnv = process.env): {
  compactLine: string;
  aimLine: string;
  totalLine: string;
} {
  const band = resolveProductionAcceptanceDuration(env);
  if (!isExplicitQualityPreset(env)) {
    return {
      compactLine:
        "Keep every scene tight so the whole response stays compact with 10-18 scenes: " +
        "title around 40-70 characters, description one sentence around 120-200 characters, " +
        "visualPrompt around 200-360 characters. Do not pad.",
      aimLine:
        "- Aim for roughly 10 to 18 scenes in total across the whole script. Never exceed 30 scenes.",
      totalLine:
        "Total scene duration must be 60-120 seconds and match script estimatedDuration within 5 seconds.",
    };
  }
  const minutes = band.targetSeconds / 60;
  const density = resolveQualityPreset(env).sceneDensityPerMinute;
  const ideal = Math.round(minutes * density);
  const low = Math.max(4, Math.round(ideal * 0.75));
  const high = Math.round(ideal * 1.15);
  const maxScenes = resolveMaxSceneCount(env);
  return {
    compactLine:
      `Keep every scene tight so the whole response stays compact with about ${low}-${high} scenes: ` +
      "title around 40-70 characters, description one sentence around 120-200 characters, " +
      "visualPrompt around 200-360 characters. Do not pad.",
    aimLine:
      `- Aim for roughly ${low} to ${high} scenes in total across the whole script. Never exceed ${maxScenes} scenes.`,
    totalLine:
      `Total scene duration must be ${band.minimumSeconds}-${band.maximumSeconds} seconds and match ` +
      `script estimatedDuration within ${band.toleranceSeconds} seconds.`,
  };
}

export function createScenesPrompt(
  script: ScriptData,
  research?: ResearchData,
): string {
  const researchBlock = research ? formatResearchForScenePrompt(research) : "";
  const pacing = scenePacingGuidance();
  return [
    "You are a professional documentary scene planner.",
    "Create production-ready scene data from the documentary script below.",
    "Return exactly one JSON object and nothing else: no markdown, code fence, comments, or trailing text.",
    "Use exactly one top-level key: scenes. Additional top-level or nested keys are forbidden.",
    "Do not include createdAt; the application adds it after provider validation.",
    "Each scene must use exactly these keys: id, chapterId, title, description, visualPrompt, duration.",
    "id and chapterId must be positive integers. Scene ids must be unique and sequential from 1 in array order.",
    "chapterId must reference an existing script chapter id. Keep scenes grouped in script chapter order.",
    "Every script chapter must own at least one scene; never create an ownerless scene or a scene for a chapter id that does not exist.",
    "title, description, and visualPrompt must be non-empty strings.",
    "Hard limits: title 1-300 characters; description 1-2000; visualPrompt 1-2000.",
    pacing.compactLine,
    "duration must be a finite positive number no greater than 120 seconds.",
    `Each chapter's scene duration sum must match its script chapter duration within ${resolveProductionAcceptanceDuration().toleranceSeconds} seconds.`,
    pacing.totalLine,
    "Do not invent fields for unknown information; use the required strings only.",
    "Write title and description in Turkish. Keep visualPrompt cinematic and historically grounded.",
    "Shot rhythm (documentary pacing - one scene here = one shot in the final cut):",
    "- Break every chapter into 2 to 4 shots, each 4 to 8 seconds long. Use more shots for a chapter whose narration moves through several distinct moments (a march, a bombardment, a council, an entry), fewer for a single reflective idea.",
    pacing.aimLine,
    "- The shots inside one chapter must be genuinely different images: change the subject, the framing (wide / medium / close), the angle, or the moment in time. Do not restate the same picture with reworded text.",
    "- Order a chapter's shots as a mini-sequence that follows its narration in time.",
    "visualPrompt rules: describe ONE single cinematic frame - one subject, one clear composition, one moment in time. " +
      "Never describe a collage, grid, 2x2 layout, split screen, multiple panels, or several separate scenes in one image. " +
      "Use era-accurate clothing, architecture, weapons and objects; no anachronisms or modern objects unless the scene truly is modern.",
    ...(researchBlock
      ? [
          "Ground every scene's subject in the research findings below (real people, places and events - do not contradict them):",
          researchBlock,
        ]
      : []),
    "Canonical JSON skeleton (durations shown are per-shot examples, not a fixed value):",
    "{",
    '  "scenes": [',
    "    {",
    '      "id": 1,',
    '      "chapterId": 1,',
    '      "title": "string",',
    '      "description": "string",',
    '      "visualPrompt": "string",',
    '      "duration": 6',
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

  // Order (deliberate, see docs/DURATION_AUTHORITY.md - same principle as F-08):
  //   1. structural/schema validation - shape, field set, ids, ordering, string
  //      limits, per-scene duration RANGE. Reconciliation must never mask any
  //      of these, so they gate first.
  //   2. deterministic duration reconciliation - the model's per-scene duration
  //      numbers are only a relative hint; the authoritative per-chapter target
  //      comes from the (already narration-reconciled) script chapter durations.
  //   3. authoritative duration validation - per-chapter sums and the grand
  //      total, now checked against the reconciled values.
  const structuralEvidence = validateProviderScenes(parsed, script, "structure");
  if (structuralEvidence) {
    throw new AIResponseError("AI_RESPONSE_SCHEMA_INVALID", structuralEvidence);
  }

  // FAIL-CLOSED on a malformed authoritative duration input. Reconciliation
  // derives every scene duration from `script.chapters[].duration` /
  // `estimatedDuration`; if those are missing, non-finite, non-positive, or no
  // longer consistent (chapter sum vs estimatedDuration), there is no safe
  // authoritative target to reconcile against - reject rather than silently
  // pass the model's own numbers through.
  const authorityEvidence = validateScriptDurationAuthority(script);
  if (authorityEvidence) {
    throw new AIResponseError("AI_RESPONSE_SCHEMA_INVALID", authorityEvidence);
  }

  const reconciled = reconcileSceneDurations(parsed, script);

  const durationEvidence = validateProviderScenes(reconciled, script, "duration");
  if (durationEvidence) {
    throw new AIResponseError("AI_RESPONSE_SCHEMA_INVALID", durationEvidence);
  }

  const createdAt = createCanonicalApplicationTimestamp(now);
  return { ...(reconciled as Omit<SceneData, "createdAt">), createdAt };
}

/**
 * Deterministically redistributes each chapter's authoritative duration across
 * the scenes (shots) that belong to it, so a multi-shot plan is never rejected
 * for the model's own partitioning arithmetic. The model's numbers become
 * relative weights only; the totals come from `script.chapters[].duration`
 * (which `AIManager.runScript` already reconciled to real narration length via
 * F-08). Mirrors `reconcileChapterDurations`: integer seconds, per-chapter sum
 * exact, rounding remainder absorbed by the chapter's largest scene, a final
 * pass aligns the grand total with `script.estimatedDuration`, never <1s.
 *
 * FAIL-SAFE, NOT FAIL-CLOSED: if the parsed value is not shaped well enough to
 * reconcile safely (not a record, a scene with no numeric chapterId, a
 * chapterId with no matching script chapter, a chapter with a non-positive
 * duration, a chapter with no scenes), the input is returned UNCHANGED so the
 * subsequent full validation still fails closed on the real defect.
 */
export function reconcileSceneDurations(value: unknown, script: ScriptData): unknown {
  if (!isRecord(value) || !Array.isArray(value.scenes) || value.scenes.length === 0) {
    return value;
  }
  const originalScenes = value.scenes as unknown[];
  const chapters = script.chapters;
  if (!Array.isArray(chapters) || chapters.length === 0) return value;

  const chapterDuration = new Map<number, number>();
  for (const chapter of chapters) {
    if (
      typeof chapter.id !== "number" ||
      typeof chapter.duration !== "number" ||
      !Number.isFinite(chapter.duration) ||
      chapter.duration <= 0
    ) {
      return value;
    }
    chapterDuration.set(chapter.id, chapter.duration);
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < originalScenes.length; i += 1) {
    const scene = originalScenes[i];
    if (!isRecord(scene) || typeof scene.chapterId !== "number" || !chapterDuration.has(scene.chapterId)) {
      return value;
    }
    const list = groups.get(scene.chapterId) ?? [];
    list.push(i);
    groups.set(scene.chapterId, list);
  }
  for (const chapter of chapters) {
    if (!groups.has(chapter.id)) return value;
  }

  const nextScenes = originalScenes.map((scene) => ({ ...(scene as Record<string, unknown>) }));

  for (const [chapterId, indices] of groups) {
    const target = Math.max(1, Math.round(chapterDuration.get(chapterId) as number));
    const weights = indices.map((i) => {
      const raw = (originalScenes[i] as Record<string, unknown>).duration;
      return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : 0;
    });
    let weightSum = weights.reduce((sum, w) => sum + w, 0);
    const effectiveWeights = weightSum > 0 ? weights : indices.map(() => 1);
    if (weightSum <= 0) weightSum = indices.length;

    const floats = effectiveWeights.map((w) => (target * w) / weightSum);
    const ints = floats.map((f) => Math.max(1, Math.round(f)));
    const remainder = target - ints.reduce((sum, n) => sum + n, 0);
    if (remainder !== 0) {
      let largest = 0;
      for (let k = 1; k < floats.length; k += 1) {
        if (floats[k] > floats[largest]) largest = k;
      }
      ints[largest] = Math.max(1, ints[largest] + remainder);
    }
    indices.forEach((sceneIndex, k) => {
      nextScenes[sceneIndex].duration = ints[k];
    });
  }

  // Final grand-total pass: align sum(scene.duration) with the value the
  // authoritative validator checks (`script.estimatedDuration`), absorbing any
  // residual left by per-chapter min-1 clamping into the single largest scene.
  if (Number.isFinite(script.estimatedDuration) && script.estimatedDuration > 0) {
    const grandTarget = Math.round(script.estimatedDuration);
    const grandSum = nextScenes.reduce(
      (sum, scene) => sum + (typeof scene.duration === "number" ? scene.duration : 0),
      0,
    );
    const grandRemainder = grandTarget - grandSum;
    if (grandRemainder !== 0) {
      let largest = 0;
      for (let i = 1; i < nextScenes.length; i += 1) {
        const a = nextScenes[i].duration;
        const b = nextScenes[largest].duration;
        if (typeof a === "number" && typeof b === "number" && a > b) largest = i;
      }
      const current = nextScenes[largest].duration;
      if (typeof current === "number") {
        nextScenes[largest].duration = Math.max(1, current + grandRemainder);
      }
    }
  }

  return { ...value, scenes: nextScenes };
}

/**
 * FAIL-CLOSED precondition on the authoritative duration inputs that
 * `reconcileSceneDurations` and the "duration" validation pass depend on.
 * Returns evidence (which rejects the scenes response) when the script carries
 * no usable duration authority: no chapters, a non-integer / non-positive
 * chapter id, or a chapter duration / estimatedDuration that is missing,
 * non-finite (NaN / Infinity), or <= 0.
 *
 * Without this, a NaN / Infinity / negative chapter duration would make
 * `reconcileSceneDurations` fail SAFE (return the model's own numbers
 * unchanged), and the downstream `Math.abs(sum - NaN) > 5` per-chapter check
 * would silently evaluate to false - letting an unvalidated scene plan through.
 * The real pipeline never reaches here with a bad script (F-08 +
 * `validateProductionAcceptanceScriptDuration` guarantee it upstream); this is
 * defence in depth for that contract.
 */
function validateScriptDurationAuthority(
  script: ScriptData,
): AIResponseSchemaEvidence | undefined {
  const issues: AIResponseSchemaIssue[] = [];
  const add = (issue: AIResponseSchemaIssue) => {
    if (issues.length < sceneSchemaIssueLimit) issues.push(issue);
  };
  const chapters = script.chapters;
  if (!Array.isArray(chapters) || chapters.length === 0) {
    add({
      path: "$.script.chapters",
      reason: "INVALID_REFERENCE",
      expected: "at least one script chapter",
      observedType: observedType(chapters),
    });
    return { code: "AI_RESPONSE_SCHEMA_INVALID", issues };
  }
  chapters.forEach((chapter, index) => {
    const id = (chapter as { id?: unknown } | null)?.id;
    const duration = (chapter as { duration?: unknown } | null)?.duration;
    if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 1) {
      add({
        path: `$.script.chapters[${index}].id`,
        reason: "INVALID_ID",
        expected: "positive integer",
        observedType: observedType(id),
      });
    }
    if (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0) {
      add({
        path: `$.script.chapters[${index}].duration`,
        reason: "INVALID_DURATION",
        expected: "finite duration greater than 0 seconds",
        observedType: observedType(duration),
      });
    }
  });
  if (
    typeof script.estimatedDuration !== "number" ||
    !Number.isFinite(script.estimatedDuration) ||
    script.estimatedDuration <= 0
  ) {
    add({
      path: "$.script.estimatedDuration",
      reason: "INVALID_DURATION",
      expected: "finite duration greater than 0 seconds",
      observedType: observedType(script.estimatedDuration),
    });
  }
  return issues.length ? { code: "AI_RESPONSE_SCHEMA_INVALID", issues } : undefined;
}

export function validateProviderScenes(
  value: unknown,
  script: ScriptData,
  mode: "full" | "structure" | "duration" = "full",
): AIResponseSchemaEvidence | undefined {
  const issues: AIResponseSchemaIssue[] = [];
  const add = (issue: AIResponseSchemaIssue) => {
    if (issues.length < sceneSchemaIssueLimit) issues.push(issue);
  };
  if (!isRecord(value)) {
    add({ path: "$", reason: "WRONG_TYPE", expected: "object", observedType: observedType(value) });
    return { code: "AI_RESPONSE_SCHEMA_INVALID", issues };
  }
  if (mode !== "duration") exactFields(value, topLevelFields, "$", add);
  validateScenes(value.scenes, script, add, mode);
  return issues.length ? { code: "AI_RESPONSE_SCHEMA_INVALID", issues } : undefined;
}

function validateScenes(
  value: unknown,
  script: ScriptData,
  add: (issue: AIResponseSchemaIssue) => void,
  mode: "full" | "structure" | "duration" = "full",
) {
  const structural = mode !== "duration";
  const durationAuthority = mode !== "structure";
  const band = resolveProductionAcceptanceDuration();
  const maxScenes = resolveMaxSceneCount();
  if (!Array.isArray(value)) {
    if (value !== undefined) add({ path: "$.scenes", reason: "WRONG_TYPE", expected: "array", observedType: observedType(value) });
    return;
  }
  if (structural && value.length < script.chapters.length) add({ path: "$.scenes", reason: "MIN_ITEMS", expected: `>=${script.chapters.length}` });
  if (structural && value.length > maxScenes) add({ path: "$.scenes", reason: "MAX_ITEMS", expected: `<=${maxScenes}` });
  const chapterIndex = new Map(script.chapters.map((chapter, index) => [chapter.id, index]));
  const ids = new Set<number>();
  const durationByChapter = new Map<number, number>();
  let previousChapterIndex = -1;
  let totalDuration = 0;
  value.forEach((scene, index) => {
    const path = `$.scenes[${index}]`;
    if (!isRecord(scene)) {
      if (structural) add({ path, reason: "WRONG_TYPE", expected: "object", observedType: observedType(scene) });
      return;
    }
    if (structural) {
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
    }
    if (validDuration(scene.duration)) {
      totalDuration += scene.duration;
      if (typeof scene.chapterId === "number" && chapterIndex.has(scene.chapterId)) {
        durationByChapter.set(scene.chapterId, (durationByChapter.get(scene.chapterId) ?? 0) + scene.duration);
      }
    } else if (structural && scene.duration !== undefined) {
      add({ path: `${path}.duration`, reason: "INVALID_DURATION", expected: ">0 and <=120 seconds", observedType: observedType(scene.duration) });
    }
  });
  if (durationAuthority) {
    for (const chapter of script.chapters) {
      const duration = durationByChapter.get(chapter.id);
      if (duration === undefined) add({ path: "$.scenes", reason: "INVALID_REFERENCE", expected: `chapter ${chapter.id} coverage` });
      else if (Math.abs(duration - chapter.duration) > band.toleranceSeconds) {
        add({ path: "$.scenes", reason: "INVALID_DURATION", expected: `chapter ${chapter.id} duration within ${band.toleranceSeconds} seconds` });
      }
    }
    if (
      totalDuration < band.minimumSeconds ||
      totalDuration > band.maximumSeconds ||
      Math.abs(totalDuration - script.estimatedDuration) > band.toleranceSeconds
    ) {
      add({
        path: "$.scenes",
        reason: "INVALID_DURATION",
        expected: `total ${band.minimumSeconds}-${band.maximumSeconds} seconds and within ${band.toleranceSeconds} seconds of script`,
      });
    }
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
