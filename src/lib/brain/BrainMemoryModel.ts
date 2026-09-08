/**
 * Atölye Brain — memory model (pure).
 *
 * Builds, validates, redacts and recalls `BrainMemoryRecord`s. Every record is
 * run through {@link redactBrainText} before it is stored — a record that still
 * carries a secret after redaction is rejected outright (`BRAIN_MEMORY_SECRET_LEAK`),
 * it is never "stored anyway with a warning".
 *
 * No file IO here — the JSON-file store is a later, thin adapter.
 */

import { stableProductionId } from "@/lib/production/ProductionDeterminism";
import { containsBrainSecret, redactBrainLines, redactBrainText } from "./BrainRedaction";
import {
  brainMemorySchemaVersion,
  type BrainMemoryImportance,
  type BrainMemoryQuery,
  type BrainMemoryRecall,
  type BrainMemoryRecord,
  type BrainMemoryRecordInput,
  type BrainMemoryValidation,
} from "@/types/brainMemory";

const MAX_BODY_LENGTH = 4_000;

const IMPORTANCE_RANK: Readonly<Record<BrainMemoryImportance, number>> = Object.freeze({
  transient: 0,
  normal: 1,
  durable: 2,
  pinned: 3,
});

function isIsoInstant(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

/**
 * Build a canonical, redacted memory record. Deterministic id. The returned
 * record's `redacted` flag says whether the scrubber changed anything.
 */
export function buildBrainMemoryRecord(input: BrainMemoryRecordInput): BrainMemoryRecord {
  const titleResult = redactBrainText(input.title.trim());
  const bodyResult = redactBrainText(input.body.trim());
  const linkResult = redactBrainLines(input.links.map((link) => link.trim()).filter(Boolean));
  const tags = [...new Set(input.tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))].sort();

  const canonical = {
    kind: input.kind,
    title: titleResult.text,
    body: bodyResult.text.slice(0, MAX_BODY_LENGTH),
    importance: input.importance,
    confidence: input.confidence,
    tags,
    ...(input.stage ? { stage: input.stage } : {}),
    observedAt: input.observedAt,
    links: linkResult.lines,
    ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
  };

  const contentFingerprint = stableProductionId("brain-memory-content", canonical);
  return {
    schemaVersion: brainMemorySchemaVersion,
    ...canonical,
    recordId: stableProductionId("brain-memory", { canonical, contentFingerprint }),
    redacted: titleResult.redacted || bodyResult.redacted || linkResult.redacted,
    contentFingerprint,
  };
}

/** Fail-closed validation. A record that still contains a secret is invalid. */
export function validateBrainMemoryRecord(record: BrainMemoryRecord): BrainMemoryValidation {
  if (!record.body.trim()) {
    return { valid: false, reasonCode: "BRAIN_MEMORY_EMPTY_BODY" };
  }
  if (record.body.length > MAX_BODY_LENGTH) {
    return { valid: false, reasonCode: "BRAIN_MEMORY_BODY_TOO_LARGE" };
  }
  if (!isIsoInstant(record.observedAt) || (record.expiresAt && !isIsoInstant(record.expiresAt))) {
    return { valid: false, reasonCode: "BRAIN_MEMORY_TIMESTAMP_INVALID" };
  }
  if (
    containsBrainSecret(record.title) ||
    containsBrainSecret(record.body) ||
    record.links.some(containsBrainSecret)
  ) {
    return { valid: false, reasonCode: "BRAIN_MEMORY_SECRET_LEAK" };
  }
  return { valid: true, reasonCode: "BRAIN_MEMORY_VALID" };
}

function expired(record: BrainMemoryRecord, now: number): boolean {
  return (
    record.importance !== "pinned" &&
    typeof record.expiresAt === "string" &&
    Date.parse(record.expiresAt) <= now
  );
}

/**
 * Recall records matching a query. Deterministic ordering: importance desc,
 * then `observedAt` desc, then `recordId`. Expired non-pinned records are
 * dropped and counted.
 */
export function recallBrainMemory(
  records: readonly BrainMemoryRecord[],
  query: BrainMemoryQuery = {},
  nowIso?: string,
): BrainMemoryRecall {
  const now = nowIso && isIsoInstant(nowIso) ? Date.parse(nowIso) : Number.MAX_SAFE_INTEGER;
  const minRank = query.minImportance ? IMPORTANCE_RANK[query.minImportance] : 0;
  const sinceMs = query.since && isIsoInstant(query.since) ? Date.parse(query.since) : undefined;
  const wantTags = query.tags?.map((tag) => tag.trim().toLowerCase()).filter(Boolean) ?? [];

  let droppedExpired = 0;
  const matched = records.filter((record) => {
    if (expired(record, now)) {
      droppedExpired += 1;
      return false;
    }
    if (query.kinds && !query.kinds.includes(record.kind)) return false;
    if (query.stage && record.stage !== query.stage) return false;
    if (IMPORTANCE_RANK[record.importance] < minRank) return false;
    if (
      sinceMs !== undefined &&
      record.importance !== "pinned" &&
      Date.parse(record.observedAt) < sinceMs
    ) {
      return false;
    }
    if (wantTags.length > 0 && !wantTags.every((tag) => record.tags.includes(tag))) return false;
    return true;
  });

  const ordered = [...matched].sort(
    (left, right) =>
      IMPORTANCE_RANK[right.importance] - IMPORTANCE_RANK[left.importance] ||
      Date.parse(right.observedAt) - Date.parse(left.observedAt) ||
      left.recordId.localeCompare(right.recordId),
  );

  const limit = query.limit && query.limit > 0 ? Math.floor(query.limit) : ordered.length;
  return {
    records: ordered.slice(0, limit),
    totalMatched: ordered.length,
    droppedExpired,
  };
}

/** A compact, safe, human-readable digest of what the Brain currently remembers. */
export function summarizeBrainMemory(records: readonly BrainMemoryRecord[]): string {
  if (records.length === 0) return "Brain memory is empty.";
  const byKind = new Map<string, number>();
  for (const record of records) byKind.set(record.kind, (byKind.get(record.kind) ?? 0) + 1);
  const lines = [
    `Brain memory: ${records.length} record(s)`,
    ...[...byKind.entries()].sort().map(([kind, count]) => `  - ${kind}: ${count}`),
  ];
  const pinned = records.filter((record) => record.importance === "pinned");
  if (pinned.length) {
    lines.push("  pinned:");
    for (const record of pinned.slice(0, 10)) lines.push(`    * ${record.title}`);
  }
  return lines.join("\n");
}
