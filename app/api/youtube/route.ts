import { NextResponse } from "next/server";
import { PipelineJobManager } from "@/lib/pipeline/PipelineJobManager";
import { ProjectManager } from "@/lib/projects/ProjectManager";
import { YouTubePackagePipeline } from "@/lib/youtube/YouTubePackagePipeline";
import { isYouTubePublishingPackage } from "@/lib/youtube/YouTubePackageValidation";
import { YouTubePublishPipeline } from "@/lib/youtube/publish/YouTubePublishPipeline";
import type { AssemblyPlanData } from "@/types/assembly";
import type { Project } from "@/types/project";
import type { SEOData } from "@/types/seo";
import type { ThumbnailData } from "@/types/thumbnail";
import type { YouTubePublishingPackage } from "@/types/youtube";

const SAFE_ERROR = "YouTube package could not be generated.";
const SAFE_PUBLISH_ERROR = "YouTube publish failed.";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return failure(400);
  }
  try {
    if (
      !body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).some((key) => key !== "projectSlug" && key !== "slug") ||
      (body.projectSlug !== undefined && body.slug !== undefined && body.projectSlug !== body.slug)
    ) return failure(400);
    const projectSlug = safeSlug(body.projectSlug ?? body.slug);
    if (!projectSlug) return failure(400);

    const result = await PipelineJobManager.withProjectLock(
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
          updatePackageStatus: false,
        });
        const publish = await YouTubePublishPipeline.publishStoredPackage({ projectSlug });
        await ProjectManager.markYouTubePublished(projectSlug);
        return { youtube: generated, publish };
      },
    );

    return response({ success: true, ...result }, 200);
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
  return response(
    { success: false, error: status === 400 ? SAFE_ERROR : SAFE_PUBLISH_ERROR },
    status,
  );
}

function response(body: unknown, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
