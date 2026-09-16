import type { AyasMicroBatchStoreHandle, AyasMicroBatch } from "./AyasMicroBatch";

/**
 * M18 — the batch analogue of `AyasProposalStaleness.ts`, same posture:
 * pure staleness reconciliation, zero dependency on any execution/authority
 * module, safe to call from both write-capable Server Actions and the
 * discovery daemon. Transitions every ACCUMULATING/READY_FOR_REVIEW/
 * APPROVED batch whose `baseHead` no longer matches `currentHead` to
 * `STALE` — the batch-level instance of the M17 DEFERRED-stale-lifecycle
 * fix: an APPROVED-but-not-yet-executed batch bound to a superseded HEAD
 * must not stay executable once the branch moves on. RESERVED is
 * deliberately excluded (may be mid-execution under the authority lock),
 * exactly like the proposal-level reconciliation.
 */
export function reconcileAyasMicroBatchStaleness(store: AyasMicroBatchStoreHandle, currentHead: string, now: string): readonly AyasMicroBatch[] {
  const state = store.load();
  const RECONCILABLE = new Set(["ACCUMULATING", "READY_FOR_REVIEW", "APPROVED"]);
  const stale = state.batches.filter((batch) => RECONCILABLE.has(batch.status) && batch.baseHead !== currentHead);
  return stale.map((batch) => store.markStale(batch.batchId, now));
}
