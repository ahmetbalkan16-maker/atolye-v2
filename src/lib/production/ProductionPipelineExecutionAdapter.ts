import { ProductionExecutionWorkerExecutionService } from "./ProductionExecutionWorker";
import type { ProductionExecutionPersistenceAdapter } from "@/types/productionExecutionPersistence";
import type { ProductionExecutionWorkerExecutionRequest, ProductionExecutionWorkerExecutionResult } from "@/types/productionExecutionWorker";
import type { ProductionStepKey, ProjectPackageRunType } from "@/types/project";
import type { ProductionAcceptanceProviderSelection } from "./ProductionAcceptanceExecutionScope";
import type { ProductionRegenerationBinding } from "@/types/productionRegeneration";
import type { ProductionPipelineFailedSettlementAttemptEvidence,
  ProductionPipelineFailedSettlementFailureBoundary } from
  "./ProductionPipelineTerminalSettlement";

export interface ProductionPipelineExecutionContext { projectSlug:string;stage:ProductionStepKey;runType:ProjectPackageRunType;providerSelection?:ProductionAcceptanceProviderSelection;regeneration?:ProductionRegenerationBinding }
export type ProductionPipelineExecutionRequestFactory = (context:ProductionPipelineExecutionContext) => ProductionExecutionWorkerExecutionRequest | Promise<ProductionExecutionWorkerExecutionRequest>;
export interface ProductionPipelineSettlementResult { ok:boolean;reasonCode:string;settlementReasonCode?:string;originalFailureCode?:string;causeReasonCode?:string;completedSteps?:readonly string[];writePerformed?:boolean;writeFree?:boolean;quiescenceProven?:boolean;failedBoundary?:ProductionPipelineFailedSettlementFailureBoundary;attemptEvidence?:ProductionPipelineFailedSettlementAttemptEvidence }
export type ProductionPipelineSuccessSettlement = (result:ProductionExecutionWorkerExecutionResult) => Promise<ProductionPipelineSettlementResult>;
export type ProductionPipelineFailureSettlement = (result:ProductionExecutionWorkerExecutionResult) => Promise<ProductionPipelineSettlementResult>;

export class ProductionPipelineExecutionAdapter {
  private readonly worker:ProductionExecutionWorkerExecutionService;
  constructor(adapter:ProductionExecutionPersistenceAdapter,private readonly requestFactory:ProductionPipelineExecutionRequestFactory,private readonly settleSuccess?:ProductionPipelineSuccessSettlement,private readonly settleFailure?:ProductionPipelineFailureSettlement){this.worker=new ProductionExecutionWorkerExecutionService(adapter)}
  async execute(context:ProductionPipelineExecutionContext,handler:()=>Promise<boolean>):Promise<boolean>{
    const request=await this.requestFactory(context);let completed:boolean|undefined;
    const result=await this.worker.execute(request,async()=>{completed=await handler();return{summary:completed?`Pipeline stage ${context.stage} completed.`:`Pipeline stage ${context.stage} cancelled.`,evidence:[`pipeline-stage:${context.stage}`,`run-type:${context.runType}`]}},{isCancellationRequested:()=>completed===false});
    if(result.status==="completed"){
      if(this.settleSuccess){const settlement=await this.settleSuccess(result);if(!settlement.ok)throw new ProductionPipelineDurableExecutionError("Pipeline terminal settlement failed.",settlement.reasonCode)}
      return true
    }if(result.status==="cancelled")return false;if(result.status==="failed"){
      if(this.settleFailure){
        const settlement=await this.settleFailure(result);
        if(!settlement.ok)throw new ProductionPipelineDurableExecutionError(
          "Pipeline failed-terminal settlement failed.",settlement.reasonCode,{
            originalReasonCode:settlement.originalFailureCode,
            settlementReasonCode:settlement.settlementReasonCode??settlement.reasonCode,
            causeReasonCode:settlement.causeReasonCode,
            completedSettlementSteps:settlement.completedSteps,
            writePerformed:settlement.writePerformed??settlement.writeFree===false,
            writeFree:settlement.writeFree??settlement.writePerformed!==true,
            quiescenceProven:settlement.quiescenceProven===true,
            failedBoundary:settlement.failedBoundary,
            attemptEvidence:settlement.attemptEvidence,
          });
        throw new ProductionPipelineDurableExecutionError(
          "Pipeline stage execution failed.",settlement.originalFailureCode??result.reasonCode);
      }
      throw new ProductionPipelineDurableExecutionError("Pipeline stage execution failed.",result.reasonCode);
    }
    throw new ProductionPipelineDurableExecutionError("Pipeline durable execution could not start.",result.reasonCode)
  }
}
export class ProductionPipelineDurableExecutionError extends Error {
  readonly code:string;
  readonly originalReasonCode?:string;
  readonly settlementReasonCode?:string;
  readonly causeReasonCode?:string;
  readonly completedSettlementSteps?:readonly string[];
  readonly writePerformed?:boolean;
  readonly writeFree?:boolean;
  readonly quiescenceProven?:boolean;
  readonly failedBoundary?:ProductionPipelineFailedSettlementFailureBoundary;
  readonly attemptEvidence?:ProductionPipelineFailedSettlementAttemptEvidence;
  constructor(message:string,readonly reasonCode:string,details:{originalReasonCode?:string;settlementReasonCode?:string;causeReasonCode?:string;completedSettlementSteps?:readonly string[];writePerformed?:boolean;writeFree?:boolean;quiescenceProven?:boolean;failedBoundary?:ProductionPipelineFailedSettlementFailureBoundary;attemptEvidence?:ProductionPipelineFailedSettlementAttemptEvidence}={}){
    super(message);if(new.target===ProductionPipelineDurableExecutionError){authenticProductionPipelineDurableExecutionErrors.add(this)}this.name="ProductionPipelineDurableExecutionError";
    this.code=reasonCode;
    this.originalReasonCode=details.originalReasonCode;
    this.settlementReasonCode=details.settlementReasonCode;
    this.causeReasonCode=details.causeReasonCode;
    this.completedSettlementSteps=details.completedSettlementSteps;
    this.writePerformed=details.writePerformed;
    this.writeFree=details.writeFree;
    this.quiescenceProven=details.quiescenceProven;
    this.failedBoundary=details.failedBoundary;
    this.attemptEvidence=details.attemptEvidence;
  }
}
const authenticProductionPipelineDurableExecutionErrors = new WeakSet<object>();
export function isAuthenticProductionPipelineDurableExecutionError(value:unknown):
value is ProductionPipelineDurableExecutionError {
  return typeof value === "object" && value !== null &&
    authenticProductionPipelineDurableExecutionErrors.has(value) &&
    Object.getPrototypeOf(value) === ProductionPipelineDurableExecutionError.prototype;
}
