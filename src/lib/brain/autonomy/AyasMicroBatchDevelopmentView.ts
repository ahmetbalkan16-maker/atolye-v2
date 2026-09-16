import { readAyasMicroBatchState, type AyasMicroBatchReadState, type AyasMicroBatchRead, type AyasMicroBatchDecisionRead, type AyasMicroBatchResultRead } from "./AyasMicroBatchReader";
import { createAyasPatchArtifactStore, AyasPatchArtifactError } from "./AyasPatchArtifact";
import type { AyasDevelopmentPatchArtifact } from "./AyasApprovalInboxView";

/**
 * M18 — the batch analogue of `AyasApprovalInboxView.ts`, same read-only
 * posture: everything here is derived from the durable micro-batch-inbox
 * file (via `AyasMicroBatchReader`, never the write-capable store) plus each
 * item's own frozen `AyasPatchArtifact` (read+verify only — the same call
 * the individual-proposal view already makes). This module never decides,
 * reserves, finalizes, or transitions anything.
 */
export interface AyasMicroBatchDevelopmentItem {
  readonly microItemId: string;
  readonly semanticKey: string;
  readonly exactFiles: readonly string[];
  readonly patchArtifact?: AyasDevelopmentPatchArtifact;
}

export interface AyasMicroBatchDevelopmentEntry extends Omit<AyasMicroBatchRead, "items"> {
  readonly items: readonly AyasMicroBatchDevelopmentItem[];
  readonly decision?: AyasMicroBatchDecisionRead;
  readonly result?: AyasMicroBatchResultRead;
}

export interface AyasMicroBatchDevelopmentView {
  readonly connected: boolean;
  /** The single ACCUMULATING or READY_FOR_REVIEW batch, if any — there is at most one active batch by construction (`AyasMicroBatchAccumulator`). */
  readonly active: AyasMicroBatchDevelopmentEntry | null;
  /** Past batches (APPROVED/RESERVED/COMPLETED/FAILED/STALE/ABANDONED/RECOVERY_REQUIRED), most recent first. */
  readonly history: readonly AyasMicroBatchDevelopmentEntry[];
  readonly error?: string;
}

function loadItemArtifact(patchArtifactId: string): AyasDevelopmentPatchArtifact | undefined {
  try {
    const artifact = createAyasPatchArtifactStore().loadVerified(patchArtifactId);
    return {
      patchArtifactId: artifact.artifactId,
      patchHash: artifact.patchHash,
      generatorIdentity: artifact.generatorIdentity,
      diffPreview: artifact.replacements.map((r) => ({ filePath: r.filePath, content: r.content, isNewFile: r.expectedHash === null })),
      validatorScripts: artifact.validatorScripts,
      sandboxValidationSummary: artifact.sandboxValidationSummary,
    };
  } catch (error) {
    // A missing/corrupt artifact must never break the whole batch panel —
    // same fail-safe-for-display posture as the individual-proposal view.
    void (error instanceof AyasPatchArtifactError ? error.code : error);
    return undefined;
  }
}

function enrich(batch: AyasMicroBatchRead, decisions: readonly AyasMicroBatchDecisionRead[], results: readonly AyasMicroBatchResultRead[]): AyasMicroBatchDevelopmentEntry {
  return {
    ...batch,
    items: batch.items.map((item) => ({ microItemId: item.microItemId, semanticKey: item.semanticKey, exactFiles: item.exactFiles, patchArtifact: loadItemArtifact(item.patchArtifactId) })),
    decision: [...decisions].reverse().find((d) => d.batchId === batch.batchId),
    result: [...results].reverse().find((r) => r.batchId === batch.batchId),
  };
}

const ACTIVE_STATUSES = new Set<AyasMicroBatchRead["status"]>(["ACCUMULATING", "READY_FOR_REVIEW"]);

/** Pure: builds the view from an already-read state object — no filesystem access of its own (besides each item's artifact resolution, which uses the default artifact store exactly like `buildAyasApprovalInboxView` does). Exported so tests can construct `AyasMicroBatchReadState` in memory, the same convention `buildAyasApprovalInboxView` already established. */
export function buildAyasMicroBatchDevelopmentView(state: AyasMicroBatchReadState): AyasMicroBatchDevelopmentView {
  const activeRaw = state.batches.find((b) => ACTIVE_STATUSES.has(b.status)) ?? null;
  const historyRaw = state.batches.filter((b) => !ACTIVE_STATUSES.has(b.status)).slice(-20).reverse();
  return {
    connected: true,
    active: activeRaw ? enrich(activeRaw, state.decisions, state.results) : null,
    history: historyRaw.map((b) => enrich(b, state.decisions, state.results)),
  };
}

export function loadAyasMicroBatchDevelopmentView(): AyasMicroBatchDevelopmentView {
  try {
    return buildAyasMicroBatchDevelopmentView(readAyasMicroBatchState());
  } catch (error) {
    return { connected: false, active: null, history: [], error: error instanceof Error ? error.message : String(error) };
  }
}
