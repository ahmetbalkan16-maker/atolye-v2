import { NextResponse } from "next/server";
import { AnimationAssetPipeline } from "@/lib/animation/AnimationAssetPipeline";
import type { AnimationScene } from "@/types/animation";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { projectId, projectSlug, scenes } = body;

    if (
      typeof projectId !== "string" ||
      !projectId.trim() ||
      typeof projectSlug !== "string" ||
      !projectSlug.trim() ||
      !isAnimationScenes(scenes)
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "projectId, projectSlug ve scenes zorunludur.",
        },
        { status: 400 },
      );
    }

    const projectAssets = await AnimationAssetPipeline.generateAnimationAssets({
      projectId: projectId.trim(),
      projectSlug: projectSlug.trim(),
      scenes,
    });

    return NextResponse.json({
      success: true,
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
