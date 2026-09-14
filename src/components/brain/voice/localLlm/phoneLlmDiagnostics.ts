/**
 * AYAS phone-local LLM — full-chain diagnostics (closure sprint).
 *
 * Every prior real-device failure in this experiment (100%→reload jetsam;
 * clone()/tee cache.put() hang; then a DOWNLOAD-phase hang even after
 * bounded timeouts were added) has had a strong, evidenced explanatory
 * category that was NOT being distinguished from the others at the time:
 * iOS backgrounding. `useScreenWakeLock.ts` (already shipped for AYAS's
 * voice flow — see ITS header comment) documents the exact same symptom
 * independently: "the biggest cause of 'the page reloaded itself after a
 * few minutes' is the device screen Auto-Lock: the backgrounded WebKit page
 * is suspended, then its web-content process is evicted." A `setTimeout`
 * (this module's own bounded timeouts included) does not reliably fire
 * while a tab is backgrounded/suspended either — so a hang that survives a
 * timeout is itself evidence of backgrounding, not proof the timeout logic
 * is broken.
 *
 * This module makes that distinguishable INSTEAD OF guessed. Two
 * granularities:
 *
 *  FILE-level (one per required file):
 *   download:start / download:end
 *   persist:start / persist:end
 *   verify:start / verify:end
 *   runtime:start / runtime:end
 *   generation:start / generation:first-token / generation:end
 *
 *  CHUNK-level (one per ~8MB Range request — closure sprint follow-up: a
 *  real device's LAST checkpoint was "download:start" with nothing after,
 *  which cannot distinguish "died before the first byte" from "died on
 *  chunk 57 of 58" — exactly the gap these close):
 *   chunk:start / chunk:fetch_start / chunk:response_received /
 *   chunk:response_status / chunk:content_range / chunk:reader_start /
 *   chunk:first_bytes / chunk:bytes_progress / chunk:reader_complete /
 *   chunk:idb_write_start / chunk:idb_write_complete / chunk:complete
 *
 *  MEMORY-level (process-death diagnostic follow-up: two isolated tests —
 *  one 8MB network+IndexedDB round trip, one pure IndexedDB round trip —
 *  both PASSED on real device, while the full ~58-chunk loop still died
 *  right after `chunk:reader_complete`; "single unit fine, many units in a
 *  row fail" is the signature of accumulation across iterations, so these
 *  exist to test that directly rather than assert it — see
 *  `phoneLlmMemoryProbe.ts`'s header for exactly what each can and cannot
 *  prove):
 *   chunk:memory_sample (before/after each chunk's IndexedDB write —
 *     `performance.memory` if available, honestly reports "unavailable"
 *     otherwise)
 *   chunk:buffer_finalized (a `FinalizationRegistry` callback confirming
 *     the ENGINE ITSELF reclaimed a specific past chunk's buffer — real
 *     evidence of release, not an inference from scope)
 *   chunk:finalization_unsupported (recorded once if `FinalizationRegistry`
 *     isn't available, so the report can state plainly whether that proof
 *     mechanism was even active on this device)
 *   chunk:concurrency_violation (would fire if more than one chunk were
 *     ever in flight at once — proof by absence for the normal case)
 *
 * plus `visibility:hidden` / `visibility:visible` — added because every
 * checkpoint above is meaningless for diagnosis without knowing whether the
 * tab was foregrounded at the time.
 *
 * Each checkpoint is written to `sessionStorage` (survives an iOS
 * WebKit-relaunch of the SAME tab, unlike in-memory state) as both the
 * latest single value (`ayas.phoneLlm.checkpoint.v3`) and appended to a
 * bounded rolling history (`ayas.phoneLlm.history.v3`, last `HISTORY_LIMIT`
 * entries — sized to comfortably cover several chunks' worth of trail, not
 * just one, so "which of the last few chunks succeeded before this one
 * failed" is visible, not just the single last event) — the single value
 * answers "where did it stop", the history answers "what led up to it"
 * (e.g. a `visibility:hidden` right before the gap makes the cause legible
 * without guessing). Read once on mount, then a fresh recording starts — a
 * normal completion (`generation:end` with no error, or reaching "ready")
 * clears it, so a stale value found on a later mount is specifically
 * evidence of an ABRUPT, never-cleanly-ended prior attempt.
 *
 * `bytes_progress` is throttled to roughly once per `PROGRESS_THROTTLE_BYTES`
 * (1 MiB) of a chunk's OWN read progress — recording every individual
 * `reader.read()` call (which for one 8MB chunk can be hundreds of small
 * network-level reads) would itself be meaningful sessionStorage-write
 * overhead on a real device and blow through the history window instantly.
 *
 * No secrets: only checkpoint names, a file name, a chunk index, byte
 * counts/percent, a short free-form technical detail string (HTTP status,
 * `Content-Range` header value — never anything from a request/response
 * BODY), and timestamps.
 */

export type PhoneLlmCheckpointName =
  | "download:start"
  | "download:end"
  | "persist:start"
  | "persist:end"
  | "verify:start"
  | "verify:end"
  | "runtime:start"
  | "runtime:end"
  | "generation:start"
  | "generation:first-token"
  | "generation:end"
  | "visibility:hidden"
  | "visibility:visible"
  | "chunk:start"
  | "chunk:fetch_start"
  | "chunk:response_received"
  | "chunk:response_status"
  | "chunk:content_range"
  | "chunk:reader_start"
  | "chunk:first_bytes"
  | "chunk:bytes_progress"
  | "chunk:reader_complete"
  | "chunk:idb_write_start"
  | "chunk:idb_write_complete"
  | "chunk:complete"
  /** Memory-pressure retention audit (process-death diagnostic pass) —
   *  see `phoneLlmMemoryProbe.ts`'s header for what each of these can and
   *  cannot prove. */
  | "chunk:memory_sample"
  | "chunk:buffer_finalized"
  | "chunk:finalization_unsupported"
  | "chunk:concurrency_violation"
  /** Real-device evidence: `chunk:reader_complete [483003582]` for
   *  `chunk=0` proved a Range request's response was NOT actually bounded
   *  to one chunk — `fetchOneChunk()` now checks status BEFORE reading the
   *  body (never after) and, for a mismatch, records this and cancels the
   *  body unread rather than buffering it — see
   *  `phoneLlmPrecacheDownloader.ts`'s header for the full proof and fix. */
  | "chunk:aborted_unexpected_status"
  /** TEMPORARY diagnostic (gateway-routing trace pass): fired exactly once
   *  per file, right after `resolvePhoneLlmNetworkFetch()` resolves and
   *  BEFORE any network call — records the exact URL that is about to be
   *  fetched and whether a gateway route matched, so a real device's
   *  request target can be read back from the checkpoint trail instead of
   *  guessed. `detail` NEVER contains the Authorization header value or any
   *  other secret — only the URL, the matched gateway route's proxy path
   *  (or "direct-hf" if none matched), and a boolean for whether an auth
   *  header is present. Safe to remove once the gateway-routing question
   *  this exists to answer is settled. */
  | "chunk:network_target"
  /** ROUND 6 (real gateway-request trace pass): a `fetch()` call itself
   *  rejected (before any response was received) — fires once per retry
   *  attempt inside `fetchOneChunk`'s bounded retry loop. `detail` is the
   *  attempt number and the rejection's own error name/message (a generic
   *  browser string, e.g. "TypeError: Type error") — NEVER anything from
   *  the request's Authorization header, which this codebase never logs
   *  anywhere. */
  | "chunk:fetch_retry";

export interface PhoneLlmCheckpointEntry {
  readonly name: PhoneLlmCheckpointName;
  readonly modelId: string | null;
  readonly file: string | null;
  readonly percent: number | null;
  readonly chunkIndex: number | null;
  /** Short, free-form technical detail — an HTTP status code, a `Content-Range` header value, a loaded-byte count. Never anything from a request/response body. */
  readonly detail: string | null;
  readonly at: number;
}

const LATEST_KEY = "ayas.phoneLlm.checkpoint.v4";
const HISTORY_KEY = "ayas.phoneLlm.history.v4";
const PROGRESS_TAIL_KEY = "ayas.phoneLlm.progressTail.v4";
/** ~10+ chunks' worth of MILESTONE trail — now that `chunk:bytes_progress`
 *  is routed to its own separate tail (below) instead of competing for
 *  these slots, 100 milestone-only entries comfortably covers many chunks,
 *  not just the tail of one. Real-device evidence (process-death
 *  diagnostic follow-up): a single chunk's `bytes_progress` ticks alone
 *  filled essentially this entire window before the fix below, evicting
 *  every other checkpoint type — including ones from EARLIER in the SAME
 *  chunk (`chunk:start`, `chunk:fetch_start`, `chunk:response_status`,
 *  `chunk:content_range`) and everything from every prior file/chunk. */
const HISTORY_LIMIT = 100;
/** How often (in bytes of ONE chunk's own progress) a `chunk:bytes_progress` checkpoint is recorded — throttled to bound the RATE of writes; kept out of the milestone history entirely (see `HIGH_FREQUENCY_NAMES`) to bound their VOLUME too. */
export const PROGRESS_THROTTLE_BYTES = 1024 * 1024;
/** Only the last few progress ticks matter for diagnosis ("how far did the dying read get") — bounded small and kept in its own key so it can never crowd out a milestone checkpoint. */
const PROGRESS_TAIL_LIMIT = 5;

/** Checkpoint names that are expected to fire many times per chunk (unlike every other name, which fires once) — routed to `PROGRESS_TAIL_KEY` instead of `HISTORY_KEY`, see file header. */
const HIGH_FREQUENCY_NAMES: ReadonlySet<PhoneLlmCheckpointName> = new Set(["chunk:bytes_progress"]);

function safeSessionStorage(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null; // Private-mode / storage-access-restricted contexts.
  }
}

/** Records one checkpoint. Never throws — a diagnostics failure must never affect the actual download/runtime flow it's observing. High-frequency names (currently only `chunk:bytes_progress`) never occupy a milestone-history slot — see file header. */
export function recordPhoneLlmCheckpoint(
  name: PhoneLlmCheckpointName,
  detail: { modelId?: string | null; file?: string | null; percent?: number | null; chunkIndex?: number | null; detail?: string | null } = {},
): void {
  const storage = safeSessionStorage();
  if (!storage) return;
  const entry: PhoneLlmCheckpointEntry = {
    name,
    modelId: detail.modelId ?? null,
    file: detail.file ?? null,
    percent: detail.percent ?? null,
    chunkIndex: detail.chunkIndex ?? null,
    detail: detail.detail ?? null,
    at: Date.now(),
  };
  try {
    // Always updated, regardless of frequency class — this is "the literal
    // last thing that happened", milestone or not.
    storage.setItem(LATEST_KEY, JSON.stringify(entry));

    if (HIGH_FREQUENCY_NAMES.has(name)) {
      const tailRaw = storage.getItem(PROGRESS_TAIL_KEY);
      const tail: PhoneLlmCheckpointEntry[] = tailRaw ? JSON.parse(tailRaw) : [];
      tail.push(entry);
      while (tail.length > PROGRESS_TAIL_LIMIT) tail.shift();
      storage.setItem(PROGRESS_TAIL_KEY, JSON.stringify(tail));
      return; // never touches the milestone history
    }

    const historyRaw = storage.getItem(HISTORY_KEY);
    const history: PhoneLlmCheckpointEntry[] = historyRaw ? JSON.parse(historyRaw) : [];
    history.push(entry);
    while (history.length > HISTORY_LIMIT) history.shift();
    storage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch {
    /* best-effort only */
  }
}

/** A clean end to the current attempt (success OR a handled error — either way the page was alive to record it) — clears all keys so a later mount only ever finds a breadcrumb from a genuinely abrupt termination. */
export function clearPhoneLlmCheckpoints(): void {
  const storage = safeSessionStorage();
  if (!storage) return;
  try {
    storage.removeItem(LATEST_KEY);
    storage.removeItem(HISTORY_KEY);
    storage.removeItem(PROGRESS_TAIL_KEY);
  } catch {
    /* best-effort only */
  }
}

export interface PhoneLlmStaleCheckpoint {
  readonly latest: PhoneLlmCheckpointEntry;
  readonly history: readonly PhoneLlmCheckpointEntry[];
  /** The last few `chunk:bytes_progress` ticks — separate from `history` on purpose, see file header. Empty if none were recorded (or the high-frequency channel itself was never reached). */
  readonly progressTail: readonly PhoneLlmCheckpointEntry[];
}

/** Reads (and clears) whatever was left over from a prior attempt that never reached a clean end. Call exactly once, on mount. */
export function readAndClearStalePhoneLlmCheckpoints(): PhoneLlmStaleCheckpoint | null {
  const storage = safeSessionStorage();
  if (!storage) return null;
  try {
    const latestRaw = storage.getItem(LATEST_KEY);
    if (!latestRaw) return null;
    const latest: PhoneLlmCheckpointEntry = JSON.parse(latestRaw);
    const historyRaw = storage.getItem(HISTORY_KEY);
    const history: PhoneLlmCheckpointEntry[] = historyRaw ? JSON.parse(historyRaw) : [];
    const tailRaw = storage.getItem(PROGRESS_TAIL_KEY);
    const progressTail: PhoneLlmCheckpointEntry[] = tailRaw ? JSON.parse(tailRaw) : [];
    storage.removeItem(LATEST_KEY);
    storage.removeItem(HISTORY_KEY);
    storage.removeItem(PROGRESS_TAIL_KEY);
    return { latest, history, progressTail };
  } catch {
    return null;
  }
}

/**
 * Whether the two most recent history entries bracket a `visibility:hidden`
 * with no matching `visibility:visible` before the stale point — i.e. the
 * tab was backgrounded and (per the evidence in this file's header) likely
 * never got to run JS again before whatever killed/relaunched it. Used to
 * word the crash-recovery banner accurately instead of guessing "bellek
 * sınırı" every time.
 */
export function wasLikelyBackgrounded(stale: PhoneLlmStaleCheckpoint): boolean {
  for (let i = stale.history.length - 1; i >= 0; i -= 1) {
    const name = stale.history[i].name;
    if (name === "visibility:hidden") return true;
    if (name === "visibility:visible") return false;
  }
  return false;
}

/**
 * Wires `visibilitychange` so every hidden/visible transition is itself a
 * checkpoint — this is what turns "silently stuck" into "stuck WHILE
 * backgrounded" vs. "stuck while foregrounded" in the history. Call once
 * per active page lifetime (e.g. one `useEffect`); returns the cleanup.
 */
export function watchPhoneLlmVisibility(modelId: string | null): () => void {
  if (typeof document === "undefined") return () => {};
  const onChange = () => {
    recordPhoneLlmCheckpoint(document.visibilityState === "hidden" ? "visibility:hidden" : "visibility:visible", {
      modelId,
    });
  };
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}
