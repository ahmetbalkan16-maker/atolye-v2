import { AsyncLocalStorage } from "node:async_hooks";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { ProjectReader } from "@/lib/projects/ProjectReader";
import type { RuntimeStorageInput } from "@/lib/runtime/RuntimeStoragePaths";

interface LockOwner {
  readonly schemaVersion: "2";
  readonly projectSlug: string;
  readonly projectFolder: string;
  readonly jobId: string;
  readonly ownerNonce: string;
  readonly pid: number;
  readonly processStartEpochMs: number;
  readonly acquiredAt: string;
}

interface FileIdentity { readonly dev: bigint; readonly ino: bigint }

interface OwnershipHandle {
  readonly canonicalPath: string;
  readonly parentPath: string;
  readonly identity: FileIdentity;
  readonly entryType: "directory" | "file";
  readonly ownerBytes: string;
  readonly ownerNonce: string;
  readonly pid: number;
  readonly processStartEpochMs: number;
  readonly projectSlug: string;
  readonly projectFolder: string;
}

const activeLock = new AsyncLocalStorage<LockOwner>();
const staleAfterMs = 30_000;
const protocolRetryLimit = 500;
const retryDelayMs = 20;
const execFileAsync = promisify(execFile);
const fallbackOwnStart = Date.now() - Math.floor(process.uptime() * 1_000);
const ownProcessStart = readOsProcessStartEpochMs(process.pid).catch(() => fallbackOwnStart);
let staleObservationTestHook: (() => Promise<void>) | undefined;
let releaseFailureTestHook: { target: "lock" | "gate"; remaining: number } | undefined;
type CanonicalMutationBarrierTarget = "lock-release" | "gate-release" |
  "stale-lock" | "stale-gate" | "publication-cleanup" |
  "quarantine-cleanup" | "foreign-quarantine-preserved";
let canonicalMutationBarrierTestHook: {
  target: CanonicalMutationBarrierTarget;
  remaining: number;
  hook: () => Promise<void>;
} | undefined;
type CanonicalMutationKind = "lock" | "gate" | "quarantine";
let canonicalMutationInvocationTestHook:
  ((kind: CanonicalMutationKind) => void) | undefined;
export interface CanonicalFilesystemMutationTestEvent {
  readonly operation: "mkdir" | "write" | "rename" | "unlink" | "rmdir";
  readonly purpose: "fixture-setup" | "canonical-exclusive-create" | "owner-publication" |
    "quarantine-publication" | "canonical-to-quarantine" | "quarantine-cleanup" |
    "quarantine-container-cleanup";
  readonly targetPath?: string;
  readonly sourcePath?: string;
  readonly destinationPath?: string;
  readonly exclusive?: boolean;
}
let canonicalFilesystemMutationTestHook:
  ((event: CanonicalFilesystemMutationTestEvent) => void) | undefined;

/** @internal Installs a bounded operation-owned race barrier for child-process evidence. */
export function installCanonicalStaleObservationTestHook(
  hook: () => Promise<void>,
): () => void {
  if (process.env.NODE_ENV !== "test" || staleObservationTestHook) {
    throw new Error("PIPELINE_JOB_MUTATION_LOCK_TEST_HOOK_DENIED");
  }
  staleObservationTestHook = hook;
  return () => { if (staleObservationTestHook === hook) staleObservationTestHook = undefined; };
}

/** @internal One-shot release failure used only by isolated mutation-reporting evidence. */
export function installCanonicalReleaseFailureTestHook(
  target: "lock" | "gate",
  occurrence = 1,
): () => void {
  if (process.env.NODE_ENV !== "test" || releaseFailureTestHook || occurrence < 1) {
    throw new Error("PIPELINE_JOB_MUTATION_LOCK_TEST_HOOK_DENIED");
  }
  releaseFailureTestHook = { target, remaining: occurrence };
  return () => { releaseFailureTestHook = undefined; };
}

/** @internal Bounded child-process barrier for check-after-replacement race evidence. */
export function installCanonicalMutationBarrierTestHook(
  target: CanonicalMutationBarrierTarget,
  hook: () => Promise<void>,
  occurrence = 1,
): () => void {
  if (process.env.NODE_ENV !== "test" || canonicalMutationBarrierTestHook || occurrence < 1) {
    throw new Error("PIPELINE_JOB_MUTATION_LOCK_TEST_HOOK_DENIED");
  }
  canonicalMutationBarrierTestHook = { target, remaining: occurrence, hook };
  return () => { canonicalMutationBarrierTestHook = undefined; };
}

/** @internal Counts actual canonical protocol mutation entry points in isolated tests. */
export function installCanonicalMutationInvocationTestHook(
  hook: (kind: CanonicalMutationKind) => void,
): () => void {
  if (process.env.NODE_ENV !== "test" || canonicalMutationInvocationTestHook) {
    throw new Error("PIPELINE_JOB_MUTATION_LOCK_TEST_HOOK_DENIED");
  }
  canonicalMutationInvocationTestHook = hook;
  return () => {
    if (canonicalMutationInvocationTestHook === hook) {
      canonicalMutationInvocationTestHook = undefined;
    }
  };
}

/** @internal Observes actual filesystem mutation invocations in isolated race children. */
export function installCanonicalFilesystemMutationTestHook(
  hook: (event: CanonicalFilesystemMutationTestEvent) => void,
): () => void {
  if (process.env.NODE_ENV !== "test" || canonicalFilesystemMutationTestHook) {
    throw new Error("PIPELINE_JOB_MUTATION_LOCK_TEST_HOOK_DENIED");
  }
  canonicalFilesystemMutationTestHook = hook;
  return () => {
    if (canonicalFilesystemMutationTestHook === hook) {
      canonicalFilesystemMutationTestHook = undefined;
    }
  };
}

export async function withCanonicalPipelineJobMutationLock<T>(
  projectSlug: string,
  jobId: string,
  operation: () => Promise<T>,
  storageInput: RuntimeStorageInput = {},
): Promise<T> {
  const requestedProjectFolder = path.resolve(
    ProjectReader.getProjectFolder(projectSlug, storageInput),
  );
  const inherited = activeLock.getStore();
  if (inherited) {
    assertNestedScope(inherited, projectSlug, jobId, requestedProjectFolder);
    return operation();
  }

  const projectFolder = await canonicalProjectFolder(projectSlug, storageInput);
  const lockDirectory = path.join(projectFolder, ".pipeline-jobs.lock");
  const gateFile = path.join(projectFolder, ".pipeline-jobs.lock-gate");
  const owner: LockOwner = Object.freeze({
    schemaVersion: "2", projectSlug, projectFolder, jobId,
    ownerNonce: randomUUID(), pid: process.pid,
    processStartEpochMs: await ownProcessStart,
    acquiredAt: new Date().toISOString(),
  });
  const ownerBytes = `${JSON.stringify(owner)}\n`;

  let ownership: OwnershipHandle | undefined;
  for (let attempt = 0; ; attempt++) {
    try {
      ownership = await withAcquisitionGate(gateFile, projectFolder, async () => {
        await recoverVerifiedStaleLock(lockDirectory, projectFolder);
        return publishOwnedLock(lockDirectory, owner, ownerBytes, projectFolder);
      });
      break;
    } catch (error) {
      if (!isMutationLockBusy(error) || attempt === protocolRetryLimit) throw error;
      await delay(retryDelayMs);
    }
  }

  try {
    return await activeLock.run(owner, operation);
  } finally {
    if (!ownership) throw new Error("PIPELINE_JOB_MUTATION_LOCK_OWNERSHIP_MISSING");
    await withAcquisitionGate(gateFile, projectFolder, () =>
      releaseOwnedLock(ownership));
  }
}

export function assertCanonicalPipelineJobMutationLock(projectSlug: string): void {
  if (activeLock.getStore()?.projectSlug !== projectSlug) {
    throw new Error("PIPELINE_JOB_MUTATION_LOCK_REQUIRED");
  }
}

export function hasCanonicalPipelineJobMutationLock(projectSlug: string): boolean {
  return activeLock.getStore()?.projectSlug === projectSlug;
}

function isMutationLockBusy(error: unknown): boolean {
  return error instanceof Error &&
    error.message === "PIPELINE_JOB_MUTATION_LOCK_BUSY";
}

/** @internal Read-only evidence helper for isolated PID-reuse tests. */
export async function readCanonicalProcessStartEpochMs(pid: number): Promise<number | null> {
  try { return await readOsProcessStartEpochMs(pid); }
  catch { return null; }
}

/** @internal Isolated evidence hook; never used by production composition. */
export async function verifyCanonicalOwnerPublicationFailureCleanup(
  projectSlug: string,
  jobId: string,
): Promise<void> {
  const projectFolder = await canonicalProjectFolder(projectSlug);
  const lockDirectory = path.join(projectFolder, ".pipeline-jobs.lock");
  const gateFile = path.join(projectFolder, ".pipeline-jobs.lock-gate");
  const owner: LockOwner = { schemaVersion: "2", projectSlug, projectFolder, jobId,
    ownerNonce: randomUUID(), pid: process.pid,
    processStartEpochMs: await ownProcessStart, acquiredAt: new Date().toISOString() };
  let failed = false;
  try {
    await withAcquisitionGate(gateFile, projectFolder, () =>
      publishOwnedLock(lockDirectory, owner, `${JSON.stringify(owner)}\n`, projectFolder, true));
  } catch (error) {
    if (!(error instanceof Error) ||
      error.message !== "PIPELINE_JOB_MUTATION_LOCK_INJECTED_PUBLICATION_FAILURE") {
      throw error;
    }
    failed = true;
  }
  if (!failed) throw new Error("PIPELINE_JOB_MUTATION_LOCK_FAILURE_INJECTION_MISSED");
  try { await fs.access(lockDirectory); throw new Error("ownerless lock remained"); }
  catch (error) { if (!isMissing(error)) throw error; }
  await withCanonicalPipelineJobMutationLock(projectSlug, jobId, async () => undefined);
}

/** @internal Creates an identity-unverified quarantine leaf for late-publisher race evidence. */
export async function verifyCanonicalForeignQuarantinePreservation(
  projectSlug: string,
  jobId: string,
): Promise<void> {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("PIPELINE_JOB_MUTATION_LOCK_TEST_HOOK_DENIED");
  }
  const projectFolder = await canonicalProjectFolder(projectSlug);
  const canonicalPath = path.join(projectFolder, ".pipeline-jobs.lock");
  const identityAnchor = path.join(projectFolder, `.pipeline-jobs.identity-${randomUUID()}`);
  const ownerBytes = `${JSON.stringify({ foreign: true, jobId, source: "quarantine" })}\n`;
  await mutationMkdir(identityAnchor, "fixture-setup");
  const identity = await identityOf(identityAnchor);
  await mutationMkdir(canonicalPath, "fixture-setup");
  await mutationWriteFile(path.join(canonicalPath, "owner.json"), ownerBytes,
    { encoding: "utf8", flag: "wx", mode: 0o600 }, "fixture-setup", true);
  try {
    await quarantineAndRemove({ canonicalPath, parentPath: projectFolder, identity,
      entryType: "directory", ownerBytes, directoryProof: "owned" });
  } finally {
    await mutationRmdir(identityAnchor, "fixture-setup");
  }
}

async function publishOwnedLock(
  lockDirectory: string,
  owner: LockOwner,
  ownerBytes: string,
  projectFolder: string,
  failAfterDirectoryCreation = false,
): Promise<OwnershipHandle> {
  const ownerFile = path.join(lockDirectory, "owner.json");
  const temporaryOwner = path.join(lockDirectory, `.owner-${owner.ownerNonce}.tmp`);
  let createdIdentity: FileIdentity | undefined;
  try {
    invokeCanonicalMutationInvocation("lock");
    await mutationMkdir(lockDirectory, "canonical-exclusive-create");
    createdIdentity = await identityOf(lockDirectory);
    if (failAfterDirectoryCreation) {
      throw new Error("PIPELINE_JOB_MUTATION_LOCK_INJECTED_PUBLICATION_FAILURE");
    }
    const handle = await fs.open(temporaryOwner, "wx", 0o600);
    try {
      observeFilesystemMutation({ operation: "write", purpose: "owner-publication",
        targetPath: temporaryOwner, exclusive: true });
      await handle.writeFile(ownerBytes, "utf8");
      await handle.sync();
    }
    finally { await handle.close(); }
    await mutationRename(temporaryOwner, ownerFile, "owner-publication");
    await syncDirectory(lockDirectory);
    await assertDirectoryIdentity(lockDirectory, projectFolder, createdIdentity);
    if (await fs.readFile(ownerFile, "utf8") !== ownerBytes) {
      throw new Error("PIPELINE_JOB_MUTATION_LOCK_OWNER_PUBLICATION_MISMATCH");
    }
    return freezeOwnershipHandle({ canonicalPath: lockDirectory, parentPath: projectFolder,
      identity: createdIdentity, entryType: "directory", ownerBytes,
      ownerNonce: owner.ownerNonce, pid: owner.pid,
      processStartEpochMs: owner.processStartEpochMs,
      projectSlug: owner.projectSlug, projectFolder: owner.projectFolder });
  } catch (error) {
    if (createdIdentity) {
      await removeExactCreatedLock(lockDirectory, projectFolder, createdIdentity,
        [path.basename(temporaryOwner), "owner.json"], ownerBytes);
    }
    throw error;
  }
}

async function recoverVerifiedStaleLock(
  lockDirectory: string,
  projectFolder: string,
): Promise<void> {
  let first: Awaited<ReturnType<typeof inspectLock>>;
  try { first = await inspectLock(lockDirectory, projectFolder); }
  catch (error) { if (isMissing(error)) return; throw error; }
  if (Date.now() - first.mtimeMs <= staleAfterMs) {
    throw new Error("PIPELINE_JOB_MUTATION_LOCK_BUSY");
  }
  if (await sameLiveProcess(first.owner)) throw new Error("PIPELINE_JOB_MUTATION_LOCK_BUSY");
  await staleObservationTestHook?.();
  const second = await inspectLock(lockDirectory, projectFolder);
  if (!sameIdentity(first.identity, second.identity) || first.ownerBytes !== second.ownerBytes ||
    first.owner.ownerNonce !== second.owner.ownerNonce || first.owner.pid !== second.owner.pid ||
    first.owner.processStartEpochMs !== second.owner.processStartEpochMs) {
    throw new Error("PIPELINE_JOB_MUTATION_LOCK_STALE_OBSERVATION_CHANGED");
  }
  await invokeCanonicalMutationBarrier("stale-lock");
  await quarantineAndRemove({ canonicalPath: lockDirectory, parentPath: projectFolder,
    identity: second.identity, entryType: "directory", ownerBytes: second.ownerBytes });
}

async function releaseOwnedLock(
  ownership: OwnershipHandle,
): Promise<void> {
  assertOwnershipPath(ownership);
  const inspected = await inspectLock(ownership.canonicalPath, ownership.parentPath);
  if (!sameIdentity(inspected.identity, ownership.identity) ||
    inspected.ownerBytes !== ownership.ownerBytes ||
    inspected.owner.ownerNonce !== ownership.ownerNonce) {
    throw new Error("PIPELINE_JOB_MUTATION_LOCK_OWNERSHIP_CHANGED");
  }
  const entries = await fs.readdir(ownership.canonicalPath);
  if (entries.length !== 1 || entries[0] !== "owner.json") {
    throw new Error("PIPELINE_JOB_MUTATION_LOCK_CONTENT_CHANGED");
  }
  await invokeCanonicalMutationBarrier("lock-release");
  await quarantineAndRemove(ownership);
  injectReleaseFailure("lock");
}

async function withAcquisitionGate<T>(
  gateFile: string,
  projectFolder: string,
  operation: () => Promise<T>,
): Promise<T> {
  const owner: LockOwner = { schemaVersion: "2", projectSlug: path.basename(projectFolder),
    projectFolder, jobId: "gate", ownerNonce: randomUUID(), pid: process.pid,
    processStartEpochMs: await ownProcessStart, acquiredAt: new Date().toISOString() };
  const bytes = `${JSON.stringify(owner)}\n`;
  let ownership: OwnershipHandle | undefined;
  for (let attempt = 0; attempt <= protocolRetryLimit; attempt++) {
    try {
      invokeCanonicalMutationInvocation("gate");
      await mutationWriteFile(gateFile, bytes,
        { encoding: "utf8", flag: "wx", mode: 0o600 },
        "canonical-exclusive-create", true);
      const stat = await fs.lstat(gateFile, { bigint: true });
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new Error("PIPELINE_JOB_MUTATION_LOCK_GATE_IDENTITY_INVALID");
      }
      ownership = freezeOwnershipHandle({ canonicalPath: gateFile, parentPath: projectFolder,
        identity: { dev: stat.dev, ino: stat.ino }, entryType: "file", ownerBytes: bytes,
        ownerNonce: owner.ownerNonce, pid: owner.pid,
        processStartEpochMs: owner.processStartEpochMs,
        projectSlug: owner.projectSlug, projectFolder: owner.projectFolder });
      break;
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      if (await recoverStaleGate(gateFile, projectFolder)) continue;
      if (attempt === protocolRetryLimit) throw new Error("PIPELINE_JOB_MUTATION_LOCK_GATE_BUSY");
      await delay(retryDelayMs);
    }
  }
  try { return await operation(); }
  finally {
    if (!ownership) throw new Error("PIPELINE_JOB_MUTATION_LOCK_GATE_OWNERSHIP_MISSING");
    await releaseOwnedGate(ownership);
  }
}

async function recoverStaleGate(gateFile: string, projectFolder: string): Promise<boolean> {
  let firstStat: Awaited<ReturnType<typeof fs.lstat>>;
  try { firstStat = await fs.lstat(gateFile); }
  catch (error) { if (isMissing(error)) return true; throw error; }
  if (!firstStat.isFile() || firstStat.isSymbolicLink() || path.dirname(gateFile) !== projectFolder) {
    throw new Error("PIPELINE_JOB_MUTATION_LOCK_GATE_IDENTITY_INVALID");
  }
  if (Date.now() - firstStat.mtimeMs <= staleAfterMs) return false;
  let bytes: string; let owner: LockOwner;
  try { bytes = await fs.readFile(gateFile, "utf8"); owner = parseOwner(bytes, projectFolder); }
  catch { return false; }
  if (await sameLiveProcess(owner)) return false;
  const secondStat = await fs.lstat(gateFile);
  if (firstStat.dev !== secondStat.dev || firstStat.ino !== secondStat.ino ||
    await fs.readFile(gateFile, "utf8") !== bytes) return false;
  await invokeCanonicalMutationBarrier("stale-gate");
  await quarantineAndRemove({ canonicalPath: gateFile, parentPath: projectFolder,
    identity: { dev: BigInt(secondStat.dev), ino: BigInt(secondStat.ino) },
    entryType: "file", ownerBytes: bytes });
  return true;
}

async function inspectLock(lockDirectory: string, projectFolder: string, quarantine = false) {
  const stat = await fs.lstat(lockDirectory, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink() || path.dirname(lockDirectory) !== projectFolder ||
    (!quarantine && path.basename(lockDirectory) !== ".pipeline-jobs.lock") ||
    (quarantine && !path.basename(lockDirectory).startsWith(".pipeline-jobs.stale-"))) {
    throw new Error("PIPELINE_JOB_MUTATION_LOCK_REPARSE_DETECTED");
  }
  const entries = await fs.readdir(lockDirectory);
  if (entries.length !== 1 || entries[0] !== "owner.json") {
    throw new Error("PIPELINE_JOB_MUTATION_LOCK_CONTENT_INVALID");
  }
  const ownerBytes = await fs.readFile(path.join(lockDirectory, "owner.json"), "utf8");
  return { identity: { dev: stat.dev, ino: stat.ino }, mtimeMs: Number(stat.mtimeMs),
    ownerBytes, owner: parseOwner(ownerBytes, projectFolder) };
}

function parseOwner(bytes: string, projectFolder: string): LockOwner {
  const value = JSON.parse(bytes) as LockOwner;
  if (value?.schemaVersion !== "2" || value.projectFolder !== projectFolder ||
    typeof value.projectSlug !== "string" || typeof value.jobId !== "string" ||
    typeof value.ownerNonce !== "string" || value.ownerNonce.length === 0 ||
    !Number.isSafeInteger(value.pid) || value.pid <= 0 ||
    !Number.isSafeInteger(value.processStartEpochMs) ||
    typeof value.acquiredAt !== "string") {
    throw new Error("PIPELINE_JOB_MUTATION_LOCK_OWNER_INVALID");
  }
  return value;
}

const processStartCache = new Map<number, Promise<number>>();

async function sameLiveProcess(owner: LockOwner): Promise<boolean> {
  if (!processIsAlive(owner.pid)) {
    processStartCache.delete(owner.pid);
    return false;
  }
  const currentStart = owner.pid === process.pid ? await ownProcessStart :
    await readCanonicalProcessStartEpochMs(owner.pid);
  if (currentStart === null) throw new Error("PIPELINE_JOB_MUTATION_LOCK_PROCESS_IDENTITY_UNKNOWN");
  return Math.abs(currentStart - owner.processStartEpochMs) <= 1_000;
}

async function readOsProcessStartEpochMs(pid: number): Promise<number> {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("invalid pid");
  if (!processIsAlive(pid)) {
    processStartCache.delete(pid);
    throw new Error("process not alive");
  }
  const cached = processStartCache.get(pid);
  if (cached) return cached;

  const promise = (async () => {
    if (process.platform === "win32") {
      const script = `$p=Get-Process -Id ${pid} -ErrorAction Stop;` +
        `([DateTimeOffset]$p.StartTime).ToUnixTimeMilliseconds()`;
      const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive",
        "-Command", script], { timeout: 3_000, windowsHide: true });
      const value = Number(stdout.trim());
      if (!Number.isSafeInteger(value)) throw new Error("process start unavailable");
      return value;
    }
    const [stat, system, ticksResult] = await Promise.all([
      fs.readFile(`/proc/${pid}/stat`, "utf8"), fs.readFile("/proc/stat", "utf8"),
      execFileAsync("getconf", ["CLK_TCK"], { timeout: 3_000 }),
    ]);
    const end = stat.lastIndexOf(")");
    const fields = stat.slice(end + 2).split(" ");
    const startTicks = Number(fields[19]);
    const boot = Number(/^btime\s+(\d+)$/m.exec(system)?.[1]);
    const ticks = Number(ticksResult.stdout.trim());
    const value = Math.round((boot + startTicks / ticks) * 1_000);
    if (![startTicks, boot, ticks, value].every(Number.isFinite)) throw new Error("process start unavailable");
    return value;
  })();

  processStartCache.set(pid, promise);
  promise.catch(() => {
    if (processStartCache.get(pid) === promise) {
      processStartCache.delete(pid);
    }
  });
  return promise;
}

async function canonicalProjectFolder(
  projectSlug: string,
  storageInput: RuntimeStorageInput = {},
): Promise<string> {
  const resolved = path.resolve(ProjectReader.getProjectFolder(projectSlug, storageInput));
  const stat = await fs.lstat(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(resolved) !== resolved) {
    throw new Error("PIPELINE_JOB_MUTATION_LOCK_PROJECT_IDENTITY_INVALID");
  }
  return resolved;
}

async function removeExactCreatedLock(
  lockDirectory: string,
  projectFolder: string,
  identity: FileIdentity,
  allowedEntries: readonly string[],
  ownerBytes: string,
): Promise<void> {
  await assertDirectoryIdentity(lockDirectory, projectFolder, identity);
  await invokeCanonicalMutationBarrier("publication-cleanup");
  await quarantineAndRemove({ canonicalPath: lockDirectory, parentPath: projectFolder,
    identity, entryType: "directory", ownerBytes,
    directoryProof: "publication", allowedEntries });
}

async function assertDirectoryIdentity(
  directory: string,
  projectFolder: string,
  expected: FileIdentity,
) {
  const stat = await fs.lstat(directory, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink() || path.dirname(directory) !== projectFolder ||
    stat.dev !== expected.dev || stat.ino !== expected.ino) {
    throw new Error("PIPELINE_JOB_MUTATION_LOCK_FILESYSTEM_IDENTITY_CHANGED");
  }
}

async function identityOf(directory: string): Promise<FileIdentity> {
  const stat = await fs.lstat(directory, { bigint: true });
  return { dev: stat.dev, ino: stat.ino };
}

async function syncDirectory(directory: string) {
  try { const handle = await fs.open(directory, "r"); try { await handle.sync(); } finally { await handle.close(); } }
  catch { if (process.platform !== "win32") throw new Error("PIPELINE_JOB_MUTATION_LOCK_SYNC_FAILED"); }
}

function assertNestedScope(
  owner: LockOwner,
  projectSlug: string,
  jobId: string,
  projectFolder: string,
) {
  if (owner.projectSlug !== projectSlug || owner.projectFolder !== projectFolder ||
    (owner.jobId !== "*" && jobId !== "*" && owner.jobId !== jobId)) {
    throw new Error("PIPELINE_JOB_MUTATION_LOCK_SCOPE_MISMATCH");
  }
}

function processIsAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}

function sameIdentity(left: FileIdentity, right: FileIdentity) {
  return left.dev === right.dev && left.ino === right.ino;
}

function freezeOwnershipHandle(handle: OwnershipHandle): OwnershipHandle {
  Object.freeze(handle.identity);
  return Object.freeze(handle);
}

function assertOwnershipPath(handle: OwnershipHandle): void {
  if (path.dirname(handle.canonicalPath) !== handle.parentPath ||
    handle.projectFolder !== handle.parentPath ||
    (handle.entryType === "directory" && path.basename(handle.canonicalPath) !==
      ".pipeline-jobs.lock") ||
    (handle.entryType === "file" && path.basename(handle.canonicalPath) !==
      ".pipeline-jobs.lock-gate")) {
    throw new Error("PIPELINE_JOB_MUTATION_LOCK_OWNERSHIP_PATH_INVALID");
  }
}

async function releaseOwnedGate(ownership: OwnershipHandle): Promise<void> {
  assertOwnershipPath(ownership);
  const stat = await fs.lstat(ownership.canonicalPath, { bigint: true });
  const bytes = await fs.readFile(ownership.canonicalPath, "utf8");
  if (!stat.isFile() || stat.isSymbolicLink() ||
    stat.dev !== ownership.identity.dev || stat.ino !== ownership.identity.ino ||
    bytes !== ownership.ownerBytes) {
    throw new Error("PIPELINE_JOB_MUTATION_LOCK_GATE_OWNERSHIP_CHANGED");
  }
  await invokeCanonicalMutationBarrier("gate-release");
  await quarantineAndRemove(ownership);
  injectReleaseFailure("gate");
}

function injectReleaseFailure(target: "lock" | "gate"): void {
  if (releaseFailureTestHook?.target !== target) return;
  releaseFailureTestHook.remaining -= 1;
  if (releaseFailureTestHook.remaining > 0) return;
  releaseFailureTestHook = undefined;
  throw new Error(`PIPELINE_JOB_MUTATION_LOCK_${target.toUpperCase()}_RELEASE_INJECTED`);
}

interface QuarantineRemovalProof {
  readonly canonicalPath: string;
  readonly parentPath: string;
  readonly identity: FileIdentity;
  readonly entryType: "directory" | "file";
  readonly ownerBytes: string;
  readonly directoryProof?: "owned" | "publication";
  readonly allowedEntries?: readonly string[];
}

interface QuarantineRemovalOutcome {
  readonly decision: "cleaned-owned-quarantine";
  readonly residuePath: null;
}

class QuarantineProtocolError extends Error {
  readonly residuePath: string;

  constructor(reasonCode: string, residuePath: string, cause?: unknown) {
    super(reasonCode, cause === undefined ? undefined : { cause });
    this.name = "QuarantineProtocolError";
    this.residuePath = residuePath;
  }
}

async function quarantineAndRemove(
  proof: QuarantineRemovalProof,
): Promise<QuarantineRemovalOutcome> {
  if (path.dirname(proof.canonicalPath) !== proof.parentPath) {
    throw new Error("PIPELINE_JOB_MUTATION_LOCK_QUARANTINE_PATH_INVALID");
  }
  const nonce = randomUUID();
  const container = path.join(proof.parentPath, `.pipeline-jobs.quarantine-${nonce}`);
  const leafName = `${proof.entryType === "directory" ? "owned-lock" : "owned-gate"}-${nonce}`;
  const leaf = path.join(container, leafName);
  const manifest = path.join(container, "owner.json");
  const manifestBytes = `${JSON.stringify({ schemaVersion: "1", nonce,
    canonicalPath: proof.canonicalPath, leafName })}\n`;
  invokeCanonicalMutationInvocation("quarantine");
  try { await mutationMkdir(container, "quarantine-publication"); }
  catch (error) {
    throw new QuarantineProtocolError(
      "PIPELINE_JOB_MUTATION_LOCK_QUARANTINE_PUBLICATION_FAILED", container, error);
  }
  const containerIdentity = await identityOf(container);
  let moved = false;
  let manifestPublished = false;
  let cleanupIdentityVerified = false;
  try {
    await mutationWriteFile(manifest, manifestBytes,
      { encoding: "utf8", flag: "wx", mode: 0o600 },
      "quarantine-publication", true);
    manifestPublished = true;
    await assertQuarantineContainer(container, proof.parentPath, containerIdentity,
      manifest, manifestBytes);
    await mutationRename(proof.canonicalPath, leaf, "canonical-to-quarantine");
    moved = true;
    if (!await matchesQuarantinedProof(leaf, proof)) {
      await invokeCanonicalMutationBarrier("foreign-quarantine-preserved");
      throw new QuarantineProtocolError(
        "PIPELINE_JOB_MUTATION_LOCK_FOREIGN_QUARANTINE_PRESERVED", leaf);
    }
    await invokeCanonicalMutationBarrier("quarantine-cleanup");
    await assertQuarantineContainer(container, proof.parentPath, containerIdentity,
      manifest, manifestBytes);
    if (!await matchesQuarantinedProof(leaf, proof)) {
      throw new QuarantineProtocolError(
        "PIPELINE_JOB_MUTATION_LOCK_QUARANTINE_CLEANUP_IDENTITY_UNVERIFIED", leaf);
    }
    cleanupIdentityVerified = true;
    if (proof.entryType === "directory") {
      for (const entry of await fs.readdir(leaf)) {
        await mutationUnlink(path.join(leaf, entry), "quarantine-cleanup");
      }
      await mutationRmdir(leaf, "quarantine-cleanup");
    } else {
      await mutationUnlink(leaf, "quarantine-cleanup");
    }
    await mutationUnlink(manifest, "quarantine-container-cleanup");
    await mutationRmdir(container, "quarantine-container-cleanup");
    moved = false;
    return Object.freeze({ decision: "cleaned-owned-quarantine", residuePath: null });
  } catch (error) {
    if (!moved) {
      try {
        await assertDirectoryIdentity(container, proof.parentPath, containerIdentity);
        const entries = await fs.readdir(container);
        const expectedEntries = manifestPublished ? ["owner.json"] : [];
        if (entries.length !== expectedEntries.length ||
          entries.some((entry, index) => entry !== expectedEntries[index])) {
          throw new Error("PIPELINE_JOB_MUTATION_LOCK_QUARANTINE_OWNER_CHANGED");
        }
        if (manifestPublished) {
          if (await fs.readFile(manifest, "utf8") !== manifestBytes) {
            throw new Error("PIPELINE_JOB_MUTATION_LOCK_QUARANTINE_OWNER_CHANGED");
          }
          await mutationUnlink(manifest, "quarantine-container-cleanup");
        }
        await mutationRmdir(container, "quarantine-container-cleanup");
      } catch (cleanupError) {
        throw new QuarantineProtocolError(
          "PIPELINE_JOB_MUTATION_LOCK_QUARANTINE_PUBLICATION_FAILED", container, cleanupError);
      }
      throw new QuarantineProtocolError(
        "PIPELINE_JOB_MUTATION_LOCK_QUARANTINE_PUBLICATION_FAILED", container, error);
    }
    if (error instanceof QuarantineProtocolError) throw error;
    if (cleanupIdentityVerified) {
      throw new QuarantineProtocolError(
        "PIPELINE_JOB_MUTATION_LOCK_CLEANUP_FAILED_AFTER_OWNED_VERIFICATION", leaf, error);
    }
    throw new QuarantineProtocolError(
      "PIPELINE_JOB_MUTATION_LOCK_QUARANTINE_IDENTITY_UNVERIFIED", leaf, error);
  }
}

async function matchesQuarantinedProof(
  leaf: string,
  proof: QuarantineRemovalProof,
): Promise<boolean> {
  try {
    const stat = await fs.lstat(leaf, { bigint: true });
    if (stat.isSymbolicLink() || stat.dev !== proof.identity.dev || stat.ino !== proof.identity.ino ||
      (proof.entryType === "directory" ? !stat.isDirectory() : !stat.isFile())) return false;
    if (proof.entryType === "file") return await fs.readFile(leaf, "utf8") === proof.ownerBytes;
    const entries = await fs.readdir(leaf);
    if (proof.directoryProof !== "publication") {
      return entries.length === 1 && entries[0] === "owner.json" &&
        await fs.readFile(path.join(leaf, "owner.json"), "utf8") === proof.ownerBytes;
    }
    const allowedEntries = proof.allowedEntries ?? [];
    if (entries.some((entry) => !allowedEntries.includes(entry))) return false;
    for (const entry of entries) {
      const entryPath = path.join(leaf, entry);
      const entryStat = await fs.lstat(entryPath);
      if (!entryStat.isFile() || entryStat.isSymbolicLink() ||
        await fs.readFile(entryPath, "utf8") !== proof.ownerBytes) return false;
    }
    return true;
  } catch { return false; }
}

async function assertQuarantineContainer(
  container: string,
  parent: string,
  identity: FileIdentity,
  manifest: string,
  manifestBytes: string,
): Promise<void> {
  if (path.dirname(container) !== parent ||
    !path.basename(container).startsWith(".pipeline-jobs.quarantine-")) {
    throw new Error("PIPELINE_JOB_MUTATION_LOCK_QUARANTINE_PATH_INVALID");
  }
  await assertDirectoryIdentity(container, parent, identity);
  if (path.dirname(manifest) !== container || await fs.readFile(manifest, "utf8") !== manifestBytes) {
    throw new Error("PIPELINE_JOB_MUTATION_LOCK_QUARANTINE_OWNER_CHANGED");
  }
}

async function invokeCanonicalMutationBarrier(target: CanonicalMutationBarrierTarget) {
  if (canonicalMutationBarrierTestHook?.target !== target) return;
  canonicalMutationBarrierTestHook.remaining -= 1;
  if (canonicalMutationBarrierTestHook.remaining > 0) return;
  const hook = canonicalMutationBarrierTestHook.hook;
  canonicalMutationBarrierTestHook = undefined;
  await hook();
}

function observeFilesystemMutation(event: CanonicalFilesystemMutationTestEvent): void {
  canonicalFilesystemMutationTestHook?.(Object.freeze({ ...event }));
}

async function mutationMkdir(
  targetPath: string,
  purpose: CanonicalFilesystemMutationTestEvent["purpose"],
): Promise<void> {
  observeFilesystemMutation({ operation: "mkdir", purpose, targetPath, exclusive: true });
  await fs.mkdir(targetPath);
}

async function mutationWriteFile(
  targetPath: string,
  bytes: string,
  options: { readonly encoding: "utf8"; readonly flag: "wx"; readonly mode: number },
  purpose: CanonicalFilesystemMutationTestEvent["purpose"],
  exclusive: boolean,
): Promise<void> {
  observeFilesystemMutation({ operation: "write", purpose, targetPath, exclusive });
  await fs.writeFile(targetPath, bytes, options);
}

async function mutationRename(
  sourcePath: string,
  destinationPath: string,
  purpose: CanonicalFilesystemMutationTestEvent["purpose"],
): Promise<void> {
  observeFilesystemMutation({ operation: "rename", purpose, sourcePath, destinationPath });
  await fs.rename(sourcePath, destinationPath);
}

async function mutationUnlink(
  targetPath: string,
  purpose: CanonicalFilesystemMutationTestEvent["purpose"],
): Promise<void> {
  observeFilesystemMutation({ operation: "unlink", purpose, targetPath });
  await fs.unlink(targetPath);
}

async function mutationRmdir(
  targetPath: string,
  purpose: CanonicalFilesystemMutationTestEvent["purpose"],
): Promise<void> {
  observeFilesystemMutation({ operation: "rmdir", purpose, targetPath });
  await fs.rmdir(targetPath);
}

function invokeCanonicalMutationInvocation(kind: CanonicalMutationKind): void {
  canonicalMutationInvocationTestHook?.(kind);
}

function isAlreadyExists(error: unknown) {
  return (error as NodeJS.ErrnoException)?.code === "EEXIST";
}

function isMissing(error: unknown) {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
