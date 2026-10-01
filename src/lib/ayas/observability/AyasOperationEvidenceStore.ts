import fs from "node:fs";
import path from "node:path";

import { resolveAyasExecutionAuditRoot } from "../execution/AyasExecutionAuditContext";
import type { AyasTraceEvidenceSink } from "../trace/AyasUnifiedTrace";
import { deriveAyasTraceEvidence, isAyasOperationEvidence, type AyasOperationEvidence } from "./AyasOperationEvidence";

/**
 * Stage 15F — the durable evidence stream.
 *
 *   <audit root>/observability/evidence/<YYYY-MM-DD>.jsonl
 *
 * One line per operation, appended and flushed. A day is a file, so retention
 * is the removal of whole old files and never a rewrite. Reading validates
 * every line again: a line that does not fit the closed evidence shape is
 * counted and skipped, never trusted.
 *
 * Observability only. Nothing reads this stream to decide whether an action
 * may run, and a failed write never changes a domain result.
 */
export const AYAS_EVIDENCE_MAX_LINE_BYTES = 8_192;
export const AYAS_EVIDENCE_DEFAULT_RETENTION_DAYS = 90;
const DAY_FILE = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;

export interface AyasOperationEvidenceRead {
  readonly records: readonly AyasOperationEvidence[];
  /** Lines that were unreadable or did not fit the evidence shape. */
  readonly rejectedLines: number;
  readonly days: readonly string[];
}

export interface AyasOperationEvidenceStore {
  readonly dir: string;
  /** Appends one record to its day file. Returns false, and writes nothing, when the record is not valid evidence or the write fails. */
  append(record: AyasOperationEvidence): boolean;
  /** Records from `sinceDay` on (inclusive, `YYYY-MM-DD`), oldest first, one per source and id. */
  read(options?: { readonly sinceDay?: string }): AyasOperationEvidenceRead;
  /** Day files older than the retention. With `dryRun` nothing is removed. Today's file is never a candidate. */
  prune(options: { readonly retentionDays: number; readonly nowMs: number; readonly dryRun: boolean }): readonly string[];
}

const dayOf = (isoTime: string): string => isoTime.slice(0, 10);

export function createAyasOperationEvidenceStore(options: { readonly rootDir?: string } = {}): AyasOperationEvidenceStore {
  const dir = path.join(path.resolve(options.rootDir ?? resolveAyasExecutionAuditRoot()), "observability", "evidence");

  const append = (record: AyasOperationEvidence): boolean => {
    try {
      if (!isAyasOperationEvidence(record)) return false;
      const line = `${JSON.stringify(record)}\n`;
      if (Buffer.byteLength(line, "utf8") > AYAS_EVIDENCE_MAX_LINE_BYTES) return false;
      fs.mkdirSync(dir, { recursive: true });
      const handle = fs.openSync(path.join(dir, `${dayOf(record.endedAt ?? record.startedAt)}.jsonl`), "a");
      try { fs.writeSync(handle, line, null, "utf8"); fs.fsyncSync(handle); } finally { fs.closeSync(handle); }
      return true;
    } catch { return false; }
  };

  const dayFiles = (): string[] => {
    try { return fs.readdirSync(dir).filter((name) => DAY_FILE.test(name)).sort(); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw Object.assign(new Error("evidence directory unreadable"), { code: "AYAS_EVIDENCE_READ_FAILED" });
    }
  };

  const read = (readOptions: { readonly sinceDay?: string } = {}): AyasOperationEvidenceRead => {
    const records = new Map<string, AyasOperationEvidence>();
    let rejectedLines = 0;
    const days: string[] = [];
    for (const name of dayFiles()) {
      const day = DAY_FILE.exec(name)![1]!;
      if (readOptions.sinceDay && day < readOptions.sinceDay) continue;
      days.push(day);
      let text: string;
      try { text = fs.readFileSync(path.join(dir, name), "utf8"); }
      catch { throw Object.assign(new Error("evidence day unreadable"), { code: "AYAS_EVIDENCE_READ_FAILED" }); }
      for (const line of text.split("\n")) {
        if (!line) continue;
        let parsed: unknown;
        try { parsed = line.length <= AYAS_EVIDENCE_MAX_LINE_BYTES ? JSON.parse(line) : undefined; } catch { parsed = undefined; }
        // A record belongs to the day file it is in; a line moved between files is not evidence of that day.
        if (!isAyasOperationEvidence(parsed) || dayOf(parsed.endedAt ?? parsed.startedAt) !== day) { rejectedLines += 1; continue; }
        // The first record for a source and id stands: a later line cannot rewrite what was recorded.
        const key = `${parsed.source}\n${parsed.id}`;
        if (!records.has(key)) records.set(key, parsed);
      }
    }
    return { records: [...records.values()], rejectedLines, days };
  };

  const prune = (pruneOptions: { readonly retentionDays: number; readonly nowMs: number; readonly dryRun: boolean }): readonly string[] => {
    if (!Number.isSafeInteger(pruneOptions.retentionDays) || pruneOptions.retentionDays < 1 || !Number.isFinite(pruneOptions.nowMs)) return [];
    const today = new Date(pruneOptions.nowMs).toISOString().slice(0, 10);
    const cutoff = new Date(pruneOptions.nowMs - pruneOptions.retentionDays * 86_400_000).toISOString().slice(0, 10);
    const old = dayFiles().filter((name) => { const day = DAY_FILE.exec(name)![1]!; return day < cutoff && day < today; });
    if (!pruneOptions.dryRun) for (const name of old) { try { fs.unlinkSync(path.join(dir, name)); } catch { /* reported as still present on the next run */ } }
    return old;
  };

  return Object.freeze({ dir, append, read, prune });
}

/** The sink a trace is started with: it turns the finished trace into evidence and appends it. */
export function createAyasTraceEvidenceSink(store: AyasOperationEvidenceStore = createAyasOperationEvidenceStore()): AyasTraceEvidenceSink {
  const sink: AyasTraceEvidenceSink = {
    record(snapshot) {
      const evidence = deriveAyasTraceEvidence(snapshot);
      if (evidence) store.append(evidence);
    },
  };
  return Object.freeze(sink);
}
