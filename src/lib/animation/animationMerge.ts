import type { AnimationData, AnimationScene } from "@/types/animation";
import { isAnimationMotionPlanScene } from "./AnimationMotionPlanValidation";

export function mergeAnimationData(
  existing: AnimationData | null,
  updatedScenes: AnimationScene[],
  projectId: string,
): AnimationData {
  if (!existing) {
    const scenes = sortAnimationScenes(updatedScenes);
    const allMotionPlans = scenes.every(isAnimationMotionPlanScene);
    return {
      projectId,
      schemaVersion: allMotionPlans ? "2" : undefined,
      artifactType: allMotionPlans ? "motion-plan" : undefined,
      scenes,
      createdAt: new Date().toISOString(),
    };
  }

  const sceneMap = new Map<number, AnimationScene>(
    existing.scenes.map((scene) => [scene.sceneId, scene]),
  );

  for (const scene of updatedScenes) {
    const previous = sceneMap.get(scene.sceneId);
    sceneMap.set(scene.sceneId, previous ? { ...previous, ...scene } : scene);
  }

  const scenes = sortAnimationScenes(Array.from(sceneMap.values()));
  const allMotionPlans = scenes.every(isAnimationMotionPlanScene);

  return {
    ...existing,
    projectId: existing.projectId || projectId,
    schemaVersion: allMotionPlans ? "2" : undefined,
    artifactType: allMotionPlans ? "motion-plan" : undefined,
    scenes,
  };
}

function sortAnimationScenes(scenes: AnimationScene[]): AnimationScene[] {
  return [...scenes].sort((a, b) => a.sceneId - b.sceneId);
}
