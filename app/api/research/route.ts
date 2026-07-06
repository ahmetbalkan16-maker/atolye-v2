import { NextResponse } from "next/server";
import { researchStep } from "@/lib/ai/steps/researchStep";
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

    // 1. RESEARCH STEP
    const research = await researchStep(cleanTopic);

    // 2. PROJECT CREATE
    const project = await ProjectManager.createProject(cleanTopic);

    // 3. SAVE RESEARCH
    await ProjectManager.saveResearch(project.slug, research);

    return NextResponse.json({
      success: true,
      project,
      research,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: "Pipeline error" },
      { status: 500 }
    );
  }
}