/**
 * AYAS queued-intent ledger — durable store under {@link AyasIntentPipeline}.
 *
 *   data/brain/ayas-intents/ledger.json   { schemaVersion, updatedAt, entries }
 *
 * Same discipline as `BrainTaskStore` (Sprint 182):
 *  - **Atomic write** — temp in the same dir → fsync → rename.
 *  - **Corrupt = loud** — never silently treated as an empty ledger, never
 *    overwritten (`AYAS_INTENT_LEDGER_CORRUPT` / `_SCHEMA_MISMATCH`).
 *  - **No raw utterances** — the ledger stores only `textDigest` (sha256).
 *  - **Reject on leak** — a generated field that somehow matches a secret
 *    pattern is refused (`AYAS_INTENT_LEDGER_SECRET_LEAK`).
 *  - **Idempotent** — `admit` dedupes on `clientIntentId`; replaying a batch is
 *    a no-op.
 *
 * Nothing here executes an intent. It records what the pipeline decided.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import { containsBrainSecret } from "@/lib/brain/BrainRedaction";
import {
  admitAyasIntents,
  ayasExecutionGate,
  ayasIntentSchemaVersion,
  type AyasIntentAdmissionResult,
  type AyasIntentLedgerEntry,
  type AyasQueuedIntent,
} from "./AyasIntentPipeline";

export const ayasIntentLedgerSchemaVersion = "1" as const;
const MAX_BATCH = 100;
const MAX_LEDGER_ENTRIES = 5_000;

export type AyasIntentLedgerErrorCode =
  | "AYAS_INTENT_LEDGER_CORRUPT"
  | "AYAS_INTENT_LEDGER_SCHEMA_MISMATCH"
  | "AYAS_INTENT_LEDGER_IO"
  | "AYAS_INTENT_LEDGER_BATCH_TOO_LARGE"
  | "AYAS_INTENT_LEDGER_FULL"
  | "AYAS_INTENT_LEDGER_SECRET_LEAK";

export class AyasIntentLedgerError extends Error {
  constructor(
    readonly code: AyasIntentLedgerErrorCode,
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "AyasIntentLedgerError";
    this.stack = undefined;
  }
}

export interface AyasIntentLedgerOptions {
  /** Root for all Brain durable state. Default: `<cwd>/data/brain`. */
  readonly rootDir?: string;
  readonly now?: () => Date;
}

export interface AyasIntentLedgerState {
  readonly entries: readonly AyasIntentLedgerEntry[];
  readonly highWaterSeq: number;
  readonly updatedAt: string | null;
}

export interface AyasIntentLedgerHandle {
  /** Read the persisted ledger. `[]` when absent; THROWS on corrupt. */
  read(): AyasIntentLedgerState;
  /** Run a reconnect batch through the pipeline, persist, return decisions. */
  admit(
    batch: readonly AyasQueuedIntent[],
    context: { authenticated: boolean; nowIso?: string },
  ): AyasIntentAdmissionResult;
  readonly ledgerFile: string;
}

export function createAyasIntentLedger(
  options: AyasIntentLedgerOptions = {},
): AyasIntentLedgerHandle {
  const rootDir = options.rootDir
    ? path.resolve(options.rootDir)
    : path.join(process.cwd(), "data", "brain");
  const ledgerDir = path.join(rootDir, "ayas-intents");
  const ledgerFile = path.join(ledgerDir, "ledger.json");
  const now = options.now ?? (() => new Date());

  function readEnvelope(): {
    entries: AyasIntentLedgerEntry[];
    updatedAt: string | null;
  } {
    if (!fs.existsSync(ledgerFile)) return { entries: [], updatedAt: null };
    let raw: string;
    try {
      raw = fs.readFileSync(ledgerFile, "utf8");
    } catch (error) {
      throw new AyasIntentLedgerError(
        "AYAS_INTENT_LEDGER_IO",
        `cannot read ${ledgerFile}`,
        error instanceof Error ? error.message : String(error),
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new AyasIntentLedgerError(
        "AYAS_INTENT_LEDGER_CORRUPT",
        "ledger.json is not valid JSON — refusing to touch it (manual review)",
        error instanceof Error ? error.message : String(error),
      );
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new AyasIntentLedgerError(
        "AYAS_INTENT_LEDGER_CORRUPT",
        "ledger.json has an unexpected shape",
      );
    }
    const record = parsed as Record<string, unknown>;
    if (record.schemaVersion !== ayasIntentLedgerSchemaVersion) {
      throw new AyasIntentLedgerError(
        "AYAS_INTENT_LEDGER_SCHEMA_MISMATCH",
        `ledger.json schemaVersion ${JSON.stringify(record.schemaVersion)} ≠ ${ayasIntentLedgerSchemaVersion}`,
      );
    }
    if (!Array.isArray(record.entries) || !record.entries.every(isLedgerEntry)) {
      throw new AyasIntentLedgerError(
        "AYAS_INTENT_LEDGER_CORRUPT",
        "ledger.json `entries` is not an array of valid entries",
      );
    }
    return {
      entries: record.entries.map((entry) => Object.freeze({ ...entry })),
      updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : null,
    };
  }

  function writeAtomic(entries: readonly AyasIntentLedgerEntry[]): string {
    for (const entry of entries) {
      if (containsBrainSecret(entry.kind) || containsBrainSecret(entry.reason)) {
        throw new AyasIntentLedgerError(
          "AYAS_INTENT_LEDGER_SECRET_LEAK",
          `entry ${entry.clientIntentId} carries a secret-shaped field`,
        );
      }
    }
    if (entries.length > MAX_LEDGER_ENTRIES) {
      throw new AyasIntentLedgerError(
        "AYAS_INTENT_LEDGER_FULL",
        `ledger would hold ${entries.length} entries (cap ${MAX_LEDGER_ENTRIES})`,
      );
    }
    const updatedAt = now().toISOString();
    const envelope = {
      schemaVersion: ayasIntentLedgerSchemaVersion,
      updatedAt,
      entries: [...entries],
    };
    try {
      fs.mkdirSync(ledgerDir, { recursive: true });
      const tmp = path.join(
        ledgerDir,
        `.ledger.json.${process.pid}.${crypto.randomUUID()}.tmp`,
      );
      const handle = fs.openSync(tmp, "w");
      try {
        fs.writeFileSync(handle, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
        fs.fsyncSync(handle);
      } finally {
        fs.closeSync(handle);
      }
      fs.renameSync(tmp, ledgerFile);
      return updatedAt;
    } catch (error) {
      if (error instanceof AyasIntentLedgerError) throw error;
      throw new AyasIntentLedgerError(
        "AYAS_INTENT_LEDGER_IO",
        `atomic write failed for ${ledgerFile}`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  const textDigest = (text: string): string =>
    `sha256:${crypto.createHash("sha256").update(text, "utf8").digest("hex")}`;

  return {
    ledgerFile,

    read(): AyasIntentLedgerState {
      const { entries, updatedAt } = readEnvelope();
      const sorted = [...entries].sort(
        (left, right) =>
          left.clientSeq - right.clientSeq ||
          left.clientIntentId.localeCompare(right.clientIntentId),
      );
      return {
        entries: sorted,
        highWaterSeq: sorted.reduce((max, e) => Math.max(max, e.clientSeq), 0),
        updatedAt,
      };
    },

    admit(batch, context): AyasIntentAdmissionResult {
      if (!Array.isArray(batch)) {
        throw new AyasIntentLedgerError(
          "AYAS_INTENT_LEDGER_CORRUPT",
          "batch is not an array",
        );
      }
      if (batch.length > MAX_BATCH) {
        throw new AyasIntentLedgerError(
          "AYAS_INTENT_LEDGER_BATCH_TOO_LARGE",
          `batch has ${batch.length} intents (cap ${MAX_BATCH})`,
        );
      }
      const { entries } = readEnvelope();
      const result = admitAyasIntents(batch, entries, {
        authenticated: context.authenticated,
        executionGate: ayasExecutionGate,
        nowIso: context.nowIso ?? now().toISOString(),
        textDigest,
      });
      if (result.ledgerChanged) {
        writeAtomic(result.entries);
      }
      return result;
    },
  };
}

function isLedgerEntry(value: unknown): value is AyasIntentLedgerEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    record.schemaVersion === ayasIntentSchemaVersion &&
    typeof record.clientIntentId === "string" &&
    Number.isSafeInteger(record.clientSeq) &&
    typeof record.kind === "string" &&
    typeof record.classification === "string" &&
    typeof record.decision === "string" &&
    record.executionGate === ayasExecutionGate &&
    typeof record.textDigest === "string" &&
    typeof record.submittedAt === "string" &&
    typeof record.admittedAt === "string" &&
    typeof record.reason === "string"
  );
}
