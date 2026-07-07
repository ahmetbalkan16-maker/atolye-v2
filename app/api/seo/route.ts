import { NextResponse } from "next/server";
import { ProjectManager } from "@/lib/projects/ProjectManager";
import { SEOManager } from "@/lib/seo/SEOManager";
import type { Project } from "@/types/project";
import type { ScriptData } from "@/types/script";
import type { ThumbnailData } from "@/types/thumbnail";

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
    const [project, script, thumbnail] = await Promise.all([
      ProjectManager.getProject(normalizedSlug) as Promise<Project | null>,
      ProjectManager.getScript(normalizedSlug) as Promise<ScriptData | null>,
      ProjectManager.getThumbnail(normalizedSlug) as Promise<ThumbnailData | null>,
    ]);

    if (!project) {
      return NextResponse.json(
        {
          success: false,
          error: "Proje bulunamadi.",
        },
        { status: 404 },
      );
    }

    if (!script) {
      return NextResponse.json(
        {
          success: false,
          error: "Senaryo verisi bulunamadi.",
        },
        { status: 400 },
      );
    }

    if (!thumbnail) {
      return NextResponse.json(
        {
          success: false,
          error: "Thumbnail verisi bulunamadi.",
        },
        { status: 400 },
      );
    }

    const seo = await SEOManager.generateSEOData(
      project.title,
      script,
      thumbnail,
    );

    await ProjectManager.saveSEO(normalizedSlug, seo);

    return NextResponse.json({
      success: true,
      seo,
    });
  } catch (error) {
    console.error("[SEO API] SEO Engine failed:", error);

    return NextResponse.json(
      {
        success: false,
        error: "SEO Engine calistirilamadi.",
      },
      { status: 500 },
    );
  }
}
