import { ProjectManager } from "@/lib/projects/ProjectManager";
import { ProjectReader } from "@/lib/projects/ProjectReader";
import type { PipelineJob, PipelineJobList } from "@/types/pipelineJob";
import type { ProductionExecutionPersistenceAdapter } from
  "@/types/productionExecutionPersistence";
import type { ProductionStepKey } from "@/types/project";
import { PipelineJobManager } from "@/lib/pipeline/PipelineJobManager";
import { ProductionExecutionFilePersistenceAdapter } from
  "./ProductionExecutionPersistence";
import { classifyQueuedExhaustedPipelineJobDrift } from
  "./ProductionQueuedExhaustedDriftClassifier";

export interface ProductionQueuedExhaustedDriftRecoveryOptions {
  readonly confirm: boolean;
  readonly jobId?: string;
  readonly now?: () => string;
}

export type ProductionQueuedExhaustedDriftRecoveryResult =
  | { readonly success: true; readonly decision: "recovered" | "replayed";
      readonly writeFree: boolean;
      readonly globallyQuiescent: true;
      readonly writePerformed: boolean;
      readonly recoveryAttempted: boolean;
      readonly mutationState: "none" | "committed-verified";
      readonly job: PipelineJob }
  | { readonly success: false; readonly reasonCode:
        "PIPELINE_DRIFT_RECOVERY_CONFIRMATION_REQUIRED" |
        "PIPELINE_DRIFT_RECOVERY_REJECTED" |
        "PIPELINE_DRIFT_RECOVERY_COMMIT_VERIFICATION_FAILED";
      readonly writeFree: boolean;
      readonly globallyQuiescent: boolean;
      readonly writePerformed: boolean;
      readonly recoveryAttempted: boolean;
      readonly mutationState: "none" | "committed-unverified";
      readonly evidence: readonly string[] };

interface Dependencies {
  readonly createAdapter?: (trustedRootDirectory: string) =>
    ProductionExecutionPersistenceAdapter;
  readonly afterInitialClassification?: () => Promise<void>;
  readonly beforeCompareAndWrite?: () => Promise<void>;
  readonly afterReplacementCommitted?: () => Promise<void>;
  readonly writeJobList?: (projectSlug: string, jobs: PipelineJobList) => Promise<void>;
  readonly readJobListAfterWriteFailure?: (projectSlug: string) => Promise<PipelineJobList>;
  readonly beforeWriterInvocation?: () => void;
}

const rejected = (evidence: string): ProductionQueuedExhaustedDriftRecoveryResult => ({
  success: false, reasonCode: "PIPELINE_DRIFT_RECOVERY_REJECTED",
  writeFree: true, globallyQuiescent: false, writePerformed: false,
  recoveryAttempted: false, mutationState: "none", evidence: [evidence],
});

const committedUnverified = (
  evidence: string,
): ProductionQueuedExhaustedDriftRecoveryResult => ({
  success: false,
  reasonCode: "PIPELINE_DRIFT_RECOVERY_COMMIT_VERIFICATION_FAILED",
  writeFree: false,
  globallyQuiescent: true,
  writePerformed: true,
  recoveryAttempted: true,
  mutationState: "committed-unverified",
  evidence: [evidence],
});

export async function recoverQueuedExhaustedPipelineJobDrift(
  projectSlug: string,
  stage: ProductionStepKey,
  options: ProductionQueuedExhaustedDriftRecoveryOptions,
  /** @internal Isolated-test dependency seam; production callers never provide it. */
  dependencies: Dependencies = {},
): Promise<ProductionQueuedExhaustedDriftRecoveryResult> {
  const mutation = {
    writeAttempted: false,
    writerProvedPreCommitFailure: false,
    replacementMayHaveCommitted: false,
    replacementConfirmedCommitted: false,
    readbackVerified: false,
    lockReleaseSucceeded: false,
  };
  if (!options.confirm) return { success: false,
    reasonCode: "PIPELINE_DRIFT_RECOVERY_CONFIRMATION_REQUIRED", writeFree: true,
    globallyQuiescent: false, writePerformed: false, recoveryAttempted: false,
    mutationState: "none", evidence: ["confirm:required"] };
  const jobId = `${projectSlug}-${stage}`;
  if (options.jobId !== undefined && options.jobId !== jobId) return rejected("job:confirmation-binding");

  try {
    const adapter = createAdapter(projectSlug, dependencies);
    const initial = await classify(projectSlug, stage, adapter);
    if (initial.status === "recovered-replay") {
      return { success: true, decision: "replayed", writeFree: true,
        globallyQuiescent: true, writePerformed: false, recoveryAttempted: false,
        mutationState: "none", job: initial.job };
    }
    if (initial.status !== "exact-drift") {
      return rejected(initial.evidence[0] ?? "classification:rejected");
    }
    await dependencies.afterInitialClassification?.();
    const result = await PipelineJobManager.withProjectLock<
      ProductionQueuedExhaustedDriftRecoveryResult
    >(projectSlug, async (): Promise<ProductionQueuedExhaustedDriftRecoveryResult> => {
      const lockedAdapter = createAdapter(projectSlug, dependencies);
      const locked = await classify(projectSlug, stage, lockedAdapter);
      if (locked.status === "recovered-replay") {
        return { success: true, decision: "replayed", writeFree: true,
          globallyQuiescent: true, writePerformed: false, recoveryAttempted: false,
          mutationState: "none", job: locked.job };
      }
      if (locked.status !== "exact-drift") {
        return rejected(locked.evidence[0] ?? "locked-classification:rejected");
      }
      if (locked.job.updatedAt !== initial.job.updatedAt ||
        JSON.stringify(locked.job) !== JSON.stringify(initial.job)) {
        return rejected("lock:pre-mutation-fingerprint-changed");
      }
      await dependencies.beforeCompareAndWrite?.();
      const verified = await classify(projectSlug, stage, lockedAdapter);
      if (verified.status !== "exact-drift" ||
        JSON.stringify(verified.job) !== JSON.stringify(locked.job)) {
        return rejected("compare-and-write:state-changed");
      }

      const now = options.now?.() ?? new Date().toISOString();
      const restoredJob: PipelineJob = {
        ...verified.job,
        status: "failed",
        attempts: 2,
        updatedAt: now,
        completedAt: verified.job.completedAt ?? now,
        error: verified.failureCode,
      };
      const current = await PipelineJobManager.listJobsReadOnly(projectSlug);
      if (JSON.stringify(current.jobs.find((job) => job.id === jobId)) !==
        JSON.stringify(verified.job)) return rejected("commit:expected-bytes-changed");
      const next: PipelineJobList = { ...current,
        jobs: current.jobs.map((job) => job.id === jobId ? restoredJob : job), updatedAt: now };
      mutation.writeAttempted = true;
      mutation.replacementMayHaveCommitted = true;
      dependencies.beforeWriterInvocation?.();
      try {
        if (dependencies.writeJobList) await dependencies.writeJobList(projectSlug, next);
        else await PipelineJobManager.writeJobListUnderLock(projectSlug, next);
      } catch {
        const afterFailure = await (dependencies.readJobListAfterWriteFailure?.(projectSlug) ??
          PipelineJobManager.listJobsReadOnly(projectSlug))
          .catch(() => null);
        const afterFailureJob = afterFailure?.jobs.find((job) => job.id === jobId);
        if (JSON.stringify(afterFailureJob) === JSON.stringify(restoredJob)) {
          mutation.replacementConfirmedCommitted = true;
          return committedUnverified("commit:write-returned-error-after-replacement");
        }
        return committedUnverified("commit:writer-failed-with-unknown-commit-state");
      }
      mutation.replacementConfirmedCommitted = true;
      let committed: PipelineJobList;
      try {
        await dependencies.afterReplacementCommitted?.();
        committed = await PipelineJobManager.listJobsReadOnly(projectSlug);
      } catch {
        return committedUnverified("commit:readback-failed");
      }
      const readback = committed.jobs.find((job) => job.id === jobId);
      if (JSON.stringify(readback) !== JSON.stringify(restoredJob)) {
        return committedUnverified("commit:readback-mismatch");
      }
      mutation.readbackVerified = true;
      return { success: true, decision: "recovered", writeFree: false,
        globallyQuiescent: true, writePerformed: true, recoveryAttempted: true,
        mutationState: "committed-verified", job: restoredJob };
    }, jobId);
    mutation.lockReleaseSucceeded = true;
    return result;
  } catch {
    if (mutation.writeAttempted && !mutation.writerProvedPreCommitFailure) {
      return committedUnverified(mutation.readbackVerified
        ? "commit:verified-but-lock-or-gate-release-failed"
        : mutation.replacementConfirmedCommitted
          ? "commit:committed-but-operation-finalization-failed"
          : "commit:unknown-after-operation-failure");
    }
    return rejected("persistence:operation-failed");
  }
}

async function classify(
  projectSlug: string,
  stage: ProductionStepKey,
  adapter: ProductionExecutionPersistenceAdapter,
) {
  const [jobs, history, manifest] = await Promise.all([
    PipelineJobManager.listJobsReadOnly(projectSlug),
    PipelineJobManager.listHistory(projectSlug),
    ProjectManager.getManifest(projectSlug),
  ]);
  return classifyQueuedExhaustedPipelineJobDrift({
    projectSlug, stage, jobs, history, manifest, adapter,
  });
}

function createAdapter(projectSlug: string, dependencies: Dependencies) {
  const root = `${ProjectReader.getProjectFolder(projectSlug)}/production-execution`;
  return dependencies.createAdapter?.(root) ?? new ProductionExecutionFilePersistenceAdapter({
    trustedRootDirectory: root, createRootDirectory: false,
  });
}
