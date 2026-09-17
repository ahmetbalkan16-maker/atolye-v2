import { readAyasMicroBatchState, type AyasMicroBatchReadState, type AyasMicroBatchRead, type AyasMicroBatchDecisionRead, type AyasMicroBatchResultRead } from "./AyasMicroBatchReader";
import { createAyasPatchArtifactStore, AyasPatchArtifactError } from "./AyasPatchArtifact";
import type { AyasDevelopmentPatchArtifact, AyasPublicationDisplayState } from "./AyasApprovalInboxView";
import { readAyasPublicationActivity, AYAS_PUBLICATION_ACTIVITY_UNKNOWN, type AyasPublicationActivitySnapshot } from "./AyasPublicationActivity";

/** Approval-race UX hardening (Part A) — the batch-lane analogue of `computeAyasPublicationDisplayState` in `AyasApprovalInboxView.ts`. A batch's "same work" identity is its `exactFilesUnion` (the individual-proposal view uses `exactFiles` the same way) rather than any one item's `semanticKey`, since a regenerated batch is not guaranteed to bundle the exact same item set. */
function computeAyasBatchPublicationDisplayState(
  batch: Pick<AyasMicroBatchRead, "status" | "baseHead" | "exactFilesUnion" | "createdAt" | "batchId">,
  decision: AyasMicroBatchDecisionRead | undefined,
  activity: AyasPublicationActivitySnapshot,
  all: readonly AyasMicroBatchRead[],
): { readonly displayState: AyasPublicationDisplayState; readonly supersededByBatchId?: string } {
  if (batch.status === "STALE") {
    const successor = [...all]
      .filter((b) => (b.status === "ACCUMULATING" || b.status === "READY_FOR_REVIEW") && b.exactFilesUnion.length > 0 && b.exactFilesUnion.some((f) => batch.exactFilesUnion.includes(f)))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
    return successor ? { displayState: "STALE_SUPERSEDED", supersededByBatchId: successor.batchId } : { displayState: "STALE_AWAITING_REDISCOVERY" };
  }
  if (batch.status !== "READY_FOR_REVIEW" && batch.status !== "APPROVED") return { displayState: "NORMAL" };
  if (activity.publicationActive) {
    const ownsReservation = Boolean(decision?.reservedAt) && !decision?.finalizedAt;
    return { displayState: ownsReservation ? "EXECUTING_NOW" : "WAITING_OTHER_PUBLICATION" };
  }
  if (activity.liveCurrentHead && activity.liveCurrentHead !== batch.baseHead) return { displayState: "REVALIDATING_FOR_NEW_HEAD" };
  return { displayState: "NORMAL" };
}

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
  /** Approval-race UX hardening (Part A) — see `computeAyasBatchPublicationDisplayState`. Purely descriptive; never gates or grants anything. */
  readonly displayState: AyasPublicationDisplayState;
  /** Set only when `displayState === "STALE_SUPERSEDED"`. */
  readonly supersededByBatchId?: string;
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

function enrich(batch: AyasMicroBatchRead, decisions: readonly AyasMicroBatchDecisionRead[], results: readonly AyasMicroBatchResultRead[], activity: AyasPublicationActivitySnapshot, all: readonly AyasMicroBatchRead[]): AyasMicroBatchDevelopmentEntry {
  const decision = [...decisions].reverse().find((d) => d.batchId === batch.batchId);
  const { displayState, supersededByBatchId } = computeAyasBatchPublicationDisplayState(batch, decision, activity, all);
  return {
    ...batch,
    items: batch.items.map((item) => ({ microItemId: item.microItemId, semanticKey: item.semanticKey, exactFiles: item.exactFiles, patchArtifact: loadItemArtifact(item.patchArtifactId) })),
    decision,
    result: [...results].reverse().find((r) => r.batchId === batch.batchId),
    displayState,
    supersededByBatchId,
  };
}

const ACTIVE_STATUSES = new Set<AyasMicroBatchRead["status"]>(["ACCUMULATING", "READY_FOR_REVIEW"]);

/** Pure: builds the view from an already-read state object — no filesystem access of its own (besides each item's artifact resolution, which uses the default artifact store exactly like `buildAyasApprovalInboxView` does). Exported so tests can construct `AyasMicroBatchReadState` in memory, the same convention `buildAyasApprovalInboxView` already established. */
export function buildAyasMicroBatchDevelopmentView(state: AyasMicroBatchReadState, activity: AyasPublicationActivitySnapshot = AYAS_PUBLICATION_ACTIVITY_UNKNOWN): AyasMicroBatchDevelopmentView {
  const activeRaw = state.batches.find((b) => ACTIVE_STATUSES.has(b.status)) ?? null;
  const historyRaw = state.batches.filter((b) => !ACTIVE_STATUSES.has(b.status)).slice(-20).reverse();
  return {
    connected: true,
    active: activeRaw ? enrich(activeRaw, state.decisions, state.results, activity, state.batches) : null,
    history: historyRaw.map((b) => enrich(b, state.decisions, state.results, activity, state.batches)),
  };
}

export function loadAyasMicroBatchDevelopmentView(): AyasMicroBatchDevelopmentView {
  try {
    return buildAyasMicroBatchDevelopmentView(readAyasMicroBatchState(), readAyasPublicationActivity());
  } catch (error) {
    return { connected: false, active: null, history: [], error: error instanceof Error ? error.message : String(error) };
  }
}
