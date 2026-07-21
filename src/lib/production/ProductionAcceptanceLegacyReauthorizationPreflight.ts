import fs from "node:fs";
import path from "node:path";
import { ProjectReader } from "@/lib/projects/ProjectReader";
import { PipelineRecoveryPlanner } from "@/lib/pipeline/PipelineRecoveryPlanner";
import { PipelineJobManager } from "@/lib/pipeline/PipelineJobManager";
import {
  createRuntimeStorageContext,
  type RuntimeStorageContext,
} from "@/lib/runtime/RuntimeStoragePaths";
import {
  createProductionAcceptancePortableConfigurationSnapshotV2,
  type ProductionAcceptancePortableConfigurationSnapshotV2,
} from "./ProductionAcceptanceConfigurationFingerprint";
import {
  canonicalJson,
  legacyReauthorizationReason,
  legacyReauthorizationSchemaVersion,
  ProductionAcceptanceLegacyReauthorizationError,
  safeSha256,
  sha256Bytes,
} from "./ProductionAcceptanceLegacyReauthorization";
import {
  normalizeProductionAcceptanceTopic,
  createProductionAcceptanceProjectSlug,
  productionAcceptanceTopicFingerprint,
} from "./ProductionAcceptanceTopic";
import { productionAcceptanceConfigurationFingerprint } from
  "./ProductionAcceptancePolicy";

const MARKER_FILE = "production-acceptance.json";
const EXCLUDED_ROOT_ENTRIES = new Set([
  "production-acceptance-authority",
  "production-acceptance-reauthorization.json",
  "production-acceptance-validation.json",
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
  readonly markerDevice: number;
  readonly markerInode: number;
  readonly marker: LegacyMarkerV2Value;
  readonly sourceMarkerSha256: string;
  readonly configuration: ProductionAcceptancePortableConfigurationSnapshotV2;
  readonly storageAuthorityFingerprint: string;
  readonly artifactInventoryFingerprint: string;
  readonly recoveryStateFingerprint: string;
  readonly reauthorizationId: string;
}

export interface LegacyReauthorizationPreflightDependencies {
  readonly environment?: NodeJS.ProcessEnv;
  readonly workspaceRoot?: string;
  readonly authorityRoot?: string;
  readonly recoverySnapshot?: (projectSlug: string) => Promise<unknown>;
  readonly jobSnapshot?: (projectSlug: string) => Promise<readonly unknown[]>;
  readonly readBinary?: (filePath: string) => Promise<Buffer>;
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
    context = createRuntimeStorageContext({
      environment,
      ...(dependencies.workspaceRoot ? { workspaceRoot: dependencies.workspaceRoot } : {}),
      ...(dependencies.authorityRoot ? { authorityRoot: dependencies.authorityRoot } : {}),
    });
  } catch {
    throw failure("PRODUCTION_ACCEPTANCE_REAUTHORIZATION_STORAGE_MISMATCH", projectSlug, "storage");
  }
  const projectsRoot = realDirectory(context.projectsRoot, projectSlug);
  const projectFolder = realDirectory(ProjectReader.getProjectFolder(projectSlug, context), projectSlug);
  if (!inside(projectsRoot, projectFolder)) {
    throw failure("PRODUCTION_ACCEPTANCE_REAUTHORIZATION_STORAGE_MISMATCH", projectSlug, "storage");
  }
  const rootBefore = identityOfDirectory(projectsRoot, projectSlug);
  const projectBefore = identityOfDirectory(projectFolder, projectSlug);
  const markerPath = path.join(projectFolder, MARKER_FILE);
  const markerRead = readExactFile(markerPath, projectSlug, "marker");
  const sourceMarkerSha256 = sha256Bytes(markerRead.bytes);
  if (sourceMarkerSha256 !== expectedMarkerSha256) {
    throw failure("PRODUCTION_ACCEPTANCE_REAUTHORIZATION_SOURCE_HASH_MISMATCH", projectSlug, "marker");
  }
  const marker = parseLegacyMarker(markerRead.bytes, projectSlug);
  if (createProductionAcceptanceProjectSlug(marker.topic, marker.runId) !== projectSlug) {
    throw failure("PRODUCTION_ACCEPTANCE_REAUTHORIZATION_BINDING_MISMATCH", projectSlug, "marker");
  }
  if (marker.configurationFingerprint === productionAcceptanceConfigurationFingerprint(environment)) {
    throw failure("PRODUCTION_ACCEPTANCE_REAUTHORIZATION_NOT_LEGACY", projectSlug, "configuration");
  }

  const readBinary = dependencies.readBinary ?? ((filePath: string) =>
    Promise.resolve(readExactFile(filePath, projectSlug, "configuration").bytes));
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
    runtimePolicyVersion: context.policyVersion,
    classification: context.classification,
    logicalProjectsRoot: context.logicalProjectsRoot,
    projectsRoot: rootBefore,
    projectRoot: projectBefore,
  }));
  const artifactInventoryFingerprint = inventoryFingerprint(projectFolder, projectSlug);
  const recovery = dependencies.recoverySnapshot
    ? await dependencies.recoverySnapshot(projectSlug)
    : await PipelineRecoveryPlanner.createResumePlan(projectSlug);
  const jobSnapshot = dependencies.jobSnapshot
    ? await dependencies.jobSnapshot(projectSlug)
    : await PipelineJobManager.listJobsReadOnly(projectSlug);
  const jobs = Array.isArray(jobSnapshot)
    ? jobSnapshot
    : (jobSnapshot as { jobs?: readonly unknown[] }).jobs ?? [];
  const recoveryCanonical = normalizeRecovery(recovery, jobs, projectSlug);
  const recoveryStateFingerprint = sha256Bytes(canonicalJson(recoveryCanonical));
  requireSameDirectoryIdentity(projectsRoot, rootBefore, projectSlug);
  requireSameDirectoryIdentity(projectFolder, projectBefore, projectSlug);
  requireSameFileIdentity(markerPath, markerRead, projectSlug);
  const reauthorizationId = sha256Bytes(canonicalJson({
    schemaVersion: legacyReauthorizationSchemaVersion,
    policyVersion: "legacy-marker-reauthorization-id-v1",
    projectSlug,
    sourceMarkerSha256,
    sourceMarkerByteLength: markerRead.bytes.length,
    sourceLegacyConfigurationFingerprint: marker.configurationFingerprint,
    runId: marker.runId,
    topic: marker.topic,
    topicFingerprint: marker.topicFingerprint,
    configurationFingerprint: configuration.configurationFingerprint,
    storageAuthorityFingerprint,
    artifactInventoryFingerprint,
    recoveryStateFingerprint,
    reason: legacyReauthorizationReason,
    strictProductionAcceptance: true,
    publishMode: "package-only",
  }));
  return Object.freeze({
    projectSlug,
    context,
    projectFolder,
    markerPath,
    markerBytes: markerRead.bytes,
    markerDevice: markerRead.device,
    markerInode: markerRead.inode,
    marker,
    sourceMarkerSha256,
    configuration,
    storageAuthorityFingerprint,
    artifactInventoryFingerprint,
    recoveryStateFingerprint,
    reauthorizationId,
  });
}

type ExactRead = { readonly bytes: Buffer; readonly device: number; readonly inode: number; readonly size: number };

function readExactFile(
  filePath: string,
  projectSlug: string,
  category: "marker" | "configuration" | "artifacts",
): ExactRead {
  let descriptor: number | undefined;
  try {
    const link = fs.lstatSync(filePath);
    if (!link.isFile() || link.isSymbolicLink()) throw new Error("invalid");
    descriptor = fs.openSync(filePath, "r");
    const before = fs.fstatSync(descriptor);
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor);
    const finalLink = fs.lstatSync(filePath);
    if (
      !reliable(before.dev, before.ino) || !before.isFile() ||
      before.dev !== link.dev || before.ino !== link.ino ||
      before.size !== link.size || after.dev !== before.dev ||
      after.ino !== before.ino || after.size !== before.size ||
      bytes.length !== before.size || finalLink.dev !== before.dev ||
      finalLink.ino !== before.ino || finalLink.size !== before.size
    ) throw new Error("changed");
    return { bytes, device: before.dev, inode: before.ino, size: before.size };
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

function parseLegacyMarker(bytes: Buffer, projectSlug: string): LegacyMarkerV2Value {
  try {
    const value = JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
    if (
      value.schemaVersion !== "2" || !safeRunId(value.runId) ||
      typeof value.topic !== "string" || normalizeProductionAcceptanceTopic(value.topic) !== value.topic ||
      value.topicFingerprint !== productionAcceptanceTopicFingerprint(value.topic) ||
      !safeSha256(value.requestFingerprint) || !safeSha256(value.configurationFingerprint) ||
      value.strictProductionAcceptance !== true || value.publishMode !== "package-only" ||
      typeof value.createdAt !== "string" || !validTimestamp(value.createdAt) ||
      value.acceptanceStatus !== "prepared" || value.productionReady !== false ||
      value.published !== false
    ) throw new Error("invalid");
    return value as unknown as LegacyMarkerV2Value;
  } catch {
    throw failure("PRODUCTION_ACCEPTANCE_REAUTHORIZATION_SOURCE_MARKER_INVALID", projectSlug, "marker");
  }
}

function inventoryFingerprint(projectFolder: string, projectSlug: string): string {
  const records: Array<{ locator: string; byteLength: number; sha256: string }> = [];
  const pending = [projectFolder];
  let entries = 0;
  while (pending.length > 0) {
    const directory = pending.pop() as string;
    const items = fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const item of items) {
      const candidate = path.join(directory, item.name);
      const relative = path.relative(projectFolder, candidate).replaceAll("\\", "/");
      if (
        !relative.includes("/") &&
        (EXCLUDED_ROOT_ENTRIES.has(relative) ||
          /^\.(?:authority|validation)-[a-f0-9]{64}\.partial$/.test(relative))
      ) continue;
      entries += 1;
      if (entries > 4096 || item.isSymbolicLink()) {
        throw failure("PRODUCTION_ACCEPTANCE_REAUTHORIZATION_ARTIFACT_INVALID", projectSlug, "artifacts");
      }
      if (item.isDirectory()) pending.push(candidate);
      else if (item.isFile()) {
        const exact = readExactFile(candidate, projectSlug, "artifacts");
        records.push({ locator: relative, byteLength: exact.size, sha256: sha256Bytes(exact.bytes) });
      } else {
        throw failure("PRODUCTION_ACCEPTANCE_REAUTHORIZATION_ARTIFACT_INVALID", projectSlug, "artifacts");
      }
    }
  }
  return sha256Bytes(canonicalJson({ policyVersion: "project-artifact-inventory-v1", records }));
}

function normalizeRecovery(recovery: unknown, jobs: readonly unknown[], projectSlug: string) {
  const value = recovery as { blocked?: unknown; startStage?: unknown; stagesToRun?: unknown; dependencies?: unknown };
  if (value.blocked !== false || value.startStage !== "audio" || !Array.isArray(value.stagesToRun) || !Array.isArray(value.dependencies)) {
    throw failure("PRODUCTION_ACCEPTANCE_REAUTHORIZATION_RECOVERY_INVALID", projectSlug, "recovery");
  }
  const active = jobs.some((job) => {
    const status = (job as { status?: unknown }).status;
    return status === "running" || status === "claimed";
  });
  if (active) throw failure("PRODUCTION_ACCEPTANCE_REAUTHORIZATION_RECOVERY_INVALID", projectSlug, "recovery");
  return { blocked: false, startStage: "audio", stagesToRun: value.stagesToRun, dependencies: value.dependencies, activeExecutions: false };
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
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || !reliable(stat.dev, stat.ino)) {
    throw failure("PRODUCTION_ACCEPTANCE_REAUTHORIZATION_STORAGE_MISMATCH", projectSlug, "storage");
  }
  return { device: stat.dev, inode: stat.ino };
}

function requireSameDirectoryIdentity(directory: string, expected: { device: number; inode: number }, projectSlug: string) {
  const current = identityOfDirectory(directory, projectSlug);
  if (current.device !== expected.device || current.inode !== expected.inode) {
    throw failure("PRODUCTION_ACCEPTANCE_REAUTHORIZATION_CONCURRENT_CHANGE", projectSlug, "concurrency");
  }
}

function requireSameFileIdentity(filePath: string, expected: ExactRead, projectSlug: string) {
  const current = readExactFile(filePath, projectSlug, "marker");
  if (current.device !== expected.device || current.inode !== expected.inode || !current.bytes.equals(expected.bytes)) {
    throw failure("PRODUCTION_ACCEPTANCE_REAUTHORIZATION_CONCURRENT_CHANGE", projectSlug, "concurrency");
  }
}

function inside(directory: string, target: string) {
  const relative = path.relative(directory, target);
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function reliable(device: number, inode: number) {
  return Number.isFinite(device) && Number.isInteger(device) && device > 0 &&
    Number.isFinite(inode) && Number.isInteger(inode) && inode > 0;
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
