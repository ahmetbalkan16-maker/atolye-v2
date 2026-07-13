import type { ProductionExecutionAttemptPolicy, ProductionExecutionDurableAttemptRecord } from "./productionExecutionDurableAttempt";

export const productionExecutionLifecycleSchemaVersion = "1" as const;
export type ProductionExecutionLifecycleTransition = "running" | "completed" | "failed" | "cancelled";
export type ProductionExecutionLifecycleReasonCode = "LIFECYCLE_TRANSITION_APPLIED" | "LIFECYCLE_TRANSITION_REPLAYED" | "LIFECYCLE_EVENT_ID_CONFLICT" | "LIFECYCLE_STALE_WRITE" | "LIFECYCLE_VERSION_CONFLICT" | "LIFECYCLE_TERMINAL_ATTEMPT" | "LIFECYCLE_TRANSITION_INVALID" | "LIFECYCLE_CLAIM_MISMATCH" | "LIFECYCLE_WORKER_MISMATCH" | "LIFECYCLE_SESSION_MISMATCH" | "LIFECYCLE_LEASE_MISMATCH" | "LIFECYCLE_VALIDATION_FAILED" | "LIFECYCLE_INDETERMINATE";
export interface ProductionExecutionLifecycleMutationRequest { attemptId:string;claimId:string;workerId:string;workerSessionId:string;leaseId:string;expectedAttemptVersion:number;eventId:string;transition:ProductionExecutionLifecycleTransition;evaluatedAt:string;metadata:{code:string;summary:string;evidence:readonly string[]} }
export interface ProductionExecutionLifecyclePolicy { attempt:ProductionExecutionAttemptPolicy }
export interface ProductionExecutionLifecycleResult { schemaVersion:typeof productionExecutionLifecycleSchemaVersion;ok:boolean;decision:"applied"|"replayed"|"deny"|"indeterminate";reasonCode:ProductionExecutionLifecycleReasonCode;state?:ProductionExecutionLifecycleTransition;attempt?:ProductionExecutionDurableAttemptRecord;writeFree:boolean;evidence:readonly string[] }


