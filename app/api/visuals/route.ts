import { NextResponse } from "next/server";
import { ProjectManager } from "@/lib/projects/ProjectManager";
import { VisualManager } from "@/lib/visuals/VisualManager";
import type { SceneData, SceneItem } from "@/types/scene";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { projectId, slug, scenes, style = "cinematic" } = body;
    const sceneData = normalizeSceneData(scenes);

    if (!sceneData) {
      return NextResponse.json(
        {
          success: false,
          error: "Scenes dizisi gonderilmedi.",
        },
        { status: 400 },
      );
    }

    const visuals = await VisualManager.generateVisualData({
      projectId,
      scenes: sceneData,
      style,
    });

    if (typeof slug === "string" && slug.trim()) {
      await ProjectManager.saveVisuals(slug.trim(), visuals);
    }

    return NextResponse.json({
      success: true,
      visuals,
      prompts: visuals.prompts ?? [],
    });
  } catch (error) {
    console.error("[Visuals API] Visual Engine failed:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Visual Engine calistirilamadi.",
      },
      { status: 500 },
    );
  }
}

function normalizeSceneData(value: unknown): SceneData | null {
  if (isSceneData(value)) {
    return value;
  }

  if (Array.isArray(value)) {
    const scenes = value
      .map((item, index): SceneItem | null => {
        if (!item || typeof item !== "object") {
          return null;
        }

        const scene = item as Partial<SceneItem> & {
          id?: string | number;
          visualDescription?: string;
        };
        const id =
          typeof scene.id === "number"
            ? scene.id
            : Number.parseInt(String(scene.id ?? index + 1), 10);

        return {
          id: Number.isFinite(id) ? id : index + 1,
          title:
            typeof scene.title === "string" ? scene.title : `Sahne ${index + 1}`,
          description:
            typeof scene.description === "string"
              ? scene.description
              : scene.visualDescription ?? "",
          visualPrompt:
            typeof scene.visualPrompt === "string" ? scene.visualPrompt : undefined,
          duration: typeof scene.duration === "number" ? scene.duration : undefined,
        };
      })
      .filter((scene): scene is SceneItem => scene !== null);

    return {
      scenes,
      createdAt: new Date().toISOString(),
    };
  }

  return null;
}

function isSceneData(value: unknown): value is SceneData {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    Array.isArray((value as SceneData).scenes)
  );
}
