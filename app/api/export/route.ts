import { NextResponse } from "next/server";
import { ExportEngine } from "@/lib/export/ExportEngine";
import { ProjectManager } from "@/lib/projects/ProjectManager";
import { isCompatibleVideoData } from "@/lib/video/VideoDataValidation";
import type { AssemblyPlanData } from "@/types/assembly";
import type { AudioData } from "@/types/audio";
import type { ExportFormat } from "@/types/export";
import type { Project } from "@/types/project";
import type { SEOData } from "@/types/seo";
import type { ThumbnailData } from "@/types/thumbnail";
import type { YouTubePublishingPackage } from "@/types/youtube";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const projectSlug = normalizeSlug(body.projectSlug ?? body.slug);
    const directVideo = isCompatibleVideoData(body.video) ? body.video : null;
    const directAudio = isAudioData(body.audio) ? body.audio : null;
    const directAssembly = isAssemblyPlanData(body.assembly)
      ? body.assembly
      : null;
    const directThumbnail = isThumbnailData(body.thumbnail)
      ? body.thumbnail
      : null;
    const directYouTube = isYouTubePublishingPackage(body.youtube)
      ? body.youtube
      : null;
    const directSEO = isSEOData(body.seo) ? body.seo : null;

    if (
      !projectSlug &&
      !directVideo &&
      !directAudio &&
      !directAssembly &&
      !directThumbnail &&
      !directYouTube &&
      !directSEO
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Export paketi icin slug veya video/audio/assembly/thumbnail/youtube/seo verisi gonderilmedi.",
        },
        { status: 400 },
      );
    }

    const projectData = projectSlug
      ? await loadProjectExportSources(projectSlug)
      : {
          project: null,
          video: directVideo,
          audio: directAudio,
          assembly: directAssembly,
          thumbnail: directThumbnail,
          youtube: directYouTube,
          seo: directSEO,
        };
    const video = directVideo ?? projectData.video;
    const audio = directAudio ?? projectData.audio;
    const assembly = directAssembly ?? projectData.assembly;
    const thumbnail = directThumbnail ?? projectData.thumbnail;
    const youtube = directYouTube ?? projectData.youtube;
    const seo = directSEO ?? projectData.seo;
    const engine = new ExportEngine();
    const exportPackage = await engine.generateExportPackage({
      projectId: projectData.project?.id,
      projectSlug: projectSlug ?? undefined,
      title:
        projectData.project?.title ||
        assembly?.title ||
        youtube?.metadata.title ||
        (typeof body.title === "string" ? body.title : undefined),
      format: normalizeFormat(body.format),
      project: projectData.project,
      video,
      audio,
      assembly,
      thumbnail,
      youtube,
      seo,
    });

    if (projectSlug) {
      await ProjectManager.saveExport(projectSlug, exportPackage);
    }

    return NextResponse.json({
      success: true,
      export: exportPackage,
    });
  } catch (error) {
    console.error("[Export API] Export Engine failed:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Export Engine calistirilamadi.",
      },
      { status: 500 },
    );
  }
}

async function loadProjectExportSources(projectSlug: string) {
  const [project, video, audio, assembly, thumbnail, youtube, seo] =
    await Promise.all([
      ProjectManager.getProject(projectSlug) as Promise<Project | null>,
      ProjectManager.getVideo(projectSlug),
      ProjectManager.getAudio(projectSlug) as Promise<AudioData | null>,
      ProjectManager.getAssembly(projectSlug) as Promise<AssemblyPlanData | null>,
      ProjectManager.getThumbnail(projectSlug) as Promise<ThumbnailData | null>,
      ProjectManager.getYouTube(
        projectSlug,
      ) as Promise<YouTubePublishingPackage | null>,
      ProjectManager.getSEO(projectSlug) as Promise<SEOData | null>,
    ]);

  return {
    project,
    video: isCompatibleVideoData(video) ? video : null,
    audio,
    assembly,
    thumbnail,
    youtube,
    seo,
  };
}

function normalizeSlug(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  return value.trim();
}

function normalizeFormat(value: unknown): ExportFormat | undefined {
  if (value === "json" || value === "zip" || value === "folder") {
    return value;
  }

  return undefined;
}

function isAudioData(value: unknown): value is AudioData {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    Array.isArray((value as AudioData).sections) &&
    typeof (value as AudioData).createdAt === "string"
  );
}

function isAssemblyPlanData(value: unknown): value is AssemblyPlanData {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    Array.isArray((value as AssemblyPlanData).scenes) &&
    typeof (value as AssemblyPlanData).totalDuration === "string" &&
    typeof (value as AssemblyPlanData).createdAt === "string"
  );
}

function isThumbnailData(value: unknown): value is ThumbnailData {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    Array.isArray((value as ThumbnailData).variants) &&
    typeof (value as ThumbnailData).createdAt === "string"
  );
}

function isYouTubePublishingPackage(
  value: unknown,
): value is YouTubePublishingPackage {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as YouTubePublishingPackage).createdAt === "string" &&
    Boolean((value as YouTubePublishingPackage).metadata) &&
    Boolean((value as YouTubePublishingPackage).checklist)
  );
}

function isSEOData(value: unknown): value is SEOData {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    Array.isArray((value as SEOData).tags) &&
    typeof (value as SEOData).description === "string" &&
    typeof (value as SEOData).createdAt === "string"
  );
}
