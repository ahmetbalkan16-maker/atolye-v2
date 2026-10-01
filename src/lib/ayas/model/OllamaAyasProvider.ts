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
import { assertAyasMeasuredPromptFits, assertAyasPromptFits, resolveAyasContextCeiling } from "../context/AyasContextBudget";
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
  /** Prompt tokens the server evaluated; present on the final line. */
  prompt_eval_count?: unknown;
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

    get contextWindowTokens() {
      return resolveAyasContextCeiling("local", env, base?.numCtx);
    },

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
        let servedDigest: string | undefined;
        try {
          const body = (await res.json()) as { models?: unknown[] };
          count = Array.isArray(body.models) ? body.models.length : 0;
          // Stage 15E: the digest served under this tag, so the router can tell a re-pulled model from the pinned one.
          for (const item of Array.isArray(body.models) ? body.models : []) {
            const served = item as { name?: unknown; model?: unknown; digest?: unknown } | null;
            if (served && (served.name === model || served.model === model) && typeof served.digest === "string" && /^[a-f0-9]{64}$/.test(served.digest)) servedDigest = served.digest;
          }
        } catch {
          /* a 200 with an unreadable body still means the server is up */
        }
        return { available: true, detail: `ollama: ${count} model`, checkedAtMs: Date.now(), ...(servedDigest ? { servedDigest } : {}) };
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
      // Post-freeze 15C: an unknown window or a prompt that does not fit it is refused before any request is made.
      const ceiling = resolveAyasContextCeiling("local", env, req.numCtx ?? base.numCtx);
      assertAyasPromptFits(req.prompt, ceiling, req.maxTokens);
      const controller = new AbortController();
      const onAbort = () => controller.abort();
      req.signal?.addEventListener("abort", onAbort);
      const timeout = setTimeout(() => controller.abort(), base.timeoutMs);

      let full = "";
      let finishReason = "stop";
      let measuredPromptTokens: unknown;
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
              measuredPromptTokens = parsed.prompt_eval_count;
              break;
            }
          }
        }
      } finally {
        clearTimeout(timeout);
        req.signal?.removeEventListener("abort", onAbort);
      }
      // The server's own count is the measurement the estimate above stands in for. A prompt that reached the
      // window may have been truncated on the server, so its reply is not handed on.
      const promptTokens = assertAyasMeasuredPromptFits(measuredPromptTokens, ceiling, req.maxTokens);
      yield { type: "done", text: full.trim(), finishReason, ...(promptTokens !== undefined ? { promptTokens } : {}) };
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
