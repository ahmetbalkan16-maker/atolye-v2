import { pipelineRecoveryStageOrder } from "@/lib/pipeline/PipelineRecoveryPlanner";
import { stableProductionId } from "./ProductionDeterminism";
import type { ProductionDependencyGraph, ProductionPlan, ProductionPlanStep, ProductionRecommendedAction } from "@/types/productionIntelligence";
import type { ProductionSnapshot } from "@/types/productionSnapshot";

export class ProductionPlanner {
  static create(snapshot: ProductionSnapshot, actions: readonly ProductionRecommendedAction[], graph: ProductionDependencyGraph): ProductionPlan {
    const snapshotFingerprint = stableProductionId("snapshot", snapshot);
    const steps: ProductionPlanStep[] = actions.map((action) => {
      const node = action.affectedStage ? graph.nodes.find((item) => item.stage === action.affectedStage) : undefined;
      const blocked = node?.status === "blocked" && !graph.rootCauseStages.includes(node.stage);
      return { id: stableProductionId("step", action.id), actionId: action.id, actionType: action.actionType, ...(action.affectedStage ? { stage: action.affectedStage } : {}), status: blocked ? "blocked" as const : "ready" as const, prerequisites: node?.upstreamDependencies ?? [], unlocks: node?.downstreamUnlocks ?? [], rootCauseFindingRefs: node?.rootCauseFindingRefs ?? [action.findingRef], selectionReasons: [blocked ? "upstream-prerequisite-blocked" : "executable", `downstream-unlocks:${node?.downstreamUnlocks.length ?? 0}`, `canonical-rank:${action.affectedStage ? pipelineRecoveryStageOrder.indexOf(action.affectedStage) : -1}`], confirmationRequired: action.confirmationRequired };
    }).sort((a,b) => Number(b.status === "ready") - Number(a.status === "ready") || b.unlocks.length - a.unlocks.length || stageRank(a.stage) - stageRank(b.stage) || a.id.localeCompare(b.id));
    const recommended = steps.find((step) => step.status === "ready");
    const status = snapshot.pipeline.isTerminal && snapshot.stages.every((stage) => stage.effectiveStatus === "completed") ? "complete" : recommended ? "ready" : steps.length ? "blocked" : "unknown";
    return { id: stableProductionId("plan", { snapshotFingerprint, steps }), snapshotFingerprint, status, recommendedStepId: recommended?.id, steps };
  }
}
function stageRank(stage?: ProductionPlanStep["stage"]) { return stage ? pipelineRecoveryStageOrder.indexOf(stage) : -1; }
