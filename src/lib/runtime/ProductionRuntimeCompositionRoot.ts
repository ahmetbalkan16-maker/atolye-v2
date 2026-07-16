import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ProjectReader } from "@/lib/projects/ProjectReader";
import { ProductionExecutionFilePersistenceAdapter } from "@/lib/production/ProductionExecutionPersistence";
import { ProductionExecutionRecoveryBootstrap } from "@/lib/production/ProductionExecutionRecoveryBootstrap";
import { ProductionRuntimeInitializationError, ProductionRuntimeInitializer } from "@/lib/production/ProductionRuntimeInitializer";
import { ProductionWorkerLifecycle } from "@/lib/production/ProductionWorkerLifecycle";
import { configureProductionPipelineExecution } from "@/lib/production/ProductionPipelineExecutionConfiguration";
import type { ProductionRuntimeInitializationSuccess } from "@/types/productionRuntimeInitialization";
import type { ProductionRuntimeStatus } from "@/types/productionRuntimeStatus";
import { createRuntimeStorageContext } from "./RuntimeStoragePaths";
import {
  createProductionRuntimeOperationContext,
  initialRuntimeAuthorityGeneration,
  runWithProductionRuntimeOperationContext,
} from "./ProductionRuntimeOperationContext";

const runtimeNow = () => new Date().toISOString();
const processRuntimeStorageContext = createRuntimeStorageContext();
const processRuntimeOperationContext = createProductionRuntimeOperationContext({
  operationId: `runtime-startup-${randomUUID()}`,
  operationType: "runtime-startup",
  authorityGeneration: initialRuntimeAuthorityGeneration,
  storageContext: processRuntimeStorageContext,
});
const productionWorkerLifecycle = new ProductionWorkerLifecycle(runtimeNow);
productionWorkerLifecycle.bindRuntimeOperationContext(processRuntimeOperationContext);
const processRuntimeInitializer = new ProductionRuntimeInitializer({
  now: runtimeNow,
  listProjectSlugs: listProjectSlugsReadOnly,
  createRecoveryBootstrap: (projectSlug) => new ProductionExecutionRecoveryBootstrap(new ProductionExecutionFilePersistenceAdapter({
    trustedRootDirectory: path.join(ProjectReader.getProjectFolder(projectSlug), "production-execution"),
    createRootDirectory: false,
  }), processRuntimeOperationContext),
  workerLifecycle: productionWorkerLifecycle,
});

export async function initializeProductionProcessRuntime(): Promise<ProductionRuntimeInitializationSuccess> {
  const result = await runWithProductionRuntimeOperationContext(
    processRuntimeOperationContext,
    () => processRuntimeInitializer.initialize(),
  );
  if (!result.ok) throw new ProductionRuntimeInitializationError(result);
  configureProductionPipelineExecution({
    lifecycle: productionWorkerLifecycle,
    runtimeOperationContext: processRuntimeOperationContext,
  });
  return result;
}

export function getProductionRuntimeStatus(): ProductionRuntimeStatus {
  return productionWorkerLifecycle.statusSnapshot();
}

export async function shutdownProductionProcessRuntime(): Promise<void> {
  await productionWorkerLifecycle.stop();
}

async function listProjectSlugsReadOnly(): Promise<readonly string[]> {
  try {
    const entries = await fs.readdir(ProjectReader.getProjectsRoot(), { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return [];
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException { return error instanceof Error; }
