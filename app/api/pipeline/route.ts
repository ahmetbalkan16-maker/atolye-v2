import { NextResponse } from "next/server";
import { PipelineRunner } from "@/lib/pipeline/PipelineRunner";
import { createPipelineStateErrorResponse } from "@/lib/pipeline/PipelineStateApiError";

export async function POST(req: Request) {
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
    const stateErrorResponse = createPipelineStateErrorResponse(
      error,
      "[Pipeline API] Pipeline state failed:",
    );

    if (stateErrorResponse) {
      return stateErrorResponse;
    }

    console.error("[Pipeline API] Pipeline failed:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Uretim akisi tamamlanamadi.",
      },
      { status: 500 },
    );
  }
}
