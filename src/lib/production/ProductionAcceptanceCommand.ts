import type { ProductionAcceptanceResult } from "./ProductionAcceptanceOrchestrator";
import {
  ProductionAcceptanceOrchestrator,
} from "./ProductionAcceptanceOrchestrator";
import type { ProductionReadinessReport } from "@/types/productionReadiness";
import {
  normalizeProductionAcceptanceTopic,
  ProductionAcceptanceTopicError,
} from "./ProductionAcceptanceTopic";

const CONFIRM_FLAG = "--confirm-production-acceptance";
const SAFE_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,198}[a-z0-9])?$/;
const TOPIC_PREFIX = "--topic=";

export interface ProductionAcceptanceCommandDependencies {
  readiness(): Promise<ProductionReadinessReport>;
  execute(request: { readonly topic: string }): Promise<ProductionAcceptanceResult>;
  resume(projectSlug: string): Promise<ProductionAcceptanceResult>;
}

export interface ProductionAcceptanceCommandResult {
  readonly exitCode: number;
  readonly report: Record<string, unknown>;
}

const defaultDependencies: ProductionAcceptanceCommandDependencies = {
  readiness: () => ProductionAcceptanceOrchestrator.evaluateReadiness(),
  execute: (request) => ProductionAcceptanceOrchestrator.run(request),
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
    if (mode === "execute") {
      const parsed = parseExecuteArguments(args.slice(1));
      if ("errorCode" in parsed) return commandFailure(parsed.errorCode);
      return success(mode, await dependencies.execute({ topic: parsed.topic }));
    }
    if (mode === "resume-finalize") {
      const parsed = parseResumeArguments(args.slice(1));
      if ("errorCode" in parsed) return commandFailure(parsed.errorCode);
      const projectSlug = parsed.projectSlug;
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
  return commandFailure("PRODUCTION_ACCEPTANCE_CONFIRMATION_REQUIRED");
}

function commandFailure(errorCode: string): ProductionAcceptanceCommandResult {
  return {
    exitCode: 2,
    report: {
      success: false,
      errorCode,
      usage: [
        "readiness-only",
        `execute ${CONFIRM_FLAG} --topic=<topic>`,
        `resume-finalize --project-slug=<slug> ${CONFIRM_FLAG}`,
      ],
    },
  };
}

function parseExecuteArguments(args: readonly string[]):
  | { readonly topic: string }
  | { readonly errorCode: string } {
  const confirmations = args.filter((value) => value === CONFIRM_FLAG);
  if (confirmations.length !== 1) {
    return { errorCode: "PRODUCTION_ACCEPTANCE_CONFIRMATION_REQUIRED" };
  }
  const topicArguments = args.filter((value) => value.startsWith(TOPIC_PREFIX));
  const unknown = args.filter(
    (value) => value !== CONFIRM_FLAG && !value.startsWith(TOPIC_PREFIX),
  );
  if (unknown.length > 0) {
    return { errorCode: "PRODUCTION_ACCEPTANCE_ARGUMENT_UNKNOWN" };
  }
  if (topicArguments.length === 0) {
    return { errorCode: "PRODUCTION_ACCEPTANCE_TOPIC_MISSING" };
  }
  if (topicArguments.length > 1) {
    return { errorCode: "PRODUCTION_ACCEPTANCE_TOPIC_DUPLICATE" };
  }
  try {
    return { topic: normalizeProductionAcceptanceTopic(topicArguments[0].slice(TOPIC_PREFIX.length)) };
  } catch (error) {
    return {
      errorCode: error instanceof ProductionAcceptanceTopicError
        ? error.code
        : "PRODUCTION_ACCEPTANCE_TOPIC_INVALID",
    };
  }
}

function parseResumeArguments(args: readonly string[]):
  | { readonly projectSlug: string }
  | { readonly errorCode: string } {
  if (args.filter((value) => value === CONFIRM_FLAG).length !== 1) {
    return { errorCode: "PRODUCTION_ACCEPTANCE_CONFIRMATION_REQUIRED" };
  }
  const slugArguments = args.filter((value) => value.startsWith("--project-slug="));
  if (
    args.some((value) => value !== CONFIRM_FLAG && !value.startsWith("--project-slug=")) ||
    slugArguments.length !== 1
  ) {
    return { errorCode: "PRODUCTION_ACCEPTANCE_ARGUMENT_UNKNOWN" };
  }
  const projectSlug = slugArguments[0].slice("--project-slug=".length);
  return SAFE_SLUG.test(projectSlug)
    ? { projectSlug }
    : { errorCode: "PRODUCTION_ACCEPTANCE_ARGUMENT_UNKNOWN" };
}
