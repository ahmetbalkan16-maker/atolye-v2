import type { PipelineJob } from "@/types/pipelineJob";
import type { ProductionStepKey, ProjectPackageRunType } from "@/types/project";
import { buildProductionPipelineExecutionIdentity } from
  "@/lib/production/ProductionPipelineExecutionIdentity";
import { stableProductionId } from "@/lib/production/ProductionDeterminism";
import { buildProductionPipelineRetryAdmissionBinding,
  type ProductionPipelineRetryAdmissionBinding } from
  "@/lib/production/ProductionPipelineRetryAdmissionBinding";
import { regenerationBindingForExecution } from
  "@/lib/production/ProductionCompletedStageRegenerationStore";

export const pipelineRetryMaxAttempts = 3;

export type ProductionPipelineExecutionIdentity = ReturnType<
  typeof buildProductionPipelineExecutionIdentity
>;

export interface PipelineRetryReconciledLineageBinding {
  readonly state: "terminal" | "none";
  readonly operation: string;
  readonly durableOrdinal: number;
  readonly maxAttempts: number;
  readonly reservationId: string;
  readonly workerId: string;
  readonly workerSessionId: string;
  readonly recordVersion: number;
  readonly reservationVersion: number;
  readonly claimVersion: number;
  readonly attemptVersion: number;
  readonly leaseVersion: number;
  readonly reservationIdentityFingerprint: string;
  readonly recordIntegrityFingerprint: string;
  readonly recordIntegrityVersion: number;
  readonly leaseIntegrityFingerprint: string;
  readonly claimIntegrityFingerprint: string;
  readonly attemptIntegrityFingerprint: string;
}

/** Immutable proof produced before a failed PipelineJob is changed to queued. */
export interface PipelineRetryAdmission {
  readonly projectSlug: string;
  readonly stage: ProductionStepKey;
  readonly jobId: string;
  readonly runType: Extract<ProjectPackageRunType, "retry" | "resume">;
  readonly priorJobAttemptIndex: number;
  readonly currentDurableOrdinal: number;
  readonly admittedJobAttemptIndex: number;
  readonly admittedDurableOrdinal: number;
  readonly maxAttempts: number;
  readonly baseMaxAttempts?: number;
  readonly effectiveMaxAttempts?: number;
  readonly authorizedDurableOrdinal?: number;
  readonly retryBudgetAuthorityProof?: {
    readonly authorityId: string;
    readonly authorityIntegrityFingerprint: string;
    readonly consumptionReceiptFingerprint: string;
    readonly authoritySchemaVersion: string;
  };
  readonly exactReconciledDurableLineageIdentity: ProductionPipelineExecutionIdentity;
  readonly exactReconciledLineageBinding: PipelineRetryReconciledLineageBinding;
  readonly admittedDurableLineageIdentity: ProductionPipelineExecutionIdentity;
  readonly admittedExecutionBinding: ProductionPipelineRetryAdmissionBinding;
  readonly priorJobStatus: "failed";
  readonly preMutationJobFingerprint: string;
  readonly preMutationJobVersion: string;
  readonly admittedJobStatus: "queued";
  readonly admittedJobFingerprint: string;
  readonly admittedJobVersion: string;
}

export function fingerprintPipelineJob(job: PipelineJob): string {
  return stableProductionId(
    "pipeline-job-pre-mutation",
    JSON.parse(JSON.stringify(job)) as PipelineJob,
  );
}

export function freezePipelineRetryAdmission(
  admission: PipelineRetryAdmission,
): PipelineRetryAdmission {
  Object.freeze(admission.exactReconciledDurableLineageIdentity.core);
  Object.freeze(admission.exactReconciledDurableLineageIdentity);
  Object.freeze(admission.exactReconciledLineageBinding);
  Object.freeze(admission.admittedDurableLineageIdentity.core);
  Object.freeze(admission.admittedDurableLineageIdentity);
  Object.freeze(admission.admittedExecutionBinding.identity.core);
  Object.freeze(admission.admittedExecutionBinding.identity);
  Object.freeze(admission.admittedExecutionBinding);
  if (admission.retryBudgetAuthorityProof) {
    Object.freeze(admission.retryBudgetAuthorityProof);
  }
  return Object.freeze(admission);
}

export function assertCanonicalPipelineRetryAdmission(input: {
  readonly admission: PipelineRetryAdmission;
  readonly previousJob: PipelineJob | undefined;
  readonly currentJob: PipelineJob | undefined;
  readonly projectSlug: string;
  readonly stage: ProductionStepKey;
  readonly runType: ProjectPackageRunType;
}): void {
  const { admission, previousJob, currentJob, projectSlug, stage, runType } = input;
  const priorRunType = runTypeFromOperation(
    admission.exactReconciledLineageBinding.operation,
  );
  const regeneration = previousJob?.regenerationId
    ? regenerationBindingForExecution(projectSlug, stage, previousJob.attempts)
    : undefined;
  const canonicalPrior = previousJob && priorRunType && buildIdentity(
    previousJob, priorRunType,
  );
  const canonicalAdmitted = currentJob && buildIdentity(currentJob, admission.runType);
  const canonicalAdmittedBinding = currentJob &&
    buildProductionPipelineRetryAdmissionBinding(
      { projectSlug, stage, runType, regeneration },
      currentJob,
    );
  const generationStartAttempt = previousJob && regeneration
    ? previousJob.attempts - (previousJob.attemptWithinGeneration ?? 0)
    : 0;
  const generationMaxAttempts = generationStartAttempt + pipelineRetryMaxAttempts;
  const isOrdinal4Extension = !regeneration && admission.effectiveMaxAttempts === 4 &&
    admission.authorizedDurableOrdinal === 4 &&
    admission.admittedDurableOrdinal === 4 &&
    Boolean(admission.retryBudgetAuthorityProof?.authorityId) &&
    Boolean(admission.retryBudgetAuthorityProof?.authorityIntegrityFingerprint) &&
    Boolean(admission.retryBudgetAuthorityProof?.consumptionReceiptFingerprint);

  const expectedMaxAttempts = regeneration
    ? generationMaxAttempts
    : isOrdinal4Extension ? 4 : pipelineRetryMaxAttempts;

  const invalid = admission.maxAttempts !== expectedMaxAttempts ||
    admission.currentDurableOrdinal !== admission.priorJobAttemptIndex + 1 ||
    admission.admittedJobAttemptIndex !== admission.priorJobAttemptIndex + 1 ||
    admission.admittedDurableOrdinal !== admission.admittedJobAttemptIndex + 1 ||
    admission.admittedDurableOrdinal > expectedMaxAttempts ||
    (!regeneration && admission.admittedDurableOrdinal === 4 && !isOrdinal4Extension) ||
    (!regeneration && admission.admittedDurableOrdinal >= 5) ||
    (regeneration && (!previousJob || !currentJob ||
      (currentJob.attemptWithinGeneration ?? -1) !==
        (previousJob.attemptWithinGeneration ?? -1) + 1 ||
      currentJob.generationOrdinal !== previousJob.generationOrdinal ||
      currentJob.regenerationId !== previousJob.regenerationId)) ||
    admission.projectSlug !== projectSlug || admission.stage !== stage ||
    admission.runType !== runType || !previousJob || !currentJob ||
    admission.jobId !== `${projectSlug}-${stage}` ||
    previousJob.id !== admission.jobId || previousJob.projectSlug !== projectSlug ||
    previousJob.stage !== stage || previousJob.status !== admission.priorJobStatus ||
    previousJob.status !== "failed" || previousJob.attempts !== admission.priorJobAttemptIndex ||
    previousJob.updatedAt !== admission.preMutationJobVersion ||
    fingerprintPipelineJob(previousJob) !== admission.preMutationJobFingerprint ||
    currentJob.id !== admission.jobId || currentJob.projectSlug !== projectSlug ||
    currentJob.stage !== stage || currentJob.status !== admission.admittedJobStatus ||
    currentJob.status !== "queued" || currentJob.attempts !== admission.admittedJobAttemptIndex ||
    currentJob.updatedAt !== admission.admittedJobVersion ||
    fingerprintPipelineJob(currentJob) !== admission.admittedJobFingerprint ||
    !canonicalPrior || !canonicalAdmitted || !canonicalAdmittedBinding ||
    !sameExecutionIdentity(canonicalPrior,
      admission.exactReconciledDurableLineageIdentity) ||
    !sameExecutionIdentity(canonicalAdmitted, admission.admittedDurableLineageIdentity) ||
    fingerprintIdentity(canonicalAdmittedBinding) !==
      fingerprintIdentity(admission.admittedExecutionBinding);
  if (invalid) throw new Error("PIPELINE_RETRY_EXECUTION_ADMISSION_FAILED");
}

function runTypeFromOperation(operation: string): ProjectPackageRunType | undefined {
  if (operation === "pipeline.stage.initial") return "initial";
  if (operation === "pipeline.stage.retry") return "retry";
  if (operation === "pipeline.stage.resume") return "resume";
  return undefined;
}

function buildIdentity(job: PipelineJob, runType: ProjectPackageRunType) {
  return buildProductionPipelineExecutionIdentity({
    projectSlug: job.projectSlug,
    stage: job.stage,
    runType,
    regeneration: job.regenerationId
      ? regenerationBindingForExecution(job.projectSlug, job.stage, job.attempts)
      : undefined,
  }, job);
}

function sameExecutionIdentity(
  left: ProductionPipelineExecutionIdentity,
  right: ProductionPipelineExecutionIdentity,
): boolean {
  return fingerprintIdentity(left) === fingerprintIdentity(right);
}

function fingerprintIdentity(identity: unknown): string {
  return stableProductionId("pipeline-retry-lineage-identity", identity);
}
