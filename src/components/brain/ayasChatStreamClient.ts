"use client";

/**
 * AYAS chat — client-side SSE consumer (spec §4).
 *
 * `runAyasChatStream` POSTs to `/api/ayas/chat/stream`, reads the
 * `text/event-stream` body, calls `onDelta` for each incremental token, and
 * resolves with the terminal `{ text, source, corrected }`.
 *
 * It NEVER throws for a transport problem: a non-OK response, a missing body, a
 * network error or an abort resolve `{ ok: false }` so the caller can fall back
 * to the non-streaming `askAyas` Server Action. Pure w.r.t. the DOM — the only
 * side effect is the injected `fetch` + the `onDelta` callback — so it is unit
 * tested with a mock `fetch`.
 */

import type { AyasChatStreamEvent } from "@/lib/ayas/AyasChatStream";

export interface RunAyasChatStreamInput {
  readonly text: string;
  readonly history: readonly { readonly role: "user" | "brain" | "system"; readonly text: string }[];
  readonly seq: number;
  readonly signal?: AbortSignal;
  /** Test seam. */
  readonly fetcher?: typeof fetch;
  readonly url?: string;
  /** Fired for every incremental token. */
  readonly onDelta: (delta: string) => void;
}

export type RunAyasChatStreamResult =
  | { readonly ok: true; readonly text: string; readonly source: "llm" | "fallback"; readonly corrected: boolean; readonly streamed: boolean }
  | { readonly ok: false; readonly reason: string };

export async function runAyasChatStream(input: RunAyasChatStreamInput): Promise<RunAyasChatStreamResult> {
  const fetcher = input.fetcher ?? fetch;
  const url = input.url ?? "/api/ayas/chat/stream";
  let sawDelta = false;

  let response: Response;
  try {
    response = await fetcher(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: input.text, history: input.history, seq: input.seq }),
      ...(input.signal ? { signal: input.signal } : {}),
    });
  } catch (error) {
    return { ok: false, reason: (error as Error)?.name === "AbortError" ? "aborted" : "network" };
  }

  if (!response.ok || !response.body) {
    return { ok: false, reason: `http-${response.status}` };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let terminal: Extract<AyasChatStreamEvent, { type: "done" }> | undefined;
  let streamDone = false;

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        streamDone = true;
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const line = frame.split("\n").find((l) => l.startsWith("data:"));
        if (!line) continue;
        let event: AyasChatStreamEvent;
        try {
          event = JSON.parse(line.slice(5).trim()) as AyasChatStreamEvent;
        } catch {
          continue;
        }
        if (event.type === "delta") {
          sawDelta = true;
          input.onDelta(event.text);
        } else if (event.type === "done") {
          terminal = event;
        }
      }
    }
  } catch (error) {
    return { ok: false, reason: (error as Error)?.name === "AbortError" ? "aborted" : "stream-read" };
  } finally {
    // Release the lock + tear down the underlying stream so a partial / aborted
    // read cannot leave a dangling reader accumulating across turns.
    if (!streamDone) {
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
    }
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
  }

  if (!terminal) {
    return { ok: false, reason: "no-terminal-event" };
  }
  return {
    ok: true,
    text: terminal.text,
    source: terminal.source,
    corrected: terminal.corrected,
    streamed: sawDelta && !terminal.corrected,
  };
}
