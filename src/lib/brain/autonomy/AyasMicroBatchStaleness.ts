import type { AyasMicroBatchStoreHandle, AyasMicroBatch } from "./AyasMicroBatch";
import type { AyasMicroItemStore } from "./AyasMicroItem";

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
 *
 * A STALE batch's own member items are a separate durable record
 * (`AyasMicroItem`, one file per item) and are never implicitly staled by
 * the batch transition above — without the orphan pass below, an item left
 * in `BATCHED` state would stay there forever, and the accumulator's own
 * cross-tick dedup (`findBySemanticKey(...).some(item => item.state !==
 * "REJECTED" && item.state !== "SUPERSEDED")`) would treat it as still
 * active, permanently blocking that semanticKey from ever being
 * rediscovered. `supersedeStaleBatchOrphans` closes that gap.
 */
function supersedeStaleBatchOrphans(batchStore: AyasMicroBatchStoreHandle, itemStore: AyasMicroItemStore, now: string): void {
  const state = batchStore.load();
  for (const batch of state.batches) {
    if (batch.status !== "STALE") continue;
    for (const ref of batch.items) {
      let item;
      try { item = itemStore.load(ref.microItemId); } catch { continue; } // a missing item file must never abort reconciliation for the rest of the batch (fail-soft, matches the artifact-load fail-safe posture elsewhere in M17/M18)
      if (item.state !== "BATCHED") continue; // guarded transition: never touches an item already at a later terminal state (EXECUTED/REJECTED/SUPERSEDED) or still pre-batch (DISCOVERED/SANDBOX_VALIDATED)
      itemStore.transition(ref.microItemId, "SUPERSEDED", now);
    }
  }
}

/**
 * Scans EVERY currently-STALE batch for lingering `BATCHED` items, not just
 * batches staled in this same call — this is what makes the whole pass
 * idempotent and crash-safe. There is no cross-file transaction between the
 * batch store and the item store (two separate durable JSON stores, exactly
 * like every other dual-store pairing in this codebase); instead, a crash at
 * any point between "batch marked STALE" and "its items marked SUPERSEDED"
 * self-heals on the very next call, because that batch is still found here
 * (its status is already STALE) regardless of who staled it or when.
 */
export function reconcileAyasMicroBatchStaleness(store: AyasMicroBatchStoreHandle, itemStore: AyasMicroItemStore, currentHead: string, now: string): readonly AyasMicroBatch[] {
  const state = store.load();
  const RECONCILABLE = new Set(["ACCUMULATING", "READY_FOR_REVIEW", "APPROVED"]);
  const stale = state.batches.filter((batch) => RECONCILABLE.has(batch.status) && batch.baseHead !== currentHead);
  const staled = stale.map((batch) => store.markStale(batch.batchId, now));
  supersedeStaleBatchOrphans(store, itemStore, now);
  return staled;
}

export { supersedeStaleBatchOrphans };
