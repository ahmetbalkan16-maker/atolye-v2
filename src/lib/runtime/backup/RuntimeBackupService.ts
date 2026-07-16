import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  assertPathContained,
  resolveRuntimeStorageContext,
  type RuntimeStorageInput,
} from "@/lib/runtime/RuntimeStoragePaths";
import { GuardedRuntimeFilesystem } from "@/lib/runtime/security/GuardedRuntimeFilesystem";
import type { GuardedRuntimeMutationSession } from "@/lib/runtime/security/GuardedRuntimeMutationSession";
import type { OwnedRuntimeDirectory } from "@/lib/runtime/security/OwnedRuntimeDirectory";
import { RuntimeMutationError } from "@/lib/runtime/security/RuntimeMutationError";
import {
  assertRuntimeMaterializedPath,
  validateRuntimeLogicalPath,
} from "@/lib/runtime/security/RuntimePathPolicy";
import {
  runtimeProtectedRootsFromContext,
  sameRuntimePath,
} from "@/lib/runtime/security/RuntimeProtectedRoots";
import {
  runtimeBackupManifestSha256,
  serializeRuntimeBackupManifest,
  type RuntimeBackupManifest,
} from "./RuntimeBackupManifest";
import {
  collectRuntimeBackupInventory,
  hashStableRuntimeFile,
} from "./RuntimeBackupInventory";
import {
  verifyRuntimeBackup,
  verifyRuntimeTreeAgainstManifest,
  type RuntimeBackupVerificationReport,
} from "./RuntimeBackupVerifier";

export type RuntimeBackupErrorCode =
  | "RUNTIME_BACKUP_PATH_INVALID"
  | "RUNTIME_BACKUP_TARGET_OVERLAP"
  | "RUNTIME_BACKUP_TARGET_EXISTS"
  | "RUNTIME_BACKUP_CREATE_FAILED"
  | "RUNTIME_BACKUP_RESTORE_TARGET_INVALID"
  | "RUNTIME_BACKUP_RESTORE_FAILED";

export class RuntimeBackupError extends Error {
  constructor(readonly code: RuntimeBackupErrorCode) {
    super(messageFor(code));
    this.name = "RuntimeBackupError";
    this.stack = undefined;
  }
}

export interface RuntimeBackupCreateRequest {
  readonly context?: RuntimeStorageInput;
  readonly backupRoot: string;
  readonly repositoryRoot: string;
  readonly projectSlug?: string;
}

export interface RuntimeBackupCreateDependencies {
  readonly now?: () => string;
  readonly backupId?: () => string;
  readonly afterCopyFile?: (
    sourcePath: string,
    destinationPath: string,
    relativePath: string,
  ) => void;
  readonly beforeDestinationWrite?: (
    parentPath: string,
    destinationPath: string,
    relativePath: string,
  ) => void;
}

export interface RuntimeBackupCreateResult {
  readonly backupId: string;
  readonly backupDirectory: string;
  readonly manifest: RuntimeBackupManifest;
  readonly verification: RuntimeBackupVerificationReport;
}

export interface RuntimeBackupRestoreRequest {
  readonly context?: RuntimeStorageInput;
  readonly backupDirectory: string;
  readonly restoreRoot?: string;
  readonly repositoryRoot: string;
  readonly liveProjectsRoot: string;
}

export interface RuntimeBackupRestoreReport {
  readonly valid: true;
  readonly restoreRoot: string;
  readonly aggregateFingerprint: string;
  readonly files: number;
  readonly bytes: number;
  readonly markerFiles: RuntimeBackupVerificationReport["markerFiles"];
}

export interface RuntimeBackupRestoreDependencies {
  readonly afterCopyFile?: (destinationPath: string, relativePath: string) => void;
  readonly beforeDestinationWrite?: (
    parentPath: string,
    destinationPath: string,
    relativePath: string,
  ) => void;
}

export function createVerifiedRuntimeBackup(
  request: RuntimeBackupCreateRequest,
  dependencies: RuntimeBackupCreateDependencies = {},
): RuntimeBackupCreateResult {
  const context = resolveRuntimeStorageContext(request.context ?? {});
  const repositoryRoot = requireExistingAbsoluteDirectory(request.repositoryRoot);
  const backupRoot = validateDestinationRoot(request.backupRoot);
  const restoreVerificationRoot = path.join(
    requireExistingAbsoluteDirectory(os.tmpdir()),
    "atolye-runtime-restore-verification-v1",
  );
  const protectedRoots = runtimeProtectedRootsFromContext({
    context,
    repositoryRoot,
    backupRoot,
    restoreVerificationRoot,
  });
  const createdAt = (dependencies.now ?? (() => new Date().toISOString()))();
  const backupId = dependencies.backupId?.() ??
    `${createdAt.replace(/[:.]/g, "-")}-${randomUUID()}`;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/.test(backupId) || backupId.includes(".partial")) {
    throw new RuntimeBackupError("RUNTIME_BACKUP_PATH_INVALID");
  }

  const guardedFilesystem = new GuardedRuntimeFilesystem(protectedRoots);
  let session: GuardedRuntimeMutationSession | undefined;
  let partial: OwnedRuntimeDirectory | undefined;
  let final: OwnedRuntimeDirectory | undefined;
  let publishReservation: ReturnType<GuardedRuntimeMutationSession["acquireExclusiveReservation"]> | undefined;
  try {
    session = guardedFilesystem.beginMutation({
      writableRoot: backupRoot,
      writableRole: "backup",
      operation: "runtime-backup-create",
    });
    session.ensureDirectory("backups");
    partial = session.createOwnedDirectory(
      `backups/.${createHash("sha256").update(backupId).digest("hex").slice(0, 32)}.${randomUUID().slice(0, 8)}.partial`,
    );
    const payloadProjectsRoot = partial.ensureDirectory("payload/projects");
    const manifest = collectRuntimeBackupInventory({
      context,
      projectSlug: request.projectSlug,
      repositoryRoot,
      now: () => createdAt,
    });
    for (const file of manifest.files) {
      validateRuntimeLogicalPath(file.relativePath);
      assertRuntimeMaterializedPath(payloadProjectsRoot, file.relativePath);
      const source = containedFilePath(context.projectsRoot, file.relativePath);
      const destinationRelative = `payload/projects/${file.relativePath}`;
      const copied = partial.copyFileExclusive(source, destinationRelative, {
        executable: file.permissionClass === "executable",
        beforeWrite: (parentPath, destinationPath) =>
          dependencies.beforeDestinationWrite?.(
            parentPath,
            destinationPath,
            file.relativePath,
          ),
        afterWrite: (destinationPath) => {
          dependencies.afterCopyFile?.(source, destinationPath, file.relativePath);
          return hashStableRuntimeFile(destinationPath, file.relativePath);
        },
      });
      if (!copied || copied.sizeBytes !== file.sizeBytes || copied.sha256 !== file.sha256) {
        throw new RuntimeBackupError("RUNTIME_BACKUP_CREATE_FAILED");
      }
    }
    const sourceAfter = collectRuntimeBackupInventory({
      context,
      projectSlug: request.projectSlug,
      repositoryRoot,
      now: () => createdAt,
    });
    if (
      sourceAfter.aggregateFingerprint !== manifest.aggregateFingerprint ||
      JSON.stringify(sourceAfter.files) !== JSON.stringify(manifest.files)
    ) throw new RuntimeBackupError("RUNTIME_BACKUP_CREATE_FAILED");

    const serialized = serializeRuntimeBackupManifest(manifest);
    partial.writeFileExclusive("manifest.json", serialized, {
      encoding: "utf8",
      mode: 0o600,
    });
    partial.writeFileExclusive(
      "manifest.sha256",
      `${runtimeBackupManifestSha256(serialized)}\n`,
      { encoding: "ascii", mode: 0o600 },
    );
    verifyRuntimeBackup(partial.absolutePath, { allowPartial: true });
    try {
      publishReservation = session.acquireExclusiveReservation(
        `backups/.${backupId}.publish.lock`,
      );
      final = session.createOwnedDirectory(`backups/${backupId}`);
    } catch (error) {
      if (
        error instanceof RuntimeMutationError &&
        error.code === "RUNTIME_MUTATION_TARGET_EXISTS"
      ) throw new RuntimeBackupError("RUNTIME_BACKUP_TARGET_EXISTS");
      throw error;
    }
    publishPartialNoReplace(partial, final, manifest);
    const verification = verifyRuntimeBackup(final.absolutePath);
    requireCleanupCompleted(partial.cleanup());
    final.releaseOwnership();
    requireCleanupCompleted(publishReservation.release());
    requireCleanupCompleted(session.close());
    return Object.freeze({
      backupId,
      backupDirectory: final.absolutePath,
      manifest,
      verification,
    });
  } catch (error) {
    partial?.cleanup();
    final?.cleanup();
    publishReservation?.release();
    session?.close();
    if (error instanceof RuntimeBackupError) throw error;
    if (
      error instanceof RuntimeMutationError &&
      error.code === "RUNTIME_MUTATION_PROTECTED_ROOT_OVERLAP"
    ) throw new RuntimeBackupError("RUNTIME_BACKUP_TARGET_OVERLAP");
    if (
      error instanceof RuntimeMutationError &&
      error.code === "RUNTIME_MUTATION_PATH_INVALID"
    ) throw new RuntimeBackupError("RUNTIME_BACKUP_PATH_INVALID");
    if (
      error instanceof RuntimeMutationError &&
      error.code === "RUNTIME_MUTATION_TARGET_EXISTS"
    ) throw new RuntimeBackupError("RUNTIME_BACKUP_TARGET_EXISTS");
    throw new RuntimeBackupError("RUNTIME_BACKUP_CREATE_FAILED");
  }
}

export function restoreAndVerifyRuntimeBackup(
  request: RuntimeBackupRestoreRequest,
  dependencies: RuntimeBackupRestoreDependencies = {},
): RuntimeBackupRestoreReport {
  const verification = verifyRuntimeBackup(request.backupDirectory);
  const repositoryRoot = requireExistingAbsoluteDirectory(request.repositoryRoot);
  const liveProjectsRoot = requireExistingAbsoluteDirectory(request.liveProjectsRoot);
  const backupDirectory = requireExistingAbsoluteDirectory(request.backupDirectory);
  const protectedBackupRoot = path.basename(path.dirname(backupDirectory)) === "backups"
    ? path.dirname(path.dirname(backupDirectory))
    : backupDirectory;
  const systemTempRoot = requireExistingAbsoluteDirectory(os.tmpdir());
  const inferredRuntimeRoot = path.dirname(liveProjectsRoot);
  const context = resolveRuntimeStorageContext(request.context ?? {
    workspaceRoot: repositoryRoot,
    environment: { ATOLYE_RUNTIME_ROOT: inferredRuntimeRoot },
  });
  if (!sameRuntimePath(context.projectsRoot, liveProjectsRoot)) {
    throw new RuntimeBackupError("RUNTIME_BACKUP_RESTORE_TARGET_INVALID");
  }
  const ownsRestoreRoot = request.restoreRoot === undefined;
  const restoreBase = ownsRestoreRoot
    ? path.join(systemTempRoot, "atolye-runtime-restore-verification-v1")
    : requireExistingAbsoluteDirectory(request.restoreRoot as string);
  if (!inside(systemTempRoot, restoreBase)) {
    throw new RuntimeBackupError("RUNTIME_BACKUP_RESTORE_TARGET_INVALID");
  }
  if (!ownsRestoreRoot && fs.readdirSync(restoreBase).length !== 0) {
    throw new RuntimeBackupError("RUNTIME_BACKUP_RESTORE_TARGET_INVALID");
  }
  const protectedRoots = runtimeProtectedRootsFromContext({
    context,
    repositoryRoot,
    backupRoot: protectedBackupRoot,
    restoreVerificationRoot: restoreBase,
  });
  const guardedFilesystem = new GuardedRuntimeFilesystem(protectedRoots);
  let session: GuardedRuntimeMutationSession | undefined;
  let restoreOwned: OwnedRuntimeDirectory | undefined;
  let projectsOwned: OwnedRuntimeDirectory | undefined;
  try {
    session = guardedFilesystem.beginMutation({
      writableRoot: restoreBase,
      writableRole: "restore-verification",
      operation: "runtime-restore-verify",
    });
    if (ownsRestoreRoot) {
      restoreOwned = session.createOwnedDirectory(`restore-${randomUUID()}`);
    } else {
      projectsOwned = session.createOwnedDirectory("projects");
    }
    const restoreRoot = restoreOwned?.absolutePath ?? restoreBase;
    const restoredProjects = restoreOwned
      ? restoreOwned.ensureDirectory("projects")
      : projectsOwned?.absolutePath;
    if (!restoredProjects) throw new RuntimeBackupError("RUNTIME_BACKUP_RESTORE_FAILED");
    const writeRoot = restoreOwned ?? projectsOwned;
    if (!writeRoot) throw new RuntimeBackupError("RUNTIME_BACKUP_RESTORE_FAILED");
    const payloadProjects = path.join(backupDirectory, "payload", "projects");
    for (const file of verification.manifest.files) {
      validateRuntimeLogicalPath(file.relativePath);
      assertRuntimeMaterializedPath(restoredProjects, file.relativePath);
      const source = containedFilePath(payloadProjects, file.relativePath);
      const destinationRelative = restoreOwned
        ? `projects/${file.relativePath}`
        : file.relativePath;
      const copied = writeRoot.copyFileExclusive(source, destinationRelative, {
        executable: file.permissionClass === "executable",
        beforeWrite: (parentPath, destinationPath) =>
          dependencies.beforeDestinationWrite?.(
            parentPath,
            destinationPath,
            file.relativePath,
          ),
        afterWrite: (destinationPath) => {
          dependencies.afterCopyFile?.(destinationPath, file.relativePath);
          return hashStableRuntimeFile(destinationPath, file.relativePath);
        },
      });
      if (!copied || copied.sizeBytes !== file.sizeBytes || copied.sha256 !== file.sha256) {
        throw new RuntimeBackupError("RUNTIME_BACKUP_RESTORE_FAILED");
      }
    }
    verifyRuntimeTreeAgainstManifest(restoredProjects, verification.manifest);
    const report: RuntimeBackupRestoreReport = Object.freeze({
      valid: true,
      restoreRoot,
      aggregateFingerprint: verification.aggregateFingerprint,
      files: verification.files,
      bytes: verification.bytes,
      markerFiles: verification.markerFiles,
    });
    if (ownsRestoreRoot) {
      requireCleanupCompleted(
        restoreOwned?.cleanup() ?? "failed",
        "RUNTIME_BACKUP_RESTORE_FAILED",
      );
    } else {
      projectsOwned?.releaseOwnership();
    }
    requireCleanupCompleted(session.close(), "RUNTIME_BACKUP_RESTORE_FAILED");
    return report;
  } catch (error) {
    restoreOwned?.cleanup();
    projectsOwned?.cleanup();
    session?.close();
    if (error instanceof RuntimeBackupError) throw error;
    if (
      error instanceof RuntimeMutationError &&
      error.code === "RUNTIME_MUTATION_PROTECTED_ROOT_OVERLAP"
    ) {
      throw new RuntimeBackupError("RUNTIME_BACKUP_RESTORE_TARGET_INVALID");
    }
    throw new RuntimeBackupError("RUNTIME_BACKUP_RESTORE_FAILED");
  }
}

function publishPartialNoReplace(
  partial: OwnedRuntimeDirectory,
  final: OwnedRuntimeDirectory,
  manifest: RuntimeBackupManifest,
) {
  final.ensureDirectory("payload/projects");
  for (const file of manifest.files) {
    const source = containedFilePath(
      path.join(partial.absolutePath, "payload", "projects"),
      file.relativePath,
    );
    final.publishFileExclusive(source, `payload/projects/${file.relativePath}`, {
      executable: file.permissionClass === "executable",
    });
  }
  final.publishFileExclusive(
    path.join(partial.absolutePath, "manifest.json"),
    "manifest.json",
  );
  final.publishFileExclusive(
    path.join(partial.absolutePath, "manifest.sha256"),
    "manifest.sha256",
  );
}

function validateDestinationRoot(value: string) {
  if (
    typeof value !== "string" || !value || value !== value.trim() ||
    !path.isAbsolute(value) || /[\0\r\n]/.test(value)
  ) throw new RuntimeBackupError("RUNTIME_BACKUP_PATH_INVALID");
  const canonical = path.resolve(value);
  if (samePath(canonical, path.parse(canonical).root)) {
    throw new RuntimeBackupError("RUNTIME_BACKUP_PATH_INVALID");
  }
  return canonical;
}

function requireExistingAbsoluteDirectory(value: string) {
  const canonical = validateDestinationRoot(value);
  try {
    const link = fs.lstatSync(canonical);
    const real = fs.realpathSync(canonical);
    if (link.isSymbolicLink() || !link.isDirectory() || !samePath(real, canonical)) {
      throw new Error("invalid");
    }
    return real;
  } catch {
    throw new RuntimeBackupError("RUNTIME_BACKUP_PATH_INVALID");
  }
}

function containedFilePath(root: string, relativePath: string) {
  if (!relativePath || relativePath.includes("\\") || relativePath.startsWith("/")) {
    throw new RuntimeBackupError("RUNTIME_BACKUP_PATH_INVALID");
  }
  const target = path.resolve(root, ...relativePath.split("/"));
  assertPathContained(root, target);
  return target;
}

function inside(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return Boolean(relative) &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative);
}

function samePath(left: string, right: string) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function requireCleanupCompleted(
  status: string,
  errorCode: RuntimeBackupErrorCode = "RUNTIME_BACKUP_CREATE_FAILED",
) {
  if (status !== "completed" && status !== "not-required") {
    throw new RuntimeBackupError(errorCode);
  }
}

function messageFor(code: RuntimeBackupErrorCode) {
  switch (code) {
    case "RUNTIME_BACKUP_TARGET_OVERLAP": return "Runtime backup target overlaps a protected root.";
    case "RUNTIME_BACKUP_TARGET_EXISTS": return "Runtime backup target already exists.";
    case "RUNTIME_BACKUP_CREATE_FAILED": return "Runtime backup creation failed.";
    case "RUNTIME_BACKUP_RESTORE_TARGET_INVALID": return "Runtime backup restore target is invalid.";
    case "RUNTIME_BACKUP_RESTORE_FAILED": return "Runtime backup restore verification failed.";
    default: return "Runtime backup path is invalid.";
  }
}
