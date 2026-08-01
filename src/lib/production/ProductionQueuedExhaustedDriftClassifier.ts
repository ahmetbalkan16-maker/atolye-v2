import type { PipelineJob, PipelineJobHistory, PipelineJobList } from "@/types/pipelineJob";
import type { ProjectManifest, ProductionStepKey } from "@/types/project";
import type { ProductionExecutionPersistenceAdapter } from
  "@/types/productionExecutionPersistence";
import { buildProductionPipelineExecutionIdentity } from
  "./ProductionPipelineExecutionIdentity";
import { classifyProductionDurableAttemptLineage } from
  "./ProductionDurableAttemptLineageClassifier";
import { AdapterBackedProductionExecutionDurableStorage } from
  "./ProductionExecutionDurableStorage";
import { readProductionCanonicalTerminalDurableLineage,
  validateProductionCanonicalTerminalAuthority } from
  "./ProductionCanonicalDurableLineage";

export const queuedExhaustedDriftReasonCode =
  "PIPELINE_RETRY_QUEUED_EXHAUSTED_DRIFT_DETECTED" as const;
const maxAttempts = 3;

export type QueuedExhaustedDriftClassification =
  | { readonly status: "exact-drift"; readonly job: PipelineJob;
      readonly failureCode: string; readonly identity: ReturnType<
        typeof buildProductionPipelineExecutionIdentity> }
  | { readonly status: "recovered-replay"; readonly job: PipelineJob;
      readonly failureCode: string }
  | { readonly status: "rejected"; readonly evidence: readonly string[] };

const reject = (evidence: string): QueuedExhaustedDriftClassification =>
  ({ status: "rejected", evidence: [evidence] });

/** Shared, write-free classifier used by ordinary resume and explicit recovery. */
export async function classifyQueuedExhaustedPipelineJobDrift(input: {
  readonly projectSlug: string;
  readonly stage: ProductionStepKey;
  readonly jobs: PipelineJobList;
  readonly history: PipelineJobHistory;
  readonly manifest: ProjectManifest | null;
  readonly adapter: ProductionExecutionPersistenceAdapter;
}): Promise<QueuedExhaustedDriftClassification> {
  const { projectSlug, stage, jobs, history, manifest, adapter } = input;
  const jobId = `${projectSlug}-${stage}`;
  const matchingJobs = jobs.jobs.filter((job) => job.id === jobId || job.stage === stage);
  if (jobs.projectSlug !== projectSlug || matchingJobs.length !== 1) return reject("job:identity");
  const job = matchingJobs[0];
  if (job.id !== jobId || job.projectSlug !== projectSlug || job.stage !== stage) {
    return reject("job:binding");
  }
  if (!manifest || manifest.slug !== projectSlug || manifest.project.slug !== projectSlug ||
    manifest.packages[stage]?.status !== "failed") return reject("manifest:failed");
  const failureCode = manifest.packages[stage]?.error;
  if (typeof failureCode !== "string" || failureCode.length === 0) {
    return reject("manifest:failure-code");
  }
  const latestHistory = history.events.filter((event) =>
    event.jobId === job.id && event.stage === stage).at(-1);
  if (!latestHistory || latestHistory.status !== "failed" ||
    typeof latestHistory.errorCode !== "string" || latestHistory.errorCode !== failureCode) {
    return reject("history:exact-failure");
  }

  const recoveredReplay = job.status === "failed" && job.attempts === 2 &&
    job.error === failureCode;
  if (!recoveredReplay && (job.status !== "queued" || job.attempts !== maxAttempts)) {
    return reject("job:not-exact-queued-3");
  }

  const lineage = await classifyProductionDurableAttemptLineage(
    adapter, projectSlug, stage, 2, "exact",
  );
  if (lineage.status !== "valid" || lineage.maximumRecordAttempt !== 3 ||
    lineage.latestAttempt.state !== "failed") {
    return reject(`durable:lineage-${lineage.status}`);
  }
  const identity = buildProductionPipelineExecutionIdentity(
    { projectSlug, stage, runType: "retry" }, { id: job.id, attempts: 2 },
  );
  let canonical;
  try {
    const record = await new AdapterBackedProductionExecutionDurableStorage(adapter)
      .read(identity.recordId);
    if (!record.record) throw new Error("target record missing");
    canonical = await readProductionCanonicalTerminalDurableLineage(
      adapter, identity, record.record.identityFingerprint, undefined, "pipeline.stage.retry",
    );
  } catch {
    return reject("durable:record-or-lease");
  }
  if (canonical.record.state !== "cancelled" || canonical.record.attempt !== 3 ||
    canonical.record.maxAttempts !== maxAttempts || canonical.lease.status !== "released") {
    return reject("durable:record-or-lease");
  }
  if (canonical.claim.state !== "abandoned") return reject("durable:claim");
  if (canonical.attempt.state !== "failed") return reject("durable:attempt");
  if (!await globallyQuiescent(adapter, projectSlug)) {
    return reject("durable:global-authority");
  }
  if (recoveredReplay) return { status: "recovered-replay", job, failureCode };
  return { status: "exact-drift", job, failureCode, identity };
}

async function globallyQuiescent(
  adapter: ProductionExecutionPersistenceAdapter,
  projectSlug: string,
): Promise<boolean> {
  return validateProductionCanonicalTerminalAuthority(adapter, projectSlug);
}
