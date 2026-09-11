/**
 * Atölye Brain — AYAS model layer, shared contracts (Phase 2 · P0-A).
 *
 * AYAS is NOT locked to one model provider. Every chat turn goes through the
 * {@link AyasModelRouter}, which picks an {@link AyasModelProvider} from
 * availability + a deterministic complexity classification. The two providers
 * this phase ships are `ollama` (local, `$0`, primary while the PC is on) and
 * `cloud` (an OpenAI-compatible endpoint, server-side key, fallback when the
 * local model is unreachable).
 *
 * Pure types only — no fs, no network, no secret.
 *
 * SECURITY: a provider talks to a model with a prompt and gets text back. It
 * runs nothing, touches no gate, and the router NEVER falls back silently past
 * a security boundary — a missing cloud provider is a visible, honest failure,
 * not a bypass.
 */

/**
 * Coarse task shape, decided BEFORE any model call. Phase D's reasoning core
 * branches on this; a future config can route (e.g.) `COMPLEX` to a stronger
 * model. This phase every complexity uses the routed provider's single model —
 * the value is carried, not yet acted on for model *selection*.
 */
export type AyasChatComplexity =
  | "SIMPLE" // greeting / trivia / yes-no — a direct answer, no reasoning
  | "NORMAL" // ordinary question about state — context + memory + answer
  | "COMPLEX" // multi-step analysis / "nedenini bul" / "ne yapmalıyız"
  | "TOOL" // asks for a read-only inspection ("git durumu", "test et") — Phase F prep
  | "REPAIR" // about a failure / self-heal ("neden düzelmedi")
  | "RESEARCH"; // "araştır" / "hakkında bilgi ver"

export const AYAS_CHAT_COMPLEXITIES: readonly AyasChatComplexity[] = Object.freeze([
  "SIMPLE",
  "NORMAL",
  "COMPLEX",
  "TOOL",
  "REPAIR",
  "RESEARCH",
]);

export type AyasModelProviderId = "ollama" | "cloud";
export type AyasModelProviderKind = "local" | "cloud";

/** One model call — the prompt is already fully built by `buildAyasChatPrompt`. */
export interface AyasModelRequest {
  readonly prompt: string;
  readonly complexity: AyasChatComplexity;
  readonly maxTokens: number;
  readonly temperature?: number;
  readonly numCtx?: number;
  readonly signal?: AbortSignal;
}

export type AyasModelStreamChunk =
  | { readonly type: "delta"; readonly text: string }
  | { readonly type: "done"; readonly text: string; readonly finishReason: string };

/** Safe, secret-free health probe result. `detail` is shown only in the operational trace. */
export interface AyasModelHealth {
  readonly available: boolean;
  /** e.g. `"ollama: 3 model"` / `"cloud: yapılandırılmadı"` / `"cloud: yapılandırıldı"`. Never a URL or key. */
  readonly detail: string;
  readonly checkedAtMs: number;
}

export interface AyasModelProvider {
  readonly id: AyasModelProviderId;
  readonly kind: AyasModelProviderKind;
  /** The model tag this provider will use (for the operational trace). */
  readonly model: string;
  /** Config-level readiness — `cloud` is `false` until `AYAS_CLOUD_API_KEY` is set. */
  readonly configured: boolean;
  /** Cheap reachability check. `local` pings the server; `cloud` reports config only (no billed call). */
  health(signal?: AbortSignal): Promise<AyasModelHealth>;
  /** One-shot completion. */
  chat(req: AyasModelRequest): Promise<{ readonly text: string; readonly finishReason: string }>;
  /** Streaming completion — yields `delta`s then one `done`. Throws on transport failure. */
  stream(req: AyasModelRequest): AsyncGenerator<AyasModelStreamChunk, void, unknown>;
}

/** The router's decision for one turn — a safe, serialisable trace object (no secret). */
export interface AyasModelRouteDecision {
  readonly complexity: AyasChatComplexity;
  readonly providerId: AyasModelProviderId | null;
  readonly providerKind: AyasModelProviderKind | null;
  readonly model: string | null;
  /** Safe one-line reason: `"ollama sağlıklı"` / `"ollama kapalı → bulut"` / `"sağlayıcı yok"`. */
  readonly reason: string;
  /** Set when `providerId === null` — a user-facing sentence with NO config/secret detail. */
  readonly unavailableMessage?: string;
}
