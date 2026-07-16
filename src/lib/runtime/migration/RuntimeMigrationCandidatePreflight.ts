import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { RuntimeStorageContext } from "@/lib/runtime/RuntimeStoragePaths";
import { collectRuntimeBackupInventory } from "@/lib/runtime/backup/RuntimeBackupInventory";
import { aggregateRuntimeFileRecords, type RuntimeBackupFileRecord } from "@/lib/runtime/backup/RuntimeBackupManifest";
import { verifyRuntimeBackup } from "@/lib/runtime/backup/RuntimeBackupVerifier";
import { assertRuntimeMaterializedPath } from "@/lib/runtime/security/RuntimePathPolicy";
import {
  canonicalRuntimePath,
  runtimePathInside,
  sameRuntimePath,
} from "@/lib/runtime/security/RuntimeProtectedRoots";
import {
  buildRuntimeMigrationCandidateManifest,
  runtimeMigrationCandidateId,
  type RuntimeMigrationCandidateManifest,
} from "./RuntimeMigrationCandidateManifest";
import { RuntimeMigrationCandidateError } from "./RuntimeMigrationCandidateError";
import {
  isUnsupportedNetworkCandidateRoot,
  planMigrationCandidatePaths,
} from "./RuntimeMigrationCandidatePaths";

export interface RuntimeMigrationCandidatePreflightReport {
  readonly status: "preflight-ready";
  readonly candidateId: string;
  readonly candidateManifestPlan: RuntimeMigrationCandidateManifest;
  readonly pathPlan: ReturnType<typeof planMigrationCandidatePaths>;
  readonly backupVerified: true;
  readonly sourceFresh: true;
  readonly markerBindingVerified: true;
  readonly durableExecutionBindingVerified: true;
  readonly worktreeProjectsClean: true;
  readonly capabilityClassification: "local-persistent" | "test-temp";
  readonly activeCapabilityProbePerformed: false;
  readonly productionCalls: 0;
  readonly cutoverAuthorized: false;
}

export function preflightRuntimeMigrationCandidate(input: {
  readonly context: RuntimeStorageContext;
  readonly repositoryRoot: string;
  readonly backupRoot: string;
  readonly backupDirectory: string;
  readonly candidateRoot: string;
  readonly restoreVerificationRoot: string;
  readonly allowTestTempRoot?: boolean;
  readonly now?: () => string;
}): RuntimeMigrationCandidatePreflightReport {
  if (!input.backupDirectory) throw new RuntimeMigrationCandidateError("BACKUP_REQUIRED");
  if (!path.isAbsolute(input.backupDirectory) || !path.isAbsolute(input.candidateRoot)) {
    throw new RuntimeMigrationCandidateError("INVALID_ARGUMENT");
  }
  if (isUnsupportedNetworkCandidateRoot(input.candidateRoot)) {
    throw new RuntimeMigrationCandidateError("CAPABILITY_UNSUPPORTED");
  }
  let backupRoot: string;
  let backupDirectory: string;
  let candidateRoot: string;
  try {
    backupRoot = canonicalRuntimePath(input.backupRoot);
    backupDirectory = canonicalRuntimePath(input.backupDirectory);
  } catch {
    throw new RuntimeMigrationCandidateError("BACKUP_INVALID");
  }
  try {
    candidateRoot = canonicalRuntimePath(input.candidateRoot);
  } catch {
    throw new RuntimeMigrationCandidateError("DESTINATION_INVALID");
  }
  if (!runtimePathInside(backupRoot, backupDirectory)) {
    throw new RuntimeMigrationCandidateError("BACKUP_INVALID");
  }
  if (pathsOverlap(candidateRoot, backupDirectory)) {
    throw new RuntimeMigrationCandidateError("DESTINATION_INVALID");
  }
  let backup;
  try { backup = verifyRuntimeBackup(backupDirectory); } catch {
    throw new RuntimeMigrationCandidateError("BACKUP_INVALID");
  }
  if (backup.manifest.sourceLogicalIdentity !== "projects") {
    throw new RuntimeMigrationCandidateError("BACKUP_INVALID");
  }
  const candidateId = runtimeMigrationCandidateId({
    sourceBackupManifestSha256: backup.manifestSha256,
    sourceBackupAggregate: backup.aggregateFingerprint,
  });
  const pathPlan = planMigrationCandidatePaths({
    candidateId,
    candidateRoot,
    context: input.context,
    repositoryRoot: input.repositoryRoot,
    backupRoot,
    backupDirectory,
    restoreVerificationRoot: input.restoreVerificationRoot,
    allowTestTempRoot: input.allowTestTempRoot,
  });
  try {
    for (const file of backup.manifest.files) {
      assertRuntimeMaterializedPath(pathPlan.projectsRoot, file.relativePath);
    }
  } catch {
    throw new RuntimeMigrationCandidateError("PATH_POLICY_VIOLATION");
  }
  const capability = classifyReadOnlyCapability(pathPlan.candidateRoot, Boolean(input.allowTestTempRoot));
  const live = collectRuntimeBackupInventory({
    context: input.context,
    repositoryRoot: input.repositoryRoot,
    now: input.now,
  });
  if (JSON.stringify(treeIdentity(live.files)) !== JSON.stringify(treeIdentity(backup.manifest.files)) ||
      live.aggregateFingerprint !== backup.aggregateFingerprint ||
      (backup.manifest.sourceHeadCommit !== undefined &&
        live.sourceHeadCommit !== backup.manifest.sourceHeadCommit)) {
    throw new RuntimeMigrationCandidateError("SOURCE_STALE");
  }
  const liveMarkers = bindings(live.files, "acceptance-marker");
  const backupMarkers = bindings(backup.manifest.files, "acceptance-marker");
  const liveDurable = durableAggregate(live.files);
  const backupDurable = durableAggregate(backup.manifest.files);
  if (JSON.stringify(liveMarkers) !== JSON.stringify(backupMarkers) || liveDurable !== backupDurable) {
    throw new RuntimeMigrationCandidateError("CRITICAL_STATE_MISMATCH");
  }
  const worktreeProjectsClean = cleanProjectsWorktree(input.repositoryRoot);
  if (!worktreeProjectsClean) throw new RuntimeMigrationCandidateError("SOURCE_STALE");
  const backupId = path.basename(backupDirectory);
  const candidateManifestPlan = buildRuntimeMigrationCandidateManifest({
    backupId,
    backup,
    createdAt: (input.now ?? (() => new Date().toISOString()))(),
    sourceRuntimeEvidence: {
      aggregateFingerprint: live.aggregateFingerprint,
      markerBindings: liveMarkers,
      durableExecutionAggregate: liveDurable,
    },
    capabilitySummary: {
      contractVersion: "migration-candidate-capability-v1",
      destinationClass: capability,
      filesystemKind: filesystemKind(pathPlan.candidateRoot),
      hostileConcurrentIsolation: false,
      activeProbePerformed: false,
    },
    gitEvidence: {
      ...(live.sourceHeadCommit ? { headCommit: live.sourceHeadCommit } : {}),
      worktreeProjectsClean: true,
      authority: "informational-only",
    },
    operationEvidence: {
      mode: "preflight-contract",
      mutationPerformed: false,
      productionCalls: 0,
    },
  });
  return Object.freeze({
    status: "preflight-ready",
    candidateId,
    candidateManifestPlan,
    pathPlan,
    backupVerified: true,
    sourceFresh: true,
    markerBindingVerified: true,
    durableExecutionBindingVerified: true,
    worktreeProjectsClean: true,
    capabilityClassification: capability,
    activeCapabilityProbePerformed: false,
    productionCalls: 0,
    cutoverAuthorized: false,
  });
}

function classifyReadOnlyCapability(root: string, allowTestTempRoot: boolean) {
  if (isUnsupportedNetworkCandidateRoot(root)) {
    throw new RuntimeMigrationCandidateError("CAPABILITY_UNSUPPORTED");
  }
  if (insideOrEqual(os.tmpdir(), root)) {
    if (!allowTestTempRoot) throw new RuntimeMigrationCandidateError("CAPABILITY_UNSUPPORTED");
    return "test-temp" as const;
  }
  if (process.platform === "win32") {
    return classifyWindowsDriveTypeEvidence(readWindowsDriveTypeEvidence(root), filesystemKind(root));
  }
  const kind = filesystemKind(root);
  if (kind.endsWith("-unknown") || knownNetworkFilesystem(kind)) {
    throw new RuntimeMigrationCandidateError("CAPABILITY_UNSUPPORTED");
  }
  return "local-persistent" as const;
}

export function classifyWindowsDriveTypeEvidence(
  value: unknown,
  filesystemKindEvidence = "win32-unknown",
) {
  void filesystemKindEvidence;
  if (value === "Fixed") return "local-persistent" as const;
  throw new RuntimeMigrationCandidateError("CAPABILITY_UNSUPPORTED");
}

export function readWindowsDriveTypeEvidence(root: string): string {
  const driveRoot = path.parse(root).root;
  if (!/^[a-zA-Z]:\\$/.test(driveRoot)) {
    throw new RuntimeMigrationCandidateError("CAPABILITY_UNSUPPORTED");
  }
  const script = "& { param([string]$driveRoot) [Console]::Out.Write(([System.IO.DriveInfo]::new($driveRoot)).DriveType.ToString()) }";
  try {
    const output = execFileSync("powershell.exe", [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      script,
      driveRoot,
    ], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5_000,
      maxBuffer: 1_024,
    });
    const driveType = output.trim();
    if (!/^(?:Fixed|Network|Removable|CDRom|Ram|NoRootDirectory|Unknown)$/.test(driveType)) {
      throw new RuntimeMigrationCandidateError("CAPABILITY_UNSUPPORTED");
    }
    return driveType;
  } catch (error) {
    if (error instanceof RuntimeMigrationCandidateError) throw error;
    throw new RuntimeMigrationCandidateError("CAPABILITY_UNSUPPORTED");
  }
}

function filesystemKind(root: string) {
  try {
    const type = fs.statfsSync(root).type;
    return `${process.platform}-${type}`.toLowerCase();
  } catch {
    return `${process.platform}-unknown`;
  }
}

function knownNetworkFilesystem(kind: string) {
  return ["-26985", "-2800", "-1369957889", "-1073741824"].some((value) => kind.endsWith(value));
}

function bindings(files: readonly RuntimeBackupFileRecord[], classification: string) {
  return files.filter((file) => file.classification === classification)
    .map((file) => ({ relativePath: file.relativePath, sha256: file.sha256 }));
}

function durableAggregate(files: readonly RuntimeBackupFileRecord[]) {
  return aggregateRuntimeFileRecords(files.filter((file) => file.classification === "durable-execution"));
}

function treeIdentity(files: readonly RuntimeBackupFileRecord[]) {
  return files.map((file) => ({
    relativePath: file.relativePath,
    sizeBytes: file.sizeBytes,
    sha256: file.sha256,
    permissionClass: file.permissionClass,
    projectSlug: file.projectSlug,
    classification: file.classification,
  }));
}

function cleanProjectsWorktree(repositoryRoot: string) {
  try {
    const output = execFileSync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", "data/projects"], {
      cwd: repositoryRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return output.length === 0;
  } catch {
    throw new RuntimeMigrationCandidateError("INVALID_ARGUMENT");
  }
}

function insideOrEqual(root: string, candidate: string) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return !relative || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function pathsOverlap(left: string, right: string) {
  return sameRuntimePath(left, right) ||
    runtimePathInside(left, right) ||
    runtimePathInside(right, left);
}
