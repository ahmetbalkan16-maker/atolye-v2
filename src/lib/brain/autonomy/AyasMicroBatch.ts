import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { containsBrainSecret, redactBrainText } from "../BrainRedaction";

/**
 * M18 — the immutable/versioned batch record and its durable
 * approval/execution lifecycle. Deliberately a SEPARATE store from
 * `AyasApprovalInboxStore` (never a distortion of the single-proposal,
 * single-exactFiles-array shape to fit a multi-item batch) but reusing the
 * EXACT SAME proven mechanics: one-shot reservation via
 * `reserveApproval`/`finalizeApproval`, fail-closed status guards, atomic
 * writes, terminal-state dedup. `AyasAutonomyDaemon.executeApproved()`
 * remains the sole execution authority either way — this store only ever
 * feeds it a batch-shaped input (see `AyasMicroBatchExecutionService.ts`).
 */
export const ayasMicroBatchSchemaVersion = "1" as const;

export type AyasMicroBatchStatus = "ACCUMULATING" | "READY_FOR_REVIEW" | "APPROVED" | "RESERVED" | "COMPLETED" | "FAILED" | "STALE" | "ABANDONED" | "RECOVERY_REQUIRED";

export interface AyasMicroBatchItemRef {
  readonly microItemId: string;
  readonly semanticKey: string;
  readonly patchArtifactId: string;
  readonly patchHash: string;
  readonly exactFiles: readonly string[];
}

export interface AyasMicroBatch {
  readonly schemaVersion: typeof ayasMicroBatchSchemaVersion;
  readonly batchId: string;
  readonly batchVersion: number;
  readonly baseHead: string;
  readonly baseBranch: string;
  readonly items: readonly AyasMicroBatchItemRef[];
  readonly exactFilesUnion: readonly string[];
  readonly validatorUnion: readonly string[];
  readonly batchHash: string;
  readonly worktreeBaseHead: string;
  readonly createdAt: string;
  readonly lastUpdatedAt: string;
  readonly validationSummary: readonly string[];
  readonly aggregateRisk: string;
  readonly status: AyasMicroBatchStatus;
}

export interface AyasMicroBatchDecisionRecord {
  readonly decisionId: string;
  readonly batchId: string;
  readonly batchHash: string;
  readonly decision: "APPROVE" | "REJECT";
  readonly decidedAt: string;
  readonly authorizationId?: string;
  readonly reservationId?: string;
  readonly reservedAt?: string;
  readonly finalizedAt?: string;
  readonly finalizationOutcome?: "EXECUTED" | "ABANDONED" | "RECOVERY_REQUIRED";
}

export interface AyasMicroBatchResultRecord {
  readonly resultId: string;
  readonly batchId: string;
  readonly authorizationId: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly changedFiles: readonly string[];
  readonly testsRun: readonly string[];
  readonly testResults: readonly string[];
  readonly outcome: "COMPLETED" | "FAILED" | "ROLLED_BACK" | "STALE";
}

export interface AyasMicroBatchStoreState {
  readonly schemaVersion: typeof ayasMicroBatchSchemaVersion;
  readonly revision: number;
  readonly batches: readonly AyasMicroBatch[];
  readonly decisions: readonly AyasMicroBatchDecisionRecord[];
  readonly results: readonly AyasMicroBatchResultRecord[];
}

export class AyasMicroBatchStoreError extends Error {
  constructor(readonly code: "AYAS_MICRO_BATCH_CORRUPT" | "AYAS_MICRO_BATCH_IO" | "AYAS_MICRO_BATCH_SECRET_LEAK" | "AYAS_MICRO_BATCH_INVALID" | "AYAS_MICRO_BATCH_UNSAFE_APPROVAL", message: string) {
    super(message);
    this.name = "AyasMicroBatchStoreError";
    this.stack = undefined;
  }
}

const digest = (value: unknown): string => crypto.createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
const scrub = (value: string, max: number): string => redactBrainText(String(value ?? "")).text.slice(0, max);

/**
 * Binds baseHead + every item's (semanticKey, patchHash) pair, in order +
 * exactFilesUnion + validatorUnion + batchVersion. Deliberately excludes
 * `batchId` (random), `createdAt`/`lastUpdatedAt` (volatile timestamps —
 * the exact M16 incident class), and `worktreeBaseHead`/`validationSummary`
 * (bookkeeping, not content). Adding, removing, or reordering an item, or
 * any item's content changing (which changes its patchHash), changes
 * `batchHash` — exactly Phase 6's "no approval transfer" requirement.
 */
export function computeAyasMicroBatchHash(input: { readonly baseHead: string; readonly items: readonly AyasMicroBatchItemRef[]; readonly exactFilesUnion: readonly string[]; readonly validatorUnion: readonly string[]; readonly batchVersion: number }): string {
  const material = {
    baseHead: input.baseHead,
    items: input.items.map((i) => ({ semanticKey: i.semanticKey, patchHash: i.patchHash })),
    exactFilesUnion: [...input.exactFilesUnion].sort(),
    validatorUnion: [...input.validatorUnion].sort(),
    batchVersion: input.batchVersion,
  };
  return digest({ ...material, schemaVersion: ayasMicroBatchSchemaVersion });
}

export interface AyasMicroBatchStoreOptions { readonly rootDir?: string; }

export interface AyasMicroBatchStoreHandle {
  readonly stateFile: string;
  load(): AyasMicroBatchStoreState;
  /** Creates batchVersion 1, or a new version of an existing batchId if `previousBatchId` is supplied (used when items are added/removed/rebased — Phase 17). */
  createOrVersion(input: Omit<AyasMicroBatch, "schemaVersion" | "batchId" | "batchHash" | "lastUpdatedAt" | "status"> & { readonly batchId?: string }): AyasMicroBatch;
  markReadyForReview(batchId: string, now: string): AyasMicroBatch;
  decide(batchId: string, decision: "APPROVE" | "REJECT", batchHashValue: string, now: string): { readonly batch: AyasMicroBatch; readonly decision: AyasMicroBatchDecisionRecord };
  markStale(batchId: string, now: string): AyasMicroBatch;
  reserveApproval(batchId: string, batchHashValue: string, baseHead: string, now: string): { readonly reservationId: string; readonly authorizationId: string; readonly decisionId: string };
  finalizeApproval(reservationId: string, outcome: "EXECUTED" | "ABANDONED" | "RECOVERY_REQUIRED", now: string): void;
  recordResult(result: AyasMicroBatchResultRecord, status: "COMPLETED" | "FAILED" | "STALE"): void;
}

function emptyState(): AyasMicroBatchStoreState {
  return { schemaVersion: ayasMicroBatchSchemaVersion, revision: 0, batches: [], decisions: [], results: [] };
}

export function createAyasMicroBatchStore(options: AyasMicroBatchStoreOptions = {}): AyasMicroBatchStoreHandle {
  const root = path.resolve(options.rootDir ?? path.join(process.cwd(), "data", "brain"));
  const dir = path.join(root, "autonomy");
  const stateFile = path.join(dir, "micro-batch-inbox.json");

  const writeAtomic = (state: AyasMicroBatchStoreState): void => {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, `.micro-batch-inbox.${process.pid}.${crypto.randomUUID()}.tmp`);
    try {
      const fd = fs.openSync(tmp, "w");
      try { fs.writeFileSync(fd, `${JSON.stringify(state, null, 2)}\n`, "utf8"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(tmp, stateFile);
    } catch (error) {
      try { fs.rmSync(tmp, { force: true }); } catch { /* fail closed */ }
      throw new AyasMicroBatchStoreError("AYAS_MICRO_BATCH_IO", error instanceof Error ? error.message : String(error));
    }
  };

  const load = (): AyasMicroBatchStoreState => {
    if (!fs.existsSync(stateFile)) return emptyState();
    let parsed: unknown;
    try { parsed = JSON.parse(fs.readFileSync(stateFile, "utf8")); } catch (error) { throw new AyasMicroBatchStoreError("AYAS_MICRO_BATCH_CORRUPT", error instanceof Error ? error.message : String(error)); }
    if (!parsed || typeof parsed !== "object") throw new AyasMicroBatchStoreError("AYAS_MICRO_BATCH_CORRUPT", "micro-batch-inbox.json has an invalid shape");
    const state = parsed as Partial<AyasMicroBatchStoreState>;
    if (state.schemaVersion !== ayasMicroBatchSchemaVersion || !Array.isArray(state.batches) || !Array.isArray(state.decisions) || !Array.isArray(state.results)) {
      throw new AyasMicroBatchStoreError("AYAS_MICRO_BATCH_CORRUPT", "micro-batch-inbox.json is structurally invalid");
    }
    return state as AyasMicroBatchStoreState;
  };

  const save = (state: AyasMicroBatchStoreState): AyasMicroBatchStoreState => {
    const text = JSON.stringify(state);
    if (containsBrainSecret(text)) throw new AyasMicroBatchStoreError("AYAS_MICRO_BATCH_SECRET_LEAK", "micro batch inbox contains a secret-like value");
    const next = { ...state, revision: state.revision + 1 };
    writeAtomic(next);
    return next;
  };

  return {
    stateFile,
    load,
    createOrVersion(input) {
      const state = load();
      const batchId = input.batchId ?? `ayas-micro-batch-${crypto.randomUUID()}`;
      const batchHash = computeAyasMicroBatchHash(input);
      const batch: AyasMicroBatch = {
        ...input,
        schemaVersion: ayasMicroBatchSchemaVersion,
        batchId,
        batchHash,
        lastUpdatedAt: input.createdAt,
        status: "ACCUMULATING",
        validationSummary: input.validationSummary.map((s) => scrub(s, 500)),
        aggregateRisk: scrub(input.aggregateRisk, 700),
      };
      save({ ...state, batches: [...state.batches.filter((b) => b.batchId !== batchId), batch] });
      return batch;
    },
    markReadyForReview(batchId, now) {
      const state = load();
      const existing = state.batches.find((b) => b.batchId === batchId);
      if (!existing) throw new AyasMicroBatchStoreError("AYAS_MICRO_BATCH_INVALID", "batch not found");
      if (existing.status !== "ACCUMULATING") throw new AyasMicroBatchStoreError("AYAS_MICRO_BATCH_INVALID", `batch cannot become ready from status: ${existing.status}`);
      const updated = { ...existing, status: "READY_FOR_REVIEW" as const, lastUpdatedAt: now };
      save({ ...state, batches: state.batches.map((b) => b.batchId === batchId ? updated : b) });
      return updated;
    },
    decide(batchId, decision, batchHashValue, now) {
      const state = load();
      const existing = state.batches.find((b) => b.batchId === batchId);
      if (!existing) throw new AyasMicroBatchStoreError("AYAS_MICRO_BATCH_INVALID", "batch not found");
      if (existing.status !== "READY_FOR_REVIEW") throw new AyasMicroBatchStoreError("AYAS_MICRO_BATCH_INVALID", `batch is not ready for review: ${existing.status}`);
      if (existing.batchHash !== batchHashValue) throw new AyasMicroBatchStoreError("AYAS_MICRO_BATCH_INVALID", "batchHash mismatch — the reviewed batch has changed, decision refused");
      const nextStatus: AyasMicroBatchStatus = decision === "APPROVE" ? "APPROVED" : "ACCUMULATING";
      const batch = { ...existing, status: nextStatus, lastUpdatedAt: now };
      const record: AyasMicroBatchDecisionRecord = { decisionId: `ayas-micro-batch-decision-${crypto.randomUUID()}`, batchId, batchHash: existing.batchHash, decision, decidedAt: now, ...(decision === "APPROVE" ? { authorizationId: `ayas-batch-auth-${crypto.randomUUID()}` } : {}) };
      save({ ...state, batches: state.batches.map((b) => b.batchId === batchId ? batch : b), decisions: [...state.decisions, record] });
      return { batch, decision: record };
    },
    markStale(batchId, now) {
      const state = load();
      const existing = state.batches.find((b) => b.batchId === batchId);
      if (!existing) throw new AyasMicroBatchStoreError("AYAS_MICRO_BATCH_INVALID", "batch not found");
      if (!["ACCUMULATING", "READY_FOR_REVIEW", "APPROVED"].includes(existing.status)) {
        throw new AyasMicroBatchStoreError("AYAS_MICRO_BATCH_INVALID", `batch cannot be marked stale from status: ${existing.status}`);
      }
      const updated = { ...existing, status: "STALE" as const, lastUpdatedAt: now };
      save({ ...state, batches: state.batches.map((b) => b.batchId === batchId ? updated : b) });
      return updated;
    },
    reserveApproval(batchId, batchHashValue, baseHead, now) {
      const state = load();
      const batch = state.batches.find((b) => b.batchId === batchId);
      const decision = [...state.decisions].reverse().find((d) => d.batchId === batchId && d.decision === "APPROVE");
      if (!batch || !decision || batch.status !== "APPROVED" || decision.reservedAt) {
        throw new AyasMicroBatchStoreError("AYAS_MICRO_BATCH_INVALID", "approval is missing, stale, or already reserved");
      }
      if (batch.batchHash !== batchHashValue || batch.baseHead !== baseHead) {
        throw new AyasMicroBatchStoreError("AYAS_MICRO_BATCH_INVALID", "approval scope or HEAD is stale");
      }
      if (!decision.authorizationId) throw new AyasMicroBatchStoreError("AYAS_MICRO_BATCH_UNSAFE_APPROVAL", "approval has no authorization");
      const reservationId = `ayas-micro-batch-reservation-${crypto.randomUUID()}`;
      const reserved = { ...decision, reservationId, reservedAt: now };
      const reservedBatch = { ...batch, status: "RESERVED" as const, lastUpdatedAt: now };
      save({ ...state, batches: state.batches.map((b) => b.batchId === batchId ? reservedBatch : b), decisions: state.decisions.map((d) => d.decisionId === decision.decisionId ? reserved : d) });
      return { reservationId, authorizationId: decision.authorizationId, decisionId: decision.decisionId };
    },
    finalizeApproval(reservationId, outcome, now) {
      const state = load();
      const decision = state.decisions.find((d) => d.reservationId === reservationId);
      if (!decision) throw new AyasMicroBatchStoreError("AYAS_MICRO_BATCH_INVALID", "reservation not found");
      if (decision.finalizedAt) throw new AyasMicroBatchStoreError("AYAS_MICRO_BATCH_INVALID", "reservation already finalized");
      const batch = state.batches.find((b) => b.batchId === decision.batchId);
      if (outcome === "EXECUTED" && batch?.status !== "COMPLETED" && batch?.status !== "FAILED" && batch?.status !== "STALE") {
        throw new AyasMicroBatchStoreError("AYAS_MICRO_BATCH_INVALID", "cannot finalize EXECUTED before a result has been durably recorded");
      }
      const finalized = { ...decision, finalizedAt: now, finalizationOutcome: outcome };
      const nextBatches = batch && outcome !== "EXECUTED"
        ? state.batches.map((b) => b.batchId === decision.batchId ? { ...b, status: outcome, lastUpdatedAt: now } : b)
        : state.batches;
      save({ ...state, batches: nextBatches, decisions: state.decisions.map((d) => d.decisionId === decision.decisionId ? finalized : d) });
    },
    recordResult(result, status) {
      const state = load();
      const batch = state.batches.find((b) => b.batchId === result.batchId);
      if (!batch) throw new AyasMicroBatchStoreError("AYAS_MICRO_BATCH_INVALID", "result batch not found");
      save({ ...state, batches: state.batches.map((b) => b.batchId === result.batchId ? { ...b, status, lastUpdatedAt: result.completedAt } : b), results: [...state.results, result].slice(-100) });
    },
  };
}
