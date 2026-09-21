/**
 * Atölye Brain — AYAS long-term memory store (Phase 2 · Phase C).
 *
 * The thin fs adapter the `BrainMemoryModel` (pure) always expected — sibling of
 * `BrainSelfHealStore`. One JSON file, bounded, atomic write (temp → rename).
 *
 *   data/brain/memory/records.json    { schemaVersion, records: BrainMemoryRecord[] }
 *
 * Every record is built + validated by `BrainMemoryModel` before it gets here;
 * this store re-asserts the no-secret invariant and refuses to persist a leak.
 * Server-side only.
 */

import fs from "node:fs";
import path from "node:path";

import { containsBrainSecret } from "@/lib/brain/BrainRedaction";
import { buildBrainMemoryRecord, validateBrainMemoryRecord } from "@/lib/brain/BrainMemoryModel";
import { brainMemorySchemaVersion, type BrainMemoryRecord } from "@/types/brainMemory";

const MAX_RECORDS = 500;

export type AyasMemoryStoreErrorCode =
  | "AYAS_MEMORY_STORE_READ_FAILED"
  | "AYAS_MEMORY_STORE_MALFORMED"
  | "AYAS_MEMORY_STORE_INVALID"
  | "AYAS_MEMORY_STORE_WRITE_FAILED";

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

export interface AyasMemoryStoreHandle {
  readonly file: string;
  load(): BrainMemoryRecord[];
  /** Append one record (dedupes on `contentFingerprint`; refuses a secret leak). Returns `"stored" | "duplicate" | "rejected"`. */
  append(record: BrainMemoryRecord): "stored" | "duplicate" | "rejected";
  /** Remove expired non-pinned records + trim to `MAX_RECORDS` (oldest non-pinned first). Returns how many were removed. */
  prune(nowIso?: string): number;
  /** Delete a record by id (operator control). Returns `true` when it existed. */
  remove(recordId: string): boolean;
}

interface StoreFile {
  schemaVersion: typeof brainMemorySchemaVersion;
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
    validateBrainMemoryRecord(record as BrainMemoryRecord).valid
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
    if (!envelope.records.every(isStoredMemoryRecord)) {
      throw new AyasMemoryStoreError("AYAS_MEMORY_STORE_INVALID", "memory store contains an invalid record");
    }
    return { schemaVersion: brainMemorySchemaVersion, records: envelope.records };
  };

  const writeFile = (data: StoreFile): void => {
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
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

  return {
    file,

    load() {
      return readFile().records;
    },

    append(record) {
      try {
        assertNoLeak(record);
      } catch {
        return "rejected";
      }
      if (!validateBrainMemoryRecord(record).valid) return "rejected";
      const data = readFile();
      if (data.records.some((r) => r.contentFingerprint === record.contentFingerprint)) {
        return "duplicate";
      }
      data.records.push(record);
      // keep bounded: drop oldest non-pinned first
      if (data.records.length > MAX_RECORDS) {
        const sorted = [...data.records].sort(
          (a, b) =>
            Number(a.importance === "pinned") - Number(b.importance === "pinned") ||
            Date.parse(a.observedAt) - Date.parse(b.observedAt),
        );
        data.records = sorted.slice(sorted.length - MAX_RECORDS);
      }
      writeFile(data);
      return "stored";
    },

    prune(nowIso) {
      const now = nowIso ? Date.parse(nowIso) : Date.now();
      const data = readFile();
      const before = data.records.length;
      data.records = data.records.filter(
        (r) => r.importance === "pinned" || !r.expiresAt || Date.parse(r.expiresAt) > now,
      );
      if (data.records.length > MAX_RECORDS) {
        const sorted = [...data.records].sort(
          (a, b) =>
            Number(a.importance === "pinned") - Number(b.importance === "pinned") ||
            Date.parse(a.observedAt) - Date.parse(b.observedAt),
        );
        data.records = sorted.slice(sorted.length - MAX_RECORDS);
      }
      const removed = before - data.records.length;
      if (removed > 0) writeFile(data);
      return removed;
    },

    remove(recordId) {
      const data = readFile();
      const next = data.records.filter((r) => r.recordId !== recordId);
      if (next.length === data.records.length) return false;
      writeFile({ ...data, records: next });
      return true;
    },
  };
}
