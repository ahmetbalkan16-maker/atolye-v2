import { pipelineRecoveryStageOrder } from "@/lib/pipeline/PipelineRecoveryPlanner";
import { stableProductionId, stableProductionValue } from "./ProductionDeterminism";
import { productionFindingRef, type ProductionActionPriority, type ProductionActionType, type ProductionRecommendedAction } from "@/types/productionIntelligence";
import type { ProductionHealthFinding, ProductionHealthResult } from "@/types/productionHealth";

export class ProductionActionEngine {
  static recommend(health: ProductionHealthResult): ProductionRecommendedAction[] {
    const unique = new Map<string, ProductionRecommendedAction>();
    for (const finding of health.findings) {
      const action = toAction(finding);
      const identity = `${action.findingRef}|${action.actionType}|${action.affectedStage ?? ""}`;
      const existing = unique.get(identity);
      if (!existing || stableProductionValue(action) < stableProductionValue(existing)) {
        unique.set(identity, action);
      }
    }
    return [...unique.values()].sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || stageRank(a.affectedStage) - stageRank(b.affectedStage) || a.id.localeCompare(b.id));
  }
}

function toAction(finding: ProductionHealthFinding): ProductionRecommendedAction {
  const findingRef = productionFindingRef(finding);
  const actionType = actionTypeFor(finding);
  const priority: ProductionActionPriority = finding.severity === "critical" ? "critical" : finding.severity === "warning" ? "high" : "normal";
  return {
    id: stableProductionId("action", { findingRef, actionType, stage: finding.stage }),
    findingRef, actionType, ...(finding.stage ? { affectedStage: finding.stage } : {}),
    title: titleFor(actionType, finding.stage), reason: finding.message, priority,
    safety: "read-only-recommendation", confirmationRequired: actionType === "retry-stage" || actionType === "resume-stage",
  };
}
function actionTypeFor(finding: ProductionHealthFinding): ProductionActionType {
  if (finding.category === "source") return "inspect-source";
  if (finding.code === "failed_stage" || finding.code === "cancelled_stage") return "retry-stage";
  if (finding.category === "stage" && finding.stage) return "resume-stage";
  if (finding.category === "usage" || finding.category === "history") return "review-metric";
  return "reconcile-state";
}
function titleFor(type: ProductionActionType, stage?: string) { return `${type.replaceAll("-", " ")}${stage ? `: ${stage}` : ""}`; }
function priorityRank(value: ProductionActionPriority) { return value === "critical" ? 0 : value === "high" ? 1 : 2; }
function stageRank(stage?: ProductionRecommendedAction["affectedStage"]) { return stage ? pipelineRecoveryStageOrder.indexOf(stage) : -1; }
