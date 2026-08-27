import fs from "node:fs";
import path from "node:path";
import { ProjectReader } from "@/lib/projects/ProjectReader";
import { PipelineJobManager } from "@/lib/pipeline/PipelineJobManager";
import { isCompatibleVideoData } from "@/lib/video/VideoDataValidation";
import { validateYouTubePublishRecord } from "@/lib/youtube/publish/YouTubePublishValidation";
import { ProductionExecutionFilePersistenceAdapter } from
  "@/lib/production/ProductionExecutionPersistence";
import { validateProductionGlobalTerminalQuiescence } from
  "@/lib/production/ProductionGlobalTerminalQuiescence";
import { assertProductionRegenerationPhysicalProject } from
  "@/lib/production/ProductionRegenerationPhysicalGuard";
import { getProductionRegenerationClosure } from
  "@/lib/production/ProductionCompletedStageRegenerationGraph";
import { collectRuntimeBackupInventory } from "@/lib/runtime/backup/RuntimeBackupInventory";
import type { RuntimeStorageContext } from "@/lib/runtime/RuntimeStoragePaths";
import type { PipelineRecoveryStageKey } from "@/types/pipelineRecovery";
import type { Project, ProjectManifest } from "@/types/project";
import type { AudioData } from "@/types/audio";
import {
  pipelineRegenerationSchemaVersion,
  supportedPipelineRegenerationFromStages,
  type PipelineRegenerationFileFingerprint,
  type PipelineRegenerationPlan,
} from "@/types/pipelineRegeneration";
import {
  canonicalRegenerationJson,
  listRegenerationIds,
  readRegenerationIntent,
  readRegenerationPreparedReceipt,
  isRegenerationCompleted,
  sha256,
} from "./PipelineStageRegenerationStore";

/**
 * Plan phase for the plain-pipeline (marker-less) completed-stage regeneration path —
 * the sibling of `ProductionCompletedStageRegenerationPlanner.createCompletedStageRegenerationPlan`
 * for projects that were created through the ordinary pipeline and can never legitimately
 * carry a `production-acceptance.json` marker (see `src/types/pipelineRegeneration.ts`
 * for why this is a separate lineage rather than a marker-optional branch of the
 * acceptance-side planner).
 *
 * Read-only: computes and returns a plan, touches no project state. `fromStage` is
 * restricted to `supportedPipelineRegenerationFromStages` ("assembly", "animation") —
 * see that constant's docstring for why each entry is there and what re-verification
 * a new one requires.
 */

export type PipelineRegenerationPlanErrorCode =
  | "PIPELINE_REGENERATION_STAGE_INVALID"
  | "PIPELINE_REGENERATION_PROJECT_INVALID"
  | "PIPELINE_REGENERATION_ACCEPTANCE_MANAGED"
  | "PIPELINE_REGENERATION_SOURCE_NOT_COMPLETED"
  | "PIPELINE_REGENERATION_DEPENDENCY_INVALID"
  | "PIPELINE_REGENERATION_AUDIO_INVALID"
  | "PIPELINE_REGENERATION_NOT_QUIESCENT"
  | "PIPELINE_REGENERATION_EXTERNAL_SIDE_EFFECT"
  | "PIPELINE_REGENERATION_CONFLICT";

export class PipelineRegenerationPlanError extends Error {
  constructor(readonly code: PipelineRegenerationPlanErrorCode) {
    super(code);
    this.name = "PipelineRegenerationPlanError";
    this.stack = undefined;
  }
}

export async function createPipelineCompletedStageRegenerationPlan(input: {
  readonly projectSlug: string;
  readonly fromStage: PipelineRecoveryStageKey;
  readonly context: RuntimeStorageContext;
}): Promise<PipelineRegenerationPlan> {
  if (!supportedPipelineRegenerationFromStages.includes(
    input.fromStage as typeof supportedPipelineRegenerationFromStages[number])) {
    throw new PipelineRegenerationPlanError("PIPELINE_REGENERATION_STAGE_INVALID");
  }
  const projectFolder = ProjectReader.getProjectFolder(input.projectSlug, input.context);
  assertProductionRegenerationPhysicalProject(input.projectSlug, input.context, projectFolder);

  // Mutual exclusivity: a project with a production-acceptance marker is owned by the
  // acceptance-gated regeneration system (`ProductionCompletedStageRegenerationPlanner`),
  // never by this one. This check exists purely to keep the two lineages from ever both
  // touching the same project — it does not create, read the contents of, or depend on
  // the marker being valid.
  if (fs.existsSync(path.join(projectFolder, "production-acceptance.json"))) {
    throw new PipelineRegenerationPlanError("PIPELINE_REGENERATION_ACCEPTANCE_MANAGED");
  }

  const [project, manifest, jobs] = await Promise.all([
    ProjectReader.readJSON<Project>(input.projectSlug, "project.json", input.context),
    ProjectReader.readJSON<ProjectManifest>(input.projectSlug, "manifest.json", input.context),
    PipelineJobManager.listJobsReadOnly(input.projectSlug, input.context),
  ]);
  if (!project || !manifest || project.slug !== input.projectSlug || manifest.slug !== input.projectSlug ||
    manifest.projectId !== project.id || manifest.project.id !== project.id) {
    throw new PipelineRegenerationPlanError("PIPELINE_REGENERATION_PROJECT_INVALID");
  }
  if (manifest.packages[input.fromStage].status !== "completed" ||
    !await stagePackageReady(input.projectSlug, input.fromStage, input.context)) {
    throw new PipelineRegenerationPlanError("PIPELINE_REGENERATION_SOURCE_NOT_COMPLETED");
  }

  const active = listRegenerationIds(input.projectSlug, input.context).some((id) =>
    readRegenerationIntent(input.projectSlug, id, input.context) !== null &&
    readRegenerationPreparedReceipt(input.projectSlug, id, input.context) !== null &&
    !isRegenerationCompleted(input.projectSlug, id, input.context));
  if (active) throw new PipelineRegenerationPlanError("PIPELINE_REGENERATION_CONFLICT");

  const closure = getProductionRegenerationClosure(input.fromStage);
  for (const stage of [...closure.preservedStages, input.fromStage]) {
    const matchingJobs = jobs.jobs.filter((job) => job.stage === stage);
    if (matchingJobs.length !== 1 || matchingJobs[0].status !== "completed") {
      throw new PipelineRegenerationPlanError("PIPELINE_REGENERATION_DEPENDENCY_INVALID");
    }
  }
  for (const stage of closure.preservedStages) {
    if (manifest.packages[stage].status !== "completed" ||
      !await stagePackageReady(input.projectSlug, stage, input.context)) {
      throw new PipelineRegenerationPlanError("PIPELINE_REGENERATION_DEPENDENCY_INVALID");
    }
  }

  const durable = new ProductionExecutionFilePersistenceAdapter({
    trustedRootDirectory: path.join(projectFolder, "production-execution"),
    createRootDirectory: false,
  });
  // Passing input.context (this planner's own RuntimeStorageInput) as the 4th arg
  // narrowly permits reservations with an existing, CAS-pinned
  // ProductionOrphanReservationToleranceAuthority (see that file's docstring and
  // ProductionGlobalTerminalQuiescence.ts's toleranceRuntimeInput docstring) to count
  // as consumed -- resolved through this exact context, never an ambient default.
  // Creates nothing; a reservation with no matching authority is refused exactly as
  // before.
  if (!await validateProductionGlobalTerminalQuiescence(
    durable, input.projectSlug, undefined, input.context)) {
    throw new PipelineRegenerationPlanError("PIPELINE_REGENERATION_NOT_QUIESCENT");
  }
  await validateNoExternalPublication(input.projectSlug, project.id, input.context);

  const audio = await ProjectReader.readJSON<AudioData>(input.projectSlug, "audio.json", input.context);
  if (!audio || !Array.isArray(audio.sections) || audio.sections.length < 1) {
    throw new PipelineRegenerationPlanError("PIPELINE_REGENERATION_AUDIO_INVALID");
  }
  const expectedAudioFileCount = audio.sections.length + 1; // per-chapter narration + one mix
  const files = fingerprintTree(projectFolder);
  const audioFiles = files.filter((file) =>
    file.relativePath.startsWith("assets/audio/") &&
    !file.relativePath.startsWith("assets/audio/.") &&
    !file.relativePath.includes("/.") &&
    file.relativePath.toLowerCase().endsWith(".wav"));
  if (audioFiles.length !== expectedAudioFileCount) {
    throw new PipelineRegenerationPlanError("PIPELINE_REGENERATION_AUDIO_INVALID");
  }

  const currentGeneration = latestGeneration(input.projectSlug, input.context);
  const common = {
    schemaVersion: pipelineRegenerationSchemaVersion,
    projectSlug: input.projectSlug,
    projectId: project.id,
    fromStage: input.fromStage,
    currentGeneration,
    proposedGeneration: currentGeneration + 1,
    preservedStages: closure.preservedStages,
    regeneratedStages: closure.regeneratedStages,
    invalidatedStages: closure.invalidatedStages,
    effectiveSequence: closure.effectiveSequence,
    projectAggregateFingerprint: collectRuntimeBackupInventory({
      context: input.context,
      projectSlug: input.projectSlug,
      repositoryRoot: input.context.workspaceRoot,
    }).aggregateFingerprint,
    manifestFingerprint: requiredFileHash(files, "manifest.json"),
    jobsFingerprint: optionalFileHash(files, "pipeline-jobs.json"),
    artifactRegistryFingerprint: requiredFileHash(files, "assets/assets.json"),
    audioFingerprint: requiredFileHash(files, "audio.json"),
    runtimeStorageIdentity: sha256(canonicalRegenerationJson({
      policyVersion: input.context.policyVersion,
      classification: input.context.classification,
      runtimeRoot: path.resolve(input.context.runtimeRoot).toLowerCase(),
      projectsRoot: path.resolve(input.context.projectsRoot).toLowerCase(),
    })),
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
    throw new PipelineRegenerationPlanError("PIPELINE_REGENERATION_EXTERNAL_SIDE_EFFECT");
  }
  try {
    if (primary.status === "parsed") {
      validateYouTubePublishRecord(primary.value, { projectId, slug: projectSlug });
    }
    if (recovery.status === "parsed") {
      validateYouTubePublishRecord(recovery.value, { projectId, slug: projectSlug });
    }
  } catch {
    throw new PipelineRegenerationPlanError("PIPELINE_REGENERATION_EXTERNAL_SIDE_EFFECT");
  }
  if (primary.status === "parsed" || recovery.status === "parsed") {
    throw new PipelineRegenerationPlanError("PIPELINE_REGENERATION_EXTERNAL_SIDE_EFFECT");
  }
}

function fingerprintTree(root: string): PipelineRegenerationFileFingerprint[] {
  const result: PipelineRegenerationFileFingerprint[] = [];
  const visit = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(directory, entry.name);
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) throw new PipelineRegenerationPlanError("PIPELINE_REGENERATION_PROJECT_INVALID");
      if (entry.isDirectory()) {
        if (!entry.name.startsWith(".pipeline-jobs.")) visit(absolute);
      } else if (entry.isFile()) {
        if (entry.name.startsWith(".pipeline-jobs.")) continue;
        const relativePath = path.relative(root, absolute).replaceAll("\\", "/");
        const bytes = fs.readFileSync(absolute);
        result.push(Object.freeze({
          relativePath,
          sizeBytes: bytes.length,
          sha256: sha256(bytes),
        }));
      }
    }
  };
  visit(root);
  return result.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function requiredFileHash(files: readonly PipelineRegenerationFileFingerprint[], name: string) {
  const value = files.find((file) => file.relativePath === name)?.sha256;
  if (!value) throw new PipelineRegenerationPlanError("PIPELINE_REGENERATION_PROJECT_INVALID");
  return value;
}

function optionalFileHash(files: readonly PipelineRegenerationFileFingerprint[], name: string) {
  return files.find((file) => file.relativePath === name)?.sha256 ?? sha256("missing");
}

async function stagePackageReady(
  projectSlug: string,
  stage: PipelineRecoveryStageKey,
  context: RuntimeStorageContext,
) {
  const data = await ProjectReader.readJSON<unknown>(projectSlug, `${stage}.json`, context);
  return stage === "video" ? isCompatibleVideoData(data) : data !== null;
}

function latestGeneration(projectSlug: string, context: RuntimeStorageContext) {
  return listRegenerationIds(projectSlug, context).reduce((maximum, id) =>
    Math.max(maximum, readRegenerationIntent(projectSlug, id, context)?.generationOrdinal ?? 0), 0);
}
