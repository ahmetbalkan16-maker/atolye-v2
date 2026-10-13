import type { SceneData, SceneItem } from "@/types/scene";
import type { ScriptData } from "@/types/script";
import { estimateNarrationSeconds } from "./NarrationDurationEstimator";

/** Explicit ordinary-pipeline mode; legacy callers and strict grading stay unchanged. */
export function createChapterSceneFallback(script: ScriptData): SceneData {
  const ids = script.chapters.map((chapter) => chapter.id);
  if (!ids.length || new Set(ids).size !== ids.length ||
      ids.some((id) => !Number.isSafeInteger(id) || id < 1)) {
    throw new Error("SCENE_SCRIPT_CHAPTERS_INVALID");
  }
  return {
    scenes: script.chapters.map((chapter, index) => ({
      id: index + 1,
      chapterId: chapter.id,
      title: chapter.title,
      description: chapter.narration,
      visualPrompt: [script.topic, chapter.title, chapter.visualGoal, chapter.narration].join(". "),
      // Model-authored duration can be minutes per sentence. This is only an
      // a-priori planning estimate; actual TTS remains the montage authority.
      duration: Math.min(300, Math.max(1, Math.ceil(estimateNarrationSeconds(chapter.narration)))),
    })),
    createdAt: new Date().toISOString(),
  };
}

/** Accept complete ordered chapter ownership, otherwise use the canonical script plan. */
export function requireChapterSceneCoverage(
  scenes: SceneItem[], script: ScriptData, fallback: SceneData,
): SceneItem[] {
  const chapterIds = script.chapters.map((chapter) => chapter.id);
  const mapped = scenes.map((scene, index) => ({
    ...scene,
    // A chapter-free legacy response is unambiguous only at exactly one scene per chapter.
    chapterId: scene.chapterId ?? (scenes.length === chapterIds.length ? chapterIds[index] : undefined),
  }));
  const owners = mapped.map((scene) => chapterIds.indexOf(scene.chapterId as number));
  if (!mapped.length || owners.some((owner, index) => owner < 0 ||
      (index > 0 && owner < owners[index - 1])) ||
      chapterIds.some((id) => !mapped.some((scene) => scene.chapterId === id))) {
    return fallback.scenes;
  }
  return mapped.map((scene) => {
    const chapter = script.chapters.find((item) => item.id === scene.chapterId)!;
    const siblings = mapped.filter((item) => item.chapterId === scene.chapterId);
    const weight = (item: SceneItem) => Number.isFinite(item.duration) && item.duration! > 0 ? item.duration! : 1;
    const totalWeight = siblings.reduce((sum, item) => sum + weight(item), 0);
    const seconds = Math.max(siblings.length, Math.ceil(estimateNarrationSeconds(chapter.narration)));
    return { ...scene, duration: Math.min(300, Math.max(1, seconds * weight(scene) / totalWeight)) };
  });
}
