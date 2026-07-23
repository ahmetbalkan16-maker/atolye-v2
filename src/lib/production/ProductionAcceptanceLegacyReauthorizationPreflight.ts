import fs from "node:fs";
import path from "node:path";
import { ProjectReader } from "@/lib/projects/ProjectReader";
import {
  PipelineRecoveryPlanner,
  pipelineRecoveryStageOrder,
} from "@/lib/pipeline/PipelineRecoveryPlanner";
import { PipelineJobManager } from "@/lib/pipeline/PipelineJobManager";
import {
  createRuntimeStorageContext,
  type RuntimeStorageContext,
} from "@/lib/runtime/RuntimeStoragePaths";
import { getActiveProductionRuntimeOperationContext,
  requireProductionRuntimeStorageContext } from
  "@/lib/runtime/ProductionRuntimeOperationContext";
import {
  createProductionAcceptancePortableConfigurationSnapshotV2,
  type ProductionAcceptancePortableConfigurationSnapshotV2,
} from "./ProductionAcceptanceConfigurationFingerprint";
import {
  canonicalJson,
  deriveLegacyReauthorizationChallengeId,
  legacyReauthorizationReason,
  legacyReauthorizationSchemaVersion,
  ProductionAcceptanceLegacyReauthorizationError,
  safeSha256,
  sha256Bytes,
} from "./ProductionAcceptanceLegacyReauthorization";
import {
  normalizedFilesystemIdentity,
  readCanonicalProductionAcceptanceMarkerDescriptorBound,
} from "./ProductionAcceptanceMarkerDescriptorReader";
import { createLegacyReauthorizationDurableRecoverySnapshot } from
  "./ProductionAcceptanceLegacyDurableRecoverySnapshot";
import {
  normalizeProductionAcceptanceTopic,
  createProductionAcceptanceProjectSlug,
  productionAcceptanceTopicFingerprint,
} from "./ProductionAcceptanceTopic";
import { productionAcceptanceConfigurationFingerprint } from
  "./ProductionAcceptancePolicy";
import { getProductionAcceptanceLegacyAdmittedExecution } from
  "./ProductionAcceptanceLegacyAdmissionContext";

const MARKER_FILE = "production-acceptance.json";
const EXCLUDED_ROOT_ENTRIES = new Set([
  "production-acceptance-authority",
  "production-acceptance-reauthorization.json",
  "production-acceptance-validation.json",
  "legacy-reauthorization-publication-receipt.json",
  "project.json",
  "manifest.json",
  "pipeline-jobs.json",
  "pipeline-history.json",
  "ai-usage.json",
  "production-execution",
]);

export interface LegacyMarkerV2Value {
  readonly schemaVersion: "2";
  readonly runId: string;
  readonly topic: string;
  readonly topicFingerprint: string;
  readonly requestFingerprint: string;
  readonly strictProductionAcceptance: true;
  readonly publishMode: "package-only";
  readonly configurationFingerprint: string;
  readonly createdAt: string;
  readonly acceptanceStatus: "prepared";
  readonly productionReady: false;
  readonly published: false;
}

export interface ProductionAcceptanceLegacyReauthorizationSnapshot {
  readonly projectSlug: string;
  readonly context: RuntimeStorageContext;
  readonly projectFolder: string;
  readonly markerPath: string;
  readonly markerBytes: Buffer;
  readonly markerDeviceIdentity: string;
  readonly markerInodeIdentity: string;
  readonly marker: LegacyMarkerV2Value;
  readonly sourceMarkerSha256: string;
  readonly configuration: ProductionAcceptancePortableConfigurationSnapshotV2;
  readonly storageAuthorityFingerprint: string;
  readonly artifactInventoryFingerprint: string;
  readonly recoveryStateFingerprint: string;
  readonly recoverySnapshot: unknown;
  readonly reauthorizationId: string;
}

export interface LegacyReauthorizationPreflightDependencies {
  readonly environment?: NodeJS.ProcessEnv;
  readonly workspaceRoot?: string;
  readonly authorityRoot?: string;
}

export async function createLegacyReauthorizationPreflight(
  projectSlug: string,
  expectedMarkerSha256: string,
  dependencies: LegacyReauthorizationPreflightDependencies = {},
): Promise<ProductionAcceptanceLegacyReauthorizationSnapshot> {
  if (!safeSlug(projectSlug) || !safeSha256(expectedMarkerSha256)) {
    throw failure("PRODUCTION_ACCEPTANCE_REAUTHORIZATION_ARGUMENT_INVALID", projectSlug, "marker");
  }
  const environment = dependencies.environment ?? process.env;
  let context: RuntimeStorageContext;
  try {
    const active = getActiveProductionRuntimeOperationContext();
    context = active ? requireProductionRuntimeStorageContext(active) : createRuntimeStorageContext({
      environment, ...(dependencies.workspaceRoot ? { workspaceRoot: dependencies.workspaceRoot } : {}),
      ...(dependencies.authorityRoot ? { authorityRoot: dependencies.authorityRoot } : {}) });
  } catch {
    throw failure("PRODUCTION_ACCEPTANCE_REAUTHORIZATION_STORAGE_MISMATCH", projectSlug, "storage");
  }
  const runtimeRoot = realDirectory(context.runtimeRoot, projectSlug);
  const projectsRoot = realDirectory(context.projectsRoot, projectSlug);
  const projectFolder = realDirectory(ProjectReader.getProjectFolder(projectSlug, context), projectSlug);
  if (!inside(runtimeRoot, projectsRoot) || !inside(projectsRoot, projectFolder)) {
    throw failure("PRODUCTION_ACCEPTANCE_REAUTHORIZATION_STORAGE_MISMATCH", projectSlug, "storage");
  }
  const runtimeBefore = identityOfDirectory(runtimeRoot, projectSlug);
  const rootBefore = identityOfDirectory(projectsRoot, projectSlug);
  const projectBefore = identityOfDirectory(projectFolder, projectSlug);
  const markerPath = path.join(projectFolder, MARKER_FILE);
  let markerRead: ReturnType<typeof readCanonicalProductionAcceptanceMarkerDescriptorBound>;
  try {
    markerRead = readCanonicalProductionAcceptanceMarkerDescriptorBound({ projectFolder, markerPath });
  } catch {
    throw failure("PRODUCTION_ACCEPTANCE_REAUTHORIZATION_SOURCE_MARKER_INVALID", projectSlug, "marker");
  }
  const sourceMarkerSha256 = markerRead.sha256;
  if (sourceMarkerSha256 !== expectedMarkerSha256) {
    throw failure("PRODUCTION_ACCEPTANCE_REAUTHORIZATION_SOURCE_HASH_MISMATCH", projectSlug, "marker");
  }
  const marker = parseLegacyMarker(markerRead.parsedMarker, projectSlug);
  if (createProductionAcceptanceProjectSlug(marker.topic, marker.runId) !== projectSlug) {
    throw failure("PRODUCTION_ACCEPTANCE_REAUTHORIZATION_BINDING_MISMATCH", projectSlug, "marker");
  }
  if (marker.configurationFingerprint === productionAcceptanceConfigurationFingerprint(environment)) {
    throw failure("PRODUCTION_ACCEPTANCE_REAUTHORIZATION_NOT_LEGACY", projectSlug, "configuration");
  }

  const readBinary = (filePath: string) =>
    Promise.resolve(readExactFile(filePath, projectSlug, "configuration").bytes);
  const configuration = await createProductionAcceptancePortableConfigurationSnapshotV2(
    projectSlug,
    environment,
    readBinary,
  );
  if (configuration.unavailableComponents.length > 0) {
    throw failure(
      "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_CONFIGURATION_UNAVAILABLE",
      projectSlug,
      "configuration",
    );
  }
  const storageAuthorityFingerprint = sha256Bytes(canonicalJson({
    policyVersion: "production-acceptance-storage-authority-v1",
    authorityBindingVersion: "runtime-storage-context-exact-identity-v1",
    runtimePolicyVersion: context.policyVersion,
    contextKind: context.kind,
    contextSource: context.source,
    classification: context.classification,
    logicalProjectsRoot: context.logicalProjectsRoot,
    runtimeRoot: identityEvidence(runtimeBefore),
    projectsRoot: identityEvidence(rootBefore),
    projectRoot: identityEvidence(projectBefore),
    projectSlug,
    containmentContract: "projects-root-exact-child-v1",
  }));
  const artifactInventoryFingerprint = inventoryFingerprint(projectFolder, projectSlug);
  const recovery = await PipelineRecoveryPlanner.createResumePlan(projectSlug);
  const jobSnapshot = await PipelineJobManager.listJobsReadOnly(projectSlug);
  const jobs = excludeAdmittedJob(Array.isArray(jobSnapshot)
    ? jobSnapshot
    : (jobSnapshot as { jobs?: readonly unknown[] }).jobs ?? [], projectSlug);
  const normalizedRecovery = normalizeRecovery(recovery, jobs, projectSlug);
  const durableRecovery = await createLegacyReauthorizationDurableRecoverySnapshot({ projectFolder, projectSlug,
    runId: marker.runId, evaluatedAt: marker.createdAt, markerState: marker.acceptanceStatus,
    startStage: normalizedRecovery.startStage });
  const recoveryCanonical = { ...normalizedRecovery, durableRecovery };
  const recoveryStateFingerprint = sha256Bytes(canonicalJson(recoveryCanonical));
  const finalRecoveryPlan = await PipelineRecoveryPlanner.createResumePlan(projectSlug);
  const finalJobSnapshot = await PipelineJobManager.listJobsReadOnly(projectSlug);
  const finalJobs = excludeAdmittedJob(Array.isArray(finalJobSnapshot)
    ? finalJobSnapshot
    : (finalJobSnapshot as { jobs?: readonly unknown[] }).jobs ?? [], projectSlug);
  const normalizedFinalRecovery = normalizeRecovery(finalRecoveryPlan, finalJobs, projectSlug);
  const finalDurableRecovery = await createLegacyReauthorizationDurableRecoverySnapshot({ projectFolder, projectSlug,
    runId: marker.runId, evaluatedAt: marker.createdAt, markerState: marker.acceptanceStatus,
    startStage: normalizedFinalRecovery.startStage });
  const finalRecoveryCanonical = { ...normalizedFinalRecovery,
    durableRecovery: finalDurableRecovery };
  const finalConfiguration = await createProductionAcceptancePortableConfigurationSnapshotV2(
    projectSlug, environment, readBinary);
  const finalArtifactInventoryFingerprint = inventoryFingerprint(projectFolder, projectSlug);
  if (finalConfiguration.unavailableComponents.length > 0 ||
    canonicalJson(finalConfiguration) !== canonicalJson(configuration) ||
    finalArtifactInventoryFingerprint !== artifactInventoryFingerprint ||
    canonicalJson(finalRecoveryCanonical) !== canonicalJson(recoveryCanonical)) {
    throw failure("PRODUCTION_ACCEPTANCE_REAUTHORIZATION_CONCURRENT_CHANGE", projectSlug, "concurrency");
  }
  requireSameDirectoryIdentity(runtimeRoot, runtimeBefore, projectSlug);
  requireSameDirectoryIdentity(projectsRoot, rootBefore, projectSlug);
  requireSameDirectoryIdentity(projectFolder, projectBefore, projectSlug);
  requireSameCanonicalMarkerIdentity(projectFolder, markerRead, projectSlug);
  const reauthorizationId = deriveLegacyReauthorizationChallengeId({
    protocolVersion: legacyReauthorizationSchemaVersion,
    projectSlug,
    sourceMarkerSha256,
    sourceMarkerByteLength: markerRead.bytes.length,
    sourceMarkerDeviceIdentity: markerRead.deviceIdentity,
    sourceMarkerInodeIdentity: markerRead.inodeIdentity,
    sourceLegacyConfigurationFingerprint: marker.configurationFingerprint,
    runId: marker.runId,
    topicFingerprint: marker.topicFingerprint,
    currentProfile2ConfigurationFingerprint: configuration.configurationFingerprint,
    storageAuthorityFingerprint,
    artifactInventoryFingerprint,
    recoveryStateFingerprint,
    reason: legacyReauthorizationReason,
    strictProductionAcceptance: true,
    publishMode: "package-only",
  });
  return Object.freeze({
    projectSlug,
    context,
    projectFolder,
    markerPath,
    markerBytes: markerRead.bytes,
    markerDeviceIdentity: markerRead.deviceIdentity,
    markerInodeIdentity: markerRead.inodeIdentity,
    marker,
    sourceMarkerSha256,
    configuration,
    storageAuthorityFingerprint,
    artifactInventoryFingerprint,
    recoveryStateFingerprint,
    recoverySnapshot: recoveryCanonical,
    reauthorizationId,
  });
}

type ExactRead = {
  readonly bytes: Buffer;
  readonly device: bigint;
  readonly inode: bigint;
  readonly size: number;
  readonly deviceIdentity: string;
  readonly inodeIdentity: string;
};

function readExactFile(
  filePath: string,
  projectSlug: string,
  category: "marker" | "configuration" | "artifacts",
): ExactRead {
  let descriptor: number | undefined;
  try {
    const link = fs.lstatSync(filePath, { bigint: true });
    if (!link.isFile() || link.isSymbolicLink()) throw new Error("invalid");
    descriptor = fs.openSync(filePath, "r");
    const before = fs.fstatSync(descriptor, { bigint: true });
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor, { bigint: true });
    const finalLink = fs.lstatSync(filePath, { bigint: true });
    if (
      !reliable(before.dev, before.ino) || !before.isFile() ||
      before.dev !== link.dev || before.ino !== link.ino ||
      before.size !== link.size || after.dev !== before.dev ||
      after.ino !== before.ino || after.size !== before.size ||
      BigInt(bytes.length) !== before.size || finalLink.dev !== before.dev ||
      finalLink.ino !== before.ino || finalLink.size !== before.size
    ) throw new Error("changed");
    return {
      bytes,
      device: before.dev,
      inode: before.ino,
      size: Number(before.size),
      deviceIdentity: normalizedFilesystemIdentity("device", before.dev),
      inodeIdentity: normalizedFilesystemIdentity("inode", before.ino),
    };
  } catch {
    throw failure(
      category === "marker"
        ? "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_SOURCE_MARKER_INVALID"
        : category === "configuration"
          ? "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_CONFIGURATION_UNAVAILABLE"
          : "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_ARTIFACT_INVALID",
      projectSlug,
      category,
    );
  } finally {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch { /* Read remains fail-closed above. */ }
    }
  }
}

function parseLegacyMarker(value: unknown, projectSlug: string): LegacyMarkerV2Value {
  try {
    const candidate = value as Record<string, unknown>;
    if (
      candidate.schemaVersion !== "2" || !safeRunId(candidate.runId) ||
      typeof candidate.topic !== "string" || normalizeProductionAcceptanceTopic(candidate.topic) !== candidate.topic ||
      candidate.topicFingerprint !== productionAcceptanceTopicFingerprint(candidate.topic) ||
      !safeSha256(candidate.requestFingerprint) || !safeSha256(candidate.configurationFingerprint) ||
      candidate.strictProductionAcceptance !== true || candidate.publishMode !== "package-only" ||
      typeof candidate.createdAt !== "string" || !validTimestamp(candidate.createdAt) ||
      candidate.acceptanceStatus !== "prepared" || candidate.productionReady !== false ||
      candidate.published !== false
    ) throw new Error("invalid");
    return candidate as unknown as LegacyMarkerV2Value;
  } catch {
    throw failure("PRODUCTION_ACCEPTANCE_REAUTHORIZATION_SOURCE_MARKER_INVALID", projectSlug, "marker");
  }
}

function inventoryFingerprint(projectFolder: string, projectSlug: string): string {
  const records: Array<{ locator: string; type: "directory" | "regular-file"; byteLength?: number;
    sha256?: string; deviceIdentity: string; inodeIdentity: string }> = [];
  const pending = [{ directory: projectFolder,
    expected: identityOfDirectory(projectFolder, projectSlug) }];
  let entries = 0;
  while (pending.length > 0) {
    const { directory, expected } = pending.pop() as (typeof pending)[number];
    requireSameDirectoryIdentity(directory, expected, projectSlug);
    const items = fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const item of items) {
      const candidate = path.join(directory, item.name);
      const relative = path.relative(projectFolder, candidate).replaceAll("\\", "/");
      if (
        !relative.includes("/") &&
        (EXCLUDED_ROOT_ENTRIES.has(relative) ||
          /^\.(?:authority|validation|receipt)-[a-f0-9]{64}\.partial$/.test(relative))
      ) continue;
      entries += 1;
      if (entries > 4096 || item.isSymbolicLink()) {
        throw failure("PRODUCTION_ACCEPTANCE_REAUTHORIZATION_ARTIFACT_INVALID", projectSlug, "artifacts");
      }
      if (item.isDirectory()) {
        const directoryIdentity = identityOfDirectory(candidate, projectSlug);
        records.push({ locator: relative, type: "directory", ...identityEvidence(directoryIdentity) });
        pending.push({ directory: candidate, expected: directoryIdentity });
      }
      else if (item.isFile()) {
        const exact = readExactFile(candidate, projectSlug, "artifacts");
        records.push({ locator: relative, type: "regular-file", byteLength: exact.size,
          sha256: sha256Bytes(exact.bytes), deviceIdentity: exact.deviceIdentity,
          inodeIdentity: exact.inodeIdentity });
      } else {
        throw failure("PRODUCTION_ACCEPTANCE_REAUTHORIZATION_ARTIFACT_INVALID", projectSlug, "artifacts");
      }
    }
    requireSameDirectoryIdentity(directory, expected, projectSlug);
  }
  records.sort((left, right) => left.locator.localeCompare(right.locator));
  return sha256Bytes(canonicalJson({ policyVersion: "project-artifact-inventory-v2",
    exclusionPolicyVersion: "reauthorization-authority-namespaces-v1", records }));
}

function normalizeRecovery(recovery: unknown, jobs: readonly unknown[], projectSlug: string) {
  const value = recovery as { projectSlug?: unknown; type?: unknown; blocked?: unknown;
    startStage?: unknown; stagesToRun?: unknown; dependencies?: unknown };
  if (value.blocked !== false || value.startStage !== "audio" || !Array.isArray(value.stagesToRun) || !Array.isArray(value.dependencies)) {
    throw failure("PRODUCTION_ACCEPTANCE_REAUTHORIZATION_RECOVERY_INVALID", projectSlug, "recovery");
  }
  if ((value.projectSlug !== undefined && value.projectSlug !== projectSlug) ||
    (value.type !== undefined && value.type !== "resume")) {
    throw failure("PRODUCTION_ACCEPTANCE_REAUTHORIZATION_RECOVERY_INVALID", projectSlug, "recovery");
  }
  const stagesToRun = value.stagesToRun.map((stage) => String(stage));
  const stageIndexes = stagesToRun.map((stage) => pipelineRecoveryStageOrder.indexOf(stage as never));
  if (stagesToRun[0] !== "audio" || stageIndexes.some((index) => index < 0) ||
    stageIndexes.some((index, position) => position > 0 && index <= stageIndexes[position - 1])) {
    throw failure("PRODUCTION_ACCEPTANCE_REAUTHORIZATION_RECOVERY_INVALID", projectSlug, "recovery");
  }
  const dependencies = value.dependencies.map((entry) => normalizeRecoveryDependency(entry, projectSlug));
  const normalizedJobs = jobs.map((entry) => normalizeRecoveryJob(entry, projectSlug));
  const active = normalizedJobs.some((job) => job.status === "running" || job.status === "claimed");
  if (active) throw failure("PRODUCTION_ACCEPTANCE_REAUTHORIZATION_RECOVERY_INVALID", projectSlug, "recovery");
  return { policyVersion: "production-acceptance-recovery-snapshot-v2",
    planType: value.type ?? "resume", projectSlug, blocked: value.blocked,
    startStage: "audio" as const,
    stagesToRun, dependencies, activeExecutions: active,
    jobs: normalizedJobs };
}

function excludeAdmittedJob(jobs: readonly unknown[], projectSlug: string): readonly unknown[] {
  const admitted = getProductionAcceptanceLegacyAdmittedExecution();
  if (!admitted || admitted.projectSlug !== projectSlug) return jobs;
  return jobs.filter((entry) => !entry || typeof entry !== "object" || Array.isArray(entry) ||
    (entry as Record<string, unknown>).stage !== admitted.stage);
}

function normalizeRecoveryDependency(entry: unknown, projectSlug: string) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw failure("PRODUCTION_ACCEPTANCE_REAUTHORIZATION_RECOVERY_INVALID", projectSlug, "recovery");
  }
  const value = entry as Record<string, unknown>;
  const stage = typeof value.stage === "string" ? value.stage : undefined;
  if (!stage || !pipelineRecoveryStageOrder.includes(stage as never)) {
    throw failure("PRODUCTION_ACCEPTANCE_REAUTHORIZATION_RECOVERY_INVALID", projectSlug, "recovery");
  }
  return { stage, status: typeof value.status === "string" ? value.status : null,
    completed: value.completed === true, fileReady: value.fileReady === true,
    ready: value.ready === true, reason: typeof value.reason === "string" ? value.reason : null };
}

function normalizeRecoveryJob(entry: unknown, projectSlug: string) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw failure("PRODUCTION_ACCEPTANCE_REAUTHORIZATION_RECOVERY_INVALID", projectSlug, "recovery");
  }
  const value = entry as Record<string, unknown>;
  if ((value.projectSlug !== undefined && value.projectSlug !== projectSlug) ||
    typeof value.status !== "string") {
    throw failure("PRODUCTION_ACCEPTANCE_REAUTHORIZATION_RECOVERY_INVALID", projectSlug, "recovery");
  }
  const stage = typeof value.stage === "string" ? value.stage : null;
  if (stage !== null && !pipelineRecoveryStageOrder.includes(stage as never)) {
    throw failure("PRODUCTION_ACCEPTANCE_REAUTHORIZATION_RECOVERY_INVALID", projectSlug, "recovery");
  }
  return { id: typeof value.id === "string" ? value.id : null, projectSlug,
    stage, status: value.status, attempts: Number.isSafeInteger(value.attempts) ? value.attempts : null,
    version: Number.isSafeInteger(value.version) ? value.version : null,
    operationId: typeof value.operationId === "string" ? value.operationId : null,
    journalFingerprint: safeSha256(value.journalFingerprint) ? value.journalFingerprint : null };
}

function realDirectory(candidate: string, projectSlug: string): string {
  try {
    const link = fs.lstatSync(candidate);
    if (!link.isDirectory() || link.isSymbolicLink()) throw new Error("invalid");
    return fs.realpathSync(candidate);
  } catch {
    throw failure("PRODUCTION_ACCEPTANCE_REAUTHORIZATION_STORAGE_MISMATCH", projectSlug, "storage");
  }
}

function identityOfDirectory(directory: string, projectSlug: string) {
  const stat = fs.lstatSync(directory, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink() || !reliable(stat.dev, stat.ino)) {
    throw failure("PRODUCTION_ACCEPTANCE_REAUTHORIZATION_STORAGE_MISMATCH", projectSlug, "storage");
  }
  return { device: stat.dev, inode: stat.ino,
    deviceIdentity: normalizedFilesystemIdentity("device", stat.dev),
    inodeIdentity: normalizedFilesystemIdentity("inode", stat.ino) };
}

function requireSameDirectoryIdentity(directory: string, expected: { device: bigint; inode: bigint }, projectSlug: string) {
  const current = identityOfDirectory(directory, projectSlug);
  if (current.device !== expected.device || current.inode !== expected.inode) {
    throw failure("PRODUCTION_ACCEPTANCE_REAUTHORIZATION_CONCURRENT_CHANGE", projectSlug, "concurrency");
  }
}

function requireSameCanonicalMarkerIdentity(
  projectFolder: string,
  expected: ReturnType<typeof readCanonicalProductionAcceptanceMarkerDescriptorBound>,
  projectSlug: string,
) {
  let current: ReturnType<typeof readCanonicalProductionAcceptanceMarkerDescriptorBound>;
  try {
    current = readCanonicalProductionAcceptanceMarkerDescriptorBound({ projectFolder });
  } catch {
    throw failure("PRODUCTION_ACCEPTANCE_REAUTHORIZATION_CONCURRENT_CHANGE", projectSlug, "concurrency");
  }
  if (current.deviceIdentity !== expected.deviceIdentity ||
    current.inodeIdentity !== expected.inodeIdentity || !current.bytes.equals(expected.bytes)) {
    throw failure("PRODUCTION_ACCEPTANCE_REAUTHORIZATION_CONCURRENT_CHANGE", projectSlug, "concurrency");
  }
}

function inside(directory: string, target: string) {
  const relative = path.relative(directory, target);
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function reliable(device: bigint, inode: bigint) {
  return device > BigInt(0) && inode > BigInt(0);
}

function identityEvidence(identity: { deviceIdentity: string; inodeIdentity: string }) {
  return { deviceIdentity: identity.deviceIdentity, inodeIdentity: identity.inodeIdentity };
}

function safeSlug(value: string) {
  return /^[a-z0-9](?:[a-z0-9-]{0,198}[a-z0-9])?$/.test(value);
}

function safeRunId(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9-]{36}$/.test(value);
}

function validTimestamp(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function failure(
  code: ConstructorParameters<typeof ProductionAcceptanceLegacyReauthorizationError>[0],
  projectSlug: string,
  category: ConstructorParameters<typeof ProductionAcceptanceLegacyReauthorizationError>[2],
) {
  return new ProductionAcceptanceLegacyReauthorizationError(code, projectSlug, category);
}
