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

const SCHEMA = "audio-publication-intent-v1";
const DIRECTORY = "audio-publication-intents";
const MAX_INTENT_BYTES = 16 * 1024;
const MAX_INTENTS = 128;
const SAFE_ID = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,126}[a-zA-Z0-9])?$/;

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
      throw new AudioPublicationIntentConflictError();
    }
    committed.push(Object.freeze({ ...intent.asset }));
  }
  committed.sort((left, right) =>
    (left.sceneId ?? Number.MAX_SAFE_INTEGER) -
      (right.sceneId ?? Number.MAX_SAFE_INTEGER) ||
    left.id.localeCompare(right.id));
  return Object.freeze(committed);
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
    asset.type !== "audio" || asset.status !== "generated" || asset.provider !== "openai" ||
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
