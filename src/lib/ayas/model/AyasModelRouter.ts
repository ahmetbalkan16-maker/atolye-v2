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
 *      Ollama down + cloud configured → use Cloud (a VISIBLE fallback — the
 *          decision's `reason` says so and the operational trace records it).
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
import type { AyasModelProvider, AyasModelRouteDecision } from "./AyasModelTypes";

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
  const { ollama, cloud } = input.providers ?? buildAyasModelProviders(env, fetcher);

  const complexity = classifyAyasComplexity(input.text);

  // 1 — try the local model first (unless it isn't even configured).
  if (ollama.configured) {
    const health = await ollama.health(input.signal).catch(
      () => ({ available: false, detail: "ollama: probe hatası", checkedAtMs: Date.now() }),
    );
    if (health.available) {
      return {
        decision: {
          complexity,
          providerId: "ollama",
          providerKind: "local",
          model: ollama.model,
          reason: `yerel model sağlıklı (${health.detail})`,
        },
        provider: ollama,
      };
    }
    // 2 — local down; fall back to cloud if it is configured. VISIBLE, not silent.
    if (cloud.configured) {
      return {
        decision: {
          complexity,
          providerId: "cloud",
          providerKind: "cloud",
          model: cloud.model,
          reason: `yerel model kapalı (${health.detail}) → bulut modeline geçildi`,
        },
        provider: cloud,
      };
    }
    return noProvider(complexity, `yerel model kapalı (${health.detail}), bulut yapılandırılmamış`);
  }

  // Ollama not configured at all → cloud, or nothing.
  if (cloud.configured) {
    return {
      decision: {
        complexity,
        providerId: "cloud",
        providerKind: "cloud",
        model: cloud.model,
        reason: "yerel model yapılandırılmamış → bulut modeli",
      },
      provider: cloud,
    };
  }
  return noProvider(complexity, "hiçbir model sağlayıcısı yapılandırılmamış");
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
