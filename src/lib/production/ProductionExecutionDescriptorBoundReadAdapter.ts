import fs from "node:fs";
import path from "node:path";
import type {
  ProductionExecutionPersistenceAdapter,
  ProductionExecutionPersistencePayloadByKind,
  ProductionExecutionPersistenceReadResult,
  ProductionExecutionPersistenceRecordKind,
  ProductionExecutionPersistenceWriteResult,
} from "@/types/productionExecutionPersistence";
import { validateProductionExecutionPersistencePayload } from
  "./ProductionExecutionPersistence";

const maximumRecordBytes = 4 * 1024 * 1024;
const keyPattern = /^[a-z0-9](?:[a-z0-9_-]{0,126}[a-z0-9])?$/;
const directories: Readonly<Record<ProductionExecutionPersistenceRecordKind, string>> = {
  transaction: "transactions", journal: "journals", idempotency: "idempotency",
  reservation: "reservations", claim: "claims", attempt: "attempts",
};

export class ProductionExecutionDescriptorBoundReadAdapter
implements ProductionExecutionPersistenceAdapter {
  private readonly root: string;

  constructor(root: string, private readonly barriers: {
    readonly afterDirectoryIdentityRead?: (kind: ProductionExecutionPersistenceRecordKind,
      directory: string) => void;
    readonly afterRecordOpen?: (kind: ProductionExecutionPersistenceRecordKind,
      key: string, target: string) => void;
  } = {}) { this.root = path.resolve(root); }

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
