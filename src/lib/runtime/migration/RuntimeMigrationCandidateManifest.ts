import { createHash } from "node:crypto";
import {
  aggregateRuntimeFileRecords,
  runtimeBackupAggregateVersion,
  runtimeBackupClassifications,
  runtimeBackupFormatVersion,
  runtimeBackupManifestSchemaVersion,
  validateRuntimeBackupManifest,
  type RuntimeBackupFileClassification,
  type RuntimeBackupFileRecord,
  type RuntimeBackupInventoryTotals,
  type RuntimeBackupManifest,
} from "@/lib/runtime/backup/RuntimeBackupManifest";
import type { RuntimeBackupVerificationReport } from "@/lib/runtime/backup/RuntimeBackupVerifier";
import {
  isPortableRuntimeSegment,
  runtimePortableCollisionKey,
  runtimePortablePathPolicyVersion,
  validateRuntimeLogicalPath,
} from "@/lib/runtime/security/RuntimePathPolicy";
import { RuntimeMigrationCandidateError } from "./RuntimeMigrationCandidateError";

export const runtimeMigrationCandidateSchemaVersion = "1" as const;
export const runtimeMigrationCandidateFormatVersion = "runtime-migration-candidate-v1" as const;
export const runtimeMigrationCandidateScopeVersion = "all-projects-runtime-v1" as const;
export const runtimeMigrationCandidateCapabilityContractVersion = "migration-candidate-capability-v1" as const;

export interface RuntimeMigrationMarkerBinding {
  readonly relativePath: string;
  readonly sha256: string;
}

export interface RuntimeMigrationDurableBinding {
  readonly files: number;
  readonly bytes: number;
  readonly aggregateFingerprint: string;
}

export interface RuntimeMigrationCandidateManifest {
  readonly schemaVersion: typeof runtimeMigrationCandidateSchemaVersion;
  readonly candidateFormatVersion: typeof runtimeMigrationCandidateFormatVersion;
  readonly candidateId: string;
  readonly scopeVersion: typeof runtimeMigrationCandidateScopeVersion;
  readonly pathPolicyVersion: typeof runtimePortablePathPolicyVersion;
  readonly createdAt: string;
  readonly sourceBackup: {
    readonly backupId: string;
    readonly manifestSha256: string;
    readonly aggregateFingerprint: string;
    readonly formatVersion: typeof runtimeBackupFormatVersion;
    readonly storagePolicyVersion: string;
    readonly sourceLogicalIdentity: "projects";
    readonly sourceClassification: string;
    readonly sourceCreatedAt: string;
    readonly sourceHeadCommit?: string;
  };
  readonly sourceRuntimeEvidence: {
    readonly aggregateFingerprint: string;
    readonly markerBindings: readonly RuntimeMigrationMarkerBinding[];
    readonly durableExecutionAggregate: string;
  };
  readonly aggregateAlgorithm: typeof runtimeBackupAggregateVersion;
  readonly candidateAggregate: string;
  readonly inventory: RuntimeBackupInventoryTotals;
  readonly files: readonly RuntimeBackupFileRecord[];
  readonly directories: readonly string[];
  readonly markerBindings: readonly RuntimeMigrationMarkerBinding[];
  readonly durableExecutionBinding: RuntimeMigrationDurableBinding;
  readonly classificationTotals: Readonly<Record<RuntimeBackupFileClassification, number>>;
  readonly capabilitySummary: {
    readonly contractVersion: typeof runtimeMigrationCandidateCapabilityContractVersion;
    readonly destinationClass: "local-persistent" | "test-temp";
    readonly filesystemKind: string;
    readonly hostileConcurrentIsolation: false;
    readonly activeProbePerformed: false;
  };
  readonly gitEvidence: {
    readonly headCommit?: string;
    readonly worktreeProjectsClean: boolean;
    readonly authority: "informational-only";
  };
  readonly operationEvidence: {
    readonly mode: "preflight-contract" | "candidate-create";
    readonly mutationPerformed: boolean;
    readonly productionCalls: 0;
  };
  readonly verificationStatus: "verified";
}

export function runtimeMigrationCandidateId(input: {
  readonly sourceBackupManifestSha256: string;
  readonly sourceBackupAggregate: string;
}) {
  if (!sha256(input.sourceBackupManifestSha256) || !sha256(input.sourceBackupAggregate)) {
    throw new RuntimeMigrationCandidateError("INVALID_ARGUMENT");
  }
  const digest = createHash("sha256").update([
    runtimeMigrationCandidateFormatVersion,
    input.sourceBackupManifestSha256,
    input.sourceBackupAggregate,
    runtimeMigrationCandidateScopeVersion,
    runtimePortablePathPolicyVersion,
  ].join("\0"), "utf8").digest("hex");
  return `candidate-${digest}`;
}

export function buildRuntimeMigrationCandidateManifest(input: {
  readonly backupId: string;
  readonly backup: RuntimeBackupVerificationReport;
  readonly createdAt: string;
  readonly sourceRuntimeEvidence: RuntimeMigrationCandidateManifest["sourceRuntimeEvidence"];
  readonly capabilitySummary: RuntimeMigrationCandidateManifest["capabilitySummary"];
  readonly gitEvidence: RuntimeMigrationCandidateManifest["gitEvidence"];
  readonly operationEvidence: RuntimeMigrationCandidateManifest["operationEvidence"];
}): RuntimeMigrationCandidateManifest {
  const backup = input.backup.manifest;
  if (backup.sourceLogicalIdentity !== "projects" || !isPortableRuntimeSegment(input.backupId)) {
    throw new RuntimeMigrationCandidateError("INVALID_ARGUMENT");
  }
  const markerBindings = bindingsFor(backup.files, "acceptance-marker");
  const durableExecutionBinding = durableBinding(backup.files);
  const manifest: RuntimeMigrationCandidateManifest = {
    schemaVersion: runtimeMigrationCandidateSchemaVersion,
    candidateFormatVersion: runtimeMigrationCandidateFormatVersion,
    candidateId: runtimeMigrationCandidateId({
      sourceBackupManifestSha256: input.backup.manifestSha256,
      sourceBackupAggregate: backup.aggregateFingerprint,
    }),
    scopeVersion: runtimeMigrationCandidateScopeVersion,
    pathPolicyVersion: runtimePortablePathPolicyVersion,
    createdAt: input.createdAt,
    sourceBackup: {
      backupId: input.backupId,
      manifestSha256: input.backup.manifestSha256,
      aggregateFingerprint: backup.aggregateFingerprint,
      formatVersion: runtimeBackupFormatVersion,
      storagePolicyVersion: backup.storagePolicyVersion,
      sourceLogicalIdentity: "projects",
      sourceClassification: backup.sourceClassification,
      sourceCreatedAt: backup.createdAt,
      ...(backup.sourceHeadCommit ? { sourceHeadCommit: backup.sourceHeadCommit } : {}),
    },
    sourceRuntimeEvidence: input.sourceRuntimeEvidence,
    aggregateAlgorithm: runtimeBackupAggregateVersion,
    candidateAggregate: backup.aggregateFingerprint,
    inventory: backup.inventory,
    files: backup.files,
    directories: minimalRuntimeDirectoryClosure(backup.files),
    markerBindings,
    durableExecutionBinding,
    classificationTotals: backup.inventory.classifications,
    capabilitySummary: input.capabilitySummary,
    gitEvidence: input.gitEvidence,
    operationEvidence: input.operationEvidence,
    verificationStatus: "verified",
  };
  validateRuntimeMigrationCandidateManifest(manifest);
  return deepFreeze(manifest);
}

export function serializeRuntimeMigrationCandidateManifest(manifest: RuntimeMigrationCandidateManifest) {
  validateRuntimeMigrationCandidateManifest(manifest);
  return `${JSON.stringify(canonicalManifest(manifest), null, 2)}\n`;
}

export function runtimeMigrationCandidateManifestSha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

export function minimalRuntimeDirectoryClosure(
  files: readonly Pick<RuntimeBackupFileRecord, "relativePath">[],
): readonly string[] {
  const directories = new Set<string>();
  for (const file of files) {
    const segments = file.relativePath.split("/");
    for (let length = 1; length < segments.length; length += 1) {
      directories.add(segments.slice(0, length).join("/"));
    }
  }
  return Object.freeze([...directories].sort(compareText));
}

export function validateRuntimeMigrationCandidateManifest(
  value: unknown,
): asserts value is RuntimeMigrationCandidateManifest {
  try {
    validateManifest(value);
  } catch (error) {
    if (error instanceof RuntimeMigrationCandidateError) throw error;
    throw new RuntimeMigrationCandidateError("CANDIDATE_INVALID");
  }
}

function validateManifest(value: unknown): asserts value is RuntimeMigrationCandidateManifest {
  if (!isRecord(value)) throw invalid();
  exact(value, [
    "schemaVersion", "candidateFormatVersion", "candidateId", "scopeVersion",
    "pathPolicyVersion", "createdAt", "sourceBackup", "sourceRuntimeEvidence",
    "aggregateAlgorithm", "candidateAggregate", "inventory", "files", "directories",
    "markerBindings", "durableExecutionBinding", "classificationTotals", "capabilitySummary",
    "gitEvidence", "operationEvidence", "verificationStatus",
  ]);
  if (
    value.schemaVersion !== runtimeMigrationCandidateSchemaVersion ||
    value.candidateFormatVersion !== runtimeMigrationCandidateFormatVersion ||
    value.scopeVersion !== runtimeMigrationCandidateScopeVersion ||
    value.pathPolicyVersion !== runtimePortablePathPolicyVersion ||
    typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt)) ||
    value.aggregateAlgorithm !== runtimeBackupAggregateVersion ||
    typeof value.candidateAggregate !== "string" || !sha256(value.candidateAggregate) ||
    value.verificationStatus !== "verified" || !Array.isArray(value.files) ||
    !Array.isArray(value.directories) || !Array.isArray(value.markerBindings) ||
    !isRecord(value.inventory) || !isRecord(value.classificationTotals)
  ) throw invalid();
  validateSourceBackup(value.sourceBackup);
  validateCapability(value.capabilitySummary);
  validateGitEvidence(value.gitEvidence);
  validateOperation(value.operationEvidence);
  const source = value.sourceBackup as RuntimeMigrationCandidateManifest["sourceBackup"];
  const expectedId = runtimeMigrationCandidateId({
    sourceBackupManifestSha256: source.manifestSha256,
    sourceBackupAggregate: source.aggregateFingerprint,
  });
  if (value.candidateId !== expectedId) {
    throw new RuntimeMigrationCandidateError("CANDIDATE_ID_MISMATCH");
  }
  const backupShape: RuntimeBackupManifest = {
    schemaVersion: runtimeBackupManifestSchemaVersion,
    backupFormatVersion: runtimeBackupFormatVersion,
    aggregateAlgorithm: runtimeBackupAggregateVersion,
    storagePolicyVersion: source.storagePolicyVersion as RuntimeBackupManifest["storagePolicyVersion"],
    createdAt: source.sourceCreatedAt,
    sourceLogicalIdentity: "projects",
    sourceClassification: source.sourceClassification,
    sourceProjectsRootLogicalName: "projects",
    ...(source.sourceHeadCommit ? { sourceHeadCommit: source.sourceHeadCommit } : {}),
    aggregateFingerprint: value.candidateAggregate as string,
    inventory: value.inventory as unknown as RuntimeBackupInventoryTotals,
    files: value.files as unknown as RuntimeBackupFileRecord[],
  };
  const computedAggregate = aggregateRuntimeFileRecords(backupShape.files);
  validateRuntimeBackupManifest({ ...backupShape, aggregateFingerprint: computedAggregate });
  if (
    source.aggregateFingerprint !== value.candidateAggregate ||
    computedAggregate !== value.candidateAggregate
  ) throw new RuntimeMigrationCandidateError("AGGREGATE_MISMATCH");
  const directories = value.directories as string[];
  directories.forEach(validateRuntimeLogicalPath);
  if (JSON.stringify(directories) !== JSON.stringify(minimalRuntimeDirectoryClosure(backupShape.files))) {
    throw new RuntimeMigrationCandidateError("INVENTORY_MISMATCH");
  }
  const markers = validateBindings(value.markerBindings);
  const expectedMarkers = bindingsFor(backupShape.files, "acceptance-marker");
  const durable = validateDurableBinding(value.durableExecutionBinding);
  const expectedDurable = durableBinding(backupShape.files);
  if (
    JSON.stringify(markers) !== JSON.stringify(expectedMarkers) ||
    durable.files !== expectedDurable.files ||
    durable.bytes !== expectedDurable.bytes ||
    durable.aggregateFingerprint !== expectedDurable.aggregateFingerprint
  ) throw new RuntimeMigrationCandidateError("CRITICAL_STATE_MISMATCH");
  validateSourceEvidence(value.sourceRuntimeEvidence, expectedMarkers, expectedDurable, value.candidateAggregate);
  exact(value.classificationTotals as Record<string, unknown>, runtimeBackupClassifications);
  if (runtimeBackupClassifications.some((classification) =>
    (value.classificationTotals as Record<string, unknown>)[classification] !==
      backupShape.inventory.classifications[classification])) {
    throw new RuntimeMigrationCandidateError("INVENTORY_MISMATCH");
  }
  if (containsHostPath(JSON.stringify(value))) throw invalid();
}

function validateSourceBackup(value: unknown) {
  if (!isRecord(value)) throw invalid();
  exact(value, ["backupId", "manifestSha256", "aggregateFingerprint", "formatVersion",
    "storagePolicyVersion", "sourceLogicalIdentity", "sourceClassification", "sourceCreatedAt",
    "sourceHeadCommit"]);
  if (
    typeof value.backupId !== "string" || !isPortableRuntimeSegment(value.backupId) ||
    typeof value.manifestSha256 !== "string" || !sha256(value.manifestSha256) ||
    typeof value.aggregateFingerprint !== "string" || !sha256(value.aggregateFingerprint) ||
    value.formatVersion !== runtimeBackupFormatVersion ||
    typeof value.storagePolicyVersion !== "string" ||
    value.sourceLogicalIdentity !== "projects" ||
    typeof value.sourceClassification !== "string" || !/^[a-z0-9-]+$/.test(value.sourceClassification) ||
    typeof value.sourceCreatedAt !== "string" || !Number.isFinite(Date.parse(value.sourceCreatedAt)) ||
    (value.sourceHeadCommit !== undefined &&
      (typeof value.sourceHeadCommit !== "string" || !/^[a-f0-9]{40,64}$/.test(value.sourceHeadCommit)))
  ) throw invalid();
}

function validateCapability(value: unknown) {
  if (!isRecord(value)) throw invalid();
  exact(value, ["contractVersion", "destinationClass", "filesystemKind",
    "hostileConcurrentIsolation", "activeProbePerformed"]);
  if (
    value.contractVersion !== runtimeMigrationCandidateCapabilityContractVersion ||
    (value.destinationClass !== "local-persistent" && value.destinationClass !== "test-temp") ||
    typeof value.filesystemKind !== "string" || !/^[a-z0-9-]+$/.test(value.filesystemKind) ||
    value.hostileConcurrentIsolation !== false || value.activeProbePerformed !== false
  ) throw invalid();
}

function validateGitEvidence(value: unknown) {
  if (!isRecord(value)) throw invalid();
  exact(value, ["headCommit", "worktreeProjectsClean", "authority"]);
  if (
    (value.headCommit !== undefined &&
      (typeof value.headCommit !== "string" || !/^[a-f0-9]{40,64}$/.test(value.headCommit))) ||
    typeof value.worktreeProjectsClean !== "boolean" || value.authority !== "informational-only"
  ) throw invalid();
}

function validateOperation(value: unknown) {
  if (!isRecord(value)) throw invalid();
  exact(value, ["mode", "mutationPerformed", "productionCalls"]);
  if (
    (value.mode !== "preflight-contract" && value.mode !== "candidate-create") ||
    typeof value.mutationPerformed !== "boolean" || value.productionCalls !== 0 ||
    (value.mode === "preflight-contract" && value.mutationPerformed)
  ) throw invalid();
}

function validateSourceEvidence(
  value: unknown,
  markers: readonly RuntimeMigrationMarkerBinding[],
  durable: RuntimeMigrationDurableBinding,
  aggregate: unknown,
) {
  if (!isRecord(value)) throw invalid();
  exact(value, ["aggregateFingerprint", "markerBindings", "durableExecutionAggregate"]);
  const evidenceMarkers = validateBindings(value.markerBindings);
  if (
    value.aggregateFingerprint !== aggregate ||
    value.durableExecutionAggregate !== durable.aggregateFingerprint ||
    JSON.stringify(evidenceMarkers) !== JSON.stringify(markers)
  ) throw new RuntimeMigrationCandidateError("SOURCE_STALE");
}

function validateBindings(value: unknown): readonly RuntimeMigrationMarkerBinding[] {
  if (!Array.isArray(value)) throw invalid();
  let previous = "";
  const folded = new Set<string>();
  const result = value.map((item) => {
    if (!isRecord(item)) throw invalid();
    exact(item, ["relativePath", "sha256"]);
    if (typeof item.relativePath !== "string" || typeof item.sha256 !== "string" || !sha256(item.sha256)) {
      throw invalid();
    }
    validateRuntimeLogicalPath(item.relativePath);
    const key = runtimePortableCollisionKey(item.relativePath);
    if ((previous && compareText(previous, item.relativePath) >= 0) || folded.has(key)) throw invalid();
    previous = item.relativePath;
    folded.add(key);
    return { relativePath: item.relativePath, sha256: item.sha256 };
  });
  return result;
}

function validateDurableBinding(value: unknown): RuntimeMigrationDurableBinding {
  if (!isRecord(value)) throw invalid();
  exact(value, ["files", "bytes", "aggregateFingerprint"]);
  if (
    !Number.isSafeInteger(value.files) || (value.files as number) < 0 ||
    !Number.isSafeInteger(value.bytes) || (value.bytes as number) < 0 ||
    typeof value.aggregateFingerprint !== "string" || !sha256(value.aggregateFingerprint)
  ) throw invalid();
  return value as unknown as RuntimeMigrationDurableBinding;
}

function bindingsFor(
  files: readonly RuntimeBackupFileRecord[],
  classification: RuntimeBackupFileClassification,
) {
  return Object.freeze(files.filter((file) => file.classification === classification)
    .map((file) => Object.freeze({ relativePath: file.relativePath, sha256: file.sha256 })));
}

function durableBinding(files: readonly RuntimeBackupFileRecord[]): RuntimeMigrationDurableBinding {
  const durable = files.filter((file) => file.classification === "durable-execution");
  return Object.freeze({
    files: durable.length,
    bytes: durable.reduce((sum, file) => sum + file.sizeBytes, 0),
    aggregateFingerprint: aggregateRuntimeFileRecords(durable),
  });
}

function exact(value: Record<string, unknown>, allowed: readonly string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw invalid();
}

function sha256(value: string) { return /^[a-f0-9]{64}$/.test(value); }
function compareText(left: string, right: string) { return left < right ? -1 : left > right ? 1 : 0; }
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function invalid() { return new RuntimeMigrationCandidateError("CANDIDATE_INVALID"); }
function containsHostPath(value: string) {
  return /(?:[a-zA-Z]:[\\/]|\\\\[^\\]+\\|\/(?:Users|home|var|tmp)\/)/.test(value);
}
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value as Record<string, unknown>).forEach(deepFreeze);
  }
  return value;
}

function canonicalManifest(value: RuntimeMigrationCandidateManifest): RuntimeMigrationCandidateManifest {
  const files = value.files.map((file) => ({
    relativePath: file.relativePath,
    type: file.type,
    sizeBytes: file.sizeBytes,
    sha256: file.sha256,
    permissionClass: file.permissionClass,
    ...(file.projectSlug ? { projectSlug: file.projectSlug } : {}),
    classification: file.classification,
    ...(file.git ? { git: file.git.tracked
      ? { tracked: true, blobOid: file.git.blobOid, gitMode: file.git.gitMode }
      : { tracked: false } } : {}),
  })) as RuntimeBackupFileRecord[];
  const classifications = Object.fromEntries(runtimeBackupClassifications.map((classification) =>
    [classification, value.classificationTotals[classification]])) as
      Record<RuntimeBackupFileClassification, number>;
  const markers = value.markerBindings.map((marker) => ({
    relativePath: marker.relativePath,
    sha256: marker.sha256,
  }));
  return {
    schemaVersion: value.schemaVersion,
    candidateFormatVersion: value.candidateFormatVersion,
    candidateId: value.candidateId,
    scopeVersion: value.scopeVersion,
    pathPolicyVersion: value.pathPolicyVersion,
    createdAt: value.createdAt,
    sourceBackup: {
      backupId: value.sourceBackup.backupId,
      manifestSha256: value.sourceBackup.manifestSha256,
      aggregateFingerprint: value.sourceBackup.aggregateFingerprint,
      formatVersion: value.sourceBackup.formatVersion,
      storagePolicyVersion: value.sourceBackup.storagePolicyVersion,
      sourceLogicalIdentity: value.sourceBackup.sourceLogicalIdentity,
      sourceClassification: value.sourceBackup.sourceClassification,
      sourceCreatedAt: value.sourceBackup.sourceCreatedAt,
      ...(value.sourceBackup.sourceHeadCommit
        ? { sourceHeadCommit: value.sourceBackup.sourceHeadCommit }
        : {}),
    },
    sourceRuntimeEvidence: {
      aggregateFingerprint: value.sourceRuntimeEvidence.aggregateFingerprint,
      markerBindings: value.sourceRuntimeEvidence.markerBindings.map((marker) => ({
        relativePath: marker.relativePath,
        sha256: marker.sha256,
      })),
      durableExecutionAggregate: value.sourceRuntimeEvidence.durableExecutionAggregate,
    },
    aggregateAlgorithm: value.aggregateAlgorithm,
    candidateAggregate: value.candidateAggregate,
    inventory: {
      files: value.inventory.files,
      bytes: value.inventory.bytes,
      projects: value.inventory.projects,
      tracked: value.inventory.tracked,
      untracked: value.inventory.untracked,
      classifications,
    },
    files,
    directories: [...value.directories],
    markerBindings: markers,
    durableExecutionBinding: {
      files: value.durableExecutionBinding.files,
      bytes: value.durableExecutionBinding.bytes,
      aggregateFingerprint: value.durableExecutionBinding.aggregateFingerprint,
    },
    classificationTotals: classifications,
    capabilitySummary: {
      contractVersion: value.capabilitySummary.contractVersion,
      destinationClass: value.capabilitySummary.destinationClass,
      filesystemKind: value.capabilitySummary.filesystemKind,
      hostileConcurrentIsolation: false,
      activeProbePerformed: false,
    },
    gitEvidence: {
      ...(value.gitEvidence.headCommit ? { headCommit: value.gitEvidence.headCommit } : {}),
      worktreeProjectsClean: value.gitEvidence.worktreeProjectsClean,
      authority: value.gitEvidence.authority,
    },
    operationEvidence: {
      mode: value.operationEvidence.mode,
      mutationPerformed: value.operationEvidence.mutationPerformed,
      productionCalls: 0,
    },
    verificationStatus: value.verificationStatus,
  };
}
