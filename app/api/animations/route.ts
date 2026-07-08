import { NextResponse } from "next/server";
import { AnimationAssetPipeline } from "@/lib/animation/AnimationAssetPipeline";
import { AnimationPromptGenerator } from "@/lib/animation/prompts/AnimationPromptGenerator";
import type { AnimationData, AnimationScene } from "@/types/animation";
import type { SceneData } from "@/types/scene";
import type { VisualData } from "@/types/visual";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { projectId, projectSlug, scenes, visuals, animationData, style } = body;

    if (
      typeof projectId !== "string" ||
      !projectId.trim() ||
      typeof projectSlug !== "string" ||
      !projectSlug.trim()
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "projectId ve projectSlug zorunludur.",
        },
        { status: 400 },
      );
    }

    const generatedAnimationData =
      isAnimationData(animationData)
        ? animationData
        : isAnimationScenes(scenes)
          ? null
          : isSceneData(scenes) && isVisualData(visuals)
            ? await AnimationPromptGenerator.generateAnimationData({
                projectId: projectId.trim(),
                scenes,
                visuals,
                style: typeof style === "string" ? style : undefined,
              })
            : null;

    const animationScenes = isAnimationScenes(scenes)
      ? scenes
      : generatedAnimationData?.scenes;

    if (!animationScenes) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Animation icin AnimationScene[] veya SceneData + VisualData zorunludur.",
        },
        { status: 400 },
      );
    }

    const projectAssets = await AnimationAssetPipeline.generateAnimationAssets({
      projectId: projectId.trim(),
      projectSlug: projectSlug.trim(),
      scenes: animationScenes,
    });

    return NextResponse.json({
      success: true,
      animationData: generatedAnimationData,
      assets: projectAssets.assets,
    });
  } catch (error) {
    console.error("[Animations API] Animation pipeline failed:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Animation pipeline calistirilamadi.",
      },
      { status: 500 },
    );
  }
}

function isAnimationData(value: unknown): value is AnimationData {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as AnimationData).projectId === "string" &&
    typeof (value as AnimationData).createdAt === "string" &&
    isAnimationScenes((value as AnimationData).scenes)
  );
}

function isAnimationScenes(value: unknown): value is AnimationScene[] {
  return (
    Array.isArray(value) &&
    value.every(
      (scene) =>
        Boolean(scene) &&
        typeof scene === "object" &&
        typeof (scene as AnimationScene).sceneId === "number" &&
        typeof (scene as AnimationScene).animationPrompt === "string" &&
        typeof (scene as AnimationScene).status === "string",
    )
  );
}

function isSceneData(value: unknown): value is SceneData {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as SceneData).createdAt === "string" &&
    Array.isArray((value as SceneData).scenes) &&
    (value as SceneData).scenes.every(
      (scene) =>
        Boolean(scene) &&
        typeof scene === "object" &&
        typeof scene.id === "number" &&
        typeof scene.title === "string" &&
        typeof scene.description === "string",
    )
  );
}

function isVisualData(value: unknown): value is VisualData {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as VisualData).projectId === "string" &&
    typeof (value as VisualData).createdAt === "string" &&
    Array.isArray((value as VisualData).scenes) &&
    (value as VisualData).scenes.every(
      (visual) =>
        Boolean(visual) &&
        typeof visual === "object" &&
        typeof visual.sceneId === "number" &&
        typeof visual.visualPrompt === "string" &&
        typeof visual.animationPrompt === "string" &&
        typeof visual.style === "string",
    )
  );
}
