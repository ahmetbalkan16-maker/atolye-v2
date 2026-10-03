/**
 * Stage 16.0 — the closed, code-owned revenue adapter registry.
 *
 * The production registry is EMPTY: no live platform adapter exists in Stage 16.0, so every production
 * plan is DENY / ADAPTER_NOT_REGISTERED. A registry is built only from adapter objects in code (tests
 * inject fakes); nothing in a request, a result or external text can name an adapter into it. One adapter
 * per platform; a request is dispatched only to its own platform's adapter.
 *
 * Exposed: `planRevenueOperation` and `runAyasRevenueReadOrDraft`. The runner performs ALLOW_READ and
 * ALLOW_LOCAL_DRAFT plans only. There is no submit, create, send, publish, spend or withdraw here; an
 * owner-required or denied plan returns BLOCKED without touching the adapter.
 */
import { AYAS_REVENUE_LIMITS, AYAS_REVENUE_PLATFORMS, type AyasRevenueAdapterResult, type AyasRevenuePlatform } from "./AyasRevenuePlatformTypes";
import { decideAyasRevenueOperation, type AyasRevenuePlan } from "./AyasRevenueActionPolicy";
import { ayasRevenueLocalResult, isAyasRevenuePlatformAdapter, normalizeAyasRevenueResult, type AyasRevenuePlatformAdapter } from "./AyasRevenuePlatformAdapter";
import { deepFreezeAyasRevenueValue, isAyasRevenuePlainRecord, snapshotAyasRevenueValue } from "./AyasRevenueRedaction";

export interface AyasRevenuePlatformRegistry {
  readonly platforms: readonly AyasRevenuePlatform[];
  adapterFor(platform: unknown): AyasRevenuePlatformAdapter | null;
}

export function createAyasRevenuePlatformRegistry(adapters: readonly unknown[]): AyasRevenuePlatformRegistry {
  if (!Array.isArray(adapters) || adapters.length > AYAS_REVENUE_PLATFORMS.length) throw new Error("AYAS_REVENUE_REGISTRY_INVALID");
  const byPlatform = new Map<AyasRevenuePlatform, AyasRevenuePlatformAdapter>(), ids = new Set<string>();
  for (const adapter of adapters) {
    if (!isAyasRevenuePlatformAdapter(adapter)) throw new Error("AYAS_REVENUE_ADAPTER_INVALID");
    const { platform, adapterId } = adapter.manifest;
    if (ids.has(adapterId) || byPlatform.has(platform)) throw new Error("AYAS_REVENUE_ADAPTER_DUPLICATE");
    ids.add(adapterId);
    // The registry keeps its own frozen copy; later changes to the caller's object do not reach it.
    const manifest = Object.freeze({ ...adapter.manifest, supportedOperations: Object.freeze([...adapter.manifest.supportedOperations]) });
    const read = adapter.read, draft = adapter.draft;
    const bound: AyasRevenuePlatformAdapter = { manifest, read: (r) => read.call(adapter, r), draft: (r) => draft.call(adapter, r) };
    byPlatform.set(platform, Object.freeze(bound));
  }
  const platforms = Object.freeze([...byPlatform.keys()].sort());
  // A Map lookup is exact: no prototype chain, so `__proto__` or `toString` find nothing.
  return Object.freeze({ platforms, adapterFor: (platform: unknown) => byPlatform.get(platform as AyasRevenuePlatform) ?? null });
}

/** No live platform adapter is registered in Stage 16.0. */
export const AYAS_REVENUE_PRODUCTION_ADAPTERS: readonly AyasRevenuePlatformAdapter[] = Object.freeze([]);
export const ayasRevenueProductionRegistry = (): AyasRevenuePlatformRegistry => createAyasRevenuePlatformRegistry(AYAS_REVENUE_PRODUCTION_ADAPTERS);

/**
 * One read of the caller's request: a top-level accessor is refused before anything is invoked, and a proxy,
 * function or symbol anywhere fails the clone. The plan and the dispatch both use this one snapshot.
 */
function snapshotRequest(request: unknown): unknown {
  if (!isAyasRevenuePlainRecord(request)) return null;
  const snapshot = snapshotAyasRevenueValue(request);
  return snapshot.ok ? deepFreezeAyasRevenueValue(snapshot.value) : null;
}
function planSnapshot(registry: AyasRevenuePlatformRegistry, snapshot: unknown): AyasRevenuePlan {
  const platform = isAyasRevenuePlainRecord(snapshot) ? snapshot.platform : undefined;
  return decideAyasRevenueOperation(registry.adapterFor(platform)?.manifest ?? null, snapshot);
}
export function planRevenueOperation(registry: AyasRevenuePlatformRegistry, request: unknown): AyasRevenuePlan {
  return planSnapshot(registry, snapshotRequest(request));
}

export interface AyasRevenueRun { readonly plan: AyasRevenuePlan; readonly result: AyasRevenueAdapterResult | null }
/**
 * Runs a plan only when it is ALLOW_READ or ALLOW_LOCAL_DRAFT. `result` is null when the request itself was
 * invalid or no adapter is registered; otherwise it is BLOCKED (not sent), the validated adapter answer, or a
 * local ERROR / UNAVAILABLE that never carries the adapter's message or stack.
 */
export async function runAyasRevenueReadOrDraft(registry: AyasRevenuePlatformRegistry, request: unknown,
  options: { readonly now?: () => string; readonly timeoutMs?: number } = {}): Promise<AyasRevenueRun> {
  const now = options.now ?? (() => new Date().toISOString());
  const requested = typeof options.timeoutMs === "number" && Number.isFinite(options.timeoutMs) ? options.timeoutMs : AYAS_REVENUE_LIMITS.adapterTimeoutMs;
  const timeoutMs = Math.min(Math.max(1, requested), AYAS_REVENUE_LIMITS.adapterTimeoutMs);
  const snapshot = snapshotRequest(request), plan = planSnapshot(registry, snapshot);
  const adapter = plan.platform ? registry.adapterFor(plan.platform) : null;
  if (plan.reason === "REQUEST_INVALID" || plan.reason === "UNKNOWN_PLATFORM" || plan.reason === "UNKNOWN_OPERATION" || !adapter) return { plan, result: null };
  // The adapter gets the deep-frozen snapshot that was planned, never the caller's object.
  const sent = snapshot as Parameters<AyasRevenuePlatformAdapter["read"]>[0];
  if (!plan.executable) return { plan, result: ayasRevenueLocalResult(adapter.manifest, sent, "BLOCKED", `AYAS_REVENUE_${plan.reason}`, now()) };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const call = plan.decision === "ALLOW_READ" ? adapter.read(sent) : adapter.draft(sent);
    const raw = await Promise.race([call, new Promise<"TIMEOUT">((resolve) => { timer = setTimeout(() => resolve("TIMEOUT"), timeoutMs); })]);
    if (raw === "TIMEOUT") return { plan, result: ayasRevenueLocalResult(adapter.manifest, sent, "UNAVAILABLE", "AYAS_REVENUE_ADAPTER_TIMEOUT", now()) };
    const normalized = normalizeAyasRevenueResult(adapter.manifest, sent, raw);
    return { plan, result: normalized.ok ? normalized.result : ayasRevenueLocalResult(adapter.manifest, sent, normalized.code === "AYAS_REVENUE_RESULT_SENSITIVE_REFUSED" ? "BLOCKED" : "ERROR", normalized.code, now()) };
  } catch {
    return { plan, result: ayasRevenueLocalResult(adapter.manifest, sent, "ERROR", "AYAS_REVENUE_ADAPTER_FAILED", now()) };
  } finally { if (timer !== undefined) clearTimeout(timer); }
}
