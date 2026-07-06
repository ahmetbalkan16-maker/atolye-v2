import { NextResponse } from "next/server";
import { researchStep } from "@/lib/ai/steps/researchStep";
import { saveProject } from "@/lib/project/saveProject";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const topic = body?.topic;

    if (!topic || typeof topic !== "string" || topic.trim() === "") {
      return NextResponse.json(
        {
          success: false,
          error: "Konu boş olamaz.",
        },
        { status: 400 }
      );
    }

    const research = await researchStep(topic.trim());

    const project = saveProject(topic.trim(), research);

    return NextResponse.json({
      success: true,
      message: "Araştırma tamamlandı ve proje kaydedildi.",
      project,
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