import { NextResponse } from "next/server";
import { ayasSafeModeHold } from "@/lib/ayas/safety/AyasSafeModeReader";
import { PipelineRunner } from "@/lib/pipeline/PipelineRunner";
import { ProjectManager } from "@/lib/projects/ProjectManager";
import { ProjectAlreadyExistsError } from "@/lib/projects/ProjectWriter";
import { createPipelineStateErrorResponse } from "@/lib/pipeline/PipelineStateApiError";

export async function POST(req: Request) {
  // Stage 15R: nothing but a read starts while AYAS is in SAFE_READ_ONLY.
  const safeMode = ayasSafeModeHold();
  if (safeMode) return NextResponse.json({ success: false, error: safeMode }, { status: 423 });
  let slug = "";
  try {
    const { topic } = await req.json();

    if (!topic || typeof topic !== "string" || !topic.trim()) {
      return NextResponse.json(
        { success: false, error: "Konu boş olamaz" },
        { status: 400 }
      );
    }

    const cleanTopic = topic.trim();
    slug = ProjectManager.createSlug(cleanTopic);

    // 0. A slug another project folder owns cannot be created: refuse before
    // paying for research.
    ProjectManager.assertProjectCreatable(cleanTopic);

    // Use the same trusted runtime, project-scoped usage and durable stage
    // execution as /api/pipeline. Stop here: research does not authorize
    // script, visuals, audio, assembly or publication.
    const result = await PipelineRunner.run(cleanTopic, {
      stopAfterStage: "research",
      automaticLocalRepair: true,
    });
    if (result.stopReason) {
      return NextResponse.json({
        success: false, error: result.stopReason,
        slug: result.slug, projectUrl: `/project/${result.slug}`,
      }, { status: 409 });
    }

    return NextResponse.json({
      success: true,
      project: result.project,
      research: result.research,
      slug: result.slug,
      projectUrl: `/project/${result.slug}`,
    });
  } catch (error) {
    const stateError = createPipelineStateErrorResponse(error, "[Research API] Pipeline state failed:");
    if (stateError) return stateError;
    if (error instanceof ProjectAlreadyExistsError) {
      return NextResponse.json(
        { success: false, error: "Bu konu için zaten bir proje var.", code: error.code },
        { status: 409 }
      );
    }

    console.error("[Research API] Pipeline error:", error);
    // A partial project is useful for inspection/retry. Never fabricate a
    // reference when the request failed before canonical project creation.
    let projectUrl: string | undefined;
    try { if (slug && await ProjectManager.getProject(slug)) projectUrl = `/project/${slug}`; } catch { /* keep the bounded failure */ }
    return NextResponse.json(
      { success: false, error: "Araştırma tamamlanamadı.", ...(projectUrl ? { slug, projectUrl } : {}) },
      { status: 500 }
    );
  }
}
