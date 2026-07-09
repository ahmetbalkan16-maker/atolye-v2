import { NextResponse } from "next/server";
import { ProjectManager } from "@/lib/projects/ProjectManager";
import { YouTubeEngine } from "@/lib/youtube/YouTubeEngine";
import type { AssemblyPlanData } from "@/types/assembly";
import type { AudioData } from "@/types/audio";
import type { Project } from "@/types/project";
import type { ThumbnailData } from "@/types/thumbnail";
import type { VideoData } from "@/types/video";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const projectSlug = normalizeSlug(body.projectSlug ?? body.slug);
    const directVideo = isVideoData(body.video) ? body.video : null;
    const directAudio = isAudioData(body.audio) ? body.audio : null;
    const directAssembly = isAssemblyPlanData(body.assembly)
      ? body.assembly
      : null;
    const directThumbnail = isThumbnailData(body.thumbnail)
      ? body.thumbnail
      : null;

    if (
      !projectSlug &&
      !directVideo &&
      !directAudio &&
      !directAssembly &&
      !directThumbnail
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "YouTube paketi icin slug veya video/audio/assembly/thumbnail verisi gonderilmedi.",
        },
        { status: 400 },
      );
    }

    const projectData = projectSlug
      ? await loadProjectYouTubeSources(projectSlug)
      : {
          project: null,
          video: directVideo,
          audio: directAudio,
          assembly: directAssembly,
          thumbnail: directThumbnail,
        };
    const video = directVideo ?? projectData.video;
    const audio = directAudio ?? projectData.audio;
    const assembly = directAssembly ?? projectData.assembly;
    const thumbnail = directThumbnail ?? projectData.thumbnail;
    const engine = new YouTubeEngine();
    const youtube = await engine.generatePublishingPackage({
      projectId: projectData.project?.id,
      projectSlug: projectSlug ?? undefined,
      title:
        projectData.project?.title ||
        assembly?.title ||
        (typeof body.title === "string" ? body.title : undefined),
      video,
      audio,
      assembly,
      thumbnail,
    });

    if (projectSlug) {
      await ProjectManager.saveYouTube(projectSlug, youtube);
    }

    return NextResponse.json({
      success: true,
      youtube,
    });
  } catch (error) {
    console.error("[YouTube API] YouTube Engine failed:", error);

    return NextResponse.json(
      {
        success: false,
        error: "YouTube Engine calistirilamadi.",
      },
      { status: 500 },
    );
  }
}

async function loadProjectYouTubeSources(projectSlug: string) {
  const [project, video, audio, assembly, thumbnail] = await Promise.all([
    ProjectManager.getProject(projectSlug) as Promise<Project | null>,
    ProjectManager.getVideo(projectSlug) as Promise<VideoData | null>,
    ProjectManager.getAudio(projectSlug) as Promise<AudioData | null>,
    ProjectManager.getAssembly(projectSlug) as Promise<AssemblyPlanData | null>,
    ProjectManager.getThumbnail(projectSlug) as Promise<ThumbnailData | null>,
  ]);

  return {
    project,
    video,
    audio,
    assembly,
    thumbnail,
  };
}

function normalizeSlug(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  return value.trim();
}

function isVideoData(value: unknown): value is VideoData {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    Array.isArray((value as VideoData).scenes) &&
    typeof (value as VideoData).createdAt === "string"
  );
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
