import type { ProductionRuntimeStatus } from "./productionRuntimeStatus";

export const productionRuntimeHealthSchemaVersion = "1" as const;

export type ProductionRuntimeHealthStatus =
  | "healthy"
  | "starting"
  | "draining"
  | "stopped"
  | "failed"
  | "unavailable";

interface ProductionRuntimeHealthResponseBase {
  readonly schemaVersion: typeof productionRuntimeHealthSchemaVersion;
  readonly observedAt: string;
}

export interface ProductionRuntimeHealthyResponse extends ProductionRuntimeHealthResponseBase {
  readonly status: "healthy";
  readonly ready: true;
  readonly acceptingExecutions: true;
  readonly runtime: ProductionRuntimeStatus;
}

export interface ProductionRuntimeNonHealthyResponse extends ProductionRuntimeHealthResponseBase {
  readonly status: "starting" | "draining" | "stopped" | "failed";
  readonly ready: false;
  readonly acceptingExecutions: false;
  readonly runtime: ProductionRuntimeStatus;
}

export interface ProductionRuntimeUnavailableResponse extends ProductionRuntimeHealthResponseBase {
  readonly status: "unavailable";
  readonly ready: false;
  readonly acceptingExecutions: false;
  readonly runtime: ProductionRuntimeStatus | null;
}

export type ProductionRuntimeHealthResponse =
  | ProductionRuntimeHealthyResponse
  | ProductionRuntimeNonHealthyResponse
  | ProductionRuntimeUnavailableResponse;
