import fs from "node:fs";
import path from "node:path";

/**
 * M18 — read-only projection over the durable micro-batch-inbox file, for
 * the Gelişim Merkezi "Küçük Geliştirme Paketi" display path. Mirrors
 * `AyasApprovalInboxReader.ts` exactly: it parses
 * `data/brain/autonomy/micro-batch-inbox.json` directly and never writes to
 * it, never imports the write-capable `AyasMicroBatch.ts` store, and exposes
 * no create/decide/reserve/finalize/recordResult API — only a plain read.
 *
 * Failure semantics mirror the store's own read path: a missing file is an
 * empty inbox (no batches yet); malformed JSON or an invalid shape throws
 * rather than being silently reinterpreted, so a corrupt file is never
 * mistaken for an empty one. The caller (`AyasMicroBatchDevelopmentView`)
 * treats any thrown error as "disconnected" for display purposes.
 */
export const ayasMicroBatchReaderSchemaVersion = "1" as const;

export type AyasMicroBatchStatusRead = "ACCUMULATING" | "READY_FOR_REVIEW" | "APPROVED" | "RESERVED" | "COMPLETED" | "FAILED" | "STALE" | "ABANDONED" | "RECOVERY_REQUIRED";

export interface AyasMicroBatchItemRefRead {
  readonly microItemId: string;
  readonly semanticKey: string;
  readonly patchArtifactId: string;
  readonly patchHash: string;
  readonly exactFiles: readonly string[];
}

export interface AyasMicroBatchRead {
  readonly batchId: string;
  readonly batchVersion: number;
  readonly baseHead: string;
  readonly baseBranch: string;
  readonly items: readonly AyasMicroBatchItemRefRead[];
  readonly exactFilesUnion: readonly string[];
  readonly validatorUnion: readonly string[];
  readonly batchHash: string;
  readonly createdAt: string;
  readonly lastUpdatedAt: string;
  readonly validationSummary: readonly string[];
  readonly aggregateRisk: string;
  readonly status: AyasMicroBatchStatusRead;
}

export interface AyasMicroBatchDecisionRead {
  readonly decisionId: string;
  readonly batchId: string;
  readonly decision: "APPROVE" | "REJECT";
  readonly decidedAt: string;
  readonly reservedAt?: string;
  readonly finalizedAt?: string;
  readonly finalizationOutcome?: "EXECUTED" | "ABANDONED" | "RECOVERY_REQUIRED";
}

export interface AyasMicroBatchResultRead {
  readonly resultId: string;
  readonly batchId: string;
  readonly completedAt: string;
  readonly outcome: "COMPLETED" | "FAILED" | "ROLLED_BACK" | "STALE";
  readonly changedFiles: readonly string[];
  readonly testsRun: readonly string[];
  readonly testResults: readonly string[];
}

export interface AyasMicroBatchReadState {
  readonly batches: readonly AyasMicroBatchRead[];
  readonly decisions: readonly AyasMicroBatchDecisionRead[];
  readonly results: readonly AyasMicroBatchResultRead[];
}

export class AyasMicroBatchReaderError extends Error {
  constructor(readonly code: "AYAS_MICRO_BATCH_READ_CORRUPT" | "AYAS_MICRO_BATCH_READ_SCHEMA_MISMATCH", message: string) {
    super(message);
    this.name = "AyasMicroBatchReaderError";
    this.stack = undefined;
  }
}

export interface AyasMicroBatchReaderOptions { readonly rootDir?: string; }

export function readAyasMicroBatchState(options: AyasMicroBatchReaderOptions = {}): AyasMicroBatchReadState {
  const root = path.resolve(options.rootDir ?? path.join(process.cwd(), "data", "brain"));
  const stateFile = path.join(root, "autonomy", "micro-batch-inbox.json");
  if (!fs.existsSync(stateFile)) return { batches: [], decisions: [], results: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  } catch (error) {
    throw new AyasMicroBatchReaderError("AYAS_MICRO_BATCH_READ_CORRUPT", `micro-batch-inbox.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new AyasMicroBatchReaderError("AYAS_MICRO_BATCH_READ_CORRUPT", "micro-batch-inbox.json has an invalid shape");
  const state = parsed as { readonly schemaVersion?: unknown; readonly batches?: unknown; readonly decisions?: unknown; readonly results?: unknown };
  if (state.schemaVersion !== ayasMicroBatchReaderSchemaVersion) throw new AyasMicroBatchReaderError("AYAS_MICRO_BATCH_READ_SCHEMA_MISMATCH", "micro-batch-inbox.json schema is unsupported");
  if (!Array.isArray(state.batches) || !Array.isArray(state.decisions) || !Array.isArray(state.results)) throw new AyasMicroBatchReaderError("AYAS_MICRO_BATCH_READ_CORRUPT", "micro-batch-inbox.json durable collections are invalid");
  return { batches: state.batches as readonly AyasMicroBatchRead[], decisions: state.decisions as readonly AyasMicroBatchDecisionRead[], results: state.results as readonly AyasMicroBatchResultRead[] };
}
