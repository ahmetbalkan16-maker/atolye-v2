import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { Asset } from "@/types/asset";
import { containsReservedSafeEvidenceTerm, isSafeAudioIdentifier } from "./AudioIdentifierPolicy";
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
    !/^audio-comp-[0-9a-f-]{36}$/.test(compensationRef)) {
    throw new AudioPublicationIntentError();
  }
  const context = resolveRuntimeStorageContext(input);
  const directory = intentDirectory(projectSlug, context, false);
  if (!fs.existsSync(directory)) return undefined;
  const operation = requireActiveProductionRuntimeOperationContext();
  const entries = fs.readdirSync(directory).sort();
  if (entries.length > MAX_INTENTS) throw new AudioPublicationIntentError();
  let match: AudioPublicationIntent | undefined;
  for (const entry of entries) {
    if (!entry.endsWith(".json") || !SAFE_ID.test(entry.slice(0, -5))) {
      throw new AudioPublicationIntentError();
    }
    const intent = readIntent(path.join(directory, entry));
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
  return matchesCanonical(canonicalPath, intent.publication) ? "committed" : "conflict";
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
    publication: Object.freeze({ ...input.publication }),
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
  const entries = fs.readdirSync(directory).sort();
  if (entries.length > MAX_INTENTS || entries.some((entry) =>
    !entry.endsWith(".json") || !SAFE_ID.test(entry.slice(0, -5)))) {
    throw new AudioPublicationIntentError();
  }
  const committed: Asset[] = [];
  for (const entry of entries) {
    const intent = readIntent(path.join(directory, entry));
    if (
      intent.projectSlug !== projectSlug ||
      intent.projectId !== projectId ||
      intent.runtimeAuthorityBinding !== operation.authority.resolverBindingIdentity
    ) {
      throw new AudioPublicationIntentError();
    }
    const canonicalPath = resolveRuntimeLogicalPath(intent.canonicalRelativePath, context);
    if (!fs.existsSync(canonicalPath)) continue;
    if (!matchesCanonical(canonicalPath, intent.publication)) {
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
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > MAX_INTENT_BYTES) {
    throw new AudioPublicationIntentError();
  }
  let value: unknown;
  try { value = JSON.parse(fs.readFileSync(filePath, "utf8")); }
  catch { throw new AudioPublicationIntentError(); }
  if (!validIntent(value)) throw new AudioPublicationIntentError();
  return Object.freeze(value);
}

function validIntent(value: unknown): value is AudioPublicationIntent {
  if (!value || typeof value !== "object") return false;
  const intent = value as AudioPublicationIntent;
  const { integrity, ...body } = intent;
  try {
    return Object.keys(intent).length === 13 && intent.schemaVersion === SCHEMA &&
      intent.state === "prepared" && SAFE_ID.test(intent.intentId) &&
      /^audio-comp-[0-9a-f-]{36}$/.test(intent.compensationRef) &&
      /^[a-zA-Z0-9-_]+$/.test(intent.projectSlug) && SAFE_ID.test(intent.projectId) &&
      typeof intent.runtimeAuthorityBinding === "string" && intent.runtimeAuthorityBinding.length > 0 &&
      intent.registryPayloadFingerprint === digest(intent.asset) &&
      Number.isFinite(Date.parse(intent.createdAt)) && integrity === digest(body) &&
      validateIntentAsset(intent);
  } catch { return false; }
}

function validateIntentAsset(intent: AudioPublicationIntent) {
  validateAsset(intent.asset, intent.projectSlug, intent.projectId, intent.publication);
  return canonicalAssetPath(intent.projectSlug, intent.asset) === intent.canonicalRelativePath;
}

function matchesCanonical(filePath: string, expected: PortablePublishedFile) {
  try {
    const link = fs.lstatSync(filePath);
    if (!link.isFile() || link.isSymbolicLink()) return false;
    const descriptor = fs.openSync(filePath, "r");
    try {
      const before = fs.fstatSync(descriptor);
      const bytes = fs.readFileSync(descriptor);
      const after = fs.fstatSync(descriptor);
      return before.isFile() && before.dev === expected.device && before.ino === expected.inode &&
        before.size === expected.byteLength && after.dev === before.dev && after.ino === before.ino &&
        after.size === before.size && digestBytes(bytes) === expected.sha256;
    } finally { fs.closeSync(descriptor); }
  } catch { return false; }
}

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function digestBytes(value: Buffer) {
  return createHash("sha256").update(value).digest("hex");
}
