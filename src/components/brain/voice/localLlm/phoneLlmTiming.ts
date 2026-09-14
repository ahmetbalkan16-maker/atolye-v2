/**
 * AYAS phone-local LLM — shared bounded-timeout helper (closure sprint).
 *
 * Used by both `phoneLlmPrecacheDownloader.ts` (fetch/persist/verify) and
 * `phoneLlmRunner.ts` (runtime/session init) so every long-running step in
 * the chain has an explicit, distinct ceiling instead of one implicit
 * "wait forever" default.
 *
 * IMPORTANT, same caveat everywhere it's used: `Promise.race` cannot cancel
 * the loser. Neither `fetch()`, `Cache.put()`/`Cache.match()`, nor
 * `pipeline()` accept an `AbortSignal` for this purpose in the relevant
 * spec/library surface. A timeout here means "stop waiting and report a
 * typed failure to the caller" — the real underlying operation may still be
 * running natively after we've given up on it. Where that matters
 * (persisting a huge file, initializing a WebGPU session) a subsequent
 * retry's own "already there?" check is what makes this safe rather than
 * wasteful: if the abandoned operation eventually succeeds in the
 * background, the retry simply finds it already done.
 */

export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}
