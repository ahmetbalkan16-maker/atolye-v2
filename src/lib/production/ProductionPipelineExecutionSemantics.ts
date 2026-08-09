import type { ProductionPipelineExecutionContext } from
  "./ProductionPipelineExecutionAdapter";

export function productionPipelineExecutionAuthorizationAction(
  context: Pick<ProductionPipelineExecutionContext, "regeneration">,
) {
  return context.regeneration ? "regenerate-stage" as const : "retry-stage" as const;
}
