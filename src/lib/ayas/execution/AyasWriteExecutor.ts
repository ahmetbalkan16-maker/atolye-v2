/**
 * AYAS write executor — `resume-stage` (spec §12, §14, §15, §16).
 *
 * The ONE place an AYAS request can cause a real pipeline write. It is reached
 * only when `AyasExecutionBridge` is constructed with `writeActionsEnabled:
 * true` (a future gated step — never the default) AND the execution gate is
 * `OPEN` AND a single-use authorization is consumed.
 *
 * It runs EXACTLY ONE stage: `PipelineRunner.resume(projectSlug, {
 * stopAfterStage: stage })` — the bounded, non-recursive resume. It never runs
 * the whole pipeline, never touches another project, never takes a path. The
 * `PipelineRunner` is injected so tests use a mock and never mutate
 * `D:\AtolyeRuntime`.
 */

import type { AyasResumeStageRequest } from "./AyasWriteActionPolicy";
import type { AyasExecutorResult } from "./AyasSafeExecutors";
import { PipelineRunner } from "@/lib/pipeline/PipelineRunner";
import type { PipelineRecoveryPlanner } from "@/lib/pipeline/PipelineRecoveryPlanner";

/** The exact `PipelineRunner` surface the write executor needs — injectable. */
export interface AyasPipelineResumeRunner {
  resume(
    projectSlug: string,
    options: { stopAfterStage?: string },
  ): Promise<{
    success: boolean;
    projectSlug: string;
    resumedFrom: string | null;
    completedStages: readonly string[];
    blocked: boolean;
    reason?: string;
    reasonCode?: string;
    stoppedAfterStage?: string;
  }>;
}

export interface AyasWriteExecutorDeps {
  readonly runner?: AyasPipelineResumeRunner;
  /**
   * Optional pre-flight: confirm the requested stage is still in the project's
   * resume plan right before running (defence against a plan that moved between
   * authorization and execution). Injected in tests.
   */
  readonly planner?: Pick<typeof PipelineRecoveryPlanner, "createResumePlan">;
}

export type AyasWriteExecutor = (request: AyasResumeStageRequest) => Promise<AyasExecutorResult>;

export function createAyasResumeStageExecutor(deps: AyasWriteExecutorDeps = {}): AyasWriteExecutor {
  const runner: AyasPipelineResumeRunner = deps.runner ?? (PipelineRunner as unknown as AyasPipelineResumeRunner);

  return async (request: AyasResumeStageRequest): Promise<AyasExecutorResult> => {
    // Re-check the plan at execution time when a planner is available.
    if (deps.planner) {
      const plan = await deps.planner.createResumePlan(request.projectSlug);
      if (!plan.stagesToRun.includes(request.stage as never)) {
        throw new Error(
          `stage "${request.stage}" is no longer in the resume plan for "${request.projectSlug}"`,
        );
      }
    }

    const result = await runner.resume(request.projectSlug, { stopAfterStage: request.stage });

    // Bounded-run assertion: a resume that ran past the requested stage is a
    // contract violation — fail closed rather than report a partial success.
    if (result.success && result.completedStages.length > 1 && result.stoppedAfterStage !== request.stage) {
      throw new Error(
        `resume ran ${result.completedStages.length} stages but was bounded to "${request.stage}"`,
      );
    }

    return {
      action: "resume-stage",
      write: true,
      sideEffectApplied: result.success,
      summary: result.success
        ? `"${request.projectSlug}" — ${request.stage} aşaması çalıştırıldı (${result.completedStages.join(", ") || "—"}).`
        : `"${request.projectSlug}" — ${request.stage} çalıştırılamadı: ${result.reason ?? result.reasonCode ?? "bilinmeyen"}.`,
      data: {
        slug: request.projectSlug,
        stage: request.stage,
        ranStages: result.completedStages,
        resumedFrom: result.resumedFrom,
        stoppedAfterStage: result.stoppedAfterStage ?? null,
        success: result.success,
        blocked: result.blocked,
        reason: result.reason ?? null,
        reasonCode: result.reasonCode ?? null,
      },
    };
  };
}
