/**
 * AYAS chat — token streaming (spec §4).
 *
 * `askAyas` returns one blob. `streamAyasChat` talks to Ollama's native
 * `/api/chat` with `stream: true`, parses the NDJSON line stream, and yields
 * incremental `delta` events, then one terminal `done` event.
 *
 * It reuses the deterministic prompt (`buildAyasChatPrompt`, `format: "text"` —
 * a direct plain-text answer, since streaming a `{ reply }` JSON envelope
 * token-by-token would be unreadable) and the exact same safety backstops as the
 * non-streaming path:
 *
 *  - on stream end the FULL text runs through `isUsableAyasReply` +
 *    `ayasReplyClaimsExecution`. If it is unusable or claims/offers execution,
 *    the terminal event carries `corrected: true` and `text` = the honest
 *    deterministic reply; the client replaces what it streamed.
 *  - a thrown fetch / an aborted request / a malformed stream / an empty reply
 *    all terminate with `source: "fallback"` and the deterministic reply.
 *
 * It is hard-pinned to the local Ollama model (via the AYAS model profile) —
 * never `AI_PROVIDER`, no telemetry write, and it runs nothing: text in, text
 * out. The execution gate is not touched.
 */

import {
  buildAyasChatPrompt,
  brainDeterministicReply,
  isUsableAyasReply,
  ayasReplyClaimsExecution,
  AYAS_MAX_REPLY_TOKENS,
  type BrainChatMessage,
  type AyasStudioContextView,
} from "@/components/brain/brainCore";
import type { BrainConsoleSnapshot } from "@/lib/brain/ui/BrainConsoleSnapshot";
import { resolveOllamaConfig } from "@/lib/ai/OllamaConfig";
import { resolveAyasChatModelProfile } from "./AyasModelProfile";

export type AyasChatStreamEvent =
  | { readonly type: "delta"; readonly text: string }
  | {
      readonly type: "done";
      /** The final text to show — the streamed text, or the corrected fallback. */
      readonly text: string;
      readonly source: "llm" | "fallback";
      /** `true` when a guard replaced the streamed text (unusable / execution claim). */
      readonly corrected: boolean;
      readonly reason?: string;
    };

export interface StreamAyasChatInput {
  readonly text: string;
  readonly snapshot: BrainConsoleSnapshot;
  readonly studio?: AyasStudioContextView;
  readonly history?: readonly { readonly role: BrainChatMessage["role"]; readonly text: string }[];
  readonly seq: number;
  readonly signal?: AbortSignal;
  /** Test seam — defaults to global `fetch`. */
  readonly fetcher?: typeof fetch;
  /** Test seam — overrides env resolution. */
  readonly env?: NodeJS.ProcessEnv;
}

interface OllamaStreamLine {
  message?: { content?: string | null };
  done?: boolean;
  done_reason?: string | null;
}

export async function* streamAyasChat(
  input: StreamAyasChatInput,
): AsyncGenerator<AyasChatStreamEvent, void, unknown> {
  const text = (input.text ?? "").trim();
  const deterministic = () => brainDeterministicReply(text, input.snapshot, input.seq).text;

  if (!text) {
    yield { type: "done", text: deterministic(), source: "fallback", corrected: true, reason: "empty-input" };
    return;
  }

  const prompt = buildAyasChatPrompt({
    userText: text,
    snapshot: input.snapshot,
    history: input.history ?? [],
    format: "text",
    ...(input.studio ? { studio: input.studio } : {}),
  });

  const env = input.env ?? process.env;
  const fetcher = input.fetcher ?? fetch;
  const base = resolveOllamaConfig(env);
  const profile = resolveAyasChatModelProfile(env, base);
  const model = profile.model;

  let full = "";
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  input.signal?.addEventListener("abort", onAbort);
  const timeout = setTimeout(() => controller.abort(), base.timeoutMs);

  try {
    const response = await fetcher(`${base.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        stream: true,
        options: {
          temperature: base.temperature,
          num_predict: AYAS_MAX_REPLY_TOKENS,
          ...(base.numCtx !== undefined ? { num_ctx: base.numCtx } : {}),
        },
      }),
      signal: controller.signal,
      redirect: "error",
    });

    if (!response.ok || !response.body) {
      yield { type: "done", text: deterministic(), source: "fallback", corrected: true, reason: `ollama-${response.status}` };
      return;
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
          continue; // skip a malformed line, keep going
        }
        const piece = typeof parsed.message?.content === "string" ? parsed.message.content : "";
        if (piece) {
          full += piece;
          yield { type: "delta", text: piece };
        }
        if (parsed.done) break;
      }
    }
  } catch (error) {
    const reason = (error as Error)?.name === "AbortError" ? "aborted" : "fetch-failed";
    yield { type: "done", text: deterministic(), source: "fallback", corrected: true, reason };
    return;
  } finally {
    clearTimeout(timeout);
    input.signal?.removeEventListener("abort", onAbort);
  }

  const finalText = full.trim();
  if (!isUsableAyasReply(finalText)) {
    yield { type: "done", text: deterministic(), source: "fallback", corrected: true, reason: "unusable-reply" };
    return;
  }
  if (ayasReplyClaimsExecution(finalText)) {
    yield { type: "done", text: deterministic(), source: "fallback", corrected: true, reason: "execution-claim" };
    return;
  }
  yield { type: "done", text: finalText, source: "llm", corrected: false };
}

/** Serialise a stream event as one SSE frame. */
export function ayasChatStreamEventToSse(event: AyasChatStreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}
