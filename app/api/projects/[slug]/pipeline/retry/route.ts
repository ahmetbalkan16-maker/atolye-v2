import { NextResponse } from "next/server";
import { PipelineRunner } from "@/lib/pipeline/PipelineRunner";
import { configureProductionPipelineExecution } from "@/lib/production/ProductionPipelineExecutionFactory";
import { ProjectManager } from "@/lib/projects/ProjectManager";
import type { PipelineRecoveryStageKey } from "@/types/pipelineRecovery";
import { createPipelineStateErrorResponse } from "@/lib/pipeline/PipelineStateApiError";

configureProductionPipelineExecution();

type RouteContext = {
  params: Promise<{
    slug: string;
  }>;
};

type RetryRequestBody = {
  stage?: unknown;
};

const validStages: readonly PipelineRecoveryStageKey[] = [
  "research",
  "script",
  "scenes",
  "visuals",
  "animation",
  "video",
  "audio",
  "assembly",
  "thumbnail",
  "seo",
  "youtube",
  "export",
];

export async function POST(req: Request, context: RouteContext) {
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

    const body = await readRetryBody(req);

    if (!body) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid request body.",
        },
        { status: 400 },
      );
    }

    if (!isPipelineStage(body.stage)) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid pipeline stage.",
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

    const result = await PipelineRunner.retryStage(slug, body.stage);

    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          blocked: result.blocked,
          error: result.reason,
          result,
        },
        { status: result.status },
      );
    }

    return NextResponse.json({
      success: true,
      result,
    });
  } catch (error) {
    const stateErrorResponse = createPipelineStateErrorResponse(
      error,
      "[Pipeline Retry API] Pipeline state failed:",
    );

    if (stateErrorResponse) {
      return stateErrorResponse;
    }

    console.error("[Pipeline Retry API] Pipeline retry failed:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Pipeline retry failed.",
      },
      { status: 500 },
    );
  }
}

async function readRetryBody(req: Request): Promise<RetryRequestBody | null> {
  try {
    const body = (await req.json()) as unknown;

    if (!body || typeof body !== "object") {
      return null;
    }

    return body as RetryRequestBody;
  } catch {
    return null;
  }
}

function isPipelineStage(value: unknown): value is PipelineRecoveryStageKey {
  return (
    typeof value === "string" &&
    validStages.includes(value as PipelineRecoveryStageKey)
  );
}

function isSafeSlug(value: string) {
  return /^[a-zA-Z0-9-_]+$/.test(value);
}
