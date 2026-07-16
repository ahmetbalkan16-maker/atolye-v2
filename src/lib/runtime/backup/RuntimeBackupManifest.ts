import { createHash } from "node:crypto";
import {
  isPortableRuntimePathSegment,
  runtimeStoragePolicyVersion,
} from "@/lib/runtime/RuntimeStoragePaths";
import {
  runtimePortableCollisionKey,
  validateRuntimeLogicalPath,
} from "@/lib/runtime/security/RuntimePathPolicy";

export const runtimeBackupManifestSchemaVersion = "1" as const;
export const runtimeBackupFormatVersion = "runtime-backup-v1" as const;
export const runtimeBackupAggregateVersion = "runtime-tree-sha256-v1" as const;

export type RuntimeBackupFileClassification =
  | "project-metadata"
  | "pipeline-state"
  | "ai-usage"
  | "asset-metadata"
  | "generated-asset"
  | "acceptance-marker"
  | "durable-execution"
  | "legacy-project-file"
  | "other-runtime";

export interface RuntimeBackupGitMetadata {
  readonly tracked: boolean;
  readonly blobOid?: string;
  readonly gitMode?: string;
}

export interface RuntimeBackupFileRecord {
  readonly relativePath: string;
  readonly type: "file";
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly permissionClass: "regular" | "executable";
  readonly projectSlug?: string;
  readonly classification: RuntimeBackupFileClassification;
  readonly git?: RuntimeBackupGitMetadata;
}

export interface RuntimeBackupInventoryTotals {
  readonly files: number;
  readonly bytes: number;
  readonly projects: number;
  readonly tracked: number;
  readonly untracked: number;
  readonly classifications: Readonly<Record<RuntimeBackupFileClassification, number>>;
}

export interface RuntimeBackupManifest {
  readonly schemaVersion: typeof runtimeBackupManifestSchemaVersion;
  readonly backupFormatVersion: typeof runtimeBackupFormatVersion;
  readonly aggregateAlgorithm: typeof runtimeBackupAggregateVersion;
  readonly storagePolicyVersion: typeof runtimeStoragePolicyVersion;
  readonly createdAt: string;
  readonly sourceLogicalIdentity: string;
  readonly sourceClassification: string;
  readonly sourceProjectsRootLogicalName: "projects";
  readonly sourceHeadCommit?: string;
  readonly aggregateFingerprint: string;
  readonly inventory: RuntimeBackupInventoryTotals;
  readonly files: readonly RuntimeBackupFileRecord[];
}

export function aggregateRuntimeFileRecords(
  files: readonly Pick<RuntimeBackupFileRecord, "relativePath" | "sizeBytes" | "sha256">[],
) {
  const hash = createHash("sha256");
  for (const file of [...files].sort(compareRecords)) {
    hash.update(file.relativePath, "utf8");
    hash.update("\0");
    hash.update(String(file.sizeBytes), "ascii");
    hash.update("\0");
    hash.update(file.sha256, "ascii");
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function serializeRuntimeBackupManifest(manifest: RuntimeBackupManifest) {
  validateRuntimeBackupManifest(manifest);
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function runtimeBackupManifestSha256(serialized: string | Buffer) {
  return createHash("sha256").update(serialized).digest("hex");
}

export function validateRuntimeBackupManifest(
  value: unknown,
): asserts value is RuntimeBackupManifest {
  if (!isRecord(value)) throw new Error("Runtime backup manifest is invalid.");
  assertExactKeys(value, [
    "schemaVersion",
    "backupFormatVersion",
    "aggregateAlgorithm",
    "storagePolicyVersion",
    "createdAt",
    "sourceLogicalIdentity",
    "sourceClassification",
    "sourceProjectsRootLogicalName",
    "sourceHeadCommit",
    "aggregateFingerprint",
    "inventory",
    "files",
  ], "Runtime backup manifest is invalid.");
  if (
    value.schemaVersion !== runtimeBackupManifestSchemaVersion ||
    value.backupFormatVersion !== runtimeBackupFormatVersion ||
    value.aggregateAlgorithm !== runtimeBackupAggregateVersion ||
    value.storagePolicyVersion !== runtimeStoragePolicyVersion ||
    typeof value.createdAt !== "string" ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    typeof value.sourceLogicalIdentity !== "string" ||
    !validSourceLogicalIdentity(value.sourceLogicalIdentity) ||
    typeof value.sourceClassification !== "string" ||
    !/^[a-z0-9-]+$/.test(value.sourceClassification) ||
    value.sourceProjectsRootLogicalName !== "projects" ||
    (value.sourceHeadCommit !== undefined &&
      (typeof value.sourceHeadCommit !== "string" || !/^[a-f0-9]{40,64}$/.test(value.sourceHeadCommit))) ||
    typeof value.aggregateFingerprint !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.aggregateFingerprint) ||
    !Array.isArray(value.files) ||
    !isRecord(value.inventory)
  ) throw new Error("Runtime backup manifest is invalid.");

  const files = value.files as unknown[];
  let previous = "";
  const exact = new Set<string>();
  const folded = new Set<string>();
  for (const item of files) {
    validateFileRecord(item);
    if (previous && compareText(previous, item.relativePath) >= 0) {
      throw new Error("Runtime backup manifest ordering is invalid.");
    }
    previous = item.relativePath;
    const portableKey = runtimePortableCollisionKey(item.relativePath);
    if (exact.has(item.relativePath) || folded.has(portableKey)) {
      throw new Error("Runtime backup manifest path collision detected.");
    }
    exact.add(item.relativePath);
    folded.add(portableKey);
  }
  if (aggregateRuntimeFileRecords(files as RuntimeBackupFileRecord[]) !== value.aggregateFingerprint) {
    throw new Error("Runtime backup aggregate fingerprint is invalid.");
  }
  validateTotals(value.inventory, files as RuntimeBackupFileRecord[]);
  if (JSON.stringify(value).includes("\\") || containsAbsoluteHostPath(JSON.stringify(value))) {
    throw new Error("Runtime backup manifest contains a host path.");
  }
}

function validateFileRecord(value: unknown): asserts value is RuntimeBackupFileRecord {
  if (!isRecord(value)) throw new Error("Runtime backup file record is invalid.");
  assertExactKeys(value, [
    "relativePath",
    "type",
    "sizeBytes",
    "sha256",
    "permissionClass",
    "projectSlug",
    "classification",
    "git",
  ], "Runtime backup file record is invalid.");
  if (
    typeof value.relativePath !== "string" ||
    !validRelativePath(value.relativePath) ||
    value.type !== "file" ||
    !Number.isSafeInteger(value.sizeBytes) ||
    (value.sizeBytes as number) < 0 ||
    typeof value.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.sha256) ||
    (value.permissionClass !== "regular" && value.permissionClass !== "executable") ||
    (value.projectSlug !== undefined &&
      (typeof value.projectSlug !== "string" || !/^[a-zA-Z0-9-_]+$/.test(value.projectSlug))) ||
    !runtimeBackupClassifications.includes(value.classification as RuntimeBackupFileClassification)
  ) throw new Error("Runtime backup file record is invalid.");
  if (value.git !== undefined) validateGitMetadata(value.git);
}

function validateGitMetadata(value: unknown) {
  if (!isRecord(value) || typeof value.tracked !== "boolean") {
    throw new Error("Runtime backup Git metadata is invalid.");
  }
  assertExactKeys(
    value,
    value.tracked ? ["tracked", "blobOid", "gitMode"] : ["tracked"],
    "Runtime backup Git metadata is invalid.",
  );
  if (value.tracked) {
    if (
      typeof value.blobOid !== "string" || !/^[a-f0-9]{40,64}$/.test(value.blobOid) ||
      typeof value.gitMode !== "string" || !/^[0-7]{6}$/.test(value.gitMode)
    ) throw new Error("Runtime backup Git metadata is invalid.");
  } else if (value.blobOid !== undefined || value.gitMode !== undefined) {
    throw new Error("Runtime backup Git metadata is invalid.");
  }
}

function validateTotals(value: Record<string, unknown>, files: RuntimeBackupFileRecord[]) {
  assertExactKeys(value, [
    "files",
    "bytes",
    "projects",
    "tracked",
    "untracked",
    "classifications",
  ], "Runtime backup inventory totals are invalid.");
  if (!isRecord(value.classifications)) {
    throw new Error("Runtime backup inventory totals are invalid.");
  }
  assertExactKeys(
    value.classifications,
    runtimeBackupClassifications,
    "Runtime backup inventory totals are invalid.",
  );
  const projects = new Set(files.map((file) => file.projectSlug).filter(Boolean));
  const tracked = files.filter((file) => file.git?.tracked).length;
  const expectedClassifications = emptyClassificationTotals();
  files.forEach((file) => { expectedClassifications[file.classification] += 1; });
  if (
    value.files !== files.length ||
    value.bytes !== files.reduce((sum, file) => sum + file.sizeBytes, 0) ||
    value.projects !== projects.size ||
    value.tracked !== tracked ||
    value.untracked !== files.length - tracked ||
    JSON.stringify(value.classifications) !== JSON.stringify(expectedClassifications)
  ) throw new Error("Runtime backup inventory totals are invalid.");
}

export const runtimeBackupClassifications: readonly RuntimeBackupFileClassification[] = [
  "project-metadata",
  "pipeline-state",
  "ai-usage",
  "asset-metadata",
  "generated-asset",
  "acceptance-marker",
  "durable-execution",
  "legacy-project-file",
  "other-runtime",
];

export function emptyClassificationTotals(): Record<RuntimeBackupFileClassification, number> {
  return Object.fromEntries(runtimeBackupClassifications.map((item) => [item, 0])) as
    Record<RuntimeBackupFileClassification, number>;
}

function compareRecords(
  left: Pick<RuntimeBackupFileRecord, "relativePath">,
  right: Pick<RuntimeBackupFileRecord, "relativePath">,
) {
  return compareText(left.relativePath, right.relativePath);
}

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function validRelativePath(value: string) {
  try {
    validateRuntimeLogicalPath(value);
    return value.split("/").every(isPortableRuntimePathSegment);
  } catch {
    return false;
  }
}

function validSourceLogicalIdentity(value: string) {
  if (value === "projects") return true;
  const segments = value.split("/");
  return segments.length === 2 &&
    segments[0] === "projects" &&
    /^[a-zA-Z0-9-_]+$/.test(segments[1]) &&
    isPortableRuntimePathSegment(segments[1]);
}

function containsAbsoluteHostPath(value: string) {
  return /(?:[a-zA-Z]:[\\/]|\\\\[^\\]+\\|\/(?:Users|home|var|tmp)\/)/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  message: string,
) {
  const keys = Object.keys(value);
  if (keys.some((key) => !allowed.includes(key))) throw new Error(message);
}
