import { NextResponse } from "next/server";
import { ProjectManager } from "@/lib/project/ProjectManager";

export async function GET() {
  try {
    const projects = ProjectManager.listProjects();

    return NextResponse.json({
      success: true,
      projects,
    });
  } catch (err) {
    console.error("PROJECTS API ERROR:", err);

    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Projeler alınamadı.",
      },
      { status: 500 }
    );
  }
}