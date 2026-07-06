import { NextResponse } from "next/server";
import { ProjectManager } from "@/lib/projects/ProjectManager";

export async function GET() {
  try {
    const projects = await ProjectManager.listProjects();

    return NextResponse.json({
      success: true,
      projects,
    });
  } catch (error) {
    console.error("Projects API error:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Projeler alınamadı.",
      },
      { status: 500 }
    );
  }
}