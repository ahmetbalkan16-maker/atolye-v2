/**
 * AYAS phone-local LLM — `ayas-phone-gateway` Range-proxy config (real-
 * device closure: iPhone/Chrome gets `HTTP 200` + `Content-Range: absent`
 * for a `Range` request straight to `huggingface.co` for this exact model
 * file, 100% reproducibly — confirmed via the in-app "Range Teşhisi" tool's
 * probes A/B on a real device. The SAME request through the deployed
 * `ayas-phone-gateway` Cloudflare Worker gets a clean `206` — confirmed on
 * that SAME real device via probe C, not just PC `curl`).
 *
 * Single source of truth WITHIN this Next.js app — used by BOTH
 * `phoneLlmPrecacheDownloader.ts` (the real download) and
 * `phoneLlmRangeDiagnostic.ts` (probe C). Mirrors
 * `cloudflare/ayas-phone-gateway/src/modelProxyConfig.ts` byte-for-byte
 * (same routes, same paths); that file is the canonical source (a separate
 * deployable — a Cloudflare Worker bundle — so it cannot be a shared import
 * across the two projects) — kept in sync by hand, verified against it
 * directly, the same "small local mirror" pattern `phoneLlmModelResources.ts`'s
 * own header already uses for mirroring the installed
 * `@huggingface/transformers` package's internals.
 *
 * ROUTE LIST (was a single hardcoded model/file/path trio; now a small,
 * closed allowlist — SmolLM2-135M-Instruct's weight file hits the SAME
 * "200 instead of 206" Range problem Qwen's did, for the same reason: both
 * are `huggingface.co/.../resolve/main/...` URLs on the same CDN/redirect
 * pattern). ONLY the (modelId, file) pairs listed here are ever routed
 * through the gateway — see `resolvePhoneLlmNetworkFetch` in
 * `phoneLlmPrecacheDownloader.ts`. Every other required file
 * (config.json, tokenizer.json, tokenizer_config.json) — and any model/file
 * pair NOT listed here — still goes straight to HF, unchanged. The gateway
 * itself enforces the same closed allowlist independently, server-side
 * (`MODEL_PROXY_ROUTES` in `modelProxyConfig.ts` — fixed literal pairs, no
 * path parameter) — this is not the only thing standing between "arbitrary
 * URL" and this proxy, just the app-side half of it.
 */

export interface AyasPhoneLlmGatewayRoute {
  readonly modelId: string;
  readonly file: string;
  readonly proxyPath: string;
}

export const AYAS_PHONE_LLM_GATEWAY_ROUTES: readonly AyasPhoneLlmGatewayRoute[] = [
  {
    modelId: "onnx-community/Qwen2.5-0.5B-Instruct",
    file: "onnx/model_q4f16.onnx",
    proxyPath: "/phone-llm-model/onnx-community/Qwen2.5-0.5B-Instruct/resolve/main/onnx/model_q4f16.onnx",
  },
  {
    modelId: "HuggingFaceTB/SmolLM2-135M-Instruct",
    file: "onnx/model_q4f16.onnx",
    proxyPath: "/phone-llm-model/HuggingFaceTB/SmolLM2-135M-Instruct/resolve/main/onnx/model_q4f16.onnx",
  },
];

/** Looks up this (modelId, file) pair's gateway route, if any. `undefined` means: not gateway-scoped — go straight to HF, exactly as before this route list existed. */
export function findAyasPhoneLlmGatewayRoute(modelId: string, file: string): AyasPhoneLlmGatewayRoute | undefined {
  return AYAS_PHONE_LLM_GATEWAY_ROUTES.find((route) => route.modelId === modelId && route.file === file);
}
