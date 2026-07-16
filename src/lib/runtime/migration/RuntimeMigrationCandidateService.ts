import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { RuntimeStorageContext } from "@/lib/runtime/RuntimeStoragePaths";
import { hashStableRuntimeFile } from "@/lib/runtime/backup/RuntimeBackupInventory";
import type { RuntimeBackupVerificationReport } from "@/lib/runtime/backup/RuntimeBackupVerifier";
import {
  verifyRuntimeBackup,
  verifyRuntimeTreeAgainstManifest,
} from "@/lib/runtime/backup/RuntimeBackupVerifier";
import { GuardedRuntimeFilesystem } from "@/lib/runtime/security/GuardedRuntimeFilesystem";
import type { GuardedRuntimeMutationSession } from "@/lib/runtime/security/GuardedRuntimeMutationSession";
import type { OwnedRuntimeDirectory } from "@/lib/runtime/security/OwnedRuntimeDirectory";
import { RuntimeMutationError } from "@/lib/runtime/security/RuntimeMutationError";
import { assertRuntimeMaterializedPath } from "@/lib/runtime/security/RuntimePathPolicy";
import { runtimeCandidateProtectedRootsFromContext } from "@/lib/runtime/security/RuntimeProtectedRoots";
import {
  buildRuntimeMigrationCandidateManifest,
  runtimeMigrationCandidateIdentitySha256,
  runtimeMigrationCandidateManifestSha256,
  runtimeMigrationCandidatePolicySha256,
  serializeRuntimeMigrationCandidateManifest,
  validateRuntimeMigrationCandidateManifest,
} from "./RuntimeMigrationCandidateManifest";
import {
  migrationCandidateError,
  RuntimeMigrationCandidateError,
} from "./RuntimeMigrationCandidateError";
import { preflightRuntimeMigrationCandidate } from "./RuntimeMigrationCandidatePreflight";
import {
  verifyMigrationCandidate,
  verifyMigrationCandidateBinding,
  type RuntimeMigrationCandidateVerificationReport,
} from "./RuntimeMigrationCandidateVerifier";

export interface RuntimeMigrationCandidateCreateRequest {
  readonly context: RuntimeStorageContext;
  readonly repositoryRoot: string;
  readonly backupRoot: string;
  readonly backupDirectory: string;
  readonly candidateRoot: string;
  readonly restoreVerificationRoot: string;
  readonly confirmCandidateCreation: true;
  readonly allowTestTempRoot?: boolean;
}

export interface RuntimeMigrationCandidateCreateDependencies {
  readonly now?: () => string;
  readonly randomId?: () => string;
  readonly beforeCopyFile?: (sourcePath: string, relativePath: string) => void;
  readonly afterCopyFile?: (destinationPath: string, relativePath: string) => void;
  readonly beforePublishFile?: (relativePath: string) => void;
  readonly afterFinalPublish?: (candidateDirectory: string) => void;
  readonly beforePartialCleanup?: () => void;
  readonly beforeReservationRelease?: () => void;
  readonly beforeSessionClose?: () => void;
  readonly observeMutation?: (event: RuntimeMigrationCandidateMutationEvent) => void;
  readonly beforePreflight?: () => void;
  readonly beforeBackupVerification?: () => void;
  readonly beforeProtectedRoots?: () => void;
  readonly beforeSessionOpen?: () => void;
  readonly beforeFinalFreshness?: () => void;
}

export type RuntimeMigrationCandidateMutationEvent =
  | "session-begin"
  | "partial-create"
  | "payload-copy"
  | "manifest-write"
  | "digest-write"
  | "publish-reservation-acquire"
  | "final-create"
  | "final-publish"
  | "partial-cleanup"
  | "final-release"
  | "publish-reservation-release"
  | "session-close";

export interface RuntimeMigrationCandidateReadiness {
  readonly candidateReady: true;
  readonly candidateCreated: boolean;
  readonly candidateReused: boolean;
  readonly candidateId: string;
  readonly candidateLocator: string;
  readonly manifestSha256: string;
  readonly sourceBackupManifestSha256: string;
  readonly policyVersion: string;
  readonly verification: RuntimeMigrationCandidateVerificationReport;
  readonly cutoverAuthorized: false;
}

export class RuntimeMigrationCandidateService {
  static createVerifiedMigrationCandidate(
    request: RuntimeMigrationCandidateCreateRequest,
    dependencies: RuntimeMigrationCandidateCreateDependencies = {},
  ): RuntimeMigrationCandidateReadiness {
    try {
      return createVerifiedMigrationCandidateInternal(request, dependencies);
    } catch (error) {
      throw migrationCandidateError(error, "CANDIDATE_CREATE_FAILED");
    }
  }
}

function createVerifiedMigrationCandidateInternal(
  request: RuntimeMigrationCandidateCreateRequest,
  dependencies: RuntimeMigrationCandidateCreateDependencies,
): RuntimeMigrationCandidateReadiness {
    if (request.confirmCandidateCreation !== true) {
      throw new RuntimeMigrationCandidateError("INVALID_ARGUMENT");
    }

    dependencies.beforePreflight?.();
    const preflight = preflightRuntimeMigrationCandidate({
      ...request,
      now: dependencies.now,
    });
    dependencies.beforeBackupVerification?.();
    const backup = verifyBackup(request.backupDirectory);
    const finalDirectory = preflight.pathPlan.candidateDirectory;
    const expectedManifest = buildExpectedCandidateManifest(
      preflight,
      backup,
      request.backupDirectory,
    );
    const expectedIdentitySha256 = runtimeMigrationCandidateIdentitySha256(expectedManifest);
    const expectedPolicySha256 = runtimeMigrationCandidatePolicySha256(expectedManifest);

    if (hasConflictingOperationEvidence(
      preflight.pathPlan.candidateRoot,
      preflight.candidateId,
    )) {
      throw new RuntimeMigrationCandidateError("CANDIDATE_RECOVERY_REQUIRED");
    }

    if (fs.existsSync(finalDirectory)) {
      return reuseExistingCandidate(
        finalDirectory,
        request.backupDirectory,
        backup.manifestSha256,
        expectedIdentitySha256,
        expectedPolicySha256,
      );
    }

    dependencies.beforeProtectedRoots?.();
    const protectedRoots = runtimeCandidateProtectedRootsFromContext({
      context: request.context,
      repositoryRoot: request.repositoryRoot,
      backupRoot: request.backupRoot,
      restoreVerificationRoot: request.restoreVerificationRoot,
      candidateRoot: preflight.pathPlan.candidateRoot,
    });
    const guardedFilesystem = new GuardedRuntimeFilesystem(protectedRoots);
    let session: GuardedRuntimeMutationSession | undefined;
    let partial: OwnedRuntimeDirectory | undefined;
    let final: OwnedRuntimeDirectory | undefined;
    let publishReservation:
      ReturnType<GuardedRuntimeMutationSession["acquireExclusiveReservation"]> | undefined;
    let partialCleaned = false;
    let finalReleased = false;
    let reservationReleased = false;
    let sessionClosed = false;

    try {
      dependencies.beforeSessionOpen?.();
      observe(dependencies, "session-begin");
      session = guardedFilesystem.beginMutation({
        writableRoot: preflight.pathPlan.candidateRoot,
        writableRole: "candidate",
        operation: "migration-candidate-create",
      });
      session.ensureDirectory("candidates");
      const randomId = (dependencies.randomId ?? randomUUID)();
      if (!/^[a-fA-F0-9-]{8,64}$/.test(randomId)) {
        throw new RuntimeMigrationCandidateError("INVALID_ARGUMENT");
      }
      observe(dependencies, "partial-create");
      partial = session.createOwnedDirectory(
        `candidates/.${randomId.slice(0, 8)}.partial`,
      );
      const stagedCandidateDirectory = partial.absolutePath;
      const stagedProjectsRoot = partial.ensureDirectory("payload/projects");
      const backupProjectsRoot = path.join(request.backupDirectory, "payload", "projects");

      for (const file of backup.manifest.files) {
        assertRuntimeMaterializedPath(stagedProjectsRoot, file.relativePath);
        const source = containedBackupFile(backupProjectsRoot, file.relativePath);
        assertFileMatches(source, file.relativePath, file.sizeBytes, file.sha256);
        dependencies.beforeCopyFile?.(source, file.relativePath);
        observe(dependencies, "payload-copy");
        const copied = partial.copyFileExclusive(
          source,
          `payload/projects/${file.relativePath}`,
          {
            executable: file.permissionClass === "executable",
            afterWrite: (destinationPath) => {
              dependencies.afterCopyFile?.(destinationPath, file.relativePath);
              return hashStableRuntimeFile(destinationPath, file.relativePath);
            },
          },
        );
        if (!copied || copied.sizeBytes !== file.sizeBytes || copied.sha256 !== file.sha256) {
          throw new RuntimeMigrationCandidateError("CANDIDATE_CREATE_FAILED");
        }
        assertFileMatches(source, file.relativePath, file.sizeBytes, file.sha256);
      }

      const manifest = expectedManifest;
      const serialized = serializeRuntimeMigrationCandidateManifest(manifest);
      observe(dependencies, "manifest-write");
      partial.writeFileExclusive("candidate.json", serialized, {
        encoding: "utf8",
        mode: 0o600,
      });
      observe(dependencies, "digest-write");
      partial.writeFileExclusive(
        "candidate.sha256",
        `${runtimeMigrationCandidateManifestSha256(serialized)}\n`,
        { encoding: "ascii", mode: 0o600 },
      );
      verifyStagedMigrationCandidate(
        stagedCandidateDirectory,
        preflight.candidateId,
        backup,
        path.basename(path.resolve(request.backupDirectory)),
      );
      verifyBackup(request.backupDirectory);

      try {
        observe(dependencies, "publish-reservation-acquire");
        publishReservation = session.acquireExclusiveReservation(
          `candidates/.${preflight.candidateId}.publish.lock`,
        );
        observe(dependencies, "final-create");
        final = session.createOwnedDirectory(`candidates/${preflight.candidateId}`);
      } catch (error) {
        if (isTargetExists(error)) {
          throw new RuntimeMigrationCandidateError("CANDIDATE_RECOVERY_REQUIRED");
        }
        throw error;
      }

      publishCandidateNoClobber(
        final,
        stagedCandidateDirectory,
        manifest.files,
        dependencies,
      );
      dependencies.afterFinalPublish?.(final.absolutePath);
      const verification = verifyMigrationCandidate(final.absolutePath);
      verifyMigrationCandidateBinding(final.absolutePath, request.backupDirectory);
      verifyBackup(request.backupDirectory);
      dependencies.beforeFinalFreshness?.();
      preflightRuntimeMigrationCandidate({ ...request, now: dependencies.now });

      dependencies.beforePartialCleanup?.();
      observe(dependencies, "partial-cleanup");
      requireCleanupCompleted(partial.cleanup());
      partialCleaned = true;
      observe(dependencies, "final-release");
      final.releaseOwnership();
      finalReleased = true;
      dependencies.beforeReservationRelease?.();
      observe(dependencies, "publish-reservation-release");
      requireCleanupCompleted(publishReservation.release());
      reservationReleased = true;
      dependencies.beforeSessionClose?.();
      observe(dependencies, "session-close");
      requireCleanupCompleted(session.close());
      sessionClosed = true;
      return readiness(verification, backup.manifestSha256, true);
    } catch (error) {
      let recoveryRequired = final !== undefined || isTargetExists(error) ||
        requiresMutationRecovery(error);
      let lifecycleFailed = false;
      if (final && !finalReleased) {
        try {
          observe(dependencies, "final-release");
          final.releaseOwnership();
          finalReleased = true;
        } catch {
          recoveryRequired = true;
          lifecycleFailed = true;
        }
      }
      if (partial && !partialCleaned && !lifecycleFailed) {
        try {
          dependencies.beforePartialCleanup?.();
          observe(dependencies, "partial-cleanup");
          const status = partial.cleanup();
          partialCleaned = completed(status);
          if (!partialCleaned) {
            recoveryRequired = true;
            lifecycleFailed = true;
          }
        } catch {
          recoveryRequired = true;
          lifecycleFailed = true;
        }
      }
      if (publishReservation && !reservationReleased && !lifecycleFailed) {
        try {
          dependencies.beforeReservationRelease?.();
          observe(dependencies, "publish-reservation-release");
          const status = publishReservation.release();
          reservationReleased = completed(status);
          if (!reservationReleased) {
            recoveryRequired = true;
            lifecycleFailed = true;
          }
        } catch {
          recoveryRequired = true;
          lifecycleFailed = true;
        }
      }
      if (session && !sessionClosed && !lifecycleFailed && (!final || finalReleased)) {
        try {
          dependencies.beforeSessionClose?.();
          observe(dependencies, "session-close");
          const status = session.close();
          sessionClosed = completed(status);
          if (!sessionClosed) recoveryRequired = true;
        } catch {
          recoveryRequired = true;
        }
      }
      if (recoveryRequired) {
        throw new RuntimeMigrationCandidateError("CANDIDATE_RECOVERY_REQUIRED");
      }
      if (error instanceof RuntimeMigrationCandidateError) throw error;
      throw migrationCandidateError(error, "CANDIDATE_CREATE_FAILED");
    }
}

function buildExpectedCandidateManifest(
  preflight: ReturnType<typeof preflightRuntimeMigrationCandidate>,
  backup: RuntimeBackupVerificationReport,
  backupDirectory: string,
) {
  return buildRuntimeMigrationCandidateManifest({
    backupId: path.basename(path.resolve(backupDirectory)),
    backup,
    createdAt: preflight.candidateManifestPlan.createdAt,
    sourceRuntimeEvidence: preflight.candidateManifestPlan.sourceRuntimeEvidence,
    capabilitySummary: preflight.candidateManifestPlan.capabilitySummary,
    gitEvidence: preflight.candidateManifestPlan.gitEvidence,
    operationEvidence: {
      mode: "candidate-create",
      mutationPerformed: true,
      productionCalls: 0,
    },
  });
}

function reuseExistingCandidate(
  candidateDirectory: string,
  backupDirectory: string,
  sourceBackupManifestSha256: string,
  expectedIdentitySha256: string,
  expectedPolicySha256: string,
) {
  try {
    const verification = verifyMigrationCandidate(candidateDirectory);
    verifyMigrationCandidateBinding(candidateDirectory, backupDirectory);
    if (
      runtimeMigrationCandidateIdentitySha256(verification.manifest) !== expectedIdentitySha256 ||
      runtimeMigrationCandidatePolicySha256(verification.manifest) !== expectedPolicySha256
    ) throw new RuntimeMigrationCandidateError("CANDIDATE_RECOVERY_REQUIRED");
    return readiness(verification, sourceBackupManifestSha256, false);
  } catch {
    throw new RuntimeMigrationCandidateError("CANDIDATE_RECOVERY_REQUIRED");
  }
}

function publishCandidateNoClobber(
  final: OwnedRuntimeDirectory,
  stagedCandidateDirectory: string,
  files: readonly { readonly relativePath: string; readonly permissionClass: string }[],
  dependencies: RuntimeMigrationCandidateCreateDependencies,
) {
  final.ensureDirectory("payload/projects");
  for (const file of files) {
    dependencies.beforePublishFile?.(file.relativePath);
    observe(dependencies, "final-publish");
    final.publishFileExclusive(
      path.join(stagedCandidateDirectory, "payload", "projects", ...file.relativePath.split("/")),
      `payload/projects/${file.relativePath}`,
      { executable: file.permissionClass === "executable" },
    );
  }
  for (const name of ["candidate.json", "candidate.sha256"] as const) {
    dependencies.beforePublishFile?.(name);
    observe(dependencies, "final-publish");
    final.publishFileExclusive(path.join(stagedCandidateDirectory, name), name);
  }
}

function readiness(
  verification: RuntimeMigrationCandidateVerificationReport,
  sourceBackupManifestSha256: string,
  created: boolean,
): RuntimeMigrationCandidateReadiness {
  return Object.freeze({
    candidateReady: true,
    candidateCreated: created,
    candidateReused: !created,
    candidateId: verification.candidateId,
    candidateLocator: `candidates/${verification.candidateId}`,
    manifestSha256: verification.manifestSha256,
    sourceBackupManifestSha256,
    policyVersion: verification.manifest.pathPolicyVersion,
    verification,
    cutoverAuthorized: false,
  });
}

function verifyBackup(backupDirectory: string) {
  try {
    return verifyRuntimeBackup(backupDirectory);
  } catch {
    throw new RuntimeMigrationCandidateError("BACKUP_INVALID");
  }
}

function containedBackupFile(root: string, relativePath: string) {
  const target = path.resolve(root, ...relativePath.split("/"));
  const relative = path.relative(path.resolve(root), target);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new RuntimeMigrationCandidateError("BACKUP_INVALID");
  }
  return target;
}

function assertFileMatches(
  source: string,
  relativePath: string,
  sizeBytes: number,
  sha256: string,
) {
  try {
    const actual = hashStableRuntimeFile(source, relativePath);
    if (actual.sizeBytes !== sizeBytes || actual.sha256 !== sha256) throw new Error("mismatch");
  } catch {
    throw new RuntimeMigrationCandidateError("BACKUP_INVALID");
  }
}

function requireCleanupCompleted(status: string) {
  if (!completed(status)) {
    throw new RuntimeMigrationCandidateError("CANDIDATE_RECOVERY_REQUIRED");
  }
}

function completed(status: string) {
  return status === "completed" || status === "not-required";
}

function requiresMutationRecovery(error: unknown) {
  return error instanceof RuntimeMutationError && (
    error.code === "RUNTIME_MUTATION_OWNERSHIP_MISMATCH" ||
    !completed(error.cleanupStatus) ||
    !completed(error.closeStatus)
  );
}

function observe(
  dependencies: RuntimeMigrationCandidateCreateDependencies,
  event: RuntimeMigrationCandidateMutationEvent,
) {
  dependencies.observeMutation?.(event);
}

function hasConflictingOperationEvidence(candidateRoot: string, candidateId: string) {
  try {
    if (pathEntryExists(path.join(
      candidateRoot,
      ".runtime-mutation-migration-candidate-create.lock",
    ))) return true;
    const candidatesRoot = path.join(candidateRoot, "candidates");
    if (!pathEntryExists(candidatesRoot)) return false;
    const root = fs.lstatSync(candidatesRoot);
    if (root.isSymbolicLink() || !root.isDirectory()) return true;
    const expectedReservation = `.${candidateId}.publish.lock`;
    return fs.readdirSync(candidatesRoot).some((name) =>
      name === expectedReservation ||
      name.endsWith(".partial") ||
      /^\.candidate-[a-f0-9]{64}\.publish\.lock$/.test(name));
  } catch {
    return true;
  }
}

function pathEntryExists(value: string) {
  try {
    fs.lstatSync(value);
    return true;
  } catch (error) {
    return !(error instanceof Error && "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT");
  }
}

function verifyStagedMigrationCandidate(
  candidateDirectory: string,
  expectedCandidateId: string,
  backup: RuntimeBackupVerificationReport,
  expectedBackupId: string,
) {
  try {
    const root = requireStagingDirectory(candidateDirectory);
    requireExactStagingEntries(root, ["candidate.json", "candidate.sha256", "payload"]);
    const manifestPath = path.join(root, "candidate.json");
    const digestPath = path.join(root, "candidate.sha256");
    const payloadRoot = requireStagingDirectory(path.join(root, "payload"));
    requireExactStagingEntries(payloadRoot, ["projects"]);
    const projectsRoot = requireStagingDirectory(path.join(payloadRoot, "projects"));
    requireStagingFile(manifestPath);
    requireStagingFile(digestPath);
    const serialized = fs.readFileSync(manifestPath, "utf8");
    const digest = fs.readFileSync(digestPath, "utf8");
    if (!/^[a-f0-9]{64}\n$/.test(digest) ||
      runtimeMigrationCandidateManifestSha256(serialized) !== digest.trim()) {
      throw new Error("invalid");
    }
    const manifest: unknown = JSON.parse(serialized);
    validateRuntimeMigrationCandidateManifest(manifest);
    if (
      manifest.candidateId !== expectedCandidateId ||
      serializeRuntimeMigrationCandidateManifest(manifest) !== serialized ||
      manifest.sourceBackup.backupId !== expectedBackupId ||
      manifest.sourceBackup.manifestSha256 !== backup.manifestSha256 ||
      manifest.sourceBackup.aggregateFingerprint !== backup.aggregateFingerprint ||
      JSON.stringify(manifest.files) !== JSON.stringify(backup.manifest.files) ||
      JSON.stringify(manifest.inventory) !== JSON.stringify(backup.manifest.inventory)
    ) throw new Error("invalid");
    const directories = inspectStagingDirectories(projectsRoot);
    if (JSON.stringify(directories) !== JSON.stringify(manifest.directories)) {
      throw new Error("invalid");
    }
    verifyRuntimeTreeAgainstManifest(projectsRoot, backup.manifest);
  } catch {
    throw new RuntimeMigrationCandidateError("CANDIDATE_CREATE_FAILED");
  }
}

function requireStagingDirectory(value: string) {
  const canonical = path.resolve(value);
  const link = fs.lstatSync(canonical);
  const real = fs.realpathSync(canonical);
  if (link.isSymbolicLink() || !link.isDirectory() || !samePath(real, canonical)) {
    throw new Error("invalid");
  }
  return real;
}

function requireStagingFile(value: string) {
  const link = fs.lstatSync(value);
  const real = fs.realpathSync(value);
  if (link.isSymbolicLink() || !link.isFile() || !samePath(real, value)) {
    throw new Error("invalid");
  }
}

function requireExactStagingEntries(directory: string, expected: readonly string[]) {
  const actual = fs.readdirSync(directory).sort(compareText);
  if (JSON.stringify(actual) !== JSON.stringify([...expected].sort(compareText))) {
    throw new Error("invalid");
  }
}

function inspectStagingDirectories(projectsRoot: string) {
  const directories: string[] = [];
  const walk = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      const link = fs.lstatSync(target);
      if (link.isSymbolicLink()) throw new Error("invalid");
      if (link.isDirectory()) {
        if (!samePath(fs.realpathSync(target), target)) throw new Error("invalid");
        directories.push(path.relative(projectsRoot, target).split(path.sep).join("/"));
        walk(target);
      } else if (!link.isFile()) {
        throw new Error("invalid");
      }
    }
  };
  walk(projectsRoot);
  return directories.sort(compareText);
}

function samePath(left: string, right: string) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isTargetExists(error: unknown) {
  return error instanceof RuntimeMutationError &&
    error.code === "RUNTIME_MUTATION_TARGET_EXISTS";
}
