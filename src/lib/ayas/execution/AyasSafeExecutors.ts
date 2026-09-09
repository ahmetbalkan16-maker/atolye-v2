/**
 * AYAS safe executors — the actual allowlisted action implementations (spec §9).
 *
 * Every executor here is **read-only**: no writes, no process spawn, no shell,
 * no network. Paths resolve through the runtime storage authority
 * (`ProjectReader` → `resolveRuntimeStorageContext` → `D:\AtolyeRuntime`), never
 * a repo-local root. Arguments are already typed + validated by
 * `AyasExecutionPolicy` before they reach here.
 *
 * `run-pipeline-stage` and friends (real writes via `PipelineRunner`) are
 * deliberately absent — enabling one is its own gated sprint.
 */

import { ProjectReader } from "@/lib/projects/ProjectReader";
import { PipelineRecoveryPlanner } from "@/lib/pipeline/PipelineRecoveryPlanner";
import type { AyasExecutionActionId, AyasExecutionRequest } from "./AyasExecutionPolicy";

export interface AyasExecutorResult {
  /** An enabled read-only action id, or `"resume-stage"` for the write executor. */
  readonly action: AyasExecutionActionId | "resume-stage";
  /** `true` only for a write action; the read-only executors are always `false`. */
  readonly write: boolean;
  /** For a write action: whether the pipeline side effect actually applied. */
  readonly sideEffectApplied?: boolean;
  readonly summary: string;
  readonly data: Readonly<Record<string, unknown>>;
}

export type AyasExecutor = (request: AyasExecutionRequest) => Promise<AyasExecutorResult>;

async function inspectProject(request: AyasExecutionRequest): Promise<AyasExecutorResult> {
  const slug = request.projectSlug as string;
  const state = await ProjectReader.readJSONState<Record<string, unknown>>(slug, "project.json");

  if (state.status === "missing") {
    return {
      action: "inspect-project",
      write: false,
      summary: `"${slug}" için project.json bulunamadı.`,
      data: { slug, exists: false },
    };
  }
  if (state.status === "malformed") {
    return {
      action: "inspect-project",
      write: false,
      summary: `"${slug}" project.json geçersiz JSON.`,
      data: { slug, exists: true, malformed: true },
    };
  }

  const record = state.value;
  const status = typeof record.status === "string" ? record.status : "unknown";
  const title = typeof record.title === "string" ? record.title : slug;
  return {
    action: "inspect-project",
    write: false,
    summary: `"${title}" — aşama: ${status}.`,
    data: {
      slug,
      exists: true,
      id: typeof record.id === "string" ? record.id : null,
      title,
      status,
      updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : null,
    },
  };
}

/**
 * A real `src/lib/pipeline/` action — `PipelineRecoveryPlanner` — used
 * READ-ONLY: it reads the project manifest and *computes* a resume plan +
 * failed / next-incomplete stages. It runs no stage, writes nothing. This is
 * the AYAS → PipelineRunner-family connection (spec §12) at its safe entry
 * point; enabling an actual stage run (`resume-stage` / `retry-stage`) is a
 * separate gated sprint.
 */
async function pipelineRecoveryPlan(request: AyasExecutionRequest): Promise<AyasExecutorResult> {
  const slug = request.projectSlug as string;
  const [plan, failedStages, nextStage] = await Promise.all([
    PipelineRecoveryPlanner.createResumePlan(slug),
    PipelineRecoveryPlanner.getFailedStages(slug),
    PipelineRecoveryPlanner.getNextIncompleteStage(slug),
  ]);
  const blockedReason = plan.blocked ? plan.reason ?? "bağımlılık engeli" : null;
  const summary =
    plan.startStage === null
      ? `"${slug}" pipeline'ı tamamlanmış görünüyor — çalıştırılacak aşama yok.`
      : blockedReason
        ? `"${slug}" ${plan.startStage} aşamasından devam edebilir ama engelli: ${blockedReason}.`
        : `"${slug}" ${plan.startStage} aşamasından devam edebilir (${plan.stagesToRun.length} aşama kalan).`;
  return {
    action: "pipeline-recovery-plan",
    write: false,
    summary,
    data: {
      slug,
      startStage: plan.startStage,
      stagesToRun: plan.stagesToRun,
      blocked: plan.blocked,
      blockedReason,
      failedStages,
      nextIncompleteStage: nextStage,
      dependencies: plan.dependencies.map((d) => ({ stage: d.stage, status: d.status, ready: d.ready })),
    },
  };
}

const EXECUTORS: Readonly<Record<AyasExecutionActionId, AyasExecutor>> = Object.freeze({
  "inspect-project": inspectProject,
  "pipeline-recovery-plan": pipelineRecoveryPlan,
});

export function resolveAyasExecutor(action: AyasExecutionActionId): AyasExecutor | undefined {
  return EXECUTORS[action];
}
