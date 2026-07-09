import { NextResponse } from "next/server";
import { AIUsageManager } from "@/lib/ai/AIUsageManager";
import { ProjectManager } from "@/lib/projects/ProjectManager";

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

    const usage = await AIUsageManager.getUsageLog(slug);

    return NextResponse.json({
      success: true,
      usage: {
        projectSlug: usage.projectSlug,
        records: usage.records,
        createdAt: usage.createdAt,
        updatedAt: usage.updatedAt,
      },
    });
  } catch (error) {
    console.error("[AIUsage API] Usage read failed:", error);

    return NextResponse.json(
      {
        success: false,
        error: "AI usage records could not be read.",
      },
      { status: 500 },
    );
  }
}

function isSafeSlug(value: string) {
  return /^[a-zA-Z0-9-_]+$/.test(value);
}
