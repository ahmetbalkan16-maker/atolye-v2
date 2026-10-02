import { NextResponse } from "next/server";
import { ayasSafeModeHold } from "@/lib/ayas/safety/AyasSafeModeReader";
import { isCompatibleAnimationData } from "@/lib/animation/AnimationMotionPlanValidation";
import { ProjectManager } from "@/lib/projects/ProjectManager";
import { VideoPipeline } from "@/lib/video/VideoPipeline";
import type { Project } from "@/types/project";

export async function POST(req: Request) {
  // Stage 15R: nothing but a read starts while AYAS is in SAFE_READ_ONLY.
  const safeMode = ayasSafeModeHold();
  if (safeMode) return NextResponse.json({ success: false, error: safeMode }, { status: 423 });
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
    const [project, savedAnimation] = await Promise.all([
      ProjectManager.getProject(normalizedSlug) as Promise<Project | null>,
      ProjectManager.getAnimation(normalizedSlug),
    ]);

    if (!isCompatibleAnimationData(savedAnimation)) {
      return NextResponse.json(
        {
          success: false,
          error: "Video uretimi icin animation.json bulunamadi.",
        },
        { status: 400 },
      );
    }

    const { video, projectAssets } = await VideoPipeline.generateVideo({
      projectId: project?.id ?? savedAnimation.projectId,
      projectSlug: normalizedSlug,
      animation: savedAnimation,
    });

    await ProjectManager.saveVideo(normalizedSlug, video);

    return NextResponse.json({
      success: true,
      video,
      assets: projectAssets.assets,
    });
  } catch (error) {
    console.error("[Video API] Video pipeline failed:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Video pipeline calistirilamadi.",
      },
      { status: 500 },
    );
  }
}
