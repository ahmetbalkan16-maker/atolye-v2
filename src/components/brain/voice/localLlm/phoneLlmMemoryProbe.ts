/**
 * AYAS phone-local LLM — memory-pressure diagnostic probes (Cache Storage
 * blocker closure sprint: process-death lifecycle/retention audit).
 *
 * WHY THIS EXISTS: two isolated real-device tests now PASS (one 8MB
 * network→IndexedDB round trip; a pure IndexedDB round trip) while the
 * full ~58-chunk loop still dies, consistently right after
 * `chunk:reader_complete`. That pattern — single unit fine, many units in
 * a row fail — is the signature of ACCUMULATION across iterations, not a
 * defect in any one chunk's own logic (already re-audited, still clean —
 * see `phoneLlmPrecacheDownloader.ts`'s header). This module gives the
 * loop two REAL, code-level ways to test that hypothesis instead of just
 * asserting it:
 *
 *  1. `sampleMemoryMb()` — `performance.memory` (Chrome/Chromium-lineage
 *     only; feature-detected, never assumed present) sampled at the exact
 *     boundary the diagnostic sprint asked about
 *     (`chunk:reader_complete` → `chunk:idb_write_start`) and again after
 *     each write. A monotonically climbing trend across chunks is real
 *     evidence of growth; a flat/sawtooth trend is evidence against a
 *     JS-heap-side leak specifically (it does NOT rule out native/engine
 *     memory growth outside the JS heap — see this module's second half).
 *
 *  2. `trackBufferFinalization()` — a `FinalizationRegistry` (WebKit/
 *     JavaScriptCore has supported it since Safari 14.1, so any
 *     reasonably current iOS should have it) registered against EACH
 *     chunk's `Uint8Array` right after it's hand off to storage. The
 *     callback firing is the browser ENGINE ITSELF confirming that
 *     specific object was reclaimed — not an inference from "the
 *     reference went out of scope, so it SHOULD be collectible". No
 *     spec-guaranteed timing (an engine may delay or, in principle, never
 *     call it before the page dies) — so a callback NOT firing is
 *     inconclusive on its own, but callbacks firing for early chunks and
 *     then silently stopping partway through would be real, first-hand
 *     evidence of retention starting at a specific chunk.
 *
 * WHAT THIS MODULE DELIBERATELY CANNOT DO — stated plainly rather than
 * implied: neither of the above can observe WebKit's own native
 * (Objective-C/C++) memory — its IndexedDB connection/transaction
 * bookkeeping, its own fetch/network buffer pooling, or total process RSS.
 * There is no API exposed to a web page for any of that, and no
 * memory-pressure warning event either (unlike a native iOS app's
 * `didReceiveMemoryWarning`) — this is a deliberate web-platform
 * restriction (fingerprinting/DoS surface), not an oversight here. If the
 * true cause lives at that layer, it is invisible to this module or any
 * other JS code, and only reachable via elimination (this module ruling
 * OUT the JS-heap-side explanation makes the native-layer explanation
 * comparatively stronger, but never directly observed).
 */

export interface MemorySample {
  readonly usedMb: number | null;
  readonly totalMb: number | null;
  readonly limitMb: number | null;
  readonly available: boolean;
}

/** `performance.memory` is a non-standard Chrome/Chromium-lineage extension — feature-detected, never assumed. iOS Chrome uses WebKit's own JS engine (JavaScriptCore, not V8) under the hood per Apple's platform policy, so this may legitimately be unavailable there even though the browser is branded "Chrome"; `available: false` is a real, expected, honestly-reported outcome, not an error. */
export function sampleMemoryMb(): MemorySample {
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
  if (!mem) return { usedMb: null, totalMb: null, limitMb: null, available: false };
  return {
    usedMb: Math.round(mem.usedJSHeapSize / 1024 / 1024),
    totalMb: Math.round(mem.totalJSHeapSize / 1024 / 1024),
    limitMb: Math.round(mem.jsHeapSizeLimit / 1024 / 1024),
    available: true,
  };
}

export function formatMemorySample(sample: MemorySample): string {
  return sample.available ? `used=${sample.usedMb}MB total=${sample.totalMb}MB limit=${sample.limitMb}MB` : "unavailable";
}

export function isFinalizationRegistrySupported(): boolean {
  return typeof FinalizationRegistry !== "undefined";
}

interface FinalizationHeldValue {
  readonly chunkIndex: number;
  readonly createdAt: number;
  readonly onFinalized: (chunkIndex: number, elapsedMs: number) => void;
}

let sharedRegistry: FinalizationRegistry<FinalizationHeldValue> | null | undefined;

function getSharedRegistry(): FinalizationRegistry<FinalizationHeldValue> | null {
  if (sharedRegistry !== undefined) return sharedRegistry;
  if (!isFinalizationRegistrySupported()) {
    sharedRegistry = null;
    return null;
  }
  sharedRegistry = new FinalizationRegistry<FinalizationHeldValue>((held) => {
    held.onFinalized(held.chunkIndex, Date.now() - held.createdAt);
  });
  return sharedRegistry;
}

/**
 * Registers `buffer` so `onFinalized(chunkIndex, elapsedMs)` fires
 * (best-effort, no timing guarantee — see file header) once the engine
 * actually reclaims it. A safe no-op when `FinalizationRegistry` isn't
 * supported — callers should record that absence once via
 * `isFinalizationRegistrySupported()` rather than assume every chunk got
 * tracked.
 */
export function trackBufferFinalization(buffer: Uint8Array, chunkIndex: number, onFinalized: (chunkIndex: number, elapsedMs: number) => void): void {
  const registry = getSharedRegistry();
  if (!registry) return;
  registry.register(buffer, { chunkIndex, createdAt: Date.now(), onFinalized });
}

/**
 * Counts chunks currently "in flight" (between `chunk:start` and
 * `chunk:complete`) — proof, not assumption, that the sequential download
 * loop never has more than one chunk's fetch+read+write active at once.
 * `enter()` returns the count AFTER incrementing (so a value > 1 is
 * itself the violation); `exit()` decrements. A tiny, dependency-free
 * module-level counter — deliberately not tied to a specific file/model,
 * since the invariant it checks ("never more than one at a time") is
 * global to this whole download subsystem, not per-file.
 */
let inFlightChunkCount = 0;
export function enterChunkInFlight(): number {
  inFlightChunkCount += 1;
  return inFlightChunkCount;
}
export function exitChunkInFlight(): number {
  inFlightChunkCount = Math.max(0, inFlightChunkCount - 1);
  return inFlightChunkCount;
}
