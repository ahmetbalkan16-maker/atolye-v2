/**
 * M18 — server-owned, deterministic batch size/age bounds. Never
 * configurable from proposal/candidate text or client input, exactly like
 * `AyasPatchDetectors.ts`'s `AYAS_NOVEL_PATCH_MAX_*` constants.
 */
export const AYAS_MICRO_BATCH_MAX_ITEMS = 8;
export const AYAS_MICRO_BATCH_MAX_FILES = 8;
export const AYAS_MICRO_BATCH_MAX_TOTAL_LINES = 2000;
export const AYAS_MICRO_BATCH_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** A batch becomes review-ready once it holds at least this many items (below the hard cap), so the human isn't interrupted for a single tiny item. */
export const AYAS_MICRO_BATCH_READY_ITEM_THRESHOLD = 3;
/** Bounded attempts per discovery tick — mirrors `AyasNovelPatchDiscovery`'s own `maxAttemptsPerTick` default. */
export const AYAS_MICRO_BATCH_MAX_ATTEMPTS_PER_TICK = 2;

export interface AyasMicroBatchReadiness {
  readonly ready: boolean;
  readonly reason: string;
}

export function evaluateAyasMicroBatchReadiness(itemCount: number, createdAt: string, now: string): AyasMicroBatchReadiness {
  if (itemCount === 0) return { ready: false, reason: "empty batch" };
  if (itemCount >= AYAS_MICRO_BATCH_MAX_ITEMS) return { ready: true, reason: `hard item cap reached (${itemCount} >= ${AYAS_MICRO_BATCH_MAX_ITEMS})` };
  if (itemCount >= AYAS_MICRO_BATCH_READY_ITEM_THRESHOLD) return { ready: true, reason: `item threshold reached (${itemCount} >= ${AYAS_MICRO_BATCH_READY_ITEM_THRESHOLD})` };
  const ageMs = Date.parse(now) - Date.parse(createdAt);
  if (Number.isFinite(ageMs) && ageMs >= AYAS_MICRO_BATCH_MAX_AGE_MS) return { ready: true, reason: `age threshold reached (${Math.round(ageMs / 3_600_000)}h)` };
  return { ready: false, reason: `below thresholds (${itemCount} item(s), waiting for more or for age`+`)` };
}
