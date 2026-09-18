import { ayasSafePublicFetch, type AyasFetchFailureClass } from "./AyasSafePublicFetch";
import { createAyasResearchSourceStateStore, ayasContentHash, type AyasResearchSourceCheckState, type AyasResearchSourceStateStore } from "./AyasResearchSourceStateStore";
import { resolveAyasResearchSourceRegistry, resolveAyasResearchSourcePolicy, type AyasResearchSource } from "./AyasResearchSourceRegistry";

/**
 * AYAS CONTINUOUS EXTERNAL INTELLIGENCE sprint, Part E — the LIGHT scan.
 * NOT a full analysis pass: for every registered source, it does the
 * cheapest possible "did anything change" check (conditional GET via
 * ETag/Last-Modified when a prior check recorded one, else a fresh fetch
 * compared by content hash) and persists that verdict. It never calls a
 * model and never records an `AyasExternalResearchFinding` — an unchanged
 * source is never sent through the expensive DEEP path again (Part E's own
 * explicit requirement).
 *
 * Failure is soft and per-source: one source erroring (network failure,
 * blocked by the SSRF boundary, bad content-type) never aborts the scan for
 * the rest of the registry, and a repeatedly-failing source backs off
 * (`AYAS_LIGHT_SCAN_BASE_BACKOFF_MS`, doubling up to
 * `AYAS_LIGHT_SCAN_MAX_BACKOFF_MS`) instead of being re-attempted on every
 * single scheduler tick — "no rapid retry loops" (Part B).
 */
export type AyasLightScanSourceStatus = "OK" | "ERROR" | "SKIPPED_BACKOFF" | "SKIPPED_RATE_POLICY";

export interface AyasLightScanSourceResult {
  readonly sourceId: string;
  readonly changed: boolean;
  readonly status: AyasLightScanSourceStatus;
  readonly error?: string;
  /** Present only on ERROR — the taxonomy class, so a caller can tell a blip from a dead endpoint without string-matching. */
  readonly failureClass?: AyasFetchFailureClass;
  /** True when the change check read a bounded prefix rather than the whole body. Not an error. */
  readonly truncated?: boolean;
}

export interface AyasLightScanResult {
  readonly startedAt: string;
  readonly completedAt: string;
  readonly sourcesChecked: number;
  readonly sourcesChanged: number;
  readonly sourcesFailed: number;
  readonly sourcesSkipped: number;
  readonly results: readonly AyasLightScanSourceResult[];
}

export interface AyasLightResearchDeps {
  readonly sources?: readonly AyasResearchSource[];
  readonly stateStore?: AyasResearchSourceStateStore;
  readonly maxBodyBytes?: number;
  readonly timeoutMs?: number;
  readonly now?: () => string;
  /** Overrides the per-source retry policy. Exists so a deterministic test can pin retries to 0 instead of waiting out real backoff. */
  readonly maxRetries?: number;
  readonly retryBaseDelayMs?: number;
  /**
   * Overrides every source's own `minCheckIntervalMs` floor. Intended for a
   * deliberate operator diagnostic ("check these sources now") and for
   * deterministic tests — NOT for the scheduler, which must keep the
   * registry's own pacing so a lost/corrupt scheduler state can never turn
   * into repeated back-to-back polling of someone else's endpoint.
   */
  readonly minCheckIntervalMs?: number;
  /** Test-only passthrough — see `AyasSafePublicFetch`'s own doc comment. Never set by the real scheduler. */
  readonly dangerouslyAllowPrivateNetworkForTests?: boolean;
}

export const AYAS_LIGHT_SCAN_DEFAULT_MAX_BODY_BYTES = 500_000;
export const AYAS_LIGHT_SCAN_BASE_BACKOFF_MS = 5 * 60_000;
export const AYAS_LIGHT_SCAN_MAX_BACKOFF_MS = 6 * 60 * 60_000;

function backoffElapsed(prior: AyasResearchSourceCheckState | undefined, nowIso: string): boolean {
  if (!prior || prior.status !== "ERROR" || prior.consecutiveFailures <= 0) return true;
  // A source the endpoint itself rate-limited waits at least as long as it
  // asked to — honoring `Retry-After` rather than overriding it with our own
  // schedule is the difference between backing off and merely pausing.
  const classBackoffMs = AYAS_LIGHT_SCAN_BASE_BACKOFF_MS * 2 ** (prior.consecutiveFailures - 1);
  const backoffMs = Math.min(AYAS_LIGHT_SCAN_MAX_BACKOFF_MS, Math.max(classBackoffMs, prior.retryAfterMs ?? 0));
  return Date.parse(nowIso) - Date.parse(prior.lastCheckedAt) >= backoffMs;
}

/**
 * Per-source rate policy: never contact a source more often than its own
 * `minCheckIntervalMs`, even if a scan is triggered early. This is what
 * keeps research "scheduled, bounded, and auditable" rather than dependent
 * on the scheduler being the only thing that ever paces it.
 */
function rateIntervalElapsed(prior: AyasResearchSourceCheckState | undefined, nowIso: string, minCheckIntervalMs: number): boolean {
  if (!prior?.lastCheckedAt) return true;
  return Date.parse(nowIso) - Date.parse(prior.lastCheckedAt) >= minCheckIntervalMs;
}

export async function runAyasLightResearchScan(deps: AyasLightResearchDeps = {}): Promise<AyasLightScanResult> {
  const sources = deps.sources ?? resolveAyasResearchSourceRegistry();
  const stateStore = deps.stateStore ?? createAyasResearchSourceStateStore();
  const now = deps.now ?? (() => new Date().toISOString());
  const startedAt = now();
  const results: AyasLightScanSourceResult[] = [];

  for (const source of sources) {
    const policy = resolveAyasResearchSourcePolicy(source);
    const prior = stateStore.read(source.sourceId);
    const tickNow = now();

    if (!backoffElapsed(prior, tickNow)) {
      results.push({ sourceId: source.sourceId, changed: false, status: "SKIPPED_BACKOFF" });
      continue;
    }
    if (!rateIntervalElapsed(prior, tickNow, deps.minCheckIntervalMs ?? policy.minCheckIntervalMs)) {
      results.push({ sourceId: source.sourceId, changed: false, status: "SKIPPED_RATE_POLICY" });
      continue;
    }

    try {
      const outcome = await ayasSafePublicFetch(source.url, {
        timeoutMs: deps.timeoutMs ?? 8000,
        maxBodyBytes: deps.maxBodyBytes ?? policy.lightMaxBodyBytes,
        ifNoneMatch: prior?.etag,
        ifModifiedSince: prior?.lastModified,
        // A very large official feed is normal, not broken. The LIGHT scan
        // only needs a deterministic change signal, and a newest-first feed
        // puts what changed at the very start of the body — so a bounded
        // prefix answers the question exactly as well as the whole thing,
        // while the size bound still caps what is ever read into memory.
        acceptTruncatedBody: true,
        maxRetries: deps.maxRetries ?? policy.maxRetries,
        ...(deps.retryBaseDelayMs === undefined ? {} : { retryBaseDelayMs: deps.retryBaseDelayMs }),
        dangerouslyAllowPrivateNetworkForTests: deps.dangerouslyAllowPrivateNetworkForTests,
      });

      if (!outcome.ok) {
        stateStore.write({
          sourceId: source.sourceId, lastCheckedAt: tickNow, lastChangedAt: prior?.lastChangedAt,
          etag: prior?.etag, lastModified: prior?.lastModified, contentHash: prior?.contentHash,
          status: "ERROR", lastError: `${outcome.code}: ${outcome.message}`, consecutiveFailures: (prior?.consecutiveFailures ?? 0) + 1,
          lastFailureClass: outcome.failureClass, lastSuccessAt: prior?.lastSuccessAt,
          ...(outcome.retryAfterMs === undefined ? {} : { retryAfterMs: outcome.retryAfterMs }),
        });
        results.push({ sourceId: source.sourceId, changed: false, status: "ERROR", error: outcome.code, failureClass: outcome.failureClass });
        continue;
      }

      if (outcome.notModified) {
        stateStore.write({
          sourceId: source.sourceId, lastCheckedAt: tickNow, lastChangedAt: prior?.lastChangedAt,
          etag: outcome.etag ?? prior?.etag, lastModified: outcome.lastModified ?? prior?.lastModified, contentHash: prior?.contentHash,
          status: "UNCHANGED", consecutiveFailures: 0, lastSuccessAt: tickNow, lastReadTruncated: prior?.lastReadTruncated,
        });
        results.push({ sourceId: source.sourceId, changed: false, status: "OK" });
        continue;
      }

      const hash = ayasContentHash(outcome.body);
      const changed = hash !== prior?.contentHash;
      stateStore.write({
        sourceId: source.sourceId, lastCheckedAt: tickNow, lastChangedAt: changed ? tickNow : prior?.lastChangedAt,
        etag: outcome.etag, lastModified: outcome.lastModified, contentHash: hash,
        status: changed ? "OK" : "UNCHANGED", consecutiveFailures: 0, lastSuccessAt: tickNow, lastReadTruncated: outcome.truncated,
      });
      results.push({ sourceId: source.sourceId, changed, status: "OK", truncated: outcome.truncated });
    } catch (error) {
      stateStore.write({
        sourceId: source.sourceId, lastCheckedAt: tickNow, lastChangedAt: prior?.lastChangedAt,
        etag: prior?.etag, lastModified: prior?.lastModified, contentHash: prior?.contentHash,
        status: "ERROR", lastError: error instanceof Error ? error.message : String(error), consecutiveFailures: (prior?.consecutiveFailures ?? 0) + 1,
        lastFailureClass: "TRANSIENT", lastSuccessAt: prior?.lastSuccessAt,
      });
      results.push({ sourceId: source.sourceId, changed: false, status: "ERROR", error: "AYAS_LIGHT_SCAN_UNEXPECTED_ERROR", failureClass: "TRANSIENT" });
    }
  }

  const completedAt = now();
  return {
    startedAt,
    completedAt,
    sourcesChecked: results.length,
    sourcesChanged: results.filter((r) => r.changed).length,
    sourcesFailed: results.filter((r) => r.status === "ERROR").length,
    sourcesSkipped: results.filter((r) => r.status === "SKIPPED_BACKOFF" || r.status === "SKIPPED_RATE_POLICY").length,
    results,
  };
}
