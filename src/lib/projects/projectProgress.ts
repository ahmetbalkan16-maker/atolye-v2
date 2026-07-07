export type ProductionStepKey =
  | "research"
  | "script"
  | "scenes"
  | "visuals"
  | "audio"
  | "thumbnail"
  | "seo"
  | "assembly";

export type ProductionStepState = {
  key: ProductionStepKey;
  label: string;
  completed: boolean;
  updatedAt?: string;
};

export type ProductionProgressInput = Record<ProductionStepKey, boolean>;

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
  return (Object.keys(stepLabels) as ProductionStepKey[]).map((key) => ({
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
  const total = Object.keys(stepLabels).length;

  return Math.round((completed / total) * 100);
}
