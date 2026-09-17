import { ayasSafePublicFetch } from "./AyasSafePublicFetch";
import { createAyasResearchSourceStateStore, ayasContentHash, type AyasResearchSourceCheckState, type AyasResearchSourceStateStore } from "./AyasResearchSourceStateStore";
import { resolveAyasResearchSourceRegistry, type AyasResearchSource } from "./AyasResearchSourceRegistry";

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
export type AyasLightScanSourceStatus = "OK" | "ERROR" | "SKIPPED_BACKOFF";

export interface AyasLightScanSourceResult {
  readonly sourceId: string;
  readonly changed: boolean;
  readonly status: AyasLightScanSourceStatus;
  readonly error?: string;
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
  /** Test-only passthrough — see `AyasSafePublicFetch`'s own doc comment. Never set by the real scheduler. */
  readonly dangerouslyAllowPrivateNetworkForTests?: boolean;
}

export const AYAS_LIGHT_SCAN_DEFAULT_MAX_BODY_BYTES = 500_000;
export const AYAS_LIGHT_SCAN_BASE_BACKOFF_MS = 5 * 60_000;
export const AYAS_LIGHT_SCAN_MAX_BACKOFF_MS = 6 * 60 * 60_000;

function backoffElapsed(prior: AyasResearchSourceCheckState | undefined, nowIso: string): boolean {
  if (!prior || prior.status !== "ERROR" || prior.consecutiveFailures <= 0) return true;
  const backoffMs = Math.min(AYAS_LIGHT_SCAN_MAX_BACKOFF_MS, AYAS_LIGHT_SCAN_BASE_BACKOFF_MS * 2 ** (prior.consecutiveFailures - 1));
  return Date.parse(nowIso) - Date.parse(prior.lastCheckedAt) >= backoffMs;
}

export async function runAyasLightResearchScan(deps: AyasLightResearchDeps = {}): Promise<AyasLightScanResult> {
  const sources = deps.sources ?? resolveAyasResearchSourceRegistry();
  const stateStore = deps.stateStore ?? createAyasResearchSourceStateStore();
  const now = deps.now ?? (() => new Date().toISOString());
  const startedAt = now();
  const results: AyasLightScanSourceResult[] = [];

  for (const source of sources) {
    const prior = stateStore.read(source.sourceId);
    const tickNow = now();

    if (!backoffElapsed(prior, tickNow)) {
      results.push({ sourceId: source.sourceId, changed: false, status: "SKIPPED_BACKOFF" });
      continue;
    }

    try {
      const outcome = await ayasSafePublicFetch(source.url, {
        timeoutMs: deps.timeoutMs ?? 8000,
        maxBodyBytes: deps.maxBodyBytes ?? AYAS_LIGHT_SCAN_DEFAULT_MAX_BODY_BYTES,
        ifNoneMatch: prior?.etag,
        ifModifiedSince: prior?.lastModified,
        dangerouslyAllowPrivateNetworkForTests: deps.dangerouslyAllowPrivateNetworkForTests,
      });

      if (!outcome.ok) {
        stateStore.write({
          sourceId: source.sourceId, lastCheckedAt: tickNow, lastChangedAt: prior?.lastChangedAt,
          etag: prior?.etag, lastModified: prior?.lastModified, contentHash: prior?.contentHash,
          status: "ERROR", lastError: `${outcome.code}: ${outcome.message}`, consecutiveFailures: (prior?.consecutiveFailures ?? 0) + 1,
        });
        results.push({ sourceId: source.sourceId, changed: false, status: "ERROR", error: outcome.code });
        continue;
      }

      if (outcome.notModified) {
        stateStore.write({
          sourceId: source.sourceId, lastCheckedAt: tickNow, lastChangedAt: prior?.lastChangedAt,
          etag: outcome.etag ?? prior?.etag, lastModified: outcome.lastModified ?? prior?.lastModified, contentHash: prior?.contentHash,
          status: "UNCHANGED", consecutiveFailures: 0,
        });
        results.push({ sourceId: source.sourceId, changed: false, status: "OK" });
        continue;
      }

      const hash = ayasContentHash(outcome.body);
      const changed = hash !== prior?.contentHash;
      stateStore.write({
        sourceId: source.sourceId, lastCheckedAt: tickNow, lastChangedAt: changed ? tickNow : prior?.lastChangedAt,
        etag: outcome.etag, lastModified: outcome.lastModified, contentHash: hash,
        status: changed ? "OK" : "UNCHANGED", consecutiveFailures: 0,
      });
      results.push({ sourceId: source.sourceId, changed, status: "OK" });
    } catch (error) {
      stateStore.write({
        sourceId: source.sourceId, lastCheckedAt: tickNow, lastChangedAt: prior?.lastChangedAt,
        etag: prior?.etag, lastModified: prior?.lastModified, contentHash: prior?.contentHash,
        status: "ERROR", lastError: error instanceof Error ? error.message : String(error), consecutiveFailures: (prior?.consecutiveFailures ?? 0) + 1,
      });
      results.push({ sourceId: source.sourceId, changed: false, status: "ERROR", error: "AYAS_LIGHT_SCAN_UNEXPECTED_ERROR" });
    }
  }

  const completedAt = now();
  return {
    startedAt,
    completedAt,
    sourcesChecked: results.length,
    sourcesChanged: results.filter((r) => r.changed).length,
    sourcesFailed: results.filter((r) => r.status === "ERROR").length,
    sourcesSkipped: results.filter((r) => r.status === "SKIPPED_BACKOFF").length,
    results,
  };
}
