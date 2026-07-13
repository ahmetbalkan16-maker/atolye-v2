import { NextResponse } from "next/server";
import { getProductionRuntimeStatus } from "@/lib/runtime/ProductionRuntimeCompositionRoot";
import type { ProductionRuntimeHealthResponse, ProductionRuntimeHealthStatus } from "@/types/productionRuntimeHealth";
import type { ProductionRuntimeStatus } from "@/types/productionRuntimeStatus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

interface ProductionRuntimeHealthDependencies {
  getRuntimeStatus(): ProductionRuntimeStatus;
  now(): string;
}

const productionDependencies: ProductionRuntimeHealthDependencies = {
  getRuntimeStatus: getProductionRuntimeStatus,
  now: () => new Date().toISOString(),
};

export function createProductionRuntimeHealthResponse(
  dependencies: ProductionRuntimeHealthDependencies,
): NextResponse<ProductionRuntimeHealthResponse> {
  const observedAt = readObservedAt(dependencies.now);

  try {
    const runtimeStatus = dependencies.getRuntimeStatus();
    const status = projectHealthStatus(runtimeStatus);

    if (status === "healthy") {
      return jsonResponse(
        {
          schemaVersion: "1",
          status,
          ready: true,
          acceptingExecutions: true,
          runtime: runtimeStatus,
          observedAt,
        },
        200,
      );
    }

    if (status === "unavailable") {
      return unavailableResponse(observedAt);
    }

    return jsonResponse(
      {
        schemaVersion: "1",
        status,
        ready: false,
        acceptingExecutions: false,
        runtime: runtimeStatus,
        observedAt,
      },
      503,
    );
  } catch {
    return unavailableResponse(observedAt);
  }
}

export function GET(): NextResponse<ProductionRuntimeHealthResponse> {
  return createProductionRuntimeHealthResponse(productionDependencies);
}

function projectHealthStatus(runtimeStatus: ProductionRuntimeStatus): ProductionRuntimeHealthStatus {
  if (!readinessIsConsistent(runtimeStatus)) return "unavailable";

  switch (runtimeStatus.lifecycleState) {
    case "ready":
      return "healthy";
    case "created":
    case "starting":
      return "starting";
    case "draining":
      return "draining";
    case "stopped":
      return "stopped";
    case "failed":
      return "failed";
    default:
      return "unavailable";
  }
}

function readinessIsConsistent(runtimeStatus: ProductionRuntimeStatus): boolean {
  if (!validRuntimeSnapshotBase(runtimeStatus)) return false;

  const lifecycleReady = runtimeStatus.lifecycleState === "ready";
  const lifecycleDraining = runtimeStatus.lifecycleState === "draining";
  const initializationComplete = runtimeStatus.initialized && runtimeStatus.recoveryCompleted;
  const expectedWorkerReady = lifecycleReady && initializationComplete;
  const failureIsConsistent =
    runtimeStatus.lifecycleState === "failed"
      ? validInitializationFailure(runtimeStatus.initializationFailure)
      : runtimeStatus.initializationFailure === null;

  return (
    runtimeStatus.initialized === runtimeStatus.recoveryCompleted &&
    runtimeStatus.workerReady === expectedWorkerReady &&
    runtimeStatus.acceptingExecutions === expectedWorkerReady &&
    runtimeStatus.draining === lifecycleDraining &&
    (!lifecycleReady || initializationComplete) &&
    failureIsConsistent
  );
}

function validRuntimeSnapshotBase(runtimeStatus: ProductionRuntimeStatus): boolean {
  return (
    runtimeStatus.schemaVersion === "1" &&
    runtimeStatus.writeFree === true &&
    isLifecycleState(runtimeStatus.lifecycleState) &&
    Number.isInteger(runtimeStatus.activeExecutionCount) &&
    runtimeStatus.activeExecutionCount >= 0 &&
    typeof runtimeStatus.acceptingExecutions === "boolean" &&
    typeof runtimeStatus.initialized === "boolean" &&
    typeof runtimeStatus.recoveryCompleted === "boolean" &&
    typeof runtimeStatus.workerReady === "boolean" &&
    typeof runtimeStatus.draining === "boolean" &&
    validOptionalDate(runtimeStatus.startupTimestamp) &&
    validOptionalDate(runtimeStatus.lastStateTransitionTimestamp)
  );
}

function isLifecycleState(value: unknown): value is ProductionRuntimeStatus["lifecycleState"] {
  return (
    value === "created" ||
    value === "starting" ||
    value === "ready" ||
    value === "draining" ||
    value === "stopped" ||
    value === "failed"
  );
}

function validInitializationFailure(
  value: ProductionRuntimeStatus["initializationFailure"],
): value is NonNullable<ProductionRuntimeStatus["initializationFailure"]> {
  if (!value || typeof value !== "object" || value instanceof Error || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  if (!keys.every((key) => key === "reasonCode" || key === "failedProjectSlug")) return false;
  if (!keys.includes("reasonCode") || !/^[A-Z0-9_-]{1,80}$/.test(value.reasonCode)) return false;
  return value.failedProjectSlug === undefined || /^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/.test(value.failedProjectSlug);
}

function validOptionalDate(value: string | null): boolean {
  return value === null || validDate(value);
}

function jsonResponse(
  body: ProductionRuntimeHealthResponse,
  status: 200 | 503,
): NextResponse<ProductionRuntimeHealthResponse> {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function unavailableResponse(observedAt: string): NextResponse<ProductionRuntimeHealthResponse> {
  return jsonResponse(
    {
      schemaVersion: "1",
      status: "unavailable",
      ready: false,
      acceptingExecutions: false,
      runtime: null,
      observedAt,
    },
    503,
  );
}

function readObservedAt(now: () => string): string {
  try {
    const observedAt = now();
    if (validDate(observedAt)) return observedAt;
  } catch {
    // The unavailable response must remain safe even when the observation clock fails.
  }
  return new Date().toISOString();
}

function validDate(value: string): boolean {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}
