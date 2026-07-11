import { pipelineRecoveryStageOrder, pipelineStageDependencies } from "@/lib/pipeline/PipelineRecoveryPlanner";
import { productionFindingRef, type ProductionDependencyGraph as Graph, type ProductionRecommendedAction } from "@/types/productionIntelligence";
import type { ProductionHealthResult } from "@/types/productionHealth";
import type { ProductionSnapshot } from "@/types/productionSnapshot";
import type { ProductionStepKey } from "@/types/project";

export class ProductionDependencyGraphBuilder {
  static build(snapshot: ProductionSnapshot, health: ProductionHealthResult, actions: readonly ProductionRecommendedAction[]): Graph {
    const edges = pipelineRecoveryStageOrder.flatMap((to) => pipelineStageDependencies[to].map((from) => ({ from, to })));
    const downstream = (stage: ProductionStepKey) => pipelineRecoveryStageOrder.filter((candidate) => reaches(stage, candidate));
    const nodes = pipelineRecoveryStageOrder.map((stage) => {
      const state = snapshot.stages.find((item) => item.stage === stage);
      const upstreamDependencies = [...pipelineStageDependencies[stage]];
      const blocked = state?.effectiveStatus === "failed" || state?.effectiveStatus === "cancelled" || upstreamDependencies.some((dependency) => snapshot.stages.find((item) => item.stage === dependency)?.effectiveStatus !== "completed");
      return { stage, status: state?.effectiveStatus === "completed" ? "complete" as const : blocked ? "blocked" as const : state ? "ready" as const : "unknown" as const, upstreamDependencies, downstreamUnlocks: downstream(stage), rootCauseFindingRefs: health.findings.filter((finding) => finding.stage === stage).map(productionFindingRef).sort() };
    });
    const blockedStages = nodes.filter((node) => node.status === "blocked").map((node) => node.stage);
    const rootCauseStages = nodes.filter((node) => blockedStages.includes(node.stage) && !node.upstreamDependencies.some((stage) => blockedStages.includes(stage))).map((node) => node.stage);
    void actions;
    return { nodes, edges, blockedStages, rootCauseStages, cycles: detectCycles(edges) };
  }
}
function reaches(from: ProductionStepKey, to: ProductionStepKey, seen = new Set<ProductionStepKey>()): boolean { if (seen.has(to)) return false; seen.add(to); const deps = pipelineStageDependencies[to]; return deps.includes(from) || deps.some((dep) => reaches(from, dep, seen)); }
function detectCycles(edges: { from: ProductionStepKey; to: ProductionStepKey }[]) { const cycles: ProductionStepKey[][] = []; const visit = (node: ProductionStepKey, path: ProductionStepKey[]) => { const index = path.indexOf(node); if (index >= 0) { cycles.push([...path.slice(index), node]); return; } for (const edge of edges.filter((item) => item.from === node)) visit(edge.to, [...path, node]); }; for (const stage of pipelineRecoveryStageOrder) visit(stage, []); return cycles.sort((a,b)=>a.join("|").localeCompare(b.join("|"))); }
