import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { GuardedRuntimeFilesystem } from "@/lib/runtime/security/GuardedRuntimeFilesystem";
import { RuntimeMutationError } from "@/lib/runtime/security/RuntimeMutationError";
import { runtimeProtectedRootsFromContext } from "@/lib/runtime/security/RuntimeProtectedRoots";
import { decodeStrictRuntimeDto } from "@/lib/runtime/security/StrictRuntimeDto";
import {
  assertTrustedRuntimeBackupStorageAuthority,
  type RuntimeBackupStorageAuthority,
} from "./RuntimeBackupAuthority";
import {
  runtimeBackupFormatVersion,
  runtimeBackupManifestSchemaVersion,
  type RuntimeBackupManifest,
} from "./RuntimeBackupManifest";
import {
  verifyRuntimeBackup,
  type RuntimeBackupVerificationReport,
} from "./RuntimeBackupVerifier";
import { validateRuntimeBackupMutationRelativePath } from "./RuntimeBackupPathPolicy";

export type RuntimeBackupErrorCode =
  | "RUNTIME_BACKUP_PATH_INVALID"
  | "RUNTIME_BACKUP_TARGET_OVERLAP"
  | "RUNTIME_BACKUP_TARGET_EXISTS"
  | "RUNTIME_BACKUP_CREATE_FAILED"
  | "RUNTIME_BACKUP_AUTHORITY_UNAVAILABLE"
  | "RUNTIME_BACKUP_AUTHORITY_MISMATCH"
  | "RUNTIME_BACKUP_RESTORE_TARGET_INVALID"
  | "RUNTIME_BACKUP_RESTORE_FAILED"
  | "RUNTIME_BACKUP_CLEANUP_REQUIRED";

export class RuntimeBackupError extends Error {
  constructor(readonly code: RuntimeBackupErrorCode) {
    super(messageFor(code));
    this.name = "RuntimeBackupError";
    this.stack = undefined;
  }
}

export interface RuntimeBackupCreateRequest {
  readonly authority: RuntimeBackupStorageAuthority;
  readonly projectSlug?: string;
}

export interface RuntimeBackupCreateDependencies {
  readonly backupId?: string;
}

export interface RuntimeBackupCreateResult {
  readonly backupId: string;
  readonly backupDirectory: string;
  readonly manifest: RuntimeBackupManifest;
  readonly verification: RuntimeBackupVerificationReport;
}

export interface RuntimeBackupRestoreRequest {
  readonly authority: RuntimeBackupStorageAuthority;
  readonly backupId: string;
  readonly projectSlug?: string;
}

export interface PortableRuntimeBackupVerificationRequest {
  readonly authority: RuntimeBackupStorageAuthority;
  readonly backupDirectory: string;
}

export interface RuntimeBackupRestoreReport {
  readonly valid: true;
  readonly restoreRoot: string;
  readonly aggregateFingerprint: string;
  readonly files: number;
  readonly bytes: number;
  readonly markerFiles: RuntimeBackupVerificationReport["markerFiles"];
}

export interface PortableRuntimeBackupVerificationReport extends RuntimeBackupRestoreReport {
  readonly sourceSchemaVersion: RuntimeBackupManifest["schemaVersion"];
  readonly sourceRuntimeAuthorityId?: string;
  readonly currentRuntimeBound: false;
}

export function createVerifiedRuntimeBackup(
  rawRequest: RuntimeBackupCreateRequest,
  rawDependencies: RuntimeBackupCreateDependencies = {},
): RuntimeBackupCreateResult {
  const request = decodeCreateRequest(rawRequest);
  const dependencies = decodeCreateDependencies(rawDependencies);
  const authority = request.authority;
  const context = authority.context;
  const repositoryRoot = requireExistingAbsoluteDirectory(context.workspaceRoot);
  const backupRoot = authority.canonicalBackupRoot;
  const backupId = dependencies.backupId ??
    `b-${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  validateBackupId(backupId, backupRoot);
  const protectedRoots = protectedRootsFor(authority);
  const guardedFilesystem = new GuardedRuntimeFilesystem(protectedRoots);
  try {
    const result = guardedFilesystem.createVerifiedRuntimeBackup({
      context,
      repositoryRoot,
      backupRoot,
      projectSlug: request.projectSlug,
      backupId,
      runtimeAuthorityId: authority.runtimeAuthorityId,
    });
    return Object.freeze({ backupId, ...result });
  } catch (error) {
    throw normalizeCreateError(error);
  }
}

export function restoreAndVerifyRuntimeBackup(
  rawRequest: RuntimeBackupRestoreRequest,
): RuntimeBackupRestoreReport {
  const request = decodeRestoreRequest(rawRequest);
  const authority = request.authority;
  const backupId = request.backupId;
  validateBackupId(backupId, authority.canonicalBackupRoot);
  const backupDirectory = exactBackupDirectory(authority, backupId);
  const expectedProjectIdentity = request.projectSlug
    ? `projects/${request.projectSlug}`
    : "projects";
  const verification = verifyRuntimeBackup(backupDirectory);
  if (
    verification.manifest.schemaVersion !== runtimeBackupManifestSchemaVersion ||
    verification.manifest.backupFormatVersion !== runtimeBackupFormatVersion ||
    !verification.manifest.sourceRuntimeAuthority
  ) throw new RuntimeBackupError("RUNTIME_BACKUP_AUTHORITY_UNAVAILABLE");
  if (
    verification.manifest.sourceRuntimeAuthority.runtimeAuthorityId !== authority.runtimeAuthorityId ||
    verification.manifest.sourceRuntimeAuthority.projectIdentity !== expectedProjectIdentity
  ) throw new RuntimeBackupError("RUNTIME_BACKUP_AUTHORITY_MISMATCH");
  return materializeAndVerify({
    authority,
    backupDirectory,
    portable: false,
    expectedRuntimeAuthorityId: authority.runtimeAuthorityId,
    expectedProjectIdentity,
  });
}

export function portableVerifyRuntimeBackup(
  rawRequest: PortableRuntimeBackupVerificationRequest,
): PortableRuntimeBackupVerificationReport {
  const request = decodePortableRequest(rawRequest);
  const backupDirectory = requireExistingAbsoluteDirectory(request.backupDirectory);
  const standalone = verifyRuntimeBackup(backupDirectory);
  const restored = materializeAndVerify({
    authority: request.authority,
    backupDirectory,
    portable: true,
  });
  return Object.freeze({
    ...restored,
    sourceSchemaVersion: standalone.manifest.schemaVersion,
    ...(standalone.manifest.sourceRuntimeAuthority
      ? { sourceRuntimeAuthorityId: standalone.manifest.sourceRuntimeAuthority.runtimeAuthorityId }
      : {}),
    currentRuntimeBound: false,
  });
}

function materializeAndVerify(input: {
  readonly authority: RuntimeBackupStorageAuthority;
  readonly backupDirectory: string;
  readonly portable: boolean;
  readonly expectedRuntimeAuthorityId?: string;
  readonly expectedProjectIdentity?: string;
}): RuntimeBackupRestoreReport {
  const restoreBase = path.join(requireExistingAbsoluteDirectory(os.tmpdir()), ".arv3");
  const guardedFilesystem = new GuardedRuntimeFilesystem(runtimeProtectedRootsFromContext({
    context: input.authority.context,
    repositoryRoot: requireExistingAbsoluteDirectory(input.authority.context.workspaceRoot),
    backupRoot: input.authority.canonicalBackupRoot,
    restoreVerificationRoot: restoreBase,
  }));
  try {
    const restored = guardedFilesystem.restoreVerifiedRuntimeBackup({
      backupDirectory: input.backupDirectory,
      restoreBase,
      ownsRestoreRoot: true,
      portable: input.portable,
      ...(input.portable ? {} : {
        expectedRuntimeAuthorityId: input.expectedRuntimeAuthorityId,
        expectedProjectIdentity: input.expectedProjectIdentity,
      }),
    });
    return Object.freeze({
      valid: true,
      restoreRoot: restored.restoreRoot,
      aggregateFingerprint: restored.verification.aggregateFingerprint,
      files: restored.verification.files,
      bytes: restored.verification.bytes,
      markerFiles: restored.verification.markerFiles,
    });
  } catch (error) {
    if (error instanceof RuntimeBackupError) throw error;
    if (error instanceof RuntimeMutationError &&
      (error.cleanupStatus !== "not-required" || error.closeStatus !== "not-required")) {
      throw new RuntimeBackupError("RUNTIME_BACKUP_CLEANUP_REQUIRED");
    }
    throw new RuntimeBackupError("RUNTIME_BACKUP_RESTORE_FAILED");
  }
}

function protectedRootsFor(authority: RuntimeBackupStorageAuthority) {
  return runtimeProtectedRootsFromContext({
    context: authority.context,
    repositoryRoot: requireExistingAbsoluteDirectory(authority.context.workspaceRoot),
    backupRoot: authority.canonicalBackupRoot,
    restoreVerificationRoot: path.join(requireExistingAbsoluteDirectory(os.tmpdir()), ".arv3"),
  });
}

function decodeCreateRequest(value: unknown): RuntimeBackupCreateRequest {
  const dto = decodeStrictRuntimeDto(value, ["authority", "projectSlug"] as const, invalidRequest);
  requireTrustedAuthority(dto.authority);
  if (dto.projectSlug !== undefined &&
    (typeof dto.projectSlug !== "string" || !/^[a-zA-Z0-9-_]+$/.test(dto.projectSlug))) {
    throw invalidRequest();
  }
  return dto as unknown as RuntimeBackupCreateRequest;
}

function decodeCreateDependencies(value: unknown): RuntimeBackupCreateDependencies {
  const dto = decodeStrictRuntimeDto(value, ["backupId"] as const, invalidRequest);
  if (dto.backupId !== undefined && typeof dto.backupId !== "string") throw invalidRequest();
  return dto as RuntimeBackupCreateDependencies;
}

function decodeRestoreRequest(value: unknown): RuntimeBackupRestoreRequest {
  const dto = decodeStrictRuntimeDto(
    value,
    ["authority", "backupId", "projectSlug"] as const,
    invalidRequest,
  );
  requireTrustedAuthority(dto.authority);
  if (typeof dto.backupId !== "string" ||
    (dto.projectSlug !== undefined &&
      (typeof dto.projectSlug !== "string" || !/^[a-zA-Z0-9-_]+$/.test(dto.projectSlug)))) {
    throw invalidRequest();
  }
  return dto as unknown as RuntimeBackupRestoreRequest;
}

function decodePortableRequest(value: unknown): PortableRuntimeBackupVerificationRequest {
  const dto = decodeStrictRuntimeDto(
    value,
    ["authority", "backupDirectory"] as const,
    invalidRequest,
  );
  requireTrustedAuthority(dto.authority);
  if (typeof dto.backupDirectory !== "string") throw invalidRequest();
  return dto as unknown as PortableRuntimeBackupVerificationRequest;
}

function exactBackupDirectory(authority: RuntimeBackupStorageAuthority, backupId: string) {
  const target = path.resolve(authority.canonicalBackupRoot, "backups", backupId);
  const expected = path.join(authority.canonicalBackupRoot, "backups", backupId);
  if (!samePath(target, expected)) throw invalidRequest();
  return requireExistingAbsoluteDirectory(target);
}

function requireTrustedAuthority(
  value: unknown,
): asserts value is RuntimeBackupStorageAuthority {
  try {
    assertTrustedRuntimeBackupStorageAuthority(value);
  } catch {
    throw invalidRequest();
  }
}

function validateBackupId(value: string, backupRoot: string) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/.test(value) ||
    value.includes(".partial")) throw invalidRequest();
  try {
    validateRuntimeBackupMutationRelativePath(`backups/${value}`, backupRoot);
    validateRuntimeBackupMutationRelativePath(`backups/.${value}.publish.lock`, backupRoot);
  } catch {
    throw invalidRequest();
  }
}

function requireExistingAbsoluteDirectory(value: string) {
  if (typeof value !== "string" || !path.isAbsolute(value)) throw invalidRequest();
  const canonical = path.resolve(value);
  try {
    const link = fs.lstatSync(canonical);
    const real = fs.realpathSync(canonical);
    if (link.isSymbolicLink() || !link.isDirectory() || !samePath(real, canonical)) throw invalidRequest();
    return real;
  } catch (error) {
    if (error instanceof RuntimeBackupError) throw error;
    throw invalidRequest();
  }
}

function normalizeCreateError(error: unknown) {
  if (error instanceof RuntimeBackupError) return error;
  if (error instanceof RuntimeMutationError) {
    if (error.cleanupStatus !== "not-required" || error.closeStatus !== "not-required") {
      return new RuntimeBackupError("RUNTIME_BACKUP_CLEANUP_REQUIRED");
    }
    if (error.code === "RUNTIME_MUTATION_PROTECTED_ROOT_OVERLAP") {
      return new RuntimeBackupError("RUNTIME_BACKUP_TARGET_OVERLAP");
    }
    if (error.code === "RUNTIME_MUTATION_PATH_INVALID") return invalidRequest();
    if (error.code === "RUNTIME_MUTATION_TARGET_EXISTS") {
      return new RuntimeBackupError("RUNTIME_BACKUP_TARGET_EXISTS");
    }
  }
  return new RuntimeBackupError("RUNTIME_BACKUP_CREATE_FAILED");
}

function samePath(left: string, right: string) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function invalidRequest() {
  return new RuntimeBackupError("RUNTIME_BACKUP_PATH_INVALID");
}

function messageFor(code: RuntimeBackupErrorCode) {
  switch (code) {
    case "RUNTIME_BACKUP_TARGET_OVERLAP": return "Runtime backup target overlaps a protected root.";
    case "RUNTIME_BACKUP_TARGET_EXISTS": return "Runtime backup target already exists.";
    case "RUNTIME_BACKUP_CREATE_FAILED": return "Runtime backup creation failed.";
    case "RUNTIME_BACKUP_AUTHORITY_UNAVAILABLE": return "Runtime backup authority is unavailable.";
    case "RUNTIME_BACKUP_AUTHORITY_MISMATCH": return "Runtime backup authority does not match.";
    case "RUNTIME_BACKUP_RESTORE_TARGET_INVALID": return "Runtime backup restore target is invalid.";
    case "RUNTIME_BACKUP_RESTORE_FAILED": return "Runtime backup restore verification failed.";
    case "RUNTIME_BACKUP_CLEANUP_REQUIRED": return "Runtime backup cleanup requires recovery.";
    default: return "Runtime backup path is invalid.";
  }
}
