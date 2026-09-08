/**
 * Atölye Brain — Experience Store persistence adapter (Sprint 181, PHASE 6).
 *
 * A tiny JSON-file store behind the {@link BrainExperienceStore} contract
 * (`BrainContracts.ts`). It is the durable half of the "safe experience /
 * evaluation loop" — the pure analysis half already lives in
 * `BrainExperienceModel.ts`.
 *
 * Design rules (from the emir + the rest of the codebase):
 *  - **No secrets.** Every stored string passes {@link redactBrainText} first;
 *    a record that still matches a secret pattern after redaction is rejected
 *    (`BRAIN_EXPERIENCE_RECORD_REJECTED`) — never "stored anyway".
 *  - **No production data touched.** The store only ever writes under its own
 *    `rootDir` (default `data/brain/`); it never opens `data/projects/`.
 *  - **Atomic writes.** temp file in the same directory → `fs.fsyncSync` →
 *    `fs.renameSync`. A crash mid-write leaves the previous shard intact.
 *  - **Corrupt JSON fails loudly.** A shard that does not parse throws
 *    `BRAIN_EXPERIENCE_STORE_CORRUPT_SHARD` rather than being silently treated
 *    as empty (which would look like data loss and could overwrite good data).
 *  - **Deterministic reads.** `list()` / `recent()` return a stable order
 *    (`completedAt` desc, then `recordId` asc) regardless of shard/file order.
 *  - **Append is idempotent.** Re-appending the same `recordId` replaces it in
 *    place; the shard is re-read immediately before the write so a concurrent
 *    append in another process is merged, not clobbered. The lock is
 *    process-local (same limitation as `PipelineJobMutationLock`) — good enough
 *    for the single-box Brain Worker, not a distributed guarantee.
 *
 * Kept deliberately small: two contract methods (`append`, `list`), one
 * convenience (`recent`), one pure validator.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import { stableBrainId } from "../BrainId";
import { containsBrainSecret, redactBrainText } from "../BrainRedaction";
import {
  brainSchemaVersion,
  type BrainExperienceQuery,
  type BrainExperienceRecord,
  type BrainStageExperience,
} from "@/types/brain";

/* ------------------------------------------------------------------------- *
 * Errors
 * ------------------------------------------------------------------------- */

export type BrainExperienceStoreErrorCode =
  | "BRAIN_EXPERIENCE_STORE_CORRUPT_SHARD"
  | "BRAIN_EXPERIENCE_STORE_IO"
  | "BRAIN_EXPERIENCE_RECORD_REJECTED";

export class BrainExperienceStoreError extends Error {
  constructor(
    readonly code: BrainExperienceStoreErrorCode,
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "BrainExperienceStoreError";
    this.stack = undefined;
  }
}

/* ------------------------------------------------------------------------- *
 * Validation (pure)
 * ------------------------------------------------------------------------- */

export type BrainExperienceValidationReasonCode =
  | "BRAIN_EXPERIENCE_VALID"
  | "BRAIN_EXPERIENCE_EMPTY_TOPIC"
  | "BRAIN_EXPERIENCE_TIMESTAMP_INVALID"
  | "BRAIN_EXPERIENCE_SECRET_LEAK"
  | "BRAIN_EXPERIENCE_BAD_NUMBERS";

export interface BrainExperienceValidation {
  readonly valid: boolean;
  readonly reasonCode: BrainExperienceValidationReasonCode;
  /** The record with every free-text field redacted — safe to persist. */
  readonly sanitized: BrainExperienceRecord;
}

function isIsoInstant(value: string): boolean {
  if (typeof value !== "string" || value.length === 0) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function scrub(value: string): string {
  return redactBrainText(String(value ?? "")).text;
}

function sanitizeStage(stage: BrainStageExperience): BrainStageExperience {
  return {
    ...stage,
    provider: scrub(stage.provider),
    model: scrub(stage.model),
    strategyLabel: scrub(stage.strategyLabel),
  };
}

/**
 * Fail-closed validation + redaction. The returned `sanitized` record is what
 * the store actually writes; a caller may inspect `valid` / `reasonCode` first.
 */
export function validateBrainExperienceRecordForStorage(
  record: BrainExperienceRecord,
): BrainExperienceValidation {
  const sanitized: BrainExperienceRecord = {
    ...record,
    topic: scrub(record.topic).slice(0, 400),
    strategyLabel: scrub(record.strategyLabel).slice(0, 200),
    stages: record.stages.map(sanitizeStage),
    ...(record.notes ? { notes: record.notes.map((note) => scrub(note).slice(0, 500)) } : {}),
    ...(record.userFeedback
      ? {
          userFeedback: {
            rating: record.userFeedback.rating,
            ...(record.userFeedback.note
              ? { note: scrub(record.userFeedback.note).slice(0, 500) }
              : {}),
          },
        }
      : {}),
  };

  if (!sanitized.topic.trim()) {
    return { valid: false, reasonCode: "BRAIN_EXPERIENCE_EMPTY_TOPIC", sanitized };
  }
  if (!isIsoInstant(record.requestedAt) || !isIsoInstant(record.completedAt)) {
    return { valid: false, reasonCode: "BRAIN_EXPERIENCE_TIMESTAMP_INVALID", sanitized };
  }
  const numbers = [
    record.qualityScore,
    record.totals.wallClockMs,
    record.totals.promptTokens,
    record.totals.completionTokens,
    record.totals.aiCostUsd,
    record.totals.regenerationCount,
  ];
  if (numbers.some((value) => typeof value !== "number" || !Number.isFinite(value) || value < 0)) {
    return { valid: false, reasonCode: "BRAIN_EXPERIENCE_BAD_NUMBERS", sanitized };
  }
  const leakCandidates = [
    sanitized.topic,
    sanitized.strategyLabel,
    ...(sanitized.notes ?? []),
    ...(sanitized.userFeedback?.note ? [sanitized.userFeedback.note] : []),
    ...sanitized.stages.flatMap((stage) => [stage.provider, stage.model, stage.strategyLabel]),
  ];
  if (leakCandidates.some(containsBrainSecret)) {
    return { valid: false, reasonCode: "BRAIN_EXPERIENCE_SECRET_LEAK", sanitized };
  }
  return { valid: true, reasonCode: "BRAIN_EXPERIENCE_VALID", sanitized };
}

/* ------------------------------------------------------------------------- *
 * Query filtering (pure)
 * ------------------------------------------------------------------------- */

export interface BrainExperienceListQuery extends Partial<BrainExperienceQuery> {
  /** Dry-run plan records are excluded unless this is `true`. */
  readonly includeDryRun?: boolean;
  /** ISO instant — records completed before this are dropped. */
  readonly since?: string;
}

function matches(record: BrainExperienceRecord, query: BrainExperienceListQuery): boolean {
  if (!query.includeDryRun && record.mode === "dry-run") return false;
  if (query.topicCategory && record.topicCategory !== query.topicCategory) return false;
  if (query.hardwareProfileId && record.hardwareProfileId !== query.hardwareProfileId) return false;
  if (query.stage && !record.stages.some((stage) => stage.stage === query.stage)) return false;
  if (query.since && isIsoInstant(query.since) && Date.parse(record.completedAt) < Date.parse(query.since)) {
    return false;
  }
  return true;
}

/** Deterministic: newest first, ties broken by `recordId`. */
function orderRecords(records: readonly BrainExperienceRecord[]): BrainExperienceRecord[] {
  return [...records].sort(
    (left, right) =>
      Date.parse(right.completedAt) - Date.parse(left.completedAt) ||
      left.recordId.localeCompare(right.recordId),
  );
}

/* ------------------------------------------------------------------------- *
 * Shard file model
 * ------------------------------------------------------------------------- */

interface ExperienceShard {
  readonly schemaVersion: typeof brainSchemaVersion;
  readonly month: string;
  readonly records: readonly BrainExperienceRecord[];
}

const SHARD_RE = /^\d{4}-\d{2}\.json$/;

function monthOf(record: BrainExperienceRecord): string {
  const iso = isIsoInstant(record.completedAt) ? record.completedAt : record.requestedAt;
  return iso.slice(0, 7); // yyyy-mm
}

/* ------------------------------------------------------------------------- *
 * Store
 * ------------------------------------------------------------------------- */

export interface BrainExperienceStoreOptions {
  /** Root for all Brain durable state. Default: `<cwd>/data/brain`. */
  readonly rootDir?: string;
}

export interface BrainExperienceStoreHandle {
  append(record: BrainExperienceRecord): Promise<void>;
  list(query?: BrainExperienceListQuery): Promise<readonly BrainExperienceRecord[]>;
  /** Deterministic last-N (after the same ordering as `list`). */
  recent(limit: number, query?: BrainExperienceListQuery): Promise<readonly BrainExperienceRecord[]>;
  /** Absolute path of the `experience/` directory (for diagnostics / tests). */
  readonly experienceDir: string;
}

export function createBrainExperienceStore(
  options: BrainExperienceStoreOptions = {},
): BrainExperienceStoreHandle {
  const rootDir = options.rootDir
    ? path.resolve(options.rootDir)
    : path.join(process.cwd(), "data", "brain");
  const experienceDir = path.join(rootDir, "experience");

  function ensureDir(): void {
    try {
      fs.mkdirSync(experienceDir, { recursive: true });
    } catch (error) {
      throw new BrainExperienceStoreError(
        "BRAIN_EXPERIENCE_STORE_IO",
        `cannot create ${experienceDir}`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  function readShard(month: string): ExperienceShard {
    const file = path.join(experienceDir, `${month}.json`);
    if (!fs.existsSync(file)) {
      return { schemaVersion: brainSchemaVersion, month, records: [] };
    }
    let raw: string;
    try {
      raw = fs.readFileSync(file, "utf-8");
    } catch (error) {
      throw new BrainExperienceStoreError(
        "BRAIN_EXPERIENCE_STORE_IO",
        `cannot read ${file}`,
        error instanceof Error ? error.message : String(error),
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new BrainExperienceStoreError(
        "BRAIN_EXPERIENCE_STORE_CORRUPT_SHARD",
        `shard ${month}.json is not valid JSON — refusing to touch it (manual review needed)`,
        error instanceof Error ? error.message : String(error),
      );
    }
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !Array.isArray((parsed as ExperienceShard).records)
    ) {
      throw new BrainExperienceStoreError(
        "BRAIN_EXPERIENCE_STORE_CORRUPT_SHARD",
        `shard ${month}.json has an unexpected shape — refusing to touch it`,
      );
    }
    return {
      schemaVersion: brainSchemaVersion,
      month,
      records: (parsed as ExperienceShard).records as BrainExperienceRecord[],
    };
  }

  function writeShardAtomic(month: string, records: readonly BrainExperienceRecord[]): void {
    ensureDir();
    const file = path.join(experienceDir, `${month}.json`);
    const payload: ExperienceShard = {
      schemaVersion: brainSchemaVersion,
      month,
      records: orderRecords(records),
    };
    const tmp = path.join(
      experienceDir,
      `.${month}.json.${process.pid}.${crypto.randomUUID()}.tmp`,
    );
    try {
      const handle = fs.openSync(tmp, "w");
      try {
        fs.writeFileSync(handle, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
        fs.fsyncSync(handle);
      } finally {
        fs.closeSync(handle);
      }
      fs.renameSync(tmp, file);
    } catch (error) {
      try {
        fs.rmSync(tmp, { force: true });
      } catch {
        /* best effort */
      }
      throw new BrainExperienceStoreError(
        "BRAIN_EXPERIENCE_STORE_IO",
        `atomic write failed for ${file}`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  function allShardMonths(): string[] {
    if (!fs.existsSync(experienceDir)) return [];
    return fs
      .readdirSync(experienceDir)
      .filter((name) => SHARD_RE.test(name))
      .map((name) => name.slice(0, 7))
      .sort();
  }

  return {
    experienceDir,

    async append(record: BrainExperienceRecord): Promise<void> {
      const validation = validateBrainExperienceRecordForStorage(record);
      if (!validation.valid) {
        throw new BrainExperienceStoreError(
          "BRAIN_EXPERIENCE_RECORD_REJECTED",
          `record ${record.recordId} rejected: ${validation.reasonCode}`,
          validation.reasonCode,
        );
      }
      const stored = validation.sanitized;
      const month = monthOf(stored);
      // Re-read immediately before write so a concurrent append is merged.
      const current = readShard(month).records;
      const merged = [
        ...current.filter((existing) => existing.recordId !== stored.recordId),
        stored,
      ];
      writeShardAtomic(month, merged);
    },

    async list(query: BrainExperienceListQuery = {}): Promise<readonly BrainExperienceRecord[]> {
      const collected: BrainExperienceRecord[] = [];
      const seen = new Set<string>();
      for (const month of allShardMonths()) {
        for (const record of readShard(month).records) {
          if (seen.has(record.recordId)) continue;
          seen.add(record.recordId);
          if (matches(record, query)) collected.push(record);
        }
      }
      return orderRecords(collected);
    },

    async recent(
      limit: number,
      query: BrainExperienceListQuery = {},
    ): Promise<readonly BrainExperienceRecord[]> {
      const ordered = await this.list(query);
      const n = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : ordered.length;
      return ordered.slice(0, n);
    },
  };
}

/**
 * Stable id for an experience record built from its defining inputs. Two runs
 * with the same topic / hardware / request instant collide on purpose — a
 * re-append is then idempotent rather than a duplicate.
 */
export function brainExperienceRecordId(input: {
  readonly topic: string;
  readonly hardwareProfileId: string;
  readonly requestedAt: string;
  readonly mode: NonNullable<BrainExperienceRecord["mode"]>;
  readonly planId?: string;
}): string {
  return stableBrainId("brain-experience", input);
}
