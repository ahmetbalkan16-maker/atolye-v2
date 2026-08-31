import type {
  ProductionAcceptanceResult,
  ProductionAcceptanceResumeResult,
  ProductionAcceptanceRunResult,
} from "./ProductionAcceptanceOrchestrator";
import {
  isAuthenticProductionAcceptanceBlockedError,
  isAuthenticProductionAcceptanceConfigurationChangedError,
  isAuthenticProductionAcceptanceExecutionError,
  ProductionAcceptanceOrchestrator,
} from "./ProductionAcceptanceOrchestrator";
import type { ProductionStepKey } from "@/types/project";
import type { ProductionReadinessReport } from "@/types/productionReadiness";
import {
  diagnoseProductionAcceptanceConfiguration,
  type ProductionAcceptanceConfigurationDiagnostic,
} from "./ProductionAcceptancePolicy";
import {
  isAuthenticProductionAcceptanceTopicError,
  normalizeProductionAcceptanceTopic,
} from "./ProductionAcceptanceTopic";
import {
  isAuthenticProductionAcceptanceReprepareError,
  reprepareProductionAcceptanceMarker,
  type ProductionAcceptanceReprepareResult,
} from "./ProductionAcceptanceReprepareService";
import {
  planProductionAcceptanceLegacyReauthorization,
  reauthorizeProductionAcceptanceLegacyMarker,
  type LegacyReauthorizationPlan,
  type LegacyReauthorizationResult,
} from "./ProductionAcceptanceLegacyReauthorizationService";
import {
  isAuthenticProductionAcceptanceMarkerNotFoundError,
  isAuthenticProductionAcceptancePolicyError,
} from "./ProductionAcceptancePolicy";
import { isAuthenticProductionAcceptanceLegacyReauthorizationError } from
  "./ProductionAcceptanceLegacyReauthorization";
import { legacyReauthorizationErrorCodes } from
  "./ProductionAcceptanceLegacyReauthorization";
import { isAuthenticProductionPipelineDurableExecutionError,
} from
  "./ProductionPipelineExecutionAdapter";
import { productionDurableAttemptLineageBindingInvalidCode } from
  "./ProductionDurableAttemptLineageBoundary";
import {
  planRetryBudgetExtension,
  applyRetryBudgetExtension,
} from "./ProductionPipelineRetryBudgetExtensionService";
import {
  planEnvironmentalFailureRetryExtension,
  applyEnvironmentalFailureRetryExtension,
} from "./ProductionEnvironmentalFailureRetryPlan";
import {
  environmentalFailureHttpStatuses,
  type EnvironmentalFailureRetryOperatorEvidence,
} from "./ProductionPipelineEnvironmentalFailureRetryExtension";
import { createRuntimeStorageContext } from "@/lib/runtime/RuntimeStoragePaths";
import { pipelineRecoveryStageOrder } from "@/lib/pipeline/PipelineRecoveryPlanner";
import { pipelineResumeBoundaryInvalidCode } from "@/lib/pipeline/PipelineRunner";
import type {
  PipelineRecoveryStageKey,
  PipelineResumeOptions,
} from "@/types/pipelineRecovery";

const CONFIRM_FLAG = "--confirm-production-acceptance";
const REPREPARE_CONFIRM_FLAG = "--confirm-production-acceptance-reprepare";
const SAFE_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,198}[a-z0-9])?$/;
const TOPIC_PREFIX = "--topic=";
const STOP_AFTER_STAGE_PREFIX = "--stop-after-stage=";

export interface ProductionAcceptanceCommandDependencies {
  readiness(): Promise<ProductionReadinessReport>;
  execute(
    request: { readonly topic: string },
    options?: PipelineResumeOptions,
  ): Promise<ProductionAcceptanceRunResult>;
  resume(
    projectSlug: string,
    options?: PipelineResumeOptions,
  ): Promise<ProductionAcceptanceResumeResult>;
  diagnose?(projectSlug: string): Promise<ProductionAcceptanceConfigurationDiagnostic>;
  reprepare?(projectSlug: string): Promise<ProductionAcceptanceReprepareResult>;
  legacyReauthorizationPlan?(
    projectSlug: string,
    sourceMarkerSha256: string,
  ): Promise<LegacyReauthorizationPlan>;
  reauthorizeLegacy?(input: {
    projectSlug: string;
    sourceMarkerSha256: string;
    reason: string;
    reauthorizationId: string;
    confirmation: string;
  }): Promise<LegacyReauthorizationResult>;
}

export interface ProductionAcceptanceCommandResult {
  readonly exitCode: number;
  readonly report: Record<string, unknown>;
}

const defaultDependencies: ProductionAcceptanceCommandDependencies = {
  readiness: () => ProductionAcceptanceOrchestrator.evaluateReadiness(),
  execute: (request, options) => ProductionAcceptanceOrchestrator.run(request, options ?? {}),
  resume: (projectSlug, options) =>
    ProductionAcceptanceOrchestrator.resumeAndFinalize(projectSlug, options),
  diagnose: (projectSlug) => diagnoseProductionAcceptanceConfiguration(projectSlug),
  reprepare: (projectSlug) => reprepareProductionAcceptanceMarker(projectSlug),
  legacyReauthorizationPlan: (projectSlug, sourceMarkerSha256) =>
    planProductionAcceptanceLegacyReauthorization(projectSlug, sourceMarkerSha256),
  reauthorizeLegacy: (input) => reauthorizeProductionAcceptanceLegacyMarker(input),
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
      const result = await dependencies.execute({ topic: parsed.topic }, parsed.options);
      return "boundedRun" in result
        ? { exitCode: 0, report: { mode, success: true, boundedRun: result.boundedRun } }
        : success(mode, result);
    }
    if (mode === "resume-finalize") {
      const parsed = parseResumeArguments(args.slice(1));
      if ("errorCode" in parsed) return commandFailure(parsed.errorCode);
      const projectSlug = parsed.projectSlug;
      requestedProjectSlug = projectSlug;
      const result = await dependencies.resume(projectSlug, parsed.options);
      return "boundedResume" in result
        ? { exitCode: 0, report: { mode, success: true, boundedResume: result.boundedResume } }
        : success(mode, result);
    }
    if (mode === "diagnose") {
      const parsed = parseDiagnoseArguments(args.slice(1));
      if ("errorCode" in parsed) return commandFailure(parsed.errorCode);
      const projectSlug = parsed.projectSlug;
      requestedProjectSlug = projectSlug;
      const diagnose = dependencies.diagnose ?? defaultDependencies.diagnose;
      const diagnostic = await diagnose!(projectSlug);
      return {
        exitCode: diagnostic.matches ? 0 : 1,
        report: {
          mode,
          success: diagnostic.matches,
          projectSlug,
          schemaVersion: diagnostic.schemaVersion,
          matches: diagnostic.matches,
          componentDiagnosticsAvailable: diagnostic.componentDiagnosticsAvailable,
          mismatchedComponents: diagnostic.mismatchedComponents,
        },
      };
    }
    if (mode === "reprepare") {
      const parsed = parseReprepareArguments(args.slice(1));
      if ("errorCode" in parsed) return commandFailure(parsed.errorCode);
      const projectSlug = parsed.projectSlug;
      requestedProjectSlug = projectSlug;
      const reprepare = dependencies.reprepare ?? defaultDependencies.reprepare;
      const result = await reprepare!(projectSlug);
      return {
        exitCode: 0,
        report: {
          mode,
          success: true,
          projectSlug,
          schemaVersion: result.schemaVersion,
          decision: result.decision,
          writePerformed: result.writePerformed,
        },
      };
    }
    if (mode === "legacy-reauthorization-plan") {
      const parsed = parseLegacyReauthorizationPlanArguments(args.slice(1));
      if ("errorCode" in parsed) return commandFailure(parsed.errorCode);
      requestedProjectSlug = parsed.projectSlug;
      const plan = await (dependencies.legacyReauthorizationPlan ??
        defaultDependencies.legacyReauthorizationPlan)!(
          parsed.projectSlug,
          parsed.sourceMarkerSha256,
        );
      return {
        exitCode: 0,
        report: { mode, ...plan },
      };
    }
    if (mode === "reauthorize-legacy") {
      const parsed = parseLegacyReauthorizationArguments(args.slice(1));
      if ("errorCode" in parsed) return commandFailure(parsed.errorCode);
      requestedProjectSlug = parsed.projectSlug;
      const result = await (dependencies.reauthorizeLegacy ??
        defaultDependencies.reauthorizeLegacy)!(parsed);
      return {
        exitCode: 0,
        report: { mode, success: true, ...result },
      };
    }
    if (mode === "retry-budget-extension-plan") {
      const parsed = parseRetryBudgetExtensionPlanArguments(args.slice(1));
      if ("errorCode" in parsed) return commandFailure(parsed.errorCode);
      requestedProjectSlug = parsed.projectSlug;
      const storageContext = createRuntimeStorageContext();
      const plan = await planRetryBudgetExtension(
        parsed.projectSlug,
        parsed.stage,
        parsed.jobId,
        parsed.reason,
        storageContext,
      );
      return {
        exitCode: plan.eligible ? 0 : 1,
        report: { ...plan },
      };
    }
    if (mode === "extend-retry-budget") {
      const parsed = parseExtendRetryBudgetArguments(args.slice(1));
      if ("errorCode" in parsed) return commandFailure(parsed.errorCode);
      requestedProjectSlug = parsed.projectSlug;
      const storageContext = createRuntimeStorageContext();
      const result = await applyRetryBudgetExtension(
        parsed.projectSlug,
        parsed.stage,
        parsed.jobId,
        parsed.reason,
        parsed.authorityId,
        parsed.confirmation,
        storageContext,
      );
      return {
        exitCode: result.success ? 0 : 1,
        report: { ...result },
      };
    }
    if (mode === "environmental-failure-retry-plan") {
      const parsed = parseEnvironmentalFailureRetryPlanArguments(args.slice(1));
      if ("errorCode" in parsed) return commandFailure(parsed.errorCode);
      requestedProjectSlug = parsed.projectSlug;
      const storageContext = createRuntimeStorageContext();
      const plan = await planEnvironmentalFailureRetryExtension(
        parsed.projectSlug, parsed.stage, parsed.jobId, parsed.reason,
        parsed.operatorEvidence, storageContext,
      );
      return {
        exitCode: plan.eligible ? 0 : 1,
        report: { ...plan },
      };
    }
    if (mode === "apply-environmental-failure-retry") {
      const parsed = parseApplyEnvironmentalFailureRetryArguments(args.slice(1));
      if ("errorCode" in parsed) return commandFailure(parsed.errorCode);
      requestedProjectSlug = parsed.projectSlug;
      const storageContext = createRuntimeStorageContext();
      const result = await applyEnvironmentalFailureRetryExtension(
        parsed.projectSlug, parsed.stage, parsed.jobId, parsed.reason,
        parsed.operatorEvidence, parsed.authorityId, parsed.confirmation, storageContext,
      );
      return {
        exitCode: result.success ? 0 : 1,
        report: { ...result },
      };
    }
    return usageFailure();
  } catch (error) {
    const trustedErrorCode = trustedCommandErrorCode(mode, error);
    return {
      exitCode: 1,
      report: {
        mode: typeof mode === "string" ? mode : "invalid",
        success: false,
        errorCode: trustedErrorCode ?? "PRODUCTION_ACCEPTANCE_COMMAND_FAILED",
        ...safeProjectSlug(requestedProjectSlug),
      },
    };
  }
}

const resumePublicErrorCodes = new Set<string>([
  "PRODUCTION_ACCEPTANCE_EXECUTION_FAILED",
  "PIPELINE_RETRY_MAX_ATTEMPTS_EXCEEDED",
  "PIPELINE_RETRY_QUEUED_EXHAUSTED_DRIFT_DETECTED",
  "PIPELINE_RETRY_DURABLE_CONFLICT",
  "PIPELINE_RETRY_COMPENSATION_FAILED",
  productionDurableAttemptLineageBindingInvalidCode,
  pipelineResumeBoundaryInvalidCode,
]);

function trustedCommandErrorCode(mode: unknown, error: unknown): string | undefined {
  if (mode === "resume-finalize" && isAuthenticProductionAcceptanceExecutionError(error)) {
    const code = error.reasonCode ?? error.code;
    return resumePublicErrorCodes.has(code) ? code : undefined;
  }
  if (mode === "resume-finalize" && isAuthenticProductionPipelineDurableExecutionError(error)) {
    return resumePublicErrorCodes.has(error.reasonCode) ? error.reasonCode : undefined;
  }
  if ((mode === "execute" || mode === "resume-finalize") &&
    isAuthenticProductionAcceptanceBlockedError(error)) {
    return "PRODUCTION_ACCEPTANCE_READINESS_BLOCKED";
  }
  if ((mode === "execute" || mode === "resume-finalize") &&
    isAuthenticProductionAcceptanceConfigurationChangedError(error)) {
    return "PRODUCTION_ACCEPTANCE_CONFIGURATION_CHANGED";
  }
  if (mode === "diagnose" && isAuthenticProductionAcceptanceMarkerNotFoundError(error)) {
    return "PRODUCTION_ACCEPTANCE_MARKER_NOT_FOUND";
  }
  if ((mode === "execute" || mode === "resume-finalize" || mode === "diagnose") &&
    isAuthenticProductionAcceptancePolicyError(error)) {
    return "PRODUCTION_ACCEPTANCE_POLICY_INVALID";
  }
  if (mode === "reprepare" && isAuthenticProductionAcceptanceReprepareError(error)) {
    return "PRODUCTION_ACCEPTANCE_REPREPARE_FAILED";
  }
  if ((mode === "legacy-reauthorization-plan" || mode === "reauthorize-legacy") &&
    isAuthenticProductionAcceptanceLegacyReauthorizationError(error) &&
    legacyReauthorizationErrorCodes.includes(error.code)) return error.code;
  return undefined;
}

function safeProjectSlug(value: unknown) {
  return typeof value === "string" && SAFE_SLUG.test(value) ? { projectSlug: value } : {};
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
        `execute ${CONFIRM_FLAG} --topic=<topic> [--stop-after-stage=<stage>]`,
        `resume-finalize --project-slug=<slug> [--stop-after-stage=<stage>] ${CONFIRM_FLAG}`,
        "diagnose --project-slug=<slug>",
        `reprepare --project-slug=<slug> ${REPREPARE_CONFIRM_FLAG}`,
        "legacy-reauthorization-plan --project-slug=<slug> --source-marker-sha256=<64-hex>",
        "reauthorize-legacy --project-slug=<slug> --source-marker-sha256=<64-hex> --reason=legacy-environment-unrecoverable --reauthorization-id=<64-hex> --confirm-production-acceptance-legacy-reauthorization=<64-hex>",
        "retry-budget-extension-plan --project-slug=<slug> --stage=<stage> --job-id=<jobId> --reason=<reason>",
        "extend-retry-budget --project-slug=<slug> --stage=<stage> --job-id=<jobId> --reason=<reason> --authority-id=<id> --confirm-production-retry-budget-extension=<id>",
        "environmental-failure-retry-plan --project-slug=<slug> --stage=<stage> --job-id=<jobId> --reason=<reason> --observed-http-status=<401|403|429> --observed-provider-error-code=<code> --remediation-verified=<note>",
        "apply-environmental-failure-retry --project-slug=<slug> --stage=<stage> --job-id=<jobId> --reason=<reason> --observed-http-status=<401|403|429> --observed-provider-error-code=<code> --remediation-verified=<note> --authority-id=<id> --confirm-environmental-failure-retry=<id>",
      ],
    },
  };
}

function parseLegacyReauthorizationPlanArguments(args: readonly string[]):
  | { projectSlug: string; sourceMarkerSha256: string }
  | { errorCode: string } {
  const slug = exactValue(args, "--project-slug=");
  const marker = exactValue(args, "--source-marker-sha256=");
  if (
    args.length !== 2 || !slug || !marker || !SAFE_SLUG.test(slug) ||
    !/^[a-f0-9]{64}$/.test(marker)
  ) return { errorCode: "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_ARGUMENT_INVALID" };
  return { projectSlug: slug, sourceMarkerSha256: marker };
}

function parseLegacyReauthorizationArguments(args: readonly string[]):
  | {
      projectSlug: string;
      sourceMarkerSha256: string;
      reason: string;
      reauthorizationId: string;
      confirmation: string;
    }
  | { errorCode: string } {
  const slug = exactValue(args, "--project-slug=");
  const marker = exactValue(args, "--source-marker-sha256=");
  const reason = exactValue(args, "--reason=");
  const id = exactValue(args, "--reauthorization-id=");
  const confirmation = exactValue(
    args,
    "--confirm-production-acceptance-legacy-reauthorization=",
  );
  if (
    args.length !== 5 || !slug || !marker || !reason || !id || !confirmation ||
    !SAFE_SLUG.test(slug) || !/^[a-f0-9]{64}$/.test(marker) ||
    !/^[a-f0-9]{64}$/.test(id) || !/^[a-f0-9]{64}$/.test(confirmation)
  ) return { errorCode: "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_ARGUMENT_INVALID" };
  if (id !== confirmation) {
    return { errorCode: "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_CONFIRMATION_REQUIRED" };
  }
  return {
    projectSlug: slug,
    sourceMarkerSha256: marker,
    reason,
    reauthorizationId: id,
    confirmation,
  };
}

function exactValue(args: readonly string[], prefix: string): string | undefined {
  const values = args.filter((value) => value.startsWith(prefix));
  if (values.length !== 1) return undefined;
  const value = values[0].slice(prefix.length);
  return value.length > 0 ? value : undefined;
}

function parseReprepareArguments(args: readonly string[]):
  | { readonly projectSlug: string }
  | { readonly errorCode: string } {
  if (args.filter((value) => value === REPREPARE_CONFIRM_FLAG).length !== 1) {
    return { errorCode: "PRODUCTION_ACCEPTANCE_REPREPARE_CONFIRMATION_REQUIRED" };
  }
  const slugArguments = args.filter((value) => value.startsWith("--project-slug="));
  if (
    args.some((value) =>
      value !== REPREPARE_CONFIRM_FLAG && !value.startsWith("--project-slug=")) ||
    slugArguments.length !== 1
  ) {
    return { errorCode: "PRODUCTION_ACCEPTANCE_ARGUMENT_UNKNOWN" };
  }
  const projectSlug = slugArguments[0].slice("--project-slug=".length);
  return SAFE_SLUG.test(projectSlug)
    ? { projectSlug }
    : { errorCode: "PRODUCTION_ACCEPTANCE_ARGUMENT_UNKNOWN" };
}

function parseDiagnoseArguments(args: readonly string[]):
  | { readonly projectSlug: string }
  | { readonly errorCode: string } {
  const slugArguments = args.filter((value) => value.startsWith("--project-slug="));
  if (
    args.some((value) => !value.startsWith("--project-slug=")) ||
    slugArguments.length !== 1
  ) {
    return { errorCode: "PRODUCTION_ACCEPTANCE_ARGUMENT_UNKNOWN" };
  }
  const projectSlug = slugArguments[0].slice("--project-slug=".length);
  return SAFE_SLUG.test(projectSlug)
    ? { projectSlug }
    : { errorCode: "PRODUCTION_ACCEPTANCE_ARGUMENT_UNKNOWN" };
}

function parseExecuteArguments(args: readonly string[]):
  | { readonly topic: string; readonly options: PipelineResumeOptions }
  | { readonly errorCode: string } {
  const confirmations = args.filter((value) => value === CONFIRM_FLAG);
  if (confirmations.length !== 1) {
    return { errorCode: "PRODUCTION_ACCEPTANCE_CONFIRMATION_REQUIRED" };
  }
  const topicArguments = args.filter((value) => value.startsWith(TOPIC_PREFIX));
  const stopArguments = args.filter((value) => value.startsWith(STOP_AFTER_STAGE_PREFIX));
  const unknown = args.filter(
    (value) => value !== CONFIRM_FLAG &&
      !value.startsWith(TOPIC_PREFIX) &&
      !value.startsWith(STOP_AFTER_STAGE_PREFIX),
  );
  if (unknown.length > 0 || stopArguments.length > 1) {
    return { errorCode: "PRODUCTION_ACCEPTANCE_ARGUMENT_UNKNOWN" };
  }
  if (topicArguments.length === 0) {
    return { errorCode: "PRODUCTION_ACCEPTANCE_TOPIC_MISSING" };
  }
  if (topicArguments.length > 1) {
    return { errorCode: "PRODUCTION_ACCEPTANCE_TOPIC_DUPLICATE" };
  }
  let options: PipelineResumeOptions = {};
  if (stopArguments.length === 1) {
    const stopAfterStage = stopArguments[0].slice(STOP_AFTER_STAGE_PREFIX.length);
    if (!isPipelineRecoveryStageKey(stopAfterStage)) {
      return { errorCode: pipelineResumeBoundaryInvalidCode };
    }
    options = { stopAfterStage };
  }
  try {
    return {
      topic: normalizeProductionAcceptanceTopic(topicArguments[0].slice(TOPIC_PREFIX.length)),
      options,
    };
  } catch (error) {
    return {
      errorCode: isAuthenticProductionAcceptanceTopicError(error)
        ? error.code
        : "PRODUCTION_ACCEPTANCE_TOPIC_INVALID",
    };
  }
}

function parseResumeArguments(args: readonly string[]):
  | { readonly projectSlug: string; readonly options: PipelineResumeOptions }
  | { readonly errorCode: string } {
  if (args.filter((value) => value === CONFIRM_FLAG).length !== 1) {
    return { errorCode: "PRODUCTION_ACCEPTANCE_CONFIRMATION_REQUIRED" };
  }
  const slugArguments = args.filter((value) => value.startsWith("--project-slug="));
  const stopArguments = args.filter((value) => value.startsWith(STOP_AFTER_STAGE_PREFIX));
  if (
    args.some((value) => value !== CONFIRM_FLAG &&
      !value.startsWith("--project-slug=") &&
      !value.startsWith(STOP_AFTER_STAGE_PREFIX)) ||
    slugArguments.length !== 1 || stopArguments.length > 1
  ) {
    return { errorCode: "PRODUCTION_ACCEPTANCE_ARGUMENT_UNKNOWN" };
  }
  const projectSlug = slugArguments[0].slice("--project-slug=".length);
  if (!SAFE_SLUG.test(projectSlug)) {
    return { errorCode: "PRODUCTION_ACCEPTANCE_ARGUMENT_UNKNOWN" };
  }
  if (stopArguments.length === 0) return { projectSlug, options: {} };
  const stopAfterStage = stopArguments[0].slice(STOP_AFTER_STAGE_PREFIX.length);
  if (!isPipelineRecoveryStageKey(stopAfterStage)) {
    return { errorCode: pipelineResumeBoundaryInvalidCode };
  }
  return {
    projectSlug,
    options: { stopAfterStage },
  };
}

function isPipelineRecoveryStageKey(value: string): value is PipelineRecoveryStageKey {
  return pipelineRecoveryStageOrder.some((stage) => stage === value);
}

function parseRetryBudgetExtensionPlanArguments(args: readonly string[]):
  | { readonly projectSlug: string; readonly stage: ProductionStepKey; readonly jobId: string; readonly reason: string }
  | { readonly errorCode: string } {
  const slug = exactValue(args, "--project-slug=");
  const stage = exactValue(args, "--stage=") as ProductionStepKey | undefined;
  const jobId = exactValue(args, "--job-id=");
  const reason = exactValue(args, "--reason=");
  if (!slug || !stage || !jobId || !reason || !SAFE_SLUG.test(slug) || args.length !== 4) {
    return { errorCode: "PIPELINE_RETRY_BUDGET_EXTENSION_ARGUMENT_INVALID" };
  }
  return { projectSlug: slug, stage, jobId, reason };
}

function parseExtendRetryBudgetArguments(args: readonly string[]):
  | { readonly projectSlug: string; readonly stage: ProductionStepKey; readonly jobId: string; readonly reason: string; readonly authorityId: string; readonly confirmation: string }
  | { readonly errorCode: string } {
  const slug = exactValue(args, "--project-slug=");
  const stage = exactValue(args, "--stage=") as ProductionStepKey | undefined;
  const jobId = exactValue(args, "--job-id=");
  const reason = exactValue(args, "--reason=");
  const authorityId = exactValue(args, "--authority-id=");
  const confirmation = exactValue(args, "--confirm-production-retry-budget-extension=");
  if (!slug || !stage || !jobId || !reason || !authorityId || !confirmation || !SAFE_SLUG.test(slug) || args.length !== 6) {
    return { errorCode: "PIPELINE_RETRY_BUDGET_EXTENSION_ARGUMENT_INVALID" };
  }
  if (authorityId !== confirmation) {
    return { errorCode: "PIPELINE_RETRY_BUDGET_EXTENSION_CONFIRMATION_REQUIRED" };
  }
  return { projectSlug: slug, stage, jobId, reason, authorityId, confirmation };
}

const SANITIZED_PROVIDER_ERROR_CODE = /^[a-z0-9_.-]{1,64}$/;
const SANITIZED_REMEDIATION_NOTE = /^[\x20-\x7E]{1,240}$/;

function parseEnvironmentalFailureRetryOperatorEvidence(args: readonly string[]):
  | { readonly operatorEvidence: EnvironmentalFailureRetryOperatorEvidence }
  | { readonly errorCode: string } {
  const httpStatusRaw = exactValue(args, "--observed-http-status=");
  const providerErrorCode = exactValue(args, "--observed-provider-error-code=");
  const remediationVerified = exactValue(args, "--remediation-verified=");
  const httpStatus = httpStatusRaw !== undefined && /^\d{3}$/.test(httpStatusRaw)
    ? Number(httpStatusRaw) : undefined;
  if (
    httpStatus === undefined ||
    !(environmentalFailureHttpStatuses as readonly number[]).includes(httpStatus) ||
    !providerErrorCode || !SANITIZED_PROVIDER_ERROR_CODE.test(providerErrorCode) ||
    !remediationVerified || !SANITIZED_REMEDIATION_NOTE.test(remediationVerified)
  ) {
    return { errorCode: "ENVIRONMENTAL_FAILURE_RETRY_ARGUMENT_INVALID" };
  }
  return {
    operatorEvidence: {
      observedHttpStatus: httpStatus as EnvironmentalFailureRetryOperatorEvidence["observedHttpStatus"],
      observedProviderErrorCode: providerErrorCode,
      remediationVerified,
    },
  };
}

function parseEnvironmentalFailureRetryPlanArguments(args: readonly string[]):
  | { readonly projectSlug: string; readonly stage: ProductionStepKey; readonly jobId: string;
      readonly reason: string;
      readonly operatorEvidence: EnvironmentalFailureRetryOperatorEvidence }
  | { readonly errorCode: string } {
  const slug = exactValue(args, "--project-slug=");
  const stage = exactValue(args, "--stage=") as ProductionStepKey | undefined;
  const jobId = exactValue(args, "--job-id=");
  const reason = exactValue(args, "--reason=");
  if (!slug || !stage || !jobId || !reason || !SAFE_SLUG.test(slug) || args.length !== 7) {
    return { errorCode: "ENVIRONMENTAL_FAILURE_RETRY_ARGUMENT_INVALID" };
  }
  const evidence = parseEnvironmentalFailureRetryOperatorEvidence(args);
  if ("errorCode" in evidence) return evidence;
  return { projectSlug: slug, stage, jobId, reason, operatorEvidence: evidence.operatorEvidence };
}

function parseApplyEnvironmentalFailureRetryArguments(args: readonly string[]):
  | { readonly projectSlug: string; readonly stage: ProductionStepKey; readonly jobId: string;
      readonly reason: string;
      readonly operatorEvidence: EnvironmentalFailureRetryOperatorEvidence;
      readonly authorityId: string; readonly confirmation: string }
  | { readonly errorCode: string } {
  const slug = exactValue(args, "--project-slug=");
  const stage = exactValue(args, "--stage=") as ProductionStepKey | undefined;
  const jobId = exactValue(args, "--job-id=");
  const reason = exactValue(args, "--reason=");
  const authorityId = exactValue(args, "--authority-id=");
  const confirmation = exactValue(args, "--confirm-environmental-failure-retry=");
  if (!slug || !stage || !jobId || !reason || !authorityId || !confirmation ||
    !SAFE_SLUG.test(slug) || args.length !== 9) {
    return { errorCode: "ENVIRONMENTAL_FAILURE_RETRY_ARGUMENT_INVALID" };
  }
  if (authorityId !== confirmation) {
    return { errorCode: "ENVIRONMENTAL_FAILURE_RETRY_CONFIRMATION_REQUIRED" };
  }
  const evidence = parseEnvironmentalFailureRetryOperatorEvidence(args);
  if ("errorCode" in evidence) return evidence;
  return {
    projectSlug: slug, stage, jobId, reason,
    operatorEvidence: evidence.operatorEvidence, authorityId, confirmation,
  };
}
