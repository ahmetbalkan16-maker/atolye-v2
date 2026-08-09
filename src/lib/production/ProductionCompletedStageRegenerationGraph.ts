import {
  pipelineRecoveryStageOrder,
  pipelineStageDependencies,
} from "@/lib/pipeline/PipelineRecoveryPlanner";
import type { PipelineRecoveryStageKey } from "@/types/pipelineRecovery";

export function getProductionRegenerationClosure(fromStage: PipelineRecoveryStageKey) {
  const affected = new Set<PipelineRecoveryStageKey>([fromStage]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const stage of pipelineRecoveryStageOrder) {
      if (affected.has(stage)) continue;
      if (pipelineStageDependencies[stage].some((dependency) => affected.has(dependency))) {
        affected.add(stage);
        changed = true;
      }
    }
  }
  const effectiveSequence = pipelineRecoveryStageOrder.filter((stage) => affected.has(stage));
  return Object.freeze({
    preservedStages: Object.freeze(
      pipelineRecoveryStageOrder.filter((stage) => !affected.has(stage)),
    ),
    regeneratedStages: Object.freeze([fromStage] as const),
    invalidatedStages: Object.freeze(
      effectiveSequence.filter((stage) => stage !== fromStage),
    ),
    effectiveSequence: Object.freeze(effectiveSequence),
  });
}
