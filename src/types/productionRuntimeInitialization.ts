import type { ProductionExecutionRecoveryBootstrapClassification, ProductionExecutionRecoveryBootstrapResult } from "./productionExecutionRecoveryBootstrap";

export const productionRuntimeInitializationSchemaVersion = "1" as const;

export type ProductionRuntimeInitializationReasonCode =
  | "RUNTIME_INITIALIZED"
  | "RUNTIME_RECOVERY_REQUIRED"
  | "RUNTIME_CLOCK_INVALID"
  | "RUNTIME_PROJECT_DISCOVERY_FAILED"
  | "RUNTIME_PROJECT_ID_INVALID"
  | "RUNTIME_BOOTSTRAP_FAILED"
  | "RUNTIME_BOOTSTRAP_INVALID";

export interface ProductionRuntimeProjectBootstrapResult {
  projectSlug: string;
  bootstrap: ProductionExecutionRecoveryBootstrapResult;
}

interface ProductionRuntimeInitializationBase {
  schemaVersion: typeof productionRuntimeInitializationSchemaVersion;
  initializedAt: string;
  writeFree: true;
  partialInitialization: false;
  evidence: readonly string[];
}

export interface ProductionRuntimeInitializationSuccess extends ProductionRuntimeInitializationBase {
  ok: true;
  decision: "ready" | "recovery-required";
  reasonCode: "RUNTIME_INITIALIZED" | "RUNTIME_RECOVERY_REQUIRED";
  projects: readonly ProductionRuntimeProjectBootstrapResult[];
  counts: Readonly<Record<ProductionExecutionRecoveryBootstrapClassification, number>>;
}

export interface ProductionRuntimeInitializationFailure extends ProductionRuntimeInitializationBase {
  ok: false;
  decision: "failed";
  reasonCode: Exclude<ProductionRuntimeInitializationReasonCode, "RUNTIME_INITIALIZED" | "RUNTIME_RECOVERY_REQUIRED">;
  projects: readonly [];
  failedProjectSlug?: string;
}

export type ProductionRuntimeInitializationResult = ProductionRuntimeInitializationSuccess | ProductionRuntimeInitializationFailure;

