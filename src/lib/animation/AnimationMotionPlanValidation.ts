import {
  animationMotionTypes,
  animationTransitionTypes,
  type AnimationData,
  type AnimationMotionFrame,
  type AnimationMotionPlanScene,
  type AnimationScene,
} from "@/types/animation";

const MIN_DURATION_SECONDS = 1;
const MAX_DURATION_SECONDS = 300;
const MIN_CROP_SIZE = 0.1;
const MIN_SCALE = 1;
const MAX_SCALE = 2;
const MIN_TRANSLATION = -1;
const MAX_TRANSLATION = 1;
const animationStatuses = new Set(["planned", "generating", "generated", "failed"]);
const motionTypes = new Set<string>(animationMotionTypes);
const transitionTypes = new Set<string>(animationTransitionTypes);

export function isValidAnimationDuration(value: unknown): value is number {
  return finiteBetween(value, MIN_DURATION_SECONDS, MAX_DURATION_SECONDS);
}

export function isValidAnimationMotionFrame(
  value: unknown,
): value is AnimationMotionFrame {
  if (!value || typeof value !== "object") return false;
  const frame = value as AnimationMotionFrame;
  const crop = frame.crop;
  const transform = frame.transform;

  return (
    finiteBetween(crop?.x, 0, 1) &&
    finiteBetween(crop?.y, 0, 1) &&
    finiteBetween(crop?.width, MIN_CROP_SIZE, 1) &&
    finiteBetween(crop?.height, MIN_CROP_SIZE, 1) &&
    crop.x + crop.width <= 1 &&
    crop.y + crop.height <= 1 &&
    finiteBetween(transform?.scale, MIN_SCALE, MAX_SCALE) &&
    finiteBetween(transform?.translateX, MIN_TRANSLATION, MAX_TRANSLATION) &&
    finiteBetween(transform?.translateY, MIN_TRANSLATION, MAX_TRANSLATION)
  );
}

export function isAnimationMotionPlanScene(
  value: unknown,
): value is AnimationMotionPlanScene {
  if (!isLegacyAnimationScene(value)) return false;
  const scene = value as AnimationMotionPlanScene;

  return (
    scene.artifactType === "motion-plan" &&
    scene.sceneId > 0 &&
    isNonEmptyString(scene.animationPrompt) &&
    isNonEmptyString(scene.sourceImageAssetId) &&
    isNonEmptyString(scene.outputAssetId) &&
    isNonEmptyString(scene.animationAssetId) &&
    scene.outputAssetId === scene.animationAssetId &&
    isValidAnimationDuration(scene.durationSeconds) &&
    motionTypes.has(scene.motionType) &&
    transitionTypes.has(scene.transition) &&
    isValidAnimationMotionFrame(scene.start) &&
    isValidAnimationMotionFrame(scene.end) &&
    isSafeProviderName(scene.provider) &&
    (scene.model === undefined || typeof scene.model === "string") &&
    scene.generationMode === (scene.provider === "mock" ? "mock" : "production") &&
    scene.status === "generated"
  );
}

/** Accepts legacy, mixed legacy/v2, and complete v2 files; partial v2 records fail closed. */
export function isCompatibleAnimationData(value: unknown): value is AnimationData {
  if (!value || typeof value !== "object") return false;
  const data = value as AnimationData;

  if (
    !isNonEmptyString(data.projectId) ||
    !isNonEmptyString(data.createdAt) ||
    !Array.isArray(data.scenes)
  ) {
    return false;
  }

  const isV2 = data.schemaVersion === "2" && data.artifactType === "motion-plan";
  const hasVersionMarker = data.schemaVersion !== undefined || data.artifactType !== undefined;
  if (hasVersionMarker && !isV2) return false;
  if (isV2 && data.scenes.length === 0) return false;

  const sceneIds = new Set<number>();
  const sourceIds = new Set<string>();
  const animationIds = new Set<string>();

  for (const scene of data.scenes) {
    const motionPlan = isAnimationMotionPlanScene(scene);
    if (isV2 ? !motionPlan : hasMotionPlanFields(scene) ? !motionPlan : !isLegacyAnimationScene(scene)) {
      return false;
    }

    const typedScene = scene as AnimationScene;
    if (sceneIds.has(typedScene.sceneId)) return false;
    sceneIds.add(typedScene.sceneId);

    if (motionPlan) {
      if (
        sourceIds.has(scene.sourceImageAssetId) ||
        animationIds.has(scene.animationAssetId)
      ) {
        return false;
      }
      sourceIds.add(scene.sourceImageAssetId);
      animationIds.add(scene.animationAssetId);
    }
  }

  return true;
}

function isLegacyAnimationScene(value: unknown): value is AnimationScene {
  if (!value || typeof value !== "object") return false;
  const scene = value as AnimationScene;

  return (
    Number.isSafeInteger(scene.sceneId) &&
    scene.sceneId >= 0 &&
    typeof scene.animationPrompt === "string" &&
    animationStatuses.has(scene.status) &&
    (scene.outputAssetId === undefined || typeof scene.outputAssetId === "string") &&
    (scene.provider === undefined || typeof scene.provider === "string") &&
    (scene.model === undefined || typeof scene.model === "string")
  );
}

function hasMotionPlanFields(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const scene = value as AnimationScene;
  return (
    scene.artifactType !== undefined ||
    scene.sourceImageAssetId !== undefined ||
    scene.animationAssetId !== undefined ||
    scene.durationSeconds !== undefined ||
    scene.motionType !== undefined ||
    scene.start !== undefined ||
    scene.end !== undefined ||
    scene.transition !== undefined ||
    scene.generationMode !== undefined
  );
}

function isSafeProviderName(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9-_]+$/.test(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}

function finiteBetween(value: unknown, minimum: number, maximum: number) {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
  );
}
