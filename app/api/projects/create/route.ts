import { NextResponse } from "next/server";
import { ProjectManager } from "@/lib/projects/ProjectManager";

export async function POST(req: Request) {
  try {
    const { title } = await req.json();

    if (!title || typeof title !== "string") {
      return NextResponse.json(
        { success: false, error: "Proje başlığı zorunlu." },
        { status: 400 }
      );
    }

    const project = await ProjectManager.createProject(title);

    return NextResponse.json({
      success: true,
      project,
    });
  } catch (err) {
    console.error("CREATE PROJECT API ERROR:", err);

    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Proje oluşturulamadı.",
      },
      { status: 500 }
    );
  }
}