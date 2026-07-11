import { ProductionActionEngine } from "./ProductionActionEngine";
import { ProductionDependencyGraphBuilder } from "./ProductionDependencyGraph";
import { ProductionPlanner } from "./ProductionPlanner";
import type { ProductionHealthResult } from "@/types/productionHealth";
import type { ProductionSnapshot } from "@/types/productionSnapshot";
import { productionIntelligenceSchemaVersion } from "@/types/productionIntelligence";

export class ProductionIntelligenceService {
  static derive(snapshot: ProductionSnapshot, health: ProductionHealthResult) {
    const actions = ProductionActionEngine.recommend(health);
    const graph = ProductionDependencyGraphBuilder.build(snapshot, health, actions);
    const plan = ProductionPlanner.create(snapshot, actions, graph);
    return { schemaVersion: productionIntelligenceSchemaVersion, actions, graph, plan };
  }
}
