import { NextResponse } from "next/server";
import { AIManager } from "@/lib/ai/AIManager";
import { ProjectManager } from "@/lib/projects/ProjectManager";

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
    console.error("[Research API] Pipeline error:", error);

    return NextResponse.json(
      { success: false, error: "Pipeline error" },
      { status: 500 }
    );
  }
}
