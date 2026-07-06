import { NextResponse } from "next/server";
import { ProjectManager } from "@/lib/projects/ProjectManager";
import { sceneStep } from "@/lib/ai/steps/sceneStep";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;

    const research = await ProjectManager.getResearch(slug);
    const script = await ProjectManager.getScript(slug);

    if (!research) {
      return NextResponse.json(
        {
          success: false,
          error: "Research verisi bulunamadı.",
        },
        { status: 404 }
      );
    }

    if (!script) {
      return NextResponse.json(
        {
          success: false,
          error: "Script verisi bulunamadı.",
        },
        { status: 404 }
      );
    }

    const scenes = await sceneStep(slug, research, script);

    await ProjectManager.saveScenes(slug, scenes);

    return NextResponse.json({
      success: true,
      message: "Sahneler başarıyla oluşturuldu.",
      scenes,
    });
  } catch (error) {
    console.error("Scene API error:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Sahneler oluşturulurken bir hata oluştu.",
      },
      { status: 500 }
    );
  }
}