import { NextResponse } from "next/server";
import { AssetManager } from "@/lib/assets/AssetManager";
import { VisualAssetPipeline } from "@/lib/assets/VisualAssetPipeline";
import { MockImageProvider } from "@/lib/assets/providers/MockImageProvider";
import type { VisualData } from "@/types/visual";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const projectSlug = searchParams.get("projectSlug");
    const projectId = searchParams.get("projectId") ?? projectSlug;

    if (!projectSlug?.trim()) {
      return NextResponse.json(
        {
          success: false,
          error: "projectSlug zorunludur.",
        },
        { status: 400 },
      );
    }

    const projectAssets = AssetManager.getProjectAssets(
      projectSlug.trim(),
      projectId?.trim() || projectSlug.trim(),
    );

    return NextResponse.json({
      success: true,
      assets: projectAssets.assets,
    });
  } catch (error) {
    console.error("[Assets API] Asset read failed:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Asset verileri okunamadi.",
      },
      { status: 500 },
    );
  }
}

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
