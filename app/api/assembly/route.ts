import { NextResponse } from "next/server";
import { AssemblyManager } from "@/lib/assembly/AssemblyManager";
import { ProjectManager } from "@/lib/projects/ProjectManager";
import type { AnimationData } from "@/types/animation";
import type { AudioData } from "@/types/audio";
import type { Project } from "@/types/project";
import type { ResearchData } from "@/types/research";
import type { SceneData } from "@/types/scene";
import type { ScriptData } from "@/types/script";
import type { VideoData } from "@/types/video";
import type { VisualData } from "@/types/visual";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { slug } = body;

    if (typeof slug !== "string" || !slug.trim()) {
      return NextResponse.json(
        {
          success: false,
          error: "Proje slug degeri gonderilmedi.",
        },
        { status: 400 },
      );
    }

    const normalizedSlug = slug.trim();
    const [
      project,
      _research,
      script,
      scenes,
      visuals,
      animation,
      video,
      audio,
    ] = await Promise.all([
      ProjectManager.getProject(normalizedSlug) as Promise<Project | null>,
      ProjectManager.getResearch(normalizedSlug) as Promise<ResearchData | null>,
      ProjectManager.getScript(normalizedSlug) as Promise<ScriptData | null>,
      ProjectManager.getScenes(normalizedSlug) as Promise<SceneData | null>,
      ProjectManager.getVisuals(normalizedSlug) as Promise<VisualData | null>,
      ProjectManager.getAnimation(normalizedSlug) as Promise<AnimationData | null>,
      ProjectManager.getVideo(normalizedSlug) as Promise<VideoData | null>,
      ProjectManager.getAudio(normalizedSlug) as Promise<AudioData | null>,
    ]);

    if (!script) {
      return NextResponse.json(
        {
          success: false,
          error: "Senaryo verisi bulunamadi.",
        },
        { status: 400 },
      );
    }

    if (!scenes) {
      return NextResponse.json(
        {
          success: false,
          error: "Sahne verisi bulunamadi.",
        },
        { status: 400 },
      );
    }

    if (!visuals) {
      return NextResponse.json(
        {
          success: false,
          error: "Gorsel plan verisi bulunamadi.",
        },
        { status: 400 },
      );
    }

    if (!audio) {
      return NextResponse.json(
        {
          success: false,
          error: "Seslendirme plan verisi bulunamadi.",
        },
        { status: 400 },
      );
    }

    if (!video) {
      return NextResponse.json(
        {
          success: false,
          error: "Video verisi bulunamadi.",
        },
        { status: 400 },
      );
    }

    const assembly = await AssemblyManager.generateAssemblyPlan(
      script,
      scenes,
      visuals,
      audio,
      {
        project,
        animation,
        video,
      },
    );

    await ProjectManager.saveAssembly(normalizedSlug, assembly);

    return NextResponse.json({
      success: true,
      assembly,
    });
  } catch (error) {
    console.error("[Assembly API] Assembly Engine failed:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Assembly Engine calistirilamadi.",
      },
      { status: 500 },
    );
  }
}
