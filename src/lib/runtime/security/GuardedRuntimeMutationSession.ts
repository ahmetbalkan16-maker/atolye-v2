import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ensureSafeDirectory } from "@/lib/runtime/RuntimeStoragePaths";
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
import { validateMutationRelativePath } from "./RuntimePathPolicy";
import {
  probeRuntimePathCapabilities,
  type RuntimePathCapabilityReport,
} from "./RuntimePathCapabilityProbe";

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

interface RuntimeMutationReservationState {
  readonly identity: RuntimeObjectIdentity;
  readonly parentIdentity: RuntimeObjectIdentity;
  released: boolean;
}

const sessionConstructionKey = Symbol("guarded-runtime-session-construction");

export class GuardedRuntimeFilesystem {
  readonly hostileConcurrentIsolation = false as const;

  constructor(private readonly protectedRoots: RuntimeProtectedRoots) {}

  beginMutation(request: BeginRuntimeMutationRequest): GuardedRuntimeMutationSession {
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
  private closed = false;

  constructor(
    constructionKey: typeof sessionConstructionKey,
    readonly writableRoot: string,
    operation: string,
    private readonly capability: RuntimePathCapabilityReport,
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
      for (const segment of validateMutationRelativePath(relativePath, this.writableRoot)) {
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
      const destination = resolveContained(this.writableRoot, relativePath);
      const parent = path.dirname(destination);
      if (!sameRuntimePath(parent, this.writableRoot)) {
        const parentRelative = relativePosix(this.writableRoot, parent);
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
      const destination = resolveContained(this.writableRoot, relativePath);
      const parent = path.dirname(destination);
      if (!sameRuntimePath(parent, this.writableRoot)) {
        this.ensureDirectory(relativePosix(this.writableRoot, parent));
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
    for (const segment of validateMutationRelativePath(relativePath, state.absolutePath)) {
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
    this.assertOwned(state);
    if (!identityMatches(state.parentIdentity) || !identityMatches(state.directoryIdentity)) {
      throw new RuntimeMutationError("RUNTIME_MUTATION_OWNERSHIP_MISMATCH");
    }
    state.status = "released";
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
    const destination = resolveContained(state.absolutePath, relativePath);
    const parent = path.dirname(destination);
    if (!sameRuntimePath(parent, state.absolutePath)) {
      this.ensureOwnedDirectory(state, relativePosix(state.absolutePath, parent));
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

function resolveContained(root: string, relativePath: string) {
  const segments = validateMutationRelativePath(relativePath, root);
  const destination = path.resolve(root, ...segments);
  if (!runtimePathInside(root, destination)) throw invalidPath();
  return destination;
}

function relativePosix(root: string, target: string) {
  const relative = path.relative(root, target).split(path.sep).join("/");
  validateMutationRelativePath(relative, root);
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
