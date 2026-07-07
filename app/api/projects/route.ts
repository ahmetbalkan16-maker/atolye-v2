import { NextResponse } from "next/server";
import { ProjectReader } from "@/lib/projects/ProjectReader";

export async function GET() {
  const projects = await ProjectReader.listProjects();

  return NextResponse.json({
    success: true,
    projects,
  });
}