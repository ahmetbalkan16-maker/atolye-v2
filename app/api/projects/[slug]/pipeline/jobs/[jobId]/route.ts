import { NextResponse } from "next/server";
import { PipelineJobManager } from "@/lib/pipeline/PipelineJobManager";
import { PipelineRunner } from "@/lib/pipeline/PipelineRunner";
import { ProjectManager } from "@/lib/projects/ProjectManager";
import type { PipelineJobAction } from "@/types/pipelineJob";

type RouteContext = {
  params: Promise<{
    slug: string;
    jobId: string;
  }>;
};

type JobActionRequestBody = {
  action?: unknown;
};

export async function POST(req: Request, context: RouteContext) {
  try {
    const { slug, jobId } = await context.params;

    if (!isSafeSlug(slug) || !isSafeJobId(jobId)) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid pipeline job request.",
        },
        { status: 400 },
      );
    }

    const body = await readActionBody(req);

    if (!isPipelineJobAction(body?.action)) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid pipeline job action.",
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

    if (body.action === "retry") {
      const retryResult = await PipelineRunner.executeJobRetry(slug, jobId);
      const jobs = await PipelineJobManager.listJobs(slug);

      if (!retryResult.success) {
        return NextResponse.json(
          {
            success: false,
            error: retryResult.reason,
            jobs,
            execution: {
              status: retryResult.blocked ? "blocked" : "failed",
              stage: retryResult.retriedStage,
            },
          },
          { status: retryResult.status },
        );
      }

      return NextResponse.json({
        success: true,
        jobs,
        execution: {
          status: "completed",
          stage: retryResult.retriedStage,
        },
      });
    }

    const result = await PipelineJobManager.applyAction(slug, jobId, body.action);

    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          error: result.error,
        },
        { status: result.status },
      );
    }

    return NextResponse.json({
      success: true,
      jobs: result.jobs,
    });
  } catch (error) {
    console.error("[Pipeline Jobs API] Job action failed:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Pipeline job action failed.",
      },
      { status: 500 },
    );
  }
}

async function readActionBody(
  req: Request,
): Promise<JobActionRequestBody | null> {
  try {
    const body = (await req.json()) as unknown;

    if (!body || typeof body !== "object") {
      return null;
    }

    return body as JobActionRequestBody;
  } catch {
    return null;
  }
}

function isPipelineJobAction(value: unknown): value is PipelineJobAction {
  return value === "cancel" || value === "retry";
}

function isSafeSlug(value: string) {
  return /^[a-zA-Z0-9-_]+$/.test(value);
}

function isSafeJobId(value: string) {
  return /^[a-zA-Z0-9-_]+$/.test(value);
}
