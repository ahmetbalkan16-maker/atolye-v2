import type { ProductionAcceptanceResult } from "./ProductionAcceptanceOrchestrator";
import {
  ProductionAcceptanceOrchestrator,
} from "./ProductionAcceptanceOrchestrator";
import type { ProductionReadinessReport } from "@/types/productionReadiness";

const CONFIRM_FLAG = "--confirm-production-acceptance";
const SAFE_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,198}[a-z0-9])?$/;

export interface ProductionAcceptanceCommandDependencies {
  readiness(): Promise<ProductionReadinessReport>;
  execute(): Promise<ProductionAcceptanceResult>;
  resume(projectSlug: string): Promise<ProductionAcceptanceResult>;
}

export interface ProductionAcceptanceCommandResult {
  readonly exitCode: number;
  readonly report: Record<string, unknown>;
}

const defaultDependencies: ProductionAcceptanceCommandDependencies = {
  readiness: () => ProductionAcceptanceOrchestrator.evaluateReadiness(),
  execute: () => ProductionAcceptanceOrchestrator.run(),
  resume: (projectSlug) => ProductionAcceptanceOrchestrator.resumeAndFinalize(projectSlug),
};

export async function runProductionAcceptanceCommand(
  args: readonly string[],
  dependencies: ProductionAcceptanceCommandDependencies = defaultDependencies,
): Promise<ProductionAcceptanceCommandResult> {
  const mode = args[0];
  let requestedProjectSlug: string | undefined;
  try {
    if (mode === "readiness-only" && args.length === 1) {
      const readiness = await dependencies.readiness();
      return {
        exitCode: readiness.ready ? 0 : 1,
        report: {
          mode,
          ready: readiness.ready,
          checks: readiness.checks.map(({ id, status, reasonCode }) => ({ id, status, reasonCode })),
        },
      };
    }
    if (mode === "execute" && args.length === 2 && args[1] === CONFIRM_FLAG) {
      return success(mode, await dependencies.execute());
    }
    if (mode === "resume-finalize" && args.includes(CONFIRM_FLAG)) {
      const slugArgument = args.find((value) => value.startsWith("--project-slug="));
      const projectSlug = slugArgument?.slice("--project-slug=".length);
      if (args.length !== 3 || !projectSlug || !SAFE_SLUG.test(projectSlug)) return usageFailure();
      requestedProjectSlug = projectSlug;
      return success(mode, await dependencies.resume(projectSlug));
    }
    return usageFailure();
  } catch (error) {
    const candidate = error as { code?: unknown; projectSlug?: unknown };
    return {
      exitCode: 1,
      report: {
        mode: typeof mode === "string" ? mode : "invalid",
        success: false,
        errorCode: typeof candidate.code === "string" ? candidate.code : "PRODUCTION_ACCEPTANCE_COMMAND_FAILED",
        ...safeProjectSlug(candidate.projectSlug, requestedProjectSlug),
      },
    };
  }
}

function safeProjectSlug(value: unknown, fallback?: string) {
  if (typeof value === "string" && SAFE_SLUG.test(value)) return { projectSlug: value };
  return fallback && SAFE_SLUG.test(fallback) ? { projectSlug: fallback } : {};
}

function success(mode: string, result: ProductionAcceptanceResult): ProductionAcceptanceCommandResult {
  return {
    exitCode: 0,
    report: { mode, success: true, completion: result.completion },
  };
}

function usageFailure(): ProductionAcceptanceCommandResult {
  return {
    exitCode: 2,
    report: {
      success: false,
      errorCode: "PRODUCTION_ACCEPTANCE_CONFIRMATION_REQUIRED",
      usage: [
        "readiness-only",
        `execute ${CONFIRM_FLAG}`,
        `resume-finalize --project-slug=<slug> ${CONFIRM_FLAG}`,
      ],
    },
  };
}
