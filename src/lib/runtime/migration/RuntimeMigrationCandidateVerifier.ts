import fs from "node:fs";
import path from "node:path";
import {
  runtimeBackupAggregateVersion,
  runtimeBackupFormatVersion,
  runtimeBackupManifestSchemaVersion,
  type RuntimeBackupManifest,
} from "@/lib/runtime/backup/RuntimeBackupManifest";
import { verifyRuntimeBackup, verifyRuntimeTreeAgainstManifest } from "@/lib/runtime/backup/RuntimeBackupVerifier";
import { assertRuntimeMaterializedPath } from "@/lib/runtime/security/RuntimePathPolicy";
import {
  minimalRuntimeDirectoryClosure,
  runtimeMigrationCandidateManifestSha256,
  serializeRuntimeMigrationCandidateManifest,
  validateRuntimeMigrationCandidateManifest,
  type RuntimeMigrationCandidateManifest,
} from "./RuntimeMigrationCandidateManifest";
import {
  migrationCandidateError,
  RuntimeMigrationCandidateError,
} from "./RuntimeMigrationCandidateError";

export interface RuntimeMigrationCandidateVerificationReport {
  readonly valid: true;
  readonly candidateId: string;
  readonly manifest: RuntimeMigrationCandidateManifest;
  readonly manifestSha256: string;
  readonly aggregateFingerprint: string;
  readonly files: number;
  readonly bytes: number;
  readonly markerBindings: RuntimeMigrationCandidateManifest["markerBindings"];
  readonly durableExecutionBinding: RuntimeMigrationCandidateManifest["durableExecutionBinding"];
  readonly cutoverAuthorized: false;
}

export function verifyMigrationCandidate(
  candidateDirectory: string,
): RuntimeMigrationCandidateVerificationReport {
  try {
    const candidateRoot = requireAbsoluteDirectory(candidateDirectory);
    if (path.basename(candidateRoot).includes(".partial")) {
      throw new RuntimeMigrationCandidateError("CANDIDATE_INVALID");
    }
    requireExactEntries(candidateRoot, ["candidate.json", "candidate.sha256", "payload"]);
    const manifestPath = path.join(candidateRoot, "candidate.json");
    const digestPath = path.join(candidateRoot, "candidate.sha256");
    const payloadRoot = path.join(candidateRoot, "payload");
    const projectsRoot = path.join(payloadRoot, "projects");
    requireRegularFile(manifestPath);
    requireRegularFile(digestPath);
    requireAbsoluteDirectory(payloadRoot);
    requireExactEntries(payloadRoot, ["projects"]);
    requireAbsoluteDirectory(projectsRoot);

    const serialized = fs.readFileSync(manifestPath, "utf8");
    const expectedDigest = fs.readFileSync(digestPath, "utf8");
    if (!/^[a-f0-9]{64}\n$/.test(expectedDigest)) {
      throw new RuntimeMigrationCandidateError("CANDIDATE_DIGEST_MISMATCH");
    }
    const actualDigest = runtimeMigrationCandidateManifestSha256(serialized);
    if (actualDigest !== expectedDigest.trim()) {
      throw new RuntimeMigrationCandidateError("CANDIDATE_DIGEST_MISMATCH");
    }
    let manifest: unknown;
    try { manifest = JSON.parse(serialized); } catch {
      throw new RuntimeMigrationCandidateError("CANDIDATE_INVALID");
    }
    validateRuntimeMigrationCandidateManifest(manifest);
    if (serializeRuntimeMigrationCandidateManifest(manifest) !== serialized) {
      throw new RuntimeMigrationCandidateError("CANDIDATE_INVALID");
    }
    if (path.basename(candidateRoot) !== manifest.candidateId) {
      throw new RuntimeMigrationCandidateError("CANDIDATE_ID_MISMATCH");
    }
    const topology = inspectProjectsTree(projectsRoot);
    if (JSON.stringify(topology.directories) !== JSON.stringify(manifest.directories)) {
      throw new RuntimeMigrationCandidateError("INVENTORY_MISMATCH");
    }
    const expectedDirectories = minimalRuntimeDirectoryClosure(manifest.files);
    if (JSON.stringify(topology.directories) !== JSON.stringify(expectedDirectories)) {
      throw new RuntimeMigrationCandidateError("INVENTORY_MISMATCH");
    }
    try {
      for (const file of manifest.files) {
        assertRuntimeMaterializedPath(projectsRoot, file.relativePath);
      }
    } catch {
      throw new RuntimeMigrationCandidateError("PATH_POLICY_VIOLATION");
    }
    try {
      verifyRuntimeTreeAgainstManifest(projectsRoot, asBackupManifest(manifest));
    } catch {
      throw new RuntimeMigrationCandidateError("INVENTORY_MISMATCH");
    }
    return Object.freeze({
      valid: true,
      candidateId: manifest.candidateId,
      manifest,
      manifestSha256: actualDigest,
      aggregateFingerprint: manifest.candidateAggregate,
      files: manifest.inventory.files,
      bytes: manifest.inventory.bytes,
      markerBindings: manifest.markerBindings,
      durableExecutionBinding: manifest.durableExecutionBinding,
      cutoverAuthorized: false,
    });
  } catch (error) {
    throw migrationCandidateError(error, "CANDIDATE_INVALID");
  }
}

export function verifyMigrationCandidateBinding(
  candidateDirectory: string,
  backupDirectory: string,
) {
  const candidate = verifyMigrationCandidate(candidateDirectory);
  let backup;
  try { backup = verifyRuntimeBackup(backupDirectory); } catch {
    throw new RuntimeMigrationCandidateError("BACKUP_INVALID");
  }
  const source = candidate.manifest.sourceBackup;
  if (
    source.backupId !== path.basename(path.resolve(backupDirectory)) ||
    source.manifestSha256 !== backup.manifestSha256 ||
    source.aggregateFingerprint !== backup.aggregateFingerprint ||
    canonicalJson(candidate.manifest.files) !== canonicalJson(backup.manifest.files) ||
    canonicalJson(candidate.manifest.inventory) !== canonicalJson(backup.manifest.inventory)
  ) throw new RuntimeMigrationCandidateError("BACKUP_INVALID");
  return Object.freeze({
    valid: true as const,
    candidateId: candidate.candidateId,
    sourceBackupManifestSha256: backup.manifestSha256,
    aggregateFingerprint: backup.aggregateFingerprint,
    cutoverAuthorized: false as const,
  });
}

function asBackupManifest(candidate: RuntimeMigrationCandidateManifest): RuntimeBackupManifest {
  return {
    schemaVersion: runtimeBackupManifestSchemaVersion,
    backupFormatVersion: runtimeBackupFormatVersion,
    aggregateAlgorithm: runtimeBackupAggregateVersion,
    storagePolicyVersion: candidate.sourceBackup.storagePolicyVersion as RuntimeBackupManifest["storagePolicyVersion"],
    createdAt: candidate.sourceBackup.sourceCreatedAt,
    sourceLogicalIdentity: "projects",
    sourceClassification: candidate.sourceBackup.sourceClassification,
    sourceProjectsRootLogicalName: "projects",
    ...(candidate.sourceBackup.sourceHeadCommit
      ? { sourceHeadCommit: candidate.sourceBackup.sourceHeadCommit }
      : {}),
    aggregateFingerprint: candidate.candidateAggregate,
    inventory: candidate.inventory,
    files: candidate.files,
  };
}

function inspectProjectsTree(projectsRoot: string) {
  const directories: string[] = [];
  const walk = (directory: string) => {
    const entries = fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => compareText(a.name, b.name));
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      const link = fs.lstatSync(target);
      if (link.isSymbolicLink()) throw new RuntimeMigrationCandidateError("UNSUPPORTED_FILE_TYPE");
      const relative = path.relative(projectsRoot, target).split(path.sep).join("/");
      if (link.isDirectory()) {
        const real = fs.realpathSync(target);
        if (!samePath(real, target)) throw new RuntimeMigrationCandidateError("UNSUPPORTED_FILE_TYPE");
        directories.push(relative);
        walk(target);
      } else if (!link.isFile()) {
        throw new RuntimeMigrationCandidateError("UNSUPPORTED_FILE_TYPE");
      }
    }
  };
  walk(projectsRoot);
  return { directories: Object.freeze(directories.sort(compareText)) };
}

function requireAbsoluteDirectory(value: string) {
  if (typeof value !== "string" || !path.isAbsolute(value)) {
    throw new RuntimeMigrationCandidateError("INVALID_ARGUMENT");
  }
  const canonical = path.resolve(value);
  const link = fs.lstatSync(canonical);
  const real = fs.realpathSync(canonical);
  if (link.isSymbolicLink() || !link.isDirectory() || !samePath(real, canonical)) {
    throw new RuntimeMigrationCandidateError("UNSUPPORTED_FILE_TYPE");
  }
  return real;
}

function requireRegularFile(value: string) {
  const link = fs.lstatSync(value);
  const real = fs.realpathSync(value);
  if (link.isSymbolicLink() || !link.isFile() || !samePath(real, value)) {
    throw new RuntimeMigrationCandidateError("UNSUPPORTED_FILE_TYPE");
  }
}

function requireExactEntries(directory: string, expected: readonly string[]) {
  const actual = fs.readdirSync(directory).sort(compareText);
  const wanted = [...expected].sort(compareText);
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new RuntimeMigrationCandidateError("CANDIDATE_INVALID");
  }
}

function samePath(left: string, right: string) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}
function compareText(left: string, right: string) { return left < right ? -1 : left > right ? 1 : 0; }
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort(compareText)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
