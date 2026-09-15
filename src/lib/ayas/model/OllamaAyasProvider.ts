/**
 * Atölye Brain — AYAS local model provider (Phase 2 · P0-A).
 *
 * Wraps the EXISTING local Ollama chat path — same `POST {host}/api/chat`,
 * same model resolution (`resolveOllamaConfig` + `AyasModelProfile`), same
 * NDJSON stream parse that `AyasChatStream.ts` had inline. Nothing about the
 * Ollama behaviour changes; it just moves behind the `AyasModelProvider`
 * contract so the router can pick between it and the cloud fallback.
 *
 * `$0`, local, primary while the PC is on. Runs nothing but a model call.
 */

import { resolveOllamaConfig } from "@/lib/ai/OllamaConfig";
import { resolveAyasChatModelProfile } from "../AyasModelProfile";
import type {
  AyasModelHealth,
  AyasModelProvider,
  AyasModelRequest,
  AyasModelStreamChunk,
} from "./AyasModelTypes";

interface OllamaStreamLine {
  message?: { content?: string | null };
  done?: boolean;
  done_reason?: string | null;
}

/** How long to wait on the `/api/tags` reachability probe before calling Ollama "down". */
const HEALTH_TIMEOUT_MS = 2_500;

export function createOllamaAyasProvider(
  env: NodeJS.ProcessEnv = process.env,
  fetcher: typeof fetch = fetch,
): AyasModelProvider {
  const base = safeResolve(env);
  const profile = resolveAyasChatModelProfile(env, base ?? undefined);
  const model = base ? (profile.overridden ? profile.model : base.model) : profile.model;

  return {
    id: "ollama",
    kind: "local",
    model,
    configured: base !== null,

    async health(signal?: AbortSignal): Promise<AyasModelHealth> {
      const now = Date.now();
      if (!base) return { available: false, detail: "ollama: yapılandırma geçersiz", checkedAtMs: now };
      const ctrl = new AbortController();
      const onAbort = () => ctrl.abort();
      signal?.addEventListener("abort", onAbort);
      const timer = setTimeout(() => ctrl.abort(), HEALTH_TIMEOUT_MS);
      try {
        const res = await fetcher(`${base.baseUrl}/api/tags`, { signal: ctrl.signal, redirect: "error" });
        if (!res.ok) return { available: false, detail: `ollama: HTTP ${res.status}`, checkedAtMs: Date.now() };
        let count = 0;
        try {
          const body = (await res.json()) as { models?: unknown[] };
          count = Array.isArray(body.models) ? body.models.length : 0;
        } catch {
          /* a 200 with an unreadable body still means the server is up */
        }
        return { available: true, detail: `ollama: ${count} model`, checkedAtMs: Date.now() };
      } catch (error) {
        const name = (error as Error)?.name === "AbortError" ? "zaman aşımı" : "erişilemedi";
        return { available: false, detail: `ollama: ${name}`, checkedAtMs: Date.now() };
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      }
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
      if (!base) throw new Error("ollama-not-configured");
      const controller = new AbortController();
      const onAbort = () => controller.abort();
      req.signal?.addEventListener("abort", onAbort);
      const timeout = setTimeout(() => controller.abort(), base.timeoutMs);

      let full = "";
      let finishReason = "stop";
      try {
        const response = await fetcher(`${base.baseUrl}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            messages: [{ role: "user", content: req.prompt }],
            stream: true,
            // Ollama's own grammar-constrained decoding (server >= 0.5) —
            // when the caller supplies a schema, this makes the RAW model
            // output far more likely to already satisfy it, instead of
            // relying on prompt instructions alone. Omitted entirely for a
            // request with no schema (the ordinary streaming chat path),
            // so unconstrained generation is completely unaffected.
            ...(req.responseSchema ? { format: req.responseSchema } : {}),
            options: {
              temperature: req.temperature ?? base.temperature,
              num_predict: req.maxTokens,
              ...(req.numCtx !== undefined
                ? { num_ctx: req.numCtx }
                : base.numCtx !== undefined
                  ? { num_ctx: base.numCtx }
                  : {}),
            },
          }),
          signal: controller.signal,
          redirect: "error",
        });

        if (!response.ok || !response.body) {
          throw new Error(`ollama-${response.status}`);
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
            const line = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            if (!line) continue;
            let parsed: OllamaStreamLine;
            try {
              parsed = JSON.parse(line) as OllamaStreamLine;
            } catch {
              continue;
            }
            const piece = typeof parsed.message?.content === "string" ? parsed.message.content : "";
            if (piece) {
              full += piece;
              yield { type: "delta", text: piece };
            }
            if (parsed.done) {
              if (parsed.done_reason) finishReason = parsed.done_reason;
              break;
            }
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

function safeResolve(env: NodeJS.ProcessEnv): ReturnType<typeof resolveOllamaConfig> | null {
  try {
    return resolveOllamaConfig(env);
  } catch {
    return null;
  }
}
