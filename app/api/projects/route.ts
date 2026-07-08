import { NextResponse } from "next/server";
import { ProjectReader } from "@/lib/projects/ProjectReader";
import {
  createProgressSummary,
  getProjectProgress,
} from "@/lib/projects/projectProgress";
import type { ProductionStepKey, Project } from "@/types/project";

type ProjectProgressSummary = {
  currentStage: ProjectProgressStageSummary | null;
  nextStage: ProjectProgressStageSummary | null;
  completionPercentage: number;
  completedStagesCount: number;
  totalStagesCount: number;
  completedCount: number;
  totalStages: number;
  statusDescription: string;
  nextTaskSuggestion: string;
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

  const summary = createProgressSummary(progress.manifest);

  return {
    currentStage: summary.currentStage
      ? getStageSummary(progress.stages, summary.currentStage)
      : null,
    nextStage: summary.nextStage
      ? getStageSummary(progress.stages, summary.nextStage)
      : null,
    completionPercentage: summary.completionPercentage,
    completedStagesCount: summary.completedCount,
    totalStagesCount: summary.totalStages,
    completedCount: summary.completedCount,
    totalStages: summary.totalStages,
    statusDescription: summary.statusDescription,
    nextTaskSuggestion: summary.nextTaskSuggestion,
  };
}

function getStageSummary(
  stages: ProjectProgressStageSummary[],
  key: ProductionStepKey,
): ProjectProgressStageSummary | null {
  return stages.find((stage) => stage.key === key) ?? null;
}
