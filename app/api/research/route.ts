import { NextResponse } from "next/server";
import { runAIResearch } from "@/src/lib/ai/router";
import { saveProject } from "@/src/lib/projects/saveProject";

export async function POST(req: Request) {
  try {
    const { topic } = await req.json();

    if (!topic || topic.trim() === "") {
      return NextResponse.json(
        {
          success: false,
          error: "Konu boş olamaz.",
        },
        { status: 400 }
      );
    }

    const result = await runAIResearch(topic);

    const savedProject = saveProject(topic, result);

    return NextResponse.json({
      success: true,
      message: "Araştırma tamamlandı ve proje kaydedildi.",
      project: savedProject,
    });
  } catch (error) {
    console.error("Research API error:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Araştırma sırasında bir hata oluştu.",
      },
      { status: 500 }
    );
  }
}