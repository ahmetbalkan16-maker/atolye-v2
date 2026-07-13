import { NextResponse } from "next/server";
import { PipelineRunner } from "@/lib/pipeline/PipelineRunner";
import { configureProductionPipelineExecution } from "@/lib/production/ProductionPipelineExecutionFactory";
import { ProjectManager } from "@/lib/projects/ProjectManager";
import { createPipelineStateErrorResponse } from "@/lib/pipeline/PipelineStateApiError";

configureProductionPipelineExecution();

type RouteContext = {
  params: Promise<{
    slug: string;
  }>;
};

export async function POST(_req: Request, context: RouteContext) {
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

    const result = await PipelineRunner.resume(slug);

    if (result.blocked) {
      return NextResponse.json(
        {
          success: false,
          blocked: true,
          error: result.reason,
          result,
        },
        { status: 409 },
      );
    }

    return NextResponse.json({
      success: true,
      result,
    });
  } catch (error) {
    const stateErrorResponse = createPipelineStateErrorResponse(
      error,
      "[Pipeline Resume API] Pipeline state failed:",
    );

    if (stateErrorResponse) {
      return stateErrorResponse;
    }

    console.error("[Pipeline Resume API] Pipeline resume failed:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Pipeline resume failed.",
      },
      { status: 500 },
    );
  }
}

function isSafeSlug(value: string) {
  return /^[a-zA-Z0-9-_]+$/.test(value);
}
