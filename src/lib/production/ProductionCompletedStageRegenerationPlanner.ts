import fs from "node:fs";
import path from "node:path";
import { ProjectReader } from "@/lib/projects/ProjectReader";
import { PipelineJobManager } from "@/lib/pipeline/PipelineJobManager";
import { isCompatibleVideoData } from "@/lib/video/VideoDataValidation";
import { validateYouTubePublishRecord } from "@/lib/youtube/publish/YouTubePublishValidation";
import { ProductionExecutionFilePersistenceAdapter } from "./ProductionExecutionPersistence";
import { validateProductionGlobalTerminalQuiescence } from
  "./ProductionGlobalTerminalQuiescence";
import { readCanonicalProductionAcceptanceMarkerDescriptorBound } from
  "./ProductionAcceptanceMarkerDescriptorReader";
import type { RuntimeStorageContext } from "@/lib/runtime/RuntimeStoragePaths";
import type { PipelineRecoveryStageKey } from "@/types/pipelineRecovery";
import type { Project, ProjectManifest } from "@/types/project";
import {
  productionRegenerationSchemaVersion,
  type ProductionRegenerationFileFingerprint,
  type ProductionRegenerationPlan,
} from "@/types/productionRegeneration";
import { getProductionRegenerationClosure } from
  "./ProductionCompletedStageRegenerationGraph";
import { assertProductionRegenerationPhysicalProject } from
  "./ProductionRegenerationPhysicalGuard";
import { aggregateRuntimeFileRecords } from "@/lib/runtime/backup/RuntimeBackupManifest";
import {
  canonicalRegenerationJson,
  buildAudioPreservationFingerprint,
  listRegenerationIds,
  readRegenerationIntent,
  readRegenerationPreparedReceipt,
  isRegenerationCompleted,
  sha256,
} from "./ProductionCompletedStageRegenerationStore";

export type ProductionRegenerationPlanErrorCode =
  | "PRODUCTION_REGENERATION_STAGE_INVALID"
  | "PRODUCTION_REGENERATION_PROJECT_INVALID"
  | "PRODUCTION_REGENERATION_SOURCE_NOT_COMPLETED"
  | "PRODUCTION_REGENERATION_DEPENDENCY_INVALID"
  | "PRODUCTION_REGENERATION_AUDIO_INVALID"
  | "PRODUCTION_REGENERATION_NOT_QUIESCENT"
  | "PRODUCTION_REGENERATION_MARKER_INVALID"
  | "PRODUCTION_REGENERATION_EXTERNAL_SIDE_EFFECT"
  | "PRODUCTION_REGENERATION_CONFLICT";

export class ProductionRegenerationPlanError extends Error {
  constructor(readonly code: ProductionRegenerationPlanErrorCode) {
    super(code);
    this.name = "ProductionRegenerationPlanError";
    this.stack = undefined;
  }
}

export async function createCompletedStageRegenerationPlan(input: {
  readonly projectSlug: string;
  readonly fromStage: PipelineRecoveryStageKey;
  readonly context: RuntimeStorageContext;
  readonly runtimeAuthorityId: string;
}): Promise<ProductionRegenerationPlan> {
  if (input.fromStage !== "video" && input.fromStage !== "assembly") {
    throw new ProductionRegenerationPlanError("PRODUCTION_REGENERATION_STAGE_INVALID");
  }
  const projectFolder = ProjectReader.getProjectFolder(input.projectSlug, input.context);
  assertProductionRegenerationPhysicalProject(input.projectSlug, input.context, projectFolder);
  const [project, manifest, jobs] = await Promise.all([
    ProjectReader.readJSON<Project>(input.projectSlug, "project.json", input.context),
    ProjectReader.readJSON<ProjectManifest>(input.projectSlug, "manifest.json", input.context),
    PipelineJobManager.listJobsReadOnly(input.projectSlug, input.context),
  ]);
  if (!project || !manifest || project.slug !== input.projectSlug || manifest.slug !== input.projectSlug ||
    manifest.projectId !== project.id || manifest.project.id !== project.id) {
    throw new ProductionRegenerationPlanError("PRODUCTION_REGENERATION_PROJECT_INVALID");
  }
  if (manifest.packages[input.fromStage].status !== "completed" ||
    !await stagePackageReady(input.projectSlug, input.fromStage, input.context)) {
    throw new ProductionRegenerationPlanError("PRODUCTION_REGENERATION_SOURCE_NOT_COMPLETED");
  }
  const active = listRegenerationIds(input.projectSlug, input.context).some((id) =>
    readRegenerationIntent(input.projectSlug, id, input.context) !== null &&
    readRegenerationPreparedReceipt(input.projectSlug, id, input.context) !== null &&
    !isRegenerationCompleted(input.projectSlug, id, input.context));
  if (active) throw new ProductionRegenerationPlanError("PRODUCTION_REGENERATION_CONFLICT");
  const closure = getProductionRegenerationClosure(input.fromStage);
  for (const stage of [...closure.preservedStages, input.fromStage]) {
    const matchingJobs = jobs.jobs.filter((job) => job.stage === stage);
    if (matchingJobs.length !== 1 || matchingJobs[0].status !== "completed") {
      throw new ProductionRegenerationPlanError("PRODUCTION_REGENERATION_DEPENDENCY_INVALID");
    }
  }
  for (const stage of closure.preservedStages) {
    if (manifest.packages[stage].status !== "completed" ||
      !await stagePackageReady(input.projectSlug, stage, input.context)) {
      throw new ProductionRegenerationPlanError("PRODUCTION_REGENERATION_DEPENDENCY_INVALID");
    }
  }
  const durable = new ProductionExecutionFilePersistenceAdapter({
    trustedRootDirectory: path.join(projectFolder, "production-execution"),
    createRootDirectory: false,
  });
  if (!await validateProductionGlobalTerminalQuiescence(durable, input.projectSlug)) {
    throw new ProductionRegenerationPlanError("PRODUCTION_REGENERATION_NOT_QUIESCENT");
  }
  await validateNoExternalPublication(input.projectSlug, project.id, input.context);
  let marker: ReturnType<typeof readCanonicalProductionAcceptanceMarkerDescriptorBound>;
  try {
    marker = readCanonicalProductionAcceptanceMarkerDescriptorBound({ projectFolder });
  } catch {
    throw new ProductionRegenerationPlanError("PRODUCTION_REGENERATION_MARKER_INVALID");
  }
  const files = fingerprintTree(projectFolder);
  const audioFiles = files.filter((file) =>
    file.relativePath.startsWith("assets/audio/") && file.relativePath.toLowerCase().endsWith(".wav"));
  const audioJson = files.find((file) => file.relativePath === "audio.json");
  if ((input.fromStage === "video" || input.fromStage === "assembly") &&
    (!audioJson || audioFiles.length !== 7)) {
    throw new ProductionRegenerationPlanError("PRODUCTION_REGENERATION_AUDIO_INVALID");
  }
  const currentGeneration = latestGeneration(input.projectSlug, input.context);
  const common = {
    schemaVersion: productionRegenerationSchemaVersion,
    projectSlug: input.projectSlug,
    projectId: project.id,
    fromStage: input.fromStage,
    currentGeneration,
    proposedGeneration: currentGeneration + 1,
    preservedStages: closure.preservedStages,
    regeneratedStages: closure.regeneratedStages,
    invalidatedStages: closure.invalidatedStages,
    effectiveSequence: closure.effectiveSequence,
    projectAggregateFingerprint: treeAggregate(input.projectSlug, files),
    fileFingerprints: files,
    manifestFingerprint: requiredFileHash(files, "manifest.json"),
    jobsFingerprint: optionalFileHash(files, "pipeline-jobs.json"),
    historyFingerprint: optionalFileHash(files, "pipeline-history.json"),
    artifactRegistryFingerprint: requiredFileHash(files, "assets/assets.json"),
    audioPreservationFingerprint: buildAudioPreservationFingerprint(projectFolder, audioFiles),
    audioFiles,
    runtimeAuthorityId: input.runtimeAuthorityId,
    runtimeStorageIdentity: sha256(canonicalRegenerationJson({
      policyVersion: input.context.policyVersion,
      classification: input.context.classification,
      runtimeRoot: path.resolve(input.context.runtimeRoot).toLowerCase(),
      projectsRoot: path.resolve(input.context.projectsRoot).toLowerCase(),
    })),
    acceptanceMarkerFingerprint: marker.sha256,
    providerProfileFingerprint: sha256(canonicalRegenerationJson({
      configurationFingerprint: marker.parsedMarker.configurationFingerprint,
      componentFingerprints: marker.parsedMarker.componentFingerprints,
    })),
    durableQuiescent: true as const,
  };
  return Object.freeze({
    ...common,
    planFingerprint: sha256(canonicalRegenerationJson(common)),
  });
}

async function validateNoExternalPublication(
  projectSlug: string,
  projectId: string,
  context: RuntimeStorageContext,
) {
  const [primary, recovery] = await Promise.all([
    ProjectReader.readJSONState<unknown>(projectSlug, "youtube-publish.json", context),
    ProjectReader.readJSONState<unknown>(projectSlug, "youtube-publish-recovery.json", context),
  ]);
  if (primary.status === "malformed" || recovery.status === "malformed") {
    throw new ProductionRegenerationPlanError("PRODUCTION_REGENERATION_EXTERNAL_SIDE_EFFECT");
  }
  try {
    if (primary.status === "parsed") {
      validateYouTubePublishRecord(primary.value, { projectId, slug: projectSlug });
    }
    if (recovery.status === "parsed") {
      validateYouTubePublishRecord(recovery.value, { projectId, slug: projectSlug });
      if ((recovery.value as { status?: unknown }).status !== "published") throw new Error("invalid");
    }
  } catch {
    throw new ProductionRegenerationPlanError("PRODUCTION_REGENERATION_EXTERNAL_SIDE_EFFECT");
  }
  if (primary.status === "parsed" && recovery.status === "parsed" &&
    canonicalRegenerationJson(primary.value) !== canonicalRegenerationJson(recovery.value)) {
    throw new ProductionRegenerationPlanError("PRODUCTION_REGENERATION_EXTERNAL_SIDE_EFFECT");
  }
  if (primary.status === "parsed" || recovery.status === "parsed") {
    throw new ProductionRegenerationPlanError("PRODUCTION_REGENERATION_EXTERNAL_SIDE_EFFECT");
  }
}

function fingerprintTree(root: string): ProductionRegenerationFileFingerprint[] {
  const result: ProductionRegenerationFileFingerprint[] = [];
  const visit = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(directory, entry.name);
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) throw new ProductionRegenerationPlanError("PRODUCTION_REGENERATION_PROJECT_INVALID");
      if (entry.isDirectory()) {
        if (!entry.name.startsWith(".pipeline-jobs.")) visit(absolute);
      } else if (entry.isFile()) {
        if (entry.name.startsWith(".pipeline-jobs.")) continue;
        const bytes = fs.readFileSync(absolute);
        result.push(Object.freeze({
          relativePath: path.relative(root, absolute).replaceAll("\\", "/"),
          sizeBytes: bytes.length,
          sha256: sha256(bytes),
        }));
      }
    }
  };
  visit(root);
  return result.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function treeAggregate(projectSlug: string, files: readonly ProductionRegenerationFileFingerprint[]) {
  return aggregateRuntimeFileRecords(files.map((file) => ({
    ...file,
    relativePath: `${projectSlug}/${file.relativePath}`,
  })));
}

function requiredFileHash(files: readonly ProductionRegenerationFileFingerprint[], name: string) {
  const value = files.find((file) => file.relativePath === name)?.sha256;
  if (!value) throw new ProductionRegenerationPlanError("PRODUCTION_REGENERATION_PROJECT_INVALID");
  return value;
}

function optionalFileHash(files: readonly ProductionRegenerationFileFingerprint[], name: string) {
  return files.find((file) => file.relativePath === name)?.sha256 ?? sha256("missing");
}

async function stagePackageReady(
  projectSlug: string,
  stage: PipelineRecoveryStageKey,
  context: RuntimeStorageContext,
) {
  const data = await ProjectReader.readJSON<unknown>(
    projectSlug, `${stage}.json`, context);
  return stage === "video" ? isCompatibleVideoData(data) : data !== null;
}

function latestGeneration(projectSlug: string, context: RuntimeStorageContext) {
  return listRegenerationIds(projectSlug, context).reduce((maximum, id) =>
    Math.max(maximum, readRegenerationIntent(projectSlug, id, context)?.generationOrdinal ?? 0), 0);
}
