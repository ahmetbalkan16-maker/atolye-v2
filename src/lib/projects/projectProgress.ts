export type ProductionStepKey = "research" | "script" | "scenes" | "visuals";

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
  return completed * 25;
}
