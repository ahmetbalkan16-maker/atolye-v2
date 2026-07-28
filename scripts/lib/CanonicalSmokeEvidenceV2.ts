import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { snapshotProductionPipelineExecutionConfiguration } from "../../src/lib/production/ProductionPipelineExecutionConfiguration";
import {
  CanonicalEvidenceError, type CanonicalEvidenceErrorCode, type CanonicalSmokeChildSpec,
  type CanonicalSmokePartitionSpec, addIntegrity, canonicalSmokeChildren, canonicalSmokePartitions,
  canonicalSmokeRegistryFingerprint, canonicalStringify, childTimeoutPolicyFingerprint,
  hostileEnvironmentPolicyFingerprint, sha256, verifyIntegrity,
} from "./CanonicalSmokeEvidence";

type JsonObject = { readonly [key: string]: unknown };
type MutableRecord = Record<string, unknown>;
interface InventoryEntry { readonly relativePath: string; readonly type: "file" | "directory";
  readonly reparse: boolean; readonly device: string; readonly inode: string; readonly size: string;
  readonly mtimeNs: string; readonly contentHash?: string }
interface Inventory { readonly count: number; readonly digest: string; readonly entries: readonly InventoryEntry[] }
interface Delta { readonly added: readonly string[]; readonly removed: readonly string[]; readonly modified: readonly string[] }
interface Identity { readonly canonicalPath: string; readonly device: string; readonly inode: string;
  readonly type: "file" | "directory"; readonly reparse: boolean }
interface RecordedTemporaryIdentity extends Identity { readonly parentIdentity: Identity;
  readonly byteLength: number; readonly contentHash: string }
interface EvidenceValidationHooks {
  readonly beforeCreateSegment?: (segment: string) => void;
  readonly afterTempIdentityCaptured?: (filePath: string, temporaryPath: string) => void;
  readonly beforeTempCleanup?: (filePath: string, temporaryPath: string) => void;
  readonly beforeTempCleanupSizeRead?: () => void;
  readonly beforeTempCleanupHashRead?: () => void;
}

const schemaVersion = "canonical-smoke-evidence-v2";
const serializationSchemaVersion = "canonical-json-sorted-keys-v1";
const serializationPolicyFingerprint = sha256(serializationSchemaVersion);
const evidenceParentName = "canonical-smoke-evidence";
const terminalPrefix = "ATOLYE_SMOKE_RESULT ";
const maxLogBytes = 32 * 1024 * 1024;
const sharedRoot = path.join(os.tmpdir(), "atolye-runtime-authority-v1");
const productionRoot = path.join(process.cwd(), "data", "projects");
let validationHooks: EvidenceValidationHooks = {};

export function setCanonicalEvidenceValidationHooks(hooks: EvidenceValidationHooks): () => void {
  const previous = validationHooks; validationHooks = hooks; return () => { validationHooks = previous; };
}
const hostileEnvironmentPolicy = Object.freeze({
  AI_PROVIDER: "hostile-ai", IMAGE_PROVIDER: "hostile-image", AUDIO_PROVIDER: "hostile-audio",
  ANIMATION_PROVIDER: "hostile-animation", VIDEO_PROVIDER: "hostile-video",
  VIDEO_ASSEMBLY_PROVIDER: "hostile-assembly", THUMBNAIL_PROVIDER: "hostile-thumbnail",
  YOUTUBE_PROVIDER: "hostile-youtube", YOUTUBE_PUBLISH_PROVIDER: "hostile-publish",
  OPENAI_API_KEY: "hostile-secret", YOUTUBE_ACCESS_TOKEN: "hostile-token",
  OPENAI_MODEL: "hostile-model", OPENAI_TTS_MODEL: "hostile-tts-model",
  OPENAI_BASE_URL: "http://127.0.0.1:1/hostile", OPENAI_API_BASE: "http://127.0.0.1:1/hostile",
  FFMPEG_PATH: "hostile-ffmpeg", FFPROBE_PATH: "hostile-ffprobe", FFMPEG_TIMEOUT_MS: "1",
  OPENAI_TTS_TIMEOUT_MS: "1", OPENAI_TTS_MAX_RESPONSE_BYTES: "1",
  YOUTUBE_CHANNEL_ID: "hostile-channel", ATOLYE_DURABLE_PIPELINE_EXECUTION: "hostile",
});

function fail(code: CanonicalEvidenceErrorCode, message: string): never { throw new CanonicalEvidenceError(code, message); }
function equal(actual: unknown, expected: unknown, code: CanonicalEvidenceErrorCode, label: string): void {
  if (canonicalStringify(actual) !== canonicalStringify(expected)) fail(code, label);
}
function normalizePath(value: string): string { return value.replaceAll("\\", "/"); }
function compare(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function object(value: unknown, code: CanonicalEvidenceErrorCode, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code, `${label} must be an object`);
  return value as JsonObject;
}
function string(value: unknown, code: CanonicalEvidenceErrorCode, label: string): string {
  if (typeof value !== "string" || value.length === 0) fail(code, `${label} must be a string`);
  return value;
}
function array(value: unknown, code: CanonicalEvidenceErrorCode, label: string): readonly unknown[] {
  if (!Array.isArray(value)) fail(code, `${label} must be an array`);
  return value;
}

export function defaultEvidenceRoot(matrixRunId: string): string {
  assertMatrixRunId(matrixRunId); return path.join(os.tmpdir(), evidenceParentName, matrixRunId);
}

function readJson(filePath: string, code: CanonicalEvidenceErrorCode): JsonObject {
  try {
    const raw = fs.readFileSync(filePath, "utf8"), parsed: unknown = JSON.parse(raw);
    verifyIntegrity(parsed, normalizePath(filePath));
    if (raw !== `${canonicalStringify(parsed)}\n`) fail(code, `non-canonical JSON: ${filePath}`);
    return parsed as JsonObject;
  } catch (error) {
    if (error instanceof CanonicalEvidenceError) throw error;
    fail(code, `${normalizePath(filePath)}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function identity(target: string): Identity {
  const stat = fs.lstatSync(target, { bigint: true });
  const reparse = stat.isSymbolicLink();
  return { canonicalPath: normalizePath(path.resolve(target)), device: String(stat.dev), inode: String(stat.ino),
    type: stat.isDirectory() ? "directory" : "file", reparse };
}

function identityEqual(left: Identity, right: Identity): boolean {
  return canonicalStringify(left) === canonicalStringify(right);
}

function tempParentChain(root: string): readonly Identity[] {
  const temp = path.resolve(os.tmpdir()), resolved = path.resolve(root);
  const relation = path.relative(temp, resolved);
  if (!relation || relation.startsWith("..") || path.isAbsolute(relation))
    fail("EVIDENCE_ROOT_PARENT_CHAIN_INVALID", "evidence root is outside the canonical temp directory");
  const parts = relation.split(path.sep).filter(Boolean), chain: Identity[] = [identity(temp)];
  let cursor = temp;
  for (const part of parts) { cursor = path.join(cursor, part); chain.push(identity(cursor)); }
  if (path.basename(path.dirname(resolved)) !== evidenceParentName)
    fail("EVIDENCE_ROOT_PARENT_CHAIN_INVALID", "immediate parent name is not canonical-smoke-evidence");
  if (chain.some((item) => item.reparse || item.type !== "directory"))
    fail("EVIDENCE_ROOT_REPARSE_DETECTED", "root parent chain contains a reparse or non-directory entry");
  return chain;
}

function rootAuthority(root: string): JsonObject {
  const chain = tempParentChain(root);
  return { canonicalPath: normalizePath(path.resolve(root)), rootIdentity: chain.at(-1),
    parentIdentity: chain.at(-2), parentChain: chain };
}

function assertRootPlacement(root: string, matrixRunId: string): void {
  assertMatrixRunId(matrixRunId);
  if (path.basename(root) !== matrixRunId) fail("EVIDENCE_ROOT_PARENT_CHAIN_INVALID", "root basename/run mismatch");
  const resolved = path.resolve(root), temp = path.resolve(os.tmpdir()), relation = path.relative(temp, resolved),
    forbidden = [process.cwd(), path.join(process.cwd(), "data"), productionRoot, sharedRoot]
    .map((item) => path.resolve(item));
  if (!relation || relation.startsWith("..") || path.isAbsolute(relation))
    fail("EVIDENCE_ROOT_PARENT_CHAIN_INVALID", "evidence root is outside the canonical temp directory");
  if (forbidden.some((item) => resolved === item || resolved.startsWith(`${item}${path.sep}`)))
    fail("EVIDENCE_ROOT_PARENT_CHAIN_INVALID", "root overlaps repository or authority");
  if (path.basename(path.dirname(resolved)) !== evidenceParentName)
    fail("EVIDENCE_ROOT_PARENT_CHAIN_INVALID", "immediate parent name is not canonical-smoke-evidence");
}

function requireStableDirectory(target: string, expected?: Identity): Identity {
  let actual: Identity;
  try { actual = identity(target); }
  catch (error) { fail("EVIDENCE_ROOT_PARENT_CHAIN_INVALID", `parent identity unavailable: ${target}: ${String(error)}`); }
  if (actual.type !== "directory" || actual.reparse)
    fail("EVIDENCE_ROOT_PARENT_CHAIN_INVALID", `parent is not a regular directory: ${target}`);
  if (expected && !identityEqual(actual, expected))
    fail("EVIDENCE_ROOT_PARENT_CHAIN_INVALID", `parent identity changed: ${target}`);
  return actual;
}

function prepareNewEvidenceRoot(root: string, matrixRunId: string): void {
  assertRootPlacement(root, matrixRunId);
  const temp = path.resolve(os.tmpdir()), resolved = path.resolve(root), parts = path.relative(temp, resolved).split(path.sep).filter(Boolean);
  const created: Array<{ readonly path: string; readonly identity: Identity }> = [];
  let parent = temp, parentIdentity = requireStableDirectory(temp);
  try {
    for (const part of parts) {
      const segment = path.join(parent, part);
      if (fs.existsSync(segment)) {
        parentIdentity = requireStableDirectory(segment); parent = segment; continue;
      }
      validationHooks.beforeCreateSegment?.(segment);
      requireStableDirectory(parent, parentIdentity);
      fs.mkdirSync(segment, { recursive: false });
      const segmentIdentity = requireStableDirectory(segment);
      requireStableDirectory(parent, parentIdentity);
      created.push({ path: segment, identity: segmentIdentity });
      parent = segment; parentIdentity = segmentIdentity;
    }
    if (created.length === 0 || created.at(-1)?.path !== resolved)
      fail("EVIDENCE_ROOT_PARENT_CHAIN_INVALID", "new evidence root already exists");
    tempParentChain(resolved);
  } catch (error) {
    for (const entry of [...created].reverse()) {
      if (!fs.existsSync(entry.path)) continue;
      const current = identity(entry.path);
      if (identityEqual(current, entry.identity) && current.type === "directory" && !current.reparse &&
        fs.readdirSync(entry.path).length === 0) fs.rmdirSync(entry.path);
    }
    if (error instanceof CanonicalEvidenceError) throw error;
    fail("EVIDENCE_ROOT_PARENT_CHAIN_INVALID", error instanceof Error ? error.message : String(error));
  }
}

function assertExistingEvidenceRoot(root: string, matrixRunId: string): void {
  assertRootPlacement(root, matrixRunId); tempParentChain(root);
}

export function validateEvidenceRootAuthority(root: string, matrix: JsonObject): void {
  let actual: JsonObject;
  try { actual = rootAuthority(root); }
  catch (error) {
    if (error instanceof CanonicalEvidenceError) throw error;
    fail("EVIDENCE_ROOT_IDENTITY_MISMATCH", error instanceof Error ? error.message : String(error));
  }
  equal(actual, matrix.evidenceRootAuthority, "EVIDENCE_ROOT_IDENTITY_MISMATCH", "recorded root authority differs from disk");
}

function writeAtomic(filePath: string, bytes: Buffer): string {
  const parentBefore = requireStableDirectory(path.dirname(filePath));
  const temporary = path.join(path.dirname(filePath), `.tmp-${path.basename(filePath)}-${randomUUID()}`);
  let descriptor: number | undefined, tempCreated = false, recorded: RecordedTemporaryIdentity | undefined;
  let primaryError: unknown, resultHash: string | undefined;
  try {
    descriptor = fs.openSync(temporary, "wx", 0o600);
    tempCreated = true;
    const createdIdentity = identity(temporary);
    if (createdIdentity.type !== "file" || createdIdentity.reparse) fail("EVIDENCE_CHILD_INTEGRITY_MISMATCH", "unsafe temporary file");
    recorded = { ...createdIdentity, parentIdentity: parentBefore, byteLength: bytes.length, contentHash: sha256(bytes) };
    let offset = 0;
    while (offset < bytes.length) offset += fs.writeSync(descriptor, bytes, offset, bytes.length - offset);
    fs.fsyncSync(descriptor); fs.closeSync(descriptor); descriptor = undefined;
    const temporaryIdentity = identity(temporary);
    if (!identityEqual(temporaryIdentity, createdIdentity)) fail("EVIDENCE_CHILD_INTEGRITY_MISMATCH", "temporary identity changed during write");
    validationHooks.afterTempIdentityCaptured?.(filePath, temporary);
    if (!fs.readFileSync(temporary).equals(bytes)) fail("EVIDENCE_CHILD_INTEGRITY_MISMATCH", "temporary readback mismatch");
    try { fs.linkSync(temporary, filePath); }
    catch (error) { fail("EVIDENCE_CHILD_INTEGRITY_MISMATCH", `immutable publish conflict: ${filePath}: ${String(error)}`); }
    const finalIdentity = identity(filePath), parentAfter = identity(path.dirname(filePath));
    if (!identityEqual(parentBefore, parentAfter) || finalIdentity.device !== temporaryIdentity.device ||
      finalIdentity.inode !== temporaryIdentity.inode || finalIdentity.type !== "file" || finalIdentity.reparse)
      fail("EVIDENCE_CHILD_INTEGRITY_MISMATCH", "atomic publish identity mismatch");
    if (!fs.readFileSync(filePath).equals(bytes)) fail("EVIDENCE_CHILD_INTEGRITY_MISMATCH", "published bytes mismatch");
    resultHash = sha256(bytes);
  } catch (error) { primaryError = error; }
  if (descriptor !== undefined) { fs.closeSync(descriptor); descriptor = undefined; }
  let cleanupError: unknown;
  if (tempCreated) {
    try {
      validationHooks.beforeTempCleanup?.(filePath, temporary);
      if (!recorded || !fs.existsSync(temporary))
        fail("EVIDENCE_TEMP_CLEANUP_IDENTITY_MISMATCH", "recorded temporary entry is missing");
      const cleanupParent = identity(path.dirname(temporary));
      if (!identityEqual(cleanupParent, recorded.parentIdentity) || cleanupParent.type !== "directory" || cleanupParent.reparse)
        fail("EVIDENCE_TEMP_CLEANUP_IDENTITY_MISMATCH", "temporary parent identity changed before cleanup");
      const current = identity(temporary);
      if (current.device !== recorded.device || current.inode !== recorded.inode || current.type !== "file" || current.reparse)
        fail("EVIDENCE_TEMP_CLEANUP_IDENTITY_MISMATCH", "temporary entry was replaced before cleanup");
      let cleanupSize: number;
      try { validationHooks.beforeTempCleanupSizeRead?.(); cleanupSize = fs.statSync(temporary).size; }
      catch (error) { fail("EVIDENCE_TEMP_CLEANUP_IDENTITY_MISMATCH", `temporary size unavailable before cleanup: ${String(error)}`); }
      if (cleanupSize !== recorded.byteLength)
        fail("EVIDENCE_TEMP_CLEANUP_IDENTITY_MISMATCH", "temporary byte length changed before cleanup");
      let cleanupHash: string;
      try { validationHooks.beforeTempCleanupHashRead?.(); cleanupHash = sha256(fs.readFileSync(temporary)); }
      catch (error) { fail("EVIDENCE_TEMP_CLEANUP_IDENTITY_MISMATCH", `temporary hash unavailable before cleanup: ${String(error)}`); }
      if (cleanupHash !== recorded.contentHash)
        fail("EVIDENCE_TEMP_CLEANUP_IDENTITY_MISMATCH", "temporary content hash changed before cleanup");
      fs.unlinkSync(temporary);
    } catch (error) { cleanupError = error; }
  }
  if (primaryError && cleanupError) throw new AggregateError([primaryError, cleanupError], "Evidence publish and cleanup both failed.");
  if (primaryError) throw primaryError;
  if (cleanupError) throw cleanupError;
  return resultHash!;
}

export function writeImmutableJson(filePath: string, value: MutableRecord): string {
  if ("integrityHash" in value)
    fail("EVIDENCE_SUPPLIED_INTEGRITY_FORBIDDEN", "caller-supplied integrityHash is forbidden");
  return publishIntegratedJson(filePath, addIntegrity(value));
}

function publishIntegratedJson(filePath: string, integrated: MutableRecord): string {
  try { verifyIntegrity(integrated, normalizePath(filePath)); }
  catch (error) { fail("EVIDENCE_CHILD_INTEGRITY_MISMATCH", error instanceof Error ? error.message : String(error)); }
  const bytes = Buffer.from(`${canonicalStringify(integrated)}\n`, "utf8"), result = writeAtomic(filePath, bytes);
  const readback = readJson(filePath, "EVIDENCE_CHILD_INTEGRITY_MISMATCH");
  equal(readback, integrated, "EVIDENCE_CHILD_INTEGRITY_MISMATCH", "immutable JSON readback mismatch");
  return result;
}

function writeContentAddressedInventory(root: string, value: Inventory): JsonObject {
  const integrated = addIntegrity({ schemaVersion, kind: "inventory", count: value.count,
    digest: value.digest, entries: value.entries });
  const bytes = Buffer.from(`${canonicalStringify(integrated)}\n`, "utf8"), fileHash = sha256(bytes);
  const relativePath = `inventories/${fileHash}.json`, target = path.join(root, ...relativePath.split("/"));
  if (fs.existsSync(target)) {
    if (!fs.readFileSync(target).equals(bytes)) fail("EVIDENCE_CHILD_INTEGRITY_MISMATCH", "inventory hash collision");
  } else writeAtomic(target, bytes);
  return { relativePath, fileHash, count: value.count, digest: value.digest };
}

function loadInventory(root: string, reference: unknown, code: CanonicalEvidenceErrorCode): Inventory {
  const ref = object(reference, code, "inventory reference");
  const filePath = resolveRelative(root, string(ref.relativePath, code, "inventory.relativePath"));
  const bytes = fs.readFileSync(filePath);
  if (sha256(bytes) !== ref.fileHash) fail(code, "inventory file hash mismatch");
  const manifest = readJson(filePath, code), entries = array(manifest.entries, code, "inventory.entries") as InventoryEntry[];
  const derived = inventoryFromEntries(entries);
  equal({ count: derived.count, digest: derived.digest }, { count: manifest.count, digest: manifest.digest }, code,
    "inventory manifest summary mismatch");
  equal({ count: derived.count, digest: derived.digest }, { count: ref.count, digest: ref.digest }, code,
    "inventory reference summary mismatch");
  return derived;
}

function inventory(root: string): Inventory {
  if (!fs.existsSync(root)) return inventoryFromEntries([]);
  const rootStat = fs.lstatSync(root, { bigint: true });
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail("EVIDENCE_CHILD_INTEGRITY_MISMATCH", `unsafe inventory root ${root}`);
  const entries: InventoryEntry[] = [];
  const visit = (directory: string): void => {
    for (const name of fs.readdirSync(directory).sort(compare)) {
      const target = path.join(directory, name), stat = fs.lstatSync(target, { bigint: true });
      const relativePath = normalizePath(path.relative(root, target)), reparse = stat.isSymbolicLink();
      if (reparse) fail("EVIDENCE_CHILD_INTEGRITY_MISMATCH", `inventory reparse ${relativePath}`);
      if (stat.isDirectory()) { entries.push({ relativePath, type: "directory", reparse, device: String(stat.dev),
        inode: String(stat.ino), size: String(stat.size), mtimeNs: String(stat.mtimeNs) }); visit(target); }
      else if (stat.isFile()) entries.push({ relativePath, type: "file", reparse, device: String(stat.dev),
        inode: String(stat.ino), size: String(stat.size), mtimeNs: String(stat.mtimeNs), contentHash: sha256(fs.readFileSync(target)) });
      else fail("EVIDENCE_CHILD_INTEGRITY_MISMATCH", `unsupported inventory entry ${relativePath}`);
    }
  };
  visit(root); return inventoryFromEntries(entries);
}

function inventoryFromEntries(entriesInput: readonly InventoryEntry[]): Inventory {
  const entries = [...entriesInput].sort((a, b) => compare(a.relativePath, b.relativePath));
  return { count: entries.length, entries,
    digest: sha256(entries.map((entry) => canonicalStringify(entry)).join("\n")) };
}

function delta(before: Inventory, after: Inventory): Delta {
  const left = new Map(before.entries.map((entry) => [entry.relativePath, canonicalStringify(entry)]));
  const right = new Map(after.entries.map((entry) => [entry.relativePath, canonicalStringify(entry)]));
  return { added: [...right.keys()].filter((key) => !left.has(key)).sort(compare),
    removed: [...left.keys()].filter((key) => !right.has(key)).sort(compare),
    modified: [...right.keys()].filter((key) => left.has(key) && left.get(key) !== right.get(key)).sort(compare) };
}

function zero(value: Delta): boolean { return value.added.length + value.removed.length + value.modified.length === 0; }
function dataProjectsState(): JsonObject { return { tracked: git(["diff", "--", "data/projects"]),
  untracked: git(["ls-files", "--others", "--exclude-standard", "--", "data/projects"]) }; }
function cleanData(value: unknown): boolean { const state = object(value, "EVIDENCE_CHILD_DATA_PROJECTS_DIRTY", "dataProjects");
  return state.tracked === "" && state.untracked === ""; }
function remainders(): readonly string[] { return fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith("atolye-smoke-"))
  .sort(compare).map((name) => { const manifest = path.join(os.tmpdir(), name, "canonical-smoke-ownership.json");
    return `${name}:${fs.existsSync(manifest) ? sha256(fs.readFileSync(manifest)) : "manifest-missing"}`; }); }
function ownershipRemainders(): readonly string[] { return remainders().filter((item) => !item.endsWith(":manifest-missing")); }
function git(args: readonly string[]): string { const result = spawnSync("git", args, { cwd: process.cwd(), encoding: "utf8" });
  if (result.status !== 0) fail("EVIDENCE_MATRIX_HEAD_MISMATCH", `git failed: ${result.stderr}`); return result.stdout; }
function currentHead(): string { return git(["rev-parse", "HEAD"]).trim(); }
function processIdentity(): JsonObject {
  const startedAtEpochMs = Math.round(Date.now() - process.uptime() * 1000), executable = normalizePath(process.execPath);
  return { pid: process.pid, startedAtEpochMs, executable,
    processStartIdentity: `${process.pid}:${startedAtEpochMs}:${sha256(executable).slice(0, 16)}` };
}
function environmentEvidence(): JsonObject {
  const keys = Object.keys(hostileEnvironmentPolicy).sort(compare), components = keys.map((key) => ({ key,
    present: Object.prototype.hasOwnProperty.call(process.env, key), valueHash: sha256(process.env[key] ?? "<absent>") }));
  return { allowlistFingerprint: sha256(canonicalStringify(keys)), components,
    snapshotFingerprint: sha256(canonicalStringify(components)) };
}
function registrationEvidence(): JsonObject { const snapshot = snapshotProductionPipelineExecutionConfiguration();
  const components = { runner: snapshot.runnerRuntime.registration ? "configured" : "empty",
    continuation: snapshot.continuationAdmission ? "configured" : "empty",
    execution: snapshot.pipelineExecution.registration ? "configured" : "empty" };
  return { components, componentsFingerprint: sha256(canonicalStringify(components)),
    fingerprint: sha256(canonicalStringify(components)) };
}
function validateEnvironmentFingerprint(value: unknown): JsonObject {
  const evidence = object(value, "EVIDENCE_ENVIRONMENT_RESTORE_MISMATCH", "environment evidence"),
    components = array(evidence.components, "EVIDENCE_ENVIRONMENT_RESTORE_MISMATCH", "environment components"),
    keys = Object.keys(hostileEnvironmentPolicy).sort(compare);
  if (evidence.allowlistFingerprint !== sha256(canonicalStringify(keys)))
    fail("EVIDENCE_ENVIRONMENT_RESTORE_MISMATCH", "environment allowlist fingerprint mismatch");
  const observedKeys = components.map((item) => string(object(item, "EVIDENCE_ENVIRONMENT_RESTORE_MISMATCH",
    "environment component").key, "EVIDENCE_ENVIRONMENT_RESTORE_MISMATCH", "environment key"));
  equal(observedKeys, keys, "EVIDENCE_ENVIRONMENT_RESTORE_MISMATCH", "environment component coverage mismatch");
  for (const item of components) { const component = object(item, "EVIDENCE_ENVIRONMENT_RESTORE_MISMATCH", "environment component");
    if (typeof component.present !== "boolean" || typeof component.valueHash !== "string" || !/^[a-f0-9]{64}$/.test(component.valueHash))
      fail("EVIDENCE_ENVIRONMENT_RESTORE_MISMATCH", "invalid environment component fingerprint"); }
  if (evidence.snapshotFingerprint !== sha256(canonicalStringify(components)))
    fail("EVIDENCE_ENVIRONMENT_RESTORE_MISMATCH", "environment snapshot fingerprint mismatch");
  return evidence;
}
function validateRegistrationFingerprint(value: unknown): JsonObject {
  const evidence = object(value, "EVIDENCE_REGISTRATION_RESTORE_MISMATCH", "registration evidence"),
    components = object(evidence.components, "EVIDENCE_REGISTRATION_RESTORE_MISMATCH", "registration components"),
    expectedKeys = ["continuation", "execution", "runner"];
  equal(Object.keys(components).sort(compare), expectedKeys, "EVIDENCE_REGISTRATION_RESTORE_MISMATCH", "registration component coverage mismatch");
  for (const key of expectedKeys) if (components[key] !== "configured" && components[key] !== "empty")
    fail("EVIDENCE_REGISTRATION_RESTORE_MISMATCH", `invalid registration component: ${key}`);
  const fingerprint = sha256(canonicalStringify(components));
  if (evidence.componentsFingerprint !== fingerprint || evidence.fingerprint !== fingerprint)
    fail("EVIDENCE_REGISTRATION_RESTORE_MISMATCH", "registration fingerprint mismatch");
  return evidence;
}
function resolveRelative(root: string, relative: string): string { if (path.isAbsolute(relative))
  fail("EVIDENCE_CHILD_INTEGRITY_MISMATCH", "absolute evidence path"); const resolved = path.resolve(root, relative), relation = path.relative(root, resolved);
  if (!relation || relation.startsWith("..") || path.isAbsolute(relation)) fail("EVIDENCE_CHILD_INTEGRITY_MISMATCH", "path escape"); return resolved; }
function assertMatrixRunId(value: string): void { if (!/^[a-z0-9][a-z0-9-]{7,95}$/.test(value))
  fail("EVIDENCE_ROOT_PARENT_CHAIN_INVALID", "invalid matrix run ID"); }
function assertNoPartials(root: string): void { const visit = (directory: string): void => { for (const name of fs.readdirSync(directory)) {
  const target = path.join(directory, name), stat = fs.lstatSync(target); if (stat.isSymbolicLink())
    fail("EVIDENCE_ROOT_REPARSE_DETECTED", `reparse evidence ${target}`); if (name.startsWith(".tmp-"))
    fail("EVIDENCE_CHILD_INTEGRITY_MISMATCH", `partial evidence ${target}`); if (stat.isDirectory()) visit(target); } }; visit(root); }

function expectedContract(): JsonObject { return { partitions: canonicalSmokePartitions.map((item) => ({ partitionId: item.partitionId,
  childIds: item.childIds })), children: canonicalSmokeChildren.map((item) => ({ childId: item.childId,
  partitionId: item.partitionId, suite: item.suite, script: item.script, expectedScenarios: item.expectedScenarios,
  timeoutMs: item.timeoutMs, foundation: item.foundation ?? false, environment: item.environment ?? {} })) }; }

export function validateMatrixContract(root: string, expectedRunId?: string): JsonObject {
  const matrix = readJson(path.join(root, "matrix-manifest.json"), "EVIDENCE_BASELINE_MISMATCH");
  const runId = string(matrix.matrixRunId, "EVIDENCE_BASELINE_MISMATCH", "matrixRunId");
  if (expectedRunId && runId !== expectedRunId) fail("EVIDENCE_BASELINE_MISMATCH", "matrix run mismatch");
  if (matrix.schemaVersion !== schemaVersion || matrix.serializationSchemaVersion !== serializationSchemaVersion ||
    matrix.serializationPolicyFingerprint !== serializationPolicyFingerprint)
    fail("EVIDENCE_BASELINE_MISMATCH", "matrix schema/serialization mismatch");
  if (matrix.head !== currentHead()) fail("EVIDENCE_MATRIX_HEAD_MISMATCH", "matrix HEAD differs from repository");
  if (matrix.authoritativeSuiteRegistryFingerprint !== canonicalSmokeRegistryFingerprint)
    fail("EVIDENCE_REGISTRY_MISMATCH", "registry fingerprint mismatch");
  if (matrix.hostileEnvironmentPolicyFingerprint !== hostileEnvironmentPolicyFingerprint)
    fail("EVIDENCE_HOSTILE_POLICY_MISMATCH", "hostile policy fingerprint mismatch");
  if (matrix.childTimeoutPolicyFingerprint !== childTimeoutPolicyFingerprint)
    fail("EVIDENCE_TIMEOUT_POLICY_MISMATCH", "timeout policy fingerprint mismatch");
  equal(matrix.expectedContract, expectedContract(), "EVIDENCE_REGISTRY_MISMATCH", "matrix expected contract mismatch");
  validateEvidenceRootAuthority(root, matrix); return matrix;
}

export function validateBaselineEvidence(root: string, matrix: JsonObject): JsonObject {
  const baseline = readJson(path.join(root, "baseline.json"), "EVIDENCE_BASELINE_MISMATCH");
  if (matrix.baselineFingerprint !== baseline.integrityHash || baseline.matrixRunId !== matrix.matrixRunId ||
    baseline.head !== matrix.head || baseline.schemaVersion !== schemaVersion)
    fail("EVIDENCE_BASELINE_MISMATCH", "baseline linkage mismatch");
  if (baseline.environmentPolicyFingerprint !== hostileEnvironmentPolicyFingerprint)
    fail("EVIDENCE_HOSTILE_POLICY_MISMATCH", "baseline hostile policy mismatch");
  validateEnvironmentFingerprint(baseline.environmentEvidence);
  validateRegistrationFingerprint(baseline.registrationEvidence);
  loadInventory(root, baseline.sharedInventory, "EVIDENCE_BASELINE_MISMATCH");
  loadInventory(root, baseline.productionInventory, "EVIDENCE_BASELINE_MISMATCH");
  if (!cleanData(baseline.dataProjects) || array(baseline.remainderInventory,
    "EVIDENCE_BASELINE_MISMATCH", "baseline remainders").length > 0)
    fail("EVIDENCE_BASELINE_MISMATCH", "baseline is dirty");
  return baseline;
}

function terminal(stdout: string, spec: CanonicalSmokeChildSpec): JsonObject {
  const lines = stdout.split(/\r?\n/).filter((line) => line.trim()), terminalLines = lines.filter((line) => line.startsWith(terminalPrefix));
  let parsed: unknown = null; try { if (terminalLines.length === 1) parsed = JSON.parse(terminalLines[0].slice(terminalPrefix.length)); } catch { parsed = null; }
  return { count: terminalLines.length, parsed, finalLine: terminalLines.length === 1 && lines.at(-1) === terminalLines[0],
    conflicting: terminalLines.length !== 1, valid: terminalLines.length === 1 && lines.at(-1) === terminalLines[0] &&
      canonicalStringify(parsed) === canonicalStringify({ status: "PASS", suite: spec.suite, scenarios: spec.expectedScenarios }) };
}

function runChild(root: string, runId: string, baselineHash: string, spec: CanonicalSmokeChildSpec): void {
  const sharedBefore = inventory(sharedRoot), productionBefore = inventory(productionRoot), dataBefore = dataProjectsState();
  const remainderBefore = remainders(), ownershipBefore = ownershipRemainders();
  const sharedBeforeRef = writeContentAddressedInventory(root, sharedBefore), productionBeforeRef = writeContentAddressedInventory(root, productionBefore);
  const cli = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
  const command = spec.foundation ? [process.execPath, cli, path.join(process.cwd(), "scripts", spec.script)] :
    [process.execPath, cli, path.join(process.cwd(), "scripts", "run-canonical-smoke-child.ts"), spec.script];
  const startedAt = new Date().toISOString(), result = spawnSync(command[0], command.slice(1), { cwd: process.cwd(),
    env: { ...process.env, ...hostileEnvironmentPolicy, ...spec.environment,
      ...(spec.environment?.THUMBNAIL_SMOKE_SCENARIO ? { ATOLYE_EXTERNAL_THUMBNAIL_SMOKE_SCENARIO: spec.environment.THUMBNAIL_SMOKE_SCENARIO } : {}) },
    timeout: spec.timeoutMs, maxBuffer: maxLogBytes, encoding: "buffer" }), finishedAt = new Date().toISOString();
  const stdout = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.alloc(0), stderr = Buffer.isBuffer(result.stderr) ? result.stderr : Buffer.alloc(0);
  const stdoutRelative = `logs/${spec.childId}.stdout.log`, stderrRelative = `logs/${spec.childId}.stderr.log`;
  const stdoutHash = writeAtomic(path.join(root, ...stdoutRelative.split("/")), stdout), stderrHash = writeAtomic(path.join(root, ...stderrRelative.split("/")), stderr);
  const sharedAfter = inventory(sharedRoot), productionAfter = inventory(productionRoot), dataAfter = dataProjectsState();
  const remainderAfter = remainders(), ownershipAfter = ownershipRemainders();
  const sharedAfterRef = writeContentAddressedInventory(root, sharedAfter), productionAfterRef = writeContentAddressedInventory(root, productionAfter);
  const sharedDelta = delta(sharedBefore, sharedAfter), productionDelta = delta(productionBefore, productionAfter), observedTerminal = terminal(stdout.toString("utf8"), spec);
  const timedOut = (result.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT";
  const passed = !result.error && result.status === 0 && observedTerminal.valid === true && zero(sharedDelta) && zero(productionDelta) &&
    cleanData(dataBefore) && cleanData(dataAfter) && remainderBefore.length === 0 && remainderAfter.length === 0 && ownershipBefore.length === 0 && ownershipAfter.length === 0;
  const manifest = addIntegrity({ schemaVersion, matrixRunId: runId, baselineFingerprint: baselineHash,
    partitionId: spec.partitionId, childId: spec.childId, suite: spec.suite, expectedScenarios: spec.expectedScenarios,
    command: command.map(normalizePath), workingDirectory: normalizePath(process.cwd()), startedAt, finishedAt,
    timeoutPolicy: { timeoutMs: spec.timeoutMs, maxLogBytes }, exitCode: result.status, timedOut,
    terminalResultCount: observedTerminal.count, parsedTerminalResult: observedTerminal.parsed,
    terminalResultFinalLine: observedTerminal.finalLine, conflictingTerminalResult: observedTerminal.conflicting,
    stdout: { relativePath: stdoutRelative, sha256: stdoutHash, originalByteCount: stdout.length, retainedByteCount: stdout.length, truncation: "none" },
    stderr: { relativePath: stderrRelative, sha256: stderrHash, originalByteCount: stderr.length, retainedByteCount: stderr.length, truncation: "none" },
    sharedBeforeInventory: sharedBeforeRef, sharedAfterInventory: sharedAfterRef, sharedDelta,
    productionBeforeInventory: productionBeforeRef, productionAfterInventory: productionAfterRef, productionDelta,
    dataProjectsBefore: dataBefore, dataProjectsAfter: dataAfter, workspaceRemainderBefore: remainderBefore,
    workspaceRemainderAfter: remainderAfter, runtimeRemainder: remainderAfter, authorityRemainder: remainderAfter,
    tempRemainder: remainderAfter, ownershipManifestBefore: ownershipBefore, ownershipManifestRemainder: ownershipAfter,
    status: timedOut ? "TIMEOUT" : passed ? "PASS" : "FAIL" });
  publishIntegratedJson(path.join(root, "children", `${spec.childId}.json`), manifest);
  if (!passed) fail("EVIDENCE_CHILD_TERMINAL_MISMATCH", `${spec.childId} failed\n${stdout.toString("utf8")}\n${stderr.toString("utf8")}`);
}

export function validateChildEvidence(root: string, spec: CanonicalSmokeChildSpec, runId: string, baselineHash: string): JsonObject {
  const manifest = readJson(path.join(root, "children", `${spec.childId}.json`), "EVIDENCE_CHILD_INTEGRITY_MISMATCH");
  equal({ matrixRunId: manifest.matrixRunId, baselineFingerprint: manifest.baselineFingerprint, partitionId: manifest.partitionId,
    childId: manifest.childId, suite: manifest.suite, expectedScenarios: manifest.expectedScenarios },
  { matrixRunId: runId, baselineFingerprint: baselineHash, partitionId: spec.partitionId, childId: spec.childId,
    suite: spec.suite, expectedScenarios: spec.expectedScenarios }, "EVIDENCE_CHILD_INTEGRITY_MISMATCH", `${spec.childId} identity contract mismatch`);
  const stdoutMeta = object(manifest.stdout, "EVIDENCE_CHILD_INTEGRITY_MISMATCH", "stdout"), stderrMeta = object(manifest.stderr, "EVIDENCE_CHILD_INTEGRITY_MISMATCH", "stderr");
  const stdout = fs.readFileSync(resolveRelative(root, string(stdoutMeta.relativePath, "EVIDENCE_CHILD_INTEGRITY_MISMATCH", "stdout path")));
  const stderr = fs.readFileSync(resolveRelative(root, string(stderrMeta.relativePath, "EVIDENCE_CHILD_INTEGRITY_MISMATCH", "stderr path")));
  if (sha256(stdout) !== stdoutMeta.sha256 || sha256(stderr) !== stderrMeta.sha256 || stdout.length !== stdoutMeta.originalByteCount ||
    stdout.length !== stdoutMeta.retainedByteCount || stderr.length !== stderrMeta.originalByteCount || stderr.length !== stderrMeta.retainedByteCount)
    fail("EVIDENCE_CHILD_INTEGRITY_MISMATCH", `${spec.childId} log integrity mismatch`);
  const observedTerminal = terminal(stdout.toString("utf8"), spec);
  equal({ count: manifest.terminalResultCount, parsed: manifest.parsedTerminalResult, finalLine: manifest.terminalResultFinalLine,
    conflicting: manifest.conflictingTerminalResult }, { count: observedTerminal.count, parsed: observedTerminal.parsed,
    finalLine: observedTerminal.finalLine, conflicting: observedTerminal.conflicting }, "EVIDENCE_CHILD_TERMINAL_MISMATCH", `${spec.childId} terminal self-report mismatch`);
  if (!observedTerminal.valid || manifest.status !== "PASS" || manifest.exitCode !== 0 || manifest.timedOut !== false)
    fail("EVIDENCE_CHILD_TERMINAL_MISMATCH", `${spec.childId} terminal result is not PASS`);
  const sharedBefore = loadInventory(root, manifest.sharedBeforeInventory, "EVIDENCE_CHILD_INTEGRITY_MISMATCH"),
    sharedAfter = loadInventory(root, manifest.sharedAfterInventory, "EVIDENCE_CHILD_INTEGRITY_MISMATCH"),
    productionBefore = loadInventory(root, manifest.productionBeforeInventory, "EVIDENCE_CHILD_INTEGRITY_MISMATCH"),
    productionAfter = loadInventory(root, manifest.productionAfterInventory, "EVIDENCE_CHILD_INTEGRITY_MISMATCH");
  const sharedDelta = delta(sharedBefore, sharedAfter), productionDelta = delta(productionBefore, productionAfter);
  equal(manifest.sharedDelta, sharedDelta, "EVIDENCE_CHILD_SHARED_DELTA", `${spec.childId} shared delta self-report mismatch`);
  equal(manifest.productionDelta, productionDelta, "EVIDENCE_CHILD_PRODUCTION_DELTA", `${spec.childId} production delta self-report mismatch`);
  if (!zero(sharedDelta) || sharedBefore.digest !== sharedAfter.digest || sharedBefore.count !== sharedAfter.count)
    fail("EVIDENCE_CHILD_SHARED_DELTA", `${spec.childId} shared before/after mismatch`);
  if (!zero(productionDelta) || productionBefore.digest !== productionAfter.digest || productionBefore.count !== productionAfter.count)
    fail("EVIDENCE_CHILD_PRODUCTION_DELTA", `${spec.childId} production before/after mismatch`);
  if (!cleanData(manifest.dataProjectsBefore) || !cleanData(manifest.dataProjectsAfter) ||
    canonicalStringify(manifest.dataProjectsBefore) !== canonicalStringify(manifest.dataProjectsAfter))
    fail("EVIDENCE_CHILD_DATA_PROJECTS_DIRTY", `${spec.childId} data/projects dirty`);
  for (const key of ["workspaceRemainderBefore", "workspaceRemainderAfter", "runtimeRemainder", "authorityRemainder",
    "tempRemainder", "ownershipManifestBefore", "ownershipManifestRemainder"])
    if (array(manifest[key], "EVIDENCE_CHILD_REMAINDER_PRESENT", `${spec.childId}.${key}`).length > 0)
      fail("EVIDENCE_CHILD_REMAINDER_PRESENT", `${spec.childId}.${key} is non-empty`);
  return manifest;
}

function runPartition(root: string, runId: string, baselineHash: string, partition: CanonicalSmokePartitionSpec,
  producedChildren: string[]): void {
  const sharedBefore = inventory(sharedRoot), productionBefore = inventory(productionRoot);
  const sharedBeforeRef = writeContentAddressedInventory(root, sharedBefore), productionBeforeRef = writeContentAddressedInventory(root, productionBefore);
  for (const childId of partition.childIds) { const spec = canonicalSmokeChildren.find((item) => item.childId === childId)!;
    runChild(root, runId, baselineHash, spec); producedChildren.push(childId); }
  const sharedAfter = inventory(sharedRoot), productionAfter = inventory(productionRoot);
  const sharedAfterRef = writeContentAddressedInventory(root, sharedAfter), productionAfterRef = writeContentAddressedInventory(root, productionAfter);
  const children = partition.childIds.map((childId) => { const spec = canonicalSmokeChildren.find((item) => item.childId === childId)!;
    const manifest = validateChildEvidence(root, spec, runId, baselineHash); return { childId, manifestHash: manifest.integrityHash }; });
  const sharedDelta = delta(sharedBefore, sharedAfter), productionDelta = delta(productionBefore, productionAfter);
  const manifest = addIntegrity({ schemaVersion, matrixRunId: runId, baselineFingerprint: baselineHash,
    partitionId: partition.partitionId, expectedChildIds: partition.childIds, observedChildIds: children.map((item) => item.childId),
    completed: children.length, passed: children.length, failed: 0, timedOut: 0, interrupted: 0, missing: 0,
    duplicate: 0, foreignChild: 0, sharedBeforeInventory: sharedBeforeRef, sharedAfterInventory: sharedAfterRef,
    sharedDelta, productionBeforeInventory: productionBeforeRef, productionAfterInventory: productionAfterRef,
    productionDelta, remainderBefore: remainders(), remainderAfter: remainders(), childManifestHashes: children, status: "PASS" });
  if (!zero(sharedDelta)) fail("EVIDENCE_CHILD_SHARED_DELTA", `${partition.partitionId} shared delta`);
  if (!zero(productionDelta)) fail("EVIDENCE_CHILD_PRODUCTION_DELTA", `${partition.partitionId} production delta`);
  publishIntegratedJson(path.join(root, "partitions", `${partition.partitionId}.json`), manifest);
}

export function validatePartitionEvidence(root: string, partition: CanonicalSmokePartitionSpec, runId: string, baselineHash: string): JsonObject {
  const manifest = readJson(path.join(root, "partitions", `${partition.partitionId}.json`), "EVIDENCE_PARTITION_COVERAGE_MISMATCH");
  const children = partition.childIds.map((childId) => { const spec = canonicalSmokeChildren.find((item) => item.childId === childId)!;
    const child = validateChildEvidence(root, spec, runId, baselineHash); return { childId, manifestHash: child.integrityHash }; });
  equal({ matrixRunId: manifest.matrixRunId, baselineFingerprint: manifest.baselineFingerprint, partitionId: manifest.partitionId,
    expectedChildIds: manifest.expectedChildIds, observedChildIds: manifest.observedChildIds, childManifestHashes: manifest.childManifestHashes },
  { matrixRunId: runId, baselineFingerprint: baselineHash, partitionId: partition.partitionId,
    expectedChildIds: partition.childIds, observedChildIds: partition.childIds, childManifestHashes: children },
  "EVIDENCE_PARTITION_COVERAGE_MISMATCH", `${partition.partitionId} coverage mismatch`);
  const derivedCounters = { completed: children.length, passed: children.length, failed: 0, timedOut: 0,
    interrupted: 0, missing: 0, duplicate: 0, foreignChild: 0, status: "PASS" };
  equal(Object.fromEntries(Object.keys(derivedCounters).map((key) => [key, manifest[key]])), derivedCounters,
    "EVIDENCE_PARTITION_COUNTER_MISMATCH", `${partition.partitionId} counters mismatch`);
  const sharedBefore = loadInventory(root, manifest.sharedBeforeInventory, "EVIDENCE_CHILD_INTEGRITY_MISMATCH"),
    sharedAfter = loadInventory(root, manifest.sharedAfterInventory, "EVIDENCE_CHILD_INTEGRITY_MISMATCH"),
    productionBefore = loadInventory(root, manifest.productionBeforeInventory, "EVIDENCE_CHILD_INTEGRITY_MISMATCH"),
    productionAfter = loadInventory(root, manifest.productionAfterInventory, "EVIDENCE_CHILD_INTEGRITY_MISMATCH");
  equal(manifest.sharedDelta, delta(sharedBefore, sharedAfter), "EVIDENCE_CHILD_SHARED_DELTA", `${partition.partitionId} shared self-report`);
  equal(manifest.productionDelta, delta(productionBefore, productionAfter), "EVIDENCE_CHILD_PRODUCTION_DELTA", `${partition.partitionId} production self-report`);
  if (!zero(delta(sharedBefore, sharedAfter))) fail("EVIDENCE_CHILD_SHARED_DELTA", `${partition.partitionId} shared changed`);
  if (!zero(delta(productionBefore, productionAfter))) fail("EVIDENCE_CHILD_PRODUCTION_DELTA", `${partition.partitionId} production changed`);
  if (array(manifest.remainderBefore, "EVIDENCE_CHILD_REMAINDER_PRESENT", "partition remainder").length ||
    array(manifest.remainderAfter, "EVIDENCE_CHILD_REMAINDER_PRESENT", "partition remainder").length)
    fail("EVIDENCE_CHILD_REMAINDER_PRESENT", `${partition.partitionId} remainder present`);
  return manifest;
}

function initialize(root: string, runId: string, head: string, initialProcessIdentity: JsonObject): void {
  const rootIdentity = requireStableDirectory(root);
  for (const directory of ["children", "partitions", "logs", "inventories", "orchestrators", "resume-events"]) {
    requireStableDirectory(root, rootIdentity); const target = path.join(root, directory);
    fs.mkdirSync(target, { recursive: false }); requireStableDirectory(target); requireStableDirectory(root, rootIdentity);
  }
  const shared = writeContentAddressedInventory(root, inventory(sharedRoot)), production = writeContentAddressedInventory(root, inventory(productionRoot));
  const baseline = addIntegrity({ schemaVersion, serializationSchemaVersion, matrixRunId: runId, head,
    timestamp: new Date().toISOString(), sharedInventory: shared, productionInventory: production,
    dataProjects: dataProjectsState(), remainderInventory: remainders(), ownershipManifestInventory: ownershipRemainders(),
    environmentPolicyFingerprint: hostileEnvironmentPolicyFingerprint, environmentEvidence: environmentEvidence(),
    registrationEvidence: registrationEvidence() });
  publishIntegratedJson(path.join(root, "baseline.json"), baseline);
  const matrix = addIntegrity({ schemaVersion, serializationSchemaVersion, serializationPolicyFingerprint,
    matrixRunId: runId, head, createdAt: new Date().toISOString(), initialProcessIdentity,
    authoritativeSuiteRegistryFingerprint: canonicalSmokeRegistryFingerprint, hostileEnvironmentPolicyFingerprint,
    childTimeoutPolicyFingerprint, expectedContract: expectedContract(), baselineFingerprint: baseline.integrityHash,
    evidenceRootAuthority: rootAuthority(root), status: "running" });
  publishIntegratedJson(path.join(root, "matrix-manifest.json"), matrix);
}

function orchestratorFiles(root: string): readonly string[] { return fs.readdirSync(path.join(root, "orchestrators"))
  .filter((name) => name.endsWith(".json")).sort(compare); }
function orchestrators(root: string): readonly JsonObject[] { return orchestratorFiles(root)
  .map((name) => readJson(path.join(root, "orchestrators", name), "EVIDENCE_RESUME_PROVENANCE_MISMATCH")); }
function writeOrchestrator(root: string, value: MutableRecord): JsonObject { const integrated = addIntegrity(value);
  publishIntegratedJson(path.join(root, "orchestrators", `${string(integrated.orchestratorId,
    "EVIDENCE_RESUME_PROVENANCE_MISMATCH", "orchestratorId")}.json`), integrated); return integrated; }
function acquireLease(root: string, runId: string, orchestratorId: string): { readonly manifest: JsonObject; readonly identity: Identity } {
  const leasePath = path.join(root, "active-lease.json"); if (fs.existsSync(leasePath)) fail("EVIDENCE_ACTIVE_LEASE", "active lease exists");
  publishIntegratedJson(leasePath, addIntegrity({ schemaVersion, matrixRunId: runId, orchestratorId,
    acquiredAt: new Date().toISOString(), processIdentity: processIdentity() })); return { manifest: readJson(leasePath,
      "EVIDENCE_ACTIVE_LEASE"), identity: identity(leasePath) };
}

function validateProcessIdentity(value: unknown, label: string): JsonObject {
  const process = object(value, "EVIDENCE_RESUME_PROVENANCE_MISMATCH", label), pid = process.pid,
    started = process.startedAtEpochMs, executable = process.executable, startIdentity = process.processStartIdentity;
  if (!Number.isInteger(pid) || (pid as number) <= 0 || !Number.isInteger(started) || (started as number) <= 0 ||
    typeof executable !== "string" || executable.length === 0 || executable !== normalizePath(executable) ||
    typeof startIdentity !== "string" || startIdentity !== `${pid}:${started}:${sha256(executable).slice(0, 16)}`)
    fail("EVIDENCE_RESUME_PROVENANCE_MISMATCH", `${label} is malformed`);
  return process;
}

function validateLeaseIdentity(value: unknown, root: string, label: string): JsonObject {
  const lease = object(value, "EVIDENCE_RESUME_PROVENANCE_MISMATCH", label);
  if (lease.canonicalPath !== normalizePath(path.join(root, "active-lease.json")) || lease.type !== "file" ||
    lease.reparse !== false || typeof lease.device !== "string" || lease.device.length === 0 ||
    typeof lease.inode !== "string" || lease.inode.length === 0)
    fail("EVIDENCE_RESUME_PROVENANCE_MISMATCH", `${label} is malformed`);
  return lease;
}

function validateProvenance(root: string, requireComplete: boolean): readonly JsonObject[] {
  const files = orchestratorFiles(root), records = orchestrators(root);
  if (records.length < (requireComplete ? 2 : 1)) fail("EVIDENCE_RESUME_PROVENANCE_MISSING", "orchestrator records missing");
  const matrix = readJson(path.join(root, "matrix-manifest.json"), "EVIDENCE_RESUME_PROVENANCE_MISMATCH"),
    actualAuthority = rootAuthority(root), p1 = canonicalSmokePartitions[0], p1Children = [...p1.childIds],
    remainingPartitions = canonicalSmokePartitions.slice(1), remainingPartitionIds = remainingPartitions.map((item) => item.partitionId),
    remainingChildren = remainingPartitions.flatMap((item) => [...item.childIds]), allPartitions = canonicalSmokePartitions.map((item) => item.partitionId),
    allChildren = canonicalSmokeChildren.map((item) => item.childId);
  let previousId: string | null = null, previousHash: string | null = null;
  const identities: JsonObject[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index], id = string(record.orchestratorId, "EVIDENCE_RESUME_PROVENANCE_MISMATCH", "orchestratorId");
    if (files[index] !== `${id}.json` || record.previousOrchestratorId !== previousId || record.previousRecordHash !== previousHash)
      fail("EVIDENCE_RESUME_PROVENANCE_MISMATCH", "orchestrator filename/previous chain mismatch");
    if (record.schemaVersion !== schemaVersion || record.matrixRunId !== matrix.matrixRunId ||
      record.baselineFingerprint !== matrix.baselineFingerprint || record.registryFingerprint !== canonicalSmokeRegistryFingerprint ||
      record.overwriteAttempts !== 0)
      fail("EVIDENCE_RESUME_PROVENANCE_MISMATCH", "orchestrator common contract mismatch");
    equal(record.rootAuthority, actualAuthority, "EVIDENCE_RESUME_PROVENANCE_MISMATCH", "orchestrator root authority mismatch");
    const acquired = validateLeaseIdentity(record.leaseAcquiredIdentity, root, "lease acquired"),
      released = validateLeaseIdentity(record.leaseReleasedIdentity, root, "lease released");
    equal(acquired, released, "EVIDENCE_RESUME_PROVENANCE_MISMATCH", "lease acquired/released identity mismatch");
    const identityValue = validateProcessIdentity(record.processIdentity, "orchestrator process identity"); identities.push(identityValue);
    const startedAt = Date.parse(string(record.startedAt, "EVIDENCE_RESUME_PROVENANCE_MISMATCH", "startedAt")),
      finishedAt = Date.parse(string(record.finishedAt, "EVIDENCE_RESUME_PROVENANCE_MISMATCH", "finishedAt"));
    if (!Number.isFinite(startedAt) || !Number.isFinite(finishedAt) || finishedAt < startedAt)
      fail("EVIDENCE_RESUME_PROVENANCE_MISMATCH", "orchestrator timestamps invalid");
    previousId = id; previousHash = string(record.integrityHash, "EVIDENCE_RESUME_PROVENANCE_MISMATCH", "record hash");
  }
  equal(matrix.initialProcessIdentity, identities[0], "EVIDENCE_RESUME_PROVENANCE_MISMATCH", "matrix initial process identity mismatch");
  if (new Set(identities.map((item) => canonicalStringify(item))).size !== identities.length)
    fail("EVIDENCE_RESUME_PROVENANCE_MISMATCH", "orchestrator process identities are not unique");
  const modes = records.map((item) => item.mode), expectedModes = requireComplete && records.length === 3
    ? ["start", "resume", "aggregate"] : ["start", "resume"].slice(0, records.length);
  equal(modes, expectedModes, "EVIDENCE_RESUME_PROVENANCE_MISMATCH", "foreign or out-of-order orchestrator record");
  const start = records[0];
  equal({ status: start.status, observedChildren: start.observedChildren, scheduledChildren: start.scheduledChildren,
    skippedChildren: start.skippedChildren, producedChildren: start.producedChildren, observedPartitions: start.observedPartitions,
    scheduledPartitions: start.scheduledPartitions, skippedPartitions: start.skippedPartitions, producedPartitions: start.producedPartitions },
  { status: "INTERRUPTED", observedChildren: [], scheduledChildren: p1Children, skippedChildren: [], producedChildren: p1Children,
    observedPartitions: [], scheduledPartitions: ["P1"], skippedPartitions: [], producedPartitions: ["P1"] },
  "EVIDENCE_RESUME_PROVENANCE_MISMATCH", "start orchestrator coverage mismatch");
  if (records.length >= 2) {
    const resume = records[1];
    equal({ status: resume.status, observedChildren: resume.observedChildren, scheduledChildren: resume.scheduledChildren,
      skippedChildren: resume.skippedChildren, producedChildren: resume.producedChildren, observedPartitions: resume.observedPartitions,
      scheduledPartitions: resume.scheduledPartitions, skippedPartitions: resume.skippedPartitions, producedPartitions: resume.producedPartitions },
    { status: "READY_FOR_AGGREGATE", observedChildren: p1Children, scheduledChildren: remainingChildren,
      skippedChildren: p1Children, producedChildren: remainingChildren, observedPartitions: ["P1"],
      scheduledPartitions: remainingPartitionIds, skippedPartitions: ["P1"], producedPartitions: remainingPartitionIds },
    "EVIDENCE_RESUME_PROVENANCE_MISMATCH", "resume orchestrator coverage mismatch");
    const events = fs.readdirSync(path.join(root, "resume-events")).filter((name) => name.endsWith(".json")).sort(compare);
    if (events.length !== 1 || events[0] !== "0001.json") fail("EVIDENCE_RESUME_PROVENANCE_MISSING", "resume event sequence missing");
    const event = readJson(path.join(root, "resume-events", events[0]), "EVIDENCE_RESUME_PROVENANCE_MISMATCH");
    equal({ previousOrchestratorId: event.previousOrchestratorId, previousOrchestratorHash: event.previousOrchestratorHash,
      newOrchestratorId: event.newOrchestratorId, newOrchestratorHash: event.newOrchestratorHash, reason: event.reason,
      overwriteAttempts: event.overwriteAttempts, verifiedChildIds: event.verifiedChildIds, resumedChildIds: event.resumedChildIds,
      verifiedPartitionIds: event.verifiedPartitionIds, resumedPartitionIds: event.resumedPartitionIds },
    { previousOrchestratorId: start.orchestratorId, previousOrchestratorHash: start.integrityHash,
      newOrchestratorId: resume.orchestratorId, newOrchestratorHash: resume.integrityHash, reason: "controlled-interruption",
      overwriteAttempts: 0, verifiedChildIds: p1Children, resumedChildIds: remainingChildren,
      verifiedPartitionIds: ["P1"], resumedPartitionIds: remainingPartitionIds },
    "EVIDENCE_RESUME_PROVENANCE_MISMATCH", "resume event linkage/coverage mismatch");
    const p1Manifest = readJson(path.join(root, "partitions", "P1.json"), "EVIDENCE_RESUME_PROVENANCE_MISMATCH");
    equal(event.preservedPartitionHashes, [{ partitionId: "P1", manifestHash: p1Manifest.integrityHash }],
      "EVIDENCE_RESUME_PROVENANCE_MISMATCH", "preserved P1 hash mismatch");
  }
  if (records.length === 3) {
    const aggregate = records[2];
    equal({ status: aggregate.status, observedChildren: aggregate.observedChildren, scheduledChildren: aggregate.scheduledChildren,
      skippedChildren: aggregate.skippedChildren, producedChildren: aggregate.producedChildren, observedPartitions: aggregate.observedPartitions,
      scheduledPartitions: aggregate.scheduledPartitions, skippedPartitions: aggregate.skippedPartitions, producedPartitions: aggregate.producedPartitions },
    { status: "PASS", observedChildren: allChildren, scheduledChildren: [], skippedChildren: [], producedChildren: [],
      observedPartitions: allPartitions, scheduledPartitions: [], skippedPartitions: [], producedPartitions: [] },
    "EVIDENCE_RESUME_PROVENANCE_MISMATCH", "aggregate orchestrator coverage mismatch");
  }
  return records;
}

function validateResume(root: string, runId: string, head: string): { readonly matrix: JsonObject; readonly baseline: JsonObject;
  readonly prior: JsonObject; readonly preserved: readonly JsonObject[]; readonly existingChildren: readonly string[] } {
  if (fs.existsSync(path.join(root, "active-lease.json"))) fail("EVIDENCE_ACTIVE_LEASE", "active lease exists");
  assertNoPartials(root); const matrix = validateMatrixContract(root, runId);
  if (matrix.head !== head) fail("EVIDENCE_MATRIX_HEAD_MISMATCH", "resume HEAD mismatch");
  const baseline = validateBaselineEvidence(root, matrix), baselineHash = string(baseline.integrityHash, "EVIDENCE_BASELINE_MISMATCH", "baseline hash");
  const records = validateProvenance(root, false), prior = records.at(-1)!;
  if (prior.mode !== "start" || prior.status !== "INTERRUPTED") fail("EVIDENCE_RESUME_PROVENANCE_MISMATCH", "prior record is not controlled interruption");
  const preserved: JsonObject[] = [], existingChildren: string[] = [];
  for (const partition of canonicalSmokePartitions) { const target = path.join(root, "partitions", `${partition.partitionId}.json`);
    if (!fs.existsSync(target)) continue; const manifest = validatePartitionEvidence(root, partition, runId, baselineHash);
    preserved.push({ partitionId: partition.partitionId, manifestHash: manifest.integrityHash }); existingChildren.push(...partition.childIds); }
  equal(preserved.map((item) => item.partitionId), ["P1"], "EVIDENCE_RESUME_PROVENANCE_MISMATCH", "resume boundary is not exactly P1");
  return { matrix, baseline, prior, preserved, existingChildren };
}

function writeFinal(root: string, runId: string, baseline: JsonObject): void {
  const shared = writeContentAddressedInventory(root, inventory(sharedRoot)), production = writeContentAddressedInventory(root, inventory(productionRoot));
  const baselineShared = loadInventory(root, baseline.sharedInventory, "EVIDENCE_BASELINE_MISMATCH"), baselineProduction = loadInventory(root, baseline.productionInventory, "EVIDENCE_BASELINE_MISMATCH");
  const finalShared = loadInventory(root, shared, "EVIDENCE_CHILD_INTEGRITY_MISMATCH"), finalProduction = loadInventory(root, production, "EVIDENCE_CHILD_INTEGRITY_MISMATCH");
  const sharedDelta = delta(baselineShared, finalShared), productionDelta = delta(baselineProduction, finalProduction), dataProjects = dataProjectsState();
  const manifest = addIntegrity({ schemaVersion, matrixRunId: runId, baselineFingerprint: baseline.integrityHash,
    head: currentHead(), sharedFinalInventory: shared, productionFinalInventory: production, sharedDelta, productionDelta,
    dataProjects, workspaceRemainder: remainders(), runtimeRemainder: remainders(), authorityRemainder: remainders(),
    tempRemainder: remainders(), ownershipManifestRemainder: ownershipRemainders(),
    finalEnvironmentEvidence: environmentEvidence(), finalRegistrationEvidence: registrationEvidence(),
    environmentRestored: canonicalStringify(baseline.environmentEvidence) === canonicalStringify(environmentEvidence()),
    globalRegistrationRestored: canonicalStringify(baseline.registrationEvidence) === canonicalStringify(registrationEvidence()),
    finalTimestamp: new Date().toISOString() });
  publishIntegratedJson(path.join(root, "final-integrity.json"), manifest);
}

export function validateFinalIntegrityEvidence(root: string, matrix: JsonObject, baseline: JsonObject): JsonObject {
  if (!fs.existsSync(path.join(root, "final-integrity.json"))) fail("EVIDENCE_INCOMPLETE_MATRIX", "final integrity missing");
  const final = readJson(path.join(root, "final-integrity.json"), "EVIDENCE_INCOMPLETE_MATRIX");
  equal({ matrixRunId: final.matrixRunId, baselineFingerprint: final.baselineFingerprint, head: final.head },
    { matrixRunId: matrix.matrixRunId, baselineFingerprint: baseline.integrityHash, head: matrix.head },
    "EVIDENCE_BASELINE_MISMATCH", "final linkage mismatch");
  const baselineShared = loadInventory(root, baseline.sharedInventory, "EVIDENCE_BASELINE_MISMATCH"),
    baselineProduction = loadInventory(root, baseline.productionInventory, "EVIDENCE_BASELINE_MISMATCH"),
    finalShared = loadInventory(root, final.sharedFinalInventory, "EVIDENCE_CHILD_INTEGRITY_MISMATCH"),
    finalProduction = loadInventory(root, final.productionFinalInventory, "EVIDENCE_CHILD_INTEGRITY_MISMATCH");
  const sharedDelta = delta(baselineShared, finalShared), productionDelta = delta(baselineProduction, finalProduction);
  equal(final.sharedDelta, sharedDelta, "EVIDENCE_CHILD_SHARED_DELTA", "final shared delta self-report mismatch");
  equal(final.productionDelta, productionDelta, "EVIDENCE_CHILD_PRODUCTION_DELTA", "final production delta self-report mismatch");
  if (!zero(sharedDelta)) fail("EVIDENCE_CHILD_SHARED_DELTA", "final shared inventory differs from baseline");
  if (!zero(productionDelta)) fail("EVIDENCE_CHILD_PRODUCTION_DELTA", "final production inventory differs from baseline");
  if (!cleanData(final.dataProjects)) fail("EVIDENCE_CHILD_DATA_PROJECTS_DIRTY", "final data/projects dirty");
  for (const key of ["workspaceRemainder", "runtimeRemainder", "authorityRemainder", "tempRemainder", "ownershipManifestRemainder"])
    if (array(final[key], "EVIDENCE_CHILD_REMAINDER_PRESENT", `final.${key}`).length)
      fail("EVIDENCE_CHILD_REMAINDER_PRESENT", `final.${key} present`);
  const baselineEnvironment = validateEnvironmentFingerprint(baseline.environmentEvidence),
    finalEnvironment = validateEnvironmentFingerprint(final.finalEnvironmentEvidence),
    baselineRegistration = validateRegistrationFingerprint(baseline.registrationEvidence),
    finalRegistration = validateRegistrationFingerprint(final.finalRegistrationEvidence);
  const environmentRestored = canonicalStringify(baselineEnvironment) === canonicalStringify(finalEnvironment),
    registrationRestored = canonicalStringify(baselineRegistration) === canonicalStringify(finalRegistration);
  if (!environmentRestored || final.environmentRestored !== environmentRestored)
    fail("EVIDENCE_ENVIRONMENT_RESTORE_MISMATCH", "environment restore derivation mismatch");
  if (!registrationRestored || final.globalRegistrationRestored !== registrationRestored)
    fail("EVIDENCE_REGISTRATION_RESTORE_MISMATCH", "registration restore derivation mismatch");
  return final;
}

export interface RunEvidenceOptions { readonly matrixRunId: string; readonly evidenceRoot?: string;
  readonly resume?: boolean; readonly stopAfterPartition?: string }
export function runEvidenceMatrix(options: RunEvidenceOptions): { readonly status: "READY_FOR_AGGREGATE" | "INTERRUPTED";
  readonly evidenceRoot: string } {
  const runId = options.matrixRunId, root = path.resolve(options.evidenceRoot ?? defaultEvidenceRoot(runId)), head = currentHead();
  const orchestratorProcessIdentity = processIdentity();
  if (options.resume) assertExistingEvidenceRoot(root, runId); else prepareNewEvidenceRoot(root, runId);
  let baseline: JsonObject, prior: JsonObject | undefined, preserved: readonly JsonObject[] = [], existingChildren: readonly string[] = [];
  if (options.resume) { const state = validateResume(root, runId, head); baseline = state.baseline; prior = state.prior;
    preserved = state.preserved; existingChildren = state.existingChildren; }
  else { initialize(root, runId, head, orchestratorProcessIdentity); const matrix = validateMatrixContract(root, runId); baseline = validateBaselineEvidence(root, matrix); }
  const orchestratorId = `${String(orchestratorFiles(root).length + 1).padStart(4, "0")}-${randomUUID()}`;
  const lease = acquireLease(root, runId, orchestratorId), baselineHash = string(baseline.integrityHash, "EVIDENCE_BASELINE_MISMATCH", "baseline hash");
  const scheduledPartitions: string[] = [], producedPartitions: string[] = [], producedChildren: string[] = [];
  let status: "READY_FOR_AGGREGATE" | "INTERRUPTED" = "READY_FOR_AGGREGATE", record: JsonObject | undefined;
  try {
    for (const partition of canonicalSmokePartitions) {
      const partitionPath = path.join(root, "partitions", `${partition.partitionId}.json`);
      if (fs.existsSync(partitionPath)) { validatePartitionEvidence(root, partition, runId, baselineHash); continue; }
      scheduledPartitions.push(partition.partitionId); runPartition(root, runId, baselineHash, partition, producedChildren);
      producedPartitions.push(partition.partitionId);
      if (options.stopAfterPartition === partition.partitionId) { status = "INTERRUPTED"; break; }
    }
    const mode = options.resume ? "resume" : "start";
    record = writeOrchestrator(root, { schemaVersion, matrixRunId: runId, orchestratorId, processIdentity: orchestratorProcessIdentity,
      startedAt: lease.manifest.acquiredAt, finishedAt: new Date().toISOString(), mode, status,
      leaseAcquiredIdentity: lease.identity, leaseReleasedIdentity: lease.identity,
      observedChildren: existingChildren, scheduledChildren: scheduledPartitions.flatMap((id) => canonicalSmokePartitions.find((item) => item.partitionId === id)!.childIds),
      skippedChildren: existingChildren, producedChildren, observedPartitions: preserved.map((item) => item.partitionId),
      scheduledPartitions, skippedPartitions: preserved.map((item) => item.partitionId), producedPartitions,
      previousOrchestratorId: prior?.orchestratorId ?? null, previousRecordHash: prior?.integrityHash ?? null,
      overwriteAttempts: 0, baselineFingerprint: baselineHash,
      registryFingerprint: canonicalSmokeRegistryFingerprint, rootAuthority: rootAuthority(root) });
    if (options.resume) {
      const event = addIntegrity({ schemaVersion, matrixRunId: runId, sequence: 1, reason: "controlled-interruption",
        previousOrchestratorId: prior!.orchestratorId, previousOrchestratorHash: prior!.integrityHash,
        newOrchestratorId: record.orchestratorId, newOrchestratorHash: record.integrityHash,
        verifiedChildIds: existingChildren, resumedChildIds: producedChildren,
        verifiedPartitionIds: preserved.map((item) => item.partitionId), resumedPartitionIds: scheduledPartitions,
        preservedPartitionHashes: preserved, overwriteAttempts: 0, timestamp: new Date().toISOString() });
      publishIntegratedJson(path.join(root, "resume-events", "0001.json"), event);
    }
    if (status === "READY_FOR_AGGREGATE") writeFinal(root, runId, baseline);
    return { status, evidenceRoot: root };
  } finally {
    const leasePath = path.join(root, "active-lease.json"); if (fs.existsSync(leasePath)) {
      const current = identity(leasePath); if (!identityEqual(current, lease.identity))
        fail("EVIDENCE_RESUME_PROVENANCE_MISMATCH", "lease identity changed before release"); fs.unlinkSync(leasePath); }
  }
}

export function deriveAggregateResult(rootInput: string): JsonObject {
  const root = path.resolve(rootInput); assertNoPartials(root); const matrix = validateMatrixContract(root);
  const baseline = validateBaselineEvidence(root, matrix), runId = string(matrix.matrixRunId, "EVIDENCE_BASELINE_MISMATCH", "runId"),
    baselineHash = string(baseline.integrityHash, "EVIDENCE_BASELINE_MISMATCH", "baseline hash");
  if (fs.existsSync(path.join(root, "active-lease.json"))) fail("EVIDENCE_ACTIVE_LEASE", "active lease exists");
  const childFiles = fs.readdirSync(path.join(root, "children")).filter((name) => name.endsWith(".json")).sort(compare),
    expectedChildFiles = canonicalSmokeChildren.map((item) => `${item.childId}.json`).sort(compare);
  const partitionFiles = fs.readdirSync(path.join(root, "partitions")).filter((name) => name.endsWith(".json")).sort(compare),
    expectedPartitionFiles = canonicalSmokePartitions.map((item) => `${item.partitionId}.json`).sort(compare);
  const missingChildren = expectedChildFiles.filter((name) => !childFiles.includes(name)), foreignChildren = childFiles.filter((name) => !expectedChildFiles.includes(name));
  const missingPartitions = expectedPartitionFiles.filter((name) => !partitionFiles.includes(name)), foreignPartitions = partitionFiles.filter((name) => !expectedPartitionFiles.includes(name));
  if (missingChildren.length || foreignChildren.length || missingPartitions.length || foreignPartitions.length)
    fail("EVIDENCE_INCOMPLETE_MATRIX", "child/partition disk coverage incomplete or foreign");
  const children = canonicalSmokeChildren.map((spec) => validateChildEvidence(root, spec, runId, baselineHash));
  const partitions = canonicalSmokePartitions.map((spec) => validatePartitionEvidence(root, spec, runId, baselineHash));
  const final = validateFinalIntegrityEvidence(root, matrix, baseline), provenance = validateProvenance(root, true);
  const counters = { expectedChildren: canonicalSmokeChildren.length, verifiedChildren: children.length,
    expectedPartitions: canonicalSmokePartitions.length, verifiedPartitions: partitions.length,
    duplicate: childFiles.length - new Set(childFiles).size, missing: missingChildren.length + missingPartitions.length,
    foreign: foreignChildren.length + foreignPartitions.length, failed: children.filter((item) => item.status !== "PASS").length,
    skipped: children.filter((item) => item.status === "SKIP").length,
    timedOut: children.filter((item) => item.timedOut === true).length,
    interrupted: children.filter((item) => item.status === "INTERRUPTED").length };
  return addIntegrity({ schemaVersion, matrixRunId: runId, matrixManifestHash: matrix.integrityHash,
    baselineHash, ...counters, suiteCoverage: canonicalSmokeChildren.map((spec, index) => ({ childId: spec.childId,
      suite: spec.suite, expectedScenarios: spec.expectedScenarios, observedScenarios: children[index].expectedScenarios })),
    scenarioCountCoverage: "exact", sharedIntegrity: "PASS", productionIntegrity: "PASS", remainder: "PASS",
    provenanceRecords: provenance.length, finalIntegrityHash: final.integrityHash, finalStatus: "PASS" });
}

export function validateAggregateEvidence(root: string, derived = deriveAggregateResult(root)): JsonObject {
  const aggregatePath = path.join(root, "aggregate.json"); if (!fs.existsSync(aggregatePath))
    fail("EVIDENCE_INCOMPLETE_MATRIX", "persisted aggregate missing");
  const persisted = readJson(aggregatePath, "EVIDENCE_AGGREGATE_COUNTER_MISMATCH");
  equal(persisted, derived, "EVIDENCE_AGGREGATE_COUNTER_MISMATCH", "persisted aggregate differs from disk-derived result");
  return persisted;
}

export function aggregateEvidence(rootInput: string): JsonObject {
  const root = path.resolve(rootInput), aggregatePath = path.join(root, "aggregate.json");
  if (fs.existsSync(aggregatePath)) return validateAggregateEvidence(root);
  deriveAggregateResult(root);
  const records = orchestrators(root), previous = records.at(-1)!;
  const matrix = readJson(path.join(root, "matrix-manifest.json"), "EVIDENCE_RESUME_PROVENANCE_MISMATCH"),
    runId = string(matrix.matrixRunId, "EVIDENCE_BASELINE_MISMATCH", "matrixRunId"),
    orchestratorId = `${String(records.length + 1).padStart(4, "0")}-${randomUUID()}`,
    lease = acquireLease(root, runId, orchestratorId), aggregateProcessIdentity = processIdentity();
  try {
    writeOrchestrator(root, { schemaVersion, matrixRunId: runId, orchestratorId, processIdentity: aggregateProcessIdentity,
      startedAt: lease.manifest.acquiredAt, finishedAt: new Date().toISOString(), mode: "aggregate", status: "PASS",
      leaseAcquiredIdentity: lease.identity, leaseReleasedIdentity: lease.identity,
      observedChildren: canonicalSmokeChildren.map((item) => item.childId), scheduledChildren: [], skippedChildren: [], producedChildren: [],
      observedPartitions: canonicalSmokePartitions.map((item) => item.partitionId), scheduledPartitions: [], skippedPartitions: [], producedPartitions: [],
      previousOrchestratorId: previous.orchestratorId, previousRecordHash: previous.integrityHash,
      overwriteAttempts: 0, baselineFingerprint: matrix.baselineFingerprint,
      registryFingerprint: canonicalSmokeRegistryFingerprint, rootAuthority: rootAuthority(root) });
  } finally {
    const leasePath = path.join(root, "active-lease.json");
    if (fs.existsSync(leasePath)) {
      const current = identity(leasePath); if (!identityEqual(current, lease.identity))
        fail("EVIDENCE_RESUME_PROVENANCE_MISMATCH", "aggregate lease identity changed"); fs.unlinkSync(leasePath);
    }
  }
  const derived = deriveAggregateResult(root); publishIntegratedJson(aggregatePath, derived); return validateAggregateEvidence(root, derived);
}
