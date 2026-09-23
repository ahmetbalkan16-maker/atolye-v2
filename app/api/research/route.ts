import { NextResponse } from "next/server";
import { AIManager } from "@/lib/ai/AIManager";
import { ProjectManager } from "@/lib/projects/ProjectManager";
import { ProjectAlreadyExistsError } from "@/lib/projects/ProjectWriter";

export async function POST(req: Request) {
  try {
    const { topic } = await req.json();

    if (!topic || typeof topic !== "string") {
      return NextResponse.json(
        { success: false, error: "Konu boş olamaz" },
        { status: 400 }
      );
    }

    const cleanTopic = topic.trim();

    // 0. A slug another project folder owns cannot be created: refuse before
    // paying for research.
    ProjectManager.assertProjectCreatable(cleanTopic);

    // 1. RESEARCH
    const research = await AIManager.runResearch(cleanTopic);

    // 2. PROJECT CREATE
    const project = await ProjectManager.createProject(cleanTopic);

    // 3. SAVE RESEARCH
    await ProjectManager.saveResearch(project.slug, research);

    return NextResponse.json({
      success: true,
      project,
      research,
    });
  } catch (error) {
    if (error instanceof ProjectAlreadyExistsError) {
      return NextResponse.json(
        { success: false, error: "Bu konu için zaten bir proje var.", code: error.code },
        { status: 409 }
      );
    }

    console.error("[Research API] Pipeline error:", error);

    return NextResponse.json(
      { success: false, error: "Pipeline error" },
      { status: 500 }
    );
  }
}
