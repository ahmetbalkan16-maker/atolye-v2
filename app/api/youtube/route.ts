import { NextResponse } from "next/server";
import { PipelineJobManager } from "@/lib/pipeline/PipelineJobManager";
import { ProjectManager } from "@/lib/projects/ProjectManager";
import { YouTubePackagePipeline } from "@/lib/youtube/YouTubePackagePipeline";
import { isYouTubePublishingPackage } from "@/lib/youtube/YouTubePackageValidation";
import type { AssemblyPlanData } from "@/types/assembly";
import type { Project } from "@/types/project";
import type { SEOData } from "@/types/seo";
import type { ThumbnailData } from "@/types/thumbnail";
import type { YouTubePublishingPackage } from "@/types/youtube";

const SAFE_ERROR = "YouTube package could not be generated.";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const projectSlug = safeSlug(body.projectSlug ?? body.slug);
    if (!projectSlug) return failure(400);

    const youtube = await PipelineJobManager.withProjectLock(
      projectSlug,
      async () => {
        const [project, assembly, thumbnail, seo, previous] = await Promise.all([
          ProjectManager.getProject(projectSlug) as Promise<Project | null>,
          ProjectManager.getAssembly(projectSlug) as Promise<AssemblyPlanData | null>,
          ProjectManager.getThumbnail(projectSlug) as Promise<ThumbnailData | null>,
          ProjectManager.getSEO(projectSlug) as Promise<SEOData | null>,
          ProjectManager.getYouTube(projectSlug) as Promise<YouTubePublishingPackage | null>,
        ]);
        if (!project || !assembly || !thumbnail || !seo) {
          throw new Error(SAFE_ERROR);
        }
        const generated = await YouTubePackagePipeline.generatePackage({
          project,
          assembly,
          thumbnail,
          seo,
        });
        await ProjectManager.saveYouTube(projectSlug, generated, {
          reuseExisting:
            isYouTubePublishingPackage(previous) &&
            JSON.stringify(previous) === JSON.stringify(generated),
        });
        return generated;
      },
    );

    return NextResponse.json({ success: true, youtube });
  } catch {
    return failure(500);
  }
}

function safeSlug(value: unknown) {
  return typeof value === "string" && /^[a-zA-Z0-9-_]+$/.test(value)
    ? value
    : null;
}

function failure(status: number) {
  return NextResponse.json(
    { success: false, error: SAFE_ERROR },
    { status },
  );
}
