/**
 * Atölye Brain — AYAS model router (Phase 2 · P0-A.1).
 *
 *                    AYAS MODEL ROUTER
 *                           │
 *                ┌──────────┴──────────┐
 *          LOCAL / OLLAMA          CLOUD LLM
 *         (PC on, primary)     (PC on but Ollama
 *                               down → fallback)
 *
 * Decision (per turn):
 *   1. classify complexity (deterministic, `AyasComplexityRouter`).
 *   2. probe the local model (`ollama.health()` — a 2.5 s `/api/tags` check).
 *   3. Ollama healthy  → use Ollama.
 *      Ollama down → no provider. Autonomous monetary authority is exactly $0;
 *          paid, subscription, metered-free-tier and unknown cloud cost are
 *          denied centrally. There is no paid fallback.
 *      neither → NO provider. `unavailableMessage` is an honest, config-free
 *          sentence; the caller shows it instead of a model answer.
 *
 * The router NEVER falls back silently past a security boundary. There is no
 * WRITE/EXECUTE here — a provider only turns a prompt into text. The execution
 * gate is not touched.
 *
 * Complexity does not (yet) change WHICH provider answers — availability does.
 * The complexity is carried on the decision so Phase D's reasoning core and a
 * future per-tier model config can act on it.
 *
 * Pure-ish: the only side effect is the health `fetch` inside `ollama.health()`.
 * Providers are injectable for tests.
 */

import { classifyAyasComplexity } from "./AyasComplexityRouter";
import { createCloudAyasProvider } from "./CloudAyasProvider";
import { createOllamaAyasProvider } from "./OllamaAyasProvider";
import type { AyasModelHealth, AyasModelLifecycleTrace, AyasModelProvider, AyasModelRouteDecision } from "./AyasModelTypes";
import { ayasLifecycleMayServe, type AyasLifecycleEntry } from "../lifecycle/AyasLifecycle";
import { findAyasLifecycleEntryForOllamaTag } from "../lifecycle/AyasLifecycleRegistry";
import { evaluateAyasZeroCost } from "../policy/AyasZeroCostPolicy";

const WITHDRAWN_MODEL_MESSAGE =
  "AYAS şu an yanıt veremiyor: seçili yerel model yaşam döngüsü kaydında kullanım dışı. Başka bir yerel model seçilmeli.";

const NO_PROVIDER_MESSAGE =
  "AYAS şu an yanıt veremiyor: yerel model kapalı ve bulut modeli yapılandırılmamış. Metin sohbeti çalışmaya devam ediyor.";

export interface AyasModelRouterProviders {
  readonly ollama: AyasModelProvider;
  readonly cloud: AyasModelProvider;
}

export interface RouteAyasModelInput {
  readonly text: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly fetcher?: typeof fetch;
  /** Test seam — inject providers. */
  readonly providers?: AyasModelRouterProviders;
  /** Test seam — the lifecycle lookup for a local model tag. Defaults to the registry of record. */
  readonly findLifecycleEntry?: (tag: string) => AyasLifecycleEntry | undefined;
  readonly signal?: AbortSignal;
}

export interface AyasModelRoute {
  readonly decision: AyasModelRouteDecision;
  /** The chosen provider, or `null` when `decision.providerId === null`. */
  readonly provider: AyasModelProvider | null;
}

export function buildAyasModelProviders(
  env: NodeJS.ProcessEnv = process.env,
  fetcher: typeof fetch = fetch,
): AyasModelRouterProviders {
  return {
    ollama: createOllamaAyasProvider(env, fetcher),
    cloud: createCloudAyasProvider(env, fetcher),
  };
}

export async function routeAyasModel(input: RouteAyasModelInput): Promise<AyasModelRoute> {
  const env = input.env ?? process.env;
  const fetcher = input.fetcher ?? fetch;
  const { ollama } = input.providers ?? buildAyasModelProviders(env, fetcher);

  const complexity = classifyAyasComplexity(input.text);

  // 1 — try the local model first (unless it isn't even configured).
  if (ollama.configured) {
    const health: AyasModelHealth = await ollama.health(input.signal).catch(
      () => ({ available: false, detail: "ollama: probe hatası", checkedAtMs: Date.now() }),
    );
    if (health.available) {
      // Stage 15E — the tag the owner configured is a label. The registry says which bytes it was pinned to and whether
      // the entry may still serve. An unregistered tag is the owner's own choice: it is used and reported. An entry the
      // registry has withdrawn or retired is not used, whatever the configuration says.
      const entry = (input.findLifecycleEntry ?? findAyasLifecycleEntryForOllamaTag)(ollama.model);
      const lifecycle = traceAyasModelLifecycle(entry, health.servedDigest);
      if (entry && !ayasLifecycleMayServe(entry, "OWNER_INTERACTIVE")) {
        return { decision: { complexity, providerId: null, providerKind: null, model: null, reason: `yerel model yaşam döngüsünde kullanım dışı (${entry.state})`, unavailableMessage: WITHDRAWN_MODEL_MESSAGE, lifecycle }, provider: null };
      }
      const note = lifecycle.pin === "MISMATCH" ? "; servis edilen model kayıtlı pin ile aynı değil" : lifecycle.pin === "UNREGISTERED" ? "; model yaşam döngüsü kaydında yok" : "";
      return {
        decision: {
          complexity,
          providerId: "ollama",
          providerKind: "local",
          model: ollama.model,
          reason: `yerel model sağlıklı (${health.detail})${note}`,
          lifecycle,
        },
        provider: ollama,
      };
    }
    // 2 — only a provider explicitly classified as genuinely free-public may
    // be used. API-key presence never implies free; absent/unknown fails closed.
    const cloudCost = evaluateAyasZeroCost("unknown-cost");
    void cloudCost; // Generic API-key endpoints cannot self-attest as free-public.
    return noProvider(complexity, `yerel model kapalı (${health.detail}); ücretli veya maliyeti belirsiz fallback sıfır-maliyet politikasıyla kapalı`);
  }

  // Ollama not configured at all → cloud, or nothing.
  const cloudCost = evaluateAyasZeroCost("unknown-cost");
  void cloudCost;
  return noProvider(complexity, "yerel model yapılandırılmamış; ücretli veya maliyeti belirsiz fallback sıfır-maliyet politikasıyla kapalı");
}

/** Where a local tag stands: its registry entry, its state, and whether the served bytes are the pinned ones. */
export function traceAyasModelLifecycle(entry: AyasLifecycleEntry | undefined, servedDigest: string | undefined): AyasModelLifecycleTrace {
  if (!entry || entry.identity.type !== "ollama-digest") return { entryId: null, state: "UNREGISTERED", pin: "UNREGISTERED" };
  return { entryId: entry.id, state: entry.state, pin: servedDigest === undefined ? "NOT_OBSERVED" : servedDigest === entry.identity.digest ? "MATCH" : "MISMATCH" };
}

function noProvider(
  complexity: AyasModelRouteDecision["complexity"],
  reason: string,
): AyasModelRoute {
  return {
    decision: {
      complexity,
      providerId: null,
      providerKind: null,
      model: null,
      reason,
      unavailableMessage: NO_PROVIDER_MESSAGE,
    },
    provider: null,
  };
}
