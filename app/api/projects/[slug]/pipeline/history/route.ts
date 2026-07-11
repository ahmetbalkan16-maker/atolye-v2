import { NextResponse } from "next/server";
import { PipelineJobManager } from "@/lib/pipeline/PipelineJobManager";
import { ProjectManager } from "@/lib/projects/ProjectManager";
import { createPipelineStateErrorResponse } from "@/lib/pipeline/PipelineStateApiError";

type RouteContext = {
  params: Promise<{
    slug: string;
  }>;
};

export async function GET(_req: Request, context: RouteContext) {
  try {
    const { slug } = await context.params;

    if (!isSafeSlug(slug)) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid project slug.",
        },
        { status: 400 },
      );
    }

    const project = await ProjectManager.getProject(slug);

    if (!project) {
      return NextResponse.json(
        {
          success: false,
          error: "Project not found.",
        },
        { status: 404 },
      );
    }

    const history = await PipelineJobManager.listHistory(slug);

    return NextResponse.json({
      success: true,
      history,
    });
  } catch (error) {
    const stateErrorResponse = createPipelineStateErrorResponse(
      error,
      "[Pipeline History API] Pipeline state failed:",
    );

    if (stateErrorResponse) {
      return stateErrorResponse;
    }

    console.error("[Pipeline History API] History could not be read:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Pipeline history could not be read.",
      },
      { status: 500 },
    );
  }
}

function isSafeSlug(value: string) {
  return /^[a-zA-Z0-9-_]+$/.test(value);
}
