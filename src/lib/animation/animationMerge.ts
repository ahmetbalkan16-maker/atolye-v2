import type { AnimationData, AnimationScene } from "@/types/animation";

export function mergeAnimationData(
  existing: AnimationData | null,
  updatedScenes: AnimationScene[],
  projectId: string,
): AnimationData {
  if (!existing) {
    return {
      projectId,
      scenes: sortAnimationScenes(updatedScenes),
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

  return {
    ...existing,
    projectId: existing.projectId || projectId,
    scenes: sortAnimationScenes(Array.from(sceneMap.values())),
  };
}

function sortAnimationScenes(scenes: AnimationScene[]): AnimationScene[] {
  return [...scenes].sort((a, b) => a.sceneId - b.sceneId);
}
