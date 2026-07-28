import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  assertPathContained,
  ensureSafeDirectory,
  type RuntimeStorageContext,
} from "@/lib/runtime/RuntimeStoragePaths";
import {
  OwnedRuntimeDirectory,
  type OwnedRuntimeDirectoryAdapter,
  type OwnedRuntimeDirectoryState,
  type OwnedRuntimeWriteOptions,
  type RuntimeObjectIdentity,
} from "./OwnedRuntimeDirectory";
import {
  RuntimeMutationError,
  normalizeRuntimeMutationError,
  type RuntimeMutationCleanupStatus,
} from "./RuntimeMutationError";
import {
  RuntimeProtectedRoots,
  sameRuntimePath,
  runtimePathInside,
  type RuntimeProtectedRootRole,
} from "./RuntimeProtectedRoots";
import {
  assertRuntimeMaterializedPath,
  validateMutationRelativePath,
  validateRuntimeLogicalPath,
} from "./RuntimePathPolicy";
import {
  probeRuntimePathCapabilities,
  type RuntimePathCapabilityReport,
} from "./RuntimePathCapabilityProbe";
import {
  assertRuntimeBackupMaterializedPath,
  runtimeBackupPathLimits,
  runtimeBackupPathPolicyVersion,
  runtimeBackupPathPolicyVersionV1,
  validateRuntimeBackupMutationRelativePath,
  validateRuntimeBackupRelativePath,
  type RuntimeBackupPathPolicyVersion,
} from "@/lib/runtime/backup/RuntimeBackupPathPolicy";
import {
  getRuntimeBackupManifestPathPolicyVersion,
  runtimeBackupAuthoritySchemaVersion,
  runtimeBackupFormatVersion,
  runtimeBackupManifestSchemaVersion,
  runtimeBackupManifestSha256,
  serializeRuntimeBackupManifest,
  type RuntimeBackupManifest,
} from "@/lib/runtime/backup/RuntimeBackupManifest";
import { decodeStrictRuntimeDto } from "./StrictRuntimeDto";
import {
  collectRuntimeBackupInventory,
  hashStableRuntimeFile,
} from "@/lib/runtime/backup/RuntimeBackupInventory";
import {
  verifyRuntimeBackup,
  verifyRuntimeTreeAgainstManifest,
  type RuntimeBackupVerificationReport,
} from "@/lib/runtime/backup/RuntimeBackupVerifier";

export interface RuntimeMutationReservation {
  readonly release: () => RuntimeMutationCleanupStatus;
}

export interface GuardedRuntimeMutationSessionOptions {
  readonly writableRoot: string;
  readonly operation: string;
}

export interface BeginRuntimeMutationRequest {
  readonly writableRoot: string;
  readonly writableRole: RuntimeProtectedRootRole;
  readonly operation: string;
}

interface AtomicRuntimeBackupCreateRequest {
  readonly context: RuntimeStorageContext;
  readonly repositoryRoot: string;
  readonly backupRoot: string;
  readonly projectSlug?: string;
  readonly backupId: string;
  readonly runtimeAuthorityId: string;
}

interface AtomicRuntimeBackupCreateResult {
  readonly backupDirectory: string;
  readonly manifest: RuntimeBackupManifest;
  readonly verification: RuntimeBackupVerificationReport;
}

interface AtomicRuntimeBackupRestoreRequest {
  readonly backupDirectory: string;
  readonly restoreBase: string;
  readonly ownsRestoreRoot: boolean;
  readonly portable: boolean;
  readonly expectedRuntimeAuthorityId?: string;
  readonly expectedProjectIdentity?: string;
}

interface AtomicRuntimeBackupRestoreResult {
  readonly restoreRoot: string;
  readonly verification: RuntimeBackupVerificationReport;
}

type ScopedRuntimeMutationPathValidator = (
  relativePath: string,
  materializationRoot?: string,
) => readonly string[];

interface RuntimeMutationReservationState {
  readonly identity: RuntimeObjectIdentity;
  readonly parentIdentity: RuntimeObjectIdentity;
  released: boolean;
}

const sessionConstructionKey = Symbol("guarded-runtime-session-construction");
const beginRuntimeBackupMutationKey = Symbol("begin-runtime-backup-mutation");

export class GuardedRuntimeFilesystem {
  readonly hostileConcurrentIsolation = false as const;

  constructor(private readonly protectedRoots: RuntimeProtectedRoots) {}

  beginMutation(request: BeginRuntimeMutationRequest): GuardedRuntimeMutationSession {
    return this.beginMutationWithValidator(request, validateMutationRelativePath);
  }

  createVerifiedRuntimeBackup(
    request: AtomicRuntimeBackupCreateRequest,
  ): AtomicRuntimeBackupCreateResult {
    const decodedRequest = decodeAtomicCreateRequest(request);
    assertAtomicCreateRoots(this.protectedRoots, decodedRequest);
    const createdAt = new Date().toISOString();
    const partialRelative = `.p-${randomUUID().replace(/-/g, "").slice(0, 8)}`;
    const finalRelative = `backups/${decodedRequest.backupId}`;
    const inventoryManifest = collectRuntimeBackupInventory({
      context: decodedRequest.context,
      projectSlug: decodedRequest.projectSlug,
      repositoryRoot: decodedRequest.repositoryRoot,
      now: () => createdAt,
    });
    const manifest = createV3Manifest(
      inventoryManifest,
      decodedRequest.runtimeAuthorityId,
    );
    const serializedManifest = serializeRuntimeBackupManifest(manifest);
    const manifestDigest = runtimeBackupManifestSha256(serializedManifest);
    preflightAtomicCreateMaterialization(
      decodedRequest.backupRoot,
      partialRelative,
      finalRelative,
      manifest,
    );
    const sourceBefore = collectRuntimeBackupInventory({
      context: decodedRequest.context,
      projectSlug: decodedRequest.projectSlug,
      repositoryRoot: decodedRequest.repositoryRoot,
      now: () => createdAt,
    });
    assertExactInventory(sourceBefore, inventoryManifest);

    const backupRootExisted = fs.existsSync(decodedRequest.backupRoot);
    const backupsContainer = path.join(decodedRequest.backupRoot, "backups");
    const backupsContainerExisted = fs.existsSync(backupsContainer);
    let createdBackupRoot: RuntimeObjectIdentity | undefined;
    let createdBackupsContainer: RuntimeObjectIdentity | undefined;
    let operation: RuntimeBackupCreateGuardedOperationImpl | undefined;
    try {
      const activeOperation = beginPrivateRuntimeBackupCreateOperation(
        this,
        decodedRequest.backupRoot,
        partialRelative,
      );
      operation = activeOperation;
      if (!backupRootExisted) {
        createdBackupRoot = captureCreatedObject(decodedRequest.backupRoot);
      }
      if (!backupsContainerExisted) {
        createdBackupsContainer = captureCreatedObject(backupsContainer);
      }
      const payloadProjectsRoot = path.join(
        activeOperation.partialDirectory,
        "payload",
        "projects",
      );
      for (const file of manifest.files) {
        validateRuntimeBackupRelativePath(file.relativePath);
        assertRuntimeBackupMaterializedPath(payloadProjectsRoot, file.relativePath);
        const source = atomicContainedFilePath(
          decodedRequest.context.projectsRoot,
          file.relativePath,
        );
        const destination = activeOperation.materializeInventoryFile(
          source,
          file.relativePath,
          file.permissionClass === "executable",
        );
        const copied = hashStableRuntimeFile(destination, file.relativePath);
        if (copied.sizeBytes !== file.sizeBytes || copied.sha256 !== file.sha256) {
          throw new Error("Runtime backup payload copy verification failed.");
        }
      }
      activeOperation.writeCanonicalManifest(
        serializedManifest,
        manifestDigest,
      );
      verifyRuntimeBackup(activeOperation.partialDirectory, { allowPartial: true });
      const sourceAfter = collectRuntimeBackupInventory({
        context: decodedRequest.context,
        projectSlug: decodedRequest.projectSlug,
        repositoryRoot: decodedRequest.repositoryRoot,
        now: () => createdAt,
      });
      assertExactInventory(sourceAfter, inventoryManifest);
      const backupDirectory = activeOperation.publishVerified(decodedRequest.backupId, manifest);
      const verification = activeOperation.verifyPublished(
        () => verifyRuntimeBackup(backupDirectory),
      );
      activeOperation.commit();
      return Object.freeze({ backupDirectory, manifest, verification });
    } catch (error) {
      try {
        operation?.abort();
      } finally {
        cleanupAtomicEmptyDirectory(createdBackupsContainer);
        cleanupAtomicEmptyDirectory(createdBackupRoot);
      }
      throw error;
    }
  }

  restoreVerifiedRuntimeBackup(
    request: AtomicRuntimeBackupRestoreRequest,
  ): AtomicRuntimeBackupRestoreResult {
    const decodedRequest = decodeAtomicRestoreRequest(request);
    assertAtomicRestoreRoots(this.protectedRoots, decodedRequest);
    const verification = verifyRuntimeBackup(decodedRequest.backupDirectory);
    if (!decodedRequest.portable) {
      const sourceAuthority = verification.manifest.sourceRuntimeAuthority;
      if (
        verification.manifest.schemaVersion !== runtimeBackupManifestSchemaVersion ||
        verification.manifest.backupFormatVersion !== runtimeBackupFormatVersion ||
        !sourceAuthority ||
        sourceAuthority.runtimeAuthorityId !== decodedRequest.expectedRuntimeAuthorityId ||
        sourceAuthority.projectIdentity !== decodedRequest.expectedProjectIdentity
      ) throw invalidPath();
    }
    const pathPolicyVersion = getRuntimeBackupManifestPathPolicyVersion(
      verification.manifest,
    );
    const restoreOwnedRelative = `r-${randomUUID().replace(/-/g, "").slice(0, 8)}`;
    preflightAtomicRestoreMaterialization(
      decodedRequest.restoreBase,
      restoreOwnedRelative,
      decodedRequest.ownsRestoreRoot,
      verification.manifest,
      pathPolicyVersion,
    );
    const restoreBaseExisted = fs.existsSync(decodedRequest.restoreBase);
    let createdRestoreBase: RuntimeObjectIdentity | undefined;
    let operation: RuntimeBackupRestoreGuardedOperationImpl | undefined;
    try {
      const activeOperation = pathPolicyVersion === runtimeBackupPathPolicyVersion
        ? beginPrivateRuntimeBackupRestoreOperation(
          this,
          decodedRequest.restoreBase,
          decodedRequest.ownsRestoreRoot,
          restoreOwnedRelative,
        )
        : beginPrivateLegacyRuntimeBackupRestoreOperation(
          this,
          decodedRequest.restoreBase,
          decodedRequest.ownsRestoreRoot,
          restoreOwnedRelative,
        );
      operation = activeOperation;
      if (!restoreBaseExisted) {
        createdRestoreBase = captureCreatedObject(decodedRequest.restoreBase);
      }
      const payloadProjects = path.join(
        decodedRequest.backupDirectory,
        "payload",
        "projects",
      );
      for (const file of verification.manifest.files) {
        validateAtomicMaterializedManifestPath(
          activeOperation.restoredProjects,
          file.relativePath,
          pathPolicyVersion,
        );
        const source = atomicContainedFilePath(payloadProjects, file.relativePath);
        const destination = activeOperation.materializeVerifiedFile(
          source,
          file.relativePath,
          file.permissionClass === "executable",
        );
        const copied = hashStableRuntimeFile(destination, file.relativePath);
        if (copied.sizeBytes !== file.sizeBytes || copied.sha256 !== file.sha256) {
          throw new Error("Runtime backup restore copy verification failed.");
        }
      }
      activeOperation.verifyMaterialization(() => verifyRuntimeTreeAgainstManifest(
        activeOperation.restoredProjects,
        verification.manifest,
      ));
      const restoreRoot = activeOperation.restoreRoot;
      activeOperation.commit();
      cleanupAtomicEmptyDirectory(createdRestoreBase);
      return Object.freeze({ restoreRoot, verification });
    } catch (error) {
      try {
        operation?.abort();
      } finally {
        cleanupAtomicEmptyDirectory(createdRestoreBase);
      }
      throw error;
    }
  }

  [beginRuntimeBackupMutationKey](
    operation: "create" | "restore",
    writableRoot: string,
  ): GuardedRuntimeMutationSession {
    if (operation === "create") {
      return this.beginMutationWithValidator({
        writableRoot,
        writableRole: "backup",
        operation: "runtime-backup-create",
      }, validateRuntimeBackupMutationRelativePath);
    }
    if (operation === "restore") {
      return this.beginMutationWithValidator({
        writableRoot,
        writableRole: "restore-verification",
        operation: "runtime-restore-verify",
      }, validateRuntimeBackupMutationRelativePath);
    }
    throw new RuntimeMutationError("RUNTIME_MUTATION_PATH_INVALID");
  }

  private beginMutationWithValidator(
    request: BeginRuntimeMutationRequest,
    validateRelativePath: ScopedRuntimeMutationPathValidator,
  ): GuardedRuntimeMutationSession {
    try {
      this.protectedRoots.assertComplete();
      const writableRoot = this.protectedRoots.assertWritableRoot(
        request.writableRoot,
        request.writableRole,
      );
      ensureSafeDirectory(writableRoot);
      const capability = probeRuntimePathCapabilities(writableRoot);
      if (
        !capability.supportsExclusiveCreate ||
        !capability.supportsExclusivePublish ||
        !capability.cleanupVerified
      ) throw new RuntimeMutationError("RUNTIME_MUTATION_CAPABILITY_UNAVAILABLE");
      return new GuardedRuntimeMutationSession(
        sessionConstructionKey,
        writableRoot,
        request.operation,
        capability,
        validateRelativePath,
      );
    } catch (error) {
      throw normalizeRuntimeMutationError(error);
    }
  }
}

export class GuardedRuntimeMutationSession implements OwnedRuntimeDirectoryAdapter {
  readonly hostileConcurrentIsolation = false as const;
  private readonly token = randomUUID();
  private readonly reservationPath: string;
  private readonly reservationIdentity: RuntimeObjectIdentity;
  private readonly rootIdentity: RuntimeObjectIdentity;
  private readonly owned = new Set<OwnedRuntimeDirectoryState>();
  private readonly reservations = new Set<RuntimeMutationReservationState>();
  private readonly collisionRegistry = new Map<string, string>();
  private retainedAfterClose: OwnedRuntimeDirectoryState | undefined;
  private closed = false;

  constructor(
    constructionKey: typeof sessionConstructionKey,
    readonly writableRoot: string,
    operation: string,
    private readonly capability: RuntimePathCapabilityReport,
    private readonly validateRelativePath: ScopedRuntimeMutationPathValidator,
  ) {
    if (constructionKey !== sessionConstructionKey) throw invalidPath();
    this.rootIdentity = requireStableDirectory(writableRoot, writableRoot);
    if (!/^[a-z0-9-]{1,64}$/.test(operation)) throw invalidPath();
    this.reservationPath = path.join(
      writableRoot,
      `.runtime-mutation-${operation}.lock`,
    );
    createExclusiveTokenFile(this.reservationPath, this.token);
    this.reservationIdentity = requireStableFile(writableRoot, this.reservationPath);
  }

  ensureDirectory(relativePath: string): string {
    return this.publicBoundary(() => {
      this.assertActive();
      let current = this.writableRoot;
      for (const segment of this.validateRelativePath(relativePath, this.writableRoot)) {
        const next = path.join(current, segment);
        this.assertPortableCollisionAvailable(next);
        if (fs.existsSync(next)) {
          requireStableDirectory(this.writableRoot, next);
        } else {
          try {
            guardedExclusiveMutation(
              this.writableRoot,
              next,
              true,
              undefined,
              () => fs.mkdirSync(next),
              () => undefined,
            );
          } catch (error) {
            if (!isTargetExists(error)) throw error;
            requireStableDirectory(this.writableRoot, next);
          }
        }
        current = next;
      }
      return current;
    });
  }

  createOwnedDirectory(relativePath: string): OwnedRuntimeDirectory {
    return this.publicBoundary(() => {
      this.assertActive();
      const destination = resolveContained(
        this.writableRoot,
        relativePath,
        this.validateRelativePath,
      );
      const parent = path.dirname(destination);
      if (!sameRuntimePath(parent, this.writableRoot)) {
        const parentRelative = relativePosix(
          this.writableRoot,
          parent,
          this.validateRelativePath,
        );
        this.ensureDirectory(parentRelative);
      }
      this.assertPortableCollisionAvailable(destination);
      guardedExclusiveMutation(
        this.writableRoot,
        destination,
        true,
        undefined,
        () => fs.mkdirSync(destination),
        () => undefined,
      );
      const state: OwnedRuntimeDirectoryState = {
        absolutePath: destination,
        parentIdentity: requireStableDirectory(this.writableRoot, parent),
        directoryIdentity: requireStableDirectory(this.writableRoot, destination),
        status: "owned",
      };
      this.owned.add(state);
      return new OwnedRuntimeDirectory(this, state);
    });
  }

  acquireExclusiveReservation(relativePath: string): RuntimeMutationReservation {
    return this.publicBoundary(() => {
      this.assertActive();
      const destination = resolveContained(
        this.writableRoot,
        relativePath,
        this.validateRelativePath,
      );
      const parent = path.dirname(destination);
      if (!sameRuntimePath(parent, this.writableRoot)) {
        this.ensureDirectory(relativePosix(
          this.writableRoot,
          parent,
          this.validateRelativePath,
        ));
      }
      this.assertPortableCollisionAvailable(destination);
      guardedExclusiveMutation(
        this.writableRoot,
        destination,
        false,
        undefined,
        () => createExclusiveTokenFile(destination, this.token),
        () => undefined,
      );
      const state: RuntimeMutationReservationState = {
        identity: requireStableFile(this.writableRoot, destination),
        parentIdentity: requireStableDirectory(this.writableRoot, parent),
        released: false,
      };
      this.reservations.add(state);
      return Object.freeze({ release: () => this.releaseReservation(state) });
    });
  }

  ensureOwnedDirectory(state: OwnedRuntimeDirectoryState, relativePath: string): string {
    return this.publicBoundary(() => {
    this.assertOwned(state);
    let current = state.absolutePath;
    for (const segment of this.validateRelativePath(relativePath, state.absolutePath)) {
      const next = path.join(current, segment);
      this.assertPortableCollisionAvailable(next);
      if (fs.existsSync(next)) {
        requireStableDirectory(state.absolutePath, next);
      } else {
        try {
          guardedExclusiveMutation(
            state.absolutePath,
            next,
            true,
            undefined,
            () => fs.mkdirSync(next),
            () => undefined,
          );
        } catch (error) {
          if (!isTargetExists(error)) throw error;
          requireStableDirectory(state.absolutePath, next);
        }
      }
      current = next;
    }
    return current;
    });
  }

  writeOwnedFileExclusive<T>(
    state: OwnedRuntimeDirectoryState,
    relativePath: string,
    data: string | Buffer,
    options: OwnedRuntimeWriteOptions<T> & {
      readonly encoding?: BufferEncoding;
      readonly mode?: number;
    },
  ): T | undefined {
    return this.publicBoundary(() => {
      this.assertOwned(state);
      const destination = this.prepareOwnedDestination(state, relativePath);
      return guardedExclusiveMutation(
      state.absolutePath,
      destination,
      false,
      () => options.beforeWrite?.(path.dirname(destination), destination),
      () => fs.writeFileSync(destination, data, {
        ...(options.encoding ? { encoding: options.encoding } : {}),
        flag: "wx",
        mode: options.mode ?? 0o600,
      }),
      () => options.afterWrite?.(destination),
      );
    });
  }

  copyOwnedFileExclusive<T>(
    state: OwnedRuntimeDirectoryState,
    source: string,
    relativePath: string,
    options: OwnedRuntimeWriteOptions<T>,
  ): T | undefined {
    return this.publicBoundary(() => {
      this.assertOwned(state);
      const destination = this.prepareOwnedDestination(state, relativePath);
      return guardedExclusiveMutation(
      state.absolutePath,
      destination,
      false,
      () => options.beforeWrite?.(path.dirname(destination), destination),
      () => {
        fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
        if (options.executable) fs.chmodSync(destination, 0o700);
      },
      () => options.afterWrite?.(destination),
      );
    });
  }

  publishOwnedFileExclusive<T>(
    state: OwnedRuntimeDirectoryState,
    source: string,
    relativePath: string,
    options: OwnedRuntimeWriteOptions<T>,
  ): T | undefined {
    return this.publicBoundary(() => {
      this.assertOwned(state);
      const destination = this.prepareOwnedDestination(state, relativePath);
      if (!this.capability.supportsHardLinks) {
        return this.copyOwnedFileExclusive(state, source, relativePath, options);
      }
      try {
        return guardedExclusiveMutation(
        state.absolutePath,
        destination,
        false,
        () => options.beforeWrite?.(path.dirname(destination), destination),
        () => fs.linkSync(source, destination),
        () => options.afterWrite?.(destination),
        );
      } catch (error) {
        if (isTargetExists(error)) throw error;
        if (!isHardLinkUnavailable(error)) throw error;
        return this.copyOwnedFileExclusive(state, source, relativePath, options);
      }
    });
  }

  cleanupOwnedDirectory(state: OwnedRuntimeDirectoryState): RuntimeMutationCleanupStatus {
    if (state.status !== "owned") return "not-required";
    if (
      !this.sessionTokenMatches() ||
      !identityMatches(state.parentIdentity) ||
      !identityMatches(state.directoryIdentity)
    ) return "ownership-mismatch";
    try {
      fs.rmSync(state.absolutePath, { recursive: true });
      state.status = "cleaned";
      return "completed";
    } catch {
      return "failed";
    }
  }

  releaseOwnedDirectory(state: OwnedRuntimeDirectoryState): void {
    if (this.closed) {
      if (this.retainedAfterClose !== state || state.status !== "owned") {
        throw new RuntimeMutationError("RUNTIME_MUTATION_OWNERSHIP_MISMATCH");
      }
    } else {
      this.assertOwned(state);
    }
    if (!identityMatches(state.parentIdentity) || !identityMatches(state.directoryIdentity)) {
      throw new RuntimeMutationError("RUNTIME_MUTATION_OWNERSHIP_MISMATCH");
    }
    state.status = "released";
    this.retainedAfterClose = undefined;
  }

  closeRetainingOwnedDirectory(
    retained: OwnedRuntimeDirectoryState,
  ): RuntimeMutationCleanupStatus {
    if (this.closed || retained.status !== "owned" || !this.owned.has(retained)) {
      return "ownership-mismatch";
    }
    if (!this.sessionTokenMatches() || !identityMatches(retained.parentIdentity) ||
      !identityMatches(retained.directoryIdentity)) return "ownership-mismatch";
    let cleanupStatus: RuntimeMutationCleanupStatus = "completed";
    for (const reservation of [...this.reservations]) {
      const status = this.releaseReservation(reservation);
      if (status !== "completed" && status !== "not-required") cleanupStatus = status;
    }
    for (const state of this.owned) {
      if (state === retained || state.status !== "owned") continue;
      const status = this.cleanupOwnedDirectory(state);
      if (status !== "completed" && status !== "not-required") cleanupStatus = status;
    }
    if (cleanupStatus !== "completed") return cleanupStatus;
    if (!this.sessionTokenMatches() || !identityMatches(retained.parentIdentity) ||
      !identityMatches(retained.directoryIdentity)) return "ownership-mismatch";
    try {
      fs.rmSync(this.reservationPath);
      this.closed = true;
      this.retainedAfterClose = retained;
      return "completed";
    } catch {
      return "failed";
    }
  }

  close(): RuntimeMutationCleanupStatus {
    if (this.closed) return "not-required";
    let cleanupStatus: RuntimeMutationCleanupStatus = "completed";
    const hadOpenReservations = this.reservations.size > 0;
    for (const reservation of [...this.reservations]) {
      const status = this.releaseReservation(reservation);
      if (status !== "completed" && status !== "not-required") cleanupStatus = status;
    }
    for (const state of this.owned) {
      if (state.status !== "owned") continue;
      const status = this.cleanupOwnedDirectory(state);
      if (status !== "completed" && status !== "not-required") cleanupStatus = status;
    }
    if (cleanupStatus !== "completed") return cleanupStatus;
    if (!this.sessionTokenMatches()) return "ownership-mismatch";
    try {
      fs.rmSync(this.reservationPath);
      this.closed = true;
      return hadOpenReservations ? "open-reservation" : "completed";
    } catch {
      return "failed";
    }
  }

  private prepareOwnedDestination(
    state: OwnedRuntimeDirectoryState,
    relativePath: string,
  ) {
    const destination = resolveContained(
      state.absolutePath,
      relativePath,
      this.validateRelativePath,
    );
    const parent = path.dirname(destination);
    if (!sameRuntimePath(parent, state.absolutePath)) {
      this.ensureOwnedDirectory(state, relativePosix(
        state.absolutePath,
        parent,
        this.validateRelativePath,
      ));
    }
    this.assertPortableCollisionAvailable(destination);
    return destination;
  }

  private assertPortableCollisionAvailable(destination: string): void {
    const parent = path.dirname(destination);
    const name = path.basename(destination);
    const collisionKey = `${portableCaseKey(parent)}\0${portableCaseKey(name)}`;
    const registered = this.collisionRegistry.get(collisionKey);
    if (registered !== undefined && registered !== destination) throw invalidPath();
    for (const sibling of fs.readdirSync(parent)) {
      if (portableCaseKey(sibling) === portableCaseKey(name) && sibling !== name) {
        throw invalidPath();
      }
    }
    this.collisionRegistry.set(collisionKey, destination);
  }

  private releaseReservation(
    state: RuntimeMutationReservationState,
  ): RuntimeMutationCleanupStatus {
    if (state.released) return "not-required";
    if (
      !this.sessionTokenMatches() ||
      !identityMatches(state.parentIdentity) ||
      !identityMatches(state.identity)
    ) return "ownership-mismatch";
    try {
      fs.rmSync(state.identity.path);
      state.released = true;
      this.reservations.delete(state);
      return "completed";
    } catch {
      return "orphan-suspect";
    }
  }

  private publicBoundary<T>(operation: () => T): T {
    try {
      return operation();
    } catch (error) {
      throw normalizeRuntimeMutationError(error);
    }
  }

  private assertOwned(state: OwnedRuntimeDirectoryState) {
    this.assertActive();
    if (
      state.status !== "owned" ||
      !this.owned.has(state) ||
      !this.sessionTokenMatches() ||
      !identityMatches(state.directoryIdentity)
    ) throw new RuntimeMutationError("RUNTIME_MUTATION_OWNERSHIP_MISMATCH");
  }

  private assertActive() {
    if (this.closed) throw new RuntimeMutationError("RUNTIME_MUTATION_SESSION_CLOSED");
    if (!identityMatches(this.rootIdentity) || !this.sessionTokenMatches()) {
      throw new RuntimeMutationError("RUNTIME_MUTATION_OWNERSHIP_MISMATCH");
    }
  }

  private sessionTokenMatches() {
    try {
      return identityMatches(this.reservationIdentity) &&
        fs.readFileSync(this.reservationPath, "utf8") === `${this.token}\n`;
    } catch {
      return false;
    }
  }
}

function beginPrivateRuntimeBackupCreateOperation(
  guardedFilesystem: GuardedRuntimeFilesystem,
  writableRoot: string,
  partialRelative: string,
): RuntimeBackupCreateGuardedOperationImpl {
  if (!/^\.p-[a-f0-9]{8}$/.test(partialRelative)) throw invalidPath();
  const session = guardedFilesystem[beginRuntimeBackupMutationKey]("create", writableRoot);
  try {
    session.ensureDirectory("backups");
    const partial = session.createOwnedDirectory(partialRelative);
    partial.ensureDirectory("payload/projects");
    return new RuntimeBackupCreateGuardedOperationImpl(session, partial);
  } catch (error) {
    session.close();
    throw error;
  }
}

function beginPrivateRuntimeBackupRestoreOperation(
  guardedFilesystem: GuardedRuntimeFilesystem,
  writableRoot: string,
  ownsRestoreRoot: boolean,
  restoreOwnedRelative: string,
): RuntimeBackupRestoreGuardedOperationImpl {
  if (!/^r-[a-f0-9]{8}$/.test(restoreOwnedRelative)) throw invalidPath();
  const session = guardedFilesystem[beginRuntimeBackupMutationKey]("restore", writableRoot);
  return beginPrivateRuntimeBackupRestoreOperationWithSession(
    session,
    writableRoot,
    ownsRestoreRoot,
    restoreOwnedRelative,
  );
}

function beginPrivateLegacyRuntimeBackupRestoreOperation(
  guardedFilesystem: GuardedRuntimeFilesystem,
  writableRoot: string,
  ownsRestoreRoot: boolean,
  restoreOwnedRelative: string,
): RuntimeBackupRestoreGuardedOperationImpl {
  if (!/^r-[a-f0-9]{8}$/.test(restoreOwnedRelative)) throw invalidPath();
  const session = guardedFilesystem.beginMutation({
    writableRoot,
    writableRole: "restore-verification",
    operation: "runtime-restore-verify",
  });
  return beginPrivateRuntimeBackupRestoreOperationWithSession(
    session,
    writableRoot,
    ownsRestoreRoot,
    restoreOwnedRelative,
  );
}

function beginPrivateRuntimeBackupRestoreOperationWithSession(
  session: GuardedRuntimeMutationSession,
  writableRoot: string,
  ownsRestoreRoot: boolean,
  restoreOwnedRelative: string,
): RuntimeBackupRestoreGuardedOperationImpl {
  try {
    const restoreOwned = ownsRestoreRoot
      ? session.createOwnedDirectory(restoreOwnedRelative)
      : undefined;
    const projectsOwned = ownsRestoreRoot
      ? undefined
      : session.createOwnedDirectory("projects");
    const restoreRoot = restoreOwned?.absolutePath ?? writableRoot;
    const restoredProjects = restoreOwned
      ? restoreOwned.ensureDirectory("projects")
      : projectsOwned?.absolutePath;
    if (!restoredProjects) throw invalidPath();
    return new RuntimeBackupRestoreGuardedOperationImpl(
      session,
      restoreOwned,
      projectsOwned,
      restoreRoot,
      restoredProjects,
    );
  } catch (error) {
    session.close();
    throw error;
  }
}

class RuntimeBackupCreateGuardedOperationImpl
{
  private reservation: RuntimeMutationReservation | undefined;
  private final: OwnedRuntimeDirectory | undefined;
  private finished = false;
  private state: "preparing" | "published-owned" | "verifying" | "cleanup-in-progress" |
    "committed" | "aborting" | "cleanup-failed" = "preparing";

  constructor(
    private readonly session: GuardedRuntimeMutationSession,
    private readonly partial: OwnedRuntimeDirectory,
  ) {}

  get partialDirectory() {
    return this.partial.absolutePath;
  }

  materializeInventoryFile(
    source: string,
    relativePath: string,
    executable: boolean,
  ) {
    prepareOwnedPayloadFile(this.partial, `payload/projects/${relativePath}`);
    const copied = this.partial.copyFileExclusive(
      source,
      `payload/projects/${relativePath}`,
      { executable, afterWrite: (destinationPath) => destinationPath },
    );
    if (!copied) throw invalidPath();
    return copied;
  }

  writeCanonicalManifest(serialized: string, digest: string) {
    this.partial.writeFileExclusive("manifest.json", serialized, {
      encoding: "utf8",
      mode: 0o600,
    });
    this.partial.writeFileExclusive("manifest.sha256", `${digest}\n`, {
      encoding: "ascii",
      mode: 0o600,
    });
  }

  publishVerified(backupId: string, manifest: RuntimeBackupManifest) {
    if (
      !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/.test(backupId) ||
      backupId.includes(".partial")
    ) throw invalidPath();
    this.reservation = this.session.acquireExclusiveReservation(
      `backups/.${backupId}.publish.lock`,
    );
    this.final = this.session.createOwnedDirectory(`backups/${backupId}`);
    this.final.ensureDirectory("payload/projects");
    for (const file of manifest.files) {
      const payloadRelative = `payload/projects/${file.relativePath}`;
      validateRuntimeBackupMutationRelativePath(payloadRelative, this.partial.absolutePath);
      const source = path.resolve(
        this.partial.absolutePath,
        ...payloadRelative.split("/"),
      );
      this.final.publishFileExclusive(source, payloadRelative, {
        executable: file.permissionClass === "executable",
      });
    }
    this.final.publishFileExclusive(
      path.join(this.partial.absolutePath, "manifest.json"),
      "manifest.json",
    );
    this.final.publishFileExclusive(
      path.join(this.partial.absolutePath, "manifest.sha256"),
      "manifest.sha256",
    );
    this.state = "published-owned";
    return this.final.absolutePath;
  }

  verifyPublished<T>(verify: () => T): T {
    if (this.state !== "published-owned") throw invalidPath();
    this.state = "verifying";
    try {
      return verify();
    } finally {
      if (!this.finished) this.state = "published-owned";
    }
  }

  commit() {
    if (this.finished || this.state !== "published-owned" || !this.final || !this.reservation) {
      throw invalidPath();
    }
    this.state = "cleanup-in-progress";
    requireGuardedCleanup(this.partial.cleanup());
    requireGuardedCleanup(this.reservation.release());
    requireGuardedCleanup(this.final.closeSessionRetainingOwnership());
    this.final.releaseOwnership();
    this.state = "committed";
    this.finished = true;
  }

  abort() {
    if (this.finished) return;
    this.state = "aborting";
    const statuses = [
      this.final?.cleanup() ?? "not-required",
      this.partial.cleanup(),
      this.reservation?.release() ?? "not-required",
      this.session.close(),
    ];
    this.finished = true;
    for (const status of statuses) {
      if (status !== "completed" && status !== "not-required") this.state = "cleanup-failed";
      requireGuardedCleanup(status);
    }
  }
}

class RuntimeBackupRestoreGuardedOperationImpl
{
  private finished = false;
  private state: "preparing" | "verifying" | "cleanup-in-progress" | "committed" |
    "aborting" | "cleanup-failed" = "preparing";

  constructor(
    private readonly session: GuardedRuntimeMutationSession,
    private readonly restoreOwned: OwnedRuntimeDirectory | undefined,
    private readonly projectsOwned: OwnedRuntimeDirectory | undefined,
    readonly restoreRoot: string,
    readonly restoredProjects: string,
  ) {}

  materializeVerifiedFile(
    source: string,
    relativePath: string,
    executable: boolean,
  ) {
    const destinationRelative = this.restoreOwned
      ? `projects/${relativePath}`
      : relativePath;
    const writeRoot = this.restoreOwned ?? this.projectsOwned;
    if (!writeRoot) throw invalidPath();
    prepareOwnedPayloadFile(writeRoot, destinationRelative);
    const copied = writeRoot.copyFileExclusive(source, destinationRelative, {
      executable,
      afterWrite: (destinationPath) => destinationPath,
    });
    if (!copied) throw invalidPath();
    return copied;
  }

  verifyMaterialization<T>(verify: () => T): T {
    if (this.state !== "preparing") throw invalidPath();
    this.state = "verifying";
    try {
      return verify();
    } finally {
      if (!this.finished) this.state = "preparing";
    }
  }

  commit() {
    if (this.finished) throw invalidPath();
    this.state = "cleanup-in-progress";
    if (this.restoreOwned) {
      requireGuardedCleanup(this.restoreOwned.cleanup());
    } else {
      if (!this.projectsOwned) throw invalidPath();
      requireGuardedCleanup(this.projectsOwned.closeSessionRetainingOwnership());
      this.projectsOwned.releaseOwnership();
      this.state = "committed";
      this.finished = true;
      return;
    }
    requireGuardedCleanup(this.session.close());
    this.state = "committed";
    this.finished = true;
  }

  abort() {
    if (this.finished) return;
    this.state = "aborting";
    const statuses = [
      this.restoreOwned?.cleanup() ?? "not-required",
      this.projectsOwned?.cleanup() ?? "not-required",
      this.session.close(),
    ];
    this.finished = true;
    for (const status of statuses) {
      if (status !== "completed" && status !== "not-required") this.state = "cleanup-failed";
      requireGuardedCleanup(status);
    }
  }
}

function requireGuardedCleanup(status: RuntimeMutationCleanupStatus) {
  if (status !== "completed" && status !== "not-required") {
    throw new RuntimeMutationError("RUNTIME_MUTATION_OWNERSHIP_MISMATCH", status);
  }
}

function prepareOwnedPayloadFile(
  owned: OwnedRuntimeDirectory,
  destinationRelative: string,
) {
  const segments = validateRuntimeBackupMutationRelativePath(
    destinationRelative,
    owned.absolutePath,
  );
  const parentSegments = segments.slice(0, -1);
  const parent = parentSegments.length > 0
    ? owned.ensureDirectory(parentSegments.join("/"))
    : owned.absolutePath;
  return path.join(parent, segments.at(-1) as string);
}

function assertAtomicCreateRoots(
  protectedRoots: RuntimeProtectedRoots,
  request: AtomicRuntimeBackupCreateRequest,
) {
  assertExactAtomicKeys(request, [
    "context",
    "repositoryRoot",
    "backupRoot",
    "projectSlug",
    "backupId",
    "runtimeAuthorityId",
  ]);
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/.test(request.backupId) ||
    request.backupId.includes(".partial") ||
    !/^ra-[a-f0-9]{48}$/.test(request.runtimeAuthorityId) ||
    !sameRuntimePath(protectedRoots.root("repository") ?? "", request.repositoryRoot) ||
    !sameRuntimePath(protectedRoots.root("backup") ?? "", request.backupRoot) ||
    !sameRuntimePath(protectedRoots.root("runtime") ?? "", request.context.runtimeRoot) ||
    !sameRuntimePath(protectedRoots.root("live-projects") ?? "", request.context.projectsRoot) ||
    !sameRuntimePath(protectedRoots.root("machine") ?? "", request.context.machineRoot) ||
    !sameRuntimePath(protectedRoots.root("authority") ?? "", request.context.authorityRoot)
  ) throw invalidPath();
  protectedRoots.assertWritableRoot(request.backupRoot, "backup");
}

function assertAtomicRestoreRoots(
  protectedRoots: RuntimeProtectedRoots,
  request: AtomicRuntimeBackupRestoreRequest,
) {
  assertExactAtomicKeys(request, [
    "backupDirectory",
    "restoreBase",
    "ownsRestoreRoot",
    "portable",
    "expectedRuntimeAuthorityId",
    "expectedProjectIdentity",
  ]);
  protectedRoots.assertWritableRoot(request.restoreBase, "restore-verification");
  const protectedBackupRoot = protectedRoots.root("backup");
  if (
    !protectedBackupRoot ||
    (!request.portable && !sameRuntimePath(protectedBackupRoot, request.backupDirectory) &&
      !runtimePathInside(protectedBackupRoot, request.backupDirectory))
  ) throw invalidPath();
  if (
    typeof request.portable !== "boolean" ||
    (!request.portable &&
      (!request.expectedRuntimeAuthorityId || !request.expectedProjectIdentity)) ||
    (request.portable &&
      (request.expectedRuntimeAuthorityId !== undefined ||
        request.expectedProjectIdentity !== undefined))
  ) throw invalidPath();
}

function decodeAtomicCreateRequest(value: unknown): AtomicRuntimeBackupCreateRequest {
  const decoded = decodeStrictRuntimeDto(value, [
    "context",
    "repositoryRoot",
    "backupRoot",
    "projectSlug",
    "backupId",
    "runtimeAuthorityId",
  ] as const, invalidPath);
  if (
    typeof decoded.context !== "object" || decoded.context === null ||
    typeof decoded.repositoryRoot !== "string" ||
    typeof decoded.backupRoot !== "string" ||
    (decoded.projectSlug !== undefined && typeof decoded.projectSlug !== "string") ||
    typeof decoded.backupId !== "string" ||
    typeof decoded.runtimeAuthorityId !== "string"
  ) throw invalidPath();
  return decoded as unknown as AtomicRuntimeBackupCreateRequest;
}

function decodeAtomicRestoreRequest(value: unknown): AtomicRuntimeBackupRestoreRequest {
  const decoded = decodeStrictRuntimeDto(value, [
    "backupDirectory",
    "restoreBase",
    "ownsRestoreRoot",
    "portable",
    "expectedRuntimeAuthorityId",
    "expectedProjectIdentity",
  ] as const, invalidPath);
  if (
    typeof decoded.backupDirectory !== "string" ||
    typeof decoded.restoreBase !== "string" ||
    typeof decoded.ownsRestoreRoot !== "boolean" ||
    typeof decoded.portable !== "boolean" ||
    (decoded.expectedRuntimeAuthorityId !== undefined &&
      typeof decoded.expectedRuntimeAuthorityId !== "string") ||
    (decoded.expectedProjectIdentity !== undefined &&
      typeof decoded.expectedProjectIdentity !== "string")
  ) throw invalidPath();
  return decoded as unknown as AtomicRuntimeBackupRestoreRequest;
}

function createV3Manifest(
  inventory: RuntimeBackupManifest,
  runtimeAuthorityId: string,
): RuntimeBackupManifest {
  const manifest: RuntimeBackupManifest = Object.freeze({
    ...inventory,
    schemaVersion: runtimeBackupManifestSchemaVersion,
    backupFormatVersion: runtimeBackupFormatVersion,
    sourceRuntimeAuthority: Object.freeze({
      schemaVersion: runtimeBackupAuthoritySchemaVersion,
      runtimeAuthorityId,
      projectIdentity: inventory.sourceLogicalIdentity,
    }),
  });
  return manifest;
}

function assertExactInventory(
  actual: RuntimeBackupManifest,
  expected: RuntimeBackupManifest,
) {
  if (
    actual.aggregateFingerprint !== expected.aggregateFingerprint ||
    JSON.stringify(actual.files) !== JSON.stringify(expected.files)
  ) throw new Error("Runtime backup source inventory changed.");
}

function preflightAtomicCreateMaterialization(
  backupRoot: string,
  partialRelative: string,
  finalRelative: string,
  manifest: RuntimeBackupManifest,
) {
  assertAtomicAbsoluteMaterializedPath(backupRoot);
  assertAtomicAbsoluteMaterializedPath(path.join(
    backupRoot,
    ".runtime-mutation-runtime-backup-create.lock",
  ));
  validateRuntimeBackupMutationRelativePath(partialRelative, backupRoot);
  validateRuntimeBackupMutationRelativePath(finalRelative, backupRoot);
  const partialRoot = path.resolve(backupRoot, ...partialRelative.split("/"));
  const finalRoot = path.resolve(backupRoot, ...finalRelative.split("/"));
  for (const root of [partialRoot, finalRoot]) {
    assertRuntimeBackupMaterializedPath(root, "manifest.json");
    assertRuntimeBackupMaterializedPath(root, "manifest.sha256");
    for (const file of manifest.files) {
      validateRuntimeBackupRelativePath(file.relativePath);
      assertRuntimeBackupMaterializedPath(
        root,
        `payload/projects/${file.relativePath}`,
      );
    }
  }
  const backupId = finalRelative.slice("backups/".length);
  validateRuntimeBackupMutationRelativePath(
    `backups/.${backupId}.publish.lock`,
    backupRoot,
  );
}

function preflightAtomicRestoreMaterialization(
  restoreBase: string,
  restoreOwnedRelative: string,
  ownsRestoreRoot: boolean,
  manifest: RuntimeBackupManifest,
  pathPolicyVersion: RuntimeBackupPathPolicyVersion,
) {
  assertAtomicAbsoluteMaterializedPath(restoreBase, pathPolicyVersion);
  assertAtomicAbsoluteMaterializedPath(
    path.join(restoreBase, ".runtime-mutation-runtime-restore-verify.lock"),
    pathPolicyVersion,
  );
  const restoreRoot = ownsRestoreRoot
    ? atomicMaterializedMutationPath(
      restoreBase,
      restoreOwnedRelative,
      pathPolicyVersion,
    )
    : restoreBase;
  const projectsRoot = ownsRestoreRoot
    ? atomicMaterializedMutationPath(restoreRoot, "projects", pathPolicyVersion)
    : atomicMaterializedMutationPath(restoreBase, "projects", pathPolicyVersion);
  for (const file of manifest.files) {
    validateAtomicMaterializedManifestPath(
      projectsRoot,
      file.relativePath,
      pathPolicyVersion,
    );
  }
}

function validateAtomicMaterializedManifestPath(
  root: string,
  relativePath: string,
  pathPolicyVersion: RuntimeBackupPathPolicyVersion,
) {
  if (pathPolicyVersion === runtimeBackupPathPolicyVersionV1) {
    validateRuntimeLogicalPath(relativePath);
    return assertRuntimeMaterializedPath(root, relativePath);
  }
  validateRuntimeBackupRelativePath(relativePath, pathPolicyVersion);
  return assertRuntimeBackupMaterializedPath(root, relativePath);
}

function atomicMaterializedMutationPath(
  root: string,
  relativePath: string,
  pathPolicyVersion: RuntimeBackupPathPolicyVersion,
) {
  if (pathPolicyVersion === runtimeBackupPathPolicyVersionV1) {
    assertRuntimeMaterializedPath(root, relativePath);
    return path.resolve(root, ...relativePath.split("/"));
  }
  validateRuntimeBackupMutationRelativePath(relativePath, root);
  return path.resolve(root, ...relativePath.split("/"));
}

function assertAtomicAbsoluteMaterializedPath(
  target: string,
  pathPolicyVersion: RuntimeBackupPathPolicyVersion = runtimeBackupPathPolicyVersion,
) {
  const limit = pathPolicyVersion === runtimeBackupPathPolicyVersionV1
    ? 240
    : runtimeBackupPathLimits.materializedPathUtf16;
  if (path.resolve(target).length > limit) throw invalidPath();
}

function atomicContainedFilePath(root: string, relativePath: string) {
  if (!relativePath || relativePath.includes("\\") || relativePath.startsWith("/")) {
    throw invalidPath();
  }
  const target = path.resolve(root, ...relativePath.split("/"));
  assertPathContained(root, target);
  return target;
}

function cleanupAtomicEmptyDirectory(identity: RuntimeObjectIdentity | undefined) {
  if (!identity) return;
  if (!identityMatches(identity)) {
    throw new RuntimeMutationError("RUNTIME_MUTATION_OWNERSHIP_MISMATCH");
  }
  let originalError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fs.rmdirSync(identity.realPath);
      return;
    } catch (error) {
      originalError ??= error;
      if (!identityMatches(identity)) break;
    }
  }
  throw normalizeRuntimeMutationError(originalError, "failed");
}

function assertExactAtomicKeys(value: object, allowed: readonly string[]) {
  decodeStrictRuntimeDto(value, allowed, invalidPath);
}

function guardedExclusiveMutation<T>(
  containmentRoot: string,
  destination: string,
  recursiveCleanup: boolean,
  beforeWrite: (() => void) | undefined,
  operation: () => void,
  afterWrite: () => T,
): T {
  const parent = path.dirname(destination);
  const parentIdentity = requireStableDirectory(containmentRoot, parent);
  beforeWrite?.();
    let createdIdentity: RuntimeObjectIdentity | undefined;
    let cleanupStatus: RuntimeMutationCleanupStatus = "not-required";
  try {
    operation();
    createdIdentity = captureCreatedObject(destination);
    if (
      !sameRuntimePath(containmentRoot, createdIdentity.realPath) &&
      !runtimePathInside(containmentRoot, createdIdentity.realPath)
    ) throw invalidPath();
    assertIdentity(parentIdentity);
    const result = afterWrite();
    assertIdentity(parentIdentity);
    assertIdentity(createdIdentity);
    return result;
  } catch (error) {
    if (
      createdIdentity &&
      identityMatches(createdIdentity) &&
      (!recursiveCleanup || identityMatches(parentIdentity))
    ) {
      try {
        fs.rmSync(createdIdentity.realPath, { recursive: recursiveCleanup, force: true });
        cleanupStatus = "completed";
      } catch {
        cleanupStatus = "orphan-suspect";
      }
    }
    if (isTargetExists(error)) {
      throw new RuntimeMutationError("RUNTIME_MUTATION_TARGET_EXISTS");
    }
    if (isHardLinkUnavailable(error)) throw error;
    throw normalizeRuntimeMutationError(error, cleanupStatus);
  }
}

function createExclusiveTokenFile(target: string, token: string): void {
  let descriptor: number;
  try {
    descriptor = fs.openSync(target, "wx", 0o600);
  } catch (error) {
    throw normalizeRuntimeMutationError(error);
  }

  let originalError: unknown;
  let createdIdentity: RuntimeObjectIdentity | undefined;
  let closeStatus: RuntimeMutationCleanupStatus = "not-required";
  try {
    createdIdentity = captureCreatedObject(target);
    fs.writeFileSync(descriptor, `${token}\n`, "utf8");
  } catch (error) {
    originalError = error;
  }
  try {
    fs.closeSync(descriptor);
  } catch (error) {
    closeStatus = "failed";
    originalError ??= error;
  }
  if (originalError === undefined) return;

  let cleanupStatus: RuntimeMutationCleanupStatus = "ownership-mismatch";
  if (createdIdentity && identityMatches(createdIdentity)) {
    try {
      fs.rmSync(createdIdentity.path);
      cleanupStatus = "completed";
    } catch {
      cleanupStatus = "orphan-suspect";
    }
  }
  throw normalizeRuntimeMutationError(originalError, cleanupStatus, closeStatus);
}

function captureCreatedObject(target: string): RuntimeObjectIdentity {
  const stat = fs.lstatSync(target, { bigint: true });
  const realPath = fs.realpathSync(target);
  if (stat.isSymbolicLink()) throw invalidPath();
  return { path: realPath, realPath, stat };
}

function requireStableDirectory(root: string, target: string): RuntimeObjectIdentity {
  const identity = requireStableObject(root, target);
  if (!identity.stat.isDirectory()) throw invalidPath();
  return identity;
}

function requireStableFile(root: string, target: string): RuntimeObjectIdentity {
  const identity = requireStableObject(root, target);
  if (!identity.stat.isFile()) throw invalidPath();
  return identity;
}

function requireStableObject(root: string, target: string): RuntimeObjectIdentity {
  if (!sameRuntimePath(root, target) && !runtimePathInside(root, target)) throw invalidPath();
  try {
    const stat = fs.lstatSync(target, { bigint: true });
    const realPath = fs.realpathSync(target);
    if (stat.isSymbolicLink() || !sameRuntimePath(realPath, target)) throw invalidPath();
    return { path: target, realPath, stat };
  } catch (error) {
    if (error instanceof RuntimeMutationError) throw error;
    throw invalidPath();
  }
}

function assertIdentity(expected: RuntimeObjectIdentity) {
  if (!identityMatches(expected)) {
    throw new RuntimeMutationError("RUNTIME_MUTATION_OWNERSHIP_MISMATCH");
  }
}

function identityMatches(expected: RuntimeObjectIdentity) {
  try {
    const current = fs.lstatSync(expected.path, { bigint: true });
    const realPath = fs.realpathSync(expected.path);
    return !current.isSymbolicLink() &&
      sameRuntimePath(realPath, expected.realPath) &&
      current.dev === expected.stat.dev &&
      current.ino === expected.stat.ino &&
      current.mode === expected.stat.mode;
  } catch {
    return false;
  }
}

function resolveContained(
  root: string,
  relativePath: string,
  validateRelativePath: ScopedRuntimeMutationPathValidator,
) {
  const segments = validateRelativePath(relativePath, root);
  const destination = path.resolve(root, ...segments);
  if (!runtimePathInside(root, destination)) throw invalidPath();
  return destination;
}

function relativePosix(
  root: string,
  target: string,
  validateRelativePath: ScopedRuntimeMutationPathValidator = validateMutationRelativePath,
) {
  const relative = path.relative(root, target).split(path.sep).join("/");
  validateRelativePath(relative, root);
  return relative;
}


function portableCaseKey(value: string) {
  return value.normalize("NFC").toUpperCase();
}

function isTargetExists(error: unknown): boolean {
  return (error instanceof RuntimeMutationError && error.code === "RUNTIME_MUTATION_TARGET_EXISTS") ||
    (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "EEXIST");
}

function isHardLinkUnavailable(error: unknown): boolean {
  if (!(error instanceof Error) || !("code" in error)) return false;
  return ["EPERM", "ENOTSUP", "EOPNOTSUPP", "EXDEV"].includes(
    (error as NodeJS.ErrnoException).code ?? "",
  );
}

function invalidPath() {
  return new RuntimeMutationError("RUNTIME_MUTATION_PATH_INVALID");
}
