import {
  animationMotionTypes,
  animationTransitionTypes,
  type AnimationMotionFrame,
  type AnimationMotionType,
  type AnimationTransitionType,
} from "@/types/animation";
import type {
  AnimationSchemaIssue,
  AnimationSchemaValueCategory,
} from "@/types/animationError";

export const animationSchemaIssueLimit = 8;
export const animationSchemaIssuePathLimit = 120;
export const animationSchemaIssueCountLimit = 1_048_576;

const planFields = ["motionType", "start", "end", "transition"] as const;
const frameFields = ["crop", "transform"] as const;
const cropNumberSpecs = Object.freeze({
  x: { minimum: 0, maximum: 1, category: "normalized-number" },
  y: { minimum: 0, maximum: 1, category: "normalized-number" },
  width: { minimum: 0.1, maximum: 1, category: "crop-size" },
  height: { minimum: 0.1, maximum: 1, category: "crop-size" },
} as const);
const transformNumberSpecs = Object.freeze({
  scale: { minimum: 1, maximum: 2, category: "scale" },
  translateX: { minimum: -1, maximum: 1, category: "translation" },
  translateY: { minimum: -1, maximum: 1, category: "translation" },
} as const);
const cropFields = Object.freeze(Object.keys(cropNumberSpecs));
const transformFields = Object.freeze(Object.keys(transformNumberSpecs));

export type CanonicalAnimationProviderPlan = {
  motionType: AnimationMotionType;
  start: AnimationMotionFrame;
  end: AnimationMotionFrame;
  transition: AnimationTransitionType;
};

export const canonicalAnimationProviderSchema = Object.freeze({
  applicationOwnedFields: [
    "sceneId",
    "sourceImageAssetId",
    "durationSeconds",
    "requestIdentity",
    "assetId",
    "createdAt",
  ] as const,
  providerOwnedFields: planFields,
  additionalProperties: false,
  jsonSchema: {
    type: "object",
    additionalProperties: false,
    required: [...planFields],
    properties: {
      motionType: { type: "string", enum: [...animationMotionTypes] },
      start: frameJsonSchema(),
      end: frameJsonSchema(),
      transition: { type: "string", enum: [...animationTransitionTypes] },
    },
  },
});

export function createAnimationMotionPlanSystemPrompt() {
  return [
    "Return exactly one JSON motion plan and nothing else.",
    `Use exactly these fields: ${planFields.join(", ")}.`,
    `Each start/end frame uses exactly: ${frameFields.join(", ")}.`,
    `crop uses exactly: ${cropFields.join(", ")}; transform uses exactly: ${transformFields.join(", ")}.`,
    `motionType must be one of: ${animationMotionTypes.join(", ")}.`,
    `transition must be one of: ${animationTransitionTypes.join(", ")}.`,
    `Do not return application-owned fields: ${canonicalAnimationProviderSchema.applicationOwnedFields.join(", ")}.`,
    "Do not return ordering, storage, or metadata fields.",
  ].join(" ");
}

export type AnimationStructuredOutputValidation =
  | { success: true; plan: CanonicalAnimationProviderPlan }
  | { success: false; issueCount: number; issues: readonly AnimationSchemaIssue[] };

export function validateAnimationProviderPlan(
  value: unknown,
): AnimationStructuredOutputValidation {
  const issues: AnimationSchemaIssue[] = [];
  let issueCount = 0;
  const add = (issue: AnimationSchemaIssue) => {
    issueCount = Math.min(issueCount + 1, animationSchemaIssueCountLimit);
    if (issues.length < animationSchemaIssueLimit) issues.push(issue);
  };
  if (!isRecord(value)) {
    add(issue("$", "WRONG_TYPE", "object", category(value)));
    return { success: false, issueCount, issues };
  }
  exactFields(value, planFields, "$", add);
  validateEnum(value.motionType, "$.motionType", animationMotionTypes, "motion-type", add);
  validateFrame(value.start, "$.start", add);
  validateFrame(value.end, "$.end", add);
  validateEnum(value.transition, "$.transition", animationTransitionTypes, "transition-type", add);
  return issues.length
    ? { success: false, issueCount, issues }
    : { success: true, plan: value as CanonicalAnimationProviderPlan };
}

function validateFrame(
  value: unknown,
  path: string,
  add: (value: AnimationSchemaIssue) => void,
) {
  if (!isRecord(value)) {
    if (value !== undefined) add(issue(path, "WRONG_TYPE", "object", category(value)));
    return;
  }
  exactFields(value, frameFields, path, add);
  validateNumericObject(value.crop, `${path}.crop`, cropFields, add);
  validateNumericObject(value.transform, `${path}.transform`, transformFields, add);
  if (isRecord(value.crop)) {
    validateNumericRanges(value.crop, `${path}.crop`, cropNumberSpecs, add);
    if (finite(value.crop.x) && finite(value.crop.width) && value.crop.x + value.crop.width > 1) {
      add(issue(`${path}.crop.width`, "OUT_OF_RANGE", "crop-bounds", "number"));
    }
    if (finite(value.crop.y) && finite(value.crop.height) && value.crop.y + value.crop.height > 1) {
      add(issue(`${path}.crop.height`, "OUT_OF_RANGE", "crop-bounds", "number"));
    }
  }
  if (isRecord(value.transform)) {
    validateNumericRanges(value.transform, `${path}.transform`, transformNumberSpecs, add);
  }
}

function validateNumericObject(
  value: unknown,
  path: string,
  fields: readonly string[],
  add: (value: AnimationSchemaIssue) => void,
) {
  if (!isRecord(value)) {
    if (value !== undefined) add(issue(path, "WRONG_TYPE", "object", category(value)));
    return;
  }
  exactFields(value, fields, path, add);
  for (const field of fields) {
    const nested = value[field];
    if (nested !== undefined && typeof nested !== "number") {
      add(issue(`${path}.${field}`, "WRONG_TYPE", "number", category(nested)));
    } else if (typeof nested === "number" && !Number.isFinite(nested)) {
      add(issue(`${path}.${field}`, "NON_FINITE", "finite-number", "number"));
    }
  }
}

function validateRange(
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
  expected: AnimationSchemaValueCategory,
  add: (value: AnimationSchemaIssue) => void,
) {
  if (typeof value === "number" && Number.isFinite(value) && (value < minimum || value > maximum)) {
    add(issue(path, "OUT_OF_RANGE", expected, "number"));
  }
}

function validateNumericRanges(
  value: Record<string, unknown>,
  path: string,
  specs: Record<string, {
    readonly minimum: number;
    readonly maximum: number;
    readonly category: AnimationSchemaValueCategory;
  }>,
  add: (value: AnimationSchemaIssue) => void,
) {
  for (const [field, spec] of Object.entries(specs)) {
    validateRange(value[field], `${path}.${field}`, spec.minimum, spec.maximum, spec.category, add);
  }
}

function validateEnum(
  value: unknown,
  path: string,
  allowed: readonly string[],
  expected: AnimationSchemaValueCategory,
  add: (value: AnimationSchemaIssue) => void,
) {
  if (value === undefined) return;
  if (typeof value !== "string") {
    add(issue(path, "WRONG_TYPE", expected, category(value)));
  } else if (!allowed.includes(value)) {
    add(issue(path, "INVALID_ENUM", expected, "string"));
  }
}

function exactFields(
  value: Record<string, unknown>,
  fields: readonly string[],
  path: string,
  add: (value: AnimationSchemaIssue) => void,
) {
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      add(issue(`${path}.${field}`, "MISSING_REQUIRED_FIELD", expectedField(field), "missing"));
    }
  }
  for (const field of Object.keys(value)) {
    if (!fields.includes(field)) {
      add(issue(`${path}.${safePathSegment(field)}`, "UNKNOWN_FIELD", "forbidden", category(value[field])));
    }
  }
}

function safePathSegment(value: string) {
  return /^[A-Za-z][A-Za-z0-9]{0,49}$/.test(value) ? value : "unknownField";
}

function issue(
  path: string,
  code: AnimationSchemaIssue["code"],
  expected: AnimationSchemaValueCategory,
  received: AnimationSchemaValueCategory,
): AnimationSchemaIssue {
  return { path: path.slice(0, animationSchemaIssuePathLimit), code, expected, received };
}

function expectedField(field: string): AnimationSchemaValueCategory {
  if (field === "motionType") return "motion-type";
  if (field === "transition") return "transition-type";
  if (field === "start" || field === "end" || field === "crop" || field === "transform") return "object";
  return "number";
}

function category(value: unknown): AnimationSchemaValueCategory {
  if (value === undefined) return "missing";
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return "unknown";
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function frameJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: [...frameFields],
    properties: {
      crop: {
        type: "object",
        additionalProperties: false,
        required: [...cropFields],
        properties: numericJsonSchemaProperties(cropNumberSpecs),
      },
      transform: {
        type: "object",
        additionalProperties: false,
        required: [...transformFields],
        properties: numericJsonSchemaProperties(transformNumberSpecs),
      },
    },
  } as const;
}

function numericJsonSchemaProperties(
  specs: Record<string, { readonly minimum: number; readonly maximum: number }>,
) {
  return Object.fromEntries(Object.entries(specs).map(([field, spec]) => [
    field,
    { type: "number", minimum: spec.minimum, maximum: spec.maximum },
  ]));
}
