import { NextResponse } from "next/server";
import { ProjectManager } from "@/lib/projects/ProjectManager";
import { ThumbnailEngine } from "@/lib/thumbnail/ThumbnailEngine";
import { isCompatibleVideoData } from "@/lib/video/VideoDataValidation";
import type { AssemblyPlanData } from "@/types/assembly";
import type { AudioData } from "@/types/audio";
import type { Project } from "@/types/project";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const projectSlug = normalizeSlug(body.projectSlug ?? body.slug);
    const directAssembly = isAssemblyPlanData(body.assembly)
      ? body.assembly
      : null;
    const directVideo = isCompatibleVideoData(body.video) ? body.video : null;
    const directAudio = isAudioData(body.audio) ? body.audio : null;

    if (!projectSlug && !directAssembly && !directVideo && !directAudio) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Thumbnail plani icin projectSlug veya assembly/video/audio verisi gonderilmedi.",
        },
        { status: 400 },
      );
    }

    const projectData = projectSlug
      ? await loadProjectThumbnailSources(projectSlug)
      : {
          project: null,
          assembly: directAssembly,
          video: directVideo,
          audio: directAudio,
        };
    const assembly = directAssembly ?? projectData.assembly;
    const video = directVideo ?? projectData.video;
    const audio = directAudio ?? projectData.audio;
    const engine = new ThumbnailEngine();
    const thumbnail = await engine.generateThumbnailPlan({
      projectId: projectData.project?.id,
      projectSlug: projectSlug ?? undefined,
      title:
        projectData.project?.title ||
        assembly?.title ||
        (typeof body.title === "string" ? body.title : undefined),
      assembly,
      video,
      audio,
    });

    if (projectSlug) {
      await ProjectManager.saveThumbnail(projectSlug, thumbnail);
    }

    return NextResponse.json({
      success: true,
      thumbnail,
    });
  } catch (error) {
    console.error("[Thumbnails API] Thumbnail Engine failed:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Thumbnail Engine calistirilamadi.",
      },
      { status: 500 },
    );
  }
}

async function loadProjectThumbnailSources(projectSlug: string) {
  const [project, assembly, video, audio] = await Promise.all([
    ProjectManager.getProject(projectSlug) as Promise<Project | null>,
    ProjectManager.getAssembly(projectSlug) as Promise<AssemblyPlanData | null>,
    ProjectManager.getVideo(projectSlug),
    ProjectManager.getAudio(projectSlug) as Promise<AudioData | null>,
  ]);

  return {
    project,
    assembly,
    video: isCompatibleVideoData(video) ? video : null,
    audio,
  };
}

function normalizeSlug(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  return value.trim();
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

function isAudioData(value: unknown): value is AudioData {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    Array.isArray((value as AudioData).sections) &&
    typeof (value as AudioData).createdAt === "string"
  );
}
