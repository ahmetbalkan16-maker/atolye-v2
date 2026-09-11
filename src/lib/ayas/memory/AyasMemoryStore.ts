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
import { validateBrainMemoryRecord } from "@/lib/brain/BrainMemoryModel";
import { brainMemorySchemaVersion, type BrainMemoryRecord } from "@/types/brainMemory";

const MAX_RECORDS = 500;

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
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as Partial<StoreFile>;
      const records = Array.isArray(parsed.records) ? parsed.records : [];
      return { schemaVersion: brainMemorySchemaVersion, records };
    } catch {
      return { schemaVersion: brainMemorySchemaVersion, records: [] };
    }
  };

  const writeFile = (data: StoreFile): void => {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
    fs.renameSync(tmp, file);
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
