import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  assertProjectWriteAuthorityLease,
  ensureSafeContainedDirectory,
  requireContainedRealDirectory,
  resolveRuntimeLogicalPath,
  resolveRuntimeLogicalPathForWrite,
  resolveRuntimeStorageContext,
  type RuntimeStorageAuthorityLease,
  type RuntimeStorageContext,
  type RuntimeStorageInput,
} from "@/lib/runtime/RuntimeStoragePaths";
import {
  requireActiveProductionRuntimeOperationContext,
  type ProductionRuntimeOperationContext,
} from "@/lib/runtime/ProductionRuntimeOperationContext";
import { readAudioFileDescriptorBound } from "./AudioDescriptorBoundVerification";

const RECEIPT_SCHEMA_VERSION = "audio-compensation-receipt-v1";
const STATE_SCHEMA_VERSION = "audio-compensation-state-v1";
const RECEIPT_FILE = "receipt.json";
const PUBLICATION_FILE = "publication.json";
const PUBLICATION_RESERVATION_FILE = "publication-reservation.json";
const MAX_RECEIPT_BYTES = 4096;
const MAX_PUBLICATION_BYTES = 2048;
const MAX_STATE_BYTES = 2048;
const MAX_AUDIO_BYTES = 256 * 1024 * 1024;
const MAX_RECORDS_PER_PROJECT = 32;
const RETAIN_TERMINAL_RECORDS = 16;
const MAX_DEFERRED_BACKLOG_OBSERVATIONS = 32;
const MAX_DEFERRED_BACKLOG_RECORDS = 40;
const MAX_DEFERRED_BACKLOG_BYTES = 512 * 1024 * 1024;
const MAX_DEFERRED_WORKSPACE_ENTRIES = 128;
const MAX_DEFERRED_WORKSPACE_DEPTH = 4;
const MAX_STATE_ENTRIES = 32;
const CLEANUP_DIRECTORY = "audio-compensation-cleanup";
const WORKSPACE_FILE = "workspace.json";
const WORKSPACE_SCHEMA_VERSION = "audio-compensation-workspace-v2";
const LEGACY_WORKSPACE_SCHEMA_VERSION = "audio-compensation-workspace-v1";
const MAX_WORKSPACE_BYTES = 2048;
const RECORD_CLAIM_FILE = "record-claim.json";
const RECORD_CLAIM_SCHEMA_VERSION = "audio-compensation-record-claim-v1";
const MAX_RECORD_CLAIM_BYTES = 2048;
const SAFE_REF = /^audio-comp-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SAFE_FILE_NAME = /^[a-zA-Z0-9](?:[a-zA-Z0-9._-]{0,126}[a-zA-Z0-9])?$/;
const SAFE_QUARANTINE_DIRECTORY = /^\.audio-quarantine-audio-comp-[0-9a-f-]{36}$/;
const PUBLICATION_SCHEMA_VERSION = "audio-compensation-publication-v2";
const PUBLICATION_RESERVATION_SCHEMA_VERSION =
  "audio-compensation-publication-reservation-v2";
/**
 * Legacy `publication-reservation.json` schemaVersion tag, never the value of
 * `PUBLICATION_RESERVATION_SCHEMA_VERSION` in any commit of this file --
 * real, digest-self-check-verified reservation records were nonetheless
 * found written under this exact string (predating this file's first
 * commit), with every other field and the fingerprint/digest chain intact.
 * Accepted here, and ONLY here, as an explicit, closed compatibility
 * allowance -- not a general "unknown schema" fallback.
 */
const LEGACY_PUBLICATION_RESERVATION_SCHEMA_VERSION_V1 =
  "audio-publication-reservation-v1";
const RETIREMENT_SCHEMA_VERSION = "audio-compensation-retirement-v1";
const MAX_RETIREMENT_BYTES = 32 * 1024;
const RETIREMENT_FILE_PREFIX = "retirement-";
const JOURNAL_STAGING_DIRECTORY = ".audio-journal-staging";
const PUBLICATION_STAGING_FILE = "publication-staging.wav";
const REBIND_DIRECTORY = "audio-canonical-rebinds";
const REBIND_SCHEMA_VERSION = "audio-canonical-descriptor-rebind-v1";
const MAX_REBIND_BYTES = 4096;
const MAX_REBIND_RECORDS_PER_REF = 32;
const audioCanonicalRebindReasonCodes = Object.freeze([
  "FILESYSTEM_MATERIALIZATION_DRIFT",
] as const);
export type AudioCanonicalRebindReasonCode =
  (typeof audioCanonicalRebindReasonCodes)[number];

export type AudioCompensationLifecycleStatus =
  | "pending"
  | "in-progress"
  | "failed-retryable"
  | "completed";

export interface ProtectedAudioCompensationReceipt {
  readonly schemaVersion: typeof RECEIPT_SCHEMA_VERSION;
  readonly compensationRef: string;
  readonly projectSlug: string;
  readonly operationId: string;
  readonly operationBindingFingerprint: string;
  readonly canonicalFileName: string;
  readonly quarantineDirectoryName: string;
  readonly byteLength: number;
  readonly sha256: string;
  readonly device: number;
  readonly inode: number;
  readonly createdAt: string;
  readonly integrity: string;
}

export interface ProtectedAudioCompensationPublication {
  readonly schemaVersion: typeof PUBLICATION_SCHEMA_VERSION;
  readonly compensationRef: string;
  readonly projectSlug: string;
  readonly operationId: string;
  readonly operationBindingFingerprint: string;
  readonly canonicalFileName: string;
  readonly stagingFileName: "temporary.wav" | typeof PUBLICATION_STAGING_FILE;
  readonly mode: "hard-link" | "exclusive-copy";
  readonly byteLength: number;
  readonly sha256: string;
  readonly device: number;
  readonly inode: number;
  readonly receiptIntegrity: string;
  readonly reservationIntegrity: string;
  readonly publishedAt: string;
  readonly integrity: string;
}

export interface ProtectedAudioCanonicalReadIdentity {
  readonly device: number;
  readonly inode: number;
  readonly byteLength: number;
  readonly sha256: string;
}

export interface AudioCanonicalDescriptorRebindRecordReference {
  readonly kind: "publication" | "rebind";
  readonly id: string;
  readonly integrity: string;
}

export interface AudioCanonicalDescriptorRebind {
  readonly schemaVersion: typeof REBIND_SCHEMA_VERSION;
  readonly rebindId: string;
  readonly compensationRef: string;
  readonly canonicalFileName: string;
  readonly projectSlug: string;
  readonly sequence: number;
  readonly previousRecord: AudioCanonicalDescriptorRebindRecordReference;
  readonly originalPublicationIntegrity: string;
  readonly rebindOperationId: string;
  readonly rebindOperationBindingFingerprint: string;
  readonly previousDevice: number;
  readonly previousInode: number;
  readonly newDevice: number;
  readonly newInode: number;
  readonly verifiedSha256: string;
  readonly verifiedByteLength: number;
  readonly reasonCode: AudioCanonicalRebindReasonCode;
  readonly rebindAt: string;
  readonly integrity: string;
}

export interface ProtectedAudioCompensationPublicationReservation {
  readonly schemaVersion: typeof PUBLICATION_RESERVATION_SCHEMA_VERSION |
    typeof LEGACY_PUBLICATION_RESERVATION_SCHEMA_VERSION_V1;
  readonly compensationRef: string;
  readonly projectSlug: string;
  readonly operationId: string;
  readonly operationBindingFingerprint: string;
  readonly canonicalFileName: string;
  readonly stagingFileName: "temporary.wav" | typeof PUBLICATION_STAGING_FILE;
  readonly mode: "hard-link" | "exclusive-copy";
  readonly byteLength: number;
  readonly sha256: string;
  readonly device: number;
  readonly inode: number;
  readonly receiptIntegrity: string;
  readonly integrity: string;
}

export interface AudioCompensationState {
  readonly schemaVersion: typeof STATE_SCHEMA_VERSION;
  readonly compensationRef: string;
  readonly sequence: number;
  readonly status: AudioCompensationLifecycleStatus;
  readonly outcome:
    | "awaiting-registry"
    | "compensation-running"
    | "quarantine-delete-intent"
    | "compensation-retryable"
    | "compensated"
    | "registry-owned";
  readonly updatedAt: string;
  readonly integrity: string;
}

export class AudioCompensationStoreError extends Error {
  constructor() {
    super("Audio compensation state is invalid.");
    this.name = "AudioCompensationStoreError";
    this.stack = undefined;
  }
}

export class AudioCompensationBacklogSaturatedError
  extends AudioCompensationStoreError {
  constructor() {
    super();
    this.name = "AudioCompensationBacklogSaturatedError";
  }
}

/**
 * publication.json (ProtectedAudioCompensationPublication) is write-once and is never edited by
 * this mechanism. A rebind is a separate, additive, itself-immutable ledger entry: it re-anchors
 * the expected device/inode to the currently-observed physical file, but only after independently
 * re-verifying that the canonical file's content (sha256 + byteLength) still matches what the
 * original publication (or the prior rebind in the chain) recorded. See ATOLYE_CHECKPOINT.md
 * Sprint 136 for the incident (git checkout/pull re-materializing tracked canonical audio files
 * with a fresh inode, identical bytes) this exists to recover from without weakening the
 * content-integrity guarantee. Mirrors AudioPublicationIntentStore's rebind design (same six
 * acceptance conditions, same idempotency-before-no-op ordering, same append-only lineage model)
 * but is a separate, parallel mechanism -- AudioPublicationIntentStore.ts is not touched by this.
 */
export class AudioCanonicalDescriptorRebindConflictError
  extends AudioCompensationStoreError {
  constructor() {
    super();
    this.name = "AudioCanonicalDescriptorRebindConflictError";
  }
}

export interface AudioCompensationWorkspace {
  readonly context: RuntimeStorageContext;
  readonly projectSlug: string;
  readonly compensationRef: string;
  readonly directory: string;
  readonly temporaryFilePath: string;
  readonly reservedBytes: number;
}

type AudioCompensationWorkspaceMarker = {
  readonly schemaVersion:
    | typeof WORKSPACE_SCHEMA_VERSION
    | typeof LEGACY_WORKSPACE_SCHEMA_VERSION;
  readonly compensationRef: string;
  readonly projectSlug: string;
  readonly operationId: string;
  readonly operationBindingFingerprint: string;
  readonly createdAt: string;
  readonly reservedBytes?: number;
  readonly integrity: string;
};

type AudioCompensationRetirementPlan = {
  readonly schemaVersion: typeof RETIREMENT_SCHEMA_VERSION;
  readonly compensationRef: string;
  readonly projectSlug: string;
  readonly workspaceDevice: number;
  readonly workspaceInode: number;
  readonly receiptIntegrity: string;
  readonly terminalOutcome: "compensated" | "registry-owned";
  readonly physicalCleanupCapability: "unsupported-pathname-only";
  readonly directories: readonly {
    readonly relativePath: string;
    readonly device: number;
    readonly inode: number;
  }[];
  readonly files: readonly {
    readonly relativePath: string;
    readonly device: number;
    readonly inode: number;
    readonly byteLength: number;
    readonly sha256: string;
  }[];
  readonly integrity: string;
};

const trustedWorkspaces = new WeakSet<object>();

export function isSafeAudioCompensationRef(
  value: unknown,
): value is string {
  return typeof value === "string" && SAFE_REF.test(value);
}

export function prepareAudioCompensationWorkspace(input: {
  authority: RuntimeStorageAuthorityLease;
  context: RuntimeStorageContext;
  projectSlug: string;
  byteLength: number;
}): AudioCompensationWorkspace {
  const context = resolveRuntimeStorageContext(input.context);
  const operation = requireActiveProductionRuntimeOperationContext();
  requireProjectSlug(input.projectSlug);
  assertProjectWriteAuthorityLease(input.authority, input.projectSlug, context);
  if (!safeInteger(input.byteLength, 1, MAX_AUDIO_BYTES)) {
    throw new AudioCompensationStoreError();
  }
  resumeTerminalRetirements(context, input.projectSlug);
  const reservedBytes = admissionReservationBytes(input.byteLength);
  const inventory = inspectDeferredBacklog(context, input.projectSlug);
  if (
    !inventory.acceptingWrites ||
    inventory.totalBytes > MAX_DEFERRED_BACKLOG_BYTES - reservedBytes
  ) {
    throw new AudioCompensationBacklogSaturatedError();
  }
  if (activeRecordCount(context, input.projectSlug) >= MAX_RECORDS_PER_PROJECT) {
    throw new AudioCompensationStoreError();
  }
  const cleanup = ensureCleanupRoot(context, input.projectSlug);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const compensationRef = `audio-comp-${randomUUID()}`;
    const directory = path.join(cleanup, compensationRef);
    try {
      fs.mkdirSync(directory, { mode: 0o700 });
    } catch {
      continue;
    }
    const contained = requireContainedRealDirectory(cleanup, directory);
    const createdAt = new Date().toISOString();
    const body = {
      schemaVersion: WORKSPACE_SCHEMA_VERSION,
      compensationRef,
      projectSlug: input.projectSlug,
      operationId: operation.operationId,
      operationBindingFingerprint: operation.bindingFingerprint,
      createdAt,
      reservedBytes,
    } as const;
    const marker = Object.freeze({ ...body, integrity: digest(body) });
    try {
      writeDurableJsonNoClobber(
        contained,
        WORKSPACE_FILE,
        marker,
        MAX_WORKSPACE_BYTES,
      );
      fs.mkdirSync(path.join(contained, "quarantine"), { mode: 0o700 });
    } catch {
      throw new AudioCompensationStoreError();
    }
    const workspace = Object.freeze({
      context,
      projectSlug: input.projectSlug,
      compensationRef,
      directory: contained,
      temporaryFilePath: path.join(contained, "temporary.wav"),
      reservedBytes,
    });
    trustedWorkspaces.add(workspace);
    return workspace;
  }
  throw new AudioCompensationStoreError();
}

export function getProtectedAudioCompensationQuarantineDirectory(
  projectSlug: string,
  compensationRef: string,
  input: RuntimeStorageInput = {},
): string {
  const context = resolveRuntimeStorageContext(input);
  requireActiveProductionRuntimeOperationContext();
  const workspace = requireDeferredWorkspace(
    context,
    projectSlug,
    compensationRef,
  );
  return requireContainedRealDirectory(
    workspace,
    path.join(workspace, "quarantine"),
  );
}

export function getProtectedAudioCompensationPublicationSourcePath(
  projectSlug: string,
  compensationRef: string,
  stagingFileName: "temporary.wav" | typeof PUBLICATION_STAGING_FILE,
  input: RuntimeStorageInput = {},
): string {
  const context = resolveRuntimeStorageContext(input);
  const workspace = requireDeferredWorkspace(
    context,
    projectSlug,
    compensationRef,
  );
  if (
    stagingFileName !== "temporary.wav" &&
    stagingFileName !== PUBLICATION_STAGING_FILE
  ) {
    throw new AudioCompensationStoreError();
  }
  return path.join(workspace, stagingFileName);
}

export function assertProtectedAudioCanonicalResolutionAllowed(
  projectSlug: string,
  canonicalFileName: string,
  input: RuntimeStorageInput = {},
): ProtectedAudioCanonicalReadIdentity | undefined {
  const context = resolveRuntimeStorageContext(input);
  requireProjectSlug(projectSlug);
  if (!SAFE_FILE_NAME.test(canonicalFileName)) {
    throw new AudioCompensationStoreError();
  }
  // Discovery spans both logical sources of a compensation record for this
  // canonical file: the cleanup/retention root (detached, in-flight, or
  // stale workspaces still awaiting resolution) and the permanent receipt
  // root (already-settled, registry-owned publications -- see
  // ProductionSupersededDuplicateReservationAuthority.ts's forensic report
  // on section-1..5.wav for why a completed, fingerprint-verified receipt
  // sitting only in the receipt root was previously invisible here). Either
  // root may be absent; only an absent cleanup root changes the historical
  // "nothing to check" empty-result contract described in this function's
  // own callers, so that case is preserved exactly. A `kind: "receipt"`
  // entry is deliberately never routed through the cleanup-side pending/
  // active-operation branch below -- the permanent ledger is expected to
  // hold only terminal, registry-owned records, so any other state found
  // there is treated as a data-integrity anomaly, not a resumable
  // in-flight compensation.
  const cleanup = cleanupRootIfPresent(context, projectSlug);
  const receipt = receiptRootIfPresent(context, projectSlug);
  if (!cleanup && !receipt) return undefined;
  const sources: Array<{ readonly root: string; readonly kind: "cleanup" | "receipt" }> = [];
  if (cleanup) sources.push({ root: cleanup, kind: "cleanup" });
  if (receipt) sources.push({ root: receipt, kind: "receipt" });
  let expectedIdentity: ProtectedAudioCanonicalReadIdentity | undefined;
  for (const { kind, root } of sources) {
    for (const entry of fs.readdirSync(root).sort()) {
      if (
        entry === JOURNAL_STAGING_DIRECTORY ||
        entry === REBIND_DIRECTORY ||
        parseRetirementFileName(entry)
      ) continue;
      if (!isSafeAudioCompensationRef(entry)) {
        throw new AudioCompensationStoreError();
      }
      // A logically-retired cleanup workspace (retireTerminalWorkspace's
      // durable, idempotent plan marker -- physical directory removal is
      // never guaranteed, see executeRetirementPlan) is excluded here using
      // the exact same canonical `isLogicallyRetired` check activeRecordCount
      // already relies on for the identical purpose: never by the mere
      // presence of a plan-shaped filename, never by state alone, and never
      // by the workspace's physical absence. `isLogicallyRetired` itself
      // throws (fail-closed, propagated below, never swallowed) if a plan
      // exists but the live workspace directory's device/inode no longer
      // matches what the plan pinned -- a foreign/reused/tampered workspace
      // is therefore never mistaken for a retired one. Only ever meaningful
      // for the cleanup root: retirement plans are never written against the
      // permanent receipt root.
      if (kind === "cleanup" && isLogicallyRetired(root, projectSlug, entry)) {
        continue;
      }
      const current = readAudioCompensationReceiptForRetention(
        context,
        projectSlug,
        entry,
      );
      if (current.receipt.canonicalFileName !== canonicalFileName) continue;
      if (
        current.state.status === "completed" &&
        current.state.outcome === "registry-owned"
      ) {
        if (!current.publication) throw new AudioCompensationStoreError();
        const effective = resolveEffectiveCanonicalReadIdentity(
          context,
          projectSlug,
          entry,
          current.publication,
        );
        expectedIdentity = mergeCanonicalReadIdentity(
          expectedIdentity,
          effective,
        );
        continue;
      }
      if (kind === "receipt") {
        throw new AudioCompensationStoreError();
      }
      if (
        current.state.status === "completed" &&
        current.state.outcome === "compensated"
      ) {
        throw new AudioCompensationStoreError();
      }
      let operation: ProductionRuntimeOperationContext;
      try {
        operation = requireActiveProductionRuntimeOperationContext();
      } catch {
        throw new AudioCompensationStoreError();
      }
      if (
        current.receipt.operationId !== operation.operationId ||
        current.receipt.operationBindingFingerprint !== operation.bindingFingerprint
      ) {
        throw new AudioCompensationStoreError();
      }
      const pendingAuthority = current.publication ?? current.publicationReservation;
      if (!pendingAuthority) throw new AudioCompensationStoreError();
      expectedIdentity = mergeCanonicalReadIdentity(
        expectedIdentity,
        pendingAuthority,
      );
    }
  }
  return expectedIdentity;
}

function mergeCanonicalReadIdentity(
  current: ProtectedAudioCanonicalReadIdentity | undefined,
  candidate: ProtectedAudioCanonicalReadIdentity,
): ProtectedAudioCanonicalReadIdentity {
  if (
    !identityInteger(candidate.device) ||
    !identityInteger(candidate.inode) ||
    !safeInteger(candidate.byteLength, 1, MAX_AUDIO_BYTES) ||
    !/^[0-9a-f]{64}$/.test(candidate.sha256)
  ) {
    throw new AudioCompensationStoreError();
  }
  if (
    current &&
    (current.device !== candidate.device ||
      current.inode !== candidate.inode ||
      current.byteLength !== candidate.byteLength ||
      current.sha256 !== candidate.sha256)
  ) {
    throw new AudioCompensationStoreError();
  }
  return Object.freeze({
    device: candidate.device,
    inode: candidate.inode,
    byteLength: candidate.byteLength,
    sha256: candidate.sha256,
  });
}

/**
 * Creates a new, immutable descriptor-rebind ledger entry for a "registry-owned" (terminal)
 * compensation record. `publication.json` is never opened for writing here. Accepted only when
 * ALL hold: a current registry-owned publication actually exists for `compensationRef` (a missing
 * record, a still-pending record, or a retention-retired record all fail closed -- this function
 * never fabricates a recovery for those); a fresh, TOCTOU-safe read of the canonical file (open ->
 * fstat -> read -> fstat -> path-lstat, via readAudioFileDescriptorBound) succeeds; the freshly
 * computed sha256 and observed byteLength are byte-for-byte identical to what the publication (or
 * the current rebind chain tip) already recorded; and the observed device/inode genuinely differ
 * from the currently-expected device/inode (a no-op rebind is rejected, not silently accepted).
 */
export function createAudioCanonicalDescriptorRebind(input: {
  readonly projectSlug: string;
  readonly compensationRef: string;
  readonly reasonCode: AudioCanonicalRebindReasonCode;
  readonly authority: RuntimeStorageAuthorityLease;
  readonly context: RuntimeStorageContext;
}): AudioCanonicalDescriptorRebind {
  const context = resolveRuntimeStorageContext(input.context);
  assertProjectWriteAuthorityLease(input.authority, input.projectSlug, context);
  requireProjectSlug(input.projectSlug);
  if (!isSafeAudioCompensationRef(input.compensationRef)) {
    throw new AudioCompensationStoreError();
  }
  if (!(audioCanonicalRebindReasonCodes as readonly string[]).includes(input.reasonCode)) {
    throw new AudioCompensationStoreError();
  }
  const operation = requireActiveProductionRuntimeOperationContext();

  let current: ReturnType<typeof readAudioCompensationReceiptForRetention>;
  try {
    current = readAudioCompensationReceiptForRetention(
      context,
      input.projectSlug,
      input.compensationRef,
    );
  } catch {
    // No record, or the record's directory has already been retired by retention -- fail
    // closed. Auto-rebind is never safe here; this requires a separate, human-authorized
    // reauthorization flow, not this mechanism.
    throw new AudioCompensationStoreError();
  }
  const cleanup = cleanupRootIfPresent(context, input.projectSlug);
  if (!cleanup || isLogicallyRetired(cleanup, input.projectSlug, input.compensationRef)) {
    throw new AudioCompensationStoreError();
  }
  if (
    current.state.status !== "completed" ||
    current.state.outcome !== "registry-owned" ||
    !current.publication
  ) {
    throw new AudioCompensationStoreError();
  }
  const publication = current.publication;
  if (
    publication.compensationRef !== input.compensationRef ||
    publication.projectSlug !== input.projectSlug
  ) {
    throw new AudioCompensationStoreError();
  }

  const previous = resolveCurrentAudioCanonicalDescriptorRebindRecord(
    context,
    input.projectSlug,
    input.compensationRef,
    publication,
  );
  const expectedDevice = previous ? previous.newDevice : publication.device;
  const expectedInode = previous ? previous.newInode : publication.inode;

  const canonicalRelativePath =
    `data/projects/${input.projectSlug}/assets/audio/${publication.canonicalFileName}`;
  const canonicalPath = resolveRuntimeLogicalPath(canonicalRelativePath, context);
  let link: fs.Stats;
  let bytes: Buffer;
  try {
    link = fs.lstatSync(canonicalPath);
    if (!link.isFile() || link.isSymbolicLink()) throw new Error("not a regular file");
    bytes = readAudioFileDescriptorBound(canonicalPath, {
      maximumByteLength: publication.byteLength,
      openedIdentity: { device: link.dev, inode: link.ino, byteLength: link.size },
    });
  } catch {
    throw new AudioCompensationStoreError();
  }
  const verifiedSha256 = createHash("sha256").update(bytes).digest("hex");
  const observedDevice = link.dev;
  const observedInode = link.ino;
  const observedByteLength = link.size;

  // Idempotency, checked before the no-op rejection below: a repeat call that observes exactly
  // what the current chain tip already recorded is a safe replay of an already-completed rebind,
  // not a request with nothing to do.
  if (
    previous &&
    previous.compensationRef === input.compensationRef &&
    previous.canonicalFileName === publication.canonicalFileName &&
    previous.newDevice === observedDevice &&
    previous.newInode === observedInode &&
    previous.verifiedSha256 === verifiedSha256 &&
    previous.verifiedByteLength === observedByteLength
  ) {
    return previous;
  }

  if (
    verifiedSha256 !== publication.sha256 ||
    observedByteLength !== publication.byteLength ||
    (observedDevice === expectedDevice && observedInode === expectedInode)
  ) {
    throw new AudioCompensationStoreError();
  }

  const previousRecord: AudioCanonicalDescriptorRebindRecordReference = previous
    ? { kind: "rebind", id: previous.rebindId, integrity: previous.integrity }
    : { kind: "publication", id: publication.compensationRef, integrity: publication.integrity };
  const sequence = previous ? previous.sequence + 1 : 1;
  // rebindId is derived and embedded into body *before* hashing -- mirroring
  // AudioPublicationIntentStore's rebindId pattern exactly -- so digest(body) at write time and
  // digest(body) reconstructed from {integrity, ...body} at read time hash the identical shape.
  const body = {
    schemaVersion: REBIND_SCHEMA_VERSION as typeof REBIND_SCHEMA_VERSION,
    rebindId: `audio-canonical-rebind-${digest({
      compensationRef: input.compensationRef,
      sequence,
      newDevice: observedDevice,
      newInode: observedInode,
    }).slice(0, 32)}`,
    compensationRef: input.compensationRef,
    canonicalFileName: publication.canonicalFileName,
    projectSlug: input.projectSlug,
    sequence,
    previousRecord,
    originalPublicationIntegrity: publication.integrity,
    rebindOperationId: operation.operationId,
    rebindOperationBindingFingerprint: operation.bindingFingerprint,
    previousDevice: expectedDevice,
    previousInode: expectedInode,
    newDevice: observedDevice,
    newInode: observedInode,
    verifiedSha256,
    verifiedByteLength: observedByteLength,
    reasonCode: input.reasonCode,
    rebindAt: new Date().toISOString(),
  };
  const record: AudioCanonicalDescriptorRebind = Object.freeze({
    ...body,
    integrity: digest(body),
  });
  const rebindDir = audioCanonicalRebindDirectory(context, input.projectSlug, true);
  if (!rebindDir) throw new AudioCompensationStoreError();
  const fileName = `${input.compensationRef}.${sequence}.json`;
  const finalPath = path.join(rebindDir, fileName);
  try {
    writeDurableJsonNoClobber(rebindDir, fileName, record, MAX_REBIND_BYTES);
  } catch {
    if (!fs.existsSync(finalPath)) throw new AudioCompensationStoreError();
    const existing = readAudioCanonicalDescriptorRebindFile(finalPath);
    if (existing.integrity !== record.integrity) {
      throw new AudioCanonicalDescriptorRebindConflictError();
    }
    return existing;
  }
  const readback = readAudioCanonicalDescriptorRebindFile(finalPath);
  if (readback.integrity !== record.integrity) throw new AudioCompensationStoreError();
  return readback;
}

/** Testable, read-only chain resolution: the current rebind ledger entry for `compensationRef`. */
export function resolveCurrentAudioCanonicalDescriptorRebindRecord(
  context: RuntimeStorageContext,
  projectSlug: string,
  compensationRef: string,
  publication: ProtectedAudioCompensationPublication,
): AudioCanonicalDescriptorRebind | undefined {
  const directory = audioCanonicalRebindDirectory(context, projectSlug, false);
  if (!directory || !fs.existsSync(directory)) return undefined;
  const prefix = `${compensationRef}.`;
  const entries = fs.readdirSync(directory).sort()
    .filter((entry) => entry.startsWith(prefix) && entry.endsWith(".json"));
  if (entries.length === 0) return undefined;
  if (entries.length > MAX_REBIND_RECORDS_PER_REF) {
    throw new AudioCanonicalDescriptorRebindConflictError();
  }
  const bySequence = new Map<number, AudioCanonicalDescriptorRebind[]>();
  for (const entry of entries) {
    const rec = readAudioCanonicalDescriptorRebindFile(path.join(directory, entry));
    if (
      rec.compensationRef !== compensationRef ||
      rec.projectSlug !== projectSlug ||
      `${rec.compensationRef}.${rec.sequence}.json` !== entry
    ) throw new AudioCanonicalDescriptorRebindConflictError();
    const bucket = bySequence.get(rec.sequence) ?? [];
    bucket.push(rec);
    bySequence.set(rec.sequence, bucket);
  }
  const maxSequence = Math.max(...bySequence.keys());
  let expected: AudioCanonicalDescriptorRebindRecordReference = {
    kind: "publication",
    id: publication.compensationRef,
    integrity: publication.integrity,
  };
  let currentRecord: AudioCanonicalDescriptorRebind | undefined;
  for (let sequence = 1; sequence <= maxSequence; sequence += 1) {
    const bucket = bySequence.get(sequence) ?? [];
    if (bucket.length !== 1) throw new AudioCanonicalDescriptorRebindConflictError();
    const rec = bucket[0];
    if (
      rec.previousRecord.kind !== expected.kind ||
      rec.previousRecord.id !== expected.id ||
      rec.previousRecord.integrity !== expected.integrity ||
      rec.originalPublicationIntegrity !== publication.integrity ||
      rec.canonicalFileName !== publication.canonicalFileName ||
      rec.verifiedSha256 !== publication.sha256 ||
      rec.verifiedByteLength !== publication.byteLength
    ) throw new AudioCanonicalDescriptorRebindConflictError();
    currentRecord = rec;
    expected = { kind: "rebind", id: rec.rebindId, integrity: rec.integrity };
  }
  return currentRecord;
}

/**
 * The expected descriptor `assertProtectedAudioCanonicalResolutionAllowed` should verify the
 * canonical file against, for a registry-owned `compensationRef` -- the re-verified values
 * already carried by the rebind chain tip if one exists, otherwise `publication` itself unchanged.
 * sha256/byteLength are never re-derived here, never looser than what `publication` (or the chain)
 * already proved.
 */
export function resolveEffectiveCanonicalReadIdentity(
  context: RuntimeStorageContext,
  projectSlug: string,
  compensationRef: string,
  publication: ProtectedAudioCompensationPublication,
): ProtectedAudioCanonicalReadIdentity {
  const rebind = resolveCurrentAudioCanonicalDescriptorRebindRecord(
    context,
    projectSlug,
    compensationRef,
    publication,
  );
  if (!rebind) return publication;
  return Object.freeze({
    device: rebind.newDevice,
    inode: rebind.newInode,
    byteLength: rebind.verifiedByteLength,
    sha256: rebind.verifiedSha256,
  });
}

function audioCanonicalRebindDirectory(
  context: RuntimeStorageContext,
  projectSlug: string,
  write: boolean,
): string | undefined {
  requireProjectSlug(projectSlug);
  if (write) {
    const cleanup = ensureCleanupRoot(context, projectSlug);
    const directory = path.join(cleanup, REBIND_DIRECTORY);
    try {
      return ensureSafeContainedDirectory(cleanup, directory);
    } catch {
      throw new AudioCompensationStoreError();
    }
  }
  const cleanup = cleanupRootIfPresent(context, projectSlug);
  if (!cleanup) return undefined;
  const directory = path.join(cleanup, REBIND_DIRECTORY);
  try {
    return requireContainedRealDirectory(cleanup, directory);
  } catch {
    return undefined;
  }
}

function readAudioCanonicalDescriptorRebindFile(
  filePath: string,
): AudioCanonicalDescriptorRebind {
  const value = readJsonFile(filePath, MAX_REBIND_BYTES);
  if (!validAudioCanonicalDescriptorRebind(value)) {
    throw new AudioCanonicalDescriptorRebindConflictError();
  }
  return Object.freeze(value);
}

function validAudioCanonicalDescriptorRebind(
  value: unknown,
): value is AudioCanonicalDescriptorRebind {
  if (!record(value)) return false;
  const { integrity, ...body } = value;
  return Object.keys(value).length === 19 &&
    value.schemaVersion === REBIND_SCHEMA_VERSION &&
    SAFE_FILE_NAME.test(String(value.rebindId)) &&
    isSafeAudioCompensationRef(value.compensationRef) &&
    SAFE_FILE_NAME.test(String(value.canonicalFileName)) &&
    /^[a-zA-Z0-9-_]+$/.test(String(value.projectSlug)) &&
    safeInteger(value.sequence, 1) &&
    validAudioCanonicalRebindRecordReference(value.previousRecord) &&
    typeof value.originalPublicationIntegrity === "string" &&
    /^[0-9a-f]{64}$/.test(value.originalPublicationIntegrity) &&
    typeof value.rebindOperationId === "string" && value.rebindOperationId.length > 0 &&
    typeof value.rebindOperationBindingFingerprint === "string" &&
    value.rebindOperationBindingFingerprint.length > 0 &&
    identityInteger(value.previousDevice) &&
    identityInteger(value.previousInode) &&
    identityInteger(value.newDevice) &&
    identityInteger(value.newInode) &&
    (value.previousDevice !== value.newDevice || value.previousInode !== value.newInode) &&
    typeof value.verifiedSha256 === "string" && /^[0-9a-f]{64}$/.test(value.verifiedSha256) &&
    safeInteger(value.verifiedByteLength, 1, MAX_AUDIO_BYTES) &&
    (audioCanonicalRebindReasonCodes as readonly string[]).includes(
      value.reasonCode as string,
    ) &&
    validDate(value.rebindAt) &&
    typeof integrity === "string" &&
    integrity === digest(body);
}

function validAudioCanonicalRebindRecordReference(
  value: unknown,
): value is AudioCanonicalDescriptorRebindRecordReference {
  if (!record(value)) return false;
  return (value.kind === "publication" || value.kind === "rebind") &&
    typeof value.id === "string" && value.id.length > 0 &&
    typeof value.integrity === "string" && /^[0-9a-f]{64}$/.test(value.integrity);
}

export function createProtectedAudioCompensationReceipt(input: {
  authority: RuntimeStorageAuthorityLease;
  context: RuntimeStorageContext;
  projectSlug: string;
  workspace: AudioCompensationWorkspace;
  canonicalFileName: string;
  byteLength: number;
  sha256: string;
  device: number;
  inode: number;
}): ProtectedAudioCompensationReceipt {
  const context = resolveRuntimeStorageContext(input.context);
  const operation = requireActiveProductionRuntimeOperationContext();
  assertProjectWriteAuthorityLease(input.authority, input.projectSlug, context);
  requireReceiptInput(input);
  requireTrustedWorkspace(
    input.workspace,
    context,
    input.projectSlug,
    operation,
  );
  pruneCompletedAudioCompensationRecords(
    input.projectSlug,
    input.authority,
    context,
  );
  if (activeRecordCount(context, input.projectSlug) >= MAX_RECORDS_PER_PROJECT) {
    throw new AudioCompensationStoreError();
  }
  const compensationRef = input.workspace.compensationRef;
  const quarantineDirectoryName = `.audio-quarantine-${compensationRef}`;
  const createdAt = new Date().toISOString();
  const body = {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    compensationRef,
    projectSlug: input.projectSlug,
    operationId: operation.operationId,
    operationBindingFingerprint: operation.bindingFingerprint,
    canonicalFileName: input.canonicalFileName,
    quarantineDirectoryName,
    byteLength: input.byteLength,
    sha256: input.sha256,
    device: input.device,
    inode: input.inode,
    createdAt,
  } as const;
  const receipt = Object.freeze({ ...body, integrity: digest(body) });
  const recordDirectory = createRecordDirectory(
    context,
    input.projectSlug,
    compensationRef,
    input.workspace,
    input.authority,
  );
  try {
    writeDurableJsonNoClobber(
      recordDirectory,
      RECEIPT_FILE,
      receipt,
      MAX_RECEIPT_BYTES,
    );
    writeState(context, input.projectSlug, receipt, {
      status: "pending",
      outcome: "awaiting-registry",
    }, input.authority);
    return receipt;
  } catch (error) {
    deferRecordDirectory(
      context,
      input.projectSlug,
      compensationRef,
      recordDirectory,
      input.authority,
    );
    throw error;
  }
}

export function bindProtectedAudioCompensationPublication(input: {
  authority: RuntimeStorageAuthorityLease;
  context: RuntimeStorageContext;
  projectSlug: string;
  compensationRef: string;
  mode: "hard-link" | "exclusive-copy";
  byteLength: number;
  sha256: string;
  device: number;
  inode: number;
}): ProtectedAudioCompensationPublication {
  const context = resolveRuntimeStorageContext(input.context);
  assertProjectWriteAuthorityLease(input.authority, input.projectSlug, context);
  const current = readProtectedAudioCompensationReceipt(
    input.projectSlug,
    input.compensationRef,
    context,
  );
  if (
    current.publication ||
    !current.publicationReservation ||
    current.state.status !== "pending" ||
    current.state.outcome !== "awaiting-registry" ||
    current.receipt.byteLength !== input.byteLength ||
    current.receipt.sha256 !== input.sha256 ||
    !["hard-link", "exclusive-copy"].includes(input.mode) ||
    !identityInteger(input.device) ||
    !identityInteger(input.inode)
  ) {
    throw new AudioCompensationStoreError();
  }
  if (
    current.publicationReservation.mode !== input.mode ||
    current.publicationReservation.byteLength !== input.byteLength ||
    current.publicationReservation.sha256 !== input.sha256 ||
    current.publicationReservation.device !== input.device ||
    current.publicationReservation.inode !== input.inode ||
    current.publicationReservation.receiptIntegrity !== current.receipt.integrity
  ) {
    throw new AudioCompensationStoreError();
  }
  const body = {
    schemaVersion: PUBLICATION_SCHEMA_VERSION,
    compensationRef: input.compensationRef,
    projectSlug: input.projectSlug,
    operationId: current.receipt.operationId,
    operationBindingFingerprint: current.receipt.operationBindingFingerprint,
    canonicalFileName: current.receipt.canonicalFileName,
    stagingFileName: current.publicationReservation.stagingFileName,
    mode: input.mode,
    byteLength: input.byteLength,
    sha256: input.sha256,
    device: input.device,
    inode: input.inode,
    receiptIntegrity: current.receipt.integrity,
    reservationIntegrity: current.publicationReservation.integrity,
    publishedAt: new Date().toISOString(),
  } as const;
  const publication = Object.freeze({ ...body, integrity: digest(body) });
  const recordDirectory = requireRecordDirectory(
    context,
    input.projectSlug,
    input.compensationRef,
  );
  writeDurableJsonNoClobber(
    recordDirectory,
    PUBLICATION_FILE,
    publication,
    MAX_PUBLICATION_BYTES,
  );
  return publication;
}

export function reserveProtectedAudioCompensationPublication(input: {
  authority: RuntimeStorageAuthorityLease;
  context: RuntimeStorageContext;
  projectSlug: string;
  compensationRef: string;
  mode: "hard-link" | "exclusive-copy";
  byteLength: number;
  sha256: string;
  device: number;
  inode: number;
}): ProtectedAudioCompensationPublicationReservation {
  const context = resolveRuntimeStorageContext(input.context);
  assertProjectWriteAuthorityLease(input.authority, input.projectSlug, context);
  const current = readProtectedAudioCompensationReceipt(
    input.projectSlug,
    input.compensationRef,
    context,
  );
  if (
    current.publication ||
    current.state.status !== "pending" ||
    current.state.outcome !== "awaiting-registry" ||
    current.receipt.byteLength !== input.byteLength ||
    current.receipt.sha256 !== input.sha256 ||
    !["hard-link", "exclusive-copy"].includes(input.mode) ||
    !identityInteger(input.device) ||
    !identityInteger(input.inode)
  ) {
    throw new AudioCompensationStoreError();
  }
  const body = {
    schemaVersion: PUBLICATION_RESERVATION_SCHEMA_VERSION,
    compensationRef: input.compensationRef,
    projectSlug: input.projectSlug,
    operationId: current.receipt.operationId,
    operationBindingFingerprint: current.receipt.operationBindingFingerprint,
    canonicalFileName: current.receipt.canonicalFileName,
    stagingFileName: PUBLICATION_STAGING_FILE,
    mode: input.mode,
    byteLength: input.byteLength,
    sha256: input.sha256,
    device: input.device,
    inode: input.inode,
    receiptIntegrity: current.receipt.integrity,
  } as const;
  const reservation = Object.freeze({ ...body, integrity: digest(body) });
  const recordDirectory = requireRecordDirectory(
    context,
    input.projectSlug,
    input.compensationRef,
  );
  const reservationPath = path.join(
    recordDirectory,
    PUBLICATION_RESERVATION_FILE,
  );
  try {
    writeDurableJsonNoClobber(
      recordDirectory,
      PUBLICATION_RESERVATION_FILE,
      reservation,
      MAX_PUBLICATION_BYTES,
    );
  } catch {
    const existing = readJsonFile(reservationPath, MAX_PUBLICATION_BYTES);
    if (!validatePublicationReservation(existing, current.receipt) ||
      existing.integrity !== reservation.integrity) {
      throw new AudioCompensationStoreError();
    }
    return existing;
  }
  return reservation;
}

export function removeProtectedAudioTemporaryAlias(
  projectSlug: string,
  compensationRef: string,
  authority: RuntimeStorageAuthorityLease,
  input: RuntimeStorageInput = {},
): "completed" | "not-required" | "failed" {
  const context = resolveRuntimeStorageContext(input);
  assertProjectWriteAuthorityLease(authority, projectSlug, context);
  const current = readProtectedAudioCompensationReceipt(
    projectSlug,
    compensationRef,
    context,
  );
  if (
    current.state.status !== "completed" ||
    current.state.outcome !== "registry-owned" ||
    !current.publication
  ) {
    return "failed";
  }
  const workspace = requireDeferredWorkspace(context, projectSlug, compensationRef);
  return removeTemporaryAliasForCurrent(workspace, current);
}

export function readProtectedAudioCompensationReceipt(
  projectSlug: string,
  compensationRef: string,
  input: RuntimeStorageInput = {},
): {
  readonly receipt: ProtectedAudioCompensationReceipt;
  readonly publicationReservation?: ProtectedAudioCompensationPublicationReservation;
  readonly publication?: ProtectedAudioCompensationPublication;
  readonly state: AudioCompensationState;
} {
  const context = resolveRuntimeStorageContext(input);
  const operation = requireActiveProductionRuntimeOperationContext();
  requireProjectSlug(projectSlug);
  if (!isSafeAudioCompensationRef(compensationRef)) {
    throw new AudioCompensationStoreError();
  }
  const recordDirectory = requireRecordDirectory(
    context,
    projectSlug,
    compensationRef,
  );
  const entries = fs.readdirSync(recordDirectory).sort();
  if (
    !entries.includes(RECEIPT_FILE) ||
    entries.some((entry) =>
      entry !== RECEIPT_FILE &&
      entry !== PUBLICATION_RESERVATION_FILE &&
      entry !== PUBLICATION_FILE &&
      entry !== JOURNAL_STAGING_DIRECTORY &&
      entry !== "tombstone" &&
      !/^state-[0-9]{6}\.json$/.test(entry)
    )
  ) {
    throw new AudioCompensationStoreError();
  }
  const receipt = readJsonFile(
    path.join(recordDirectory, RECEIPT_FILE),
    MAX_RECEIPT_BYTES,
  );
  if (
    !validateReceipt(receipt, projectSlug, compensationRef, operation)
  ) {
    throw new AudioCompensationStoreError();
  }
  const states = entries
    .filter((entry) => /^state-[0-9]{6}\.json$/.test(entry))
    .map((entry) =>
      readJsonFile(path.join(recordDirectory, entry), MAX_STATE_BYTES)
    );
  if (
    states.length === 0 ||
    !states.every((state, index) =>
      validateState(
        state,
        receipt,
        index + 1,
        index > 0 ? states[index - 1] : undefined,
      )
    )
  ) {
    throw new AudioCompensationStoreError();
  }
  const publicationReservation = readOptionalPublicationReservation(
    recordDirectory,
    entries,
    receipt,
  ).publicationReservation;
  const publication = readOptionalPublication(
    recordDirectory,
    entries,
    receipt,
  ).publication;
  requireExactPublicationAuthority(receipt, publicationReservation, publication);
  return {
    receipt,
    ...(publicationReservation ? { publicationReservation } : {}),
    ...(publication ? { publication } : {}),
    state: states.at(-1) as AudioCompensationState,
  };
}

export function transitionAudioCompensationState(
  projectSlug: string,
  compensationRef: string,
  transition: {
    status: AudioCompensationLifecycleStatus;
    outcome: AudioCompensationState["outcome"];
  },
  authority: RuntimeStorageAuthorityLease,
  input: RuntimeStorageInput = {},
): AudioCompensationState {
  const context = resolveRuntimeStorageContext(input);
  assertProjectWriteAuthorityLease(authority, projectSlug, context);
  const current = readProtectedAudioCompensationReceipt(
    projectSlug,
    compensationRef,
    context,
  );
  if (current.state.status === "completed") return current.state;
  if (!validTransition(current.state.status, transition.status)) {
    throw new AudioCompensationStoreError();
  }
  return writeState(
    context,
    projectSlug,
    current.receipt,
    transition,
    authority,
  );
}

export function removeRegistryOwnedAudioCompensationRecord(
  projectSlug: string,
  compensationRef: string,
  authority: RuntimeStorageAuthorityLease,
  input: RuntimeStorageInput = {},
): void {
  const context = resolveRuntimeStorageContext(input);
  assertProjectWriteAuthorityLease(authority, projectSlug, context);
  requireActiveProductionRuntimeOperationContext();
  requireProjectSlug(projectSlug);
  if (!isSafeAudioCompensationRef(compensationRef)) {
    throw new AudioCompensationStoreError();
  }
  const cleanup = cleanupRootIfPresent(context, projectSlug);
  if (cleanup) {
    const planPath = path.join(cleanup, retirementFileName(compensationRef));
    if (fs.existsSync(planPath)) {
      const plan = readRetirementPlan(planPath, projectSlug, compensationRef);
      executeRetirementPlan(cleanup, planPath, plan);
      return;
    }
    if (!fs.existsSync(path.join(cleanup, compensationRef))) return;
  }
  const current = readProtectedAudioCompensationReceipt(
    projectSlug,
    compensationRef,
    context,
  );
  if (
    current.state.status !== "completed" ||
    current.state.outcome !== "registry-owned"
  ) {
    throw new AudioCompensationStoreError();
  }
  removeCompletedRecord(context, projectSlug, compensationRef, authority);
}

/**
 * Narrow sibling of `removeRegistryOwnedAudioCompensationRecord` -- identical
 * authority chain, identical idempotent-replay/already-retired handling,
 * identical underlying `removeCompletedRecord` -> `retireTerminalWorkspace` ->
 * `buildRetirementPlan`/`executeRetirementPlan` engine (none of which are
 * touched here). The only difference is the terminal outcome this accepts:
 * `"compensated"` (a formally abandoned/rolled-back record) instead of
 * `"registry-owned"`. `buildRetirementPlan` already accepts either outcome
 * unconditionally -- this function exists only because no existing public
 * entry point could reach that path for a single, targeted `"compensated"`
 * record without also being subject to `pruneCompletedAudioCompensationRecords`'s
 * unrelated `RETAIN_TERMINAL_RECORDS` retention-count gate, which this
 * function never consults.
 */
export function removeCompensatedAudioCompensationRecord(
  projectSlug: string,
  compensationRef: string,
  authority: RuntimeStorageAuthorityLease,
  input: RuntimeStorageInput = {},
): void {
  const context = resolveRuntimeStorageContext(input);
  assertProjectWriteAuthorityLease(authority, projectSlug, context);
  requireActiveProductionRuntimeOperationContext();
  requireProjectSlug(projectSlug);
  if (!isSafeAudioCompensationRef(compensationRef)) {
    throw new AudioCompensationStoreError();
  }
  const cleanup = cleanupRootIfPresent(context, projectSlug);
  if (cleanup) {
    const planPath = path.join(cleanup, retirementFileName(compensationRef));
    if (fs.existsSync(planPath)) {
      const plan = readRetirementPlan(planPath, projectSlug, compensationRef);
      executeRetirementPlan(cleanup, planPath, plan);
      return;
    }
    if (!fs.existsSync(path.join(cleanup, compensationRef))) return;
  }
  const current = readProtectedAudioCompensationReceipt(
    projectSlug,
    compensationRef,
    context,
  );
  if (
    current.state.status !== "completed" ||
    current.state.outcome !== "compensated"
  ) {
    throw new AudioCompensationStoreError();
  }
  removeCompletedRecord(context, projectSlug, compensationRef, authority);
}

export function pruneCompletedAudioCompensationRecords(
  projectSlug: string,
  authority: RuntimeStorageAuthorityLease,
  input: RuntimeStorageInput = {},
): {
  readonly removed: number;
  readonly failed: number;
  readonly deferred: number;
  readonly saturated: boolean;
} {
  const context = resolveRuntimeStorageContext(input);
  requireActiveProductionRuntimeOperationContext();
  requireProjectSlug(projectSlug);
  assertProjectWriteAuthorityLease(authority, projectSlug, context);
  const resumedRetirements = resumeTerminalRetirements(context, projectSlug);
  const resumed = resumeDetachedCompletedRecords(context, projectSlug);
  const cleanup = cleanupRootIfPresent(context, projectSlug);
  if (!cleanup) {
    return {
      removed: resumedRetirements.removed,
      failed: resumed.failed + resumedRetirements.failed,
      deferred: resumed.deferred,
      saturated: resumed.saturated || resumedRetirements.failed > 0,
    };
  }
  const entries = fs.readdirSync(cleanup)
    .filter((entry) => isSafeAudioCompensationRef(entry))
    .sort();
  const completed: Array<{
    readonly compensationRef: string;
    readonly createdAt: string;
  }> = [];
  for (const compensationRef of entries) {
    try {
      const current = readAudioCompensationReceiptForRetention(
        context,
        projectSlug,
        compensationRef,
      );
      if (current.state.status === "completed") {
        completed.push({
          compensationRef,
          createdAt: current.receipt.createdAt,
        });
      }
    } catch {
      // Records from another operation or hostile records are never removed.
    }
  }
  completed.sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt) ||
    left.compensationRef.localeCompare(right.compensationRef)
  );
  let removed = 0;
  let failed = resumed.failed + resumedRetirements.failed;
  const retentionRemovals = Math.max(
    0,
    completed.length - RETAIN_TERMINAL_RECORDS,
  );
  for (const record of completed.slice(0, retentionRemovals)) {
    try {
      retireTerminalWorkspace(
        context,
        projectSlug,
        record.compensationRef,
        authority,
      );
      removed += 1;
    } catch {
      failed += 1;
    }
  }
  return {
    removed: removed + resumedRetirements.removed,
    failed,
    deferred: resumed.deferred,
    saturated: resumed.saturated || failed > 0,
  };
}

export function getDeferredAudioCompensationBacklogStatus(
  projectSlug: string,
  input: RuntimeStorageInput = {},
): {
  readonly status: "empty" | "deferred" | "saturated";
  readonly observedRecords: number;
  readonly failedRecords: number;
  readonly totalBytes: number;
  readonly maximumRecords: number;
  readonly maximumBytes: number;
  readonly acceptingWrites: boolean;
} {
  const context = resolveRuntimeStorageContext(input);
  requireActiveProductionRuntimeOperationContext();
  requireProjectSlug(projectSlug);
  const inventory = inspectDeferredBacklog(context, projectSlug);
  return Object.freeze({
    status: !inventory.acceptingWrites
      ? "saturated"
      : inventory.recordCount > 0
      ? "deferred"
      : "empty",
    observedRecords: Math.min(
      inventory.recordCount,
      MAX_DEFERRED_BACKLOG_OBSERVATIONS,
    ),
    failedRecords: Math.min(
      inventory.failedRecords,
      MAX_DEFERRED_BACKLOG_OBSERVATIONS,
    ),
    totalBytes: Math.min(inventory.totalBytes, MAX_DEFERRED_BACKLOG_BYTES),
    maximumRecords: MAX_DEFERRED_BACKLOG_RECORDS,
    maximumBytes: MAX_DEFERRED_BACKLOG_BYTES,
    acceptingWrites: inventory.acceptingWrites,
  });
}

function recordCount(
  context: RuntimeStorageContext,
  projectSlug: string,
): number {
  return countRecordDirectories(receiptRootIfPresent(context, projectSlug));
}

function activeRecordCount(
  context: RuntimeStorageContext,
  projectSlug: string,
): number {
  let count = recordCount(context, projectSlug);
  const cleanup = cleanupRootIfPresent(context, projectSlug);
  if (!cleanup) return count;
  let directory: fs.Dir | undefined;
  try {
    directory = fs.opendirSync(cleanup);
    while (count < MAX_RECORDS_PER_PROJECT) {
      const entry = directory.readSync();
      if (!entry) break;
      if (parseRetirementFileName(entry.name)) continue;
      if (entry.name === JOURNAL_STAGING_DIRECTORY || entry.name === REBIND_DIRECTORY) continue;
      if (
        isSafeAudioCompensationRef(entry.name) &&
        isLogicallyRetired(cleanup, projectSlug, entry.name)
      ) continue;
      if (
        !isSafeAudioCompensationRef(entry.name) ||
        !entry.isDirectory() ||
        entry.isSymbolicLink()
      ) {
        throw new AudioCompensationStoreError();
      }
      const workspace = requireDeferredWorkspace(
        context,
        projectSlug,
        entry.name,
      );
      const candidate = path.join(workspace, "record");
      if (!fs.existsSync(candidate)) continue;
      const current = readAudioCompensationReceiptFromDirectory(
        requireContainedRealDirectory(workspace, candidate),
        projectSlug,
        entry.name,
      );
      if (current.state.status !== "completed") count += 1;
    }
  } catch {
    return MAX_RECORDS_PER_PROJECT;
  } finally {
    try {
      directory?.closeSync();
    } catch {
      return MAX_RECORDS_PER_PROJECT;
    }
  }
  return count;
}

function removeCompletedRecord(
  context: RuntimeStorageContext,
  projectSlug: string,
  compensationRef: string,
  authority: RuntimeStorageAuthorityLease,
): void {
  assertProjectWriteAuthorityLease(authority, projectSlug, context);
  const current = readAudioCompensationReceiptForRetention(
    context,
    projectSlug,
    compensationRef,
  );
  if (current.state.status !== "completed") {
    throw new AudioCompensationStoreError();
  }
  retireTerminalWorkspace(
    context,
    projectSlug,
    compensationRef,
    authority,
  );
}

function retireTerminalWorkspace(
  context: RuntimeStorageContext,
  projectSlug: string,
  compensationRef: string,
  authority: RuntimeStorageAuthorityLease,
): void {
  assertProjectWriteAuthorityLease(authority, projectSlug, context);
  const cleanup = cleanupRoot(context, projectSlug);
  const workspace = requireDeferredWorkspace(context, projectSlug, compensationRef);
  const current = readAudioCompensationReceiptFromDirectory(
    requireContainedRealDirectory(workspace, path.join(workspace, "record")),
    projectSlug,
    compensationRef,
  );
  if (current.state.status !== "completed") {
    throw new AudioCompensationStoreError();
  }
  if (current.state.outcome === "registry-owned") {
    if (!current.publication) throw new AudioCompensationStoreError();
    const alias = removeTemporaryAliasForCurrent(workspace, current);
    if (alias === "failed") throw new AudioCompensationStoreError();
  }
  const plan = buildRetirementPlan(
    cleanup,
    workspace,
    current.receipt,
    current.state.outcome,
  );
  const planName = retirementFileName(compensationRef);
  const planPath = path.join(cleanup, planName);
  try {
    writeDurableJsonNoClobber(
      cleanup,
      planName,
      plan,
      MAX_RETIREMENT_BYTES,
    );
  } catch {
    const existing = readRetirementPlan(planPath, projectSlug, compensationRef);
    if (existing.integrity !== plan.integrity) {
      throw new AudioCompensationStoreError();
    }
  }
  executeRetirementPlan(cleanup, planPath, plan);
}

function removeTemporaryAliasForCurrent(
  workspace: string,
  current: {
    readonly receipt: ProtectedAudioCompensationReceipt;
    readonly publication?: ProtectedAudioCompensationPublication;
    readonly state: AudioCompensationState;
  },
): "completed" | "not-required" | "failed" {
  if (
    current.state.status !== "completed" ||
    current.state.outcome !== "registry-owned" ||
    !current.publication
  ) {
    return "failed";
  }
  const temporaryPath = path.join(workspace, "temporary.wav");
  if (!fs.existsSync(temporaryPath)) return "not-required";
  return unlinkExactFile(
      temporaryPath,
      current.receipt.device,
      current.receipt.inode,
      current.receipt.byteLength,
      current.receipt.sha256,
    )
    ? "completed"
    : "failed";
}

function resumeTerminalRetirements(
  context: RuntimeStorageContext,
  projectSlug: string,
): { readonly removed: number; readonly failed: number } {
  const cleanup = cleanupRootIfPresent(context, projectSlug);
  if (!cleanup) return { removed: 0, failed: 0 };
  let removed = 0;
  let failed = 0;
  for (const entry of fs.readdirSync(cleanup).sort()) {
    const compensationRef = parseRetirementFileName(entry);
    if (!compensationRef) continue;
    const planPath = path.join(cleanup, entry);
    try {
      const plan = readRetirementPlan(planPath, projectSlug, compensationRef);
      executeRetirementPlan(cleanup, planPath, plan);
      removed += 1;
    } catch {
      failed += 1;
    }
  }
  return { removed, failed };
}

function buildRetirementPlan(
  cleanup: string,
  workspace: string,
  receipt: ProtectedAudioCompensationReceipt,
  terminalOutcome: AudioCompensationState["outcome"],
): AudioCompensationRetirementPlan {
  if (terminalOutcome !== "compensated" && terminalOutcome !== "registry-owned") {
    throw new AudioCompensationStoreError();
  }
  const workspaceStat = fs.lstatSync(workspace);
  if (!workspaceStat.isDirectory() || workspaceStat.isSymbolicLink()) {
    throw new AudioCompensationStoreError();
  }
  const rootEntries = fs.readdirSync(workspace).sort();
  const allowedRoot = new Set([
    WORKSPACE_FILE,
    JOURNAL_STAGING_DIRECTORY,
    "temporary.wav",
    PUBLICATION_STAGING_FILE,
    "quarantine",
    "record",
    RECORD_CLAIM_FILE,
  ]);
  if (rootEntries.some((entry) => !allowedRoot.has(entry))) {
    throw new AudioCompensationStoreError();
  }
  const directories: Array<{ relativePath: string; device: number; inode: number }> = [];
  const files: Array<{
    relativePath: string;
    device: number;
    inode: number;
    byteLength: number;
    sha256: string;
  }> = [];
  const addDirectory = (relativePath: string) => {
    const candidate = path.join(workspace, relativePath);
    const stat = fs.lstatSync(candidate);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new AudioCompensationStoreError();
    }
    directories.push({ relativePath, device: stat.dev, inode: stat.ino });
  };
  const addFile = (relativePath: string) => {
    const candidate = path.join(workspace, relativePath);
    const stat = fs.lstatSync(candidate);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new AudioCompensationStoreError();
    }
    const bytes = fs.readFileSync(candidate);
    if (bytes.length !== stat.size) throw new AudioCompensationStoreError();
    files.push({
      relativePath,
      device: stat.dev,
      inode: stat.ino,
      byteLength: stat.size,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  };
  addFile(WORKSPACE_FILE);
  if (rootEntries.includes(JOURNAL_STAGING_DIRECTORY)) {
    addDirectory(JOURNAL_STAGING_DIRECTORY);
    for (const entry of fs.readdirSync(
      path.join(workspace, JOURNAL_STAGING_DIRECTORY),
    ).sort()) {
      addFile(path.join(JOURNAL_STAGING_DIRECTORY, entry));
    }
  }
  if (rootEntries.includes("temporary.wav")) addFile("temporary.wav");
  if (rootEntries.includes(PUBLICATION_STAGING_FILE)) {
    addFile(PUBLICATION_STAGING_FILE);
  }
  if (rootEntries.includes(RECORD_CLAIM_FILE)) addFile(RECORD_CLAIM_FILE);
  if (!rootEntries.includes("record") || !rootEntries.includes("quarantine")) {
    throw new AudioCompensationStoreError();
  }
  addDirectory("record");
  addDirectory("quarantine");
  const recordEntries = fs.readdirSync(path.join(workspace, "record")).sort();
  if (
    !recordEntries.includes(RECEIPT_FILE) ||
    recordEntries.some((entry) =>
      entry !== RECEIPT_FILE &&
      entry !== PUBLICATION_RESERVATION_FILE &&
      entry !== PUBLICATION_FILE &&
      entry !== JOURNAL_STAGING_DIRECTORY &&
      entry !== "tombstone" &&
      !/^state-[0-9]{6}\.json$/.test(entry)
    )
  ) {
    throw new AudioCompensationStoreError();
  }
  for (const entry of recordEntries) {
    if (entry === JOURNAL_STAGING_DIRECTORY) {
      addDirectory(path.join("record", JOURNAL_STAGING_DIRECTORY));
      for (const stagingEntry of fs.readdirSync(
        path.join(workspace, "record", JOURNAL_STAGING_DIRECTORY),
      ).sort()) {
        addFile(path.join(
          "record",
          JOURNAL_STAGING_DIRECTORY,
          stagingEntry,
        ));
      }
      continue;
    }
    addFile(path.join("record", entry));
  }
  const quarantineEntries = fs.readdirSync(path.join(workspace, "quarantine")).sort();
  if (quarantineEntries.some((entry) => entry !== "owned.wav")) {
    throw new AudioCompensationStoreError();
  }
  if (quarantineEntries.includes("owned.wav")) {
    addFile(path.join("quarantine", "owned.wav"));
  }
  const body = {
    schemaVersion: RETIREMENT_SCHEMA_VERSION,
    compensationRef: receipt.compensationRef,
    projectSlug: receipt.projectSlug,
    workspaceDevice: workspaceStat.dev,
    workspaceInode: workspaceStat.ino,
    receiptIntegrity: receipt.integrity,
    terminalOutcome,
    physicalCleanupCapability: "unsupported-pathname-only" as const,
    directories: directories.sort((left, right) =>
      left.relativePath.localeCompare(right.relativePath)
    ),
    files: files.sort((left, right) =>
      left.relativePath.localeCompare(right.relativePath)
    ),
  } as const;
  void cleanup;
  return Object.freeze({ ...body, integrity: digest(body) });
}

function executeRetirementPlan(
  cleanup: string,
  planPath: string,
  plan: AudioCompensationRetirementPlan,
): void {
  const workspace = path.join(cleanup, plan.compensationRef);
  const workspaceStat = fs.lstatSync(workspace);
  if (
    !workspaceStat.isDirectory() ||
    workspaceStat.isSymbolicLink() ||
    workspaceStat.dev !== plan.workspaceDevice ||
    workspaceStat.ino !== plan.workspaceInode
  ) {
    throw new AudioCompensationStoreError();
  }
  const verified = readRetirementPlan(
    planPath,
    plan.projectSlug,
    plan.compensationRef,
  );
  if (verified.integrity !== plan.integrity) {
    throw new AudioCompensationStoreError();
  }
  // Portable Node APIs cannot bind unlink/rmdir to this verified directory
  // identity. The durable plan is therefore the physical-cleanup capability
  // fallback and makes retirement logical, idempotent, and foreign-preserving.
}

function readRetirementPlan(
  planPath: string,
  projectSlug: string,
  compensationRef: string,
): AudioCompensationRetirementPlan {
  const value = readJsonFile(planPath, MAX_RETIREMENT_BYTES);
  if (!record(value)) throw new AudioCompensationStoreError();
  const { integrity, ...body } = value;
  if (
    value.schemaVersion !== RETIREMENT_SCHEMA_VERSION ||
    value.compensationRef !== compensationRef ||
    value.projectSlug !== projectSlug ||
    !identityInteger(value.workspaceDevice) ||
    !identityInteger(value.workspaceInode) ||
    typeof value.receiptIntegrity !== "string" ||
    !/^[0-9a-f]{64}$/.test(value.receiptIntegrity) ||
    (value.terminalOutcome !== "compensated" &&
      value.terminalOutcome !== "registry-owned") ||
    value.physicalCleanupCapability !== "unsupported-pathname-only" ||
    !Array.isArray(value.directories) ||
    !Array.isArray(value.files) ||
    typeof integrity !== "string" ||
    integrity !== digest(body)
  ) {
    throw new AudioCompensationStoreError();
  }
  const plan = value as unknown as AudioCompensationRetirementPlan;
  if (
    plan.directories.length > 4 ||
    plan.files.length > 96 ||
    !plan.directories.every((entry) =>
      [
        "record",
        "quarantine",
        JOURNAL_STAGING_DIRECTORY,
        path.join("record", JOURNAL_STAGING_DIRECTORY),
      ].includes(entry.relativePath) &&
      identityInteger(entry.device) &&
      identityInteger(entry.inode)
    ) ||
    !plan.files.every((entry) =>
      safeRetirementRelativeFile(entry.relativePath) &&
      identityInteger(entry.device) &&
      identityInteger(entry.inode) &&
      safeInteger(entry.byteLength, 0, MAX_AUDIO_BYTES) &&
      /^[0-9a-f]{64}$/.test(entry.sha256)
    )
  ) {
    throw new AudioCompensationStoreError();
  }
  return plan;
}

/**
 * True when `compensationRelativePath` (a path relative to one compensation
 * workspace, e.g. `.audio-journal-staging/workspace.json.<uuid>.partial` or
 * `record/.audio-journal-staging/publication.json.<uuid>.partial`) is a
 * crash-atomic journal staging file. These are always retirement-eligible/
 * ephemeral by this store's own classification (see below); durable
 * compensation records (receipt.json, publication.json, tombstone,
 * publication-staging.wav, ...) never match this pattern.
 */
function isJournalStagingPartial(compensationRelativePath: string): boolean {
  return new RegExp(`^${JOURNAL_STAGING_DIRECTORY.replace(".", "\\.")}[\\\\/][a-zA-Z0-9._-]+\\.partial$`)
    .test(compensationRelativePath) ||
    new RegExp(`^record[\\\\/]${JOURNAL_STAGING_DIRECTORY.replace(".", "\\.")}[\\\\/][a-zA-Z0-9._-]+\\.partial$`)
      .test(compensationRelativePath);
}

/**
 * Project-relative variant of `isJournalStagingPartial`, for callers (e.g. the
 * runtime backup inventory walker) that only have a path relative to the
 * project root, not to a specific compensation workspace. Matches
 * `production-execution/audio-compensation-cleanup/<ref>/.audio-journal-staging/<name>.partial`
 * and its `record/.audio-journal-staging/` variant.
 */
export function isAudioCompensationJournalStagingPartialAtProjectPath(
  projectRelativePath: string,
): boolean {
  const segments = projectRelativePath.split("/");
  const cleanupIndex = segments.findIndex(
    (segment, index) =>
      segment === CLEANUP_DIRECTORY && segments[index - 1] === "production-execution",
  );
  if (cleanupIndex === -1 || segments.length <= cleanupIndex + 2) return false;
  return isJournalStagingPartial(segments.slice(cleanupIndex + 2).join("/"));
}

function safeRetirementRelativeFile(value: string): boolean {
  return value === WORKSPACE_FILE ||
    value === "temporary.wav" ||
    value === PUBLICATION_STAGING_FILE ||
    value === RECORD_CLAIM_FILE ||
    value === path.join("record", RECEIPT_FILE) ||
    value === path.join("record", PUBLICATION_RESERVATION_FILE) ||
    value === path.join("record", PUBLICATION_FILE) ||
    value === path.join("record", "tombstone") ||
    isJournalStagingPartial(value) ||
    /^record[\\/]state-[0-9]{6}\.json$/.test(value) ||
    value === path.join("quarantine", "owned.wav");
}

function retirementFileName(compensationRef: string): string {
  return `${RETIREMENT_FILE_PREFIX}${compensationRef}.json`;
}

function parseRetirementFileName(value: string): string | undefined {
  if (!value.startsWith(RETIREMENT_FILE_PREFIX) || !value.endsWith(".json")) {
    return undefined;
  }
  const compensationRef = value.slice(
    RETIREMENT_FILE_PREFIX.length,
    -".json".length,
  );
  return isSafeAudioCompensationRef(compensationRef)
    ? compensationRef
    : undefined;
}

function resumeDetachedCompletedRecords(
  context: RuntimeStorageContext,
  projectSlug: string,
): {
  readonly removed: 0;
  readonly failed: number;
  readonly deferred: number;
  readonly saturated: boolean;
} {
  const cleanup = cleanupRootIfPresent(context, projectSlug);
  if (!cleanup) {
    return { removed: 0, failed: 0, deferred: 0, saturated: false };
  }
  const entries: string[] = [];
  let observationSaturated = false;
  let directory: fs.Dir | undefined;
  try {
    directory = fs.opendirSync(cleanup);
    while (entries.length <= MAX_DEFERRED_BACKLOG_OBSERVATIONS) {
      const entry = directory.readSync();
      if (!entry) break;
      if (parseRetirementFileName(entry.name)) continue;
      if (entry.name === JOURNAL_STAGING_DIRECTORY || entry.name === REBIND_DIRECTORY) continue;
      if (
        isSafeAudioCompensationRef(entry.name) &&
        isLogicallyRetired(cleanup, projectSlug, entry.name)
      ) continue;
      if (!isSafeAudioCompensationRef(entry.name)) {
        throw new AudioCompensationStoreError();
      }
      entries.push(entry.name);
    }
    observationSaturated = entries.length > MAX_DEFERRED_BACKLOG_OBSERVATIONS;
  } catch (error) {
    if (error instanceof AudioCompensationStoreError) throw error;
    throw new AudioCompensationStoreError();
  } finally {
    try {
      directory?.closeSync();
    } catch {
      // A read-only backlog observation close failure stays fail-closed.
    }
  }
  let failed = 0;
  const observed = entries
    .slice(0, MAX_DEFERRED_BACKLOG_OBSERVATIONS)
    .sort();
  for (const compensationRef of observed) {
    try {
      const workspace = requireDeferredWorkspace(
        context,
        projectSlug,
        compensationRef,
      );
      const recordDirectory = path.join(workspace, "record");
      if (!fs.existsSync(recordDirectory)) continue;
      readAudioCompensationReceiptFromDirectory(
        requireContainedRealDirectory(workspace, recordDirectory),
        projectSlug,
        compensationRef,
      );
    } catch {
      failed += 1;
    }
  }
  const inventory = inspectDeferredBacklog(context, projectSlug);
  return {
    removed: 0,
    failed,
    deferred: observed.length,
    saturated: !inventory.acceptingWrites || observationSaturated,
  };
}

function readAudioCompensationReceiptForRetention(
  context: RuntimeStorageContext,
  projectSlug: string,
  compensationRef: string,
): {
  readonly receipt: ProtectedAudioCompensationReceipt;
  readonly publicationReservation?: ProtectedAudioCompensationPublicationReservation;
  readonly publication?: ProtectedAudioCompensationPublication;
  readonly state: AudioCompensationState;
} {
  const recordDirectory = requireRecordDirectory(
    context,
    projectSlug,
    compensationRef,
  );
  return readAudioCompensationReceiptFromDirectory(
    recordDirectory,
    projectSlug,
    compensationRef,
  );
}

function readAudioCompensationReceiptFromDirectory(
  recordDirectory: string,
  projectSlug: string,
  compensationRef: string,
): {
  readonly receipt: ProtectedAudioCompensationReceipt;
  readonly publication?: ProtectedAudioCompensationPublication;
  readonly state: AudioCompensationState;
} {
  const entries = fs.readdirSync(recordDirectory).sort();
  if (
    !entries.includes(RECEIPT_FILE) ||
    entries.some((entry) =>
      entry !== RECEIPT_FILE &&
      entry !== PUBLICATION_RESERVATION_FILE &&
      entry !== PUBLICATION_FILE &&
      entry !== JOURNAL_STAGING_DIRECTORY &&
      entry !== "tombstone" &&
      !/^state-[0-9]{6}\.json$/.test(entry)
    )
  ) {
    throw new AudioCompensationStoreError();
  }
  const receipt = readJsonFile(
    path.join(recordDirectory, RECEIPT_FILE),
    MAX_RECEIPT_BYTES,
  );
  if (!validateReceipt(receipt, projectSlug, compensationRef)) {
    throw new AudioCompensationStoreError();
  }
  const states = entries
    .filter((entry) => /^state-[0-9]{6}\.json$/.test(entry))
    .map((entry) =>
      readJsonFile(path.join(recordDirectory, entry), MAX_STATE_BYTES)
    );
  if (
    states.length === 0 ||
    !states.every((state, index) =>
      validateState(
        state,
        receipt,
        index + 1,
        index > 0 ? states[index - 1] : undefined,
      )
    )
  ) {
    throw new AudioCompensationStoreError();
  }
  const publicationReservation = readOptionalPublicationReservation(
    recordDirectory,
    entries,
    receipt,
  ).publicationReservation;
  const publication = readOptionalPublication(
    recordDirectory,
    entries,
    receipt,
  ).publication;
  requireExactPublicationAuthority(receipt, publicationReservation, publication);
  return {
    receipt,
    ...(publicationReservation ? { publicationReservation } : {}),
    ...(publication ? { publication } : {}),
    state: states[states.length - 1] as AudioCompensationState,
  };
}

function writeState(
  context: RuntimeStorageContext,
  projectSlug: string,
  receipt: ProtectedAudioCompensationReceipt,
  transition: {
    status: AudioCompensationLifecycleStatus;
    outcome: AudioCompensationState["outcome"];
  },
  authority: RuntimeStorageAuthorityLease,
): AudioCompensationState {
  assertProjectWriteAuthorityLease(authority, projectSlug, context);
  const recordDirectory = requireRecordDirectory(
    context,
    projectSlug,
    receipt.compensationRef,
  );
  const stateEntries = fs.readdirSync(recordDirectory)
    .filter((entry) => /^state-[0-9]{6}\.json$/.test(entry));
  const sequence = stateEntries.length + 1;
  if (!Number.isSafeInteger(sequence) || sequence > MAX_STATE_ENTRIES) {
    throw new AudioCompensationStoreError();
  }
  const body = {
    schemaVersion: STATE_SCHEMA_VERSION,
    compensationRef: receipt.compensationRef,
    sequence,
    status: transition.status,
    outcome: transition.outcome,
    updatedAt: new Date().toISOString(),
  } as const;
  const state = Object.freeze({ ...body, integrity: digest(body) });
  try {
    writeDurableJsonNoClobber(
      recordDirectory,
      `state-${String(sequence).padStart(6, "0")}.json`,
      state,
      MAX_STATE_BYTES,
    );
  } catch (error) {
    deferRecordDirectory(
      context,
      projectSlug,
      receipt.compensationRef,
      recordDirectory,
      authority,
    );
    throw error;
  }
  return state;
}

function createRecordDirectory(
  context: RuntimeStorageContext,
  projectSlug: string,
  compensationRef: string,
  workspace: AudioCompensationWorkspace,
  authority: RuntimeStorageAuthorityLease,
): string {
  assertProjectWriteAuthorityLease(authority, projectSlug, context);
  const root = requireDeferredWorkspace(context, projectSlug, compensationRef);
  requireTrustedWorkspace(
    workspace,
    context,
    projectSlug,
    requireActiveProductionRuntimeOperationContext(),
  );
  const recordDirectory = path.join(root, "record");
  try {
    fs.mkdirSync(recordDirectory, { mode: 0o700 });
  } catch {
    throw new AudioCompensationStoreError();
  }
  try {
    return requireContainedRealDirectory(root, recordDirectory);
  } catch {
    deferRecordDirectory(
      context,
      projectSlug,
      compensationRef,
      recordDirectory,
      authority,
    );
    throw new AudioCompensationStoreError();
  }
}

function requireRecordDirectory(
  context: RuntimeStorageContext,
  projectSlug: string,
  compensationRef: string,
): string {
  const root = receiptRootIfPresent(context, projectSlug);
  try {
    if (root) {
      return requireContainedRealDirectory(root, path.join(root, compensationRef));
    }
  } catch {
    // A detached terminal record may be awaiting cleanup or safe recovery.
  }
  const cleanup = cleanupRootIfPresent(context, projectSlug);
  try {
    if (cleanup) {
      const workspace = requireDeferredWorkspace(
        context,
        projectSlug,
        compensationRef,
      );
      return requireContainedRealDirectory(
        workspace,
        path.join(workspace, "record"),
      );
    }
  } catch {
    // Normalize all protected record lookup failures.
  }
  throw new AudioCompensationStoreError();
}

function receiptRoot(
  context: RuntimeStorageContext,
  projectSlug: string,
): string {
  requireProjectSlug(projectSlug);
  try {
    const root = resolveRuntimeLogicalPath(
      receiptLogicalRoot(projectSlug),
      context,
    );
    return requireContainedRealDirectory(context.projectsRoot, root);
  } catch {
    throw new AudioCompensationStoreError();
  }
}

function receiptLogicalRoot(projectSlug: string): string {
  return `data/projects/${projectSlug}/production-execution/audio-compensation`;
}

function cleanupLogicalRoot(projectSlug: string): string {
  return `data/projects/${projectSlug}/production-execution/${CLEANUP_DIRECTORY}`;
}

function ensureCleanupRoot(
  context: RuntimeStorageContext,
  projectSlug: string,
): string {
  requireProjectSlug(projectSlug);
  const root = resolveRuntimeLogicalPathForWrite(
    cleanupLogicalRoot(projectSlug),
    context,
  );
  try {
    return ensureSafeContainedDirectory(context.projectsRoot, root);
  } catch {
    throw new AudioCompensationStoreError();
  }
}

function cleanupRoot(
  context: RuntimeStorageContext,
  projectSlug: string,
): string {
  requireProjectSlug(projectSlug);
  try {
    const root = resolveRuntimeLogicalPath(
      cleanupLogicalRoot(projectSlug),
      context,
    );
    return requireContainedRealDirectory(context.projectsRoot, root);
  } catch {
    throw new AudioCompensationStoreError();
  }
}

function receiptRootIfPresent(
  context: RuntimeStorageContext,
  projectSlug: string,
): string | undefined {
  try {
    return receiptRoot(context, projectSlug);
  } catch {
    return undefined;
  }
}

function cleanupRootIfPresent(
  context: RuntimeStorageContext,
  projectSlug: string,
): string | undefined {
  try {
    return cleanupRoot(context, projectSlug);
  } catch {
    return undefined;
  }
}

function countRecordDirectories(root: string | undefined): number {
  if (!root) return 0;
  const entries = fs.readdirSync(root);
  if (entries.some((entry) => !isSafeAudioCompensationRef(entry))) {
    throw new AudioCompensationStoreError();
  }
  return entries.length;
}

function samePath(left: string, right: string): boolean {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function writeDurableJsonNoClobber(
  directory: string,
  fileName: string,
  value: unknown,
  maximumBytes: number,
): void {
  if (!SAFE_FILE_NAME.test(fileName)) throw new AudioCompensationStoreError();
  const bytes = Buffer.from(JSON.stringify(value), "utf8");
  if (bytes.length <= 0 || bytes.length > maximumBytes) {
    throw new AudioCompensationStoreError();
  }
  const finalPath = path.join(directory, fileName);
  const stagingDirectory = path.join(directory, JOURNAL_STAGING_DIRECTORY);
  try {
    fs.mkdirSync(stagingDirectory, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code !== "EEXIST") {
      throw new AudioCompensationStoreError();
    }
  }
  const stagingStat = fs.lstatSync(stagingDirectory);
  if (!stagingStat.isDirectory() || stagingStat.isSymbolicLink()) {
    throw new AudioCompensationStoreError();
  }
  const temporaryPath = path.join(
    stagingDirectory,
    `${fileName}.${randomUUID()}.partial`,
  );
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(temporaryPath, "wx+", 0o600);
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile() || !identityInteger(opened.dev) || !identityInteger(opened.ino)) {
      throw new AudioCompensationStoreError();
    }
    let offset = 0;
    while (offset < bytes.length) {
      const written = fs.writeSync(
        descriptor,
        bytes,
        offset,
        bytes.length - offset,
        offset,
      );
      if (!Number.isSafeInteger(written) || written <= 0) {
        throw new AudioCompensationStoreError();
      }
      offset += written;
    }
    fs.fsyncSync(descriptor);
    const readback = Buffer.alloc(bytes.length);
    let readOffset = 0;
    while (readOffset < readback.length) {
      const read = fs.readSync(
        descriptor,
        readback,
        readOffset,
        readback.length - readOffset,
        readOffset,
      );
      if (!Number.isSafeInteger(read) || read <= 0) {
        throw new AudioCompensationStoreError();
      }
      readOffset += read;
    }
    const verified = fs.fstatSync(descriptor);
    if (
      verified.dev !== opened.dev ||
      verified.ino !== opened.ino ||
      verified.size !== bytes.length ||
      !readback.equals(bytes)
    ) {
      throw new AudioCompensationStoreError();
    }
    fs.linkSync(temporaryPath, finalPath);
    const published = fs.lstatSync(finalPath);
    if (
      !published.isFile() ||
      published.isSymbolicLink() ||
      published.dev !== opened.dev ||
      published.ino !== opened.ino ||
      published.size !== bytes.length
    ) {
      throw new AudioCompensationStoreError();
    }
    fs.closeSync(descriptor);
    descriptor = undefined;
    syncDirectoryEntry(directory);
  } catch {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor);
      } catch {
        // The record remains fail-closed.
      }
    }
    throw new AudioCompensationStoreError();
  }
}

function syncDirectoryEntry(directory: string): void {
  if (process.platform === "win32") {
    // Node cannot open directory handles for fsync on Windows. The fully
    // fsynced file is published with a same-volume no-clobber hard link.
    return;
  }
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(directory, "r");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
  } catch {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor);
      } catch {
        // Preserve the durability failure.
      }
    }
    throw new AudioCompensationStoreError();
  }
}

function readJsonFile(filePath: string, maximumBytes: number): unknown {
  try {
    const link = fs.lstatSync(filePath);
    if (
      link.isSymbolicLink() ||
      !link.isFile() ||
      link.size <= 0 ||
      link.size > maximumBytes
    ) {
      throw new Error("invalid");
    }
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    throw new AudioCompensationStoreError();
  }
}

function readOptionalPublication(
  recordDirectory: string,
  entries: readonly string[],
  receipt: ProtectedAudioCompensationReceipt,
): { readonly publication?: ProtectedAudioCompensationPublication } {
  if (!entries.includes(PUBLICATION_FILE)) return {};
  const publication = readJsonFile(
    path.join(recordDirectory, PUBLICATION_FILE),
    MAX_PUBLICATION_BYTES,
  );
  if (!validatePublication(publication, receipt)) {
    throw new AudioCompensationStoreError();
  }
  return { publication };
}

function readOptionalPublicationReservation(
  recordDirectory: string,
  entries: readonly string[],
  receipt: ProtectedAudioCompensationReceipt,
): {
  readonly publicationReservation?:
    ProtectedAudioCompensationPublicationReservation;
} {
  if (!entries.includes(PUBLICATION_RESERVATION_FILE)) return {};
  const reservation = readJsonFile(
    path.join(recordDirectory, PUBLICATION_RESERVATION_FILE),
    MAX_PUBLICATION_BYTES,
  );
  if (!validatePublicationReservation(reservation, receipt)) {
    throw new AudioCompensationStoreError();
  }
  return { publicationReservation: reservation };
}

function validatePublicationReservation(
  value: unknown,
  receipt: ProtectedAudioCompensationReceipt,
): value is ProtectedAudioCompensationPublicationReservation {
  if (!record(value)) return false;
  const { integrity, ...body } = value;
  return Object.keys(value).length === 14 &&
    (value.schemaVersion === PUBLICATION_RESERVATION_SCHEMA_VERSION ||
      value.schemaVersion === LEGACY_PUBLICATION_RESERVATION_SCHEMA_VERSION_V1) &&
    value.compensationRef === receipt.compensationRef &&
    value.projectSlug === receipt.projectSlug &&
    value.operationId === receipt.operationId &&
    value.operationBindingFingerprint === receipt.operationBindingFingerprint &&
    value.canonicalFileName === receipt.canonicalFileName &&
    (value.stagingFileName === "temporary.wav" ||
      value.stagingFileName === PUBLICATION_STAGING_FILE) &&
    (value.mode === "hard-link" || value.mode === "exclusive-copy") &&
    value.byteLength === receipt.byteLength &&
    value.sha256 === receipt.sha256 &&
    identityInteger(value.device) &&
    identityInteger(value.inode) &&
    value.receiptIntegrity === receipt.integrity &&
    typeof integrity === "string" &&
    integrity === digest(body);
}

function validatePublication(
  value: unknown,
  receipt: ProtectedAudioCompensationReceipt,
): value is ProtectedAudioCompensationPublication {
  if (!record(value)) return false;
  const { integrity, ...body } = value;
  return Object.keys(value).length === 16 &&
    value.schemaVersion === PUBLICATION_SCHEMA_VERSION &&
    value.compensationRef === receipt.compensationRef &&
    value.projectSlug === receipt.projectSlug &&
    value.operationId === receipt.operationId &&
    value.operationBindingFingerprint === receipt.operationBindingFingerprint &&
    value.canonicalFileName === receipt.canonicalFileName &&
    (value.stagingFileName === "temporary.wav" ||
      value.stagingFileName === PUBLICATION_STAGING_FILE) &&
    (value.mode === "hard-link" || value.mode === "exclusive-copy") &&
    value.byteLength === receipt.byteLength &&
    value.sha256 === receipt.sha256 &&
    identityInteger(value.device) &&
    identityInteger(value.inode) &&
    value.receiptIntegrity === receipt.integrity &&
    typeof value.reservationIntegrity === "string" &&
    /^[0-9a-f]{64}$/.test(value.reservationIntegrity) &&
    validDate(value.publishedAt) &&
    typeof integrity === "string" &&
    integrity === digest(body);
}

function requireExactPublicationAuthority(
  receipt: ProtectedAudioCompensationReceipt,
  reservation: ProtectedAudioCompensationPublicationReservation | undefined,
  publication: ProtectedAudioCompensationPublication | undefined,
): void {
  if (reservation) {
    if (
      reservation.stagingFileName !== PUBLICATION_STAGING_FILE ||
      (reservation.mode === "hard-link" &&
        (reservation.device !== receipt.device ||
          reservation.inode !== receipt.inode))
    ) {
      throw new AudioCompensationStoreError();
    }
  }
  if (!publication) return;
  if (
    !reservation ||
    publication.operationId !== reservation.operationId ||
    publication.operationBindingFingerprint !==
      reservation.operationBindingFingerprint ||
    publication.canonicalFileName !== reservation.canonicalFileName ||
    publication.stagingFileName !== reservation.stagingFileName ||
    publication.mode !== reservation.mode ||
    publication.byteLength !== reservation.byteLength ||
    publication.sha256 !== reservation.sha256 ||
    publication.device !== reservation.device ||
    publication.inode !== reservation.inode ||
    publication.receiptIntegrity !== receipt.integrity ||
    publication.reservationIntegrity !== reservation.integrity
  ) {
    throw new AudioCompensationStoreError();
  }
}

function validateReceipt(
  value: unknown,
  projectSlug: string,
  compensationRef: string,
  operation?: ProductionRuntimeOperationContext,
): value is ProtectedAudioCompensationReceipt {
  if (!record(value)) return false;
  const { integrity, ...body } = value;
  return Object.keys(value).length === 13 &&
    value.schemaVersion === RECEIPT_SCHEMA_VERSION &&
    value.compensationRef === compensationRef &&
    value.projectSlug === projectSlug &&
    typeof value.operationId === "string" &&
    value.operationId.length > 0 &&
    value.operationId.length <= 160 &&
    typeof value.operationBindingFingerprint === "string" &&
    /^[0-9a-f]{64}$/.test(value.operationBindingFingerprint) &&
    (!operation ||
      (value.operationId === operation.operationId &&
        value.operationBindingFingerprint === operation.bindingFingerprint)) &&
    typeof value.canonicalFileName === "string" &&
    SAFE_FILE_NAME.test(value.canonicalFileName) &&
    typeof value.quarantineDirectoryName === "string" &&
    SAFE_QUARANTINE_DIRECTORY.test(value.quarantineDirectoryName) &&
    safeInteger(value.byteLength, 1, MAX_AUDIO_BYTES) &&
    typeof value.sha256 === "string" &&
    /^[0-9a-f]{64}$/.test(value.sha256) &&
    identityInteger(value.device) &&
    identityInteger(value.inode) &&
    validDate(value.createdAt) &&
    typeof integrity === "string" &&
    integrity === digest(body);
}

function validateState(
  value: unknown,
  receipt: ProtectedAudioCompensationReceipt,
  sequence: number,
  previous: unknown,
): value is AudioCompensationState {
  if (!record(value)) return false;
  const { integrity, ...body } = value;
  const structurallyValid = Object.keys(value).length === 7 &&
    value.schemaVersion === STATE_SCHEMA_VERSION &&
    value.compensationRef === receipt.compensationRef &&
    value.sequence === sequence &&
    ["pending", "in-progress", "failed-retryable", "completed"].includes(
      value.status as string,
    ) &&
    [
      "awaiting-registry",
      "compensation-running",
      "quarantine-delete-intent",
      "compensation-retryable",
      "compensated",
      "registry-owned",
    ].includes(value.outcome as string) &&
    validDate(value.updatedAt) &&
    typeof integrity === "string" &&
    integrity === digest(body);
  if (!structurallyValid) return false;
  const status = value.status as AudioCompensationLifecycleStatus;
  const outcome = value.outcome as AudioCompensationState["outcome"];
  if (
    (status === "pending" && outcome !== "awaiting-registry") ||
    (status === "in-progress" &&
      outcome !== "compensation-running" &&
      outcome !== "quarantine-delete-intent") ||
    (status === "failed-retryable" && outcome !== "compensation-retryable") ||
    (status === "completed" &&
      outcome !== "compensated" &&
      outcome !== "registry-owned")
  ) {
    return false;
  }
  if (sequence === 1) {
    return status === "pending" && previous === undefined;
  }
  return record(previous) &&
    typeof previous.status === "string" &&
    previous.status !== "completed" &&
    validTransition(
      previous.status as AudioCompensationLifecycleStatus,
      status,
    );
}

function validTransition(
  from: AudioCompensationLifecycleStatus,
  to: AudioCompensationLifecycleStatus,
): boolean {
  if (to === "completed") return true;
  if (to === "in-progress") {
    return from === "pending" ||
      from === "in-progress" ||
      from === "failed-retryable";
  }
  return to === "failed-retryable" && from === "in-progress";
}

function requireReceiptInput(input: {
  projectSlug: string;
  canonicalFileName: string;
  byteLength: number;
  sha256: string;
  device: number;
  inode: number;
}): void {
  requireProjectSlug(input.projectSlug);
  if (
    !SAFE_FILE_NAME.test(input.canonicalFileName) ||
    !safeInteger(input.byteLength, 1, MAX_AUDIO_BYTES) ||
    !/^[0-9a-f]{64}$/.test(input.sha256) ||
    !identityInteger(input.device) ||
    !identityInteger(input.inode)
  ) {
    throw new AudioCompensationStoreError();
  }
}

function deferRecordDirectory(
  context: RuntimeStorageContext,
  projectSlug: string,
  compensationRef: string,
  directory: string,
  authority: RuntimeStorageAuthorityLease,
): void {
  try {
    finalizeRecordPlacement(
      context,
      projectSlug,
      compensationRef,
      directory,
      authority,
    );
  } catch {
    // The partial receipt-bound record remains deferred and fail-closed.
  }
}

function finalizeRecordPlacement(
  context: RuntimeStorageContext,
  projectSlug: string,
  compensationRef: string,
  directory: string,
  authority: RuntimeStorageAuthorityLease,
): void {
  assertProjectWriteAuthorityLease(authority, projectSlug, context);
  const workspace = requireDeferredWorkspace(
    context,
    projectSlug,
    compensationRef,
  );
  const destination = path.join(workspace, "record");
  if (!samePath(directory, destination)) {
    // Legacy active records are never moved with platform-dependent rename.
    throw new AudioCompensationStoreError();
  }
  const contained = requireContainedRealDirectory(workspace, destination);
  const current = readAudioCompensationReceiptFromDirectory(
    contained,
    projectSlug,
    compensationRef,
  );
  const body = {
    schemaVersion: RECORD_CLAIM_SCHEMA_VERSION,
    compensationRef,
    projectSlug,
    recordIntegrity: current.receipt.integrity,
    terminal:
      current.state.status === "completed"
        ? current.state.outcome
        : "partial",
  } as const;
  const claim = Object.freeze({ ...body, integrity: digest(body) });
  const claimPath = path.join(workspace, RECORD_CLAIM_FILE);
  try {
    writeDurableJsonNoClobber(
      workspace,
      RECORD_CLAIM_FILE,
      claim,
      MAX_RECORD_CLAIM_BYTES,
    );
  } catch {
    const existing = readJsonFile(claimPath, MAX_RECORD_CLAIM_BYTES);
    if (!record(existing)) throw new AudioCompensationStoreError();
    const { integrity, ...existingBody } = existing;
    if (
      Object.keys(existing).length !== 6 ||
      existing.schemaVersion !== RECORD_CLAIM_SCHEMA_VERSION ||
      existing.compensationRef !== compensationRef ||
      existing.projectSlug !== projectSlug ||
      existing.recordIntegrity !== current.receipt.integrity ||
      existing.terminal !== body.terminal ||
      integrity !== digest(existingBody)
    ) {
      throw new AudioCompensationStoreError();
    }
  }
}

function requireTrustedWorkspace(
  workspace: AudioCompensationWorkspace,
  context: RuntimeStorageContext,
  projectSlug: string,
  operation: ProductionRuntimeOperationContext,
): void {
  if (
    !trustedWorkspaces.has(workspace) ||
    workspace.context !== context ||
    workspace.projectSlug !== projectSlug ||
    !isSafeAudioCompensationRef(workspace.compensationRef)
  ) {
    throw new AudioCompensationStoreError();
  }
  const contained = requireDeferredWorkspace(
    context,
    projectSlug,
    workspace.compensationRef,
  );
  const marker = readWorkspaceMarker(
    contained,
    projectSlug,
    workspace.compensationRef,
  );
  if (
    marker.operationId !== operation.operationId ||
    marker.operationBindingFingerprint !== operation.bindingFingerprint ||
    marker.schemaVersion !== WORKSPACE_SCHEMA_VERSION ||
    marker.reservedBytes !== workspace.reservedBytes ||
    !samePath(contained, workspace.directory) ||
    !samePath(
      path.join(contained, "temporary.wav"),
      workspace.temporaryFilePath,
    )
  ) {
    throw new AudioCompensationStoreError();
  }
}

function requireDeferredWorkspace(
  context: RuntimeStorageContext,
  projectSlug: string,
  compensationRef: string,
): string {
  const cleanup = cleanupRoot(context, projectSlug);
  const workspace = requireContainedRealDirectory(
    cleanup,
    path.join(cleanup, compensationRef),
  );
  readWorkspaceMarker(workspace, projectSlug, compensationRef);
  return workspace;
}

function readWorkspaceMarker(
  workspace: string,
  projectSlug: string,
  compensationRef: string,
): AudioCompensationWorkspaceMarker {
  const value = readJsonFile(
    path.join(workspace, WORKSPACE_FILE),
    MAX_WORKSPACE_BYTES,
  );
  if (!record(value)) throw new AudioCompensationStoreError();
  const { integrity, ...body } = value;
  const modern = value.schemaVersion === WORKSPACE_SCHEMA_VERSION;
  if (
    Object.keys(value).length !== (modern ? 8 : 7) ||
    (value.schemaVersion !== WORKSPACE_SCHEMA_VERSION &&
      value.schemaVersion !== LEGACY_WORKSPACE_SCHEMA_VERSION) ||
    value.compensationRef !== compensationRef ||
    value.projectSlug !== projectSlug ||
    typeof value.operationId !== "string" ||
    typeof value.operationBindingFingerprint !== "string" ||
    !validDate(value.createdAt) ||
    (modern &&
      !safeInteger(value.reservedBytes, 1, MAX_DEFERRED_BACKLOG_BYTES)) ||
    typeof integrity !== "string" ||
    integrity !== digest(body)
  ) {
    throw new AudioCompensationStoreError();
  }
  return value as unknown as AudioCompensationWorkspaceMarker;
}

function inspectDeferredBacklog(
  context: RuntimeStorageContext,
  projectSlug: string,
): {
  readonly recordCount: number;
  readonly totalBytes: number;
  readonly failedRecords: number;
  readonly acceptingWrites: boolean;
} {
  const cleanup = cleanupRootIfPresent(context, projectSlug);
  if (!cleanup) {
    return {
      recordCount: 0,
      totalBytes: 0,
      failedRecords: 0,
      acceptingWrites: true,
    };
  }
  let directory: fs.Dir | undefined;
  let recordCount = 0;
  let totalBytes = 0;
  let failedRecords = 0;
  let overflow = false;
  try {
    directory = fs.opendirSync(cleanup);
    while (recordCount <= MAX_DEFERRED_BACKLOG_RECORDS) {
      const entry = directory.readSync();
      if (!entry) break;
      if (parseRetirementFileName(entry.name)) continue;
      if (entry.name === JOURNAL_STAGING_DIRECTORY || entry.name === REBIND_DIRECTORY) continue;
      if (
        isSafeAudioCompensationRef(entry.name) &&
        isLogicallyRetired(cleanup, projectSlug, entry.name)
      ) continue;
      recordCount += 1;
      if (
        !isSafeAudioCompensationRef(entry.name) ||
        !entry.isDirectory() ||
        entry.isSymbolicLink()
      ) {
        failedRecords += 1;
        continue;
      }
      const workspace = path.join(cleanup, entry.name);
      try {
        requireContainedRealDirectory(cleanup, workspace);
        const marker = readWorkspaceMarker(workspace, projectSlug, entry.name);
        const measured = measureDeferredWorkspace(workspace);
        totalBytes = Math.min(
          MAX_DEFERRED_BACKLOG_BYTES,
          totalBytes + Math.max(measured.bytes, marker.reservedBytes ?? 0),
        );
        if (!measured.valid) failedRecords += 1;
        const detachedRecord = path.join(workspace, "record");
        if (fs.existsSync(detachedRecord)) {
          readAudioCompensationReceiptFromDirectory(
            requireContainedRealDirectory(workspace, detachedRecord),
            projectSlug,
            entry.name,
          );
        }
      } catch {
        failedRecords += 1;
      }
    }
    overflow = recordCount > MAX_DEFERRED_BACKLOG_RECORDS;
  } catch {
    failedRecords += 1;
  } finally {
    try {
      directory?.closeSync();
    } catch {
      failedRecords += 1;
    }
  }
  return {
    recordCount,
    totalBytes,
    failedRecords,
    acceptingWrites:
      !overflow &&
      failedRecords === 0 &&
      recordCount < MAX_DEFERRED_BACKLOG_RECORDS &&
      totalBytes < MAX_DEFERRED_BACKLOG_BYTES,
  };
}

function isLogicallyRetired(
  cleanup: string,
  projectSlug: string,
  compensationRef: string,
): boolean {
  const planPath = path.join(cleanup, retirementFileName(compensationRef));
  if (!fs.existsSync(planPath)) return false;
  const plan = readRetirementPlan(planPath, projectSlug, compensationRef);
  const workspace = path.join(cleanup, compensationRef);
  const stat = fs.lstatSync(workspace);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    stat.dev !== plan.workspaceDevice ||
    stat.ino !== plan.workspaceInode
  ) {
    throw new AudioCompensationStoreError();
  }
  return true;
}

function measureDeferredWorkspace(root: string): {
  readonly bytes: number;
  readonly valid: boolean;
} {
  const pending = [{ directory: root, depth: 0 }];
  let visited = 0;
  let bytes = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || current.depth > MAX_DEFERRED_WORKSPACE_DEPTH) {
      return { bytes: MAX_DEFERRED_BACKLOG_BYTES, valid: false };
    }
    let directory: fs.Dir | undefined;
    try {
      directory = fs.opendirSync(current.directory);
      while (true) {
        const entry = directory.readSync();
        if (!entry) break;
        visited += 1;
        if (visited > MAX_DEFERRED_WORKSPACE_ENTRIES) {
          return { bytes: MAX_DEFERRED_BACKLOG_BYTES, valid: false };
        }
        const candidate = path.join(current.directory, entry.name);
        const stat = fs.lstatSync(candidate);
        if (stat.isSymbolicLink()) {
          return { bytes: MAX_DEFERRED_BACKLOG_BYTES, valid: false };
        }
        if (stat.isDirectory()) {
          pending.push({ directory: candidate, depth: current.depth + 1 });
        } else if (stat.isFile()) {
          bytes = Math.min(MAX_DEFERRED_BACKLOG_BYTES, bytes + stat.size);
        } else {
          return { bytes: MAX_DEFERRED_BACKLOG_BYTES, valid: false };
        }
      }
    } catch {
      return { bytes: MAX_DEFERRED_BACKLOG_BYTES, valid: false };
    } finally {
      try {
        directory?.closeSync();
      } catch {
        return { bytes: MAX_DEFERRED_BACKLOG_BYTES, valid: false };
      }
    }
  }
  return { bytes, valid: true };
}

function unlinkExactFile(
  filePath: string,
  device: number,
  inode: number,
  byteLength: number,
  sha256: string,
): boolean {
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(filePath, "r");
    const before = fs.fstatSync(descriptor);
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    if (
      !before.isFile() ||
      before.dev !== device ||
      before.ino !== inode ||
      before.size !== byteLength ||
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      bytes.length !== byteLength ||
      createHash("sha256").update(bytes).digest("hex") !== sha256
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  } finally {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor);
      } catch {
        // Logical cleanup remains fail-closed if the verified handle cannot close.
      }
    }
  }
}

function admissionReservationBytes(byteLength: number): number {
  const reserved =
    byteLength +
    MAX_WORKSPACE_BYTES +
    MAX_RECEIPT_BYTES +
    MAX_STATE_BYTES * MAX_STATE_ENTRIES +
    MAX_RECORD_CLAIM_BYTES;
  if (
    !Number.isSafeInteger(reserved) ||
    reserved <= 0 ||
    reserved > MAX_DEFERRED_BACKLOG_BYTES
  ) {
    throw new AudioCompensationBacklogSaturatedError();
  }
  return reserved;
}

function requireProjectSlug(value: string): void {
  if (!/^[a-zA-Z0-9-_]+$/.test(value)) {
    throw new AudioCompensationStoreError();
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeInteger(
  value: unknown,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): value is number {
  return Number.isSafeInteger(value) &&
    (value as number) >= minimum &&
    (value as number) <= maximum;
}

function identityInteger(value: unknown): value is number {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value > 0;
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
