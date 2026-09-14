/**
 * Route 2 (Phone-LLM Range proxy) config constants — split out of
 * `worker.ts` on purpose, NOT for organization but because of a real
 * Workers-runtime constraint discovered via `wrangler dev` local testing:
 * the entry module (`main` in `wrangler.toml`, i.e. `worker.ts`) may only
 * export its default `ExportedHandler` plus special runtime bindings
 * (Durable Object classes, etc.) — ANY other named value export makes the
 * Workers runtime refuse to start the whole script:
 *
 *   Uncaught TypeError: Incorrect type for map entry 'MODEL_PROXY_PATH':
 *   the provided value is not of type 'function or ExportedHandler'.
 *
 * (TypeScript `interface`/`type` exports, like `AyasWorkerEnv` in
 * `worker.ts`, are erased at compile time and never hit this — only VALUE
 * exports do.) `worker.ts` imports these two constants; the smoke suite
 * (`scripts/smoke-ayas-phone-runtime.ts`) imports them from here too, so
 * both stay byte-identical without either duplicating the literal or
 * breaking the deployed Worker.
 */

/**
 * Route 2's path (Qwen 0.5B weight file — the original, still the default
 * model this gateway was built for). A FIXED, single string — never parsed,
 * never a wildcard — compared with `===` in `worker.ts`'s router. Mirrors
 * the real HF resource path after the prefix purely for operator
 * readability (so a `curl` against this Worker and a `curl` against HF look
 * obviously related in logs) — it carries no routing logic of its own.
 */
export const MODEL_PROXY_PATH = "/phone-llm-model/onnx-community/Qwen2.5-0.5B-Instruct/resolve/main/onnx/model_q4f16.onnx";

/** The ONLY upstream URL the Qwen route will ever fetch. Hardcoded — never derived from request input. */
export const MODEL_UPSTREAM_URL = "https://huggingface.co/onnx-community/Qwen2.5-0.5B-Instruct/resolve/main/onnx/model_q4f16.onnx";

/**
 * Route 2's SECOND path — the SmolLM2-135M phone-fallback model's weight
 * file (added: `AYAS_PHONE_LLM_MODELS[0]` in the app's
 * `phoneLlmModelResources.ts`). Added because `huggingface.co` doesn't
 * reliably honor `Range` for THIS file either — the app's own downloader
 * hit the identical "chunk 0 probe: server returned HTTP 200 instead of
 * 206" signature the Qwen file originally did (same `resolve` CDN endpoint
 * pattern), and `resolvePhoneLlmNetworkFetch` in
 * `phoneLlmPrecacheDownloader.ts` only ever routed the ONE model+file pair
 * hardcoded here through the gateway — SmolLM2 was never added to that
 * allowlist, so it silently fell through to the direct-HF path already
 * proven broken for large ONNX files on this device class.
 */
export const SMOLLM2_MODEL_PROXY_PATH =
  "/phone-llm-model/HuggingFaceTB/SmolLM2-135M-Instruct/resolve/main/onnx/model_q4f16.onnx";

/** The ONLY upstream URL the SmolLM2 route will ever fetch. Hardcoded — never derived from request input. */
export const SMOLLM2_MODEL_UPSTREAM_URL =
  "https://huggingface.co/HuggingFaceTB/SmolLM2-135M-Instruct/resolve/main/onnx/model_q4f16.onnx";

export interface ModelProxyRoute {
  readonly path: string;
  readonly upstreamUrl: string;
}

/**
 * Every route 2 URL this gateway will ever proxy — a closed, fully
 * hardcoded allowlist, NOT a general-purpose proxy: each entry is a fixed
 * literal pair, never derived from request input (see `worker.ts`'s file
 * header — that hard constraint still holds per-entry now that there is
 * more than one entry). Adding a model to this gateway means adding a new
 * fixed pair here, never adding request-driven flexibility (no path
 * parameter, no query parameter, nothing a caller supplies changes which
 * URL gets fetched).
 */
export const MODEL_PROXY_ROUTES: readonly ModelProxyRoute[] = [
  { path: MODEL_PROXY_PATH, upstreamUrl: MODEL_UPSTREAM_URL },
  { path: SMOLLM2_MODEL_PROXY_PATH, upstreamUrl: SMOLLM2_MODEL_UPSTREAM_URL },
];
