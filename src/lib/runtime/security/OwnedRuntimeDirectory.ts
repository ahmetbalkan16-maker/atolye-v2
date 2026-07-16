import type fs from "node:fs";
import type { RuntimeMutationCleanupStatus } from "./RuntimeMutationError";

export interface RuntimeObjectIdentity {
  readonly path: string;
  readonly realPath: string;
  readonly stat: fs.BigIntStats;
}

export interface OwnedRuntimeDirectoryState {
  readonly absolutePath: string;
  readonly parentIdentity: RuntimeObjectIdentity;
  readonly directoryIdentity: RuntimeObjectIdentity;
  status: "owned" | "cleaned" | "released";
}

export interface OwnedRuntimeWriteOptions<T> {
  readonly executable?: boolean;
  readonly beforeWrite?: (parentPath: string, destinationPath: string) => void;
  readonly afterWrite?: (destinationPath: string) => T;
}

export interface OwnedRuntimeDirectoryAdapter {
  ensureOwnedDirectory(
    state: OwnedRuntimeDirectoryState,
    relativePath: string,
  ): string;
  writeOwnedFileExclusive<T>(
    state: OwnedRuntimeDirectoryState,
    relativePath: string,
    data: string | Buffer,
    options: OwnedRuntimeWriteOptions<T> & {
      readonly encoding?: BufferEncoding;
      readonly mode?: number;
    },
  ): T | undefined;
  copyOwnedFileExclusive<T>(
    state: OwnedRuntimeDirectoryState,
    source: string,
    relativePath: string,
    options: OwnedRuntimeWriteOptions<T>,
  ): T | undefined;
  publishOwnedFileExclusive<T>(
    state: OwnedRuntimeDirectoryState,
    source: string,
    relativePath: string,
    options: OwnedRuntimeWriteOptions<T>,
  ): T | undefined;
  cleanupOwnedDirectory(state: OwnedRuntimeDirectoryState): RuntimeMutationCleanupStatus;
  releaseOwnedDirectory(state: OwnedRuntimeDirectoryState): void;
}

export class OwnedRuntimeDirectory {
  constructor(
    private readonly adapter: OwnedRuntimeDirectoryAdapter,
    private readonly state: OwnedRuntimeDirectoryState,
  ) {}

  get absolutePath(): string {
    return this.state.absolutePath;
  }

  ensureDirectory(relativePath: string): string {
    return this.adapter.ensureOwnedDirectory(this.state, relativePath);
  }

  writeFileExclusive<T = undefined>(
    relativePath: string,
    data: string | Buffer,
    options: OwnedRuntimeWriteOptions<T> & {
      readonly encoding?: BufferEncoding;
      readonly mode?: number;
    } = {},
  ): T | undefined {
    return this.adapter.writeOwnedFileExclusive(this.state, relativePath, data, options);
  }

  copyFileExclusive<T = undefined>(
    source: string,
    relativePath: string,
    options: OwnedRuntimeWriteOptions<T> = {},
  ): T | undefined {
    return this.adapter.copyOwnedFileExclusive(this.state, source, relativePath, options);
  }

  publishFileExclusive<T = undefined>(
    source: string,
    relativePath: string,
    options: OwnedRuntimeWriteOptions<T> = {},
  ): T | undefined {
    return this.adapter.publishOwnedFileExclusive(this.state, source, relativePath, options);
  }

  cleanup(): RuntimeMutationCleanupStatus {
    return this.adapter.cleanupOwnedDirectory(this.state);
  }

  releaseOwnership(): void {
    this.adapter.releaseOwnedDirectory(this.state);
  }
}
