import fs from "node:fs";
import { createHash } from "node:crypto";
import {
  requireContainedStorageFile,
} from "@/lib/assets/storage/StoragePathSecurity";
import type { RuntimeStorageContext } from
  "@/lib/runtime/RuntimeStoragePaths";

export interface AudioDescriptorFileIdentity {
  readonly device: number;
  readonly inode: number;
  readonly byteLength: number;
  readonly sha256: string;
}

export class AudioDescriptorVerificationError extends Error {
  constructor() {
    super("Audio descriptor verification failed.");
    this.name = "AudioDescriptorVerificationError";
    this.stack = undefined;
  }
}

export function readContainedAudioFileDescriptorBound(
  storageRoot: string,
  filePath: string,
  context: RuntimeStorageContext,
  expected: AudioDescriptorFileIdentity,
): Buffer {
  const contained = requireContainedStorageFile(storageRoot, filePath, context);
  const bytes = readAudioFileDescriptorBound(contained.realPath, {
    expected,
    openedIdentity: {
      device: contained.stat.dev,
      inode: contained.stat.ino,
      byteLength: contained.stat.size,
    },
  });
  const postRead = requireContainedStorageFile(storageRoot, filePath, context);
  if (
    postRead.stat.dev !== expected.device ||
    postRead.stat.ino !== expected.inode ||
    postRead.stat.size !== expected.byteLength
  ) throw new AudioDescriptorVerificationError();
  return bytes;
}

export function readAudioFileDescriptorBound(
  filePath: string,
  options: {
    readonly maximumByteLength?: number;
    readonly expected?: AudioDescriptorFileIdentity;
    readonly openedIdentity?: {
      readonly device: number;
      readonly inode: number;
      readonly byteLength: number;
    };
  } = {},
): Buffer {
  let descriptor: number | undefined;
  let bytes: Buffer | undefined;
  let firstError: unknown;
  try {
    descriptor = fs.openSync(filePath, "r");
    const before = fs.fstatSync(descriptor);
    if (
      !before.isFile() ||
      !reliableIdentity(before.dev, before.ino) ||
      before.size <= 0 ||
      (options.maximumByteLength !== undefined &&
        before.size > options.maximumByteLength) ||
      (options.openedIdentity !== undefined &&
        (before.dev !== options.openedIdentity.device ||
          before.ino !== options.openedIdentity.inode ||
          before.size !== options.openedIdentity.byteLength))
    ) throw new AudioDescriptorVerificationError();

    bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor);
    const sha256 = digestBytes(bytes);
    if (
      !after.isFile() ||
      !reliableIdentity(after.dev, after.ino) ||
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      bytes.length !== before.size ||
      (options.expected !== undefined &&
        (before.dev !== options.expected.device ||
          before.ino !== options.expected.inode ||
          before.size !== options.expected.byteLength ||
          sha256 !== options.expected.sha256))
    ) throw new AudioDescriptorVerificationError();
  } catch (error) {
    firstError = error;
  } finally {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); }
      catch (error) { firstError ??= error; }
    }
  }
  if (!firstError && options.openedIdentity !== undefined) {
    try {
      const postPath = fs.lstatSync(filePath);
      if (
        !postPath.isFile() ||
        postPath.isSymbolicLink() ||
        postPath.dev !== options.openedIdentity.device ||
        postPath.ino !== options.openedIdentity.inode ||
        postPath.size !== options.openedIdentity.byteLength
      ) throw new AudioDescriptorVerificationError();
    } catch (error) {
      firstError = error;
    }
  }
  if (firstError || !bytes) throw new AudioDescriptorVerificationError();
  return bytes;
}

function reliableIdentity(device: number, inode: number): boolean {
  return Number.isFinite(device) && Number.isInteger(device) && device > 0 &&
    Number.isFinite(inode) && Number.isInteger(inode) && inode > 0;
}

function digestBytes(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
