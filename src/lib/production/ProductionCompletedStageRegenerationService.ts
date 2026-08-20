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
  runtimeBackupFormatVersion,
  runtimeBackupManifestSchemaVersion,
} from "@/lib/runtime/backup/RuntimeBackupManifest";
import { verifyRuntimeBackup } from "@/lib/runtime/backup/RuntimeBackupVerifier";
import type { PipelineJobList } from "@/types/pipelineJob";
import type { ProjectManifest } from "@/types/project";
import {
  productionRegenerationSchemaVersion,
  type ProductionRegenerationIntent,
  type ProductionRegenerationPlan,
  type ProductionRegenerationPreparedReceipt,
} from "@/types/productionRegeneration";
import { createCompletedStageRegenerationPlan } from
  "./ProductionCompletedStageRegenerationPlanner";
import { regenerationDirectory } from "./ProductionCompletedStageRegenerationPaths";
import { assertProductionRegenerationPhysicalProject,
  reassertProductionRegenerationPhysicalProject } from "./ProductionRegenerationPhysicalGuard";
import {
  canonicalRegenerationJson,
  listRegenerationIds,
  readRegenerationIntent,
  readRegenerationPreparedReceipt,
  isRegenerationCompleted,
  sha256,
  collectRegenerationStageOutputAssetIds,
  collectRegenerationPredecessorAssetEvidence,
  writeJsonOnce,
  writeOnce,
} from "./ProductionCompletedStageRegenerationStore";

export type ProductionRegenerationPreparationErrorCode =
  | "PRODUCTION_REGENERATION_REQUEST_INVALID"
  | "PRODUCTION_REGENERATION_PLAN_STALE"
  | "PRODUCTION_REGENERATION_BACKUP_INVALID"
  | "PRODUCTION_REGENERATION_BACKUP_STALE"
  | "PRODUCTION_REGENERATION_CONFLICT"
  | "PRODUCTION_REGENERATION_RECOVERY_REQUIRED";

export class ProductionRegenerationPreparationError extends Error {
  constructor(readonly code: ProductionRegenerationPreparationErrorCode) {
    super(code);
    this.name = "ProductionRegenerationPreparationError";
    this.stack = undefined;
  }
}

export interface ProductionRegenerationPreparationHooks {
  readonly afterIntent?: () => void;
  readonly afterMutation?: (relativePath: string, index: number) => void;
  readonly beforePreparedReceipt?: () => void;
}

export async function prepareCompletedStageRegeneration(input: {
  readonly plan: ProductionRegenerationPlan;
  readonly backupId: string;
  readonly reasonCode: string;
  readonly confirmation: string;
  readonly context: RuntimeStorageContext;
  readonly backupAuthority: RuntimeBackupStorageAuthority;
  readonly hooks?: ProductionRegenerationPreparationHooks;
}): Promise<{ readonly status: "prepared" | "already-prepared";
  readonly intent: ProductionRegenerationIntent;
  readonly receipt: ProductionRegenerationPreparedReceipt }> {
  validateRequest(input);
  assertTrustedRuntimeBackupStorageAuthority(input.backupAuthority);
  if (input.backupAuthority.context !== input.context ||
    input.backupAuthority.runtimeAuthorityId !== input.plan.runtimeAuthorityId) {
    throw new ProductionRegenerationPreparationError("PRODUCTION_REGENERATION_BACKUP_INVALID");
  }
  const regenerationId = `regen-${sha256(canonicalRegenerationJson({
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
        const verification = verifyBoundBackup(input, input.plan);
        assertPreparedReplay(input, regenerationId, existingIntent, existingReceipt,
          verification.manifestSha256);
        return { status: "already-prepared" as const, intent: existingIntent,
          receipt: existingReceipt };
      }
      if (existingReceipt && !existingIntent) {
        throw new ProductionRegenerationPreparationError("PRODUCTION_REGENERATION_RECOVERY_REQUIRED");
      }
      const recovering = readRegenerationIntent(
        input.plan.projectSlug, regenerationId, input.context);
      const currentPlan = recovering ? input.plan : await createCompletedStageRegenerationPlan({
          projectSlug: input.plan.projectSlug,
          fromStage: input.plan.fromStage,
          context: input.context,
          runtimeAuthorityId: input.plan.runtimeAuthorityId,
        });
      if (currentPlan.planFingerprint !== input.plan.planFingerprint ||
        (recovering && (recovering.planFingerprint !== input.plan.planFingerprint ||
          recovering.backupId !== input.backupId || recovering.reasonCode !== input.reasonCode ||
          recovering.runtimeAuthorityId !== input.plan.runtimeAuthorityId))) {
        throw new ProductionRegenerationPreparationError("PRODUCTION_REGENERATION_PLAN_STALE");
      }
      const verification = verifyBoundBackup(input, currentPlan);
      const projectFolder = path.join(input.context.projectsRoot, input.plan.projectSlug);
      const createdAt = recovering?.createdAt ?? new Date().toISOString();
      const mutations = recovering
        ? mutationsFromIntent(recovering)
        : buildMutations(projectFolder, currentPlan, regenerationId, input.reasonCode, createdAt);
      const intent: ProductionRegenerationIntent = Object.freeze({
        schemaVersion: productionRegenerationSchemaVersion,
        regenerationId,
        projectSlug: input.plan.projectSlug,
        projectId: input.plan.projectId,
        fromStage: input.plan.fromStage,
        generationOrdinal: input.plan.proposedGeneration,
        planFingerprint: input.plan.planFingerprint,
        reasonCode: input.reasonCode,
        runtimeAuthorityId: input.plan.runtimeAuthorityId,
        runtimeStorageIdentity: input.plan.runtimeStorageIdentity,
        backupId: input.backupId,
        backupManifestFingerprint: verification.manifestSha256,
        exactPrestateFingerprint: input.plan.projectAggregateFingerprint,
        audioPreservationFingerprint: input.plan.audioPreservationFingerprint,
        audioFiles: input.plan.audioFiles,
        preservedStages: input.plan.preservedStages,
        affectedStages: input.plan.effectiveSequence,
        createdAt,
        mutations: mutations.map(({ relativePath, preSha256, postSha256, postBytes, writeOnce }) =>
          Object.freeze({ relativePath, preSha256, postSha256,
            postBase64: postBytes.toString("base64"), writeOnce })),
      });
      const directory = regenerationDirectory(input.plan.projectSlug, regenerationId, input.context);
      reassertProductionRegenerationPhysicalProject(physicalProject, directory);
      writeJsonOnce(path.join(directory, "intent.json"), intent);
      input.hooks?.afterIntent?.();
      for (let index = 0; index < mutations.length; index += 1) {
        applyMutation(projectFolder, mutations[index], physicalProject);
        input.hooks?.afterMutation?.(mutations[index].relativePath, index);
      }
      for (const mutation of mutations) assertMutation(projectFolder, mutation);
      input.hooks?.beforePreparedReceipt?.();
      const receiptCore = {
        schemaVersion: productionRegenerationSchemaVersion,
        regenerationId,
        projectSlug: input.plan.projectSlug,
        generationOrdinal: input.plan.proposedGeneration,
        planFingerprint: input.plan.planFingerprint,
        preparedAt: createdAt,
        mutationFingerprints: mutations.map((mutation) => mutation.postSha256),
      };
      const receipt: ProductionRegenerationPreparedReceipt = Object.freeze({
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
  input: Parameters<typeof prepareCompletedStageRegeneration>[0],
  regenerationId: string,
  intent: ProductionRegenerationIntent,
  receipt: ProductionRegenerationPreparedReceipt,
  backupManifestFingerprint: string,
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
  if (intent.schemaVersion !== productionRegenerationSchemaVersion ||
    intent.regenerationId !== regenerationId || intent.projectSlug !== input.plan.projectSlug ||
    intent.projectId !== input.plan.projectId ||
    (intent.fromStage !== "video" && intent.fromStage !== "assembly") ||
    intent.generationOrdinal !== input.plan.proposedGeneration ||
    intent.planFingerprint !== input.plan.planFingerprint || intent.reasonCode !== input.reasonCode ||
    intent.backupId !== input.backupId ||
    intent.backupManifestFingerprint !== backupManifestFingerprint ||
    intent.exactPrestateFingerprint !== input.plan.projectAggregateFingerprint ||
    intent.runtimeAuthorityId !== input.plan.runtimeAuthorityId ||
    intent.runtimeStorageIdentity !== input.plan.runtimeStorageIdentity ||
    receipt.schemaVersion !== productionRegenerationSchemaVersion ||
    receipt.regenerationId !== regenerationId || receipt.projectSlug !== input.plan.projectSlug ||
    receipt.generationOrdinal !== input.plan.proposedGeneration ||
    receipt.planFingerprint !== input.plan.planFingerprint ||
    receipt.fingerprint !== sha256(canonicalRegenerationJson(receiptCore))) {
    throw new ProductionRegenerationPreparationError("PRODUCTION_REGENERATION_CONFLICT");
  }
}

interface Mutation {
  readonly relativePath: string;
  readonly preSha256: string | null;
  readonly postSha256: string;
  readonly postBytes: Buffer;
  readonly writeOnce: boolean;
}

function mutationsFromIntent(intent: ProductionRegenerationIntent): Mutation[] {
  return intent.mutations.map((mutation) => {
    const postBytes = Buffer.from(mutation.postBase64, "base64");
    if (sha256(postBytes) !== mutation.postSha256) {
      throw new ProductionRegenerationPreparationError("PRODUCTION_REGENERATION_RECOVERY_REQUIRED");
    }
    return { ...mutation, postBytes };
  });
}

function buildMutations(
  projectFolder: string,
  plan: ProductionRegenerationPlan,
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
  const registry = JSON.parse(fs.readFileSync(
    path.join(projectFolder, "assets", "assets.json"), "utf8")) as unknown;
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
    if (index < 0) throw new ProductionRegenerationPreparationError("PRODUCTION_REGENERATION_RECOVERY_REQUIRED");
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
      globalExecutionOrdinal:
        currentJob.status === "completed" ? currentJob.attempts + 1 : currentJob.attempts,
      generationOrdinal: plan.proposedGeneration,
      attemptWithinGeneration: 0,
      regenerationId,
    };
  }
  manifest.updatedAt = createdAt;
  jobs.updatedAt = createdAt;
  const directory = `production-regeneration/regenerations/${regenerationId}`;
  const historicalMutations: Mutation[] = [];
  // Supersession bookkeeping is only implemented for stages that produce a
  // physical, asset-carrying package (`video.json` / `assembly.json`). Only
  // supersede one when it actually appears in this plan's effective sequence
  // (regenerated, or invalidated and due to be redone) — a preserved stage
  // (e.g. `video` on an assembly-only regeneration) must never be snapshotted
  // or superseded: its output stays canonical and untouched.
  const supersedableStages = (["video", "assembly"] as const)
    .filter((stage) => plan.effectiveSequence.includes(stage));
  for (const stage of supersedableStages) {
    const packagePath = path.join(projectFolder, `${stage}.json`);
    if (!fs.existsSync(packagePath)) continue;
    const bytes = fs.readFileSync(packagePath);
    const previousAssetIds = collectRegenerationStageOutputAssetIds(
      stage, JSON.parse(bytes.toString("utf8")) as unknown);
    if (previousAssetIds.length === 0) {
      throw new ProductionRegenerationPreparationError("PRODUCTION_REGENERATION_RECOVERY_REQUIRED");
    }
    historicalMutations.push(createMutation(
      `${directory}/snapshots/generation-${plan.currentGeneration}/${stage}.json`, bytes));
    historicalMutations.push(createMutation(
      `${directory}/supersession/${stage}-intended.json`,
      Buffer.from(canonicalRegenerationJson({
         schemaVersion: productionRegenerationSchemaVersion,
         regenerationId,
         projectSlug: plan.projectSlug,
         projectId: plan.projectId,
         generationOrdinal: plan.proposedGeneration,
         previousGenerationOrdinal: plan.currentGeneration,
         stage,
        state: "intended",
        reasonCode,
         previousPackageSha256: sha256(bytes),
         previousAssetIds,
         previousAssets: collectRegenerationPredecessorAssetEvidence(
           projectFolder, plan.projectSlug, registry, previousAssetIds),
        createdAt,
      })),
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
  return { relativePath, preSha256: null, postSha256: sha256(after), postBytes: after,
    writeOnce: true };
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
    throw new ProductionRegenerationPreparationError("PRODUCTION_REGENERATION_RECOVERY_REQUIRED");
  }
  if (mutation.writeOnce) {
    writeOnce(target, mutation.postBytes);
    return;
  }
  atomicReplace(target, mutation.postBytes);
}

function assertMutation(projectFolder: string, mutation: Mutation) {
  if (fileHash(safeProjectPath(projectFolder, mutation.relativePath)) !== mutation.postSha256) {
    throw new ProductionRegenerationPreparationError("PRODUCTION_REGENERATION_RECOVERY_REQUIRED");
  }
}

function atomicReplace(target: string, bytes: Buffer) {
  const temporary = `${target}.regeneration-${randomUUID()}.tmp`;
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
  input: Parameters<typeof prepareCompletedStageRegeneration>[0],
  plan: ProductionRegenerationPlan,
) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/.test(input.backupId) || input.backupId.includes(".partial")) {
    throw new ProductionRegenerationPreparationError("PRODUCTION_REGENERATION_BACKUP_INVALID");
  }
  const backupDirectory = path.join(input.backupAuthority.canonicalBackupRoot, "backups", input.backupId);
  let verification: ReturnType<typeof verifyRuntimeBackup>;
  try { verification = verifyRuntimeBackup(backupDirectory); } catch {
    throw new ProductionRegenerationPreparationError("PRODUCTION_REGENERATION_BACKUP_INVALID");
  }
  const manifest = verification.manifest;
  if (manifest.schemaVersion !== runtimeBackupManifestSchemaVersion ||
    manifest.backupFormatVersion !== runtimeBackupFormatVersion ||
    manifest.sourceLogicalIdentity !== `projects/${plan.projectSlug}` ||
    manifest.sourceRuntimeAuthority?.runtimeAuthorityId !== input.backupAuthority.runtimeAuthorityId ||
    manifest.sourceRuntimeAuthority.projectIdentity !== `projects/${plan.projectSlug}`) {
    throw new ProductionRegenerationPreparationError("PRODUCTION_REGENERATION_BACKUP_INVALID");
  }
  if (manifest.aggregateFingerprint !== plan.projectAggregateFingerprint) {
    throw new ProductionRegenerationPreparationError("PRODUCTION_REGENERATION_BACKUP_STALE");
  }
  return verification;
}

function validateRequest(input: Parameters<typeof prepareCompletedStageRegeneration>[0]) {
  if ((input.plan.fromStage !== "video" && input.plan.fromStage !== "assembly") ||
    input.confirmation !== input.plan.planFingerprint ||
    !/^[a-f0-9]{64}$/.test(input.plan.planFingerprint) ||
    !/^[A-Z][A-Z0-9_]{2,63}$/.test(input.reasonCode)) {
    throw new ProductionRegenerationPreparationError("PRODUCTION_REGENERATION_REQUEST_INVALID");
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
      throw new ProductionRegenerationPreparationError("PRODUCTION_REGENERATION_CONFLICT");
    }
  }
}

function safeProjectPath(projectFolder: string, relativePath: string) {
  const target = path.resolve(projectFolder, ...relativePath.split("/"));
  const relative = path.relative(projectFolder, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new ProductionRegenerationPreparationError("PRODUCTION_REGENERATION_RECOVERY_REQUIRED");
  }
  return target;
}

function fileHash(filePath: string): string | null {
  try { return sha256(fs.readFileSync(filePath)); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
