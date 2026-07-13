import { ProductionExecutionWorkerExecutionService } from "./ProductionExecutionWorker";
import type { ProductionExecutionPersistenceAdapter } from "@/types/productionExecutionPersistence";
import type { ProductionExecutionWorkerExecutionRequest } from "@/types/productionExecutionWorker";
import type { ProductionStepKey, ProjectPackageRunType } from "@/types/project";

export interface ProductionPipelineExecutionContext { projectSlug:string;stage:ProductionStepKey;runType:ProjectPackageRunType }
export type ProductionPipelineExecutionRequestFactory = (context:ProductionPipelineExecutionContext) => ProductionExecutionWorkerExecutionRequest | Promise<ProductionExecutionWorkerExecutionRequest>;

export class ProductionPipelineExecutionAdapter {
  private readonly worker:ProductionExecutionWorkerExecutionService;
  constructor(adapter:ProductionExecutionPersistenceAdapter,private readonly requestFactory:ProductionPipelineExecutionRequestFactory){this.worker=new ProductionExecutionWorkerExecutionService(adapter)}
  async execute(context:ProductionPipelineExecutionContext,handler:()=>Promise<boolean>):Promise<boolean>{
    const request=await this.requestFactory(context);let completed:boolean|undefined;
    const result=await this.worker.execute(request,async()=>{completed=await handler();return{summary:completed?`Pipeline stage ${context.stage} completed.`:`Pipeline stage ${context.stage} cancelled.`,evidence:[`pipeline-stage:${context.stage}`,`run-type:${context.runType}`]}},{isCancellationRequested:()=>completed===false});
    if(result.status==="completed")return true;if(result.status==="cancelled")return false;if(result.status==="failed")throw new ProductionPipelineDurableExecutionError("Pipeline stage execution failed.",result.reasonCode);
    throw new ProductionPipelineDurableExecutionError("Pipeline durable execution could not start.",result.reasonCode)
  }
}
export class ProductionPipelineDurableExecutionError extends Error { constructor(message:string,readonly reasonCode:string){super(message);this.name="ProductionPipelineDurableExecutionError"} }
