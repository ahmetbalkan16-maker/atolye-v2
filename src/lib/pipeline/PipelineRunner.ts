import fs from "node:fs";
import { ProjectManager } from "@/lib/projects/ProjectManager";
import { PipelineJobManager } from "./PipelineJobManager";
import { getRetryBudgetExtensionDirectory } from "@/lib/production/ProductionPipelineRetryBudgetExtensionStore";
import { verifyCanonicalPipelineRetryBudgetExtensionAdmission } from "@/lib/production/ProductionPipelineRetryBudgetExtensionGate";
import { PipelineQueueScheduler } from "./PipelineQueueScheduler";
import {
  PipelineRecoveryPlanner,
  pipelineRecoveryStageOrder,
} from "./PipelineRecoveryPlanner";
import {
  PipelineStageExecutor,
  materializePipelineStageExecutionOptions,
  type PipelineExecutionState,
  type PipelineStageExecutionOptions,
} from "./PipelineStageExecutor";
import { validateProductionAcceptancePreflight } from "@/lib/production/ProductionAcceptancePreflight";
import { isPipelineStateError } from "./PipelineStateError";
import { getPipelineErrorEvidence } from "./PipelineErrorEvidence";
import {
  isAuthenticProductionPipelineDurableExecutionError,
  type ProductionPipelineExecutionAdapter,
} from "@/lib/production/ProductionPipelineExecutionAdapter";
import { executeConfiguredProductionPipelineStage,
  type ProductionPipelineCompletedPreparationAuthority } from
  "@/lib/production/ProductionPipelineExecutionFactory";
import {
  issueProductionAcceptanceStageCapability,
  type ProductionAcceptanceStageCapability,
  type ProductionAcceptanceStageExecutionIdentity,
} from "@/lib/production/ProductionAcceptancePolicy";
import { createProductionAcceptanceProviderSelection,
  createProductionAcceptanceStageExecutionScope,
  type ProductionAcceptanceProviderSelection } from
  "@/lib/production/ProductionAcceptanceExecutionScope";
import { requireRegenerationExecutionAdmission } from
  "@/lib/production/ProductionCompletedStageRegenerationStore";
import { emitProductionPipelineExecutionEvent } from
  "@/lib/production/ProductionPipelineExecutionInstrumentation";
import { withProductionAcceptanceRetryAdmission } from
  "@/lib/production/ProductionAcceptanceLegacyAdmissionContext";
import { prepareFailedStageRetry } from "./PipelineFailedStageRetry";
import type {
  ProductionStepKey,
  ProjectPackageRunType,
  ProjectStatus,
} from "@/types/project";
import type {
  PipelineJobRetryExecutionResult,
  PipelineRecoveryStageKey,
  PipelineRetryResult,
  PipelineResumeOptions,
  PipelineResumeResult,
} from "@/types/pipelineRecovery";
import type { PipelineRetryAdmission } from "./PipelineRetryAdmission";
import type { PipelineJob } from "@/types/pipelineJob";
import { ProductionRuntimeOperationContextError, getActiveProductionRuntimeOperationContext,
  requireProductionRuntimeStorageContext } from "@/lib/runtime/ProductionRuntimeOperationContext";
import { ProjectReader } from "@/lib/projects/ProjectReader";
import { ProductionExecutionFilePersistenceAdapter } from
  "@/lib/production/ProductionExecutionPersistence";
import { classifyQueuedExhaustedPipelineJobDrift,
  queuedExhaustedDriftReasonCode } from
  "@/lib/production/ProductionQueuedExhaustedDriftClassifier";
import { classifyProductionDurableAttemptLineage } from
  "@/lib/production/ProductionDurableAttemptLineageClassifier";
import { findConsumedRegenerationRetryBudgetExtension } from
  "@/lib/production/ProductionPipelineRegenerationRetryBudgetExtension";
import {
  assertPipelineRunnerProductionRuntimeOperationActive,
  executePipelineRunnerProductionRuntimeOperation,
} from "./PipelineRunnerCanonicalRuntime";

export { installPipelineRunnerProductionRuntime } from "./PipelineRunnerCanonicalRuntime";

export const pipelineResumeBoundaryInvalidCode = "PIPELINE_RESUME_BOUNDARY_INVALID";

/**
 * Module-private, fail-closed parser for consumed retry-budget-extension receipt filenames.
 *
 * Expected format: `receipt-<authority-id>-consumed.json`
 * - Authority ID must match `[a-z0-9-]{16,128}` (lowercase alphanum + dash only).
 * - Rejects files with path separators, uppercase letters, empty IDs, wrong prefix/suffix,
 *   extra suffixes, and traversal-style names.
 *
 * Returns `undefined` for any invalid input (fail-closed).
 */
function parseConsumedRetryBudgetAuthorityId(
  fileName: string,
): string | undefined {
  const prefix = "receipt-";
  const suffix = "-consumed.json";

  // Reject path separators (traversal defence)
  if (fileName.includes("/") || fileName.includes("\\") || fileName.includes("\0")) {
    return undefined;
  }

  // Exact prefix + suffix check
  if (!fileName.startsWith(prefix) || !fileName.endsWith(suffix)) {
    return undefined;
  }

  // Ensure prefix and suffix don't overlap
  if (fileName.length <= prefix.length + suffix.length) {
    return undefined;
  }

  const authorityId = fileName.slice(
    prefix.length,
    fileName.length - suffix.length,
  );

  // Must be non-empty, lowercase alphanumeric + dash, length 16–128
  if (!/^[a-z0-9-]{16,128}$/.test(authorityId)) {
    return undefined;
  }

  return authorityId;
}

export class PipelineRunner {
  private static continuationAdmission?: PipelineContinuationAdmission;

  /** @deprecated Arbitrary durable adapters are rejected; production wiring is canonical. */
  static configureDurableExecution(_adapter?: Pick<ProductionPipelineExecutionAdapter, "execute">): void {
    void _adapter;
    throw new ProductionRuntimeOperationContextError("RUNTIME_OPERATION_CONTEXT_INVALID");
  }
  static configureContinuationAdmission(admission?: PipelineContinuationAdmission) { this.continuationAdmission = admission; }
  /** @internal Exact process-state access for scoped canonical composition. */
  static snapshotContinuationAdmission(): PipelineContinuationAdmission | undefined {
    return this.continuationAdmission;
  }
  /** @internal Restore only when no foreign registration replaced the scoped value. */
  static restoreContinuationAdmission(
    previous: PipelineContinuationAdmission | undefined,
    expectedCurrent: PipelineContinuationAdmission | undefined,
  ): void {
    if (this.continuationAdmission !== expectedCurrent) {
      throw new ProductionRuntimeOperationContextError("RUNTIME_OPERATION_CONTEXT_MISMATCH");
    }
    this.continuationAdmission = previous;
  }
  static async run(
    topic: string,
    options: { stageExecution?: PipelineStageExecutionOptions } = {},
  ) {
    return this.withRuntimeOperation(
      "pipeline-run",
      () => this.runOnce(topic, options),
    );
  }

  private static async runOnce(
    topic: string,
    options: { stageExecution?: PipelineStageExecutionOptions } = {},
  ) {
    const slug = ProjectManager.createSlug(topic);
    const project = await ProjectManager.createProject(topic);
    const state = PipelineStageExecutor.createInitialState(project);

    try {
      const { stopReason } = await this.runScheduledStages(
        slug,
        pipelineRecoveryStageOrder,
        state,
        "initial",
        options.stageExecution,
      );

      if (!stopReason) {
        await PipelineJobManager.persistProjectCompletion(slug, async () => {
          await ProjectManager.updateStatus(slug, "completed");
        });
      }

      return {
        success: !stopReason,
        slug,
        stopReason,
        project,
        research: state.research,
        script: state.script,
        scenes: state.scenes,
        visuals: state.visuals,
        animation: state.animation,
        video: state.video,
        audio: state.audio,
        assembly: state.assembly,
        thumbnail: state.thumbnail,
        seo: state.seo,
        youtube: state.youtube,
        export: state.exportPackage,
      };
    } catch (error) {
      if (!isPipelineStateError(error)) {
        console.error("[PipelineRunner] Pipeline failed:", {
          slug,
          topic,
          error,
        });
      }

      throw error;
    }
  }

  static async resume(
    projectSlug: string,
    options: PipelineResumeOptions = {},
  ): Promise<PipelineResumeResult> {
    return this.withRuntimeOperation(
      "pipeline-resume",
      () => this.resumeOnce(projectSlug, options),
    );
  }

  private static async resumeOnce(
    projectSlug: string,
    options: PipelineResumeOptions,
  ): Promise<PipelineResumeResult> {
    const plan = await PipelineRecoveryPlanner.createResumePlan(projectSlug);

    if (plan.blocked || !plan.startStage) {
      return {
        success: false,
        projectSlug,
        resumedFrom: plan.startStage,
        completedStages: [],
        blocked: plan.blocked,
        reason: plan.reason,
        plan,
      };
    }

    if (!validResumeBoundary(plan, options.stopAfterStage)) {
      return {
        success: false,
        projectSlug,
        resumedFrom: plan.startStage,
        completedStages: [],
        blocked: true,
        reason: "Requested resume boundary is outside the recovery plan.",
        reasonCode: pipelineResumeBoundaryInvalidCode,
        plan,
      };
    }

    const storageContext = this.requireRuntimeStorageContext();
    const state = await PipelineStageExecutor.loadState(projectSlug, storageContext);

    if (!state) {
      return {
        success: false,
        projectSlug,
        resumedFrom: plan.startStage,
        completedStages: [],
        blocked: true,
        reason: "Project could not be read.",
        plan,
      };
    }
    try {
      validateStrictProductionResumeState(
        state,
        plan.startStage,
        true,
      );
    } catch {
      return {
        success: false,
        projectSlug,
        resumedFrom: plan.startStage,
        completedStages: [],
        blocked: true,
        reason: "Strict production acceptance preflight failed.",
        plan,
      };
    }

    const startJob = await PipelineJobManager.getJobForStageReadOnly(
      projectSlug,
      plan.startStage,
    );
    if (startJob?.status === "queued") {
      const [manifest, jobs, history] = await Promise.all([
        ProjectManager.getManifest(projectSlug, storageContext),
        PipelineJobManager.listJobsReadOnly(projectSlug, storageContext),
        PipelineJobManager.listHistory(projectSlug),
      ]);
      if (manifest?.packages[plan.startStage]?.status === "failed") {
        let isConsumedExtensionResume = false;
        if (startJob.attempts === 3) {
          const context = storageContext;
          const dir = getRetryBudgetExtensionDirectory(projectSlug, context);
          if (fs.existsSync(dir)) {
            try {
              const files = fs.readdirSync(dir);
              for (const file of files) {
                const authId = parseConsumedRetryBudgetAuthorityId(file);
                if (!authId) continue;
                const gateCheck = await verifyCanonicalPipelineRetryBudgetExtensionAdmission({
                  phase: "before-durable-preparation",
                  projectSlug,
                  stage: plan.startStage,
                  jobId: startJob.id,
                  runType: "resume",
                  authorityId: authId,
                  jobVersion: startJob.updatedAt,
                  input: context,
                });
                if (gateCheck.ok) {
                  isConsumedExtensionResume = true;
                  break;
                }
              }
            } catch { /* ignore */ }
          }
        }

        // Sibling of the block above, for a generation-2+ (regeneration) retry
        // admitted via the P3 ProductionPipelineRegenerationRetryBudgetExtension
        // mechanism instead of the P1/P2 ordinal-4 one. Deliberately gated on
        // startJob.regenerationId being present, so it can never engage for a
        // non-regeneration job -- the attempts===3 branch above is untouched
        // and still runs first/independently for that case. attempts===6 (or
        // any other value) is never, by itself, treated as sufficient --
        // findConsumedRegenerationRetryBudgetExtension requires an actual
        // matching, consumed, jobVersion-bound authority, and the durable
        // lineage is independently re-verified against the exact prior
        // attempt ordinal the matched authority itself recorded.
        if (!isConsumedExtensionResume && startJob.regenerationId &&
          Number.isSafeInteger(startJob.generationOrdinal)) {
          const regenMatch = findConsumedRegenerationRetryBudgetExtension(
            projectSlug, plan.startStage, startJob, storageContext,
          );
          if (regenMatch) {
            const lineage = await classifyProductionDurableAttemptLineage(
              new ProductionExecutionFilePersistenceAdapter({
                trustedRootDirectory:
                  `${ProjectReader.getProjectFolder(projectSlug)}/production-execution`,
                createRootDirectory: false,
              }),
              projectSlug, plan.startStage, regenMatch.body.priorJob.attempts, "exact",
            );
            if (lineage.status === "valid") {
              isConsumedExtensionResume = true;
            }
          }
        }

        if (!isConsumedExtensionResume) {
          const drift = await classifyQueuedExhaustedPipelineJobDrift({
            projectSlug, stage: plan.startStage, jobs, history, manifest,
            adapter: new ProductionExecutionFilePersistenceAdapter({
              trustedRootDirectory:
                `${ProjectReader.getProjectFolder(projectSlug)}/production-execution`,
              createRootDirectory: false,
            }),
          });
          return {
            success: false,
            projectSlug,
            resumedFrom: plan.startStage,
            completedStages: [],
            blocked: true,
            reason: drift.status === "exact-drift"
              ? "Queued job is in exhausted drift state."
              : "Queued retry state failed exact durable classification.",
            reasonCode: drift.status === "exact-drift"
              ? queuedExhaustedDriftReasonCode
              : "PIPELINE_RETRY_DURABLE_CONFLICT",
            plan,
          };
        }
      }
    }
    let resumeRetry: { admission: PipelineRetryAdmission;
      previousJob: NonNullable<typeof startJob> } | undefined;
    if (startJob?.status === "failed") {
      const prepared = await prepareFailedStageRetry(projectSlug, startJob.id, "resume");
      if (!prepared.success) {
        return {
          success: false,
          projectSlug,
          resumedFrom: plan.startStage,
          completedStages: [],
          blocked: true,
          reason: prepared.reason,
          reasonCode: prepared.reasonCode,
          plan,
        };
      }
      resumeRetry = { admission: prepared.admission, previousJob: prepared.previousJob };
    }

    const { completedStages, stopReason, stoppedAfterStage } = await this.runScheduledStages(
      projectSlug, plan.stagesToRun, state, "resume", undefined, resumeRetry,
      options.stopAfterStage,
    );

    if (stopReason) {
      return {
        success: false,
        projectSlug,
        resumedFrom: plan.startStage,
        completedStages,
        blocked: true,
        reason: stopReason,
        reasonCode: "PIPELINE_RETRY_SCHEDULER_CONFLICT",
        plan,
      };
    }

    if (options.stopAfterStage && stoppedAfterStage !== options.stopAfterStage) {
      return {
        success: false,
        projectSlug,
        resumedFrom: plan.startStage,
        completedStages,
        blocked: true,
        reason: "Requested resume boundary was not reached.",
        reasonCode: "PIPELINE_RETRY_SCHEDULER_CONFLICT",
        plan,
      };
    }

    if (!stoppedAfterStage && plan.stagesToRun.length > 0) {
      const exportCompleted = await this.isStageCompleted(projectSlug, "export");

      if (exportCompleted) {
        await PipelineJobManager.persistProjectCompletion(
          projectSlug,
          async () => {
            await ProjectManager.updateStatus(projectSlug, "completed");
          },
        );
      }
    }

    return {
      success: true,
      projectSlug,
      resumedFrom: plan.startStage,
      completedStages,
      blocked: false,
      ...(stoppedAfterStage ? { stoppedAfterStage } : {}),
      plan,
    };
  }

  static async retryStage(
    projectSlug: string,
    stage: PipelineRecoveryStageKey,
  ): Promise<PipelineRetryResult> {
    return this.withRuntimeOperation(
      "pipeline-retry-stage",
      () => this.retryStageOnce(projectSlug, stage),
    );
  }

  private static async retryStageOnce(
    projectSlug: string,
    stage: PipelineRecoveryStageKey,
  ): Promise<PipelineRetryResult> {
    const job = await PipelineJobManager.getJobForStageReadOnly(
      projectSlug,
      stage,
    );
    const result = await this.executeJobRetry(
      projectSlug,
      job?.id ?? `${projectSlug}-${stage}`,
    );
    const plan =
      result.plan ??
      (await PipelineRecoveryPlanner.createJobRetryPlan(projectSlug, stage));

    return {
      success: result.success,
      status: result.status === 404 ? 409 : result.status,
      projectSlug,
      retriedStage: stage,
      completedStages: result.completedStages,
      blocked: result.blocked,
      reason: result.reason,
      reasonCode: result.reasonCode,
      plan,
    };
  }

  static async continueProject(
    projectSlug: string,
    stages: readonly PipelineRecoveryStageKey[] = pipelineRecoveryStageOrder,
  ): Promise<PipelineContinuationResult> {
    return this.withRuntimeOperation(
      "pipeline-continue",
      () => this.continueProjectScoped(projectSlug, stages),
    );
  }

  private static async continueProjectScoped(
    projectSlug: string,
    stages: readonly PipelineRecoveryStageKey[],
  ): Promise<PipelineContinuationResult> {
    const operation = () => this.continueProjectOnce(projectSlug, stages);
    return this.continuationAdmission
      ? this.continuationAdmission.execute(operation)
      : operation();
  }

  static async dispatchProjectContinuation(
    projectSlug: string,
    stopStage: PipelineRecoveryStageKey = "assembly",
  ): Promise<PipelineContinuationDispatchResult> {
    return this.withRuntimeOperation(
      "pipeline-dispatch-continuation",
      () => this.dispatchProjectContinuationOnce(projectSlug, stopStage),
    );
  }

  private static async dispatchProjectContinuationOnce(
    projectSlug: string,
    stopStage: PipelineRecoveryStageKey,
  ): Promise<PipelineContinuationDispatchResult> {
    const completedStages: PipelineRecoveryStageKey[] = [];
    const stopIndex = pipelineRecoveryStageOrder.indexOf(stopStage);
    const continuationStageOrder = pipelineRecoveryStageOrder.slice(
      0,
      stopIndex + 1,
    );

    for (let iteration = 0; iteration < continuationStageOrder.length; iteration++) {
      const jobList = await PipelineJobManager.listJobsReadOnly(projectSlug);
      const queuedStage = continuationStageOrder.find((stage) =>
        jobList.jobs.some(
          (job) => job.stage === stage && job.status === "queued",
        ),
      );

      if (!queuedStage || !continuationStageOrder.includes(queuedStage)) {
        return { completedStages, iterations: iteration };
      }

      const result = await this.continueProject(projectSlug, continuationStageOrder);

      if (!result.continued) {
        return {
          completedStages,
          iterations: iteration + 1,
          reason: result.reason,
        };
      }

      if (!result.completed) {
        return {
          completedStages,
          iterations: iteration + 1,
          reason: result.reason,
        };
      }

      completedStages.push(result.stage);

      if (result.stage === stopStage) {
        return {
          completedStages,
          iterations: iteration + 1,
          terminal: true,
        };
      }
    }

    return {
      completedStages,
      iterations: continuationStageOrder.length,
      reason: "Pipeline continuation iteration limit reached.",
    };
  }

  private static async continueProjectOnce(
    projectSlug: string,
    stages: readonly PipelineRecoveryStageKey[],
  ): Promise<PipelineContinuationResult> {
    const jobList = await PipelineJobManager.listJobsReadOnly(projectSlug);
    const queuedStage = stages.find((stage) =>
      jobList.jobs.some(
        (job) => job.stage === stage && job.status === "queued",
      ),
    );

    if (!queuedStage) {
      return { continued: false };
    }

    const queuedStageIndex = stages.indexOf(queuedStage);
    const scheduled = await PipelineQueueScheduler.getNextRunnableStage(
      projectSlug,
      stages.slice(0, queuedStageIndex + 1),
    );

    if (scheduled.stage !== queuedStage) {
      return {
        continued: false,
        reason: scheduled.reason,
      };
    }

    const plan = await PipelineRecoveryPlanner.createJobRetryPlan(
      projectSlug,
      queuedStage,
    );

    if (plan.blocked) {
      return {
        continued: false,
        reason: plan.reason,
      };
    }

    const state = await PipelineStageExecutor.loadState(
      projectSlug, this.requireRuntimeStorageContext());

    if (!state) {
      return {
        continued: false,
        reason: "Project could not be read.",
      };
    }

    let claimed = true;
    let completed: boolean;

    try {
      completed = await this.runPipelineStage(
        projectSlug,
        queuedStage,
        state,
        "initial",
        () => {
          claimed = false;
        },
      );
    } catch (error) {
      if (isPipelineStateError(error)) {
        throw error;
      }
      if (await isProvenContinuationContenderLoss(
        error,
        projectSlug,
        queuedStage,
      )) {
        return {
          continued: false,
          reason: `Stage "${queuedStage}" could not be claimed.`,
        };
      }

      return {
        continued: true,
        stage: queuedStage,
        completed: false,
        reason: "Pipeline continuation execution failed.",
      };
    }

    if (!claimed) {
      return {
        continued: false,
        reason: `Stage "${queuedStage}" could not be claimed.`,
      };
    }

    if (completed && queuedStage === "export") {
      await PipelineJobManager.persistProjectCompletion(
        projectSlug,
        async () => {
          await ProjectManager.updateStatus(projectSlug, "completed");
        },
      );
    }

    return {
      continued: true,
      stage: queuedStage,
      completed,
      reason: completed
        ? undefined
        : `Stage "${queuedStage}" was cancelled.`,
    };
  }

  static async executeJobRetry(
    projectSlug: string,
    jobId: string,
    options: { stageExecution?: PipelineStageExecutionOptions } = {},
  ): Promise<PipelineJobRetryExecutionResult> {
    return this.withRuntimeOperation(
      "pipeline-execute-job-retry",
      () => this.executeJobRetryOnce(projectSlug, jobId, options),
    );
  }

  private static async executeJobRetryOnce(
    projectSlug: string,
    jobId: string,
    options: { stageExecution?: PipelineStageExecutionOptions },
  ): Promise<PipelineJobRetryExecutionResult> {
    const existingJob = await PipelineJobManager.getJobReadOnly(
      projectSlug,
      jobId,
    );
    const stage = existingJob?.stage ?? getRetryStageFromJobId(projectSlug, jobId);

    if (!stage) {
      return {
        success: false,
        status: 404,
        projectSlug,
        jobId,
        completedStages: [],
        blocked: true,
        reason: "Pipeline job not found.",
      };
    }

    const plan = await PipelineRecoveryPlanner.createJobRetryPlan(
      projectSlug,
      stage,
    );

    if (plan.blocked) {
      return {
        success: false,
        status: 409,
        projectSlug,
        jobId,
        retriedStage: stage,
        completedStages: [],
        blocked: true,
        reason: plan.reason,
        plan,
      };
    }

    const state = await PipelineStageExecutor.loadState(
      projectSlug, this.requireRuntimeStorageContext());

    if (!state) {
      return {
        success: false,
        status: 409,
        projectSlug,
        jobId,
        retriedStage: stage,
        completedStages: [],
        blocked: true,
        reason: "Project could not be read.",
        plan,
      };
    }

    const prepared = await prepareFailedStageRetry(projectSlug, jobId);

    if (!prepared.success) {
      return {
        success: false,
        status: prepared.status,
        projectSlug,
        jobId,
        retriedStage: stage,
        completedStages: [],
        blocked: true,
        reason: prepared.reason,
        reasonCode: prepared.reasonCode,
      };
    }

    const scheduled = await PipelineQueueScheduler.getNextRunnableStage(
      projectSlug,
      [stage],
    );

    if (scheduled.stage !== stage) {
      try {
        const compensated = await PipelineJobManager.compensatePreparedRetry(
          projectSlug,
          prepared.previousJob,
          prepared.job,
        );
        if (!compensated) throw new Error("PIPELINE_RETRY_COMPENSATION_FAILED");
      } catch (error) {
        if (isPipelineStateError(error)) {
          throw error;
        }

        return {
          success: false,
          status: 500,
          projectSlug,
          jobId,
          retriedStage: stage,
          completedStages: [],
          blocked: false,
          reason: "Pipeline retry compensation failed.",
          reasonCode: "PIPELINE_RETRY_COMPENSATION_FAILED",
          plan,
        };
      }

      return {
        success: false,
        status: 409,
        projectSlug,
        jobId,
        retriedStage: stage,
        completedStages: [],
        blocked: true,
        reason: scheduled.reason || `Stage "${stage}" could not be scheduled.`,
        reasonCode: "PIPELINE_RETRY_SCHEDULER_CONFLICT",
        plan,
      };
    }

    let completed: boolean;

    try {
      completed = await withProductionAcceptanceRetryAdmission(
        prepared.admission,
        prepared.previousJob,
        () => this.runPipelineStage(
          projectSlug,
          stage,
          state,
          "retry",
          undefined,
          options.stageExecution,
        ),
      );
    } catch (error) {
      if (isPipelineStateError(error)) {
        throw error;
      }

      return {
        success: false,
        status: 500,
        projectSlug,
        jobId,
        retriedStage: stage,
        completedStages: [],
        blocked: false,
        reason: "Pipeline retry execution failed.",
        reasonCode: retryExecutionReasonCode(error),
        plan,
      };
    }

    if (!completed) {
      return {
        success: false,
        status: 409,
        projectSlug,
        jobId,
        retriedStage: stage,
        completedStages: [],
        blocked: true,
        reason: `Stage "${stage}" was cancelled.`,
        reasonCode: "PIPELINE_RETRY_EXECUTION_ADMISSION_FAILED",
        plan,
      };
    }

    try {
      const retryStageIndex = pipelineRecoveryStageOrder.indexOf(stage);
      const assemblyIndex = pipelineRecoveryStageOrder.indexOf("assembly");
      await this.dispatchProjectContinuation(
        projectSlug,
        retryStageIndex <= assemblyIndex ? "assembly" : "export",
      );
    } catch (error) {
      console.error("[PipelineRunner] Pipeline continuation after retry failed:", {
        projectSlug,
        stage,
        error,
      });
    }

    return {
      success: true,
      status: 200,
      projectSlug,
      jobId,
      retriedStage: stage,
      completedStages: [stage],
      blocked: false,
      plan,
    };
  }

  private static withRuntimeOperation<T>(
    operationType: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    return executePipelineRunnerProductionRuntimeOperation(operationType, operation);
  }

  private static requireRuntimeStorageContext() {
    const context = getActiveProductionRuntimeOperationContext();
    if (!context) throw new ProductionRuntimeOperationContextError("RUNTIME_OPERATION_CONTEXT_MISSING");
    return requireProductionRuntimeStorageContext(context);
  }

  private static async runPipelineStage(
    slug: string,
    stage: ProductionStepKey,
    state: Parameters<typeof PipelineStageExecutor.execute>[2],
    runType: ProjectPackageRunType = "initial",
    onClaimConflict?: () => void,
    stageExecution?: PipelineStageExecutionOptions,
  ) {
    const materializedProviders = materializePipelineStageExecutionOptions(stage, stageExecution);
    const providerSelection = createProductionAcceptanceProviderSelection(
      stage, materializedProviders.options, materializedProviders.configuredOptions,
    );
    return this.runStage(
      slug,
      stage,
      (capability, identity) => PipelineStageExecutor.execute(
        slug, stage, state, providerSelection.dispatchOptions as PipelineStageExecutionOptions,
        capability, identity, runType,
        providerSelection,
        this.requireRuntimeStorageContext(),
      ),
      runType,
      onClaimConflict,
      stageExecution,
      providerSelection,
    );
  }

  private static async runScheduledStages(
    slug: string,
    stages: readonly PipelineRecoveryStageKey[],
    state: Parameters<typeof PipelineStageExecutor.execute>[2],
    runType: ProjectPackageRunType = "initial",
    stageExecution?: PipelineStageExecutionOptions,
    retryAdmission?: { admission: PipelineRetryAdmission; previousJob: PipelineJob },
    stopAfterStage?: PipelineRecoveryStageKey,
  ): Promise<{
    completedStages: PipelineRecoveryStageKey[];
    stopReason?: string;
    stoppedAfterStage?: PipelineRecoveryStageKey;
  }> {
    const completedStages: PipelineRecoveryStageKey[] = [];

    while (true) {
      const next = await PipelineQueueScheduler.getNextRunnableStage(
        slug,
        stages,
      );

      if (!next.stage) {
        return {
          completedStages,
          stopReason:
            next.reason === "No queued stage is available."
              ? undefined
              : next.reason,
        };
      }
      const nextStage = next.stage;

      const execute = () => this.runPipelineStage(
        slug, nextStage, state, runType, undefined, stageExecution,
      );
      const completed = retryAdmission?.admission.stage === nextStage
        ? await withProductionAcceptanceRetryAdmission(
          retryAdmission.admission, retryAdmission.previousJob, execute,
        )
        : await execute();

      if (!completed) {
        return {
          completedStages,
          stopReason: `Stage "${nextStage}" was cancelled.`,
        };
      }

      completedStages.push(nextStage);
      if (nextStage === stopAfterStage) {
        return { completedStages, stoppedAfterStage: nextStage };
      }
    }
  }

  private static async runStage(
    slug: string,
    stage: ProductionStepKey,
    action: (capability: ProductionAcceptanceStageCapability | undefined,
      identity: ProductionAcceptanceStageExecutionIdentity) => Promise<boolean>,
    runType: ProjectPackageRunType,
    onClaimConflict?: () => void,
    stageExecution?: PipelineStageExecutionOptions,
    providerSelection: ProductionAcceptanceProviderSelection =
      createProductionAcceptanceProviderSelection(stage, stageExecution),
  ): Promise<boolean> {
    assertPipelineRunnerProductionRuntimeOperationActive();
    return PipelineJobManager.withProjectLock(slug, async () => {
      const existingJob = await PipelineJobManager.getJobForStageReadOnly(slug, stage);
      if (existingJob?.status === "completed") {
        onClaimConflict?.();
        return false;
      }
      const regeneration = requireRegenerationExecutionAdmission(slug, stage, existingJob);
      const legacy = (_capability: ProductionAcceptanceStageCapability | undefined,
        identity: ProductionAcceptanceStageExecutionIdentity,
        authority: ProductionPipelineCompletedPreparationAuthority) =>
        this.runStageLegacy(slug, stage, async () => {
          const executionScope = createProductionAcceptanceStageExecutionScope({
            projectSlug: slug,
            stage,
            runType,
            operation: identity.operation,
            executionFingerprint: identity.executionFingerprint,
            providerSelection,
            regeneration,
          });
          await emitProductionPipelineExecutionEvent("capability-issuance-entered", { stage });
          return action(
            await issueProductionAcceptanceStageCapability(authority, executionScope),
            identity,
          );
        }, runType, onClaimConflict);
      return executeConfiguredProductionPipelineStage({ projectSlug: slug, stage, runType,
        providerSelection, regeneration }, legacy);
    }, `${slug}-${stage}`);
  }

  private static async runStageLegacy(
    slug: string,
    stage: ProductionStepKey,
    action: () => Promise<boolean>,
    runType: ProjectPackageRunType,
    onClaimConflict?: () => void,
  ): Promise<boolean> {
    const started = await PipelineJobManager.startStage(
      slug,
      stage,
      async () => {
        await ProjectManager.updateStatus(slug, stage as ProjectStatus);
        await ProjectManager.updatePackageStatus(
          slug,
          stage,
          "running",
          undefined,
          { runType },
        );
      },
    );

    if (!started) {
      onClaimConflict?.();
      return false;
    }

    try {
      return await action();
    } catch (error) {
      if (isPipelineStateError(error)) {
        throw error;
      }

      const message =
        error instanceof Error ? error.message : "Pipeline stage failed.";
      const errorEvidence = getPipelineErrorEvidence(error);
      const errorCode = canonicalErrorCode(error) ?? message;

      await PipelineJobManager.persistStageFailure(
        slug,
        stage,
        async () => {
          await ProjectManager.updatePackageStatus(
            slug,
            stage,
            "failed",
            errorCode,
            { errorEvidence },
          );
        },
        errorCode,
        errorEvidence,
      );
      console.error("[PipelineRunner] Stage failed:", {
        slug,
        stage,
        error,
      });

      throw error;
    }
  }

  private static async isStageCompleted(
    projectSlug: string,
    stage: PipelineRecoveryStageKey,
  ) {
    const manifest = await ProjectManager.getManifest(projectSlug);

    return manifest?.packages[stage].status === "completed";
  }
}

function validResumeBoundary(
  plan: { readonly startStage: PipelineRecoveryStageKey | null;
    readonly stagesToRun: readonly PipelineRecoveryStageKey[] },
  stopAfterStage: PipelineRecoveryStageKey | undefined,
): boolean {
  if (stopAfterStage === undefined) return true;
  if (!pipelineRecoveryStageOrder.includes(stopAfterStage) || !plan.startStage) return false;
  const startIndex = pipelineRecoveryStageOrder.indexOf(plan.startStage);
  const stopIndex = pipelineRecoveryStageOrder.indexOf(stopAfterStage);
  return stopIndex >= startIndex && plan.stagesToRun.includes(stopAfterStage);
}

const continuationContenderLossCodes = new Set([
  "WORKER_EXECUTION_OWNERSHIP_CONFLICT",
  "CLAIM_NEXT_VERSION_CONFLICT",
  "CLAIM_VERSION_CONFLICT",
  "CLAIM_OWNER_MISMATCH",
  "LEASE_OWNERSHIP_CONFLICT",
  "LEASE_NEXT_VERSION_CONFLICT",
  "DURABLE_STORAGE_VERSION_CONFLICT",
  "DURABLE_STORAGE_STALE_WRITE",
  "DURABLE_STORAGE_ATOMIC_WRITE_FAILED",
]);

async function isProvenContinuationContenderLoss(
  error: unknown,
  projectSlug: string,
  stage: ProductionStepKey,
): Promise<boolean> {
  if (!isAuthenticProductionPipelineDurableExecutionError(error) ||
    !continuationContenderLossCodes.has(error.reasonCode)) return false;
  const jobId = `${projectSlug}-${stage}`;
  for (let attempt = 0; attempt < 50; attempt++) {
    const job = await PipelineJobManager.getJobReadOnly(projectSlug, jobId);
    if (job?.status === "running" || job?.status === "completed") return true;
    if (job?.status !== "queued") return false;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  return false;
}

export function validateStrictProductionResumeState(
  state: PipelineExecutionState,
  startStage: PipelineRecoveryStageKey,
  strictProductionAcceptance: boolean,
) {
  if (
    strictProductionAcceptance &&
    pipelineRecoveryStageOrder.indexOf(startStage) >
      pipelineRecoveryStageOrder.indexOf("scenes")
  ) {
    if (!state.script || !state.scenes) throw new Error("Strict preflight failed.");
    validateProductionAcceptancePreflight(state.script, state.scenes);
  }
}

export type PipelineContinuationResult =
  | {
      continued: false;
      reason?: string;
    }
  | {
      continued: true;
      stage: PipelineRecoveryStageKey;
      completed: boolean;
      reason?: string;
    };

export interface PipelineContinuationDispatchResult {
  completedStages: PipelineRecoveryStageKey[];
  iterations: number;
  terminal?: true;
  reason?: string;
}

interface PipelineContinuationAdmission {
  execute<T>(operation: () => T | Promise<T>): Promise<T>;
}

function retryExecutionReasonCode(error: unknown) {
  const candidate = error as { reasonCode?: unknown };
  return typeof candidate?.reasonCode === "string" && /^[A-Z0-9_]{1,100}$/.test(candidate.reasonCode)
    ? candidate.reasonCode
    : "PIPELINE_RETRY_EXECUTION_ADMISSION_FAILED";
}

function canonicalErrorCode(error: unknown) {
  const candidate = error as { code?: unknown };
  return typeof candidate?.code === "string" && /^[A-Z0-9_]{1,80}$/.test(candidate.code)
    ? candidate.code
    : undefined;
}

function getRetryStageFromJobId(
  projectSlug: string,
  jobId: string,
): PipelineRecoveryStageKey | null {
  const prefix = `${projectSlug}-`;

  if (!jobId.startsWith(prefix)) {
    return null;
  }

  const stage = jobId.slice(prefix.length) as PipelineRecoveryStageKey;

  return pipelineRecoveryStageOrder.includes(stage) ? stage : null;
}
