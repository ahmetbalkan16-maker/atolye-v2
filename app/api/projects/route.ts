import { NextResponse } from "next/server";
import { ProjectReader } from "@/lib/projects/ProjectReader";
import { getProjectProgress } from "@/lib/projects/projectProgress";
import type { ProductionStepKey, Project } from "@/types/project";

type ProjectProgressSummary = {
  currentStage: ProjectProgressStageSummary | null;
  nextStage: ProjectProgressStageSummary | null;
  completionPercentage: number;
  completedStagesCount: number;
  totalStagesCount: number;
};

type ProjectProgressStageSummary = {
  key: ProductionStepKey;
  label: string;
};

type ProjectListItem = Project & {
  progress: ProjectProgressSummary | null;
};

export async function GET() {
  const projects = (await ProjectReader.listProjects()) as Project[];

  const projectsWithProgress: ProjectListItem[] = await Promise.all(
    projects.map(async (project) => ({
      ...project,
      progress: await getProgressSummary(project.slug),
    })),
  );

  return NextResponse.json({
    success: true,
    projects: projectsWithProgress,
  });
}

async function getProgressSummary(
  slug: string,
): Promise<ProjectProgressSummary | null> {
  const progress = await getProjectProgress(slug);

  if (!progress) {
    return null;
  }

  return {
    currentStage: progress.currentStage
      ? getStageSummary(progress.stages, progress.currentStage)
      : null,
    nextStage: progress.nextStage
      ? getStageSummary(progress.stages, progress.nextStage)
      : null,
    completionPercentage: progress.completionPercentage,
    completedStagesCount: progress.completedStages.length,
    totalStagesCount: progress.stages.length,
  };
}

function getStageSummary(
  stages: ProjectProgressStageSummary[],
  key: ProductionStepKey,
): ProjectProgressStageSummary | null {
  return stages.find((stage) => stage.key === key) ?? null;
}