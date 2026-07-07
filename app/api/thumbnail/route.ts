import { NextResponse } from "next/server";
import { ProjectManager } from "@/lib/projects/ProjectManager";
import { ThumbnailManager } from "@/lib/thumbnail/ThumbnailManager";
import type { ScriptData } from "@/types/script";
import type { VisualData } from "@/types/visual";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { slug } = body;

    if (typeof slug !== "string" || !slug.trim()) {
      return NextResponse.json(
        {
          success: false,
          error: "Proje slug degeri gonderilmedi.",
        },
        { status: 400 },
      );
    }

    const normalizedSlug = slug.trim();
    const [script, visuals] = await Promise.all([
      ProjectManager.getScript(normalizedSlug) as Promise<ScriptData | null>,
      ProjectManager.getVisuals(normalizedSlug) as Promise<VisualData | null>,
    ]);

    if (!script) {
      return NextResponse.json(
        {
          success: false,
          error: "Senaryo verisi bulunamadi.",
        },
        { status: 400 },
      );
    }

    if (!visuals) {
      return NextResponse.json(
        {
          success: false,
          error: "Gorsel plan verisi bulunamadi.",
        },
        { status: 400 },
      );
    }

    const thumbnail = await ThumbnailManager.generateThumbnailData(
      script,
      visuals,
    );

    await ProjectManager.saveThumbnail(normalizedSlug, thumbnail);

    return NextResponse.json({
      success: true,
      thumbnail,
    });
  } catch (error) {
    console.error("[Thumbnail API] Thumbnail Engine failed:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Thumbnail Engine calistirilamadi.",
      },
      { status: 500 },
    );
  }
}
