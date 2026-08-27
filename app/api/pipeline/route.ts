import { NextResponse } from "next/server";
import { PipelineRunner } from "@/lib/pipeline/PipelineRunner";
import { ProjectManager } from "@/lib/projects/ProjectManager";
import { createPipelineStateErrorResponse } from "@/lib/pipeline/PipelineStateApiError";

/**
 * When `PipelineRunner.run` throws part-way through the synchronous pipeline,
 * the project has usually already been created and its durable/partial state is
 * intact — the user just needs to reach `/project/[slug]` to see progress and
 * use the existing resume/retry actions. This attaches a project reference to a
 * failure body, but only after confirming the project actually exists on disk,
 * so a failure before `createProject` (or an unexpected slug) never yields a
 * fabricated link. Never throws: enrichment failure falls back to `body`.
 */
async function attachProjectReference<T extends Record<string, unknown>>(
  body: T,
  slug: string,
): Promise<T | (T & { slug: string; projectUrl: string })> {
  try {
    if (!slug) return body;
    const project = await ProjectManager.getProject(slug);
    if (!project) return body;
    return { ...body, slug, projectUrl: `/project/${slug}` };
  } catch {
    return body;
  }
}

export async function POST(req: Request) {
  let slug = "";

  try {
    const { topic } = await req.json();

    if (!topic || typeof topic !== "string" || !topic.trim()) {
      return NextResponse.json(
        {
          success: false,
          error: "Konu bos olamaz.",
        },
        { status: 400 },
      );
    }

    // Deterministic — the exact slug `PipelineRunner.runOnce` derives from the
    // same topic (ProjectManager.createSlug / createProject). Computed up front
    // so the failure path below can point the user at their partial project.
    slug = ProjectManager.createSlug(topic.trim());

    const result = await PipelineRunner.run(topic.trim());

    if (result.stopReason) {
      return NextResponse.json(
        {
          success: false,
          error: result.stopReason,
          slug: result.slug,
          projectUrl: `/project/${result.slug}`,
        },
        { status: 409 },
      );
    }

    return NextResponse.json({
      success: true,
      slug: result.slug,
      projectUrl: `/project/${result.slug}`,
    });
  } catch (error) {
    // Corrupt pipeline state (PipelineStateError) is left to the shared,
    // contract-locked handler untouched: in that state `/project/[slug]` and
    // its resume/retry actions read the same broken files, so redirecting the
    // user there would not actually help — it needs operator intervention.
    const stateErrorResponse = createPipelineStateErrorResponse(
      error,
      "[Pipeline API] Pipeline state failed:",
    );

    if (stateErrorResponse) {
      return stateErrorResponse;
    }

    // Any other mid-pipeline failure (a provider/OpenAI/FFmpeg error, etc.):
    // the project and its durable/partial state are intact, so hand back a
    // project reference the start screen can navigate to.
    console.error("[Pipeline API] Pipeline failed:", error);

    return NextResponse.json(
      await attachProjectReference(
        {
          success: false,
          error: "Uretim akisi tamamlanamadi.",
        },
        slug,
      ),
      { status: 500 },
    );
  }
}
