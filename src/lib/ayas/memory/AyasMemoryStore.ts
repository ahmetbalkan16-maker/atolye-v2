/**
 * Atölye Brain — AYAS long-term memory store (Phase 2 · Phase C).
 *
 * The thin fs adapter the `BrainMemoryModel` (pure) always expected — sibling of
 * `BrainSelfHealStore`. One JSON file, bounded, atomic write (temp → rename).
 *
 *   data/brain/memory/records.json    { schemaVersion, revision?, records: BrainMemoryRecord[] }
 *
 * Every record is built + validated by `BrainMemoryModel` before it gets here;
 * this store re-asserts the no-secret invariant and refuses to persist a leak.
 * Server-side only.
 *
 * Memory Temporal v2: every mutation runs under one exclusive writer lock
 * (`records.json.lock`, O_EXCL, never waited on — a busy lock is an immediate
 * `AYAS_MEMORY_STORE_CONFLICT`) and bumps `revision`. A caller holding an older
 * snapshot can pass `expectedRevision` and gets `AYAS_MEMORY_STORE_CONFLICT`
 * instead of overwriting newer state; the revision is re-checked right before
 * the rename as well. Supersession needs no second write — it is derived from
 * the record set (`AyasMemoryTemporal.ts`) — so one append is the whole
 * transaction and a crash can never leave a half-applied version change.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { containsBrainSecret } from "@/lib/brain/BrainRedaction";
import { buildBrainMemoryRecord, validateBrainMemoryRecord } from "@/lib/brain/BrainMemoryModel";
import { brainMemorySchemaVersion, type BrainMemoryRecord } from "@/types/brainMemory";
import { ayasMemoryRecordFact, currentAyasMemoryFactRecords, isAyasMemoryFactKey } from "./AyasMemoryTemporal";

/** Hard cap on stored records; `prune` trims the oldest non-pinned beyond it. */
export const AYAS_MEMORY_MAX_RECORDS = 500;
const MAX_RECORDS = AYAS_MEMORY_MAX_RECORDS;
/** A lock older than this belongs to a writer that died mid-write. */
const LOCK_STALE_MS = 30_000;

export type AyasMemoryStoreErrorCode =
  | "AYAS_MEMORY_STORE_READ_FAILED"
  | "AYAS_MEMORY_STORE_MALFORMED"
  | "AYAS_MEMORY_STORE_INVALID"
  | "AYAS_MEMORY_STORE_WRITE_FAILED"
  | "AYAS_MEMORY_STORE_CONFLICT";

export class AyasMemoryStoreError extends Error {
  constructor(readonly code: AyasMemoryStoreErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AyasMemoryStoreError";
  }
}

export interface AyasMemoryStoreOptions {
  /** Override the `data/brain` root — for tests. */
  readonly rootDir?: string;
}

export interface AyasMemoryStoreSnapshot {
  /** Monotonic write counter; a v1 file without one reads as 0. */
  readonly revision: number;
  readonly records: BrainMemoryRecord[];
}

export interface AyasMemoryWriteOptions {
  /** Fail with `AYAS_MEMORY_STORE_CONFLICT` unless the store is still at this revision. */
  readonly expectedRevision?: number;
}

export interface AyasMemoryStoreHandle {
  readonly file: string;
  load(): BrainMemoryRecord[];
  snapshot(): AyasMemoryStoreSnapshot;
  /** Append one record (dedupes on `contentFingerprint`; refuses a secret leak). Returns `"stored" | "duplicate" | "rejected"`. */
  append(record: BrainMemoryRecord, options?: AyasMemoryWriteOptions): "stored" | "duplicate" | "rejected";
  /** Remove expired non-pinned records + trim to `MAX_RECORDS` (oldest non-pinned first). Returns how many were removed. */
  prune(nowIso?: string, options?: AyasMemoryWriteOptions): number;
  /** Delete a record by id (operator control). Returns `true` when it existed. */
  remove(recordId: string, options?: AyasMemoryWriteOptions): boolean;
}

interface StoreFile {
  schemaVersion: typeof brainMemorySchemaVersion;
  revision?: number;
  records: BrainMemoryRecord[];
}

const MEMORY_KINDS = new Set([
  "project-structure", "decision", "test-result", "known-bug", "user-preference",
  "security-policy", "outcome-history", "graphify-state", "environment-note",
]);
const MEMORY_IMPORTANCE = new Set(["transient", "normal", "durable", "pinned"]);
const MEMORY_CONFIDENCE = new Set(["observed", "inferred", "reported"]);
const PRODUCTION_STAGES = new Set([
  "research", "script", "scenes", "visuals", "animation", "video", "audio",
  "assembly", "thumbnail", "seo", "youtube", "export",
]);

function isStoredMemoryRecord(value: unknown): value is BrainMemoryRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<BrainMemoryRecord>;
  if (!(
    record.schemaVersion === brainMemorySchemaVersion &&
    typeof record.recordId === "string" && record.recordId.trim().length > 0 &&
    typeof record.contentFingerprint === "string" && record.contentFingerprint.trim().length > 0 &&
    typeof record.redacted === "boolean" &&
    typeof record.kind === "string" && MEMORY_KINDS.has(record.kind) &&
    typeof record.title === "string" &&
    typeof record.body === "string" &&
    typeof record.importance === "string" && MEMORY_IMPORTANCE.has(record.importance) &&
    typeof record.confidence === "string" && MEMORY_CONFIDENCE.has(record.confidence) &&
    (record.stage === undefined || (typeof record.stage === "string" && PRODUCTION_STAGES.has(record.stage))) &&
    typeof record.observedAt === "string" &&
    (record.expiresAt === undefined || typeof record.expiresAt === "string") &&
    Array.isArray(record.tags) && record.tags.every((tag) => typeof tag === "string") &&
    Array.isArray(record.links) && record.links.every((link) => typeof link === "string") &&
    validateBrainMemoryRecord(record as BrainMemoryRecord).valid &&
    (record.temporal?.factKey === undefined || isAyasMemoryFactKey(record.temporal.factKey))
  )) return false;

  const rebuilt = buildBrainMemoryRecord({
    kind: record.kind as BrainMemoryRecord["kind"],
    title: record.title,
    body: record.body,
    importance: record.importance as BrainMemoryRecord["importance"],
    confidence: record.confidence as BrainMemoryRecord["confidence"],
    tags: record.tags,
    ...(record.stage ? { stage: record.stage as NonNullable<BrainMemoryRecord["stage"]> } : {}),
    observedAt: record.observedAt,
    links: record.links,
    ...(record.expiresAt ? { expiresAt: record.expiresAt } : {}),
  });
  return rebuilt.recordId === record.recordId && rebuilt.contentFingerprint === record.contentFingerprint;
}

function readLockToken(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf-8").trim();
  } catch {
    return null;
  }
}

/** `<pid>:<random>` — the pid for liveness, the random part so a lock is never mistaken for another owner's. */
function lockAbandoned(lockFile: string, token: string): boolean {
  try {
    if (Date.now() - fs.statSync(lockFile).mtimeMs > LOCK_STALE_MS) return true;
    const pid = Number(token.split(":")[0]);
    if (!Number.isSafeInteger(pid) || pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return false;
    } catch (error) {
      return (error as NodeJS.ErrnoException)?.code === "ESRCH";
    }
  } catch {
    // Vanished between checks — the next create attempt decides.
    return false;
  }
}

/**
 * Take an abandoned lock out of the way without ever removing a fresh one: it
 * is renamed aside and only discarded if it still carries the token that was
 * judged abandoned. Otherwise another waiter reclaimed it first and created
 * its own lock, which is put back (create-if-absent via hard link).
 */
function reclaimAbandonedLock(lockFile: string, abandonedToken: string): void {
  const aside = `${lockFile}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.stale`;
  try {
    fs.renameSync(lockFile, aside);
  } catch {
    return;
  }
  if (readLockToken(aside) !== abandonedToken) {
    try {
      fs.linkSync(aside, lockFile);
    } catch {
      // A third writer already holds the lock; the revision re-check before
      // rename keeps the displaced owner from overwriting newer state.
    }
  }
  fs.rmSync(aside, { force: true });
}

/**
 * Creating a file whose delete is still pending fails with EPERM/EACCES on
 * Windows — contention, not a broken disk. A persistent permission problem
 * therefore also surfaces as CONFLICT, after the caller's retries.
 */
const LOCK_CONTENTION_CODES = new Set(["EEXIST", "EPERM", "EACCES", "EBUSY"]);

/**
 * Never waits: the store API is synchronous and runs on the server's event
 * loop, so a busy lock is an immediate `AYAS_MEMORY_STORE_CONFLICT` and the
 * caller backs off asynchronously (`persistAyasMemoryFromTurn`). Within one
 * process writes are synchronous, so only another process can hold the lock.
 */
function withWriterLock<T>(dir: string, lockFile: string, run: (assertOwned: () => void) => T): T {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (error) {
    throw new AyasMemoryStoreError("AYAS_MEMORY_STORE_WRITE_FAILED", "memory store could not be written", { cause: error });
  }
  const token = `${process.pid}:${crypto.randomBytes(8).toString("hex")}`;
  let acquired = false;
  for (let attempt = 0; attempt < 2 && !acquired; attempt += 1) {
    try {
      const fd = fs.openSync(lockFile, "wx");
      try {
        fs.writeSync(fd, token);
      } finally {
        fs.closeSync(fd);
      }
      acquired = true;
    } catch (error) {
      if (!LOCK_CONTENTION_CODES.has((error as NodeJS.ErrnoException)?.code ?? "")) {
        throw new AyasMemoryStoreError("AYAS_MEMORY_STORE_WRITE_FAILED", "memory store lock could not be created", { cause: error });
      }
      const holder = readLockToken(lockFile);
      if (holder === null || !lockAbandoned(lockFile, holder)) break;
      reclaimAbandonedLock(lockFile, holder);
    }
  }
  if (!acquired) throw new AyasMemoryStoreError("AYAS_MEMORY_STORE_CONFLICT", "memory store is locked by another writer");
  // Reclaiming is rename-then-restore, not atomic: a racing reclaimer can
  // displace a live lock. The owner re-checks right before its rename and
  // gives up instead of writing alongside whoever holds the lock now.
  const assertOwned = () => {
    if (readLockToken(lockFile) !== token) {
      throw new AyasMemoryStoreError("AYAS_MEMORY_STORE_CONFLICT", "memory store lock was taken over during the write");
    }
  };
  try {
    return run(assertOwned);
  } finally {
    // Release only our own lock — never one a reclaimer handed to someone else.
    // A failed release must not replace the write's result; the lock then
    // expires as stale (LOCK_STALE_MS).
    try {
      if (readLockToken(lockFile) === token) fs.rmSync(lockFile, { force: true });
    } catch {
      // Best effort: a scanner holding the lock file on Windows is not a write failure.
    }
  }
}

/** Only the envelope's revision — the lock already guarantees the records this writer read. */
function readRevision(file: string): number {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as { revision?: unknown };
    return typeof parsed?.revision === "number" ? parsed.revision : 0;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return 0;
    throw new AyasMemoryStoreError("AYAS_MEMORY_STORE_READ_FAILED", "memory store could not be re-read", { cause: error });
  }
}

function assertNoLeak(record: BrainMemoryRecord): void {
  if (
    containsBrainSecret(record.title) ||
    containsBrainSecret(record.body) ||
    record.links.some(containsBrainSecret) ||
    record.tags.some(containsBrainSecret)
  ) {
    throw new Error("AYAS_MEMORY_SECRET_LEAK");
  }
}

export function createAyasMemoryStore(options: AyasMemoryStoreOptions = {}): AyasMemoryStoreHandle {
  const rootDir = options.rootDir ? path.resolve(options.rootDir) : path.join(process.cwd(), "data", "brain");
  const dir = path.join(rootDir, "memory");
  const file = path.join(dir, "records.json");
  const lockFile = `${file}.lock`;

  const readFile = (): StoreFile => {
    let raw: string;
    try {
      raw = fs.readFileSync(file, "utf-8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
        return { schemaVersion: brainMemorySchemaVersion, records: [] };
      }
      throw new AyasMemoryStoreError("AYAS_MEMORY_STORE_READ_FAILED", "memory store could not be read", {
        cause: error,
      });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new AyasMemoryStoreError("AYAS_MEMORY_STORE_MALFORMED", "memory store is not valid JSON", {
        cause: error,
      });
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new AyasMemoryStoreError("AYAS_MEMORY_STORE_INVALID", "memory store has an invalid envelope");
    }
    const envelope = parsed as Partial<StoreFile>;
    if (envelope.schemaVersion !== brainMemorySchemaVersion || !Array.isArray(envelope.records)) {
      throw new AyasMemoryStoreError("AYAS_MEMORY_STORE_INVALID", "memory store schema is invalid");
    }
    if (envelope.revision !== undefined && !(Number.isSafeInteger(envelope.revision) && envelope.revision >= 0)) {
      throw new AyasMemoryStoreError("AYAS_MEMORY_STORE_INVALID", "memory store revision is invalid");
    }
    if (!envelope.records.every(isStoredMemoryRecord)) {
      throw new AyasMemoryStoreError("AYAS_MEMORY_STORE_INVALID", "memory store contains an invalid record");
    }
    return { schemaVersion: brainMemorySchemaVersion, revision: envelope.revision ?? 0, records: envelope.records };
  };

  const writeFile = (data: StoreFile, readRevisionAtStart: number, assertOwned: () => void): void => {
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    try {
      // fsync before the rename: after a crash the store is either the old
      // file or the complete new one, never a truncated rename target.
      const fd = fs.openSync(tmp, "w");
      try {
        // writeFileSync on a descriptor writes the whole buffer (a bare writeSync may write less).
        fs.writeFileSync(fd, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
    } catch (error) {
      try {
        fs.rmSync(tmp, { force: true });
      } catch {
        // Best-effort cleanup must never mask the original persistence failure.
      }
      throw new AyasMemoryStoreError("AYAS_MEMORY_STORE_WRITE_FAILED", "memory store could not be written", {
        cause: error,
      });
    }
    // Defense in depth behind the lock: never rename while another writer holds
    // it, nor over state this writer did not read.
    const discardTmp = () => {
      try {
        fs.rmSync(tmp, { force: true });
      } catch {
        // A scanner may still hold the fresh temp file on Windows; the typed error below matters more.
      }
    };
    let stale = false;
    try {
      assertOwned();
      stale = readRevision(file) !== readRevisionAtStart;
    } catch (error) {
      discardTmp();
      throw error;
    }
    if (stale) {
      discardTmp();
      throw new AyasMemoryStoreError("AYAS_MEMORY_STORE_CONFLICT", "memory store changed during the write");
    }
    try {
      fs.renameSync(tmp, file);
    } catch (error) {
      try {
        fs.rmSync(tmp, { force: true });
      } catch {
        // Best-effort cleanup must never mask the original persistence failure.
      }
      throw new AyasMemoryStoreError("AYAS_MEMORY_STORE_WRITE_FAILED", "memory store could not be written", {
        cause: error,
      });
    }
  };

  /** One locked read-modify-write; `apply` returns the next records, or `null` for no change. */
  const mutate = <T>(options: AyasMemoryWriteOptions, apply: (records: BrainMemoryRecord[]) => { result: T; next: BrainMemoryRecord[] | null }): T =>
    withWriterLock(dir, lockFile, (assertOwned) => {
      const data = readFile();
      const revision = data.revision ?? 0;
      if (options.expectedRevision !== undefined && options.expectedRevision !== revision) {
        throw new AyasMemoryStoreError(
          "AYAS_MEMORY_STORE_CONFLICT",
          `expected revision ${options.expectedRevision} but the store is at ${revision}`,
        );
      }
      const { result, next } = apply(data.records);
      if (next) writeFile({ schemaVersion: brainMemorySchemaVersion, revision: revision + 1, records: next }, revision, assertOwned);
      return result;
    });

  const bounded = (records: BrainMemoryRecord[], nowIso: string): BrainMemoryRecord[] => {
    if (records.length <= MAX_RECORDS) return records;
    // Drop oldest first — but never a pinned record, nor the newest record of
    // each exclusive fact's current value (its latest confirmation), however
    // old it is. Older versions and older restatements of a fact go first, so
    // trimming never loses the current value nor re-exposes a superseded one.
    const newestCurrent = new Map<string, BrainMemoryRecord>();
    for (const record of currentAyasMemoryFactRecords(records, nowIso)) {
      const key = ayasMemoryRecordFact(record)!.key;
      const held = newestCurrent.get(key);
      if (!held || Date.parse(record.observedAt) > Date.parse(held.observedAt)) newestCurrent.set(key, record);
    }
    const current = new Set([...newestCurrent.values()].map((record) => record.recordId));
    const keepRank = (record: BrainMemoryRecord) => (record.importance === "pinned" ? 2 : current.has(record.recordId) ? 1 : 0);
    const sorted = [...records].sort(
      (a, b) => keepRank(a) - keepRank(b) || Date.parse(a.observedAt) - Date.parse(b.observedAt),
    );
    return sorted.slice(sorted.length - MAX_RECORDS);
  };

  return {
    file,

    load() {
      return readFile().records;
    },

    snapshot() {
      const data = readFile();
      return { revision: data.revision ?? 0, records: data.records };
    },

    append(record, options = {}) {
      try {
        assertNoLeak(record);
      } catch {
        return "rejected";
      }
      if (!validateBrainMemoryRecord(record).valid) return "rejected";
      if (record.temporal?.factKey !== undefined && !isAyasMemoryFactKey(record.temporal.factKey)) return "rejected";
      return mutate(options, (records) => {
        // A restatement of a fact's current value is kept (it is the latest
        // confirmation, needed for as-of precision) but adds no version: the
        // resolver merges same-value runs. Retention bounds the history.
        if (records.some((r) => r.contentFingerprint === record.contentFingerprint)) {
          return { result: "duplicate" as const, next: null };
        }
        return { result: "stored" as const, next: bounded([...records, record], new Date().toISOString()) };
      });
    },

    prune(nowIso, options = {}) {
      const now = nowIso ? Date.parse(nowIso) : Date.now();
      // An unparseable time would make every expiring record look expired — refuse before touching anything.
      if (!Number.isFinite(now)) throw new AyasMemoryStoreError("AYAS_MEMORY_STORE_WRITE_FAILED", "prune time is invalid");
      return mutate(options, (records) => {
        const kept = bounded(records.filter(
          (r) => r.importance === "pinned" || !r.expiresAt || Date.parse(r.expiresAt) > now,
        ), new Date(now).toISOString());
        const removed = records.length - kept.length;
        return { result: removed, next: removed > 0 ? kept : null };
      });
    },

    remove(recordId, options = {}) {
      return mutate(options, (records) => {
        const next = records.filter((r) => r.recordId !== recordId);
        return next.length === records.length ? { result: false, next: null } : { result: true, next };
      });
    },
  };
}
