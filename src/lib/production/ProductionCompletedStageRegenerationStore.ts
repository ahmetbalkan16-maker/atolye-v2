import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { ProductionStepKey } from "@/types/project";
import type {
  ProductionRegenerationBinding,
  ProductionRegenerationIntent,
  ProductionRegenerationPreparedReceipt,
} from "@/types/productionRegeneration";
import type { ProductionRegenerationFileFingerprint } from "@/types/productionRegeneration";
import type { RuntimeStorageContext } from "@/lib/runtime/RuntimeStoragePaths";
import { regenerationDirectory, regenerationProjectFolder, regenerationRoot } from
  "./ProductionCompletedStageRegenerationPaths";
import { canonicalProductionSecurityValue } from "./ProductionDeterminism";
import { assertProductionRegenerationPhysicalProject } from "./ProductionRegenerationPhysicalGuard";
import {
  listRegenerationIds as listPipelineRegenerationIds,
  readRegenerationIntent as readPipelineRegenerationIntent,
  readRegenerationPreparedReceipt as readPipelineRegenerationPreparedReceipt,
  isRegenerationCompleted as isPipelineRegenerationCompleted,
} from "@/lib/pipeline/PipelineStageRegenerationStore";

export function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalRegenerationJson(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function buildAudioPreservationFingerprint(
  projectFolder: string,
  audioFiles: readonly ProductionRegenerationFileFingerprint[],
) {
  const audioBytes = fs.readFileSync(path.join(projectFolder, "audio.json"));
  const audioJsonValue = JSON.parse(audioBytes.toString("utf8")) as unknown;
  const manifest = readJson<{ packages?: Record<string, unknown> }>(path.join(projectFolder, "manifest.json"));
  const jobs = readJson<{ jobs?: Array<Record<string, unknown>> }>(path.join(projectFolder,
    "pipeline-jobs.json"));
  const registry = readJson<unknown>(path.join(projectFolder, "assets", "assets.json"));
  const audioAssetIds = collectAssetIds(audioJsonValue);
  const registryBindings = collectRegistryBindings(registry, new Set(audioAssetIds));
  return sha256(canonicalProductionSecurityValue({
    audioJson: { relativePath: "audio.json", sizeBytes: audioBytes.length, sha256: sha256(audioBytes) },
    audioFiles,
    audioManifest: manifest?.packages?.audio,
    audioJob: jobs?.jobs?.find((job) => job.stage === "audio"),
    audioAssetIds,
    registryBindings,
  }));
}

export function readRegenerationIntent(
  projectSlug: string,
  regenerationId: string,
  context?: RuntimeStorageContext,
): ProductionRegenerationIntent | null {
  return readJson(path.join(regenerationDirectory(projectSlug, regenerationId, context), "intent.json"));
}

export function readRegenerationPreparedReceipt(
  projectSlug: string,
  regenerationId: string,
  context?: RuntimeStorageContext,
): ProductionRegenerationPreparedReceipt | null {
  return readJson(path.join(regenerationDirectory(projectSlug, regenerationId, context), "prepared.json"));
}

export function isRegenerationCompleted(
  projectSlug: string,
  regenerationId: string,
  context?: RuntimeStorageContext,
) {
  return fs.existsSync(path.join(
    regenerationDirectory(projectSlug, regenerationId, context), "completed.json"));
}

export function listRegenerationIds(projectSlug: string, context?: RuntimeStorageContext) {
  const root = path.join(regenerationRoot(projectSlug, context), "regenerations");
  if (!fs.existsSync(root)) return [] as string[];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^regen-[a-f0-9]{48}$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

export function readActiveRegenerationBinding(
  projectSlug: string,
  stage?: ProductionStepKey,
  context?: RuntimeStorageContext,
): ProductionRegenerationBinding | null {
  const prepared = listRegenerationIds(projectSlug, context)
    .map((id) => ({
      intent: readRegenerationIntent(projectSlug, id, context),
      prepared: readRegenerationPreparedReceipt(projectSlug, id, context),
    }))
    .filter((item) => item.intent && item.prepared &&
      !isRegenerationCompleted(projectSlug, item.intent.regenerationId, context))
    .sort((left, right) =>
      (right.intent?.generationOrdinal ?? 0) - (left.intent?.generationOrdinal ?? 0));
  const selected = prepared.find((item) =>
    !stage || item.intent?.affectedStages.includes(stage));
  if (!selected?.intent) return null;
  const { regenerationId, generationOrdinal, planFingerprint, fromStage, reasonCode } = selected.intent;
  return Object.freeze({ regenerationId, generationOrdinal, planFingerprint, fromStage, reasonCode });
}

interface RegenerationExecutionBindingItem {
  readonly binding: ProductionRegenerationBinding;
  readonly firstGlobalExecutionOrdinal: number;
}

/**
 * Every regeneration binding registered for `stage`, across both the
 * production and pipeline regeneration namespaces, sorted ascending by
 * `firstGlobalExecutionOrdinal` — UNFILTERED by generation ordinal.
 *
 * Unlike `listRegenerationExecutionBindings` (which reduces this same set to
 * only the *current maximum* generation, and is therefore only sound for
 * resolving what governs a *new, current* execution), this candidate list is
 * for historical identity resolution: a record created under an older
 * generation must remain resolvable via its own generation's candidate even
 * after a newer generation is registered later. See
 * `ProductionDurableAttemptLineageClassifier.ts`'s `resolveHistoricalRecordIdentity`.
 */
export function listRegenerationExecutionBindingCandidates(
  projectSlug: string,
  stage: ProductionStepKey,
  context?: RuntimeStorageContext,
): RegenerationExecutionBindingItem[] {
  return collectRegenerationExecutionBindingItems(projectSlug, stage, context)
    .sort((left, right) => left.firstGlobalExecutionOrdinal - right.firstGlobalExecutionOrdinal);
}

function collectRegenerationExecutionBindingItems(
  projectSlug: string,
  stage: ProductionStepKey,
  context?: RuntimeStorageContext,
): RegenerationExecutionBindingItem[] {
  const prodItems = listRegenerationIds(projectSlug, context).flatMap((id) => {
    const intent = readRegenerationIntent(projectSlug, id, context);
    if (!intent || !intent.affectedStages.includes(stage)) return [];
    const jobsMutation = intent.mutations.find((mutation) =>
      mutation.relativePath === "pipeline-jobs.json");
    if (!jobsMutation) return [];
    try {
      const jobs = JSON.parse(Buffer.from(jobsMutation.postBase64, "base64").toString("utf8")) as {
        jobs?: Array<{ stage?: string; attempts?: number }>;
      };
      const ordinal = jobs.jobs?.find((job) => job.stage === stage)?.attempts;
      if (!Number.isSafeInteger(ordinal) || (ordinal as number) < 0) return [];
      const binding: ProductionRegenerationBinding = {
        regenerationId: intent.regenerationId,
        generationOrdinal: intent.generationOrdinal,
        planFingerprint: intent.planFingerprint,
        fromStage: intent.fromStage,
        reasonCode: intent.reasonCode,
      };
      return [{ binding: Object.freeze(binding), firstGlobalExecutionOrdinal: ordinal as number }];
    } catch { return []; }
  });
  const pipeItems = listPipelineRegenerationIds(projectSlug, context).flatMap((id) => {
    const intent = readPipelineRegenerationIntent(projectSlug, id, context);
    if (!intent || !intent.affectedStages.includes(stage)) return [];
    const jobsMutation = intent.mutations.find((mutation) =>
      mutation.relativePath === "pipeline-jobs.json");
    if (!jobsMutation) return [];
    try {
      const jobs = JSON.parse(Buffer.from(jobsMutation.postBase64, "base64").toString("utf8")) as {
        jobs?: Array<{ stage?: string; attempts?: number }>;
      };
      const ordinal = jobs.jobs?.find((job) => job.stage === stage)?.attempts;
      if (!Number.isSafeInteger(ordinal) || (ordinal as number) < 0) return [];
      const binding: ProductionRegenerationBinding = {
        regenerationId: intent.regenerationId,
        generationOrdinal: intent.generationOrdinal,
        planFingerprint: intent.planFingerprint,
        fromStage: intent.fromStage,
        reasonCode: intent.reasonCode,
      };
      return [{ binding: Object.freeze(binding), firstGlobalExecutionOrdinal: ordinal as number }];
    } catch { return []; }
  });
  return [...prodItems, ...pipeItems];
}

export function listRegenerationExecutionBindings(
  projectSlug: string,
  stage: ProductionStepKey,
  context?: RuntimeStorageContext,
) {
  const allItems = collectRegenerationExecutionBindingItems(projectSlug, stage, context);
  if (allItems.length === 0) return [];
  const maxGen = Math.max(...allItems.map((item) => item.binding.generationOrdinal));
  return allItems
    .filter((item) => item.binding.generationOrdinal === maxGen)
    .sort((left, right) => left.firstGlobalExecutionOrdinal - right.firstGlobalExecutionOrdinal);
}

export function regenerationBindingForExecution(
  projectSlug: string,
  stage: ProductionStepKey,
  globalExecutionOrdinal: number,
  context?: RuntimeStorageContext,
) {
  return listRegenerationExecutionBindings(projectSlug, stage, context)
    .filter((item) => item.firstGlobalExecutionOrdinal <= globalExecutionOrdinal)
    .at(-1)?.binding;
}

/**
 * Resolves ONE specific regeneration's binding directly by its persisted
 * `regenerationId` — never by re-deriving from an execution ordinal against
 * the current regeneration roster. Use this whenever a job/record already
 * carries its own `regenerationId` (the historically-correct binding is a
 * fixed, already-decided fact at that point, not something that should be
 * re-discovered later). Checks both namespaces; returns `undefined` if the
 * id does not resolve in either, or its own `regenerationId` field does not
 * match (defensive, mirrors `readActiveRegenerationBinding`'s shape).
 */
export function regenerationBindingById(
  projectSlug: string,
  regenerationId: string,
  context?: RuntimeStorageContext,
): ProductionRegenerationBinding | undefined {
  const intent = readRegenerationIntent(projectSlug, regenerationId, context) ??
    readPipelineRegenerationIntent(projectSlug, regenerationId, context);
  if (!intent || intent.regenerationId !== regenerationId) return undefined;
  const { generationOrdinal, planFingerprint, fromStage, reasonCode } = intent;
  return Object.freeze({ regenerationId, generationOrdinal, planFingerprint, fromStage, reasonCode });
}

export function requireRegenerationExecutionAdmission(
  projectSlug: string,
  stage: ProductionStepKey,
  job?: { readonly generationOrdinal?: number; readonly regenerationId?: string } | null,
  context?: RuntimeStorageContext,
): ProductionRegenerationBinding | undefined {
  for (const id of listRegenerationIds(projectSlug, context)) {
    const intent = readRegenerationIntent(projectSlug, id, context);
    if (intent && !readRegenerationPreparedReceipt(projectSlug, id, context)) {
      throw new Error("PRODUCTION_REGENERATION_PREPARING");
    }
  }
  for (const id of listPipelineRegenerationIds(projectSlug, context)) {
    const intent = readPipelineRegenerationIntent(projectSlug, id, context);
    if (intent && !readPipelineRegenerationPreparedReceipt(projectSlug, id, context)) {
      throw new Error("PRODUCTION_REGENERATION_PREPARING");
    }
  }
  const active = readActiveRegenerationBinding(projectSlug, undefined, context) ??
    readActivePipelineRegenerationBinding(projectSlug, undefined, context) ??
    undefined;
  if (active) {
    const intent = readRegenerationIntent(projectSlug, active.regenerationId, context) ??
      readPipelineRegenerationIntent(projectSlug, active.regenerationId, context);
    if (!intent?.affectedStages.includes(stage)) {
      throw new Error("PRODUCTION_REGENERATION_STAGE_OUTSIDE_ACTIVE_SCOPE");
    }
  }
  const binding = readActiveRegenerationBinding(projectSlug, stage, context) ??
    readActivePipelineRegenerationBinding(projectSlug, stage, context) ??
    undefined;
  if (!binding) return undefined;
  if (job?.generationOrdinal !== binding.generationOrdinal ||
    job.regenerationId !== binding.regenerationId) {
    throw new Error("PRODUCTION_REGENERATION_JOB_BINDING_INVALID");
  }
  if ((stage === "video" || stage === "assembly") &&
    !validatePreservedAudio(projectSlug, binding.regenerationId, context)) {
    throw new Error("PRODUCTION_REGENERATION_AUDIO_BINDING_INVALID");
  }
  return binding;
}

function readActivePipelineRegenerationBinding(
  projectSlug: string,
  stage?: ProductionStepKey,
  context?: RuntimeStorageContext,
): ProductionRegenerationBinding | null {
  for (const id of listPipelineRegenerationIds(projectSlug, context)) {
    const intent = readPipelineRegenerationIntent(projectSlug, id, context);
    const prepared = readPipelineRegenerationPreparedReceipt(projectSlug, id, context);
    const completed = isPipelineRegenerationCompleted(projectSlug, id, context);
    if (intent && prepared && !completed) {
      if (!stage || intent.affectedStages.includes(stage)) {
        return Object.freeze({
          regenerationId: intent.regenerationId,
          generationOrdinal: intent.generationOrdinal,
          planFingerprint: intent.planFingerprint,
          fromStage: intent.fromStage,
          reasonCode: intent.reasonCode,
        });
      }
    }
  }
  return null;
}

export function readCanonicalPackageBinding(
  projectSlug: string,
  stage: ProductionStepKey,
  context?: RuntimeStorageContext,
) {
  const active = readActiveRegenerationBinding(projectSlug, stage, context);
  if (!active) return null;
  const file = path.join(
    regenerationDirectory(projectSlug, active.regenerationId, context),
    "package-bindings",
    `${stage}.json`,
  );
  return readJson<{
    regenerationId: string;
    generationOrdinal: number;
    stage: ProductionStepKey;
    packageSha256: string;
  }>(file);
}

export function isRegenerationPackageCanonical(
  projectSlug: string,
  stage: ProductionStepKey,
  packagePath: string,
  context?: RuntimeStorageContext,
) {
  const active = readActiveRegenerationBinding(projectSlug, stage, context);
  if (!active) return true;
  const binding = readCanonicalPackageBinding(projectSlug, stage, context);
  if (!binding || binding.regenerationId !== active.regenerationId ||
    binding.generationOrdinal !== active.generationOrdinal || binding.stage !== stage) return false;
  try { return sha256(fs.readFileSync(packagePath)) === binding.packageSha256; } catch { return false; }
}

export function recordRegeneratedPackageCompletion(
  projectSlug: string,
  stage: ProductionStepKey,
  packagePath: string,
  context?: RuntimeStorageContext,
) {
  const active = readActiveRegenerationBinding(projectSlug, stage, context);
  if (!active) return;
  if (!context) throw new Error("RUNTIME_STORAGE_CONTEXT_REQUIRED");
  assertProductionRegenerationPhysicalProject(projectSlug, context, packagePath);
  const bytes = fs.readFileSync(packagePath);
  const packageSha256 = sha256(bytes);
  const directory = regenerationDirectory(projectSlug, active.regenerationId, context);
  const parsed = JSON.parse(bytes.toString("utf8")) as unknown;
  const assetIds = stage === "video" || stage === "assembly"
    ? collectRegenerationStageOutputAssetIds(stage, parsed)
    : collectAssetIds(parsed);
  const intent = readRegenerationIntent(projectSlug, active.regenerationId, context);
  if (!intent) throw new Error("PRODUCTION_REGENERATION_JOURNAL_INVALID");
  const completedAt = intent.createdAt;
  const binding = Object.freeze({
    schemaVersion: "production-regeneration-v1",
    regenerationId: active.regenerationId,
    generationOrdinal: active.generationOrdinal,
    planFingerprint: active.planFingerprint,
    stage,
    packageSha256,
    assetIds,
    completedAt,
  });
  const intended = stage === "video" || stage === "assembly"
    ? validateSupersessionIntent(projectSlug, stage, active, context, false)
    : null;
  writeJsonOnce(path.join(directory, "package-bindings", `${stage}.json`), binding);
  writeJsonOnce(path.join(directory, "stage-receipts", `${stage}.json`), {
    ...binding,
    state: "completed",
    fingerprint: sha256(canonicalRegenerationJson(binding)),
  });
  if (intended) {
    writeJsonOnce(path.join(directory, "supersession", `${stage}-completed.json`), {
      ...intended,
      state: "completed",
      newPackageSha256: packageSha256,
      newAssetIds: assetIds,
      completedAt,
    });
  }
  if (stage === "export") {
    if (intent && intent.affectedStages.every((affected) =>
      readCanonicalPackageBinding(projectSlug, affected, context) !== null)) {
      writeJsonOnce(path.join(directory, "completed.json"), {
        schemaVersion: "production-regeneration-v1",
        regenerationId: active.regenerationId,
        generationOrdinal: active.generationOrdinal,
        completedAt,
        state: "completed",
      });
    }
  }
}

interface RegenerationPredecessorAssetEvidence {
  readonly assetId: string;
  readonly registryBindingSha256: string;
  readonly relativePath: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

interface RegenerationSupersessionIntent {
  readonly schemaVersion: string;
  readonly regenerationId: string;
  readonly projectSlug: string;
  readonly projectId: string;
  readonly generationOrdinal: number;
  readonly previousGenerationOrdinal: number;
  readonly stage: ProductionStepKey;
  readonly state: string;
  readonly previousPackageSha256: string;
  readonly previousAssetIds: string[];
  readonly previousAssets: RegenerationPredecessorAssetEvidence[];
}

export function validateRegeneratedPackageCompletionPrecommit(
  projectSlug: string,
  stage: Extract<ProductionStepKey, "video" | "assembly">,
  context?: RuntimeStorageContext,
) {
  const active = readActiveRegenerationBinding(projectSlug, stage, context);
  if (!active) return;
  validateSupersessionIntent(projectSlug, stage, active, context, true);
}

function validateSupersessionIntent(
  projectSlug: string,
  stage: Extract<ProductionStepKey, "video" | "assembly">,
  active: ProductionRegenerationBinding,
  context: RuntimeStorageContext | undefined,
  requireCurrentPredecessor: boolean,
): RegenerationSupersessionIntent {
  const projectFolder = regenerationProjectFolder(projectSlug, context);
  const directory = regenerationDirectory(projectSlug, active.regenerationId, context);
  let intended: RegenerationSupersessionIntent | null;
  let snapshot: unknown;
  let snapshotBytes: Buffer;
  let project: { id?: unknown; slug?: unknown };
  let registry: unknown;
  try {
    intended = readJson<RegenerationSupersessionIntent>(
      path.join(directory, "supersession", `${stage}-intended.json`));
    if (!intended) throw new Error("missing");
    const snapshotPath = path.join(directory, "snapshots",
      `generation-${intended.previousGenerationOrdinal}`, `${stage}.json`);
    snapshotBytes = fs.readFileSync(snapshotPath);
    snapshot = JSON.parse(snapshotBytes.toString("utf8")) as unknown;
    project = JSON.parse(fs.readFileSync(path.join(projectFolder, "project.json"), "utf8"));
    registry = JSON.parse(fs.readFileSync(
      path.join(projectFolder, "assets", "assets.json"), "utf8")) as unknown;
  } catch {
    throw new Error("PRODUCTION_REGENERATION_SUPERSESSION_INVALID");
  }
  const snapshotAssetIds = collectRegenerationStageOutputAssetIds(stage, snapshot);
  let currentEvidence: RegenerationPredecessorAssetEvidence[];
  try {
    currentEvidence = collectRegenerationPredecessorAssetEvidence(
      projectFolder, projectSlug, registry, intended.previousAssetIds);
  } catch {
    throw new Error("PRODUCTION_REGENERATION_SUPERSESSION_INVALID");
  }
  if (intended.schemaVersion !== "production-regeneration-v1" ||
    intended.regenerationId !== active.regenerationId ||
    intended.projectSlug !== projectSlug || intended.projectId !== project.id ||
    project.slug !== projectSlug ||
    intended.generationOrdinal !== active.generationOrdinal ||
    intended.previousGenerationOrdinal !== active.generationOrdinal - 1 ||
    intended.stage !== stage || intended.state !== "intended" ||
    sha256(snapshotBytes) !== intended.previousPackageSha256 ||
    canonicalRegenerationJson(snapshotAssetIds) !== canonicalRegenerationJson(intended.previousAssetIds) ||
    canonicalRegenerationJson(currentEvidence) !== canonicalRegenerationJson(intended.previousAssets)) {
    throw new Error("PRODUCTION_REGENERATION_SUPERSESSION_INVALID");
  }
  if (requireCurrentPredecessor) {
    let currentBytes: Buffer;
    try { currentBytes = fs.readFileSync(path.join(projectFolder, `${stage}.json`)); } catch {
      throw new Error("PRODUCTION_REGENERATION_SUPERSESSION_INVALID");
    }
    let currentAssetIds: string[];
    try {
      currentAssetIds = collectRegenerationStageOutputAssetIds(
        stage, JSON.parse(currentBytes.toString("utf8")) as unknown);
    } catch { throw new Error("PRODUCTION_REGENERATION_SUPERSESSION_INVALID"); }
    if (sha256(currentBytes) !== intended.previousPackageSha256 ||
      canonicalRegenerationJson(currentAssetIds) !== canonicalRegenerationJson(intended.previousAssetIds)) {
      throw new Error("PRODUCTION_REGENERATION_SUPERSESSION_INVALID");
    }
  }
  return intended;
}

export function collectRegenerationPredecessorAssetEvidence(
  projectFolder: string,
  projectSlug: string,
  registry: unknown,
  assetIds: readonly string[],
): RegenerationPredecessorAssetEvidence[] {
  if (!registry || typeof registry !== "object" || Array.isArray(registry) ||
    !Array.isArray((registry as { assets?: unknown }).assets)) throw new Error("invalid registry");
  const assets = (registry as { assets: Array<Record<string, unknown>> }).assets;
  return [...assetIds].sort().map((assetId) => {
    const matches = assets.filter((asset) => asset?.id === assetId);
    if (matches.length !== 1 || typeof matches[0].filePath !== "string") {
      throw new Error("missing predecessor asset");
    }
    const logical = matches[0].filePath.replaceAll("\\", "/");
    const prefix = `data/projects/${projectSlug}/`;
    if (!logical.startsWith(prefix)) throw new Error("foreign predecessor asset");
    const relativePath = logical.slice(prefix.length);
    const target = path.resolve(projectFolder, ...relativePath.split("/"));
    const relative = path.relative(projectFolder, target);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("unsafe predecessor asset");
    }
    const bytes = fs.readFileSync(target);
    return Object.freeze({ assetId,
      registryBindingSha256: sha256(canonicalProductionSecurityValue(matches[0])),
      relativePath, sizeBytes: bytes.length, sha256: sha256(bytes) });
  });
}

export function collectRegenerationStageOutputAssetIds(
  stage: Extract<ProductionStepKey, "video" | "assembly">,
  value: unknown,
) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [] as string[];
  const record = value as Record<string, unknown>;
  const result = new Set<string>();
  if (stage === "video") {
    if (typeof record.outputAssetId === "string" && record.outputAssetId.length > 0) {
      result.add(record.outputAssetId);
    }
    if (Array.isArray(record.scenes)) {
      for (const scene of record.scenes) {
        if (!scene || typeof scene !== "object" || Array.isArray(scene)) continue;
        const item = scene as Record<string, unknown>;
        for (const key of ["outputAssetId", "videoAssetId"] as const) {
          if (typeof item[key] === "string" && item[key].length > 0) result.add(item[key]);
        }
      }
    }
  } else if (typeof record.outputAssetId === "string" && record.outputAssetId.length > 0) {
    result.add(record.outputAssetId);
  }
  return [...result].sort();
}

export function writeOnce(filePath: string, bytes: string | Buffer) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  try {
    fs.writeFileSync(filePath, bytes, { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existing = fs.readFileSync(filePath);
    const expected = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    if (!existing.equals(expected)) throw new Error("PRODUCTION_REGENERATION_IMMUTABLE_CONFLICT");
  }
}

export function writeJsonOnce(filePath: string, value: unknown) {
  writeOnce(filePath, canonicalRegenerationJson(value));
}

function readJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error("PRODUCTION_REGENERATION_JOURNAL_INVALID");
  }
}

function collectAssetIds(value: unknown) {
  const result = new Set<string>();
  const visit = (input: unknown, key = "") => {
    if (typeof input === "string" && /assetids?$/i.test(key) && input.length > 0) result.add(input);
    else if (Array.isArray(input)) input.forEach((item) => visit(item, key));
    else if (input && typeof input === "object") {
      Object.entries(input as Record<string, unknown>).forEach(([childKey, child]) =>
        visit(child, childKey));
    }
  };
  visit(value);
  return [...result].sort();
}

function validatePreservedAudio(
  projectSlug: string,
  regenerationId: string,
  context?: RuntimeStorageContext,
) {
  if (regenerationId.startsWith("pipeline-regen-")) return true;
  const intent = readRegenerationIntent(projectSlug, regenerationId, context);
  if (!intent || !Array.isArray(intent.audioFiles) || intent.audioFiles.length !== 7) return false;
  const projectFolder = regenerationProjectFolder(projectSlug, context);
  try {
    const audioFiles = intent.audioFiles.map((expected) => {
      const target = path.resolve(projectFolder, ...expected.relativePath.split("/"));
      const relative = path.relative(projectFolder, target);
      if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("unsafe");
      const bytes = fs.readFileSync(target);
      return { relativePath: expected.relativePath, sizeBytes: bytes.length, sha256: sha256(bytes) };
    });
    return buildAudioPreservationFingerprint(projectFolder, audioFiles) ===
      intent.audioPreservationFingerprint;
  } catch { return false; }
}

function collectRegistryBindings(value: unknown, assetIds: ReadonlySet<string>) {
  const matches: unknown[] = [];
  const visit = (input: unknown) => {
    if (Array.isArray(input)) { input.forEach(visit); return; }
    if (!input || typeof input !== "object") return;
    const record = input as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id :
      typeof record.assetId === "string" ? record.assetId : undefined;
    if (id && assetIds.has(id)) matches.push(record);
    else Object.values(record).forEach(visit);
  };
  visit(value);
  return matches.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}
