import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { Asset } from "@/types/asset";
import { containsReservedSafeEvidenceTerm, isSafeAudioIdentifier } from "./AudioIdentifierPolicy";
import { isSafeAudioCompensationRef } from "./AudioCompensationStore";
import { requireActiveProductionRuntimeOperationContext } from
  "@/lib/runtime/ProductionRuntimeOperationContext";
import {
  assertProjectWriteAuthorityLease,
  ensureSafeContainedDirectory,
  resolveRuntimeLogicalPath,
  resolveRuntimeLogicalPathForWrite,
  resolveRuntimeStorageContext,
  type RuntimeStorageAuthorityLease,
  type RuntimeStorageContext,
  type RuntimeStorageInput,
} from "@/lib/runtime/RuntimeStoragePaths";
import type { PortablePublishedFile } from
  "@/lib/runtime/security/PortableNoClobberFilePublisher";
import {
  readAudioFileDescriptorBound,
  readContainedAudioFileDescriptorBound,
} from "./AudioDescriptorBoundVerification";
import { isAdmissibleProductionProvider } from "@/lib/production/ProductionProviderResolution";

const SCHEMA = "audio-publication-intent-v1";
const DIRECTORY = "audio-publication-intents";
const REBIND_SCHEMA = "audio-publication-rebind-v1";
const REBIND_DIRECTORY = "audio-publication-rebinds";
const MAX_INTENT_BYTES = 16 * 1024;
const MAX_INTENTS = 128;
const SAFE_ID = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,126}[a-zA-Z0-9])?$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

export const audioPublicationLifecycleStates = Object.freeze([
  "preparing",
  "prepared",
  "publishing",
  "committed",
  "failed-precommit",
  "conflict",
] as const);
export type AudioPublicationLifecycleState =
  (typeof audioPublicationLifecycleStates)[number];

export class AudioPublicationIntentError extends Error {
  constructor() {
    super("Audio publication intent is invalid.");
    this.name = "AudioPublicationIntentError";
    this.stack = undefined;
  }
}

export class AudioPublicationIntentConflictError extends AudioPublicationIntentError {
  constructor() {
    super();
    this.name = "AudioPublicationIntentConflictError";
  }
}

/**
 * The original "prepared" intent is never edited (write-once, per SCHEMA above). A rebind is a
 * separate, additive, itself-immutable ledger entry: it re-anchors the expected device/inode to
 * the currently-observed physical file, but only after independently re-verifying that the
 * canonical file's content (sha256 + byteLength) still matches what the original intent (or the
 * prior rebind in the chain) recorded. It never touches asset identity, content hash, or byte
 * length — those are re-checked, never re-authored. See ATOLYE_CHECKPOINT.md Sprint 136 for the
 * incident (git checkout/pull re-materializing tracked canonical audio files with a fresh inode,
 * identical bytes) this exists to recover from without weakening content-integrity guarantees.
 */
export const audioPublicationRebindReasonCodes = Object.freeze([
  "FILESYSTEM_MATERIALIZATION_DRIFT",
] as const);
export type AudioPublicationRebindReasonCode =
  (typeof audioPublicationRebindReasonCodes)[number];

export class AudioPublicationRebindError extends Error {
  constructor() {
    super("Audio publication descriptor rebind is invalid.");
    this.name = "AudioPublicationRebindError";
    this.stack = undefined;
  }
}

export class AudioPublicationRebindConflictError extends AudioPublicationRebindError {
  constructor() {
    super();
    this.name = "AudioPublicationRebindConflictError";
  }
}

export interface AudioPublicationRebindRecordReference {
  readonly kind: "intent" | "rebind";
  readonly id: string;
  readonly integrity: string;
}

export interface AudioPublicationDescriptorRebind {
  readonly schemaVersion: typeof REBIND_SCHEMA;
  readonly rebindId: string;
  readonly assetId: string;
  readonly sequence: number;
  readonly projectSlug: string;
  readonly projectId: string;
  readonly runtimeAuthorityBinding: string;
  readonly canonicalRelativePath: string;
  readonly previousRecord: AudioPublicationRebindRecordReference;
  readonly originalIntentId: string;
  readonly originalIntentIntegrity: string;
  readonly previousDevice: number;
  readonly previousInode: number;
  readonly newDevice: number;
  readonly newInode: number;
  readonly verifiedSha256: string;
  readonly verifiedByteLength: number;
  readonly reasonCode: AudioPublicationRebindReasonCode;
  readonly rebindAt: string;
  readonly integrity: string;
}

export interface AudioPublicationIntent {
  readonly schemaVersion: typeof SCHEMA;
  readonly state: "prepared";
  readonly intentId: string;
  readonly compensationRef: string;
  readonly projectSlug: string;
  readonly projectId: string;
  readonly runtimeAuthorityBinding: string;
  readonly canonicalRelativePath: string;
  readonly publication: PortablePublishedFile;
  readonly registryPayloadFingerprint: string;
  readonly asset: Asset;
  readonly createdAt: string;
  readonly integrity: string;
}

export function getPreparedAudioPublicationIntent(
  projectSlug: string,
  compensationRef: string,
  input: RuntimeStorageInput = {},
): AudioPublicationIntent | undefined {
  if (!/^[a-zA-Z0-9-_]+$/.test(projectSlug) ||
    !isSafeAudioCompensationRef(compensationRef)) {
    throw new AudioPublicationIntentError();
  }
  const context = resolveRuntimeStorageContext(input);
  const directory = intentDirectory(projectSlug, context, false);
  if (!fs.existsSync(directory)) return undefined;
  const operation = requireActiveProductionRuntimeOperationContext();
  const intents = readIntentCollection(directory, context);
  let match: AudioPublicationIntent | undefined;
  for (const intent of intents) {
    if (intent.runtimeAuthorityBinding !== operation.authority.resolverBindingIdentity) {
      throw new AudioPublicationIntentError();
    }
    if (intent.compensationRef !== compensationRef) continue;
    if (intent.projectSlug !== projectSlug || match) {
      throw new AudioPublicationIntentConflictError();
    }
    match = intent;
  }
  return match;
}

export function getAudioPublicationLifecycleState(
  projectSlug: string,
  compensationRef: string,
  input: RuntimeStorageInput = {},
): AudioPublicationLifecycleState | undefined {
  const context = resolveRuntimeStorageContext(input);
  const intent = getPreparedAudioPublicationIntent(projectSlug, compensationRef, context);
  if (!intent) return undefined;
  const canonicalPath = resolveRuntimeLogicalPath(intent.canonicalRelativePath, context);
  if (!fs.existsSync(canonicalPath)) return "prepared";
  return matchesCanonical(canonicalPath, intent.publication, context)
    ? "committed"
    : "conflict";
}

export function prepareAudioPublicationIntent(input: {
  readonly projectSlug: string;
  readonly projectId: string;
  readonly compensationRef: string;
  readonly asset: Asset;
  readonly publication: PortablePublishedFile;
  readonly authority: RuntimeStorageAuthorityLease;
  readonly context: RuntimeStorageContext;
}): AudioPublicationIntent {
  const context = resolveRuntimeStorageContext(input.context);
  assertProjectWriteAuthorityLease(input.authority, input.projectSlug, context);
  if (!isSafeAudioCompensationRef(input.compensationRef)) {
    throw new AudioPublicationIntentError();
  }
  const operation = requireActiveProductionRuntimeOperationContext();
  const canonicalRelativePath = canonicalAssetPath(input.projectSlug, input.asset);
  validateAsset(input.asset, input.projectSlug, input.projectId, input.publication);
  const asset = Object.freeze({ ...input.asset });
  const body = {
    schemaVersion: SCHEMA as typeof SCHEMA,
    state: "prepared" as const,
    intentId: `audio-intent-${digest({
      compensationRef: input.compensationRef,
      assetId: asset.id,
      registryPayloadFingerprint: digest(asset),
    }).slice(0, 32)}`,
    compensationRef: input.compensationRef,
    projectSlug: input.projectSlug,
    projectId: input.projectId,
    runtimeAuthorityBinding: operation.authority.resolverBindingIdentity,
    canonicalRelativePath,
    publication: Object.freeze({
      mode: input.publication.mode,
      device: input.publication.device,
      inode: input.publication.inode,
      byteLength: input.publication.byteLength,
      sha256: input.publication.sha256,
    }),
    registryPayloadFingerprint: digest(asset),
    asset,
    // The intent must be byte-identical on replay; the validated asset timestamp
    // is already fixed before the canonical commit point.
    createdAt: asset.createdAt,
  };
  const intent = Object.freeze({ ...body, integrity: digest(body) });
  const directory = intentDirectory(input.projectSlug, context, true);
  const filePath = path.join(directory, `${asset.id}.json`);
  writeIntentNoClobber(filePath, intent);
  const readback = readIntent(filePath);
  if (readback.integrity !== intent.integrity) throw new AudioPublicationIntentError();
  return readback;
}

export function getCommittedAudioPublicationAssets(
  projectSlug: string,
  projectId: string,
  input: RuntimeStorageInput = {},
): readonly Asset[] {
  const context = resolveRuntimeStorageContext(input);
  const directory = intentDirectory(projectSlug, context, false);
  if (!fs.existsSync(directory)) return [];
  const operation = requireActiveProductionRuntimeOperationContext();
  const intents = readIntentCollection(directory, context);
  const committed: Asset[] = [];
  for (const intent of intents) {
    if (
      intent.projectSlug !== projectSlug ||
      intent.projectId !== projectId ||
      intent.runtimeAuthorityBinding !== operation.authority.resolverBindingIdentity
    ) {
      throw new AudioPublicationIntentError();
    }
    const canonicalPath = resolveRuntimeLogicalPath(intent.canonicalRelativePath, context);
    if (!fs.existsSync(canonicalPath)) continue;
    if (!matchesCanonical(canonicalPath, intent.publication, context)) {
      const rebound = resolveCurrentAudioPublicationDescriptor(projectSlug, intent, context);
      if (!rebound || !matchesCanonical(canonicalPath, rebound, context)) {
        throw new AudioPublicationIntentConflictError();
      }
    }
    committed.push(Object.freeze({ ...intent.asset }));
  }
  committed.sort((left, right) =>
    (left.sceneId ?? Number.MAX_SAFE_INTEGER) -
      (right.sceneId ?? Number.MAX_SAFE_INTEGER) ||
    left.id.localeCompare(right.id));
  return Object.freeze(committed);
}

/**
 * Creates a new, immutable descriptor-rebind ledger entry for `assetId`. The original "prepared"
 * intent is never opened for writing here. Accepted only when ALL hold: the canonical path
 * matches the intent's own; a fresh, TOCTOU-safe read of the canonical file (open -> fstat ->
 * read -> fstat -> path-lstat, via readAudioFileDescriptorBound) succeeds; the freshly computed
 * sha256 and observed byteLength are byte-for-byte identical to what the intent (or the current
 * rebind chain tip) already recorded; and the observed device/inode genuinely differ from the
 * currently-expected device/inode (a no-op rebind is rejected, not silently accepted).
 */
export function createAudioPublicationDescriptorRebind(input: {
  readonly projectSlug: string;
  readonly projectId: string;
  readonly assetId: string;
  readonly reasonCode: AudioPublicationRebindReasonCode;
  readonly authority: RuntimeStorageAuthorityLease;
  readonly context: RuntimeStorageContext;
}): AudioPublicationDescriptorRebind {
  const context = resolveRuntimeStorageContext(input.context);
  assertProjectWriteAuthorityLease(input.authority, input.projectSlug, context);
  if (!SAFE_ID.test(input.assetId)) throw new AudioPublicationRebindError();
  if (!(audioPublicationRebindReasonCodes as readonly string[]).includes(input.reasonCode)) {
    throw new AudioPublicationRebindError();
  }
  const operation = requireActiveProductionRuntimeOperationContext();
  const directory = intentDirectory(input.projectSlug, context, false);
  let intent: AudioPublicationIntent;
  try {
    intent = readIntent(path.join(directory, `${input.assetId}.json`));
  } catch {
    throw new AudioPublicationRebindError();
  }
  if (
    intent.projectSlug !== input.projectSlug ||
    intent.projectId !== input.projectId ||
    intent.asset.id !== input.assetId ||
    intent.runtimeAuthorityBinding !== operation.authority.resolverBindingIdentity
  ) {
    throw new AudioPublicationRebindError();
  }

  const previous = resolveCurrentAudioPublicationRebindRecord(input.projectSlug, intent, context);
  const expectedDevice = previous ? previous.newDevice : intent.publication.device;
  const expectedInode = previous ? previous.newInode : intent.publication.inode;

  const canonicalPath = resolveRuntimeLogicalPath(intent.canonicalRelativePath, context);
  let link: fs.Stats;
  let bytes: Buffer;
  try {
    link = fs.lstatSync(canonicalPath);
    if (!link.isFile() || link.isSymbolicLink()) throw new Error("not a regular file");
    bytes = readAudioFileDescriptorBound(canonicalPath, {
      maximumByteLength: intent.publication.byteLength,
      openedIdentity: { device: link.dev, inode: link.ino, byteLength: link.size },
    });
  } catch {
    throw new AudioPublicationRebindError();
  }
  const verifiedSha256 = createHash("sha256").update(bytes).digest("hex");
  const observedDevice = link.dev;
  const observedInode = link.ino;
  const observedByteLength = link.size;

  // Idempotency, checked before the no-op rejection below: a repeat call that observes exactly
  // what the current chain tip already recorded is a safe replay of an already-completed rebind,
  // not a request with nothing to do. All five fields must match; nothing here is re-derived or
  // trusted beyond what resolveCurrentAudioPublicationRebindRecord already re-verified.
  if (
    previous &&
    previous.assetId === input.assetId &&
    previous.canonicalRelativePath === intent.canonicalRelativePath &&
    previous.newDevice === observedDevice &&
    previous.newInode === observedInode &&
    previous.verifiedSha256 === verifiedSha256 &&
    previous.verifiedByteLength === observedByteLength
  ) {
    return previous;
  }

  if (
    canonicalAssetPath(input.projectSlug, intent.asset) !== intent.canonicalRelativePath ||
    verifiedSha256 !== intent.publication.sha256 ||
    observedByteLength !== intent.publication.byteLength ||
    (observedDevice === expectedDevice && observedInode === expectedInode)
  ) {
    throw new AudioPublicationRebindError();
  }

  const previousRecord: AudioPublicationRebindRecordReference = previous
    ? { kind: "rebind", id: previous.rebindId, integrity: previous.integrity }
    : { kind: "intent", id: intent.intentId, integrity: intent.integrity };
  const sequence = previous ? previous.sequence + 1 : 1;
  // rebindId is derived and embedded into body *before* hashing -- mirroring
  // prepareAudioPublicationIntent's intentId pattern exactly -- so digest(body) at write time and
  // digest(body) reconstructed from {integrity, ...body} at read time hash the identical shape.
  const body = {
    schemaVersion: REBIND_SCHEMA as typeof REBIND_SCHEMA,
    rebindId: `audio-rebind-${digest({
      assetId: input.assetId,
      sequence,
      newDevice: observedDevice,
      newInode: observedInode,
    }).slice(0, 32)}`,
    assetId: input.assetId,
    sequence,
    projectSlug: input.projectSlug,
    projectId: input.projectId,
    runtimeAuthorityBinding: operation.authority.resolverBindingIdentity,
    canonicalRelativePath: intent.canonicalRelativePath,
    previousRecord,
    originalIntentId: intent.intentId,
    originalIntentIntegrity: intent.integrity,
    previousDevice: expectedDevice,
    previousInode: expectedInode,
    newDevice: observedDevice,
    newInode: observedInode,
    verifiedSha256,
    verifiedByteLength: observedByteLength,
    reasonCode: input.reasonCode,
    rebindAt: new Date().toISOString(),
  };
  const record: AudioPublicationDescriptorRebind = Object.freeze({
    ...body,
    integrity: digest(body),
  });
  const rebindDir = rebindDirectory(input.projectSlug, context, true);
  const filePath = path.join(rebindDir, `${input.assetId}.${sequence}.json`);
  writeRebindNoClobber(filePath, record);
  const readback = readRebind(filePath);
  if (readback.integrity !== record.integrity) throw new AudioPublicationRebindError();
  return readback;
}

/** Testable, read-only chain resolution: the current rebind ledger entry for `intent`, if any. */
export function resolveCurrentAudioPublicationRebindRecord(
  projectSlug: string,
  intent: AudioPublicationIntent,
  context: RuntimeStorageContext,
): AudioPublicationDescriptorRebind | undefined {
  const directory = rebindDirectory(projectSlug, context, false);
  if (!fs.existsSync(directory)) return undefined;
  const prefix = `${intent.asset.id}.`;
  const entries = fs.readdirSync(directory).sort()
    .filter((entry) => entry.startsWith(prefix) && entry.endsWith(".json"));
  if (entries.length === 0) return undefined;
  if (entries.length > MAX_INTENTS) throw new AudioPublicationRebindConflictError();
  const bySequence = new Map<number, AudioPublicationDescriptorRebind[]>();
  for (const entry of entries) {
    const record = readRebind(path.join(directory, entry));
    if (
      record.assetId !== intent.asset.id ||
      record.projectSlug !== projectSlug ||
      `${record.assetId}.${record.sequence}.json` !== entry
    ) throw new AudioPublicationRebindConflictError();
    const bucket = bySequence.get(record.sequence) ?? [];
    bucket.push(record);
    bySequence.set(record.sequence, bucket);
  }
  const maxSequence = Math.max(...bySequence.keys());
  let expected: AudioPublicationRebindRecordReference = {
    kind: "intent", id: intent.intentId, integrity: intent.integrity,
  };
  let current: AudioPublicationDescriptorRebind | undefined;
  for (let sequence = 1; sequence <= maxSequence; sequence += 1) {
    const bucket = bySequence.get(sequence) ?? [];
    if (bucket.length !== 1) throw new AudioPublicationRebindConflictError();
    const record = bucket[0];
    if (
      record.previousRecord.kind !== expected.kind ||
      record.previousRecord.id !== expected.id ||
      record.previousRecord.integrity !== expected.integrity ||
      record.originalIntentId !== intent.intentId ||
      record.originalIntentIntegrity !== intent.integrity ||
      record.canonicalRelativePath !== intent.canonicalRelativePath ||
      record.verifiedSha256 !== intent.publication.sha256 ||
      record.verifiedByteLength !== intent.publication.byteLength
    ) throw new AudioPublicationRebindConflictError();
    current = record;
    expected = { kind: "rebind", id: record.rebindId, integrity: record.integrity };
  }
  return current;
}

/**
 * The expected descriptor `getCommittedAudioPublicationAssets` should verify the canonical file
 * against, if a valid rebind chain exists for this intent. sha256/byteLength are the re-verified
 * values already carried by the chain tip -- never re-derived here, never looser than what the
 * original intent (or the chain) already proved.
 */
export function resolveCurrentAudioPublicationDescriptor(
  projectSlug: string,
  intent: AudioPublicationIntent,
  context: RuntimeStorageContext,
): PortablePublishedFile | undefined {
  const record = resolveCurrentAudioPublicationRebindRecord(projectSlug, intent, context);
  if (!record) return undefined;
  return Object.freeze({
    mode: intent.publication.mode,
    device: record.newDevice,
    inode: record.newInode,
    byteLength: record.verifiedByteLength,
    sha256: record.verifiedSha256,
  });
}

function intentDirectory(slug: string, context: RuntimeStorageContext, write: boolean) {
  if (!/^[a-zA-Z0-9-_]+$/.test(slug)) throw new AudioPublicationIntentError();
  const relative = `data/projects/${slug}/production-execution/${DIRECTORY}`;
  const directory = write
    ? resolveRuntimeLogicalPathForWrite(relative, context)
    : resolveRuntimeLogicalPath(relative, context);
  if (write) {
    ensureSafeContainedDirectory(context.runtimeRoot, context.projectsRoot);
    ensureSafeContainedDirectory(context.projectsRoot, directory);
  }
  return directory;
}

function rebindDirectory(slug: string, context: RuntimeStorageContext, write: boolean) {
  if (!/^[a-zA-Z0-9-_]+$/.test(slug)) throw new AudioPublicationRebindError();
  const relative = `data/projects/${slug}/production-execution/${REBIND_DIRECTORY}`;
  const directory = write
    ? resolveRuntimeLogicalPathForWrite(relative, context)
    : resolveRuntimeLogicalPath(relative, context);
  if (write) {
    ensureSafeContainedDirectory(context.runtimeRoot, context.projectsRoot);
    ensureSafeContainedDirectory(context.projectsRoot, directory);
  }
  return directory;
}

function writeRebindNoClobber(filePath: string, record: AudioPublicationDescriptorRebind) {
  const bytes = Buffer.from(JSON.stringify(record), "utf8");
  if (bytes.length <= 0 || bytes.length > MAX_INTENT_BYTES) {
    throw new AudioPublicationRebindError();
  }
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(filePath, "wx", 0o600);
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "EEXIST") {
      throw new AudioPublicationRebindError();
    }
    const existing = readRebind(filePath);
    if (existing.integrity !== record.integrity) throw new AudioPublicationRebindConflictError();
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
  if (process.platform !== "win32") {
    const directoryDescriptor = fs.openSync(path.dirname(filePath), "r");
    try { fs.fsyncSync(directoryDescriptor); } finally { fs.closeSync(directoryDescriptor); }
  }
}

function readRebind(filePath: string): AudioPublicationDescriptorRebind {
  let value: unknown;
  try {
    const link = fs.lstatSync(filePath);
    if (!link.isFile() || link.isSymbolicLink()) throw new AudioPublicationRebindError();
    value = JSON.parse(readAudioFileDescriptorBound(filePath, {
      maximumByteLength: MAX_INTENT_BYTES,
      openedIdentity: {
        device: link.dev,
        inode: link.ino,
        byteLength: link.size,
      },
    }).toString("utf8"));
  }
  catch { throw new AudioPublicationRebindError(); }
  if (!validRebind(value)) throw new AudioPublicationRebindError();
  return Object.freeze(value);
}

function validRebind(value: unknown): value is AudioPublicationDescriptorRebind {
  if (!value || typeof value !== "object") return false;
  const record = value as AudioPublicationDescriptorRebind;
  const { integrity, ...body } = record;
  try {
    return hasExactKeys(record, [
      "schemaVersion", "rebindId", "assetId", "sequence", "projectSlug", "projectId",
      "runtimeAuthorityBinding", "canonicalRelativePath", "previousRecord",
      "originalIntentId", "originalIntentIntegrity", "previousDevice", "previousInode",
      "newDevice", "newInode", "verifiedSha256", "verifiedByteLength", "reasonCode",
      "rebindAt", "integrity",
    ]) &&
      record.schemaVersion === REBIND_SCHEMA &&
      SAFE_ID.test(record.rebindId) &&
      SAFE_ID.test(record.assetId) &&
      Number.isSafeInteger(record.sequence) && record.sequence > 0 &&
      /^[a-zA-Z0-9-_]+$/.test(record.projectSlug) && SAFE_ID.test(record.projectId) &&
      typeof record.runtimeAuthorityBinding === "string" && record.runtimeAuthorityBinding.length > 0 &&
      typeof record.canonicalRelativePath === "string" && record.canonicalRelativePath.length > 0 &&
      validRecordReference(record.previousRecord) &&
      SAFE_ID.test(record.originalIntentId) &&
      typeof record.originalIntentIntegrity === "string" && SHA256_HEX.test(record.originalIntentIntegrity) &&
      reliableDescriptor(record.previousDevice, record.previousInode) &&
      reliableDescriptor(record.newDevice, record.newInode) &&
      (record.previousDevice !== record.newDevice || record.previousInode !== record.newInode) &&
      typeof record.verifiedSha256 === "string" && SHA256_HEX.test(record.verifiedSha256) &&
      Number.isSafeInteger(record.verifiedByteLength) && record.verifiedByteLength > 0 &&
      (audioPublicationRebindReasonCodes as readonly string[]).includes(record.reasonCode) &&
      Number.isFinite(Date.parse(record.rebindAt)) &&
      integrity === digest(body);
  } catch { return false; }
}

function validRecordReference(value: unknown): value is AudioPublicationRebindRecordReference {
  if (!value || typeof value !== "object") return false;
  const ref = value as AudioPublicationRebindRecordReference;
  return (ref.kind === "intent" || ref.kind === "rebind") &&
    SAFE_ID.test(ref.id) &&
    typeof ref.integrity === "string" && SHA256_HEX.test(ref.integrity);
}

function reliableDescriptor(device: unknown, inode: unknown): boolean {
  return typeof device === "number" && Number.isFinite(device) && Number.isInteger(device) &&
    device > 0 &&
    typeof inode === "number" && Number.isFinite(inode) && Number.isInteger(inode) && inode > 0;
}

function canonicalAssetPath(slug: string, asset: Asset) {
  const expectedPrefix = `data/projects/${slug}/assets/audio/`;
  if (typeof asset.filePath !== "string" || !asset.filePath.startsWith(expectedPrefix)) {
    throw new AudioPublicationIntentError();
  }
  const fileName = asset.filePath.slice(expectedPrefix.length);
  if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9._-]{0,126}[a-zA-Z0-9])?\.wav$/.test(fileName)) {
    throw new AudioPublicationIntentError();
  }
  return asset.filePath;
}

function validateAsset(
  asset: Asset,
  slug: string,
  projectId: string,
  publication: PortablePublishedFile,
) {
  const keys = new Set([
    "id", "projectId", "projectSlug", "sceneId", "type", "status", "provider", "model",
    "prompt", "filePath", "url", "mimeType", "byteLength", "durationSeconds", "createdAt",
  ]);
  if (
    !asset || typeof asset !== "object" ||
    !Object.keys(asset).every((key) => keys.has(key)) ||
    !SAFE_ID.test(asset.id) || asset.projectId !== projectId || asset.projectSlug !== slug ||
    asset.type !== "audio" || asset.status !== "generated" ||
    !isAdmissibleProductionProvider(asset.provider, "tts") ||
    (asset.model !== undefined && !isSafeAudioIdentifier(asset.model)) ||
    typeof asset.prompt !== "string" || asset.prompt.length < 1 || asset.prompt.length > 160 ||
    containsReservedSafeEvidenceTerm(asset.prompt) ||
    asset.mimeType !== "audio/wav" || asset.byteLength !== publication.byteLength ||
    !Number.isFinite(asset.durationSeconds) || (asset.durationSeconds as number) <= 0 ||
    typeof asset.url !== "string" || !asset.url.startsWith(`/api/assets/audio/${slug}/`) ||
    !Number.isFinite(Date.parse(asset.createdAt)) ||
    (asset.sceneId !== undefined && (!Number.isSafeInteger(asset.sceneId) || asset.sceneId <= 0))
  ) throw new AudioPublicationIntentError();
  canonicalAssetPath(slug, asset);
}

function writeIntentNoClobber(filePath: string, intent: AudioPublicationIntent) {
  const bytes = Buffer.from(JSON.stringify(intent), "utf8");
  if (bytes.length <= 0 || bytes.length > MAX_INTENT_BYTES) {
    throw new AudioPublicationIntentError();
  }
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(filePath, "wx", 0o600);
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "EEXIST") {
      throw new AudioPublicationIntentError();
    }
    const existing = readIntent(filePath);
    if (existing.integrity !== intent.integrity) throw new AudioPublicationIntentConflictError();
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
  if (process.platform !== "win32") {
    const directoryDescriptor = fs.openSync(path.dirname(filePath), "r");
    try { fs.fsyncSync(directoryDescriptor); } finally { fs.closeSync(directoryDescriptor); }
  }
}

function readIntent(filePath: string): AudioPublicationIntent {
  let value: unknown;
  try {
    const link = fs.lstatSync(filePath);
    if (!link.isFile() || link.isSymbolicLink()) throw new AudioPublicationIntentError();
    value = JSON.parse(readAudioFileDescriptorBound(filePath, {
      maximumByteLength: MAX_INTENT_BYTES,
      openedIdentity: {
        device: link.dev,
        inode: link.ino,
        byteLength: link.size,
      },
    }).toString("utf8"));
  }
  catch { throw new AudioPublicationIntentError(); }
  if (!validIntent(value)) throw new AudioPublicationIntentError();
  return Object.freeze(value);
}

function validIntent(value: unknown): value is AudioPublicationIntent {
  if (!value || typeof value !== "object") return false;
  const intent = value as AudioPublicationIntent;
  const { integrity, ...body } = intent;
  try {
    return hasExactKeys(intent, [
      "schemaVersion", "state", "intentId", "compensationRef", "projectSlug",
      "projectId", "runtimeAuthorityBinding", "canonicalRelativePath", "publication",
      "registryPayloadFingerprint", "asset", "createdAt", "integrity",
    ]) && intent.schemaVersion === SCHEMA &&
      intent.state === "prepared" && SAFE_ID.test(intent.intentId) &&
      isSafeAudioCompensationRef(intent.compensationRef) &&
      /^[a-zA-Z0-9-_]+$/.test(intent.projectSlug) && SAFE_ID.test(intent.projectId) &&
      typeof intent.runtimeAuthorityBinding === "string" && intent.runtimeAuthorityBinding.length > 0 &&
      intent.registryPayloadFingerprint === digest(intent.asset) &&
      Number.isFinite(Date.parse(intent.createdAt)) && integrity === digest(body) &&
      validPublication(intent.publication) &&
      validateIntentAsset(intent);
  } catch { return false; }
}

function validateIntentAsset(intent: AudioPublicationIntent) {
  validateAsset(intent.asset, intent.projectSlug, intent.projectId, intent.publication);
  return canonicalAssetPath(intent.projectSlug, intent.asset) === intent.canonicalRelativePath;
}

function matchesCanonical(
  filePath: string,
  expected: PortablePublishedFile,
  context: RuntimeStorageContext,
) {
  try {
    readContainedAudioFileDescriptorBound(path.dirname(filePath), filePath, context, expected);
    return true;
  } catch { return false; }
}

function readIntentCollection(
  directory: string,
  context: RuntimeStorageContext,
): readonly AudioPublicationIntent[] {
  const entries = fs.readdirSync(directory).sort();
  if (entries.length > MAX_INTENTS || entries.some((entry) =>
    !entry.endsWith(".json") || !SAFE_ID.test(entry.slice(0, -5)))) {
    throw new AudioPublicationIntentError();
  }
  const intents = entries.map((entry) => readIntent(path.join(directory, entry)));
  const intentIds = new Set<string>();
  const compensationRefs = new Set<string>();
  const assetIds = new Set<string>();
  const canonicalPaths = new Set<string>();
  for (const intent of intents) {
    const canonicalPath = canonicalPathIdentity(
      resolveRuntimeLogicalPath(intent.canonicalRelativePath, context),
    );
    if (
      intentIds.has(intent.intentId) ||
      compensationRefs.has(intent.compensationRef) ||
      assetIds.has(intent.asset.id) ||
      canonicalPaths.has(canonicalPath)
    ) throw new AudioPublicationIntentConflictError();
    intentIds.add(intent.intentId);
    compensationRefs.add(intent.compensationRef);
    assetIds.add(intent.asset.id);
    canonicalPaths.add(canonicalPath);
  }
  return Object.freeze(intents);
}

function canonicalPathIdentity(value: string): string {
  const normalized = path.normalize(path.resolve(value));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function validPublication(value: unknown): value is PortablePublishedFile {
  if (!value || typeof value !== "object" || !hasExactKeys(value, [
    "mode", "device", "inode", "byteLength", "sha256",
  ])) return false;
  const publication = value as PortablePublishedFile;
  return (publication.mode === "hard-link" || publication.mode === "exclusive-copy") &&
    Number.isFinite(publication.device) && Number.isInteger(publication.device) &&
    publication.device > 0 &&
    Number.isFinite(publication.inode) && Number.isInteger(publication.inode) &&
    publication.inode > 0 &&
    Number.isSafeInteger(publication.byteLength) && publication.byteLength > 0 &&
    /^[0-9a-f]{64}$/.test(publication.sha256);
}

function hasExactKeys(value: object, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => keys.includes(key));
}

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
