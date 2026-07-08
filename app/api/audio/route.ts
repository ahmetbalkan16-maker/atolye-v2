import { NextResponse } from "next/server";
import { AudioManager } from "@/lib/audio/AudioManager";
import { AudioPipeline } from "@/lib/audio/AudioPipeline";
import { ProjectManager } from "@/lib/projects/ProjectManager";
import type { Project } from "@/types/project";
import type { ScriptData } from "@/types/script";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { slug, script } = body;

    const scriptData = await resolveScript(slug, script);

    if (!scriptData) {
      return NextResponse.json(
        {
          success: false,
          error: "Senaryo verisi bulunamadi.",
        },
        { status: 400 },
      );
    }

    const audioPlan = await AudioManager.generateAudioData(scriptData);

    if (typeof slug === "string" && slug.trim()) {
      const normalizedSlug = slug.trim();
      const project = (await ProjectManager.getProject(
        normalizedSlug,
      )) as Project | null;
      const { audio, projectAssets } = await AudioPipeline.generateAudio({
        projectId: project?.id ?? normalizedSlug,
        projectSlug: normalizedSlug,
        audio: audioPlan,
      });

      await ProjectManager.saveAudio(normalizedSlug, audio);

      return NextResponse.json({
        success: true,
        audio,
        assets: projectAssets.assets,
      });
    }

    return NextResponse.json({
      success: true,
      audio: audioPlan,
      assets: [],
    });
  } catch (error) {
    console.error("[Audio API] Audio Engine failed:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Audio Engine calistirilamadi.",
      },
      { status: 500 },
    );
  }
}

async function resolveScript(
  slug: unknown,
  script: unknown,
): Promise<ScriptData | null> {
  if (isScriptData(script)) {
    return script;
  }

  if (typeof slug === "string" && slug.trim()) {
    return ProjectManager.getScript(slug.trim()) as Promise<ScriptData | null>;
  }

  return null;
}

function isScriptData(value: unknown): value is ScriptData {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as ScriptData).title === "string" &&
    Array.isArray((value as ScriptData).chapters)
  );
}
