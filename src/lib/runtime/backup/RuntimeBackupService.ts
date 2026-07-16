import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  assertPathContained,
  ensureSafeContainedDirectory,
  ensureSafeDirectory,
  resolveRuntimeStorageContext,
  type RuntimeStorageInput,
} from "@/lib/runtime/RuntimeStoragePaths";
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
  assertNoOverlap(backupRoot, repositoryRoot);
  assertNoOverlap(backupRoot, context.projectsRoot);
  const createdAt = (dependencies.now ?? (() => new Date().toISOString()))();
  const backupId = dependencies.backupId?.() ??
    `${createdAt.replace(/[:.]/g, "-")}-${randomUUID()}`;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/.test(backupId) || backupId.includes(".partial")) {
    throw new RuntimeBackupError("RUNTIME_BACKUP_PATH_INVALID");
  }

  ensureSafeDirectory(backupRoot);
  const backupsRoot = path.join(backupRoot, "backups");
  ensureSafeContainedDirectory(backupRoot, backupsRoot);
  const finalRoot = path.join(backupsRoot, backupId);
  const partialRoot = path.join(backupsRoot, `.${backupId}.${randomUUID()}.partial`);
  const publishLock = path.join(backupsRoot, `.${backupId}.publish.lock`);
  let lockDescriptor: number | undefined;
  let finalRootOwned = false;
  try {
    fs.mkdirSync(partialRoot);
    const payloadRoot = path.join(partialRoot, "payload");
    const payloadProjectsRoot = path.join(payloadRoot, "projects");
    ensureSafeContainedDirectory(partialRoot, payloadRoot);
    ensureSafeContainedDirectory(payloadRoot, payloadProjectsRoot);
    const manifest = collectRuntimeBackupInventory({
      context,
      projectSlug: request.projectSlug,
      repositoryRoot,
      now: () => createdAt,
    });
    for (const file of manifest.files) {
      const source = containedFilePath(context.projectsRoot, file.relativePath);
      const destination = containedFilePath(payloadProjectsRoot, file.relativePath);
      ensureSafeContainedDirectory(payloadProjectsRoot, path.dirname(destination));
      const copied = copyFileExclusiveGuarded({
        source,
        destination,
        containmentRoot: payloadProjectsRoot,
        relativePath: file.relativePath,
        executable: file.permissionClass === "executable",
        beforeWrite: dependencies.beforeDestinationWrite,
        afterCopy: () => dependencies.afterCopyFile?.(source, destination, file.relativePath),
      });
      if (copied.sizeBytes !== file.sizeBytes || copied.sha256 !== file.sha256) {
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
    fs.writeFileSync(path.join(partialRoot, "manifest.json"), serialized, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    fs.writeFileSync(
      path.join(partialRoot, "manifest.sha256"),
      `${runtimeBackupManifestSha256(serialized)}\n`,
      { encoding: "ascii", flag: "wx", mode: 0o600 },
    );
    verifyRuntimeBackup(partialRoot, { allowPartial: true });
    try {
      lockDescriptor = fs.openSync(publishLock, "wx", 0o600);
    } catch {
      throw new RuntimeBackupError("RUNTIME_BACKUP_TARGET_EXISTS");
    }
    try {
      createDirectoryExclusiveGuarded(backupsRoot, finalRoot);
      finalRootOwned = true;
    } catch {
      throw new RuntimeBackupError("RUNTIME_BACKUP_TARGET_EXISTS");
    }
    publishPartialNoReplace(partialRoot, finalRoot, manifest);
    const verification = verifyRuntimeBackup(finalRoot);
    cleanupOwnedPartial(backupsRoot, partialRoot);
    return Object.freeze({ backupId, backupDirectory: finalRoot, manifest, verification });
  } catch (error) {
    cleanupOwnedPartial(backupsRoot, partialRoot);
    if (finalRootOwned) cleanupOwnedPartial(backupsRoot, finalRoot);
    if (error instanceof RuntimeBackupError) throw error;
    throw new RuntimeBackupError("RUNTIME_BACKUP_CREATE_FAILED");
  } finally {
    if (lockDescriptor !== undefined) {
      try { fs.closeSync(lockDescriptor); } catch { /* best effort */ }
      try { fs.rmSync(publishLock, { force: true }); } catch { /* stale lock remains fail-closed */ }
    }
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
  const systemTempRoot = requireExistingAbsoluteDirectory(os.tmpdir());
  const ownsRestoreRoot = request.restoreRoot === undefined;
  const restoreRoot = request.restoreRoot === undefined
    ? fs.mkdtempSync(path.join(systemTempRoot, "atolye-runtime-restore-verify-"))
    : requireExistingAbsoluteDirectory(request.restoreRoot);
  if (!inside(systemTempRoot, restoreRoot)) {
    if (ownsRestoreRoot) cleanupOwnedPartial(systemTempRoot, restoreRoot);
    throw new RuntimeBackupError("RUNTIME_BACKUP_RESTORE_TARGET_INVALID");
  }
  if (fs.readdirSync(restoreRoot).length !== 0) {
    throw new RuntimeBackupError("RUNTIME_BACKUP_RESTORE_TARGET_INVALID");
  }
  assertNoOverlap(restoreRoot, repositoryRoot);
  assertNoOverlap(restoreRoot, liveProjectsRoot);
  assertNoOverlap(restoreRoot, backupDirectory);
  const restoredProjects = path.join(restoreRoot, "projects");
  try {
    fs.mkdirSync(restoredProjects);
    const payloadProjects = path.join(backupDirectory, "payload", "projects");
    for (const file of verification.manifest.files) {
      const source = containedFilePath(payloadProjects, file.relativePath);
      const destination = containedFilePath(restoredProjects, file.relativePath);
      ensureSafeContainedDirectory(restoredProjects, path.dirname(destination));
      const copied = copyFileExclusiveGuarded({
        source,
        destination,
        containmentRoot: restoredProjects,
        relativePath: file.relativePath,
        executable: file.permissionClass === "executable",
        beforeWrite: dependencies.beforeDestinationWrite,
        afterCopy: () => dependencies.afterCopyFile?.(destination, file.relativePath),
      });
      if (copied.sizeBytes !== file.sizeBytes || copied.sha256 !== file.sha256) {
        throw new RuntimeBackupError("RUNTIME_BACKUP_RESTORE_FAILED");
      }
    }
    verifyRuntimeTreeAgainstManifest(restoredProjects, verification.manifest);
    return Object.freeze({
      valid: true,
      restoreRoot,
      aggregateFingerprint: verification.aggregateFingerprint,
      files: verification.files,
      bytes: verification.bytes,
      markerFiles: verification.markerFiles,
    });
  } catch (error) {
    cleanupOwnedPartial(restoreRoot, restoredProjects);
    if (error instanceof RuntimeBackupError) throw error;
    throw new RuntimeBackupError("RUNTIME_BACKUP_RESTORE_FAILED");
  } finally {
    if (ownsRestoreRoot) cleanupOwnedPartial(systemTempRoot, restoreRoot);
  }
}

interface GuardedCopyRequest {
  readonly source: string;
  readonly destination: string;
  readonly containmentRoot: string;
  readonly relativePath: string;
  readonly executable: boolean;
  readonly beforeWrite?: (
    parentPath: string,
    destinationPath: string,
    relativePath: string,
  ) => void;
  readonly afterCopy?: () => void;
}

function copyFileExclusiveGuarded(request: GuardedCopyRequest) {
  return guardedExclusiveDestination(
    request.containmentRoot,
    request.destination,
    false,
    () => request.beforeWrite?.(
      path.dirname(request.destination),
      request.destination,
      request.relativePath,
    ),
    () => fs.copyFileSync(
      request.source,
      request.destination,
      fs.constants.COPYFILE_EXCL,
    ),
    () => {
      if (request.executable) fs.chmodSync(request.destination, 0o700);
      request.afterCopy?.();
      return hashStableRuntimeFile(request.destination, request.relativePath);
    },
  );
}

function publishPartialNoReplace(
  partialRoot: string,
  finalRoot: string,
  manifest: RuntimeBackupManifest,
) {
  const payloadRoot = path.join(finalRoot, "payload");
  const projectsRoot = path.join(payloadRoot, "projects");
  createDirectoryExclusiveGuarded(finalRoot, payloadRoot);
  createDirectoryExclusiveGuarded(payloadRoot, projectsRoot);
  for (const file of manifest.files) {
    const source = containedFilePath(
      path.join(partialRoot, "payload", "projects"),
      file.relativePath,
    );
    const destination = containedFilePath(projectsRoot, file.relativePath);
    ensureDirectoryTreeExclusive(projectsRoot, path.dirname(destination));
    linkFileExclusiveGuarded(projectsRoot, source, destination);
  }
  linkFileExclusiveGuarded(
    finalRoot,
    path.join(partialRoot, "manifest.json"),
    path.join(finalRoot, "manifest.json"),
  );
  linkFileExclusiveGuarded(
    finalRoot,
    path.join(partialRoot, "manifest.sha256"),
    path.join(finalRoot, "manifest.sha256"),
  );
}

function ensureDirectoryTreeExclusive(root: string, target: string) {
  if (samePath(root, target)) return;
  assertPathContained(root, target);
  let current = root;
  for (const segment of path.relative(root, target).split(path.sep)) {
    const next = path.join(current, segment);
    if (fs.existsSync(next)) {
      requireStableDirectory(root, next);
    } else {
      createDirectoryExclusiveGuarded(current, next);
    }
    current = next;
  }
}

function createDirectoryExclusiveGuarded(parentRoot: string, destination: string) {
  guardedExclusiveDestination(
    parentRoot,
    destination,
    true,
    undefined,
    () => fs.mkdirSync(destination),
    () => undefined,
  );
}

function linkFileExclusiveGuarded(root: string, source: string, destination: string) {
  guardedExclusiveDestination(
    root,
    destination,
    false,
    undefined,
    () => fs.linkSync(source, destination),
    () => undefined,
  );
}

function guardedExclusiveDestination<T>(
  containmentRoot: string,
  destination: string,
  recursiveCleanup: boolean,
  beforeWrite: (() => void) | undefined,
  operation: () => void,
  afterWrite: () => T,
) {
  const parent = path.dirname(destination);
  const snapshot = requireStableDirectory(containmentRoot, parent);
  beforeWrite?.();
  let created = false;
  let createdRealPath: string | undefined;
  try {
    operation();
    created = true;
    createdRealPath = path.join(fs.realpathSync(parent), path.basename(destination));
    assertStableDirectory(snapshot);
    const result = afterWrite();
    assertStableDirectory(snapshot);
    return result;
  } catch (error) {
    if (created && createdRealPath) {
      try { fs.rmSync(createdRealPath, { recursive: recursiveCleanup, force: true }); } catch { /* best effort */ }
    }
    throw error;
  }
}

interface StableDirectorySnapshot {
  readonly path: string;
  readonly realPath: string;
  readonly stat: fs.BigIntStats;
}

function requireStableDirectory(root: string, directory: string): StableDirectorySnapshot {
  if (!samePath(root, directory)) assertPathContained(root, directory);
  const stat = fs.lstatSync(directory, { bigint: true });
  const realPath = fs.realpathSync(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory() || !samePath(realPath, directory)) {
    throw new RuntimeBackupError("RUNTIME_BACKUP_PATH_INVALID");
  }
  return { path: directory, realPath, stat };
}

function assertStableDirectory(snapshot: StableDirectorySnapshot) {
  const current = fs.lstatSync(snapshot.path, { bigint: true });
  const realPath = fs.realpathSync(snapshot.path);
  if (
    current.isSymbolicLink() ||
    !current.isDirectory() ||
    !samePath(realPath, snapshot.realPath) ||
    current.dev !== snapshot.stat.dev ||
    current.ino !== snapshot.stat.ino ||
    current.mode !== snapshot.stat.mode
  ) throw new RuntimeBackupError("RUNTIME_BACKUP_PATH_INVALID");
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

function assertNoOverlap(left: string, right: string) {
  if (samePath(left, right) || inside(left, right) || inside(right, left)) {
    throw new RuntimeBackupError("RUNTIME_BACKUP_TARGET_OVERLAP");
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

function cleanupOwnedPartial(parent: string, target: string) {
  try {
    if (!fs.existsSync(target) || !inside(parent, target)) return;
    const link = fs.lstatSync(target);
    if (link.isSymbolicLink() || !link.isDirectory()) return;
    const real = fs.realpathSync(target);
    if (!samePath(real, target) || !inside(parent, real)) return;
    fs.rmSync(target, { recursive: true, force: true });
  } catch {
    // Cleanup never broadens beyond the owned bounded partial root.
  }
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
