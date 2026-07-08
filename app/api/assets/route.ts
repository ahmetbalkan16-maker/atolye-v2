import { NextResponse } from "next/server";
import { VisualAssetPipeline } from "@/lib/assets/VisualAssetPipeline";
import { MockImageProvider } from "@/lib/assets/providers/MockImageProvider";
import type { VisualData } from "@/types/visual";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { projectId, projectSlug, visualData } = body;

    if (
      typeof projectId !== "string" ||
      !projectId.trim() ||
      typeof projectSlug !== "string" ||
      !projectSlug.trim() ||
      !isVisualData(visualData)
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "projectId, projectSlug ve visualData zorunludur.",
        },
        { status: 400 },
      );
    }

    const provider = new MockImageProvider();
    const projectAssets = await VisualAssetPipeline.generateAssets({
      projectId: projectId.trim(),
      projectSlug: projectSlug.trim(),
      visualData,
      provider,
    });

    return NextResponse.json({
      success: true,
      assets: projectAssets.assets,
    });
  } catch (error) {
    console.error("[Assets API] Asset pipeline failed:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Asset pipeline calistirilamadi.",
      },
      { status: 500 },
    );
  }
}

function isVisualData(value: unknown): value is VisualData {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    Array.isArray((value as VisualData).scenes)
  );
}
