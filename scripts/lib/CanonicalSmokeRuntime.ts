import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { configureScopedProductionPipelineExecution } from
  "../../src/lib/production/ProductionPipelineExecutionConfiguration";
import { ProductionWorkerLifecycle } from
  "../../src/lib/production/ProductionWorkerLifecycle";
import {
  createProductionRuntimeOperationContext,
  initialRuntimeAuthorityGeneration,
  requireExactActiveProductionRuntimeOperationContext,
  runWithProductionRuntimeOperationContext,
  type ProductionRuntimeOperationContext,
} from "../../src/lib/runtime/ProductionRuntimeOperationContext";
import {
  createRuntimeStorageContext,
  type RuntimeStorageContext,
} from "../../src/lib/runtime/RuntimeStoragePaths";

const sharedAuthorityDirectoryName = "atolye-runtime-authority-v1";
const manifestFileName = "canonical-smoke-ownership.json";
const leaseFileName = "canonical-smoke-active.lock";
const defaultEnvironment: Readonly<Record<string, string | undefined>> = Object.freeze({
  NODE_ENV: "test",
  AI_PROVIDER: "mock", IMAGE_PROVIDER: "mock", AUDIO_PROVIDER: "mock",
  ANIMATION_PROVIDER: "mock", VIDEO_PROVIDER: "mock", VIDEO_ASSEMBLY_PROVIDER: "mock",
  THUMBNAIL_PROVIDER: "mock", YOUTUBE_PROVIDER: "mock", YOUTUBE_PUBLISH_PROVIDER: "mock",
  OPENAI_API_KEY: undefined, YOUTUBE_ACCESS_TOKEN: undefined,
  ATOLYE_DURABLE_PIPELINE_EXECUTION: undefined,
  FFMPEG_PATH: undefined, FFPROBE_PATH: undefined,
  OPENAI_TTS_TIMEOUT_MS: undefined, OPENAI_TTS_MAX_RESPONSE_BYTES: undefined,
  OPENAI_TTS_MODEL: undefined, OPENAI_TTS_VOICE: undefined,
  OPENAI_MODEL: undefined, OPENAI_MAX_TOKENS: undefined, OPENAI_TEMPERATURE: undefined,
  OPENAI_AUDIO_MAX_TOKENS: undefined, OPENAI_VISUALS_MAX_TOKENS: undefined,
  OPENAI_BASE_URL: undefined, OPENAI_API_BASE: undefined,
  IMAGE_OPENAI_TIMEOUT_MS: undefined, IMAGE_OPENAI_MAX_RESPONSE_BYTES: undefined,
  FFMPEG_TIMEOUT_MS: undefined, FFMPEG_MAX_STDIO_BYTES: undefined,
  SCENE_VIDEO_MAX_OUTPUT_BYTES: undefined, VIDEO_ASSEMBLY_MAX_OUTPUT_BYTES: undefined,
  YOUTUBE_CHANNEL_ID: undefined, YOUTUBE_OPENAI_MODEL: undefined,
  THUMBNAIL_SMOKE_SCENARIO: undefined, ATOLYE_AUTO_CONTINUATION_ISOLATED: undefined,
});

export interface CanonicalSmokeOwnershipManifest {
  readonly schemaVersion: "canonical-smoke-ownership-v2";
  readonly runId: string;
  readonly createdAt: string;
  readonly pid: number;
  readonly processStartIdentity: string;
  readonly projectSlug: string;
  readonly operationId: string;
  readonly workspaceRoot: RootEvidence;
  readonly runtimeRoot: RootEvidence;
  readonly authorityRoot: RootEvidence;
  readonly tempRoot: RootEvidence;
  readonly workspaceIdentity: SerializedIdentity;
  readonly runtimeRootIdentity: SerializedIdentity;
  readonly authorityRootIdentity: SerializedIdentity;
  readonly allowedRoots: readonly string[];
  readonly registrationConfigured: boolean;
  readonly registrationFingerprint?: string;
  readonly cleanupState: "active" | "finalizing" | "abandoned";
  readonly integrityHash: string;
}

interface RootEvidence { readonly path: string; readonly identity: SerializedIdentity }

export interface CanonicalSmokeFinalizationResult {
  readonly runId: string;
  readonly environmentRestored: boolean;
  readonly sharedAuthorityUnchanged: boolean;
  readonly cleanupCompleted: boolean;
  readonly runtimeRemainder: number;
  readonly authorityRemainder: number;
  readonly lockGateQuarantineRemainder: number;
  readonly preExistingGlobalInventory: readonly CanonicalSmokeInventoryEntry[];
  readonly newlyCreatedGlobalInventory: readonly CanonicalSmokeInventoryEntry[];
}

export interface CanonicalSmokeRuntime {
  readonly runId: string;
  readonly workspaceRoot: string;
  readonly runtimeRoot: string;
  readonly authorityRoot: string;
  readonly tempRoot: string;
  readonly projectSlug: string;
  readonly operationId: string;
  readonly runtimeStorageContext: RuntimeStorageContext;
  readonly operationContextDescriptor: Readonly<{
    operationId: string; operationBinding: string; runtimeAuthorityIdentity: string;
    storageAuthorityIdentity: string; projectSlug: string;
  }>;
  readonly productionExecutionRegistration: Readonly<{
    configured: boolean; operationId: string; operationBinding: string; fingerprint?: string;
  }>;
  readonly operationContext: ProductionRuntimeOperationContext;
  readonly workerLifecycle: ProductionWorkerLifecycle;
  readonly ownershipManifest: CanonicalSmokeOwnershipManifest;
  deferRestore(restore: () => void | Promise<void>): void;
}

export function assertCanonicalSmokeRuntimeStorageContext(
  storage: RuntimeStorageContext, workspaceRoot: string,
): void {
  const sharedAuthorityRoot = path.join(canonicalPath(os.tmpdir()), sharedAuthorityDirectoryName);
  assertRunOwnedContext(storage, workspaceRoot, sharedAuthorityRoot);
}

export function requireCanonicalSmokeOperationContext(runtime: CanonicalSmokeRuntime): void {
  requireExactActiveProductionRuntimeOperationContext(runtime.operationContext);
}

export function recoverCanonicalSmokeWorkspace(workspaceRoot: string): void {
  const workspace = canonicalPath(workspaceRoot);
  const manifestPath = path.join(workspace, manifestFileName);
  const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as CanonicalSmokeOwnershipManifest;
  if (parsed.schemaVersion !== "canonical-smoke-ownership-v2" ||
    !/^[a-f0-9]{32}$/.test(parsed.runId) || parsed.pid <= 0 ||
    parsed.integrityHash !== manifestHash(parsed)) {
    throw new Error("Canonical smoke recovery manifest is invalid.");
  }
  const roots = [parsed.workspaceRoot, parsed.runtimeRoot, parsed.authorityRoot, parsed.tempRoot];
  if (!samePath(parsed.workspaceRoot.path, workspace) ||
    parsed.allowedRoots.length !== roots.length ||
    roots.some((root, index) => !samePath(root.path, parsed.allowedRoots[index])) ||
    new Set(parsed.allowedRoots.map((root) => canonicalPath(root))).size !== roots.length ||
    roots.slice(1).some((root) => !contains(workspace, root.path))) {
    throw new Error("Canonical smoke recovery root set is invalid.");
  }
  for (const root of roots) {
    if (!sameIdentity(identity(root.path), deserialize(root.identity))) {
      throw new Error("Canonical smoke recovery root identity changed.");
    }
    rejectReparseRoot(root.path);
  }
  if (isProcessAlive(parsed.pid)) {
    throw new Error("Canonical smoke recovery refused an active run.");
  }
  const lease = JSON.parse(fs.readFileSync(path.join(workspace, leaseFileName), "utf8")) as {
    runId?: string; processStartIdentity?: string;
  };
  if (lease.runId !== parsed.runId || lease.processStartIdentity !== parsed.processStartIdentity) {
    throw new Error("Canonical smoke recovery lease identity is invalid.");
  }
  const expectedWorkspace = deserialize(parsed.workspaceRoot.identity);
  if (!sameIdentity(identity(workspace), expectedWorkspace)) {
    throw new Error("Canonical smoke recovery workspace identity changed.");
  }
  identitySafeRemoveLeaf({ workspaceRoot: workspace, expectedWorkspace,
    expectedParent: identity(path.dirname(workspace)),
    sharedAuthorityRoot: path.join(canonicalPath(os.tmpdir()), sharedAuthorityDirectoryName),
    repositoryRoot: canonicalPath(process.cwd()) });
}

export interface CanonicalSmokeRuntimeOptions {
  readonly name: string;
  readonly projectSlug?: string;
  readonly operationId?: string;
  readonly operationType?: string;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly now?: string;
  readonly configureProductionExecution?: boolean;
  readonly enterOperationContext?: boolean;
  readonly cleanupBarrier?: () => void;
  readonly postCheckPreRenameBarrier?: () => void;
  /** @internal Controlled setup failure injection. */
  readonly failureInjectionStage?: "environment" | "context" | "worker" | "registration";
  /** @internal Controlled restore error after a key has been restored. */
  readonly environmentRestoreFailureKeys?: readonly string[];
}

interface EnvironmentSnapshot { readonly present: boolean; readonly value?: string }
interface FileIdentity { readonly device: bigint; readonly inode: bigint; readonly size: bigint;
  readonly modifiedNanoseconds: bigint }
interface SerializedIdentity { readonly device: string; readonly inode: string; readonly size: string;
  readonly modifiedNanoseconds: string }
export interface CanonicalSmokeInventoryEntry { readonly relativePath: string; readonly type: "file" | "directory";
  readonly reparse: boolean; readonly device: string; readonly inode: string; readonly size: string;
  readonly mtimeNs: string; readonly contentHash?: string }

export async function withCanonicalSmokeRuntime<T>(
  options: CanonicalSmokeRuntimeOptions,
  operation: (runtime: CanonicalSmokeRuntime) => T | Promise<T>,
): Promise<{ readonly value: T; readonly finalization: CanonicalSmokeFinalizationResult }> {
  const setup = await setupCanonicalSmokeRuntime(options);
  let value: T | undefined;
  let primaryError: unknown;
  try {
    value = options.enterOperationContext === false
      ? await operation(setup.runtime)
      : await runWithProductionRuntimeOperationContext(setup.runtime.operationContext,
        () => operation(setup.runtime));
  } catch (error) {
    primaryError = error;
  }
  const finalization = await setup.finalize(primaryError);
  if (primaryError) throw primaryError;
  return { value: value as T, finalization };
}

async function setupCanonicalSmokeRuntime(options: CanonicalSmokeRuntimeOptions): Promise<{
  readonly runtime: CanonicalSmokeRuntime;
  readonly finalize: (primaryError?: unknown) => Promise<CanonicalSmokeFinalizationResult>;
}> {
  const name = safeName(options.name);
  const runId = randomUUID().replaceAll("-", "");
  const originalTempRoot = canonicalPath(os.tmpdir());
  const sharedAuthorityRoot = path.join(originalTempRoot, sharedAuthorityDirectoryName);
  const sharedBefore = inventory(sharedAuthorityRoot);
  const workspaceRoot = fs.mkdtempSync(path.join(originalTempRoot, `atolye-smoke-${name}-`));
  const runtimeRoot = path.join(workspaceRoot, "runtime");
  const authorityRoot = path.join(workspaceRoot, "authority");
  const tempRoot = path.join(workspaceRoot, "temp");
  const projectSlug = options.projectSlug ?? `${name}-${runId.slice(0, 16)}`;
  const operationId = options.operationId ?? `${name}-${runId.slice(0, 24)}`;
  const now = options.now ?? new Date().toISOString();
  const environment = { ...defaultEnvironment, ...options.environment,
    ATOLYE_RUNTIME_ROOT: runtimeRoot, ATOLYE_RUNTIME_AUTHORITY_ROOT: authorityRoot,
    TEMP: tempRoot, TMP: tempRoot };
  const environmentBefore = snapshotEnvironment(Object.keys(environment));
  const restoreStack: Array<() => void | Promise<void>> = [];
  const workspaceIdentity = identity(workspaceRoot);
  const parentIdentity = identity(path.dirname(workspaceRoot));
  const processStartIdentity = createHash("sha256")
    .update(`${process.pid}\0${runId}\0${Date.now() - Math.floor(process.uptime() * 1000)}`)
    .digest("hex");
  let finalized = false;
  let manifest: CanonicalSmokeOwnershipManifest | undefined;
  let environmentRestored = false;
  let cleanupCompleted = false;
  try {
    restoreStack.push(() => {
      if (!fs.existsSync(workspaceRoot)) return;
      identitySafeRemoveLeaf({ workspaceRoot, expectedWorkspace: workspaceIdentity,
        expectedParent: parentIdentity, sharedAuthorityRoot,
        repositoryRoot: canonicalPath(process.cwd()), barrier: options.cleanupBarrier,
        postCheckPreRenameBarrier: options.postCheckPreRenameBarrier });
      cleanupCompleted = true;
    });
    fs.mkdirSync(path.join(runtimeRoot, "projects", projectSlug, "production-execution"),
      { recursive: true });
    fs.mkdirSync(authorityRoot, { recursive: true });
    fs.mkdirSync(tempRoot, { recursive: true });
    const runtimeIdentity = identity(runtimeRoot);
    const authorityIdentity = identity(authorityRoot);
    const tempIdentity = identity(tempRoot);
    manifest = createManifest({ runId, now, processStartIdentity, projectSlug, operationId,
      workspaceRoot, workspaceIdentity, runtimeRoot, runtimeIdentity, authorityRoot,
      authorityIdentity, tempRoot, tempIdentity, registrationConfigured: false });
    writeManifest(workspaceRoot, manifest, "wx");
    fs.writeFileSync(path.join(workspaceRoot, leaseFileName), JSON.stringify({ runId,
      pid: process.pid, processStartIdentity }), { encoding: "utf8", flag: "wx" });

    applyEnvironment(environment);
    restoreStack.push(() => {
      const errors = restoreEnvironment(environmentBefore, options.environmentRestoreFailureKeys);
      environmentRestored = errors.length === 0;
      if (errors.length) throw new AggregateError(errors.slice(0, 8),
        "Canonical smoke environment restoration failed.");
    });
    injectFailure(options, "environment");
    const storage = createRuntimeStorageContext({ environment: process.env,
      workspaceRoot: process.cwd(), authorityRoot });
    assertRunOwnedContext(storage, workspaceRoot, sharedAuthorityRoot);
    const operationContext = createProductionRuntimeOperationContext({ operationId,
      operationType: options.operationType ?? "canonical-smoke-runtime",
      authorityGeneration: initialRuntimeAuthorityGeneration, storageContext: storage });
    injectFailure(options, "context");
    const worker = new ProductionWorkerLifecycle(() => now);
    worker.bindRuntimeOperationContext(operationContext);
    restoreStack.push(async () => { await worker.stop(); });
    const started = await worker.start({ initialization: {
      schemaVersion: "1", ok: true, decision: "ready", reasonCode: "RUNTIME_INITIALIZED",
      initializedAt: now, writeFree: true, partialInitialization: false, projects: [],
      counts: { active: 0, running: 0, terminal: 0, orphaned: 0,
        "expired-lease": 0, replayable: 0 }, worker: worker.snapshot(), evidence: [],
    } });
    assert.equal(started.ok, true, "Canonical smoke worker lifecycle did not become ready.");
    injectFailure(options, "worker");
    let registrationFingerprint: string | undefined;
    if (options.configureProductionExecution !== false) {
      const scoped = configureScopedProductionPipelineExecution({ lifecycle: worker,
        runtimeOperationContext: operationContext });
      registrationFingerprint = createHash("sha256").update(`${runId}\0${scoped.fingerprint}`)
        .digest("hex");
      restoreStack.push(() => scoped.restore());
    }
    injectFailure(options, "registration");
    manifest = createManifest({ runId, now, processStartIdentity, projectSlug, operationId,
      workspaceRoot, workspaceIdentity, runtimeRoot, runtimeIdentity, authorityRoot,
      authorityIdentity, tempRoot, tempIdentity,
      registrationConfigured: options.configureProductionExecution !== false,
      registrationFingerprint });
    writeManifest(workspaceRoot, manifest);
    const descriptor = frozenRecord({ operationId,
      operationBinding: operationContext.bindingFingerprint,
      runtimeAuthorityIdentity: operationContext.authority.authorityIdentity,
      storageAuthorityIdentity: operationContext.authority.resolverBindingIdentity, projectSlug });
    const registration = Object.freeze({ configured: options.configureProductionExecution !== false,
      operationId, operationBinding: operationContext.bindingFingerprint,
      ...(registrationFingerprint ? { fingerprint: registrationFingerprint } : {}) });
    const runtime: CanonicalSmokeRuntime = Object.freeze({ runId, workspaceRoot, runtimeRoot,
      authorityRoot, tempRoot, projectSlug, operationId, runtimeStorageContext: storage,
      operationContextDescriptor: descriptor, productionExecutionRegistration: registration,
      operationContext, workerLifecycle: worker, ownershipManifest: manifest,
      deferRestore(restore: () => void | Promise<void>) { restoreStack.push(restore); },
    });
    return { runtime, finalize: async (primaryError?: unknown) => {
      if (finalized) throw new Error("Canonical smoke runtime was already finalized.");
      finalized = true;
      const errors: unknown[] = [];
      try { writeManifest(workspaceRoot, withCleanupState(manifest!, "finalizing")); }
      catch (error) { errors.push(error); }
      await runRestores(restoreStack, errors);
      let sharedUnchanged = false;
      let sharedAfter: readonly CanonicalSmokeInventoryEntry[] = [];
      try {
        sharedAfter = inventory(sharedAuthorityRoot);
        assert.deepEqual(sharedAfter, sharedBefore,
          "Canonical smoke runtime touched the shared authority root.");
        sharedUnchanged = true;
      } catch (error) { errors.push(error); }
      const newlyCreatedGlobalInventory = sharedAfter.filter((entry) =>
        !sharedBefore.some((before) => JSON.stringify(before) === JSON.stringify(entry)));
      let lockGateQuarantineRemainder = 0;
      try {
        lockGateQuarantineRemainder = fs.existsSync(workspaceRoot)
          ? inventory(workspaceRoot).filter((entry) =>
            /pipeline-jobs\.(?:lock|gate|stale|quarantine)/
              .test(entry.relativePath)).length : 0;
      } catch (error) {
        lockGateQuarantineRemainder = 1;
        errors.push(error);
      }
      const result = Object.freeze({ runId, environmentRestored,
        sharedAuthorityUnchanged: sharedUnchanged, cleanupCompleted,
        runtimeRemainder: fs.existsSync(runtimeRoot) ? 1 : 0,
        authorityRemainder: fs.existsSync(authorityRoot) ? 1 : 0,
        lockGateQuarantineRemainder,
        preExistingGlobalInventory: Object.freeze([...sharedBefore]),
        newlyCreatedGlobalInventory: Object.freeze(newlyCreatedGlobalInventory) });
      if (errors.length > 0) {
        throw new AggregateError((primaryError ? [primaryError, ...errors] : errors).slice(0, 8),
          "Canonical smoke runtime finalization failed.");
      }
      return result;
    } };
  } catch (primaryError) {
    const errors: unknown[] = [];
    await runRestores(restoreStack, errors);
    try { assert.deepEqual(inventory(sharedAuthorityRoot), sharedBefore); }
    catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError([primaryError, ...errors].slice(0, 8),
      "Canonical smoke runtime setup rollback failed.");
    throw primaryError;
  }
}

function identitySafeRemoveLeaf(input: { workspaceRoot: string; expectedWorkspace: FileIdentity;
  expectedParent: FileIdentity; sharedAuthorityRoot: string; repositoryRoot: string;
  barrier?: () => void; postCheckPreRenameBarrier?: () => void }): void {
  const workspace = canonicalPath(input.workspaceRoot);
  const parent = canonicalPath(path.dirname(workspace));
  if (samePath(workspace, input.sharedAuthorityRoot) || samePath(workspace, input.repositoryRoot) ||
    contains(workspace, input.repositoryRoot) || contains(input.repositoryRoot, workspace) ||
    !sameIdentity(identity(parent), input.expectedParent)) {
    throw new Error("Canonical smoke cleanup root is unsafe.");
  }
  if (!sameIdentity(identity(workspace), input.expectedWorkspace)) {
    throw new Error("Canonical smoke cleanup root identity changed.");
  }
  rejectReparseRoot(workspace);
  input.barrier?.();
  if (!sameIdentity(identity(workspace), input.expectedWorkspace)) {
    throw new Error("Canonical smoke cleanup root changed at the cleanup barrier.");
  }
  input.postCheckPreRenameBarrier?.();
  const quarantine = `${workspace}.cleanup-${randomUUID().replaceAll("-", "")}`;
  fs.renameSync(workspace, quarantine);
  let moved: FileIdentity;
  try { moved = identity(quarantine); }
  catch (error) {
    if (!fs.existsSync(workspace) && fs.existsSync(quarantine)) fs.renameSync(quarantine, workspace);
    throw error;
  }
  if (!sameIdentity(moved, input.expectedWorkspace)) {
    if (!fs.existsSync(workspace)) fs.renameSync(quarantine, workspace);
    throw new Error("Canonical smoke cleanup foreign replacement was preserved.");
  }
  rejectReparseRoot(quarantine);
  if (!sameIdentity(identity(quarantine), input.expectedWorkspace)) {
    throw new Error("Canonical smoke cleanup quarantine identity changed.");
  }
  fs.rmSync(quarantine, { recursive: true, force: false, maxRetries: 5, retryDelay: 20 });
  if (fs.existsSync(workspace) || fs.existsSync(quarantine)) {
    throw new Error("Canonical smoke cleanup left a run-owned remainder.");
  }
}

export function inventoryCanonicalSmokeTree(root: string): readonly CanonicalSmokeInventoryEntry[] {
  if (!fs.existsSync(root)) return Object.freeze([]);
  const rootLink = fs.lstatSync(root, { bigint: true });
  if (!rootLink.isDirectory() || rootLink.isSymbolicLink()) {
    throw new Error("Shared authority root is not a canonical directory.");
  }
  const entries: CanonicalSmokeInventoryEntry[] = [];
  const visit = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => codeUnitCompare(left.name, right.name))) {
      const target = path.join(directory, entry.name);
      const stat = fs.lstatSync(target, { bigint: true });
      const relativePath = path.relative(root, target).split(path.sep).join("/");
      const reparse = stat.isSymbolicLink() ||
        (Number(stat.mode) & 0o170000) === 0o120000;
      if (reparse) throw new Error("Shared authority inventory encountered a reparse entry.");
      if (stat.isDirectory()) {
        entries.push({ relativePath, type: "directory", reparse, device: String(stat.dev),
          inode: String(stat.ino), size: String(stat.size), mtimeNs: String(stat.mtimeNs) });
        visit(target);
      } else if (stat.isFile()) {
        entries.push({ relativePath, type: "file", reparse, device: String(stat.dev),
          inode: String(stat.ino), size: String(stat.size),
          mtimeNs: String(stat.mtimeNs), contentHash: fileHash(target) });
      } else throw new Error("Shared authority inventory encountered an unsupported entry.");
    }
  };
  visit(root);
  return Object.freeze(entries);
}

const inventory = inventoryCanonicalSmokeTree;

function rejectReparseRoot(root: string): void {
  const stat = fs.lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("Canonical smoke cleanup rejects a reparse leaf root.");
  }
}

function assertRunOwnedContext(storage: RuntimeStorageContext, workspaceRoot: string,
  sharedAuthorityRoot: string): void {
  if (!contains(workspaceRoot, storage.runtimeRoot) || !contains(workspaceRoot, storage.projectsRoot) ||
    !contains(workspaceRoot, storage.authorityRoot) || samePath(storage.authorityRoot, sharedAuthorityRoot)) {
    throw new Error("Canonical smoke runtime resolved an implicit or foreign authority root.");
  }
  const repositoryProjects = path.join(process.cwd(), "data", "projects");
  if (samePath(storage.projectsRoot, repositoryProjects)) {
    throw new Error("Canonical smoke runtime resolved repository data/projects.");
  }
}

function snapshotEnvironment(keys: readonly string[]): ReadonlyMap<string, EnvironmentSnapshot> {
  return new Map(keys.map((key) => [key, Object.prototype.hasOwnProperty.call(process.env, key)
    ? { present: true, value: process.env[key] } : { present: false }]));
}
function applyEnvironment(values: Readonly<Record<string, string | undefined>>): void {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
}
function restoreEnvironment(values: ReadonlyMap<string, EnvironmentSnapshot>,
  controlledFailureKeys: readonly string[] = []): unknown[] {
  const errors: unknown[] = [];
  for (const [key, value] of values) {
    try {
      if (!value.present) delete process.env[key]; else process.env[key] = value.value!;
      if (controlledFailureKeys.includes(key)) {
        throw new Error(`Canonical smoke controlled environment restore failure: ${key}`);
      }
    } catch (error) { errors.push(error); }
  }
  return errors;
}

async function runRestores(stack: Array<() => void | Promise<void>>, errors: unknown[]): Promise<void> {
  for (const restore of stack.reverse()) {
    try { await restore(); } catch (error) {
      if (error instanceof AggregateError) errors.push(...error.errors);
      else errors.push(error);
    }
  }
}

function injectFailure(options: CanonicalSmokeRuntimeOptions,
  stage: NonNullable<CanonicalSmokeRuntimeOptions["failureInjectionStage"]>): void {
  if (options.failureInjectionStage === stage) {
    throw new Error(`Canonical smoke controlled setup failure: ${stage}`);
  }
}

function createManifest(input: {
  runId: string; now: string; processStartIdentity: string; projectSlug: string; operationId: string;
  workspaceRoot: string; workspaceIdentity: FileIdentity; runtimeRoot: string; runtimeIdentity: FileIdentity;
  authorityRoot: string; authorityIdentity: FileIdentity; tempRoot: string; tempIdentity: FileIdentity;
  registrationConfigured: boolean; registrationFingerprint?: string;
}): CanonicalSmokeOwnershipManifest {
  const withoutHash = {
    schemaVersion: "canonical-smoke-ownership-v2" as const, runId: input.runId,
    createdAt: input.now, pid: process.pid, processStartIdentity: input.processStartIdentity,
    projectSlug: input.projectSlug, operationId: input.operationId,
    workspaceRoot: rootEvidence(input.workspaceRoot, input.workspaceIdentity),
    runtimeRoot: rootEvidence(input.runtimeRoot, input.runtimeIdentity),
    authorityRoot: rootEvidence(input.authorityRoot, input.authorityIdentity),
    tempRoot: rootEvidence(input.tempRoot, input.tempIdentity),
    workspaceIdentity: serialize(input.workspaceIdentity),
    runtimeRootIdentity: serialize(input.runtimeIdentity),
    authorityRootIdentity: serialize(input.authorityIdentity),
    allowedRoots: Object.freeze([input.workspaceRoot, input.runtimeRoot,
      input.authorityRoot, input.tempRoot]),
    registrationConfigured: input.registrationConfigured,
    ...(input.registrationFingerprint ? { registrationFingerprint: input.registrationFingerprint } : {}),
    cleanupState: "active" as const,
  };
  return Object.freeze({ ...withoutHash, integrityHash: manifestHash(withoutHash) });
}

function rootEvidence(value: string, fileIdentity: FileIdentity): RootEvidence {
  return Object.freeze({ path: value, identity: serialize(fileIdentity) });
}

function withCleanupState(manifest: CanonicalSmokeOwnershipManifest,
  cleanupState: CanonicalSmokeOwnershipManifest["cleanupState"]): CanonicalSmokeOwnershipManifest {
  const { integrityHash: _ignored, ...withoutHash } = manifest;
  void _ignored;
  return Object.freeze({ ...withoutHash, cleanupState,
    integrityHash: manifestHash({ ...withoutHash, cleanupState }) });
}

function manifestHash(value: Omit<CanonicalSmokeOwnershipManifest, "integrityHash"> |
  CanonicalSmokeOwnershipManifest): string {
  const copy = { ...(value as CanonicalSmokeOwnershipManifest) } as Record<string, unknown>;
  delete copy.integrityHash;
  return createHash("sha256").update(stableJson(copy)).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => codeUnitCompare(left, right))
    .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`).join(",")}}`;
  return JSON.stringify(value);
}

function writeManifest(workspaceRoot: string, manifest: CanonicalSmokeOwnershipManifest,
  flag?: "wx"): void {
  fs.writeFileSync(path.join(workspaceRoot, manifestFileName), JSON.stringify(manifest, null, 2),
    { encoding: "utf8", ...(flag ? { flag } : {}) });
}

function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}
function identity(target: string): FileIdentity {
  const stat = fs.lstatSync(target, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink() ||
    stat.dev <= BigInt(0) || stat.ino <= BigInt(0)) {
    throw new Error("Canonical smoke root identity is unavailable.");
  }
  return { device: stat.dev, inode: stat.ino, size: stat.size,
    modifiedNanoseconds: stat.mtimeNs };
}
function serialize(value: FileIdentity): SerializedIdentity {
  return { device: String(value.device), inode: String(value.inode), size: String(value.size),
    modifiedNanoseconds: String(value.modifiedNanoseconds) };
}
function deserialize(value: SerializedIdentity): FileIdentity {
  return { device: BigInt(value.device), inode: BigInt(value.inode), size: BigInt(value.size),
    modifiedNanoseconds: BigInt(value.modifiedNanoseconds) };
}
function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.device === right.device && left.inode === right.inode;
}
function contains(parent: string, child: string): boolean {
  const relative = path.relative(canonicalPath(parent), canonicalPath(child));
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}
function samePath(left: string, right: string): boolean {
  return path.relative(canonicalPath(left), canonicalPath(right)) === "";
}
function canonicalPath(value: string): string {
  const resolved = path.resolve(value);
  return fs.existsSync(resolved) ? fs.realpathSync.native(resolved) : path.normalize(resolved);
}
function safeName(value: string): string {
  const result = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (!result || result.length > 48) throw new TypeError("Canonical smoke name is invalid.");
  return result;
}
function frozenRecord<T extends Record<string, string>>(values: T): Readonly<T> {
  const output = Object.create(null) as T;
  for (const [key, value] of Object.entries(values)) Object.defineProperty(output, key,
    { value, enumerable: true, writable: false, configurable: false });
  return Object.freeze(output);
}
function fileHash(value: string): string {
  return createHash("sha256").update(fs.readFileSync(value)).digest("hex");
}
function codeUnitCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
