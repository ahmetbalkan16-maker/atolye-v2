/**
 * Atölye Brain — the server-side "Brain Worker" model.
 *
 * The long-term goal: a task queue that keeps running when the director's PC is
 * off, on our own free/self-hosted deployment, using local models, sending
 * nothing unnecessary outside — and in the morning it reports:
 *
 *   "Overnight I analysed these tasks. I found this problem. I ran these tests.
 *    I proposed this improvement. I found this security risk. I did NOT do these
 *    things without your approval. I am waiting on your approval for these."
 *
 * This file defines the queue / task / report shapes. The runner, the durable
 * JSON-file store and the actual deployment are later, separately-approved
 * phases. Nothing here executes anything.
 */

export const brainWorkerSchemaVersion = "1" as const;

export type BrainTaskKind =
  // read-only analysis — always autonomous
  | "analyze-codebase"
  | "diagnose-failure"
  | "review-graph-staleness"
  | "quality-review"
  | "research-topic"
  | "security-audit"
  | "dependency-audit"
  | "health-check"
  // reversible, sandboxed — autonomous
  | "run-tests"
  | "graphify-refresh"
  | "draft-improvement-proposal"
  | "draft-test"
  // requires approval — queued as pending
  | "apply-improvement"
  | "modify-production-code"
  | "modify-security-policy"
  | "run-video-pipeline"
  | "gpu-inference-test"
  | "delete-or-mutate-data"
  | "git-push";

export type BrainTaskStatus =
  | "queued"
  | "running"
  | "blocked-on-dependency"
  | "blocked-on-approval"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "skipped-unsafe";

export type BrainTaskPriority = "low" | "normal" | "high" | "urgent";

/**
 * How the autonomy gate ({@link BrainTaskKind} → this) classifies a task.
 *  - `auto-safe`            read-only, no workspace writes
 *  - `auto-safe-reversible` writes only to a temp workspace / regenerable output
 *  - `requires-user-approval` production behaviour / security / data / GPU / cost
 *  - `forbidden`            never, regardless of approval (e.g. disabling HVCI)
 */
export type BrainTaskAutonomy =
  | "auto-safe"
  | "auto-safe-reversible"
  | "requires-user-approval"
  | "forbidden";

export interface BrainTaskInput {
  readonly kind: BrainTaskKind;
  readonly title: string;
  readonly rationale: string;
  readonly priority: BrainTaskPriority;
  /** Task ids that must be `succeeded` before this runs. */
  readonly dependsOn: readonly string[];
  /** Sanitised, structured payload — never secrets. */
  readonly payload: Readonly<Record<string, string | number | boolean>>;
  readonly createdAt: string;
  /** Optional earliest-run instant (e.g. "after 02:00 when the PC is idle"). */
  readonly notBefore?: string;
}

export interface BrainTask extends BrainTaskInput {
  readonly schemaVersion: typeof brainWorkerSchemaVersion;
  readonly taskId: string;
  readonly autonomy: BrainTaskAutonomy;
  readonly status: BrainTaskStatus;
  readonly attempts: number;
  readonly updatedAt: string;
}

export type BrainTaskOutcomeKind =
  | "analysis"
  | "test-run"
  | "diagnosis"
  | "proposal"
  | "security-finding"
  | "graph-refresh"
  | "no-op"
  | "error";

export interface BrainTaskResult {
  readonly taskId: string;
  readonly outcomeKind: BrainTaskOutcomeKind;
  readonly status: Extract<BrainTaskStatus, "succeeded" | "failed" | "blocked-on-approval" | "skipped-unsafe">;
  readonly summary: string;
  /** Sanitised evidence lines. */
  readonly evidence: readonly string[];
  /** Ids of proposals / approval tasks this result created. */
  readonly producedTaskIds: readonly string[];
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
}

export interface BrainWorkerConfig {
  readonly schemaVersion: typeof brainWorkerSchemaVersion;
  /** Max tasks to execute per wake cycle (keeps a night bounded). */
  readonly maxTasksPerCycle: number;
  /** Wall-clock budget for one cycle. */
  readonly cycleBudgetMs: number;
  /** Whether GPU-touching tasks may run at all in this deployment. */
  readonly allowGpuTasks: boolean;
  /** Hard GPU stop for any inference the worker does run. */
  readonly gpuHardStopCelsius: number;
  /** Cooldown between GPU tasks. */
  readonly gpuCooldownMs: number;
  /** Never run a task classified stricter than this without a human. */
  readonly maxAutonomy: Extract<BrainTaskAutonomy, "auto-safe" | "auto-safe-reversible">;
}

export interface BrainWorkerCycleReport {
  readonly schemaVersion: typeof brainWorkerSchemaVersion;
  readonly cycleId: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly tasksConsidered: number;
  readonly tasksRun: number;
  readonly analyses: readonly string[];
  readonly problemsFound: readonly string[];
  readonly testsRun: readonly string[];
  readonly improvementsProposed: readonly string[];
  readonly securityRisks: readonly string[];
  readonly notDoneNeedingApproval: readonly string[];
  readonly awaitingUserApproval: readonly string[];
  readonly gpu?: {
    readonly used: boolean;
    readonly peakCelsius?: number;
    readonly durationMs?: number;
    readonly powerWatts?: number;
    readonly cooldownMs?: number;
    readonly throttleOrFault: boolean;
  };
  readonly nextSingleStep: string;
}

export type BrainTaskQueueReasonCode =
  | "BRAIN_TASK_QUEUE_VALID"
  | "BRAIN_TASK_QUEUE_DUPLICATE_ID"
  | "BRAIN_TASK_QUEUE_UNKNOWN_DEPENDENCY"
  | "BRAIN_TASK_QUEUE_DEPENDENCY_CYCLE"
  | "BRAIN_TASK_QUEUE_TIMESTAMP_INVALID";

export interface BrainTaskQueueValidation {
  readonly valid: boolean;
  readonly reasonCode: BrainTaskQueueReasonCode;
}
