import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type {
  ProductionExecutionPersistenceAdapter,
  ProductionExecutionPersistencePayloadByKind,
  ProductionExecutionPersistenceReadResult,
  ProductionExecutionPersistenceRecordKind,
  ProductionExecutionPersistenceWriteResult,
} from "@/types/productionExecutionPersistence";
import { validateProductionExecutionPersistencePayload } from
  "./ProductionExecutionPersistence";
import {
  assertProductionRuntimeOperationContext,
  requireExactActiveProductionRuntimeOperationContext,
  requireProductionRuntimeStorageContext,
  type ProductionRuntimeOperationContext,
} from "@/lib/runtime/ProductionRuntimeOperationContext";

const maximumRecordBytes = 4 * 1024 * 1024;
const keyPattern = /^[a-z0-9](?:[a-z0-9_-]{0,126}[a-z0-9])?$/;
const directories: Readonly<Record<ProductionExecutionPersistenceRecordKind, string>> = {
  transaction: "transactions", journal: "journals", idempotency: "idempotency",
  reservation: "reservations", claim: "claims", attempt: "attempts",
};

export const productionExecutionReadDescriptorVersion =
  "production-execution-read-descriptor-v1" as const;

export interface ProductionExecutionReadDescriptor {
  readonly kind: typeof productionExecutionReadDescriptorVersion;
  readonly operationId: string;
  readonly operationBinding: string;
  readonly runtimeAuthorityIdentity: string;
  readonly storageAuthorityIdentity: string;
  readonly projectSlug: string;
  readonly durableRootIdentity: string;
}

interface RegisteredReadDescriptor {
  readonly context: ProductionRuntimeOperationContext;
  readonly root: string;
  readonly rootIdentity?: FileIdentity;
  readonly projectRoot: string;
  readonly projectRootIdentity: FileIdentity;
}

const descriptorBindings = new WeakMap<ProductionExecutionReadDescriptor,
  RegisteredReadDescriptor>();

export function createProductionExecutionReadDescriptor(input: {
  readonly runtimeOperationContext: ProductionRuntimeOperationContext;
  readonly projectSlug: string;
}): ProductionExecutionReadDescriptor {
  assertProductionRuntimeOperationContext(input.runtimeOperationContext);
  if (!/^[a-z0-9][a-z0-9-]{0,126}[a-z0-9]$/.test(input.projectSlug)) {
    throw new TypeError("Production execution read project identity is invalid.");
  }
  const storage = requireProductionRuntimeStorageContext(input.runtimeOperationContext);
  const projectRoot = path.resolve(storage.projectsRoot, input.projectSlug);
  const root = path.join(projectRoot, "production-execution");
  assertContained(storage.projectsRoot, root);
  const projectRootIdentity = readDirectoryIdentity(projectRoot);
  const rootIdentity = fs.existsSync(root) ? readDirectoryIdentity(root) : undefined;
  const descriptor = Object.create(null) as Record<string, unknown>;
  const values = {
    kind: productionExecutionReadDescriptorVersion,
    operationId: input.runtimeOperationContext.operationId,
    operationBinding: input.runtimeOperationContext.bindingFingerprint,
    runtimeAuthorityIdentity: input.runtimeOperationContext.authority.authorityIdentity,
    storageAuthorityIdentity: input.runtimeOperationContext.authority.resolverBindingIdentity,
    projectSlug: input.projectSlug,
    durableRootIdentity: rootIdentity ? fingerprintIdentity(rootIdentity)
      : createHash("sha256").update(`not-created\0${fingerprintIdentity(projectRootIdentity)}`).digest("hex"),
  } satisfies ProductionExecutionReadDescriptor;
  for (const [key, value] of Object.entries(values)) {
    Object.defineProperty(descriptor, key, { value, enumerable: true,
      writable: false, configurable: false });
  }
  const frozen = Object.freeze(descriptor) as unknown as ProductionExecutionReadDescriptor;
  descriptorBindings.set(frozen, { context: input.runtimeOperationContext, root, rootIdentity,
    projectRoot, projectRootIdentity });
  return frozen;
}

export class ProductionExecutionDescriptorBoundReadAdapter
implements ProductionExecutionPersistenceAdapter {
  private readonly root: string;
  private readonly registered: RegisteredReadDescriptor;

  constructor(descriptor: ProductionExecutionReadDescriptor, private readonly barriers: {
    readonly afterDirectoryIdentityRead?: (kind: ProductionExecutionPersistenceRecordKind,
      directory: string) => void;
    readonly afterRecordOpen?: (kind: ProductionExecutionPersistenceRecordKind,
      key: string, target: string) => void;
  } = {}) {
    const registered = descriptorBindings.get(descriptor);
    if (!registered || !Object.isFrozen(descriptor) ||
      Object.getPrototypeOf(descriptor) !== null ||
      Reflect.ownKeys(descriptor).some((key) => {
        const value = Object.getOwnPropertyDescriptor(descriptor, key);
        return !value || !("value" in value) || value.writable || value.configurable;
      })) throw new TypeError("Production execution read descriptor is invalid.");
    this.registered = registered;
    this.root = registered.root;
  }

  async write<K extends ProductionExecutionPersistenceRecordKind>(
    kind: K, key: string,
    value: ProductionExecutionPersistencePayloadByKind[K],
  ): Promise<ProductionExecutionPersistenceWriteResult<K>> {
    void value;
    return { ok: false, status: "failed", kind, key,
      errorCode: "PERSISTENCE_INVALID_INPUT" };
  }

  async read<K extends ProductionExecutionPersistenceRecordKind>(
    kind: K, key: string,
  ): Promise<ProductionExecutionPersistenceReadResult<K>> {
    if (!keyPattern.test(key)) return { ok: false, status: "failed", kind, key,
      errorCode: "PERSISTENCE_INVALID_INPUT" };
    const target = path.join(this.root, directories[kind], `${key}.json`);
    try {
      this.assertAuthority();
    } catch (error) {
      return { ok: false, status: "failed", kind, key,
        errorCode: error instanceof DurableIdentityChangedError ||
          (this.registered.rootIdentity && nodeCode(error) === "ENOENT")
          ? "PERSISTENCE_IDENTITY_CHANGED" : "PERSISTENCE_READ_FAILED" };
    }
    try {
      const value = readExactJson(target, () => this.barriers.afterRecordOpen?.(kind, key, target));
      if (!validateProductionExecutionPersistencePayload(kind, value)) {
        return { ok: false, status: "failed", kind, key,
          errorCode: "PERSISTENCE_RECORD_CORRUPT" };
      }
      return { ok: true, status: "found", kind, key,
        value: value as ProductionExecutionPersistencePayloadByKind[K] };
    } catch (error) {
      if (nodeCode(error) === "ENOENT") return { ok: false, status: "not-found", kind, key,
        errorCode: "PERSISTENCE_NOT_FOUND" };
      return { ok: false, status: "failed", kind, key,
        errorCode: error instanceof DurableIdentityChangedError
          ? "PERSISTENCE_IDENTITY_CHANGED" : nodeCode(error) === undefined
            ? "PERSISTENCE_RECORD_CORRUPT" : "PERSISTENCE_READ_FAILED" };
    }
  }

  async listKeys<K extends ProductionExecutionPersistenceRecordKind>(kind: K) {
    const directory = path.join(this.root, directories[kind]);
    try {
      this.assertAuthority();
    } catch (error) {
      return { ok: false as const, status: "failed" as const, kind,
        errorCode: error instanceof DurableIdentityChangedError ||
          (this.registered.rootIdentity && nodeCode(error) === "ENOENT")
          ? "PERSISTENCE_IDENTITY_CHANGED" as const : "PERSISTENCE_READ_FAILED" as const };
    }
    try {
      const before = fs.lstatSync(directory, { bigint: true });
      if (!before.isDirectory() || before.isSymbolicLink() ||
        !reliable(before.dev, before.ino)) throw new Error("invalid");
      this.barriers.afterDirectoryIdentityRead?.(kind, directory);
      const entries = fs.readdirSync(directory, { withFileTypes: true });
      const keys: string[] = [];
      for (const entry of entries) {
        if (entry.name.includes(".tmp")) continue;
        if (!entry.name.endsWith(".json")) throw new Error("invalid");
        if (!entry.isFile() || entry.isSymbolicLink()) throw new Error("invalid");
        const key = entry.name.slice(0, -5);
        if (!keyPattern.test(key)) throw new Error("invalid");
        keys.push(key);
      }
      const after = fs.lstatSync(directory, { bigint: true });
      if (!sameIdentity(before, after)) throw new DurableIdentityChangedError();
      keys.sort(codeUnitCompare);
      return { ok: true as const, status: "listed" as const, kind, keys, storeState: "present" as const };
    } catch (error) {
      if (nodeCode(error) === "ENOENT") {
        return { ok: true as const, status: "listed" as const, kind, keys: [], storeState: "not-created" as const };
      }
      return { ok: false as const, status: "failed" as const, kind,
        errorCode: error instanceof DurableIdentityChangedError
          ? "PERSISTENCE_IDENTITY_CHANGED" as const
          : nodeCode(error) === undefined ? "PERSISTENCE_RECORD_CORRUPT" as const
            : "PERSISTENCE_READ_FAILED" as const };
    }
  }

  private assertAuthority(): void {
    requireExactActiveProductionRuntimeOperationContext(this.registered.context);
    const project = readDirectoryIdentity(this.registered.projectRoot);
    if (!sameFileIdentity(this.registered.projectRootIdentity, project)) {
      throw new DurableIdentityChangedError();
    }
    if (!this.registered.rootIdentity) {
      if (fs.existsSync(this.root)) throw new DurableIdentityChangedError();
      return;
    }
    const current = readDirectoryIdentity(this.root);
    if (!sameFileIdentity(this.registered.rootIdentity, current)) throw new DurableIdentityChangedError();
  }
}

class DurableIdentityChangedError extends Error {}

function readExactJson(target: string, afterOpen: () => void): unknown {
  let descriptor: number | undefined;
  try {
    const link = fs.lstatSync(target, { bigint: true });
    if (!link.isFile() || link.isSymbolicLink() || !reliable(link.dev, link.ino) ||
      link.size < BigInt(0) || link.size > BigInt(maximumRecordBytes)) throw new Error("invalid");
    descriptor = fs.openSync(target, fs.constants.O_RDONLY);
    const before = fs.fstatSync(descriptor, { bigint: true });
    if (!sameIdentity(link, before)) throw new DurableIdentityChangedError();
    afterOpen();
    const expected = Number(before.size);
    const bytes = Buffer.alloc(expected);
    let offset = 0;
    while (offset < expected) {
      const count = fs.readSync(descriptor, bytes, offset, expected - offset, offset);
      if (count <= 0) throw new DurableIdentityChangedError();
      offset += count;
    }
    const growthProbe = Buffer.alloc(1);
    if (fs.readSync(descriptor, growthProbe, 0, 1, expected) !== 0) {
      throw new DurableIdentityChangedError();
    }
    const after = fs.fstatSync(descriptor, { bigint: true });
    let finalLink: fs.BigIntStats;
    try { finalLink = fs.lstatSync(target, { bigint: true }); }
    catch (error) {
      if (nodeCode(error) === "ENOENT") throw new DurableIdentityChangedError();
      throw error;
    }
    if (!sameIdentity(before, after) || !sameIdentity(before, finalLink) ||
      offset !== expected) throw new DurableIdentityChangedError();
    return JSON.parse(bytes.toString("utf8"));
  } finally {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch { /* read already remains fail-closed */ }
    }
  }
}

function reliable(device: bigint, inode: bigint): boolean {
  return device > BigInt(0) && inode > BigInt(0);
}

interface FileIdentity {
  readonly device: bigint;
  readonly inode: bigint;
  readonly size: bigint;
  readonly modifiedNanoseconds: bigint;
}

function readDirectoryIdentity(value: string): FileIdentity {
  const stat = fs.lstatSync(value, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink() || !reliable(stat.dev, stat.ino)) {
    throw new DurableIdentityChangedError();
  }
  return { device: stat.dev, inode: stat.ino, size: stat.size,
    modifiedNanoseconds: stat.mtimeNs };
}

function sameFileIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.device === right.device && left.inode === right.inode;
}

function fingerprintIdentity(value: FileIdentity): string {
  return createHash("sha256").update([
    value.device, value.inode, value.size, value.modifiedNanoseconds,
  ].map(String).join("\0")).digest("hex");
}

function assertContained(parent: string, candidate: string): void {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new TypeError("Production execution durable root is outside the runtime authority.");
  }
}

function sameIdentity(left: fs.BigIntStats, right: fs.BigIntStats): boolean {
  return right.isFile() === left.isFile() && right.isDirectory() === left.isDirectory() &&
    !right.isSymbolicLink() && right.dev === left.dev && right.ino === left.ino &&
    right.size === left.size;
}

function nodeCode(error: unknown): string | undefined {
  return error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
}

function codeUnitCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
