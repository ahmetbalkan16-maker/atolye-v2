import { ProjectManager } from "@/lib/projects/ProjectManager";
import { PipelineJobManager } from "./PipelineJobManager";
import { PipelineQueueScheduler } from "./PipelineQueueScheduler";
import {
  PipelineRecoveryPlanner,
  pipelineRecoveryStageOrder,
} from "./PipelineRecoveryPlanner";
import {
  PipelineStageExecutor,
  type PipelineExecutionState,
  type PipelineStageExecutionOptions,
} from "./PipelineStageExecutor";
import { readProductionAcceptancePolicy } from "@/lib/production/ProductionAcceptancePolicy";
import { validateProductionAcceptancePreflight } from "@/lib/production/ProductionAcceptancePreflight";
import { isPipelineStateError } from "./PipelineStateError";
import { getPipelineErrorEvidence } from "./PipelineErrorEvidence";
import type { ProductionPipelineExecutionAdapter } from "@/lib/production/ProductionPipelineExecutionAdapter";
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
  PipelineResumeResult,
} from "@/types/pipelineRecovery";

export class PipelineRunner {
  private static durableExecution?: Pick<ProductionPipelineExecutionAdapter, "execute">;
  private static continuationAdmission?: PipelineContinuationAdmission;

  static configureDurableExecution(adapter?: Pick<ProductionPipelineExecutionAdapter, "execute">) { this.durableExecution = adapter; }
  static configureContinuationAdmission(admission?: PipelineContinuationAdmission) { this.continuationAdmission = admission; }
  static async run(
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

  static async resume(projectSlug: string): Promise<PipelineResumeResult> {
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

    const state = await PipelineStageExecutor.loadState(projectSlug);

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
      const policy = await readProductionAcceptancePolicy(projectSlug);
      validateStrictProductionResumeState(
        state,
        plan.startStage,
        policy?.strictProductionAcceptance === true,
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
    if (startJob?.status === "failed") {
      const prepared = await prepareFailedStageRetry(projectSlug, startJob.id);
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
    }

    const { completedStages, stopReason } = await this.runScheduledStages(
      projectSlug,
      plan.stagesToRun,
      state,
      "resume",
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

    if (plan.stagesToRun.length > 0) {
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
      plan,
    };
  }

  static async retryStage(
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
    const operation = () => this.continueProjectOnce(projectSlug, stages);
    return this.continuationAdmission
      ? this.continuationAdmission.execute(operation)
      : operation();
  }

  static async dispatchProjectContinuation(
    projectSlug: string,
    stopStage: PipelineRecoveryStageKey = "assembly",
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

    const state = await PipelineStageExecutor.loadState(projectSlug);

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

    const state = await PipelineStageExecutor.loadState(projectSlug);

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
      completed = await this.runPipelineStage(
        projectSlug,
        stage,
        state,
        "retry",
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

  private static async runPipelineStage(
    slug: string,
    stage: ProductionStepKey,
    state: Parameters<typeof PipelineStageExecutor.execute>[2],
    runType: ProjectPackageRunType = "initial",
    onClaimConflict?: () => void,
    stageExecution?: PipelineStageExecutionOptions,
  ) {
    return this.runStage(
      slug,
      stage,
      () => PipelineStageExecutor.execute(slug, stage, state, stageExecution),
      runType,
      onClaimConflict,
    );
  }

  private static async runScheduledStages(
    slug: string,
    stages: readonly PipelineRecoveryStageKey[],
    state: Parameters<typeof PipelineStageExecutor.execute>[2],
    runType: ProjectPackageRunType = "initial",
    stageExecution?: PipelineStageExecutionOptions,
  ): Promise<{
    completedStages: PipelineRecoveryStageKey[];
    stopReason?: string;
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

      const completed = await this.runPipelineStage(
        slug,
        next.stage,
        state,
        runType,
        undefined,
        stageExecution,
      );

      if (!completed) {
        return {
          completedStages,
          stopReason: `Stage "${next.stage}" was cancelled.`,
        };
      }

      completedStages.push(next.stage);
    }
  }

  private static async runStage(
    slug: string,
    stage: ProductionStepKey,
    action: () => Promise<boolean>,
    runType: ProjectPackageRunType,
    onClaimConflict?: () => void,
  ): Promise<boolean> {
    const legacy = () => this.runStageLegacy(slug, stage, action, runType, onClaimConflict);
    return this.durableExecution ? this.durableExecution.execute({ projectSlug: slug, stage, runType }, legacy) : legacy();
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
