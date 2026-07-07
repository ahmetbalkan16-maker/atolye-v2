import { ProjectManager } from "./ProjectManager";
import type {
  PackageStatus,
  ProductionStepKey,
  ProjectManifest,
} from "@/types/project";

export type ProductionStepState = {
  key: ProductionStepKey;
  label: string;
  completed: boolean;
  updatedAt?: string;
};

export type ProductionProgressInput = Record<ProductionStepKey, boolean>;

export interface ProjectStageProgress {
  key: ProductionStepKey;
  label: string;
  status: PackageStatus;
  completed: boolean;
  fileName: string;
  updatedAt?: string;
  error?: string;
}

export interface ProjectProgress {
  slug: string;
  manifest: ProjectManifest;
  stages: ProjectStageProgress[];
  completedStages: ProductionStepKey[];
  currentStage: ProductionStepKey | null;
  nextStage: ProductionStepKey | null;
  completionPercentage: number;
  updatedAt: string;
}

const productionStageOrder: readonly ProductionStepKey[] = [
  "research",
  "script",
  "scenes",
  "visuals",
  "audio",
  "thumbnail",
  "seo",
  "assembly",
];

const stepLabels: Record<ProductionStepKey, string> = {
  research: "Araştırma",
  script: "Senaryo",
  scenes: "Sahneler",
  visuals: "Görseller",
  audio: "Ses",
  thumbnail: "Thumbnail",
  seo: "SEO",
  assembly: "Kurgu",
};

export function createProductionSteps(
  input: ProductionProgressInput,
  updatedAt?: string,
): ProductionStepState[] {
  return productionStageOrder.map((key) => ({
    key,
    label: stepLabels[key],
    completed: input[key],
    updatedAt,
  }));
}

export function calculateProductionProgress(
  input: ProductionProgressInput,
): number {
  const completed = Object.values(input).filter(Boolean).length;

  return calculateCompletionPercentage(completed);
}

export async function getProjectProgress(
  projectSlug: string,
): Promise<ProjectProgress | null> {
  const manifest = await ProjectManager.ensureManifest(projectSlug);

  if (!manifest) {
    return null;
  }

  const stages = getStageProgress(manifest);
  const completedStages = getCompletedStagesFromProgress(stages);
  const currentStage = getCurrentStageFromProgress(stages);
  const nextStage = getNextStageFromProgress(stages, currentStage);

  return {
    slug: manifest.slug,
    manifest,
    stages,
    completedStages,
    currentStage,
    nextStage,
    completionPercentage: calculateCompletionPercentage(completedStages.length),
    updatedAt: manifest.updatedAt,
  };
}

export async function getCompletedStages(
  projectSlug: string,
): Promise<ProductionStepKey[]> {
  const progress = await getProjectProgress(projectSlug);

  return progress?.completedStages ?? [];
}

export async function getCurrentStage(
  projectSlug: string,
): Promise<ProductionStepKey | null> {
  const progress = await getProjectProgress(projectSlug);

  return progress?.currentStage ?? null;
}

export async function getNextStage(
  projectSlug: string,
): Promise<ProductionStepKey | null> {
  const progress = await getProjectProgress(projectSlug);

  return progress?.nextStage ?? null;
}

export async function getCompletionPercentage(
  projectSlug: string,
): Promise<number> {
  const progress = await getProjectProgress(projectSlug);

  return progress?.completionPercentage ?? 0;
}

function getStageProgress(manifest: ProjectManifest): ProjectStageProgress[] {
  return productionStageOrder.map((key) => {
    const packageManifest = manifest.packages[key];

    return {
      key,
      label: stepLabels[key],
      status: packageManifest.status,
      completed: packageManifest.status === "completed",
      fileName: packageManifest.fileName,
      updatedAt: packageManifest.updatedAt,
      error: packageManifest.error,
    };
  });
}

function getCompletedStagesFromProgress(
  stages: ProjectStageProgress[],
): ProductionStepKey[] {
  return stages
    .filter((stage) => stage.completed)
    .map((stage) => stage.key);
}

function getCurrentStageFromProgress(
  stages: ProjectStageProgress[],
): ProductionStepKey | null {
  const runningStage = stages.find((stage) => stage.status === "running");

  if (runningStage) {
    return runningStage.key;
  }

  return stages.find((stage) => !stage.completed)?.key ?? null;
}

function getNextStageFromProgress(
  stages: ProjectStageProgress[],
  currentStage: ProductionStepKey | null,
): ProductionStepKey | null {
  if (!currentStage) {
    return null;
  }

  const currentIndex = stages.findIndex((stage) => stage.key === currentStage);

  if (currentIndex === -1) {
    return null;
  }

  return (
    stages.slice(currentIndex + 1).find((stage) => !stage.completed)?.key ?? null
  );
}

function calculateCompletionPercentage(completedStageCount: number): number {
  return Math.round((completedStageCount / productionStageOrder.length) * 100);
}