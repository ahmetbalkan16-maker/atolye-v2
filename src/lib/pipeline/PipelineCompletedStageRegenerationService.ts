import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PipelineJobManager } from "@/lib/pipeline/PipelineJobManager";
import {
  acquireProjectWriteAuthority,
  assertProjectWriteAuthorityLease,
  type RuntimeStorageContext,
} from "@/lib/runtime/RuntimeStoragePaths";
import {
  assertTrustedRuntimeBackupStorageAuthority,
  type RuntimeBackupStorageAuthority,
} from "@/lib/runtime/backup/RuntimeBackupAuthority";
import {
  runtimeBackupManifestSchemaVersion,
  runtimeBackupManifestSchemaVersionV3,
} from "@/lib/runtime/backup/RuntimeBackupManifest";
import { verifyRuntimeBackup } from "@/lib/runtime/backup/RuntimeBackupVerifier";
import {
  assertProductionRegenerationPhysicalProject,
  reassertProductionRegenerationPhysicalProject,
} from "@/lib/production/ProductionRegenerationPhysicalGuard";
import type { PipelineJobList } from "@/types/pipelineJob";
import type { ProjectManifest } from "@/types/project";
import {
  pipelineRegenerationSchemaVersion,
  supportedPipelineRegenerationFromStages,
  type PipelineRegenerationIntent,
  type PipelineRegenerationPlan,
  type PipelineRegenerationPreparedReceipt,
} from "@/types/pipelineRegeneration";
import { createPipelineCompletedStageRegenerationPlan } from
  "./PipelineCompletedStageRegenerationPlanner";
import { regenerationDirectory } from "./PipelineStageRegenerationStore";
import {
  canonicalRegenerationJson,
  listRegenerationIds,
  readRegenerationIntent,
  readRegenerationPreparedReceipt,
  isRegenerationCompleted,
  sha256,
  writeJsonOnce,
  writeOnce,
} from "./PipelineStageRegenerationStore";

/**
 * Prepare phase for the plain-pipeline completed-stage regeneration path. Mirrors the
 * atomic, verified, pre/post-hash-checked mutation pattern of
 * `ProductionCompletedStageRegenerationService.prepareCompletedStageRegeneration`, but
 * deliberately omits the acceptance-side's supersession-intent / package-binding /
 * durable-execution-admission bookkeeping (`validateSupersessionIntent`,
 * `requireRegenerationExecutionAdmission`, `recordRegeneratedPackageCompletion`):
 * that machinery exists solely to let the acceptance-gated durable execution factory
 * (`ProductionPipelineExecutionFactory`) recognize a superseded re-run — the plain
 * `PipelineStageExecutor`/`PipelineRunner` dispatch path this module targets has no such
 * concept and consumes none of it. What this module still snapshots the prior
 * `assembly.json` (write-once, before mutation) purely as an audit/rollback record.
 *
 * The only mutations this "prepare" step performs are: flipping `manifest.json`'s
 * affected packages to `pending` and `pipeline-jobs.json`'s affected jobs to `queued`
 * (incrementing `attempts` for the ones that were `completed`) — after that, the
 * *existing*, unmodified `PipelineRunner.resume()` (already wired at
 * `app/api/projects/[slug]/pipeline/resume/route.ts`) picks the queued stage up and
 * dispatches it through the ordinary `PipelineStageExecutor.execute()` — no new
 * FFmpeg/render call site is introduced here.
 */

export type PipelineRegenerationPreparationErrorCode =
  | "PIPELINE_REGENERATION_REQUEST_INVALID"
  | "PIPELINE_REGENERATION_PLAN_STALE"
  | "PIPELINE_REGENERATION_BACKUP_INVALID"
  | "PIPELINE_REGENERATION_BACKUP_STALE"
  | "PIPELINE_REGENERATION_CONFLICT"
  | "PIPELINE_REGENERATION_RECOVERY_REQUIRED";

export class PipelineRegenerationPreparationError extends Error {
  constructor(readonly code: PipelineRegenerationPreparationErrorCode) {
    super(code);
    this.name = "PipelineRegenerationPreparationError";
    this.stack = undefined;
  }
}

export async function preparePipelineCompletedStageRegeneration(input: {
  readonly plan: PipelineRegenerationPlan;
  readonly backupId: string;
  readonly reasonCode: string;
  readonly confirmation: string;
  readonly context: RuntimeStorageContext;
  readonly backupAuthority: RuntimeBackupStorageAuthority;
}): Promise<{
  readonly status: "prepared" | "already-prepared";
  readonly intent: PipelineRegenerationIntent;
  readonly receipt: PipelineRegenerationPreparedReceipt;
}> {
  validateRequest(input);
  assertTrustedRuntimeBackupStorageAuthority(input.backupAuthority);
  if (input.backupAuthority.context !== input.context) {
    throw new PipelineRegenerationPreparationError("PIPELINE_REGENERATION_BACKUP_INVALID");
  }
  const regenerationId = `pipeline-regen-${sha256(canonicalRegenerationJson({
    projectSlug: input.plan.projectSlug,
    projectId: input.plan.projectId,
    fromStage: input.plan.fromStage,
    generationOrdinal: input.plan.proposedGeneration,
    planFingerprint: input.plan.planFingerprint,
    reasonCode: input.reasonCode,
  })).slice(0, 48)}`;
  const lease = acquireProjectWriteAuthority(input.plan.projectSlug, input.context);
  try {
    assertProjectWriteAuthorityLease(lease, input.plan.projectSlug, input.context);
    const physicalProject = assertProductionRegenerationPhysicalProject(
      input.plan.projectSlug, input.context);
    return await PipelineJobManager.withProjectLock(input.plan.projectSlug, async () => {
      assertProjectWriteAuthorityLease(lease, input.plan.projectSlug, input.context);
      reassertProductionRegenerationPhysicalProject(physicalProject);
      rejectConflictingRegeneration(input.plan.projectSlug, regenerationId, input.context);

      const existingReceipt = readRegenerationPreparedReceipt(
        input.plan.projectSlug, regenerationId, input.context);
      const existingIntent = readRegenerationIntent(
        input.plan.projectSlug, regenerationId, input.context);
      if (existingReceipt && existingIntent) {
        assertPreparedReplay(input, regenerationId, existingIntent, existingReceipt);
        return { status: "already-prepared" as const, intent: existingIntent, receipt: existingReceipt };
      }
      if (existingReceipt && !existingIntent) {
        throw new PipelineRegenerationPreparationError("PIPELINE_REGENERATION_RECOVERY_REQUIRED");
      }

      const recovering = readRegenerationIntent(input.plan.projectSlug, regenerationId, input.context);
      const currentPlan = recovering ? input.plan : await createPipelineCompletedStageRegenerationPlan({
        projectSlug: input.plan.projectSlug,
        fromStage: input.plan.fromStage,
        context: input.context,
      });
      if (currentPlan.planFingerprint !== input.plan.planFingerprint ||
        (recovering && (recovering.planFingerprint !== input.plan.planFingerprint ||
          recovering.backupId !== input.backupId || recovering.reasonCode !== input.reasonCode))) {
        throw new PipelineRegenerationPreparationError("PIPELINE_REGENERATION_PLAN_STALE");
      }

      const verification = verifyBoundBackup(input, currentPlan);
      const projectFolder = path.join(input.context.projectsRoot, input.plan.projectSlug);
      const createdAt = recovering?.createdAt ?? new Date().toISOString();
      const mutations = recovering
        ? mutationsFromIntent(recovering)
        : buildMutations(projectFolder, currentPlan, regenerationId, input.reasonCode, createdAt);

      const intent: PipelineRegenerationIntent = Object.freeze({
        schemaVersion: pipelineRegenerationSchemaVersion,
        regenerationId,
        projectSlug: input.plan.projectSlug,
        projectId: input.plan.projectId,
        fromStage: input.plan.fromStage,
        generationOrdinal: input.plan.proposedGeneration,
        planFingerprint: input.plan.planFingerprint,
        reasonCode: input.reasonCode,
        backupId: input.backupId,
        backupManifestFingerprint: verification.manifestSha256,
        exactPrestateFingerprint: input.plan.projectAggregateFingerprint,
        preservedStages: input.plan.preservedStages,
        affectedStages: input.plan.effectiveSequence,
        createdAt,
        mutations: mutations.map(({ relativePath, preSha256, postSha256, postBytes, writeOnce: once }) =>
          Object.freeze({ relativePath, preSha256, postSha256,
            postBase64: postBytes.toString("base64"), writeOnce: once })),
      });

      const directory = regenerationDirectory(input.plan.projectSlug, regenerationId, input.context);
      reassertProductionRegenerationPhysicalProject(physicalProject, directory);
      writeJsonOnce(path.join(directory, "intent.json"), intent);
      for (const mutation of mutations) applyMutation(projectFolder, mutation, physicalProject);
      for (const mutation of mutations) assertMutation(projectFolder, mutation);

      const receiptCore = {
        schemaVersion: pipelineRegenerationSchemaVersion,
        regenerationId,
        projectSlug: input.plan.projectSlug,
        generationOrdinal: input.plan.proposedGeneration,
        planFingerprint: input.plan.planFingerprint,
        preparedAt: createdAt,
        mutationFingerprints: mutations.map((mutation) => mutation.postSha256),
      };
      const receipt: PipelineRegenerationPreparedReceipt = Object.freeze({
        ...receiptCore,
        fingerprint: sha256(canonicalRegenerationJson(receiptCore)),
      });
      writeJsonOnce(path.join(directory, "prepared.json"), receipt);
      return { status: "prepared" as const, intent, receipt };
    }, "*", input.context);
  } finally {
    lease.release();
  }
}

function assertPreparedReplay(
  input: Parameters<typeof preparePipelineCompletedStageRegeneration>[0],
  regenerationId: string,
  intent: PipelineRegenerationIntent,
  receipt: PipelineRegenerationPreparedReceipt,
) {
  const receiptCore = {
    schemaVersion: receipt.schemaVersion,
    regenerationId: receipt.regenerationId,
    projectSlug: receipt.projectSlug,
    generationOrdinal: receipt.generationOrdinal,
    planFingerprint: receipt.planFingerprint,
    preparedAt: receipt.preparedAt,
    mutationFingerprints: receipt.mutationFingerprints,
  };
  if (intent.schemaVersion !== pipelineRegenerationSchemaVersion ||
    intent.regenerationId !== regenerationId || intent.projectSlug !== input.plan.projectSlug ||
    intent.projectId !== input.plan.projectId || intent.fromStage !== input.plan.fromStage ||
    intent.generationOrdinal !== input.plan.proposedGeneration ||
    intent.planFingerprint !== input.plan.planFingerprint || intent.reasonCode !== input.reasonCode ||
    intent.backupId !== input.backupId ||
    intent.exactPrestateFingerprint !== input.plan.projectAggregateFingerprint ||
    receipt.schemaVersion !== pipelineRegenerationSchemaVersion ||
    receipt.regenerationId !== regenerationId || receipt.projectSlug !== input.plan.projectSlug ||
    receipt.generationOrdinal !== input.plan.proposedGeneration ||
    receipt.planFingerprint !== input.plan.planFingerprint ||
    receipt.fingerprint !== sha256(canonicalRegenerationJson(receiptCore))) {
    throw new PipelineRegenerationPreparationError("PIPELINE_REGENERATION_CONFLICT");
  }
}

interface Mutation {
  readonly relativePath: string;
  readonly preSha256: string | null;
  readonly postSha256: string;
  readonly postBytes: Buffer;
  readonly writeOnce: boolean;
}

function mutationsFromIntent(intent: PipelineRegenerationIntent): Mutation[] {
  return intent.mutations.map((mutation) => {
    const postBytes = Buffer.from(mutation.postBase64, "base64");
    if (sha256(postBytes) !== mutation.postSha256) {
      throw new PipelineRegenerationPreparationError("PIPELINE_REGENERATION_RECOVERY_REQUIRED");
    }
    return { ...mutation, postBytes };
  });
}

function buildMutations(
  projectFolder: string,
  plan: PipelineRegenerationPlan,
  regenerationId: string,
  reasonCode: string,
  createdAt: string,
): Mutation[] {
  const manifestPath = path.join(projectFolder, "manifest.json");
  const jobsPath = path.join(projectFolder, "pipeline-jobs.json");
  const manifestBytes = fs.readFileSync(manifestPath);
  const jobsBytes = fs.readFileSync(jobsPath);
  const manifest = JSON.parse(manifestBytes.toString("utf8")) as ProjectManifest;
  const jobs = JSON.parse(jobsBytes.toString("utf8")) as PipelineJobList;

  for (const stage of plan.effectiveSequence) {
    const currentPackage = manifest.packages[stage];
    manifest.packages[stage] = {
      ...currentPackage,
      status: "pending",
      updatedAt: createdAt,
      startedAt: undefined,
      completedAt: undefined,
      durationMs: undefined,
      error: undefined,
      errorEvidence: undefined,
      generationOrdinal: plan.proposedGeneration,
      regenerationId,
    };
    const index = jobs.jobs.findIndex((job) => job.stage === stage);
    if (index < 0) throw new PipelineRegenerationPreparationError("PIPELINE_REGENERATION_RECOVERY_REQUIRED");
    const currentJob = jobs.jobs[index];
    jobs.jobs[index] = {
      ...currentJob,
      status: "queued",
      attempts: currentJob.status === "completed" ? currentJob.attempts + 1 : currentJob.attempts,
      updatedAt: createdAt,
      startedAt: undefined,
      completedAt: undefined,
      cancelRequestedAt: undefined,
      error: undefined,
      errorEvidence: undefined,
      generationOrdinal: plan.proposedGeneration,
      attemptWithinGeneration: 0,
      regenerationId,
    };
  }
  manifest.updatedAt = createdAt;
  jobs.updatedAt = createdAt;

  const directory = `pipeline-regeneration/regenerations/${regenerationId}`;
  const historicalMutations: Mutation[] = [];
  // Audit-only snapshot of the pre-regeneration assembly.json (write-once). Unlike the
  // acceptance-side "supersession intent", nothing downstream reads or validates this
  // against a durable admission binding — it exists purely so the prior assembly plan
  // is never lost, matching the codebase's append-only asset philosophy.
  const assemblyPath = path.join(projectFolder, "assembly.json");
  if (fs.existsSync(assemblyPath)) {
    historicalMutations.push(createMutation(
      `${directory}/snapshots/generation-${plan.currentGeneration}/assembly.json`,
      fs.readFileSync(assemblyPath),
    ));
  }

  return [
    ...historicalMutations,
    replaceMutation("manifest.json", manifestBytes, Buffer.from(canonicalRegenerationJson(manifest))),
    replaceMutation("pipeline-jobs.json", jobsBytes, Buffer.from(canonicalRegenerationJson(jobs))),
  ];
}

function replaceMutation(relativePath: string, before: Buffer, after: Buffer): Mutation {
  return { relativePath, preSha256: sha256(before), postSha256: sha256(after), postBytes: after,
    writeOnce: false };
}

function createMutation(relativePath: string, after: Buffer): Mutation {
  return { relativePath, preSha256: null, postSha256: sha256(after), postBytes: after, writeOnce: true };
}

function applyMutation(
  projectFolder: string,
  mutation: Mutation,
  physicalProject: ReturnType<typeof assertProductionRegenerationPhysicalProject>,
) {
  const target = safeProjectPath(projectFolder, mutation.relativePath);
  reassertProductionRegenerationPhysicalProject(physicalProject, target);
  const current = fileHash(target);
  if (current === mutation.postSha256) return;
  if (current !== mutation.preSha256) {
    throw new PipelineRegenerationPreparationError("PIPELINE_REGENERATION_RECOVERY_REQUIRED");
  }
  if (mutation.writeOnce) {
    writeOnce(target, mutation.postBytes);
    return;
  }
  atomicReplace(target, mutation.postBytes);
}

function assertMutation(projectFolder: string, mutation: Mutation) {
  if (fileHash(safeProjectPath(projectFolder, mutation.relativePath)) !== mutation.postSha256) {
    throw new PipelineRegenerationPreparationError("PIPELINE_REGENERATION_RECOVERY_REQUIRED");
  }
}

function atomicReplace(target: string, bytes: Buffer) {
  const temporary = `${target}.pipeline-regeneration-${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, bytes, { flag: "wx" });
  try {
    fs.renameSync(temporary, target);
  } finally {
    try { fs.unlinkSync(temporary); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

function verifyBoundBackup(
  input: Parameters<typeof preparePipelineCompletedStageRegeneration>[0],
  plan: PipelineRegenerationPlan,
) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/.test(input.backupId) || input.backupId.includes(".partial")) {
    throw new PipelineRegenerationPreparationError("PIPELINE_REGENERATION_BACKUP_INVALID");
  }
  const backupDirectory = path.join(input.backupAuthority.canonicalBackupRoot, "backups", input.backupId);
  let verification: ReturnType<typeof verifyRuntimeBackup>;
  try { verification = verifyRuntimeBackup(backupDirectory); } catch {
    throw new PipelineRegenerationPreparationError("PIPELINE_REGENERATION_BACKUP_INVALID");
  }
  const manifest = verification.manifest;
  const isV4 = manifest.schemaVersion === runtimeBackupManifestSchemaVersion;
  const isV3 = manifest.schemaVersion === runtimeBackupManifestSchemaVersionV3;
  if (!isV4 && !isV3) {
    throw new PipelineRegenerationPreparationError("PIPELINE_REGENERATION_BACKUP_INVALID");
  }
  if (isV4) {
    const hasProject = manifest.sourceProjectIdentities?.some(
      (entry) => entry.projectSlug === plan.projectSlug);
    if (!hasProject) {
      throw new PipelineRegenerationPreparationError("PIPELINE_REGENERATION_BACKUP_INVALID");
    }
  } else {
    if (
      manifest.sourceLogicalIdentity !== `projects/${plan.projectSlug}` ||
      manifest.sourceRuntimeAuthority?.projectIdentity !== `projects/${plan.projectSlug}`
    ) {
      throw new PipelineRegenerationPreparationError("PIPELINE_REGENERATION_BACKUP_INVALID");
    }
  }
  if (manifest.aggregateFingerprint !== plan.projectAggregateFingerprint) {
    throw new PipelineRegenerationPreparationError("PIPELINE_REGENERATION_BACKUP_STALE");
  }
  return verification;
}

function validateRequest(input: Parameters<typeof preparePipelineCompletedStageRegeneration>[0]) {
  if (!supportedPipelineRegenerationFromStages.includes(
    input.plan.fromStage as typeof supportedPipelineRegenerationFromStages[number]) ||
    input.confirmation !== input.plan.planFingerprint ||
    !/^[a-f0-9]{64}$/.test(input.plan.planFingerprint) ||
    !/^[A-Z][A-Z0-9_]{2,63}$/.test(input.reasonCode)) {
    throw new PipelineRegenerationPreparationError("PIPELINE_REGENERATION_REQUEST_INVALID");
  }
}

function rejectConflictingRegeneration(
  projectSlug: string,
  regenerationId: string,
  context: RuntimeStorageContext,
) {
  for (const id of listRegenerationIds(projectSlug, context)) {
    if (id === regenerationId) continue;
    if (readRegenerationIntent(projectSlug, id, context) &&
      !isRegenerationCompleted(projectSlug, id, context)) {
      throw new PipelineRegenerationPreparationError("PIPELINE_REGENERATION_CONFLICT");
    }
  }
}

function safeProjectPath(projectFolder: string, relativePath: string) {
  const target = path.resolve(projectFolder, ...relativePath.split("/"));
  const relative = path.relative(projectFolder, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new PipelineRegenerationPreparationError("PIPELINE_REGENERATION_RECOVERY_REQUIRED");
  }
  return target;
}

function fileHash(filePath: string): string | null {
  try { return sha256(fs.readFileSync(filePath)); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
