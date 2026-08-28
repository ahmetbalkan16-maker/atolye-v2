import { ProjectReader } from "@/lib/projects/ProjectReader";
import { ProjectWriter } from "@/lib/projects/ProjectWriter";
import { ProjectManager } from "@/lib/projects/ProjectManager";
import {
  PipelineStateError,
  type PipelineStateKind,
} from "./PipelineStateError";
import { getNextPipelineStage } from "./PipelineRecoveryPlanner";
import type { PackageStatus, ProductionStepKey, ProjectPackageManifest } from "@/types/project";
import { isPipelineErrorEvidence } from "./PipelineErrorEvidence";
import type { PipelineErrorEvidence } from "@/types/errorEvidence";
import type {
  PipelineJob,
  PipelineJobAction,
  PipelineJobHistory,
  PipelineJobHistoryEvent,
  PipelineJobHistoryStatus,
  PipelineJobList,
  PipelineJobStatus,
} from "@/types/pipelineJob";
import { assertCanonicalPipelineJobMutationLock,
  hasCanonicalPipelineJobMutationLock,
  withCanonicalPipelineJobMutationLock } from "./PipelineJobMutationLock";
import { fingerprintPipelineJob } from "./PipelineRetryAdmission";
import { stableProductionId } from "@/lib/production/ProductionDeterminism";
import { ProductionExecutionFilePersistenceAdapter } from
  "@/lib/production/ProductionExecutionPersistence";
import { classifyProductionDurableAttemptLineage } from
  "@/lib/production/ProductionDurableAttemptLineageClassifier";
import {
  type RuntimeStorageInput,
  resolveRuntimeStorageContext,
} from "@/lib/runtime/RuntimeStoragePaths";
import { listRegenerationExecutionBindings } from
  "@/lib/production/ProductionCompletedStageRegenerationStore";

const pipelineJobsFileName = "pipeline-jobs.json";
const pipelineHistoryFileName = "pipeline-history.json";
const pipelineJobStatuses = [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
] as const;

const allowedStateTransitions: Record<
  PipelineJobStatus,
  readonly PipelineJobStatus[]
> = {
  queued: ["running", "cancelled"],
  running: ["completed", "failed", "cancelled"],
  completed: [],
  failed: ["queued"],
  cancelled: ["queued"],
};

const stageLabels: Record<ProductionStepKey, string> = {
  research: "Research",
  script: "Script",
  scenes: "Scene Planning",
  visuals: "Visual Production",
  animation: "Animation",
  video: "Video",
  audio: "Audio",
  assembly: "Video Editing",
  thumbnail: "Thumbnail",
  seo: "SEO",
  youtube: "Publishing",
  export: "Export",
};

export class PipelineJobManager {
  private static projectLocks = new Map<string, Promise<void>>();

  static async listJobs(projectSlug: string): Promise<PipelineJobList> {
    if (!hasCanonicalPipelineJobMutationLock(projectSlug)) {
      return this.withProjectLock(projectSlug, () =>
        this.listJobs(projectSlug));
    }
    const current = await this.readJobList(projectSlug);

    if (current.jobs.length > 0) {
      return current;
    }

    return this.seedJobsFromManifest(projectSlug, current);
  }

  static async listHistory(projectSlug: string): Promise<PipelineJobHistory> {
    return this.readHistory(projectSlug);
  }

  static async listJobsReadOnly(
    projectSlug: string,
    storageInput: RuntimeStorageInput = {},
  ): Promise<PipelineJobList> {
    return this.readJobList(projectSlug, storageInput);
  }

  static async getJob(
    projectSlug: string,
    jobId: string,
  ): Promise<PipelineJob | null> {
    const current = await this.listJobs(projectSlug);

    return current.jobs.find((job) => job.id === jobId) ?? null;
  }

  static async getJobReadOnly(
    projectSlug: string,
    jobId: string,
  ): Promise<PipelineJob | null> {
    const current = await this.readJobList(projectSlug);

    return current.jobs.find((job) => job.id === jobId) ?? null;
  }

  static async getJobForStage(
    projectSlug: string,
    stage: ProductionStepKey,
  ): Promise<PipelineJob | null> {
    const current = await this.listJobs(projectSlug);

    return current.jobs.find((job) => job.stage === stage) ?? null;
  }

  static async getJobForStageReadOnly(
    projectSlug: string,
    stage: ProductionStepKey,
  ): Promise<PipelineJob | null> {
    const current = await this.readJobList(projectSlug);

    return current.jobs.find((job) => job.stage === stage) ?? null;
  }

  static async prepareJobRetry(
    projectSlug: string,
    jobId: string,
    expected?: { readonly updatedAt: string; readonly attempts: number;
      readonly fingerprint?: string },
  ): Promise<PipelineJobRetryPreparationResult> {
    return this.withProjectLock(projectSlug, async () => {
      return this.prepareJobRetryUnderLock(projectSlug, jobId, expected);
    });
  }

  static async prepareJobRetryUnderLock(
    projectSlug: string,
    jobId: string,
    expected?: { readonly updatedAt: string; readonly attempts: number;
      readonly fingerprint?: string },
  ): Promise<PipelineJobRetryPreparationResult> {
    const current = await this.listJobs(projectSlug);
    const job = current.jobs.find((item) => item.id === jobId);

    if (!job) {
      return {
        success: false,
        status: 404,
        error: "Pipeline job not found.",
      };
    }

    if (
      expected &&
      (job.updatedAt !== expected.updatedAt || job.attempts !== expected.attempts ||
        (expected.fingerprint !== undefined &&
          fingerprintPipelineJob(job) !== expected.fingerprint))
    ) {
      return {
        success: false,
        status: 409,
        error: "Pipeline retry compare-and-swap conflict.",
        reasonCode: "PIPELINE_RETRY_CAS_CONFLICT",
      };
    }

    if (!this.canTransition(job.status, "queued")) {
      return {
        success: false,
        status: 409,
        error: `Retry is not supported for "${job.status}" jobs.`,
        reasonCode: "PIPELINE_RETRY_PREPARATION_REJECTED",
      };
    }

    const now = new Date().toISOString();
    const nextJob = this.retryJob(job, now);
    const jobs = current.jobs.map((item) =>
      item.id === jobId ? nextJob : item,
    );
    const nextJobs = await this.writeJobList(projectSlug, {
      ...current,
      jobs,
      updatedAt: now,
    });

    return {
      success: true,
      job: nextJob,
      previousJob: job,
      jobs: nextJobs,
    };
  }

  static async compensatePreparedRetry(
    projectSlug: string,
    previousJob: PipelineJob,
    preparedJob: PipelineJob,
  ): Promise<boolean> {
    return this.withProjectLock(projectSlug, async () => {
      const current = await this.readJobList(projectSlug);
      const currentJob = current.jobs.find((job) => job.id === preparedJob.id);

      if (
        !currentJob ||
        currentJob.id !== previousJob.id ||
        currentJob.status !== "queued" ||
        currentJob.attempts !== preparedJob.attempts ||
        currentJob.cancelRequestedAt
      ) {
        return false;
      }

      // Monotonic guard: previousJob must still be a valid return point.
      // The CAS check above only proves "the disk still holds exactly what
      // I just wrote" — it says nothing about whether previousJob itself is
      // stale. If a real execution has since terminaled (recorded in
      // pipeline-history.json) beyond what previousJob.attempts accounts
      // for, writing previousJob back would silently erase that
      // execution's evidence from job.attempts, even though durable/
      // manifest state (which this function never touches, and never
      // should) still reflects it. This mirrors
      // manifestExecutionTotalToAttemptIndex's own canonical formula
      // (executionTotal - 1), using the terminal history event count for
      // this exact (jobId, stage) — already available in this same file —
      // as the same proxy for "how many real executions are on record."
      const history = await this.readHistory(projectSlug);
      const terminalEventCount = history.events.filter((event) =>
        event.jobId === previousJob.id && event.stage === previousJob.stage,
      ).length;
      const canonicalMinimumAttempts = terminalEventCount - 1;
      if (previousJob.attempts < canonicalMinimumAttempts) {
        return false;
      }

      const now = new Date().toISOString();
      await this.writeJobList(projectSlug, {
        ...current,
        jobs: current.jobs.map((job) =>
          job.id === preparedJob.id ? previousJob : job,
        ),
        updatedAt: now,
      });

      return true;
    });
  }

  // Reconciles a job whose `attempts` / `attemptWithinGeneration` / `status`
  // have drifted BEHIND the canonical state recoverable from
  // pipeline-history.json + manifest.json + the durable execution store +
  // the active regeneration's own frozen preparation-time snapshot. This is
  // a data-integrity REPAIR of a corrupted record, not a normal lifecycle
  // transition — it deliberately bypasses `canTransition`'s queued->failed
  // restriction, because the "queued" status being repaired is itself the
  // corrupted artifact, not a legitimate state to transition from. It is
  // read-mostly and fail-closed: any missing/ambiguous/conflicting evidence,
  // or a current job already at or ahead of canonical, results in a no-op.
  // It NEVER touches the durable store, NEVER touches manifest.json, and
  // NEVER runs a retry/authority/FFmpeg/resume/cancel — the only write this
  // function can ever perform is a single CAS-protected update to this one
  // job record inside pipeline-jobs.json.
  static async reconcilePipelineJobAttemptDriftFromHistory(
    projectSlug: string,
    jobId: string,
    expected: { readonly updatedAt: string; readonly attempts: number;
      readonly fingerprint?: string },
    storageInput: RuntimeStorageInput = {},
  ): Promise<PipelineJobAttemptDriftReconciliationResult> {
    return this.withProjectLock(projectSlug, async () => {
      const current = await this.readJobList(projectSlug);
      const job = current.jobs.find((item) => item.id === jobId);
      if (!job) {
        return driftReconciliationFailure("PIPELINE_JOB_ATTEMPT_DRIFT_NOT_FOUND",
          ["job:missing"]);
      }

      if (
        job.updatedAt !== expected.updatedAt ||
        job.attempts !== expected.attempts ||
        (expected.fingerprint !== undefined &&
          fingerprintPipelineJob(job) !== expected.fingerprint)
      ) {
        return driftReconciliationFailure("PIPELINE_JOB_ATTEMPT_DRIFT_CAS_CONFLICT",
          ["job:cas-mismatch"]);
      }

      // Only a job stuck "queued" (the drift pattern) or already "failed"
      // (idempotent replay / genuinely-failed-with-stale-counters) is ever
      // in scope. running/completed/cancelled are never touched.
      if ((job.status !== "queued" && job.status !== "failed") || job.cancelRequestedAt) {
        return driftReconciliationFailure("PIPELINE_JOB_ATTEMPT_DRIFT_STATUS_INELIGIBLE",
          [`job:status-${job.status}`]);
      }

      const manifest = await ProjectManager.ensureManifest(projectSlug);
      const packageManifest = manifest?.packages?.[job.stage];
      if (!manifest || !packageManifest) {
        return driftReconciliationFailure("PIPELINE_JOB_ATTEMPT_DRIFT_HISTORY_MANIFEST_MISMATCH",
          ["manifest:missing"]);
      }

      const history = await this.readHistory(projectSlug);
      const rawManifest = await ProjectReader.readJSON<Record<string, unknown>>(
        projectSlug, "manifest.json");
      const rawPackages = rawManifest?.packages as Record<string, {
        attempts?: { total?: unknown };
      }> | undefined;
      const durableAdapter = new ProductionExecutionFilePersistenceAdapter({
        trustedRootDirectory: `${ProjectReader.getProjectFolder(projectSlug)}/production-execution`,
        createRootDirectory: false,
      });
      const durableKeys = await durableAdapter.listKeys("idempotency").catch(
        () => ({ ok: false as const }),
      );
      const hasDurableEvidence = durableKeys.ok && durableKeys.keys.length > 0;

      // (A) Canonical `attempts`, via the exact same official formula and
      // cross-validation (history terminal-count + durable lineage) used by
      // seedJobsFromManifest — reused rather than reimplemented.
      let canonicalAttempts: number;
      try {
        canonicalAttempts = await manifestExecutionTotalToAttemptIndex(
          projectSlug,
          job.stage,
          packageManifest.status,
          rawPackages?.[job.stage]?.attempts &&
            Object.prototype.hasOwnProperty.call(rawPackages[job.stage].attempts, "total")
            ? rawPackages[job.stage].attempts?.total
            : packageManifest.attempts?.total,
          history,
          durableAdapter,
          hasDurableEvidence,
        );
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "unknown";
        return driftReconciliationFailure(
          message === "PIPELINE_MANIFEST_DURABLE_ATTEMPT_EVIDENCE_MISMATCH"
            ? "PIPELINE_JOB_ATTEMPT_DRIFT_DURABLE_LINEAGE_MISMATCH"
            : "PIPELINE_JOB_ATTEMPT_DRIFT_HISTORY_MANIFEST_MISMATCH",
          [`formula:${message}`],
        );
      }

      // (D) Never pull an ahead-of-canonical job back down.
      if (job.attempts > canonicalAttempts) {
        return driftReconciliationFailure("PIPELINE_JOB_ATTEMPT_DRIFT_AHEAD_OF_CANONICAL",
          [`job:${job.attempts}-ahead-of-canonical:${canonicalAttempts}`]);
      }

      // (B) Canonical `attemptWithinGeneration`, via the active
      // regeneration's own frozen preparation-time snapshot
      // (firstGlobalExecutionOrdinal === generationStartAttempt).
      let canonicalAttemptWithinGeneration: number | undefined;
      if (job.regenerationId) {
        const context = resolveRuntimeStorageContext(storageInput);
        const bindings = listRegenerationExecutionBindings(projectSlug, job.stage, context);
        const activeBinding = bindings.find((item) =>
          item.binding.regenerationId === job.regenerationId);
        if (!activeBinding) {
          return driftReconciliationFailure(
            "PIPELINE_JOB_ATTEMPT_DRIFT_REGENERATION_BINDING_MISSING",
            ["regeneration:binding-not-found"]);
        }
        if (job.generationOrdinal !== undefined &&
          activeBinding.binding.generationOrdinal !== job.generationOrdinal) {
          return driftReconciliationFailure(
            "PIPELINE_JOB_ATTEMPT_DRIFT_REGENERATION_BINDING_MISMATCH",
            [`generation:${activeBinding.binding.generationOrdinal}-vs-job:${job.generationOrdinal}`]);
        }
        const generationStartAttempt = activeBinding.firstGlobalExecutionOrdinal;
        if (canonicalAttempts < generationStartAttempt) {
          return driftReconciliationFailure(
            "PIPELINE_JOB_ATTEMPT_DRIFT_REGENERATION_BINDING_MISMATCH",
            [`canonical:${canonicalAttempts}-below-generationStart:${generationStartAttempt}`]);
        }
        canonicalAttemptWithinGeneration = canonicalAttempts - generationStartAttempt;
      }

      // (C) Already canonical: explicit write-free no-op.
      const alreadyReconciled = job.attempts === canonicalAttempts &&
        job.attemptWithinGeneration === canonicalAttemptWithinGeneration &&
        job.status === "failed";
      if (alreadyReconciled) {
        return {
          ok: true,
          reasonCode: "PIPELINE_JOB_ATTEMPT_DRIFT_ALREADY_RECONCILED",
          writeFree: true,
          evidence: ["job:already-canonical"],
          canonical: { attempts: canonicalAttempts,
            attemptWithinGeneration: canonicalAttemptWithinGeneration },
          job,
        };
      }

      // (E) Behind canonical and all evidence agrees: apply the
      // CAS-protected write. Status moves to "failed" alongside the
      // counters — see the reconciliation preflight report for the proof
      // that leaving status "queued" would defeat the purpose of the
      // repair (prepareFailedStageRetry's own entry guard requires
      // status==="failed" to ever admit a further retry).
      const jobHistoryEvents = history.events.filter((event) =>
        event.jobId === jobId && event.stage === job.stage);
      const latestTerminalEvent = jobHistoryEvents.at(-1);
      const now = new Date().toISOString();
      const reconciledJob: PipelineJob = {
        ...job,
        status: "failed",
        attempts: canonicalAttempts,
        attemptWithinGeneration: canonicalAttemptWithinGeneration,
        updatedAt: now,
        startedAt: latestTerminalEvent?.startedAt ?? job.startedAt,
        completedAt: latestTerminalEvent?.completedAt ?? job.completedAt ?? now,
        cancelRequestedAt: undefined,
        error: latestTerminalEvent?.errorCode ?? job.error,
        errorEvidence: latestTerminalEvent?.errorEvidence ?? job.errorEvidence,
        globalExecutionOrdinal: job.regenerationId
          ? canonicalAttempts
          : job.globalExecutionOrdinal,
      };

      await this.writeJobList(projectSlug, {
        ...current,
        jobs: current.jobs.map((item) => item.id === jobId ? reconciledJob : item),
        updatedAt: now,
      });

      return {
        ok: true,
        reasonCode: "PIPELINE_JOB_ATTEMPT_DRIFT_RECONCILED",
        writeFree: false,
        evidence: ["history:cross-checked", "manifest:cross-checked",
          ...(hasDurableEvidence ? ["durable:cross-checked"] : []),
          ...(job.regenerationId ? ["regeneration:binding-verified"] : [])],
        canonical: { attempts: canonicalAttempts,
          attemptWithinGeneration: canonicalAttemptWithinGeneration },
        job: reconciledJob,
      };
    });
  }

  // Sibling of reconcilePipelineJobAttemptDriftFromHistory, for the
  // *manifest*-side counterpart of the same class of data-integrity repair:
  // manifest.json's packages[stage].status can be found "pending" while
  // completedAt/attempts.total/history all prove the package's last real
  // execution actually failed. This happens because
  // ProjectManager.updatePackageUsage() performs an unlocked
  // read-modify-write of the *entire* manifest (see AIUsageManager ->
  // runObservedAIRequest.ts, called after PipelineJobManager.startStage's
  // own lock has already been released) — a lost-update race can clobber a
  // legitimate "failed" write with an earlier, stale snapshot. Notably,
  // updatePackageUsage never touches packages[stage].updatedAt (only
  // `usage`), so a single-field CAS on that alone cannot detect it — see
  // the multi-field CAS below.
  //
  // Like its job-side sibling: never touches pipeline-jobs.json, never
  // touches the durable store, never runs a retry/authority/FFmpeg, and
  // reuses manifestExecutionTotalToAttemptIndex's official formula (and
  // classifyProductionDurableAttemptLineage through it) unchanged rather
  // than reimplementing it. This first version only ever repairs
  // pending -> failed; a pending -> completed repair is a materially
  // different, higher-risk claim and is deliberately out of scope.
  static async reconcileManifestPackageStatusFromHistory(
    projectSlug: string,
    stage: ProductionStepKey,
    expected: {
      readonly manifestUpdatedAt: string;
      readonly packageSnapshot: ManifestPackageStatusSnapshot;
      readonly packageFingerprint?: string;
    },
  ): Promise<ManifestPackageStatusReconciliationResult> {
    return this.withProjectLock(projectSlug, async () => {
      const manifest = await ProjectManager.ensureManifest(projectSlug);
      const packageManifest = manifest?.packages?.[stage];
      if (!manifest || !packageManifest) {
        return manifestReconciliationFailure(
          "MANIFEST_PACKAGE_STATUS_DRIFT_NOT_FOUND", ["manifest:missing"]);
      }

      const currentSnapshot = snapshotOfPackage(packageManifest);

      // (1) Multi-field CAS. Deliberately not just packages[stage].updatedAt
      // — updatePackageUsage never changes that field, so a single-field
      // check on it alone cannot detect exactly the race this function
      // exists to be safe against.
      if (
        manifest.updatedAt !== expected.manifestUpdatedAt ||
        !manifestPackageSnapshotsEqual(currentSnapshot, expected.packageSnapshot) ||
        (expected.packageFingerprint !== undefined &&
          fingerprintManifestPackage(packageManifest) !== expected.packageFingerprint)
      ) {
        return manifestReconciliationFailure(
          "MANIFEST_PACKAGE_STATUS_DRIFT_CAS_CONFLICT", ["manifest:cas-mismatch"]);
      }

      // (2) Only "pending" (the corruption pattern) or already "failed"
      // (idempotent replay) are ever in scope. "completed" is NEVER
      // touched — a positive terminal result must never be silently
      // downgraded. "running"/"missing" are also out of scope.
      if (packageManifest.status !== "pending" && packageManifest.status !== "failed") {
        return manifestReconciliationFailure(
          "MANIFEST_PACKAGE_STATUS_DRIFT_STATUS_INELIGIBLE",
          [`package:status-${packageManifest.status}`]);
      }

      // (3) "pending" with no completedAt is the ordinary, legitimate
      // post-regeneration-prep state (buildMutations always clears
      // completedAt when it sets pending) — nothing to repair here.
      if (packageManifest.status === "pending" && packageManifest.completedAt === undefined) {
        return manifestReconciliationFailure(
          "MANIFEST_PACKAGE_STATUS_DRIFT_PENDING_WITHOUT_COMPLETION_EVIDENCE",
          ["package:pending-no-completedAt"]);
      }

      // (4) The latest terminal history event for this exact (jobId,
      // stage) must itself say "failed" — checked explicitly (not just
      // via the formula's own throw) so this specific ambiguity gets its
      // own, more diagnosable reason code.
      const history = await this.readHistory(projectSlug);
      const jobId = getJobId(projectSlug, stage);
      const terminalEvents = history.events.filter((event) =>
        event.jobId === jobId && event.stage === stage);
      const latestEvent = terminalEvents.at(-1);
      if (!latestEvent || latestEvent.status !== "failed") {
        return manifestReconciliationFailure(
          "MANIFEST_PACKAGE_STATUS_DRIFT_AMBIGUOUS_EVIDENCE",
          [`history:latest-status-${latestEvent?.status ?? "none"}`]);
      }

      // (5) Full official cross-validation, reused unchanged:
      // manifestExecutionTotalToAttemptIndex hypothesizes "failed" as the
      // target status and proves it against history's terminal count and
      // (when present) durable lineage — exactly the same formula
      // seedJobsFromManifest and the job-side reconciliation both use.
      const rawManifest = await ProjectReader.readJSON<Record<string, unknown>>(
        projectSlug, "manifest.json");
      const rawPackages = rawManifest?.packages as Record<string, {
        attempts?: { total?: unknown };
      }> | undefined;
      const durableAdapter = new ProductionExecutionFilePersistenceAdapter({
        trustedRootDirectory: `${ProjectReader.getProjectFolder(projectSlug)}/production-execution`,
        createRootDirectory: false,
      });
      const durableKeys = await durableAdapter.listKeys("idempotency").catch(
        () => ({ ok: false as const }),
      );
      const hasDurableEvidence = durableKeys.ok && durableKeys.keys.length > 0;

      try {
        await manifestExecutionTotalToAttemptIndex(
          projectSlug,
          stage,
          "failed",
          rawPackages?.[stage]?.attempts &&
            Object.prototype.hasOwnProperty.call(rawPackages[stage].attempts, "total")
            ? rawPackages[stage].attempts?.total
            : packageManifest.attempts?.total,
          history,
          durableAdapter,
          hasDurableEvidence,
        );
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "unknown";
        return manifestReconciliationFailure(
          message === "PIPELINE_MANIFEST_DURABLE_ATTEMPT_EVIDENCE_MISMATCH"
            ? "MANIFEST_PACKAGE_STATUS_DRIFT_DURABLE_LINEAGE_MISMATCH"
            : "MANIFEST_PACKAGE_STATUS_DRIFT_HISTORY_MANIFEST_MISMATCH",
          [`formula:${message}`],
        );
      }

      // (6) Already "failed" and every check above passed: the record is
      // already canonical. Write-free no-op.
      if (packageManifest.status === "failed") {
        return {
          ok: true,
          reasonCode: "MANIFEST_PACKAGE_STATUS_DRIFT_ALREADY_RECONCILED",
          writeFree: true,
          evidence: ["package:already-canonical"],
          canonicalStatus: "failed",
          packageManifest,
        };
      }

      // (7) Second CAS, immediately before the write, under the same lock
      // acquisition. Everything above already ran inside this same
      // withProjectLock call, so no *cooperating* writer could have
      // changed anything since — but updatePackageUsage does not
      // cooperate with this lock at all, so re-reading and re-comparing
      // right before the write is the only way to catch it landing in
      // this exact window.
      const recheckManifest = await ProjectManager.ensureManifest(projectSlug);
      const recheckPackage = recheckManifest?.packages?.[stage];
      if (!recheckManifest || !recheckPackage ||
        recheckManifest.updatedAt !== manifest.updatedAt ||
        !manifestPackageSnapshotsEqual(snapshotOfPackage(recheckPackage), currentSnapshot)
      ) {
        return manifestReconciliationFailure(
          "MANIFEST_PACKAGE_STATUS_DRIFT_CAS_CONFLICT",
          ["manifest:concurrent-update-detected"]);
      }

      const now = new Date().toISOString();
      const updatedManifest = {
        ...recheckManifest,
        packages: {
          ...recheckManifest.packages,
          [stage]: { ...recheckPackage, status: "failed" as const, updatedAt: now },
        },
        updatedAt: now,
      };
      await ProjectWriter.writeJSON(projectSlug, "manifest.json", updatedManifest);

      return {
        ok: true,
        reasonCode: "MANIFEST_PACKAGE_STATUS_DRIFT_RECONCILED",
        writeFree: false,
        evidence: ["history:cross-checked", "manifest:cross-checked",
          ...(hasDurableEvidence ? ["durable:cross-checked"] : [])],
        canonicalStatus: "failed",
        packageManifest: updatedManifest.packages[stage],
      };
    });
  }

  static async persistStageSuccess(
    projectSlug: string,
    stage: ProductionStepKey,
    persist: () => Promise<void>,
  ): Promise<boolean> {
    return this.withProjectLock(projectSlug, async () => {
      const current = await this.listJobs(projectSlug);
      const job = current.jobs.find(
        (item) => item.id === getJobId(projectSlug, stage),
      );

      if (!this.canPersistStageResult(job)) {
        return false;
      }

      await persist();
      await this.transitionStageJobUnlocked(
        projectSlug,
        stage,
        "completed",
        (currentJob, now) => ({
          ...currentJob,
          status: "completed",
          updatedAt: now,
          completedAt: now,
          error: undefined,
          errorEvidence: undefined,
        }),
        true,
      );

      return true;
    });
  }

  static async startStage(
    projectSlug: string,
    stage: ProductionStepKey,
    persist: () => Promise<void>,
  ): Promise<boolean> {
    return this.withProjectLock(projectSlug, async () => {
      const current = await this.listJobs(projectSlug);
      const job = current.jobs.find(
        (item) => item.id === getJobId(projectSlug, stage),
      );

      if (!job || !this.canTransition(job.status, "running")) {
        return false;
      }

      await persist();
      await this.transitionStageJobUnlocked(
        projectSlug,
        stage,
        "running",
        (currentJob, now) => ({
          ...currentJob,
          status: "running",
          updatedAt: now,
          startedAt: now,
          completedAt: undefined,
          cancelRequestedAt: undefined,
          error: undefined,
          errorEvidence: undefined,
        }),
      );

      return true;
    });
  }

  static async persistStageFailure(
    projectSlug: string,
    stage: ProductionStepKey,
    persist: () => Promise<void>,
    error: string,
    errorEvidence?: PipelineErrorEvidence,
  ): Promise<boolean> {
    return this.withProjectLock(projectSlug, async () => {
      const current = await this.listJobs(projectSlug);
      const job = current.jobs.find(
        (item) => item.id === getJobId(projectSlug, stage),
      );

      if (!this.canPersistStageResult(job)) {
        return false;
      }

      await persist();
      await this.transitionStageJobUnlocked(
        projectSlug,
        stage,
        "failed",
        (currentJob, now) => ({
          ...currentJob,
          status: "failed",
          updatedAt: now,
          completedAt: now,
          error,
          errorEvidence,
        }),
      );

      return true;
    });
  }

  static async persistProjectCompletion(
    projectSlug: string,
    persist: () => Promise<void>,
  ): Promise<boolean> {
    return this.withProjectLock(projectSlug, async () => {
      const current = await this.listJobs(projectSlug);
      const hasBlockingJob = current.jobs.some(
        (job) => job.status !== "completed",
      );

      if (hasBlockingJob) {
        return false;
      }

      await persist();

      return true;
    });
  }

  static async applyAction(
    projectSlug: string,
    jobId: string,
    action: PipelineJobAction,
  ): Promise<PipelineJobActionResult> {
    return this.withProjectLock(projectSlug, () =>
      this.applyActionUnlocked(projectSlug, jobId, action),
    );
  }

  private static async applyActionUnlocked(
    projectSlug: string,
    jobId: string,
    action: PipelineJobAction,
  ): Promise<PipelineJobActionResult> {
    if (action === "retry") {
      return {
        success: false,
        status: 409,
        error: "Retry must be executed through PipelineRunner.",
      };
    }

    const current = await this.listJobs(projectSlug);
    const job = current.jobs.find((item) => item.id === jobId);

    if (!job) {
      return {
        success: false,
        status: 404,
        error: "Pipeline job not found.",
      };
    }

    if (!this.canTransition(job.status, "cancelled")) {
      return {
        success: false,
        status: 409,
        error: `Action "${action}" is not supported for "${job.status}" jobs.`,
      };
    }

    const now = new Date().toISOString();
    let actionJob: PipelineJob | undefined;
    const jobs = current.jobs.map((item) => {
      if (item.id !== jobId) {
        return item;
      }

      actionJob = this.cancelJob(item, now);
      return actionJob;
    });
    const nextJobs = await this.writeJobList(projectSlug, {
      ...current,
      jobs,
      updatedAt: now,
    });

    if (actionJob) {
      await this.recordHistoryEvent(projectSlug, actionJob, now);
    }

    return {
      success: true,
      jobs: nextJobs,
    };
  }

  private static cancelJob(job: PipelineJob, now: string): PipelineJob {
    if (job.status !== "queued" && job.status !== "running") {
      return job;
    }

    return {
      ...job,
      status: "cancelled",
      updatedAt: now,
      completedAt: now,
      cancelRequestedAt: now,
    };
  }

  private static retryJob(job: PipelineJob, now: string): PipelineJob {
    if (job.status !== "failed" && job.status !== "cancelled") {
      return job;
    }

    return {
      ...job,
      status: "queued",
      attempts: job.attempts + 1,
      updatedAt: now,
      startedAt: undefined,
      completedAt: undefined,
      cancelRequestedAt: undefined,
      error: undefined,
      errorEvidence: undefined,
      ...(job.regenerationId ? {
        globalExecutionOrdinal: job.attempts + 1,
        attemptWithinGeneration: (job.attemptWithinGeneration ?? 0) + 1,
      } : {}),
    };
  }

  private static canTransition(
    currentStatus: PipelineJobStatus,
    nextStatus: PipelineJobStatus,
  ) {
    return allowedStateTransitions[currentStatus].includes(nextStatus);
  }

  private static async transitionStageJobUnlocked(
    projectSlug: string,
    stage: ProductionStepKey,
    nextStatus: PipelineJobStatus,
    update: (job: PipelineJob, now: string) => PipelineJob,
    enqueueNextStage = false,
  ): Promise<PipelineJobList> {
    const current = await this.listJobs(projectSlug);
    const now = new Date().toISOString();
    const jobId = getJobId(projectSlug, stage);
    const existingJob = current.jobs.find((job) => job.id === jobId);
    const currentJob = existingJob ?? this.createJob(projectSlug, stage, now);

    if (!this.canTransition(currentJob.status, nextStatus)) {
      return current;
    }

    const nextJob = update(currentJob, now);
    let jobs = existingJob
      ? current.jobs.map((job) => (job.id === jobId ? nextJob : job))
      : [...current.jobs, nextJob];

    if (enqueueNextStage) {
      const nextStage = getNextPipelineStage(stage);
      const hasDownstreamJob = nextStage
        ? jobs.some((job) => job.stage === nextStage)
        : false;

      if (nextStage && !hasDownstreamJob) {
        jobs = [...jobs, this.createJob(projectSlug, nextStage, now)];
      }
    }

    const nextJobs = await this.writeJobList(projectSlug, {
      ...current,
      jobs,
      updatedAt: now,
    });

    await this.recordHistoryEvent(projectSlug, nextJob, now);

    return nextJobs;
  }

  private static canPersistStageResult(job: PipelineJob | undefined) {
    return job?.status === "running" && !job.cancelRequestedAt;
  }

  static async withProjectLock<T>(
    projectSlug: string,
    operation: () => Promise<T>,
    jobId = "*",
    storageInput: RuntimeStorageInput = {},
  ): Promise<T> {
    const projectFolder = ProjectReader.getProjectFolder(projectSlug, storageInput);
    const lockKey = `${projectFolder}\0${projectSlug}`;
    if (hasCanonicalPipelineJobMutationLock(projectSlug)) {
      return withCanonicalPipelineJobMutationLock(
        projectSlug, jobId, operation, storageInput);
    }
    let releaseCurrentLock: (() => void) | undefined;
    const currentLock = new Promise<void>((resolve) => {
      releaseCurrentLock = resolve;
    });
    const previousLock = this.projectLocks.get(lockKey);

    this.projectLocks.set(lockKey, currentLock);
    await previousLock;

    try {
      return await withCanonicalPipelineJobMutationLock(
        projectSlug, jobId, operation, storageInput);
    } finally {
      releaseCurrentLock?.();

      if (this.projectLocks.get(lockKey) === currentLock) {
        this.projectLocks.delete(lockKey);
      }
    }
  }

  private static createJob(
    projectSlug: string,
    stage: ProductionStepKey,
    now: string,
  ): PipelineJob {
    return {
      id: getJobId(projectSlug, stage),
      projectSlug,
      stage,
      title: stageLabels[stage],
      status: "queued",
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    };
  }

  private static async seedJobsFromManifest(
    projectSlug: string,
    current: PipelineJobList,
  ): Promise<PipelineJobList> {
    assertCanonicalPipelineJobMutationLock(projectSlug);
    const manifest = await ProjectManager.ensureManifest(projectSlug);
    const now = new Date().toISOString();

    if (!manifest) {
      return current;
    }

    const history = await this.readHistory(projectSlug);
    const rawManifest = await ProjectReader.readJSON<Record<string, unknown>>(
      projectSlug,
      "manifest.json",
    );
    const rawPackages = rawManifest?.packages as Record<string, {
      attempts?: { total?: unknown };
    }> | undefined;
    const durableAdapter = new ProductionExecutionFilePersistenceAdapter({
      trustedRootDirectory: `${ProjectReader.getProjectFolder(projectSlug)}/production-execution`,
      createRootDirectory: false,
    });
    const durableKeys = await durableAdapter.listKeys("idempotency").catch(
      () => ({ ok: false as const }),
    );
    const hasDurableEvidence = durableKeys.ok && durableKeys.keys.length > 0;
    const jobs: PipelineJob[] = await Promise.all(Object.values(manifest.packages).map(
      async (packageManifest) => ({
        id: getJobId(projectSlug, packageManifest.key),
        projectSlug,
        stage: packageManifest.key,
        title: stageLabels[packageManifest.key],
        status: toJobStatus(packageManifest.status),
        attempts: await manifestExecutionTotalToAttemptIndex(
          projectSlug,
          packageManifest.key,
          packageManifest.status,
          rawPackages?.[packageManifest.key]?.attempts &&
            Object.prototype.hasOwnProperty.call(
              rawPackages[packageManifest.key].attempts,
              "total",
            )
            ? rawPackages[packageManifest.key].attempts?.total
            : packageManifest.attempts?.total,
          history,
          durableAdapter,
          hasDurableEvidence,
        ),
        createdAt: packageManifest.updatedAt ?? manifest.createdAt,
        updatedAt: packageManifest.updatedAt ?? manifest.updatedAt,
        startedAt: packageManifest.startedAt,
        completedAt: packageManifest.completedAt,
        error: packageManifest.error,
      })),
    );

    return this.writeJobListUnderLock(projectSlug, {
      ...current,
      jobs,
      updatedAt: now,
    });
  }

  private static async readJobList(
    projectSlug: string,
    storageInput: RuntimeStorageInput = {},
  ): Promise<PipelineJobList> {
    const now = new Date().toISOString();
    const stored = await this.readPipelineStateFile(
      projectSlug,
      pipelineJobsFileName,
      (value): value is PipelineJobList => this.isJobList(value, projectSlug),
      storageInput,
    );

    if (!stored) {
      return {
        projectSlug,
        jobs: [],
        createdAt: now,
        updatedAt: now,
      };
    }

    return stored;
  }

  private static async writeJobList(
    projectSlug: string,
    jobList: PipelineJobList,
  ) {
    if (!hasCanonicalPipelineJobMutationLock(projectSlug)) {
      return this.withProjectLock(projectSlug, () =>
        this.writeJobListUnlocked(projectSlug, jobList));
    }
    return this.writeJobListUnlocked(projectSlug, jobList);
  }

  static async writeJobListUnderLock(
    projectSlug: string,
    jobList: PipelineJobList,
  ) {
    assertCanonicalPipelineJobMutationLock(projectSlug);
    return this.writeJobListUnlocked(projectSlug, jobList);
  }

  private static async writeJobListUnlocked(
    projectSlug: string,
    jobList: PipelineJobList,
  ) {
    assertCanonicalPipelineJobMutationLock(projectSlug);
    await ProjectWriter.writeJSONAtomically(
      projectSlug,
      pipelineJobsFileName,
      jobList,
    );

    return jobList;
  }

  private static async recordHistoryEvent(
    projectSlug: string,
    job: PipelineJob,
    now: string,
  ) {
    if (!isPipelineJobHistoryStatus(job.status)) {
      return;
    }

    const current = await this.readHistory(projectSlug);
    const event = createHistoryEvent(job, job.status, now);

    await ProjectWriter.writeJSONAtomically(
      projectSlug,
      pipelineHistoryFileName,
      {
        ...current,
        events: [...current.events, event],
        updatedAt: now,
      },
    );
  }

  private static async readHistory(
    projectSlug: string,
  ): Promise<PipelineJobHistory> {
    const now = new Date().toISOString();
    const stored = await this.readPipelineStateFile(
      projectSlug,
      pipelineHistoryFileName,
      (value): value is PipelineJobHistory =>
        this.isHistory(value, projectSlug),
    );

    if (!stored) {
      return {
        projectSlug,
        events: [],
        createdAt: now,
        updatedAt: now,
      };
    }

    return stored;
  }

  private static async readPipelineStateFile<T>(
    projectSlug: string,
    fileName: string,
    validate: (value: unknown) => value is T,
    storageInput: RuntimeStorageInput = {},
  ): Promise<T | null> {
    const state = getPipelineStateKind(fileName);
    let result: Awaited<
      ReturnType<typeof ProjectReader.readJSONState<unknown>>
    >;

    try {
      result = await ProjectReader.readJSONState<unknown>(
        projectSlug,
        fileName,
        storageInput,
      );
    } catch (cause) {
      throw new PipelineStateError(state, "read-failed", fileName, { cause });
    }

    if (result.status === "missing") {
      return null;
    }

    if (result.status === "malformed") {
      throw new PipelineStateError(state, "malformed", fileName);
    }

    if (!validate(result.value)) {
      throw new PipelineStateError(state, "invalid", fileName);
    }

    return result.value;
  }

  private static isJobList(
    value: unknown,
    projectSlug: string,
  ): value is PipelineJobList {
    if (!value || typeof value !== "object") {
      return false;
    }

    const record = value as PipelineJobList;

    return (
      record.projectSlug === projectSlug &&
      Array.isArray(record.jobs) &&
      typeof record.createdAt === "string" &&
      typeof record.updatedAt === "string" &&
      record.jobs.every(
        (job) => isPipelineJob(job) && job.projectSlug === projectSlug,
      )
    );
  }

  private static isHistory(
    value: unknown,
    projectSlug: string,
  ): value is PipelineJobHistory {
    if (!value || typeof value !== "object") {
      return false;
    }

    const record = value as PipelineJobHistory;

    return (
      record.projectSlug === projectSlug &&
      Array.isArray(record.events) &&
      typeof record.createdAt === "string" &&
      typeof record.updatedAt === "string" &&
      record.events.every(isPipelineJobHistoryEvent)
    );
  }
}

export type PipelineJobAttemptDriftReconciliationReasonCode =
  | "PIPELINE_JOB_ATTEMPT_DRIFT_RECONCILED"
  | "PIPELINE_JOB_ATTEMPT_DRIFT_ALREADY_RECONCILED"
  | "PIPELINE_JOB_ATTEMPT_DRIFT_NOT_FOUND"
  | "PIPELINE_JOB_ATTEMPT_DRIFT_CAS_CONFLICT"
  | "PIPELINE_JOB_ATTEMPT_DRIFT_STATUS_INELIGIBLE"
  | "PIPELINE_JOB_ATTEMPT_DRIFT_AHEAD_OF_CANONICAL"
  | "PIPELINE_JOB_ATTEMPT_DRIFT_HISTORY_MANIFEST_MISMATCH"
  | "PIPELINE_JOB_ATTEMPT_DRIFT_DURABLE_LINEAGE_MISMATCH"
  | "PIPELINE_JOB_ATTEMPT_DRIFT_REGENERATION_BINDING_MISSING"
  | "PIPELINE_JOB_ATTEMPT_DRIFT_REGENERATION_BINDING_MISMATCH";

export interface PipelineJobAttemptDriftReconciliationResult {
  readonly ok: boolean;
  readonly reasonCode: PipelineJobAttemptDriftReconciliationReasonCode;
  // true whenever this call performed zero writes (every fail-closed path,
  // plus the explicit "already reconciled" no-op path).
  readonly writeFree: boolean;
  readonly evidence: readonly string[];
  readonly canonical?: { readonly attempts: number;
    readonly attemptWithinGeneration?: number };
  readonly job?: PipelineJob;
}

function driftReconciliationFailure(
  reasonCode: PipelineJobAttemptDriftReconciliationReasonCode,
  evidence: readonly string[],
): PipelineJobAttemptDriftReconciliationResult {
  return { ok: false, reasonCode, writeFree: true, evidence };
}

export interface ManifestPackageStatusSnapshot {
  readonly status: PackageStatus;
  readonly completedAt: string | undefined;
  readonly startedAt: string | undefined;
  readonly attemptsTotal: number | undefined;
  readonly generationOrdinal: number | undefined;
  readonly regenerationId: string | undefined;
}

export type ManifestPackageStatusReconciliationReasonCode =
  | "MANIFEST_PACKAGE_STATUS_DRIFT_RECONCILED"
  | "MANIFEST_PACKAGE_STATUS_DRIFT_ALREADY_RECONCILED"
  | "MANIFEST_PACKAGE_STATUS_DRIFT_NOT_FOUND"
  | "MANIFEST_PACKAGE_STATUS_DRIFT_CAS_CONFLICT"
  | "MANIFEST_PACKAGE_STATUS_DRIFT_STATUS_INELIGIBLE"
  | "MANIFEST_PACKAGE_STATUS_DRIFT_PENDING_WITHOUT_COMPLETION_EVIDENCE"
  | "MANIFEST_PACKAGE_STATUS_DRIFT_AMBIGUOUS_EVIDENCE"
  | "MANIFEST_PACKAGE_STATUS_DRIFT_HISTORY_MANIFEST_MISMATCH"
  | "MANIFEST_PACKAGE_STATUS_DRIFT_DURABLE_LINEAGE_MISMATCH";

export interface ManifestPackageStatusReconciliationResult {
  readonly ok: boolean;
  readonly reasonCode: ManifestPackageStatusReconciliationReasonCode;
  // true whenever this call performed zero writes (every fail-closed path,
  // plus the explicit "already reconciled" no-op path).
  readonly writeFree: boolean;
  readonly evidence: readonly string[];
  readonly canonicalStatus?: "failed";
  readonly packageManifest?: ProjectPackageManifest;
}

function manifestReconciliationFailure(
  reasonCode: ManifestPackageStatusReconciliationReasonCode,
  evidence: readonly string[],
): ManifestPackageStatusReconciliationResult {
  return { ok: false, reasonCode, writeFree: true, evidence };
}

function snapshotOfPackage(packageManifest: ProjectPackageManifest): ManifestPackageStatusSnapshot {
  return {
    status: packageManifest.status,
    completedAt: packageManifest.completedAt,
    startedAt: packageManifest.startedAt,
    attemptsTotal: packageManifest.attempts?.total,
    generationOrdinal: packageManifest.generationOrdinal,
    regenerationId: packageManifest.regenerationId,
  };
}

function manifestPackageSnapshotsEqual(
  left: ManifestPackageStatusSnapshot,
  right: ManifestPackageStatusSnapshot,
): boolean {
  return left.status === right.status &&
    left.completedAt === right.completedAt &&
    left.startedAt === right.startedAt &&
    left.attemptsTotal === right.attemptsTotal &&
    left.generationOrdinal === right.generationOrdinal &&
    left.regenerationId === right.regenerationId;
}

function fingerprintManifestPackage(packageManifest: ProjectPackageManifest): string {
  return stableProductionId(
    "manifest-package-pre-mutation",
    JSON.parse(JSON.stringify(packageManifest)) as ProjectPackageManifest,
  );
}

type PipelineJobActionResult =
  | {
      success: true;
      jobs: PipelineJobList;
    }
  | {
      success: false;
      status: 404 | 409;
      error: string;
      reasonCode?: string;
    };

type PipelineJobRetryPreparationResult =
  | {
      success: true;
      job: PipelineJob;
      previousJob: PipelineJob;
      jobs: PipelineJobList;
    }
  | {
      success: false;
      status: 404 | 409;
      error: string;
      reasonCode?: string;
    };

async function manifestExecutionTotalToAttemptIndex(
  projectSlug: string,
  stage: ProductionStepKey,
  status: PackageStatus,
  total: unknown,
  history: PipelineJobHistory,
  adapter: ProductionExecutionFilePersistenceAdapter,
  hasDurableEvidence: boolean,
): Promise<number> {
  const executionTotal = total === undefined ? 0 : total;
  if (typeof executionTotal !== "number" ||
    !Number.isSafeInteger(executionTotal) || executionTotal < 0) {
    throw new Error("PIPELINE_MANIFEST_ATTEMPT_TOTAL_INVALID");
  }

  if (status === "pending" || status === "missing") {
    if (executionTotal !== 0) {
      throw new Error("PIPELINE_MANIFEST_ATTEMPT_EVIDENCE_MISMATCH");
    }
    return 0;
  }

  const jobId = getJobId(projectSlug, stage);
  const terminalEvents = history.events.filter((event) =>
    event.jobId === jobId && event.stage === stage);

  if (executionTotal === 0) {
    // A completed/failed package can legitimately carry no execution total
    // when it was settled by a bootstrap path that never went through
    // PipelineJobManager.startStage -- notably `research` completed via
    // ProjectManager.saveResearch on the initial pipeline run, which marks
    // the package pending -> completed directly, so
    // ProjectManager.updateAttemptMetadata (it only counts `running`
    // transitions) never records a total. Treat that as attempt index 0,
    // but ONLY when nothing else attests to an execution: no pipeline
    // history terminal event for this stage AND no durable execution
    // evidence for the project. If either exists, a zero total is real
    // drift and still fails closed (Sprint 129.33).
    if (
      (status === "completed" || status === "failed") &&
      terminalEvents.length === 0 &&
      !hasDurableEvidence
    ) {
      return 0;
    }
    throw new Error("PIPELINE_MANIFEST_ATTEMPT_EVIDENCE_MISMATCH");
  }

  const expectedTerminalCount = status === "running"
    ? executionTotal - 1
    : executionTotal;
  if (terminalEvents.length !== expectedTerminalCount) {
    throw new Error("PIPELINE_MANIFEST_ATTEMPT_EVIDENCE_MISMATCH");
  }
  if (status === "completed" || status === "failed") {
    const latest = terminalEvents.at(-1);
    if (latest?.status !== status) {
      throw new Error("PIPELINE_MANIFEST_ATTEMPT_EVIDENCE_MISMATCH");
    }
  }

  const attemptIndex = executionTotal - 1;
  if (!hasDurableEvidence) return attemptIndex;
  const lineage = await classifyProductionDurableAttemptLineage(
    adapter,
    projectSlug,
    stage,
    attemptIndex,
    "exact",
  );
  if (lineage.status !== "none" &&
    (lineage.status !== "valid" || lineage.maximumRecordAttempt !== executionTotal)) {
    throw new Error("PIPELINE_MANIFEST_DURABLE_ATTEMPT_EVIDENCE_MISMATCH");
  }
  return attemptIndex;
}

function getJobId(projectSlug: string, stage: ProductionStepKey) {
  return `${projectSlug}-${stage}`;
}

function isPipelineJob(value: unknown): value is PipelineJob {
  if (!value || typeof value !== "object") {
    return false;
  }

  const job = value as PipelineJob;

  return (
    typeof job.id === "string" &&
    job.id.length > 0 &&
    typeof job.projectSlug === "string" &&
    isProductionStepKey(job.stage) &&
    typeof job.title === "string" &&
    isPipelineJobStatus(job.status) &&
    typeof job.attempts === "number" &&
    Number.isFinite(job.attempts) &&
    typeof job.createdAt === "string" &&
    typeof job.updatedAt === "string" &&
    isOptionalString(job.startedAt) &&
    isOptionalString(job.completedAt) &&
    isOptionalString(job.cancelRequestedAt) &&
    isOptionalString(job.error) &&
    (job.errorEvidence === undefined || isPipelineErrorEvidence(job.errorEvidence))
    && isOptionalNonNegativeInteger(job.globalExecutionOrdinal)
    && isOptionalNonNegativeInteger(job.generationOrdinal)
    && isOptionalNonNegativeInteger(job.attemptWithinGeneration)
    && isOptionalString(job.regenerationId)
  );
}

function isOptionalNonNegativeInteger(value: unknown) {
  return value === undefined ||
    (typeof value === "number" && Number.isSafeInteger(value) && value >= 0);
}

function isPipelineJobStatus(value: unknown): value is PipelineJobStatus {
  return pipelineJobStatuses.includes(value as PipelineJobStatus);
}

function isPipelineJobHistoryStatus(
  value: PipelineJobStatus,
): value is PipelineJobHistoryStatus {
  return (
    value === "completed" || value === "failed" || value === "cancelled"
  );
}

function createHistoryEvent(
  job: PipelineJob,
  status: PipelineJobHistoryStatus,
  now: string,
): PipelineJobHistoryEvent {
  return {
    id: `${job.id}-${status}-${now}`,
    jobId: job.id,
    stage: job.stage,
    status,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    jobCreatedAt: job.createdAt,
    jobUpdatedAt: job.updatedAt,
    recordedAt: now,
    ...(job.error && /^[A-Z0-9_]{1,80}$/.test(job.error)
      ? { errorCode: job.error }
      : {}),
    ...(job.errorEvidence ? { errorEvidence: job.errorEvidence } : {}),
    ...(job.regenerationId ? {
      globalExecutionOrdinal: job.globalExecutionOrdinal,
      generationOrdinal: job.generationOrdinal,
      attemptWithinGeneration: job.attemptWithinGeneration,
      regenerationId: job.regenerationId,
    } : {}),
  };
}

function isPipelineJobHistoryEvent(
  value: unknown,
): value is PipelineJobHistoryEvent {
  if (!value || typeof value !== "object") {
    return false;
  }

  const event = value as PipelineJobHistoryEvent;

  return (
    typeof event.id === "string" &&
    event.id.length > 0 &&
    typeof event.jobId === "string" &&
    event.jobId.length > 0 &&
    isProductionStepKey(event.stage) &&
    isPipelineJobHistoryStatus(event.status as PipelineJobStatus) &&
    typeof event.jobCreatedAt === "string" &&
    typeof event.jobUpdatedAt === "string" &&
    typeof event.recordedAt === "string" &&
    isOptionalString(event.startedAt) &&
    isOptionalString(event.completedAt) &&
    isOptionalString(event.errorCode) &&
    (event.errorEvidence === undefined || isPipelineErrorEvidence(event.errorEvidence))
    && isOptionalNonNegativeInteger(event.globalExecutionOrdinal)
    && isOptionalNonNegativeInteger(event.generationOrdinal)
    && isOptionalNonNegativeInteger(event.attemptWithinGeneration)
    && isOptionalString(event.regenerationId)
  );
}

function isProductionStepKey(value: unknown): value is ProductionStepKey {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(stageLabels, value)
  );
}

function isOptionalString(value: unknown) {
  return value === undefined || typeof value === "string";
}

function getPipelineStateKind(fileName: string): PipelineStateKind {
  return fileName === pipelineJobsFileName ? "jobs" : "history";
}

function toJobStatus(status: PackageStatus): PipelineJobStatus {
  if (status === "running") {
    return "running";
  }

  if (status === "completed") {
    return "completed";
  }

  if (status === "failed") {
    return "failed";
  }

  return "queued";
}
