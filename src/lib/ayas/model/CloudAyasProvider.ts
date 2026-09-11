/**
 * Atölye Brain — AYAS cloud model provider (Phase 2 · P0-A).
 *
 * The OPTIONAL fallback. OpenAI-compatible `POST {base}/chat/completions` with
 * `stream: true`, SSE (`data: {json}` … `data: [DONE]`). Works with OpenAI,
 * OpenRouter, Groq, Together, a local proxy — AYAS is not vendor-locked.
 *
 * SECURITY:
 *  - the API key is read ONLY here, via `getAyasCloudApiKey()`, and used ONLY
 *    for the `Authorization` header. It is never logged, never returned, never
 *    put in an error message, prompt, or response body.
 *  - server-side only. This module must not be imported by a client component
 *    (it isn't — only `AyasChatStream.ts` / `app/brain/actions.ts` import it).
 *  - it runs nothing; text in, text out; the execution gate is untouched.
 *  - `health()` does NOT ping the cloud (that would bill a request per turn) —
 *    it reports config readiness only; a real outage surfaces as a stream error
 *    which the caller turns into the honest deterministic fallback.
 */

import { getAyasCloudApiKey, resolveAyasCloudConfig } from "./AyasCloudConfig";
import type {
  AyasModelHealth,
  AyasModelProvider,
  AyasModelRequest,
  AyasModelStreamChunk,
} from "./AyasModelTypes";

interface OpenAiStreamLine {
  choices?: Array<{ delta?: { content?: string | null }; finish_reason?: string | null }>;
}

export function createCloudAyasProvider(
  env: NodeJS.ProcessEnv = process.env,
  fetcher: typeof fetch = fetch,
): AyasModelProvider {
  const cfg = resolveAyasCloudConfig(env);

  return {
    id: "cloud",
    kind: "cloud",
    model: cfg.model,
    configured: cfg.configured,

    async health(): Promise<AyasModelHealth> {
      return {
        available: cfg.configured,
        detail: cfg.configured ? "cloud: yapılandırıldı" : "cloud: yapılandırılmadı",
        checkedAtMs: Date.now(),
      };
    },

    async chat(req: AyasModelRequest): Promise<{ text: string; finishReason: string }> {
      let text = "";
      let finishReason = "unknown";
      for await (const chunk of this.stream(req)) {
        if (chunk.type === "delta") text += chunk.text;
        else finishReason = chunk.finishReason;
      }
      return { text: text.trim(), finishReason };
    },

    async *stream(req: AyasModelRequest): AsyncGenerator<AyasModelStreamChunk, void, unknown> {
      const key = getAyasCloudApiKey(env);
      if (!cfg.configured || !key) throw new Error("cloud-not-configured");

      const controller = new AbortController();
      const onAbort = () => controller.abort();
      req.signal?.addEventListener("abort", onAbort);
      const timeout = setTimeout(() => controller.abort(), cfg.timeoutMs);

      let full = "";
      let finishReason = "stop";
      try {
        const response = await fetcher(`${cfg.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${key}`,
          },
          body: JSON.stringify({
            model: cfg.model,
            messages: [{ role: "user", content: req.prompt }],
            stream: true,
            max_tokens: req.maxTokens,
            ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
          }),
          signal: controller.signal,
          // "error" throws a TypeError in Cloudflare Workers' fetch (unsupported redirect
          // mode there — Node's fetch supports it fine, so this only broke server-side).
          // "manual" is supported on both runtimes and preserves the same "never silently
          // follow a redirect" property: an unfollowed redirect comes back as status 0 /
          // no body, which the check right below already treats as a failure.
          redirect: "manual",
        });

        if (!response.ok || !response.body) {
          // NOTE: the status only — never the body (may echo the key / org id).
          throw new Error(`cloud-${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buffer.indexOf("\n")) !== -1) {
            const raw = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            if (!raw || !raw.startsWith("data:")) continue;
            const payload = raw.slice(5).trim();
            if (payload === "[DONE]") {
              buffer = "";
              break;
            }
            let parsed: OpenAiStreamLine;
            try {
              parsed = JSON.parse(payload) as OpenAiStreamLine;
            } catch {
              continue;
            }
            const choice = parsed.choices?.[0];
            const piece = typeof choice?.delta?.content === "string" ? choice.delta.content : "";
            if (piece) {
              full += piece;
              yield { type: "delta", text: piece };
            }
            if (choice?.finish_reason) finishReason = choice.finish_reason;
          }
        }
      } finally {
        clearTimeout(timeout);
        req.signal?.removeEventListener("abort", onAbort);
      }
      yield { type: "done", text: full.trim(), finishReason };
    },
  };
}
