import type { ProductionExecutionRecoveryBootstrap } from "./ProductionExecutionRecoveryBootstrap";
import type { ProductionExecutionRecoveryBootstrapClassification, ProductionExecutionRecoveryBootstrapResult } from "@/types/productionExecutionRecoveryBootstrap";
import type { ProductionRuntimeInitializationFailure, ProductionRuntimeInitializationResult, ProductionRuntimeInitializationSuccess, ProductionRuntimeProjectBootstrapResult } from "@/types/productionRuntimeInitialization";

export interface ProductionRuntimeInitializerDependencies {
  now(): string;
  listProjectSlugs(): Promise<readonly string[]>;
  createRecoveryBootstrap(projectSlug: string): Pick<ProductionExecutionRecoveryBootstrap, "bootstrapRecovery">;
}

const slugPattern = /^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/;

export class ProductionRuntimeInitializer {
  private initialization?: Promise<ProductionRuntimeInitializationResult>;

  constructor(private readonly dependencies: ProductionRuntimeInitializerDependencies) {}

  initialize(): Promise<ProductionRuntimeInitializationResult> {
    this.initialization ??= this.initializeOnce();
    return this.initialization;
  }

  private async initializeOnce(): Promise<ProductionRuntimeInitializationResult> {
    let initializedAt: string;
    try {
      initializedAt = this.dependencies.now();
    } catch {
      return failure("RUNTIME_CLOCK_INVALID", "invalid");
    }
    if (!validDate(initializedAt)) return failure("RUNTIME_CLOCK_INVALID", "invalid");

    let projectSlugs: readonly string[];
    try {
      projectSlugs = await this.dependencies.listProjectSlugs();
    } catch {
      return failure("RUNTIME_PROJECT_DISCOVERY_FAILED", initializedAt);
    }
    if (!Array.isArray(projectSlugs) || !projectSlugs.every((slug) => typeof slug === "string")) return failure("RUNTIME_PROJECT_ID_INVALID", initializedAt);

    const normalized = [...new Set(projectSlugs)].sort();
    const invalidSlug = normalized.find((slug) => !slugPattern.test(slug));
    if (invalidSlug) return failure("RUNTIME_PROJECT_ID_INVALID", initializedAt);

    const projects: ProductionRuntimeProjectBootstrapResult[] = [];
    for (const projectSlug of normalized) {
      let bootstrap: ProductionExecutionRecoveryBootstrapResult;
      try {
        bootstrap = await this.dependencies.createRecoveryBootstrap(projectSlug).bootstrapRecovery({ evaluatedAt: initializedAt });
      } catch {
        return failure("RUNTIME_BOOTSTRAP_FAILED", initializedAt, projectSlug);
      }
      if (!validBootstrap(bootstrap)) return failure("RUNTIME_BOOTSTRAP_INVALID", initializedAt, projectSlug);
      projects.push({ projectSlug, bootstrap });
    }

    const counts = emptyCounts();
    for (const project of projects) for (const classification of classifications) counts[classification] += project.bootstrap.counts[classification];
    const recoveryRequired = projects.some((project) => project.bootstrap.decision === "recovery-required");
    return success(recoveryRequired ? "RUNTIME_RECOVERY_REQUIRED" : "RUNTIME_INITIALIZED", initializedAt, projects, counts);
  }
}

export class ProductionRuntimeInitializationError extends Error {
  constructor(readonly result: ProductionRuntimeInitializationFailure) {
    super(result.reasonCode);
    this.name = "ProductionRuntimeInitializationError";
  }
}

const classifications: readonly ProductionExecutionRecoveryBootstrapClassification[] = ["active", "running", "terminal", "orphaned", "expired-lease", "replayable"];

function success(reasonCode: ProductionRuntimeInitializationSuccess["reasonCode"], initializedAt: string, projects: ProductionRuntimeProjectBootstrapResult[], counts: ProductionRuntimeInitializationSuccess["counts"]): ProductionRuntimeInitializationSuccess {
  return { schemaVersion: "1", ok: true, decision: reasonCode === "RUNTIME_RECOVERY_REQUIRED" ? "recovery-required" : "ready", reasonCode, initializedAt, writeFree: true, partialInitialization: false, projects, counts, evidence: [`reason:${reasonCode}`, "runtime-initialization:write-free"] };
}

function failure(reasonCode: ProductionRuntimeInitializationFailure["reasonCode"], initializedAt: string, failedProjectSlug?: string): ProductionRuntimeInitializationFailure {
  return { schemaVersion: "1", ok: false, decision: "failed", reasonCode, initializedAt, writeFree: true, partialInitialization: false, projects: [], ...(failedProjectSlug ? { failedProjectSlug } : {}), evidence: [`reason:${reasonCode}`, "runtime-initialization:not-committed"] };
}

function validBootstrap(value: ProductionExecutionRecoveryBootstrapResult): boolean {
  return value?.schemaVersion === "1" && value.writeFree === true && value.decision !== "indeterminate" && Array.isArray(value.attempts) && Array.isArray(value.plannerPlans) && classifications.every((classification) => Number.isInteger(value.counts?.[classification]) && value.counts[classification] >= 0);
}

function emptyCounts(): Record<ProductionExecutionRecoveryBootstrapClassification, number> { return { active: 0, running: 0, terminal: 0, orphaned: 0, "expired-lease": 0, replayable: 0 }; }
function validDate(value: string): boolean { const timestamp = Date.parse(value); return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value; }
