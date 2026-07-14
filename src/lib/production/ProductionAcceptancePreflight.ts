import type { SceneData, SceneItem } from "@/types/scene";
import type { ScriptData } from "@/types/script";
import type { AudioData } from "@/types/audio";
import type { AssemblyPlanData } from "@/types/assembly";

export const productionAcceptanceDuration = Object.freeze({
  minimumSeconds: 60,
  targetSeconds: 90,
  maximumSeconds: 120,
  toleranceSeconds: 5,
});

export class ProductionSceneMappingError extends Error {
  readonly code = "PRODUCTION_SCENE_MAPPING_INVALID";

  constructor() {
    super("Production scene mapping validation failed.");
    this.name = "ProductionSceneMappingError";
    this.stack = undefined;
  }
}

export class ProductionDurationPreflightError extends Error {
  readonly code = "PRODUCTION_DURATION_PREFLIGHT_FAILED";

  constructor() {
    super("Production duration preflight failed.");
    this.name = "ProductionDurationPreflightError";
    this.stack = undefined;
  }
}

export interface ProductionChapterSceneGroup {
  readonly chapterId: number;
  readonly sceneIds: readonly number[];
  readonly durationSeconds: number;
}

export interface ProductionSceneAudioSegment {
  readonly chapterId: number;
  readonly sceneId: number;
  readonly startSeconds: number;
  readonly durationSeconds: number;
}

export function validateProductionAcceptancePreflight(
  script: ScriptData,
  scenes: SceneData,
): readonly ProductionChapterSceneGroup[] {
  validateProductionAcceptanceScriptDuration(script);
  const chapters = script.chapters;
  if (!Array.isArray(chapters) || chapters.length === 0) {
    throw new ProductionSceneMappingError();
  }

  const chapterIds = new Set<number>();
  for (const chapter of chapters) {
    if (!positiveInteger(chapter.id) || chapterIds.has(chapter.id)) {
      throw new ProductionSceneMappingError();
    }
    chapterIds.add(chapter.id);
  }

  if (!Array.isArray(scenes.scenes) || scenes.scenes.length === 0) {
    throw new ProductionSceneMappingError();
  }

  const sceneIds = new Set<number>();
  const grouped = new Map<number, SceneItem[]>();
  let previousChapterIndex = -1;
  for (const scene of scenes.scenes) {
    if (!positiveInteger(scene.id) || sceneIds.has(scene.id)) {
      throw new ProductionSceneMappingError();
    }
    sceneIds.add(scene.id);
    if (!positiveInteger(scene.chapterId) || !chapterIds.has(scene.chapterId)) {
      throw new ProductionSceneMappingError();
    }
    const chapterIndex = chapters.findIndex((chapter) => chapter.id === scene.chapterId);
    if (chapterIndex < previousChapterIndex) throw new ProductionSceneMappingError();
    previousChapterIndex = chapterIndex;
    requireDuration(scene.duration);
    grouped.set(scene.chapterId, [...(grouped.get(scene.chapterId) ?? []), scene]);
  }

  const groups = chapters.map((chapter) => {
    const chapterScenes = grouped.get(chapter.id);
    if (!chapterScenes?.length) throw new ProductionSceneMappingError();
    const durationSeconds = chapterScenes.reduce(
      (sum, scene) => sum + (scene.duration as number),
      0,
    );
    requireClose(durationSeconds, chapter.duration);
    return Object.freeze({
      chapterId: chapter.id,
      sceneIds: Object.freeze(chapterScenes.map((scene) => scene.id)),
      durationSeconds,
    });
  });
  const sceneTotal = groups.reduce((sum, group) => sum + group.durationSeconds, 0);
  requireAcceptanceRange(sceneTotal);
  requireClose(sceneTotal, script.estimatedDuration);
  return Object.freeze(groups);
}

export function validateProductionAcceptanceScriptDuration(script: ScriptData) {
  if (!Array.isArray(script.chapters) || script.chapters.length === 0) {
    throw new ProductionDurationPreflightError();
  }
  requireDuration(script.estimatedDuration);
  requireAcceptanceRange(script.estimatedDuration);
  let chapterTotal = 0;
  for (const chapter of script.chapters) {
    requireDuration(chapter.duration);
    chapterTotal += chapter.duration;
  }
  requireAcceptanceRange(chapterTotal);
  requireClose(chapterTotal, script.estimatedDuration);
}

export function validateProductionSceneAudioMapping(
  scenes: SceneData,
  audio: AudioData,
  assembly?: AssemblyPlanData,
) {
  const sceneIds = new Set<number>();
  const chapterIds = new Set<number>();
  for (const scene of scenes.scenes) {
    if (
      !positiveInteger(scene.id) || sceneIds.has(scene.id) ||
      !positiveInteger(scene.chapterId)
    ) throw new ProductionSceneMappingError();
    sceneIds.add(scene.id);
    chapterIds.add(scene.chapterId);
  }
  const audioChapterIds = new Set<number>();
  for (const section of audio.sections) {
    if (!positiveInteger(section.chapterId) || audioChapterIds.has(section.chapterId)) {
      throw new ProductionSceneMappingError();
    }
    audioChapterIds.add(section.chapterId);
  }
  if (
    chapterIds.size !== audioChapterIds.size ||
    [...chapterIds].some((chapterId) => !audioChapterIds.has(chapterId))
  ) throw new ProductionSceneMappingError();
  if (assembly) {
    if (assembly.scenes.length !== scenes.scenes.length) throw new ProductionSceneMappingError();
    assembly.scenes.forEach((item, index) => {
      const source = scenes.scenes[index];
      if (item.sceneId !== source?.id || item.chapterId !== source.chapterId) {
        throw new ProductionSceneMappingError();
      }
    });
  }
}

export function allocateProductionSceneAudioSegments(
  scenes: SceneData,
  audioDurationByChapter: ReadonlyMap<number, number>,
): ReadonlyMap<number, ProductionSceneAudioSegment> {
  const result = new Map<number, ProductionSceneAudioSegment>();
  const chapterIds = new Set(
    scenes.scenes.map((scene) => scene.chapterId ?? scene.id),
  );
  if (
    chapterIds.size !== audioDurationByChapter.size ||
    [...chapterIds].some((chapterId) => !audioDurationByChapter.has(chapterId))
  ) throw new ProductionSceneMappingError();
  for (const [chapterId, actualDuration] of audioDurationByChapter) {
    requireDuration(actualDuration);
    const chapterScenes = scenes.scenes.filter(
      (scene) => (scene.chapterId ?? scene.id) === chapterId,
    );
    if (!chapterScenes.length) throw new ProductionSceneMappingError();
    const plannedTotal = chapterScenes.reduce((sum, scene) => {
      requireDuration(scene.duration);
      return sum + scene.duration;
    }, 0);
    let startSeconds = 0;
    chapterScenes.forEach((scene, index) => {
      if (result.has(scene.id)) throw new ProductionSceneMappingError();
      const durationSeconds = index === chapterScenes.length - 1
        ? actualDuration - startSeconds
        : actualDuration * ((scene.duration as number) / plannedTotal);
      requireDuration(durationSeconds);
      result.set(scene.id, Object.freeze({
        chapterId,
        sceneId: scene.id,
        startSeconds,
        durationSeconds,
      }));
      startSeconds += durationSeconds;
    });
  }
  if (result.size !== scenes.scenes.length) throw new ProductionSceneMappingError();
  return result;
}

function requireDuration(value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new ProductionDurationPreflightError();
  }
}

function requireAcceptanceRange(value: number) {
  if (
    value < productionAcceptanceDuration.minimumSeconds ||
    value > productionAcceptanceDuration.maximumSeconds
  ) {
    throw new ProductionDurationPreflightError();
  }
}

function requireClose(left: number, right: number) {
  if (Math.abs(left - right) > productionAcceptanceDuration.toleranceSeconds) {
    throw new ProductionDurationPreflightError();
  }
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}
