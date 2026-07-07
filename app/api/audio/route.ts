import { NextResponse } from "next/server";
import { AudioManager } from "@/lib/audio/AudioManager";
import { ProjectManager } from "@/lib/projects/ProjectManager";
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

    const audio = await AudioManager.generateAudioData(scriptData);

    if (typeof slug === "string" && slug.trim()) {
      await ProjectManager.saveAudio(slug.trim(), audio);
    }

    return NextResponse.json({
      success: true,
      audio,
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
