import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  assertPathContained,
  createIsolatedRuntimeStorageContext,
  validateSafeAncestorChain,
} from "@/lib/runtime/RuntimeStoragePaths";
import { assertMigrationConsumeRootsDisjoint } from "@/lib/runtime/security/RuntimeProtectedRoots";
import { assertRuntimeBackupMaterializedPath } from "@/lib/runtime/backup/RuntimeBackupPathPolicy";
import {
  collectRuntimeBackupInventory,
} from "@/lib/runtime/backup/RuntimeBackupInventory";
import {
  aggregateRuntimeFileRecords,
  type RuntimeBackupFileRecord,
} from "@/lib/runtime/backup/RuntimeBackupManifest";
import { verifyRuntimeTreeAgainstManifest } from "@/lib/runtime/backup/RuntimeBackupVerifier";
import { runtimeAuthorityProjectsContentDigest } from "@/lib/runtime/security/RuntimeAuthorityTransition";
import { ProductionExecutionDurableRecoveryService } from "@/lib/production/ProductionExecutionPersistence";
import {
  runtimeMigrationCandidateDirName,
  serializeRuntimeMigrationCandidateManifest,
  type RuntimeMigrationCandidateManifest,
} from "./RuntimeMigrationCandidateManifest";
import { validateMigrationCandidateId } from "./RuntimeMigrationCandidatePaths";
import {
  runtimeBackupManifestFromCandidateManifest,
  verifyMigrationCandidate,
  verifyMigrationCandidateBinding,
} from "./RuntimeMigrationCandidateVerifier";
import {
  migrationConsumeError,
  RuntimeMigrationCandidateConsumeError,
} from "./RuntimeMigrationCandidateConsumeError";

/**
 * C.2B.10a — Verified Candidate Consume & Offline Materialization.
 *
 *   VERIFIED candidate artifact
 *     → empty exclusive relocation target
 *     → safe per-file materialization (SHA-256 readback, no-clobber, no symlink)
 *     → post-copy inventory + candidate manifest binding + byte-exact digest
 *     → durable-execution aggregate + read-only recovery scan
 *     → immutable consume result
 *
 * This service NEVER publishes authority, declares a live root, writes
 * `active-authority.json`, or touches `.env.local`. It only materialises a
 * verified candidate into an empty exclusive target and proves it byte-exact.
 * `cutoverAuthorized` is always `false`.
 */

export const runtimeMigrationConsumeStateSchemaVersion = "1" as const;
const consumeMetadataDirectoryName = ".migration-consume";
const consumeStateFileName = "state.json";
const consumeResultFileName = "result.json";
const projectsDirectoryName = "projects";

export type RuntimeMigrationCandidateConsumeState =
  | "created"
  | "validating"
  | "materializing"
  | "materialized"
  | "verifying"
  | "verified"
  | "consumed"
  | "failed";

const forwardConsumeStates: Readonly<
  Record<RuntimeMigrationCandidateConsumeState, readonly RuntimeMigrationCandidateConsumeState[]>
> = Object.freeze({
  created: ["validating", "failed"],
  validating: ["materializing", "failed"],
  materializing: ["materialized", "failed"],
  materialized: ["verifying", "failed"],
  verifying: ["verified", "failed"],
  verified: ["consumed", "failed"],
  consumed: [],
  failed: ["validating"],
});

export interface RuntimeMigrationCandidateConsumeInput {
  /** Stable, operator-chosen id for this consume attempt (idempotency key). */
  readonly consumeId: string;
  /** The `candidate-<64hex>` id the caller expects (the full cryptographic identity). */
  readonly candidateId: string;
  /** The verified candidate directory (`…/candidates/c-<24hex>`). */
  readonly candidateDirectory: string;
  /** The exclusive, empty relocation target root; `projects/` is materialised under it. */
  readonly relocationTargetRoot: string;
  /** The current live projects root — for the SEC1 disjointness contract. */
  readonly liveProjectsRoot: string;
  /** Optional verified backup directory the candidate must be bound to. */
  readonly backupDirectory?: string;
  /** Optional quarantine root — for the SEC1 disjointness contract. */
  readonly quarantineRoot?: string;
  /** Optional: the full expected candidate manifest (exact-serialisation binding). */
  readonly expectedCandidateManifest?: RuntimeMigrationCandidateManifest;
  /** Optional cross-checks against the candidate payload. */
  readonly expectedContentDigest?: string;
  readonly expectedFileCount?: number;
  readonly expectedByteCount?: number;
  readonly now?: () => string;
  /** Smoke fixtures only — allow roots under `os.tmpdir()`. */
  readonly allowTestTempRoot?: boolean;
}

export interface RuntimeMigrationCandidateConsumeResult {
  readonly consumed: true;
  readonly consumeId: string;
  readonly candidateId: string;
  readonly candidateManifestSha256: string;
  readonly relocationTargetRoot: string;
  readonly targetProjectsRoot: string;
  readonly contentDigest: string;
  readonly fileCount: number;
  readonly byteCount: number;
  readonly candidateAggregate: string;
  readonly durableExecutionBinding: {
    readonly files: number;
    readonly bytes: number;
    readonly aggregateFingerprint: string;
  };
  readonly durableRecoveryDecision: "clean" | "recovery-required" | "indeterminate";
  readonly state: "consumed";
  readonly resumed: boolean;
  readonly cutoverAuthorized: false;
}

interface ConsumeStateFile {
  readonly schemaVersion: typeof runtimeMigrationConsumeStateSchemaVersion;
  readonly consumeId: string;
  readonly candidateId: string;
  readonly candidateManifestSha256: string;
  readonly state: RuntimeMigrationCandidateConsumeState;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly history: readonly { readonly state: RuntimeMigrationCandidateConsumeState; readonly at: string }[];
}

const consumeIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{2,127}$/;

export interface RuntimeMigrationCandidateConsumeDependencies {
  /** Fired after each consume state transition (crash-safety testing). */
  readonly observeState?: (state: RuntimeMigrationCandidateConsumeState) => void;
  /** Fired after each file is materialised + per-file verified. */
  readonly afterFileMaterialized?: (index: number, relativePath: string) => void;
}

export class RuntimeMigrationCandidateConsumeService {
  static async consumeVerifiedMigrationCandidate(
    input: RuntimeMigrationCandidateConsumeInput,
    dependencies: RuntimeMigrationCandidateConsumeDependencies = {},
  ): Promise<RuntimeMigrationCandidateConsumeResult> {
    try {
      return await consumeInternal(input, dependencies);
    } catch (error) {
      throw migrationConsumeError(error, "CONSUME_INCOMPLETE");
    }
  }
}

async function consumeInternal(
  input: RuntimeMigrationCandidateConsumeInput,
  dependencies: RuntimeMigrationCandidateConsumeDependencies,
): Promise<RuntimeMigrationCandidateConsumeResult> {
  const now = input.now ?? (() => new Date().toISOString());

  /* ---------------------------------------------------------- 1. inputs --- */

  if (!consumeIdPattern.test(String(input.consumeId ?? ""))) {
    throw new RuntimeMigrationCandidateConsumeError("CONSUME_INPUT_INVALID");
  }
  let candidateId: string;
  try {
    candidateId = validateMigrationCandidateId(input.candidateId);
  } catch {
    throw new RuntimeMigrationCandidateConsumeError("CONSUME_INPUT_INVALID");
  }
  const candidateDirectory = requireSafeExistingDirectory(input.candidateDirectory);
  const liveProjectsRoot = requireSafePath(input.liveProjectsRoot);
  const backupDirectory = input.backupDirectory
    ? requireSafeExistingDirectory(input.backupDirectory)
    : undefined;
  const quarantineRoot = input.quarantineRoot ? requireSafePath(input.quarantineRoot) : undefined;
  const relocationTargetRoot = ensureRelocationTargetRoot(input.relocationTargetRoot);

  if (path.basename(candidateDirectory) !== runtimeMigrationCandidateDirName(candidateId)) {
    throw new RuntimeMigrationCandidateConsumeError("CANDIDATE_BINDING_MISMATCH");
  }

  /* ------------------------------------------------------ 2. candidate --- */

  let verification;
  try {
    verification = verifyMigrationCandidate(candidateDirectory);
  } catch {
    throw new RuntimeMigrationCandidateConsumeError("CANDIDATE_NOT_VERIFIED");
  }
  if (verification.candidateId !== candidateId) {
    throw new RuntimeMigrationCandidateConsumeError("CANDIDATE_BINDING_MISMATCH");
  }
  const candidateManifest = verification.manifest;
  const candidateManifestSha256 = verification.manifestSha256;

  if (input.expectedCandidateManifest) {
    let expectedSerialized: string;
    try {
      expectedSerialized = serializeRuntimeMigrationCandidateManifest(input.expectedCandidateManifest);
    } catch {
      throw new RuntimeMigrationCandidateConsumeError("MANIFEST_BINDING_MISMATCH");
    }
    const actualSerialized = serializeRuntimeMigrationCandidateManifest(candidateManifest);
    if (expectedSerialized !== actualSerialized) {
      throw new RuntimeMigrationCandidateConsumeError("MANIFEST_BINDING_MISMATCH");
    }
  }

  if (backupDirectory) {
    try {
      verifyMigrationCandidateBinding(candidateDirectory, backupDirectory);
    } catch {
      throw new RuntimeMigrationCandidateConsumeError("BACKUP_BINDING_MISMATCH");
    }
  }

  // F13: the candidate payload tree is `<candidateDirectory>/projects` (no `payload/`).
  const candidateProjectsRoot = path.join(candidateDirectory, projectsDirectoryName);
  requireSafeExistingDirectory(candidateProjectsRoot);

  const sourceContent = safeContentDigest(candidateProjectsRoot);
  const manifestFileCount = candidateManifest.inventory.files;
  const manifestByteCount = candidateManifest.inventory.bytes;
  if (sourceContent.fileCount !== manifestFileCount) {
    throw new RuntimeMigrationCandidateConsumeError("CANDIDATE_NOT_VERIFIED");
  }
  if (
    (input.expectedContentDigest !== undefined && input.expectedContentDigest !== sourceContent.contentDigest) ||
    (input.expectedFileCount !== undefined && input.expectedFileCount !== manifestFileCount) ||
    (input.expectedByteCount !== undefined && input.expectedByteCount !== manifestByteCount)
  ) {
    throw new RuntimeMigrationCandidateConsumeError("CANDIDATE_BINDING_MISMATCH");
  }

  /* ---------------------------------------------------- 3. SEC1 roots --- */

  try {
    assertMigrationConsumeRootsDisjoint({
      liveProjects: liveProjectsRoot,
      candidate: candidateDirectory,
      relocationTarget: relocationTargetRoot,
      ...(backupDirectory ? { backup: backupDirectory } : {}),
      ...(quarantineRoot ? { quarantine: quarantineRoot } : {}),
    });
  } catch {
    throw new RuntimeMigrationCandidateConsumeError("MIGRATION_PROTECTED_ROOT_OVERLAP");
  }

  /* ---------------------------------- 4. target contract / resume ------- */

  const metadataDirectory = path.join(relocationTargetRoot, consumeMetadataDirectoryName);
  const statePath = path.join(metadataDirectory, consumeStateFileName);
  const targetProjectsRoot = path.join(relocationTargetRoot, projectsDirectoryName);

  const existingState = readConsumeState(statePath);
  let resumed = false;

  if (existingState) {
    if (existingState.consumeId !== input.consumeId) {
      throw new RuntimeMigrationCandidateConsumeError("MIGRATION_TARGET_NOT_EMPTY");
    }
    if (
      existingState.candidateId !== candidateId ||
      existingState.candidateManifestSha256 !== candidateManifestSha256
    ) {
      throw new RuntimeMigrationCandidateConsumeError("CONSUME_ID_CANDIDATE_MISMATCH");
    }
    if (existingState.state === "consumed") {
      // Idempotent: re-prove byte-exact, then return.
      const check = await verifyMaterializedTarget(
        relocationTargetRoot,
        targetProjectsRoot,
        candidateManifest,
        sourceContent,
        manifestByteCount,
      );
      const idempotentResult = buildResult(
        input, candidateId, candidateManifestSha256, relocationTargetRoot, targetProjectsRoot,
        sourceContent, manifestFileCount, manifestByteCount, candidateManifest, check, true,
      );
      writeResultFile(metadataDirectory, idempotentResult);
      return idempotentResult;
    }
    // Any non-consumed state: the target was never live. Wipe projects/ and restart.
    resetIncompleteTarget(relocationTargetRoot, targetProjectsRoot);
    resumed = true;
  } else {
    assertFreshRelocationTarget(relocationTargetRoot, metadataDirectory);
    fs.mkdirSync(metadataDirectory, { recursive: true });
  }

  let state: ConsumeStateFile = writeConsumeState(statePath, {
    schemaVersion: runtimeMigrationConsumeStateSchemaVersion,
    consumeId: input.consumeId,
    candidateId,
    candidateManifestSha256,
    state: "created",
    createdAt: existingState?.createdAt ?? now(),
    updatedAt: now(),
    history: [{ state: "created", at: now() }],
  });
  dependencies.observeState?.("created");
  state = advance(statePath, state, "validating", now, dependencies);

  /* --------------------------------------------- 5. materialization ---- */

  state = advance(statePath, state, "materializing", now, dependencies);
  fs.mkdirSync(targetProjectsRoot, { recursive: true });
  validateSafeAncestorChain(targetProjectsRoot);

  const sortedFiles = [...candidateManifest.files].sort((a, b) =>
    a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0);

  for (let i = 0; i < sortedFiles.length; i += 1) {
    materializeOneFile(candidateProjectsRoot, targetProjectsRoot, sortedFiles[i]);
    dependencies.afterFileMaterialized?.(i, sortedFiles[i].relativePath);
  }
  state = advance(statePath, state, "materialized", now, dependencies);

  /* ------------------------------------------------- 6. verification --- */

  state = advance(statePath, state, "verifying", now, dependencies);
  const check = await verifyMaterializedTarget(
    relocationTargetRoot,
    targetProjectsRoot,
    candidateManifest,
    sourceContent,
    manifestByteCount,
  );
  state = advance(statePath, state, "verified", now, dependencies);

  /* --------------------------------------------------- 7. consumed ----- */

  advance(statePath, state, "consumed", now, dependencies);
  const result = buildResult(
    input, candidateId, candidateManifestSha256, relocationTargetRoot, targetProjectsRoot,
    sourceContent, manifestFileCount, manifestByteCount, candidateManifest, check, resumed,
  );
  writeResultFile(metadataDirectory, result);
  return result;
}

/* ================================================================ helpers */

interface MaterializedCheck {
  readonly contentDigest: string;
  readonly fileCount: number;
  readonly byteCount: number;
  readonly durableExecutionBinding: {
    readonly files: number;
    readonly bytes: number;
    readonly aggregateFingerprint: string;
  };
  readonly durableRecoveryDecision: "clean" | "recovery-required" | "indeterminate";
}

async function verifyMaterializedTarget(
  relocationTargetRoot: string,
  targetProjectsRoot: string,
  candidateManifest: RuntimeMigrationCandidateManifest,
  sourceContent: { contentDigest: string; fileCount: number },
  manifestByteCount: number,
): Promise<MaterializedCheck> {
  requireSafeExistingDirectory(targetProjectsRoot);

  // (a) full tree ↔ candidate manifest (git-insensitive: relativePath / size /
  //     sha256 / permissionClass / projectSlug / classification / aggregate / totals)
  try {
    verifyRuntimeTreeAgainstManifest(
      targetProjectsRoot,
      runtimeBackupManifestFromCandidateManifest(candidateManifest),
    );
  } catch {
    throw new RuntimeMigrationCandidateConsumeError("POST_COPY_INVENTORY_MISMATCH");
  }

  // (b) byte-exact content digest ↔ candidate payload (F3 primitive)
  const targetContent = safeContentDigest(targetProjectsRoot);
  if (targetContent.contentDigest !== sourceContent.contentDigest) {
    throw new RuntimeMigrationCandidateConsumeError("POST_COPY_DIGEST_MISMATCH");
  }
  if (targetContent.fileCount !== sourceContent.fileCount) {
    throw new RuntimeMigrationCandidateConsumeError("POST_COPY_FILE_COUNT_MISMATCH");
  }

  // (c) independent inventory for byte-count + durable binding
  const targetContext = createIsolatedRuntimeStorageContext({
    workspaceRoot: relocationTargetRoot,
    environment: { ATOLYE_RUNTIME_ROOT: relocationTargetRoot },
  });
  const targetManifest = collectRuntimeBackupInventory({
    context: targetContext,
    now: () => candidateManifest.createdAt,
  });
  if (targetManifest.inventory.files !== candidateManifest.inventory.files) {
    throw new RuntimeMigrationCandidateConsumeError("POST_COPY_FILE_COUNT_MISMATCH");
  }
  if (
    targetManifest.inventory.bytes !== manifestByteCount ||
    targetManifest.inventory.bytes !== candidateManifest.inventory.bytes
  ) {
    throw new RuntimeMigrationCandidateConsumeError("POST_COPY_BYTE_COUNT_MISMATCH");
  }

  const durable = durableBindingOf(targetManifest.files);
  const expectedDurable = candidateManifest.durableExecutionBinding;
  if (
    durable.files !== expectedDurable.files ||
    durable.bytes !== expectedDurable.bytes ||
    durable.aggregateFingerprint !== expectedDurable.aggregateFingerprint
  ) {
    throw new RuntimeMigrationCandidateConsumeError("DURABLE_BINDING_MISMATCH");
  }

  // (d) read-only durable-execution recovery scan per project
  const decision = await scanDurableRecovery(targetProjectsRoot);
  if (decision === "recovery-required") {
    throw new RuntimeMigrationCandidateConsumeError("DURABLE_RECOVERY_REQUIRED");
  }

  return {
    contentDigest: targetContent.contentDigest,
    fileCount: targetContent.fileCount,
    byteCount: targetManifest.inventory.bytes,
    durableExecutionBinding: durable,
    durableRecoveryDecision: decision,
  };
}

function materializeOneFile(
  candidateProjectsRoot: string,
  targetProjectsRoot: string,
  file: RuntimeBackupFileRecord,
): void {
  try {
    assertRuntimeBackupMaterializedPath(candidateProjectsRoot, file.relativePath);
    assertRuntimeBackupMaterializedPath(targetProjectsRoot, file.relativePath);
  } catch {
    throw new RuntimeMigrationCandidateConsumeError("MIGRATION_PATH_POLICY_VIOLATION");
  }

  const sourceAbs = safeJoin(candidateProjectsRoot, file.relativePath);
  const link = fs.lstatSync(sourceAbs);
  if (link.isSymbolicLink() || !link.isFile()) {
    throw new RuntimeMigrationCandidateConsumeError("MIGRATION_UNSUPPORTED_FILE_TYPE");
  }
  const data = fs.readFileSync(sourceAbs);
  const sourceSha = sha256(data);
  if (sourceSha !== file.sha256 || data.byteLength !== file.sizeBytes) {
    // Candidate mutated after verifyMigrationCandidate.
    throw new RuntimeMigrationCandidateConsumeError("MATERIALIZATION_FAILED");
  }

  const targetAbs = safeJoin(targetProjectsRoot, file.relativePath);
  fs.mkdirSync(path.dirname(targetAbs), { recursive: true });
  validateSafeAncestorChain(path.dirname(targetAbs));

  const mode = file.permissionClass === "executable" ? 0o700 : 0o600;
  let fd: number | undefined;
  try {
    fd = fs.openSync(targetAbs, "wx", mode);
    fs.writeSync(fd, data);
    fs.fsyncSync(fd);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "EEXIST") {
      throw new RuntimeMigrationCandidateConsumeError("MATERIALIZATION_FAILED");
    }
    throw error;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }

  const written = fs.lstatSync(targetAbs);
  if (written.isSymbolicLink() || !written.isFile() || written.size !== file.sizeBytes) {
    throw new RuntimeMigrationCandidateConsumeError("MATERIALIZATION_FAILED");
  }
  const targetSha = sha256(fs.readFileSync(targetAbs));
  if (targetSha !== file.sha256) {
    throw new RuntimeMigrationCandidateConsumeError("MATERIALIZATION_FAILED");
  }
}

function durableBindingOf(files: readonly RuntimeBackupFileRecord[]) {
  const durable = files.filter((file) => file.classification === "durable-execution");
  return Object.freeze({
    files: durable.length,
    bytes: durable.reduce((sum, file) => sum + file.sizeBytes, 0),
    aggregateFingerprint: aggregateRuntimeFileRecords(durable),
  });
}

async function scanDurableRecovery(
  targetProjectsRoot: string,
): Promise<"clean" | "recovery-required" | "indeterminate"> {
  let worst: "clean" | "recovery-required" | "indeterminate" = "clean";
  let slugs: fs.Dirent[];
  try {
    slugs = fs.readdirSync(targetProjectsRoot, { withFileTypes: true });
  } catch {
    return "indeterminate";
  }
  for (const entry of slugs) {
    if (!entry.isDirectory() || !/^[a-zA-Z0-9-_]+$/.test(entry.name)) continue;
    const store = path.join(targetProjectsRoot, entry.name, "production-execution");
    if (!fs.existsSync(store)) continue;
    let result;
    try {
      result = await new ProductionExecutionDurableRecoveryService({
        trustedRootDirectory: store,
      }).scan();
    } catch {
      worst = "indeterminate";
      continue;
    }
    if (result.decision === "recovery-required") return "recovery-required";
    if (result.decision === "indeterminate") worst = "indeterminate";
  }
  return worst;
}

/* ---------------------------------------------------------- path guards --- */

function requireSafePath(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value ||
    value !== value.trim() ||
    /[\0\r\n]/.test(value) ||
    !path.isAbsolute(value) ||
    value.split(/[\\/]/).includes("..")
  ) {
    throw new RuntimeMigrationCandidateConsumeError("CONSUME_INPUT_INVALID");
  }
  const resolved = path.resolve(value);
  if (resolved === path.parse(resolved).root) {
    throw new RuntimeMigrationCandidateConsumeError("CONSUME_INPUT_INVALID");
  }
  return resolved;
}

function requireSafeExistingDirectory(value: unknown): string {
  const resolved = requireSafePath(value);
  try {
    validateSafeAncestorChain(resolved);
    const link = fs.lstatSync(resolved);
    const real = fs.realpathSync(resolved);
    if (link.isSymbolicLink() || !link.isDirectory() || !samePath(real, resolved)) {
      throw new RuntimeMigrationCandidateConsumeError("MIGRATION_UNSUPPORTED_FILE_TYPE");
    }
    return real;
  } catch (error) {
    if (error instanceof RuntimeMigrationCandidateConsumeError) throw error;
    throw new RuntimeMigrationCandidateConsumeError("CONSUME_INPUT_INVALID");
  }
}

function ensureRelocationTargetRoot(value: unknown): string {
  const resolved = requireSafePath(value);
  if (fs.existsSync(resolved)) {
    return requireSafeExistingDirectory(resolved);
  }
  const parent = path.dirname(resolved);
  try {
    validateSafeAncestorChain(parent);
    const parentLink = fs.lstatSync(parent);
    if (parentLink.isSymbolicLink() || !parentLink.isDirectory()) {
      throw new RuntimeMigrationCandidateConsumeError("MIGRATION_TARGET_INVALID");
    }
  } catch (error) {
    if (error instanceof RuntimeMigrationCandidateConsumeError) throw error;
    throw new RuntimeMigrationCandidateConsumeError("MIGRATION_TARGET_INVALID");
  }
  fs.mkdirSync(resolved, { recursive: false });
  return requireSafeExistingDirectory(resolved);
}

function assertFreshRelocationTarget(relocationTargetRoot: string, metadataDirectory: string): void {
  const entries = fs.readdirSync(relocationTargetRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === consumeMetadataDirectoryName) {
      // present without a state file we could read → corrupt / foreign metadata
      if (fs.existsSync(path.join(metadataDirectory, consumeStateFileName))) continue;
      throw new RuntimeMigrationCandidateConsumeError("MIGRATION_TARGET_NOT_EMPTY");
    }
    throw new RuntimeMigrationCandidateConsumeError("MIGRATION_TARGET_NOT_EMPTY");
  }
}

function resetIncompleteTarget(relocationTargetRoot: string, targetProjectsRoot: string): void {
  if (!fs.existsSync(targetProjectsRoot)) return;
  assertPathContained(relocationTargetRoot, targetProjectsRoot);
  if (path.basename(targetProjectsRoot) !== projectsDirectoryName) {
    throw new RuntimeMigrationCandidateConsumeError("CONSUME_STATE_CORRUPT");
  }
  const link = fs.lstatSync(targetProjectsRoot);
  if (link.isSymbolicLink() || !link.isDirectory()) {
    throw new RuntimeMigrationCandidateConsumeError("MIGRATION_UNSUPPORTED_FILE_TYPE");
  }
  fs.rmSync(targetProjectsRoot, { recursive: true, force: true });
}

/* --------------------------------------------------------- state file ---- */

function readConsumeState(statePath: string): ConsumeStateFile | undefined {
  if (!fs.existsSync(statePath)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(statePath, "utf8"));
  } catch {
    throw new RuntimeMigrationCandidateConsumeError("CONSUME_STATE_CORRUPT");
  }
  if (
    !parsed || typeof parsed !== "object" ||
    (parsed as ConsumeStateFile).schemaVersion !== runtimeMigrationConsumeStateSchemaVersion ||
    typeof (parsed as ConsumeStateFile).consumeId !== "string" ||
    typeof (parsed as ConsumeStateFile).candidateId !== "string" ||
    typeof (parsed as ConsumeStateFile).candidateManifestSha256 !== "string" ||
    !((parsed as ConsumeStateFile).state in forwardConsumeStates)
  ) {
    throw new RuntimeMigrationCandidateConsumeError("CONSUME_STATE_CORRUPT");
  }
  return parsed as ConsumeStateFile;
}

function writeConsumeState(statePath: string, state: ConsumeStateFile): ConsumeStateFile {
  const directory = path.dirname(statePath);
  fs.mkdirSync(directory, { recursive: true });
  const temp = path.join(directory, `.state.${randomUUID().slice(0, 8)}.tmp`);
  const serialized = `${JSON.stringify(state, null, 2)}\n`;
  const fd = fs.openSync(temp, "wx", 0o600);
  try {
    fs.writeSync(fd, serialized);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temp, statePath);
  return state;
}

function advance(
  statePath: string,
  current: ConsumeStateFile,
  next: RuntimeMigrationCandidateConsumeState,
  now: () => string,
  dependencies: RuntimeMigrationCandidateConsumeDependencies,
): ConsumeStateFile {
  if (!forwardConsumeStates[current.state].includes(next)) {
    throw new RuntimeMigrationCandidateConsumeError("CONSUME_STATE_CORRUPT");
  }
  const written = writeConsumeState(statePath, {
    ...current,
    state: next,
    updatedAt: now(),
    history: [...current.history, { state: next, at: now() }],
  });
  dependencies.observeState?.(next);
  return written;
}

function writeResultFile(
  metadataDirectory: string,
  result: RuntimeMigrationCandidateConsumeResult,
): void {
  const resultPath = path.join(metadataDirectory, consumeResultFileName);
  const temp = path.join(metadataDirectory, `.result.${randomUUID().slice(0, 8)}.tmp`);
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  const fd = fs.openSync(temp, "w", 0o600);
  try {
    fs.writeSync(fd, serialized);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temp, resultPath);
}

/* -------------------------------------------------------------- misc ----- */

function buildResult(
  input: RuntimeMigrationCandidateConsumeInput,
  candidateId: string,
  candidateManifestSha256: string,
  relocationTargetRoot: string,
  targetProjectsRoot: string,
  sourceContent: { contentDigest: string; fileCount: number },
  fileCount: number,
  byteCount: number,
  candidateManifest: RuntimeMigrationCandidateManifest,
  check: MaterializedCheck,
  resumed: boolean,
): RuntimeMigrationCandidateConsumeResult {
  return Object.freeze({
    consumed: true,
    consumeId: input.consumeId,
    candidateId,
    candidateManifestSha256,
    relocationTargetRoot,
    targetProjectsRoot,
    contentDigest: check.contentDigest,
    fileCount: check.fileCount === fileCount ? fileCount : check.fileCount,
    byteCount: check.byteCount === byteCount ? byteCount : check.byteCount,
    candidateAggregate: candidateManifest.candidateAggregate,
    durableExecutionBinding: check.durableExecutionBinding,
    durableRecoveryDecision: check.durableRecoveryDecision,
    state: "consumed",
    resumed,
    cutoverAuthorized: false,
  });
}

function safeContentDigest(projectsRoot: string): { contentDigest: string; fileCount: number } {
  try {
    return runtimeAuthorityProjectsContentDigest(projectsRoot);
  } catch {
    throw new RuntimeMigrationCandidateConsumeError("MIGRATION_UNSUPPORTED_FILE_TYPE");
  }
}

function safeJoin(root: string, relativePath: string): string {
  const target = path.resolve(root, relativePath);
  assertPathContained(root, target);
  return target;
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function samePath(left: string, right: string): boolean {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}
