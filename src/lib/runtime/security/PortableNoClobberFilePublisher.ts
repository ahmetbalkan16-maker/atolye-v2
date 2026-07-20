import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

export type PortablePublishMode = "hard-link" | "exclusive-copy";

export interface PortablePublishedFile {
  readonly mode: PortablePublishMode;
  readonly device: number;
  readonly inode: number;
  readonly byteLength: number;
  readonly sha256: string;
}

export interface PortableNoClobberPublishInput {
  readonly sourcePath: string;
  readonly destinationPath: string;
  readonly expectedByteLength: number;
  readonly expectedSha256: string;
  readonly stagingPath?: string;
  readonly onDestinationReserved?: (
    publication: PortablePublishedFile,
  ) => void;
}

const HARD_LINK_UNAVAILABLE_CODES = new Set([
  "EXDEV",
  "ENOSYS",
  "ENOTSUP",
  "EOPNOTSUPP",
]);

export function publishFilePortableNoClobber(
  input: PortableNoClobberPublishInput,
): PortablePublishedFile {
  requireExpectedFile(input.expectedByteLength, input.expectedSha256);
  const source = inspectExactFile(
    input.sourcePath,
    input.expectedByteLength,
    input.expectedSha256,
  );
  if (input.onDestinationReserved && !input.stagingPath) {
    throw new Error("Portable reserved publication requires staging.");
  }
  if (input.stagingPath) {
    return publishFileViaReservedStaging(input, source);
  }

  try {
    fs.linkSync(input.sourcePath, input.destinationPath);
  } catch (error) {
    if (!isHardLinkUnavailable(error)) throw error;
    return copyFileExclusiveDurable(input, source);
  }

  try {
    const published = inspectExactFile(
      input.destinationPath,
      input.expectedByteLength,
      input.expectedSha256,
    );
    if (published.device !== source.device || published.inode !== source.inode) {
      throw new Error("Portable hard-link publication identity mismatch.");
    }
    syncDirectory(path.dirname(input.destinationPath));
    return Object.freeze({
      mode: "hard-link" as const,
      ...published,
    });
  } catch (error) {
    removePublishedFileIfOwned(input.destinationPath, {
      mode: "hard-link",
      ...source,
    });
    throw error;
  }
}

function publishFileViaReservedStaging(
  input: PortableNoClobberPublishInput & { readonly stagingPath?: string },
  source: Omit<PortablePublishedFile, "mode">,
): PortablePublishedFile {
  const stagingPath = input.stagingPath as string;
  try {
    fs.linkSync(input.sourcePath, stagingPath);
  } catch (error) {
    if (!isHardLinkUnavailable(error)) throw error;
    return copyFileExclusiveDurable(input, source);
  }
  const staged = inspectExactFile(
    stagingPath,
    input.expectedByteLength,
    input.expectedSha256,
  );
  if (staged.device !== source.device || staged.inode !== source.inode) {
    throw new Error("Portable hard-link staging identity mismatch.");
  }
  const publication = Object.freeze({ mode: "hard-link" as const, ...staged });
  input.onDestinationReserved?.(publication);
  fs.linkSync(stagingPath, input.destinationPath);
  const published = inspectExactFile(
    input.destinationPath,
    input.expectedByteLength,
    input.expectedSha256,
  );
  if (published.device !== staged.device || published.inode !== staged.inode) {
    throw new Error("Portable hard-link publication identity mismatch.");
  }
  syncDirectory(path.dirname(input.destinationPath));
  return publication;
}

export function removePublishedFileIfOwned(
  filePath: string,
  publication: PortablePublishedFile,
): boolean {
  // Node exposes pathname-based unlink only. An lstat/fstat identity check
  // followed by unlink(path) can remove a foreign replacement. Keep the
  // object in place and let the durable owner journal retire it logically.
  void filePath;
  void publication;
  return false;
}

function copyFileExclusiveDurable(
  input: PortableNoClobberPublishInput,
  sourceIdentity: Omit<PortablePublishedFile, "mode">,
): PortablePublishedFile {
  const sourceDescriptor = fs.openSync(input.sourcePath, "r");
  const stagingPath = input.stagingPath ?? path.join(
    path.dirname(input.destinationPath),
    `.atolye-publish-${randomUUID()}.partial`,
  );
  let destinationDescriptor: number | undefined;
  let destinationIdentity:
    | Omit<PortablePublishedFile, "mode">
    | undefined;
  let firstError: unknown;
  let destinationReserved = false;
  try {
    const openedSource = fs.fstatSync(sourceDescriptor);
    if (!matchesIdentity(openedSource, sourceIdentity)) {
      throw new Error("Portable publication source identity changed.");
    }
    destinationDescriptor = fs.openSync(stagingPath, "wx+", 0o600);
    const openedDestination = fs.fstatSync(destinationDescriptor);
    if (!openedDestination.isFile()) {
      throw new Error("Portable publication destination is invalid.");
    }
    destinationIdentity = {
      device: openedDestination.dev,
      inode: openedDestination.ino,
      byteLength: input.expectedByteLength,
      sha256: input.expectedSha256,
    };
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let total = 0;
    while (true) {
      const read = fs.readSync(sourceDescriptor, buffer, 0, buffer.length, total);
      if (read === 0) break;
      hash.update(buffer.subarray(0, read));
      let writtenOffset = 0;
      while (writtenOffset < read) {
        const written = fs.writeSync(
          destinationDescriptor,
          buffer,
          writtenOffset,
          read - writtenOffset,
          total + writtenOffset,
        );
        if (!Number.isSafeInteger(written) || written <= 0) {
          throw new Error("Portable exclusive-copy publication failed.");
        }
        writtenOffset += written;
      }
      total += read;
      if (total > input.expectedByteLength) {
        throw new Error("Portable publication source length changed.");
      }
    }
    const finalSource = fs.fstatSync(sourceDescriptor);
    const finalDestination = fs.fstatSync(destinationDescriptor);
    if (
      !matchesIdentity(finalSource, sourceIdentity) ||
      total !== input.expectedByteLength ||
      finalDestination.size !== input.expectedByteLength ||
      hash.digest("hex") !== input.expectedSha256
    ) {
      throw new Error("Portable exclusive-copy verification failed.");
    }
    fs.fsyncSync(destinationDescriptor);
    input.onDestinationReserved?.({
      mode: "exclusive-copy",
      ...destinationIdentity,
    });
    destinationReserved = true;
    fs.linkSync(stagingPath, input.destinationPath);
    syncDirectory(path.dirname(input.destinationPath));
  } catch (error) {
    firstError = error;
  }

  try {
    fs.closeSync(sourceDescriptor);
  } catch (error) {
    firstError ??= error;
  }
  if (destinationDescriptor !== undefined) {
    if (firstError && !destinationReserved) {
      try {
        fs.ftruncateSync(destinationDescriptor, 0);
        fs.fsyncSync(destinationDescriptor);
      } catch {
        // Preserve the first publish failure and continue identity-safe cleanup.
      }
    }
    try {
      fs.closeSync(destinationDescriptor);
    } catch (error) {
      firstError ??= error;
    }
  }

  if (firstError) {
    throw firstError;
  }
  if (!destinationIdentity) {
    throw new Error("Portable publication destination identity is unavailable.");
  }

  try {
    const published = inspectExactFile(
      input.destinationPath,
      input.expectedByteLength,
      input.expectedSha256,
    );
    if (
      published.device !== destinationIdentity.device ||
      published.inode !== destinationIdentity.inode
    ) {
      throw new Error("Portable exclusive-copy identity mismatch.");
    }
    syncDirectory(path.dirname(input.destinationPath));
    return Object.freeze({
      mode: "exclusive-copy" as const,
      ...published,
    });
  } catch (error) {
    removePublishedFileIfOwned(input.destinationPath, {
      mode: "exclusive-copy",
      ...destinationIdentity,
    });
    throw error;
  }
}

export function finalizeReservedFilePortableNoClobber(input: {
  readonly sourcePath: string;
  readonly destinationPath: string;
  readonly publication: PortablePublishedFile;
}): PortablePublishedFile {
  requireExpectedFile(
    input.publication.byteLength,
    input.publication.sha256,
  );
  const source = inspectExactFile(
    input.sourcePath,
    input.publication.byteLength,
    input.publication.sha256,
  );
  if (
    source.device !== input.publication.device ||
    source.inode !== input.publication.inode
  ) {
    throw new Error("Portable reservation source identity mismatch.");
  }
  fs.linkSync(input.sourcePath, input.destinationPath);
  const published = inspectExactFile(
    input.destinationPath,
    input.publication.byteLength,
    input.publication.sha256,
  );
  if (
    published.device !== input.publication.device ||
    published.inode !== input.publication.inode
  ) {
    throw new Error("Portable reservation publication identity mismatch.");
  }
  syncDirectory(path.dirname(input.destinationPath));
  return Object.freeze({ ...input.publication });
}

function inspectExactFile(
  filePath: string,
  expectedByteLength: number,
  expectedSha256: string,
): Omit<PortablePublishedFile, "mode"> {
  const link = fs.lstatSync(filePath);
  if (link.isSymbolicLink() || !link.isFile() || link.size !== expectedByteLength) {
    throw new Error("Portable publication file identity is invalid.");
  }
  const descriptor = fs.openSync(filePath, "r");
  try {
    const before = fs.fstatSync(descriptor);
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor);
    if (
      !before.isFile() ||
      before.dev !== link.dev ||
      before.ino !== link.ino ||
      before.size !== expectedByteLength ||
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      bytes.length !== expectedByteLength ||
      createHash("sha256").update(bytes).digest("hex") !== expectedSha256
    ) {
      throw new Error("Portable publication file verification failed.");
    }
    return {
      device: before.dev,
      inode: before.ino,
      byteLength: expectedByteLength,
      sha256: expectedSha256,
    };
  } finally {
    fs.closeSync(descriptor);
  }
}

function syncDirectory(directory: string): void {
  if (process.platform === "win32") return;
  const descriptor = fs.openSync(directory, "r");
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function matchesIdentity(
  stat: fs.Stats,
  identity: Omit<PortablePublishedFile, "mode">,
): boolean {
  return stat.isFile() &&
    stat.dev === identity.device &&
    stat.ino === identity.inode &&
    stat.size === identity.byteLength;
}

function isHardLinkUnavailable(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return typeof code === "string" && HARD_LINK_UNAVAILABLE_CODES.has(code);
}

function requireExpectedFile(byteLength: number, sha256: string): void {
  if (
    !Number.isSafeInteger(byteLength) ||
    byteLength <= 0 ||
    !/^[0-9a-f]{64}$/.test(sha256)
  ) {
    throw new Error("Portable publication input is invalid.");
  }
}
