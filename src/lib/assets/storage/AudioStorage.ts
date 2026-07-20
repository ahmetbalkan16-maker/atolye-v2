import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { AssetManager } from "@/lib/assets/AssetManager";
import type { Asset, ProjectAssets } from "@/types/asset";
import {
  AudioAssetRootError,
  AudioCanonicalAdmissionConflictError,
} from "@/lib/audio/AudioAssetError";
import {
  AudioCompensationBacklogSaturatedError,
  AudioCompensationStoreError,
  assertProtectedAudioCanonicalResolutionAllowed,
  bindProtectedAudioCompensationPublication,
  createProtectedAudioCompensationReceipt,
  getProtectedAudioCompensationPublicationSourcePath,
  isSafeAudioCompensationRef,
  prepareAudioCompensationWorkspace,
  pruneCompletedAudioCompensationRecords,
  readProtectedAudioCompensationReceipt,
  reserveProtectedAudioCompensationPublication,
  removeProtectedAudioTemporaryAlias,
  transitionAudioCompensationState,
  type AudioCompensationWorkspace,
  type ProtectedAudioCompensationReceipt,
  type ProtectedAudioCompensationPublication,
  type ProtectedAudioCanonicalReadIdentity,
} from "@/lib/audio/AudioCompensationStore";
import {
  finalizeReservedFilePortableNoClobber,
  publishFilePortableNoClobber,
  removePublishedFileIfOwned,
  type PortablePublishedFile,
} from "@/lib/runtime/security/PortableNoClobberFilePublisher";
import {
  requireContainedStorageDirectory,
  requireContainedStorageFile,
} from "./StoragePathSecurity";
import {
  acquireProjectWriteAuthority,
  ensureSafeContainedDirectory,
  resolveRuntimeLogicalPath,
  resolveRuntimeLogicalPathForWrite,
  resolveRuntimeStorageContext,
  type RuntimeStorageAuthorityLease,
  type RuntimeStorageContext,
  RuntimeStorageError,
  type RuntimeStorageInput,
} from "@/lib/runtime/RuntimeStoragePaths";

export interface SaveAudioInput {
  projectSlug: string;
  data: ArrayBuffer | Buffer;
  assetId?: string;
  fileName?: string;
}

export interface AudioInspection {
  byteLength: number;
  durationSeconds: number;
}

export interface SavedAudio extends AudioInspection {
  fileName: string;
  filePath: string;
  url: string;
  mimeType: "audio/wav";
}

export type AudioRegistryHandoffResult =
  | {
      readonly status:
        | "registry-owned-confirmed"
        | "registry-ownership-completed";
      readonly projectAssets: ProjectAssets;
    }
  | {
      readonly status: "conflict" | "failed";
    };

export const AUDIO_STORAGE_MAX_BYTES = 256 * 1024 * 1024;
const MAX_AUDIO_DURATION_SECONDS = 4 * 60 * 60;
const MIN_WAV_SAMPLE_RATE = 8_000;
const MAX_WAV_SAMPLE_RATE = 192_000;
const MAX_WAV_CHANNELS = 2;
const PCM_BITS_PER_SAMPLE = new Set([8, 16, 24, 32]);
const FLOAT_BITS_PER_SAMPLE = new Set([32, 64]);
const publicationOwnership = Symbol("audio-publication-ownership");
const trustedPublicationReceipts = new WeakSet<object>();
const AUDIO_AUTHORITY_ATTEMPTS = 500;
const AUDIO_AUTHORITY_WAIT_MS = 10;

export class AudioWavValidationError extends Error {
  constructor() {
    super("Invalid WAV file.");
    this.name = "AudioWavValidationError";
    this.stack = undefined;
  }
}

type AudioPublicationReceipt = {
  readonly context: RuntimeStorageContext;
  readonly projectSlug: string;
  readonly compensationRef: string;
};

type PublicationCarrier = {
  [publicationOwnership]?: AudioPublicationReceipt;
};

type FileIdentity = {
  readonly device: number;
  readonly inode: number;
};

export interface AudioCompensationRecoveryResult {
  readonly status: "completed" | "failed" | "rejected";
  readonly compensated: boolean;
  readonly retryable: boolean;
  readonly compensationRef?: string;
  readonly cleanup?: "completed" | "not-required" | "failed" | "deferred";
}

export class AudioStorage {
  static saveAudio({
    projectSlug,
    data,
    assetId,
    fileName,
  }: SaveAudioInput, input: RuntimeStorageInput = {}): SavedAudio {
    const context = resolveRuntimeStorageContext(input);
    const lease = acquireAudioProjectWriteAuthority(projectSlug, context);
    let ownedTemporaryPath: string | undefined;
    let workspace: AudioCompensationWorkspace | undefined;
    let publishedPath: string | undefined;
    let publishedFile: PortablePublishedFile | undefined;
    let publicationBound = false;
    let temporaryIdentity: FileIdentity | undefined;
    let receipt: AudioPublicationReceipt | undefined;
    let saved: (SavedAudio & PublicationCarrier) | undefined;
    let failure: unknown;
    try {
      const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
      let inspection: AudioInspection;
      try {
        inspection = this.inspectWav(buffer);
      } catch (error) {
        if (!(error instanceof AudioWavValidationError)) throw error;
        throw new AudioAssetRootError("AUDIO_WAV_INVALID", {
          phase: "validation",
        });
      }
      const resolvedFileName = fileName
        ? requireSafeWavFileName(fileName)
        : `${sanitizeFileName(assetId ?? crypto.randomUUID())}.wav`;
      const relativePath = this.getAudioPath(projectSlug, resolvedFileName);
      const absolutePath = resolvePath(relativePath, context, true);
      const directory = path.dirname(absolutePath);

      try {
        ensureSafeContainedDirectory(context.runtimeRoot, context.projectsRoot);
        ensureSafeContainedDirectory(context.projectsRoot, directory);
        requireContainedStorageDirectory(directory, context);
        workspace = prepareAudioCompensationWorkspace({
          authority: lease,
          context,
          projectSlug,
          byteLength: buffer.length,
        });
        ownedTemporaryPath = workspace.temporaryFilePath;
        writeAndSyncOwnedTemporaryFile(
          ownedTemporaryPath,
          buffer,
          (identity) => {
            temporaryIdentity = identity;
          },
        );
        this.inspectWav(fs.readFileSync(ownedTemporaryPath));
        if (!temporaryIdentity) {
          throw new Error("Audio temporary identity is unavailable.");
        }
        const protectedReceipt = createProtectedAudioCompensationReceipt({
          authority: lease,
          context,
          projectSlug,
          workspace,
          canonicalFileName: resolvedFileName,
          byteLength: buffer.length,
          sha256: sha256(buffer),
          device: temporaryIdentity.device,
          inode: temporaryIdentity.inode,
        });
        receipt = Object.freeze({
          context,
          projectSlug,
          compensationRef: protectedReceipt.compensationRef,
        });
        trustedPublicationReceipts.add(receipt);
        publishedFile = publishFilePortableNoClobber({
          sourcePath: ownedTemporaryPath,
          destinationPath: absolutePath,
          expectedByteLength: protectedReceipt.byteLength,
          expectedSha256: protectedReceipt.sha256,
          stagingPath: path.join(workspace.directory, "publication-staging.wav"),
          onDestinationReserved: (publication) => {
            reserveProtectedAudioCompensationPublication({
              authority: lease,
              context,
              projectSlug,
              compensationRef: protectedReceipt.compensationRef,
              ...publication,
            });
          },
        });
        publishedPath = absolutePath;
        bindProtectedAudioCompensationPublication({
          authority: lease,
          context,
          projectSlug,
          compensationRef: protectedReceipt.compensationRef,
          ...publishedFile,
        });
        publicationBound = true;
        const {
          realPath: publishedRealPath,
          stat: publishedStat,
        } = requireContainedStorageFile(directory, absolutePath, context);
        if (
          !publishedStat.isFile() ||
          publishedStat.size !== protectedReceipt.byteLength ||
          publishedStat.dev !== publishedFile.device ||
          publishedStat.ino !== publishedFile.inode ||
          sha256(fs.readFileSync(publishedRealPath)) !== protectedReceipt.sha256
        ) {
          throw new Error("Audio publication identity mismatch.");
        }
      } catch (error) {
        if (publishedPath && publishedFile && receipt && !publicationBound) {
          const removed = removePublishedFileIfOwned(
            publishedPath,
            publishedFile,
          );
          if (removed) {
            completeUnusedReceipt(receipt, lease);
          }
          const publicationFailure = new AudioAssetRootError(
            "AUDIO_STORAGE_WRITE_FAILED",
            {
              phase: "storage",
              cleanup: removed ? "completed" : "deferred",
              compensation: removed ? "completed" : "failed",
              compensationRef: removed ? undefined : receipt.compensationRef,
            },
          );
          if (!removed) attachPublicationOwnership(publicationFailure, receipt);
          throw publicationFailure;
        }
        if (publishedPath && receipt) {
          const compensation = compensateTrustedPublication(receipt, lease)
            ? "completed"
            : "failed";
          const publicationFailure = new AudioAssetRootError(
            "AUDIO_STORAGE_WRITE_FAILED",
            {
              phase: "storage",
              cleanup: "inspection-failed",
              compensation,
              compensationRef: compensation === "failed"
                ? receipt.compensationRef
                : undefined,
            },
          );
          if (compensation === "failed") {
            attachPublicationOwnership(publicationFailure, receipt);
          }
          throw publicationFailure;
        }
        if (receipt) {
          try {
            const current = readProtectedAudioCompensationReceipt(
              projectSlug,
              receipt.compensationRef,
              context,
            );
            if (current.publicationReservation) {
              const publicationFailure = new AudioAssetRootError(
                "AUDIO_STORAGE_WRITE_FAILED",
                {
                  phase: "storage",
                  cleanup: "deferred",
                  compensation: "failed",
                  compensationRef: receipt.compensationRef,
                },
              );
              attachPublicationOwnership(publicationFailure, receipt);
              throw publicationFailure;
            }
          } catch (receiptError) {
            if (receiptError instanceof AudioAssetRootError) throw receiptError;
          }
          completeUnusedReceipt(receipt, lease);
        }
        if (error instanceof AudioAssetRootError) throw error;
        if (error instanceof AudioCompensationBacklogSaturatedError) {
          throw new AudioAssetRootError("AUDIO_STORAGE_WRITE_FAILED", {
            phase: "storage",
            cleanup: "backlog-saturated",
            compensation: "not-required",
          });
        }
        if (error instanceof AudioCompensationStoreError) {
          throw new AudioAssetRootError("AUDIO_STORAGE_WRITE_FAILED", {
            phase: "storage",
            cleanup: "deferred",
            compensation: "not-required",
          });
        }
        throw new AudioAssetRootError("AUDIO_STORAGE_WRITE_FAILED", {
          phase: "storage",
          ...(workspace
            ? {
                cleanup: "deferred" as const,
                compensation: "not-required" as const,
              }
            : {}),
        });
      }

      saved = {
        fileName: resolvedFileName,
        filePath: relativePath,
        url: this.getAudioUrl(projectSlug, resolvedFileName),
        mimeType: "audio/wav",
        ...inspection,
      };
      if (!receipt) {
        throw new AudioAssetRootError("AUDIO_STORAGE_WRITE_FAILED", {
          phase: "storage",
        });
      }
      attachPublicationOwnership(saved, receipt);
    } catch (error) {
      failure = error instanceof AudioAssetRootError
        ? error
        : new AudioAssetRootError("AUDIO_STORAGE_WRITE_FAILED", {
            phase: "storage",
          });
    } finally {
      lease.release();
    }

    if (failure) throw failure;
    if (!saved) {
      throw new AudioAssetRootError("AUDIO_STORAGE_WRITE_FAILED", {
        phase: "storage",
      });
    }
    return saved;
  }

  static transferPublicationOwnership<T extends object>(
    source: unknown,
    target: T,
  ): T {
    const receipt = getTrustedReceipt(source);
    if (!receipt) return target;
    attachPublicationOwnership(target, receipt);
    return target;
  }

  static compensatePublishedAudio(
    value: unknown,
    input?: RuntimeStorageInput,
  ): boolean {
    return this.compensatePublishedAudioResult(value, input).compensated;
  }

  static compensatePublishedAudioResult(
    value: unknown,
    input?: RuntimeStorageInput,
  ): AudioCompensationRecoveryResult {
    const receipt = getTrustedReceipt(value);
    if (!receipt) return recoveryResult("rejected", false, false);
    let context: RuntimeStorageContext;
    try {
      context = resolveRuntimeStorageContext(input ?? receipt.context);
    } catch {
      return recoveryResult(
        "rejected",
        false,
        false,
        receipt.compensationRef,
      );
    }
    if (context !== receipt.context) {
      return recoveryResult(
        "rejected",
        false,
        false,
        receipt.compensationRef,
      );
    }
    const lease = acquireAudioProjectWriteAuthority(receipt.projectSlug, context);
    try {
      return compensateProtectedPublication(
        receipt.projectSlug,
        receipt.compensationRef,
        context,
        lease,
      );
    } finally {
      lease.release();
    }
  }

  static completePublishedAudio(value: unknown): boolean {
    const asset = value as Partial<Asset> | null;
    if (typeof asset?.projectId !== "string") return false;
    const result = this.handoffPublishedAudio(value, asset.projectId);
    return result.status === "registry-owned-confirmed" ||
      result.status === "registry-ownership-completed";
  }

  static handoffPublishedAudio(
    value: unknown,
    projectId: string,
  ): AudioRegistryHandoffResult {
    const receipt = getTrustedReceipt(value);
    if (!receipt || !projectId) return { status: "failed" };
    const expectedAsset = value as Asset;
    let context: RuntimeStorageContext;
    try {
      context = resolveRuntimeStorageContext(receipt.context);
    } catch {
      return { status: "failed" };
    }
    if (context !== receipt.context) return { status: "failed" };
    const lease = acquireAudioProjectWriteAuthority(receipt.projectSlug, context);
    try {
      const current = readProtectedAudioCompensationReceipt(
        receipt.projectSlug,
        receipt.compensationRef,
        context,
      );
      const ownership = registryOwnership(
        receipt.projectSlug,
        current.receipt,
        current.publication,
        context,
        expectedAsset,
      );
      if (ownership.status !== "owned") return { status: "conflict" };
      if (
        current.state.status === "completed" &&
        current.state.outcome === "registry-owned"
      ) {
        if (
          removeProtectedAudioTemporaryAlias(
            receipt.projectSlug,
            receipt.compensationRef,
            lease,
            context,
          ) === "failed"
        ) {
          return { status: "failed" };
        }
        pruneCompletedAudioCompensationRecords(
          receipt.projectSlug,
          lease,
          context,
        );
        return {
          status: "registry-owned-confirmed",
          projectAssets: ownership.projectAssets,
        };
      }
      transitionAudioCompensationState(
        receipt.projectSlug,
        receipt.compensationRef,
        { status: "completed", outcome: "registry-owned" },
        lease,
        context,
      );
      if (
        removeProtectedAudioTemporaryAlias(
          receipt.projectSlug,
          receipt.compensationRef,
          lease,
          context,
        ) === "failed"
      ) {
        return { status: "failed" };
      }
      const confirmed = registryOwnership(
        receipt.projectSlug,
        current.receipt,
        current.publication,
        context,
        expectedAsset,
      );
      if (confirmed.status === "owned") {
        pruneCompletedAudioCompensationRecords(
          receipt.projectSlug,
          lease,
          context,
        );
      }
      return confirmed.status === "owned"
        ? {
            status: "registry-ownership-completed",
            projectAssets: confirmed.projectAssets,
          }
        : { status: "conflict" };
    } catch {
      return { status: "failed" };
    } finally {
      lease.release();
    }
  }

  static isPublishedAudioRegistryOwned(value: unknown): boolean {
    const receipt = getTrustedReceipt(value);
    if (!receipt) return false;
    let context: RuntimeStorageContext;
    try {
      context = resolveRuntimeStorageContext(receipt.context);
    } catch {
      return false;
    }
    if (context !== receipt.context) return false;
    const lease = acquireAudioProjectWriteAuthority(receipt.projectSlug, context);
    try {
      const current = readProtectedAudioCompensationReceipt(
        receipt.projectSlug,
        receipt.compensationRef,
        context,
      );
      return registryOwnership(
        receipt.projectSlug,
        current.receipt,
        current.publication,
        context,
        value as Asset,
      ).status === "owned";
    } catch {
      return false;
    } finally {
      lease.release();
    }
  }

  static getCompensationRef(value: unknown): string | undefined {
    const trusted = getTrustedReceipt(value)?.compensationRef;
    if (trusted) return trusted;
    const candidate = (value as {
      evidence?: { compensationRef?: unknown };
    } | null)?.evidence?.compensationRef;
    return isSafeAudioCompensationRef(candidate) ? candidate : undefined;
  }

  static recoverPublishedAudio(
    projectSlug: string,
    compensationRef: string,
    input: RuntimeStorageInput = {},
  ): AudioCompensationRecoveryResult {
    if (
      !/^[a-zA-Z0-9-_]+$/.test(projectSlug) ||
      !isSafeAudioCompensationRef(compensationRef)
    ) {
      return recoveryResult("rejected", false, false);
    }
    let context: RuntimeStorageContext;
    try {
      context = resolveRuntimeStorageContext(input);
    } catch {
      return recoveryResult("rejected", false, false, compensationRef);
    }
    let lease;
    try {
      lease = acquireAudioProjectWriteAuthority(projectSlug, context);
      return compensateProtectedPublication(
        projectSlug,
        compensationRef,
        context,
        lease,
      );
    } catch {
      return recoveryResult("rejected", false, false, compensationRef);
    } finally {
      lease?.release();
    }
  }

  static getAudioDir(projectSlug: string): string {
    return `data/projects/${requireSafePathSegment(projectSlug)}/assets/audio`;
  }

  static getAudioPath(projectSlug: string, fileName: string): string {
    return `${this.getAudioDir(projectSlug)}/${requireSafeWavFileName(fileName)}`;
  }

  static getAudioUrl(projectSlug: string, fileName: string): string {
    const slug = encodeURIComponent(requireSafePathSegment(projectSlug));
    const audioFileName = encodeURIComponent(requireSafeWavFileName(fileName));

    return `/api/assets/audio/${slug}/${audioFileName}`;
  }

  static inspectStoredWav(
    projectSlug: string,
    filePath: string,
    input: RuntimeStorageInput = {},
  ): AudioInspection {
    try {
      const context = resolveRuntimeStorageContext(input);
      const fileName = path.posix.basename(filePath);
      const expectedPath = this.getAudioPath(projectSlug, fileName);

      if (filePath !== expectedPath) {
        throw new AudioAssetRootError("AUDIO_STORAGE_WRITE_FAILED", {
          phase: "storage",
        });
      }

      const bytes = this.readStoredWav(projectSlug, filePath, context);
      try {
        return this.inspectWav(bytes);
      } catch (error) {
        if (!(error instanceof AudioWavValidationError)) throw error;
        throw new AudioAssetRootError("AUDIO_WAV_INVALID", {
          phase: "validation",
        });
      }
    } catch (error) {
      if (error instanceof AudioAssetRootError) throw error;
      throw new AudioAssetRootError("AUDIO_STORAGE_WRITE_FAILED", {
        phase: "storage",
      });
    }
  }

  static readStoredWav(
    projectSlug: string,
    filePath: string,
    input: RuntimeStorageInput = {},
  ): Buffer {
    try {
      const context = resolveRuntimeStorageContext(input);
      const fileName = path.posix.basename(filePath);
      if (filePath !== this.getAudioPath(projectSlug, fileName)) {
        throw new AudioCompensationStoreError();
      }
      const expectedIdentity = assertProtectedAudioCanonicalResolutionAllowed(
        projectSlug,
        fileName,
        context,
      );
      const absolutePath = resolvePath(filePath, context);
      const storageRoot = resolvePath(this.getAudioDir(projectSlug), context);
      return readCanonicalFileDescriptorBound(
        storageRoot,
        absolutePath,
        context,
        expectedIdentity,
      );
    } catch (error) {
      if (error instanceof AudioCompensationStoreError) {
        throw new AudioCanonicalAdmissionConflictError();
      }
      if (error instanceof AudioAssetRootError) throw error;
      throw new AudioAssetRootError("AUDIO_STORAGE_WRITE_FAILED", {
        phase: "storage",
      });
    }
  }

  static inspectWav(buffer: Buffer): AudioInspection {
    if (buffer.length < 12 || buffer.length > AUDIO_STORAGE_MAX_BYTES) {
      return invalidWav();
    }

    if (
      buffer.toString("ascii", 0, 4) !== "RIFF" ||
      buffer.toString("ascii", 8, 12) !== "WAVE" ||
      buffer.readUInt32LE(4) + 8 !== buffer.length
    ) {
      return invalidWav();
    }

    let offset = 12;
    let byteRate: number | null = null;
    let blockAlign: number | null = null;
    let dataByteLength = 0;
    let hasFormatChunk = false;
    let hasDataChunk = false;

    while (offset + 8 <= buffer.length) {
      const chunkId = buffer.toString("ascii", offset, offset + 4);
      const chunkSize = buffer.readUInt32LE(offset + 4);
      const chunkStart = offset + 8;
      const chunkEnd = chunkStart + chunkSize;

      if (chunkEnd > buffer.length) {
        return invalidWav();
      }

      if (chunkId === "fmt ") {
        if (
          hasFormatChunk ||
          (chunkSize !== 16 &&
            (chunkSize !== 18 ||
              buffer.readUInt16LE(chunkStart + 16) !== 0))
        ) {
          return invalidWav();
        }

        const audioFormat = buffer.readUInt16LE(chunkStart);
        const channels = buffer.readUInt16LE(chunkStart + 2);
        const sampleRate = buffer.readUInt32LE(chunkStart + 4);
        const parsedByteRate = buffer.readUInt32LE(chunkStart + 8);
        const parsedBlockAlign = buffer.readUInt16LE(chunkStart + 12);
        const bitsPerSample = buffer.readUInt16LE(chunkStart + 14);
        const expectedBlockAlign = channels * (bitsPerSample / 8);
        const expectedByteRate = sampleRate * parsedBlockAlign;
        const supportedBitDepth = audioFormat === 1
          ? PCM_BITS_PER_SAMPLE.has(bitsPerSample)
          : FLOAT_BITS_PER_SAMPLE.has(bitsPerSample);

        if (
          (audioFormat !== 1 && audioFormat !== 3) ||
          channels === 0 ||
          channels > MAX_WAV_CHANNELS ||
          sampleRate < MIN_WAV_SAMPLE_RATE ||
          sampleRate > MAX_WAV_SAMPLE_RATE ||
          parsedByteRate === 0 ||
          parsedBlockAlign === 0 ||
          !supportedBitDepth ||
          !Number.isSafeInteger(expectedBlockAlign) ||
          !Number.isSafeInteger(expectedByteRate) ||
          parsedBlockAlign !== expectedBlockAlign ||
          parsedByteRate !== expectedByteRate ||
          expectedByteRate > 0xffff_ffff
        ) {
          return invalidWav();
        }

        byteRate = parsedByteRate;
        blockAlign = parsedBlockAlign;
        hasFormatChunk = true;
      } else if (chunkId === "data") {
        if (!hasFormatChunk || hasDataChunk || chunkSize === 0) {
          return invalidWav();
        }

        dataByteLength = chunkSize;
        hasDataChunk = true;
      }

      offset = chunkEnd + (chunkSize % 2);
    }

    if (
      offset !== buffer.length ||
      !hasFormatChunk ||
      !hasDataChunk ||
      byteRate === null ||
      blockAlign === null ||
      dataByteLength <= 0 ||
      dataByteLength % blockAlign !== 0
    ) {
      return invalidWav();
    }

    const durationSeconds = dataByteLength / byteRate;

    if (
      !Number.isFinite(durationSeconds) ||
      durationSeconds <= 0 ||
      durationSeconds > MAX_AUDIO_DURATION_SECONDS
    ) {
      return invalidWav();
    }

    return {
      byteLength: buffer.length,
      durationSeconds,
    };
  }
}

function writeAndSyncOwnedTemporaryFile(
  filePath: string,
  buffer: Buffer,
  onOwned: (identity: FileIdentity) => void,
): void {
  const descriptor = fs.openSync(filePath, "wx", 0o600);
  let firstError: unknown;
  try {
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile()) {
      throw new Error("Audio temporary file identity is invalid.");
    }
    onOwned({ device: opened.dev, inode: opened.ino });
    let offset = 0;
    while (offset < buffer.length) {
      const written = fs.writeSync(
        descriptor,
        buffer,
        offset,
        buffer.length - offset,
        offset,
      );
      if (!Number.isSafeInteger(written) || written <= 0) {
        throw new Error("Audio temporary write failed.");
      }
      offset += written;
    }
    fs.fsyncSync(descriptor);
  } catch (error) {
    firstError = error;
  }
  try {
    fs.closeSync(descriptor);
  } catch (error) {
    firstError ??= error;
  }
  if (firstError) throw firstError;
}

function getTrustedReceipt(value: unknown): AudioPublicationReceipt | undefined {
  if (!value || typeof value !== "object") return undefined;
  const receipt = (value as PublicationCarrier)[publicationOwnership];
  return receipt && trustedPublicationReceipts.has(receipt)
    ? receipt
    : undefined;
}

function attachPublicationOwnership(
  target: object,
  receipt: AudioPublicationReceipt,
): void {
  Object.defineProperty(target, publicationOwnership, {
    configurable: false,
    enumerable: false,
    value: receipt,
    writable: false,
  });
}

function compensateTrustedPublication(
  receipt: AudioPublicationReceipt,
  authority: RuntimeStorageAuthorityLease,
): boolean {
  return compensateProtectedPublication(
    receipt.projectSlug,
    receipt.compensationRef,
    receipt.context,
    authority,
  ).compensated;
}

function compensateProtectedPublication(
  projectSlug: string,
  compensationRef: string,
  context: RuntimeStorageContext,
  authority: RuntimeStorageAuthorityLease,
): AudioCompensationRecoveryResult {
  let protectedReceipt: ProtectedAudioCompensationReceipt;
  let protectedPublication: ProtectedAudioCompensationPublication;
  try {
    let current = readProtectedAudioCompensationReceipt(
      projectSlug,
      compensationRef,
      context,
    );
    protectedReceipt = current.receipt;
    if (!current.publication) {
      if (!recoverMissingPublicationBinding(current, context, authority)) {
        return recoveryResult("rejected", false, false, compensationRef);
      }
      current = readProtectedAudioCompensationReceipt(
        projectSlug,
        compensationRef,
        context,
      );
      if (!current.publication) {
        return recoveryResult("rejected", false, false, compensationRef);
      }
    }
    protectedPublication = current.publication;
    if (
      current.state.status === "completed" &&
      current.state.outcome === "compensated"
    ) {
      return recoveryResult(
        "completed",
        true,
        false,
        compensationRef,
        cleanupTerminalCompensation(
          protectedReceipt,
          protectedPublication,
          context,
          authority,
        ),
      );
    }
    const ownership = registryOwnership(
      projectSlug,
      protectedReceipt,
      protectedPublication,
      context,
    );
    if (
      current.state.status === "completed" &&
      current.state.outcome === "registry-owned"
    ) {
      if (ownership.status !== "owned") {
        return recoveryResult("failed", false, true, compensationRef);
      }
      const alias = removeProtectedAudioTemporaryAlias(
        projectSlug,
        compensationRef,
        authority,
        context,
      );
      return alias === "failed"
        ? recoveryResult("failed", false, true, compensationRef)
        : recoveryResult("completed", false, false, compensationRef);
    }
    if (ownership.status === "owned") {
      transitionAudioCompensationState(
        projectSlug,
        compensationRef,
        { status: "completed", outcome: "registry-owned" },
        authority,
        context,
      );
      const alias = removeProtectedAudioTemporaryAlias(
        projectSlug,
        compensationRef,
        authority,
        context,
      );
      return alias === "failed"
        ? recoveryResult("failed", false, true, compensationRef)
        : recoveryResult("completed", false, false, compensationRef);
    }
    if (ownership.status === "conflict") {
      return recoveryResult("failed", false, true, compensationRef);
    }
    if (current.state.status === "completed") {
      return current.state.outcome === "compensated"
        ? recoveryResult(
            "completed",
            true,
            false,
            compensationRef,
            cleanupTerminalCompensation(
              protectedReceipt,
              protectedPublication,
              context,
              authority,
            ),
          )
        : recoveryResult("completed", false, false, compensationRef);
    }
    transitionAudioCompensationState(
      projectSlug,
      compensationRef,
      { status: "in-progress", outcome: "compensation-running" },
      authority,
      context,
    );
  } catch {
    return recoveryResult("rejected", false, false, compensationRef);
  }

  try {
    const storageRoot = resolvePath(
      AudioStorage.getAudioDir(projectSlug),
      context,
    );
    const canonicalPath = path.join(
      storageRoot,
      protectedReceipt.canonicalFileName,
    );
    requireContainedStorageDirectory(storageRoot, context);
    readCanonicalFileDescriptorBound(
      storageRoot,
      canonicalPath,
      context,
      protectedPublication,
    );
    // Node has no portable descriptor-bound rename/unlink. The durable state is
    // therefore the authoritative tombstone; the canonical pathname is never
    // destructively mutated after verification and cannot race a foreign swap.
    transitionAudioCompensationState(
      projectSlug,
      compensationRef,
      { status: "completed", outcome: "compensated" },
      authority,
      context,
    );
    const cleanup = cleanupTerminalCompensation(
      protectedReceipt,
      protectedPublication,
      context,
      authority,
    );
    return recoveryResult(
      "completed",
      true,
      false,
      compensationRef,
      cleanup,
    );
  } catch {
    return failCompensation(projectSlug, compensationRef, context, authority);
  }
}

function recoverMissingPublicationBinding(
  current: ReturnType<typeof readProtectedAudioCompensationReceipt>,
  context: RuntimeStorageContext,
  authority: RuntimeStorageAuthorityLease,
): boolean {
  const reservation = current.publicationReservation;
  if (!reservation) return false;
  try {
    const storageRoot = resolvePath(
      AudioStorage.getAudioDir(current.receipt.projectSlug),
      context,
    );
    const canonicalPath = path.join(
      storageRoot,
      current.receipt.canonicalFileName,
    );
    let canonicalMatches = false;
    try {
      readCanonicalFileDescriptorBound(
        storageRoot,
        canonicalPath,
        context,
        reservation,
      );
      canonicalMatches = true;
    } catch {
      canonicalMatches = false;
    }
    if (!canonicalMatches) {
      const sourcePath = getProtectedAudioCompensationPublicationSourcePath(
        current.receipt.projectSlug,
        current.receipt.compensationRef,
        reservation.stagingFileName,
        context,
      );
      finalizeReservedFilePortableNoClobber({
        sourcePath,
        destinationPath: canonicalPath,
        publication: {
          mode: reservation.mode,
          device: reservation.device,
          inode: reservation.inode,
          byteLength: reservation.byteLength,
          sha256: reservation.sha256,
        },
      });
    }
    bindProtectedAudioCompensationPublication({
      authority,
      context,
      projectSlug: current.receipt.projectSlug,
      compensationRef: current.receipt.compensationRef,
      mode: reservation.mode,
      byteLength: reservation.byteLength,
      sha256: reservation.sha256,
      device: reservation.device,
      inode: reservation.inode,
    });
    return true;
  } catch {
    return false;
  }
}

function readCanonicalFileDescriptorBound(
  storageRoot: string,
  canonicalPath: string,
  context: RuntimeStorageContext,
  expectedIdentity?: ProtectedAudioCanonicalReadIdentity,
): Buffer {
  const canonical = requireContainedStorageFile(
    storageRoot,
    canonicalPath,
    context,
  );
  const descriptor = fs.openSync(canonical.realPath, "r");
  try {
    const before = fs.fstatSync(descriptor);
    if (
      !before.isFile() ||
      !reliableFileIdentity(before.dev, before.ino) ||
      before.dev !== canonical.stat.dev ||
      before.ino !== canonical.stat.ino ||
      before.size !== canonical.stat.size
    ) {
      throw new AudioCompensationStoreError();
    }
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor);
    const digest = sha256(bytes);
    if (
      !after.isFile() ||
      !reliableFileIdentity(after.dev, after.ino) ||
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      bytes.length !== before.size ||
      (expectedIdentity &&
        (before.dev !== expectedIdentity.device ||
          before.ino !== expectedIdentity.inode ||
          before.size !== expectedIdentity.byteLength ||
          digest !== expectedIdentity.sha256))
    ) {
      throw new AudioCompensationStoreError();
    }
    return bytes;
  } finally {
    fs.closeSync(descriptor);
  }
}

function reliableFileIdentity(device: number, inode: number): boolean {
  return Number.isFinite(device) &&
    Number.isInteger(device) &&
    device > 0 &&
    Number.isFinite(inode) &&
    Number.isInteger(inode) &&
    inode > 0;
}

function registryOwnership(
  projectSlug: string,
  receipt: ProtectedAudioCompensationReceipt,
  publication: ProtectedAudioCompensationPublication | undefined,
  context: RuntimeStorageContext,
  expectedAsset?: Asset,
):
  | { readonly status: "owned"; readonly projectAssets: ProjectAssets }
  | { readonly status: "absent" | "conflict" } {
  let assets;
  try {
    if (!publication) return { status: "conflict" };
    const projectAssets = AssetManager.getProjectAssets(
      projectSlug,
      expectedAsset?.projectId ?? "",
      context,
    );
    assets = projectAssets.assets;
    const canonicalFilePath =
      `${AudioStorage.getAudioDir(projectSlug)}/${receipt.canonicalFileName}`;
    const candidates = assets.filter((asset) =>
      asset.filePath === canonicalFilePath &&
      (!expectedAsset || asset.id === expectedAsset.id)
    );
    if (candidates.length === 0) return { status: "absent" };
    if (
      candidates.length !== 1 ||
      candidates[0].projectId !== (expectedAsset?.projectId ?? candidates[0].projectId) ||
      candidates[0].type !== "audio" ||
      candidates[0].status !== "generated" ||
      candidates[0].mimeType !== "audio/wav" ||
      candidates[0].byteLength !== receipt.byteLength
    ) {
      return { status: "conflict" };
    }
    const storageRoot = resolvePath(AudioStorage.getAudioDir(projectSlug), context);
    const canonicalPath = path.join(storageRoot, receipt.canonicalFileName);
    const { realPath, stat } = requireContainedStorageFile(
      storageRoot,
      canonicalPath,
      context,
    );
    if (
      !stat.isFile() ||
      stat.size !== receipt.byteLength ||
      stat.dev !== publication.device ||
      stat.ino !== publication.inode
    ) {
      return { status: "conflict" };
    }
    const bytes = fs.readFileSync(realPath);
    return bytes.length === receipt.byteLength &&
        sha256(bytes) === receipt.sha256
      ? { status: "owned", projectAssets }
      : { status: "conflict" };
  } catch {
    return { status: "conflict" };
  }
}

function cleanupTerminalCompensation(
  receipt: ProtectedAudioCompensationReceipt,
  publication: ProtectedAudioCompensationPublication,
  context: RuntimeStorageContext,
  authority: RuntimeStorageAuthorityLease,
): "completed" | "not-required" | "failed" | "deferred" {
  void publication;
  let tombstoneCleanup: "not-required" | "failed" | "deferred" =
    "not-required";
  try {
    const storageRoot = resolvePath(
      AudioStorage.getAudioDir(receipt.projectSlug),
      context,
    );
    const canonicalPath = path.join(storageRoot, receipt.canonicalFileName);
    if (fs.existsSync(canonicalPath)) {
      // The completed state is the authoritative logical tombstone. Physical
      // canonical deletion is unsupported without descriptor-bound unlink.
      tombstoneCleanup = "deferred";
    }
  } catch {
    tombstoneCleanup = "failed";
  }
  try {
    const retention = pruneCompletedAudioCompensationRecords(
      receipt.projectSlug,
      authority,
      context,
    );
    if (retention.failed > 0) return "failed";
  } catch {
    return "failed";
  }
  return tombstoneCleanup;
}

function failCompensation(
  projectSlug: string,
  compensationRef: string,
  context: RuntimeStorageContext,
  authority: RuntimeStorageAuthorityLease,
): AudioCompensationRecoveryResult {
  try {
    transitionAudioCompensationState(
      projectSlug,
      compensationRef,
      { status: "failed-retryable", outcome: "compensation-retryable" },
      authority,
      context,
    );
  } catch {
    // The protected record remains fail-closed and cannot report success.
  }
  return recoveryResult("failed", false, true, compensationRef);
}

function completeUnusedReceipt(
  receipt: AudioPublicationReceipt,
  authority: RuntimeStorageAuthorityLease,
): void {
  try {
    transitionAudioCompensationState(
      receipt.projectSlug,
      receipt.compensationRef,
      { status: "completed", outcome: "compensated" },
      authority,
      receipt.context,
    );
    trustedPublicationReceipts.delete(receipt);
  } catch {
    // No canonical was published; an unreadable record remains fail-closed.
  }
}

function recoveryResult(
  status: AudioCompensationRecoveryResult["status"],
  compensated: boolean,
  retryable: boolean,
  compensationRef?: string,
  cleanup?: AudioCompensationRecoveryResult["cleanup"],
): AudioCompensationRecoveryResult {
  return {
    status,
    compensated,
    retryable,
    ...(isSafeAudioCompensationRef(compensationRef)
      ? { compensationRef }
      : {}),
    ...(cleanup ? { cleanup } : {}),
  };
}

function invalidWav(): never {
  throw new AudioWavValidationError();
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function acquireAudioProjectWriteAuthority(
  projectSlug: string,
  context: RuntimeStorageContext,
): RuntimeStorageAuthorityLease {
  const waitCell = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
  for (let attempt = 0; attempt < AUDIO_AUTHORITY_ATTEMPTS; attempt += 1) {
    try {
      return acquireProjectWriteAuthority(projectSlug, context);
    } catch (error) {
      if (
        !(error instanceof RuntimeStorageError) ||
        error.code !== "RUNTIME_STORAGE_AUTHORITY_LOCKED"
      ) {
        throw error;
      }
      Atomics.wait(waitCell, 0, 0, AUDIO_AUTHORITY_WAIT_MS);
    }
  }
  throw new AudioAssetRootError("AUDIO_STORAGE_WRITE_FAILED", {
    phase: "storage",
    cleanup: "deferred",
    compensation: "not-required",
  });
}

function resolvePath(
  relativePath: string,
  context: RuntimeStorageContext,
  write = false,
) {
  return write
    ? resolveRuntimeLogicalPathForWrite(relativePath, context)
    : resolveRuntimeLogicalPath(relativePath, context);
}

function requireSafePathSegment(value: string) {
  if (!/^[a-zA-Z0-9-_]+$/.test(value)) {
    throw new Error("Invalid project slug.");
  }

  return value;
}

function sanitizeFileName(value: string) {
  const sanitized = value.replace(/[^a-zA-Z0-9-_.]/g, "-");
  return sanitized === "." || sanitized === ".." ? crypto.randomUUID() : sanitized;
}

function requireSafeWavFileName(value: string) {
  if (
    !/^[a-zA-Z0-9-_.]+\.wav$/i.test(value) ||
    value.includes("..") ||
    value.includes("/") ||
    value.includes("\\")
  ) {
    throw new Error("Invalid WAV file name.");
  }

  return value;
}
