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
import { resolveAyasWorkerUrl, getStoredAyasPhoneKey } from "./ayasPhoneFallback";

export interface RunAyasChatStreamInput {
  readonly text: string;
  readonly history: readonly { readonly role: "user" | "brain" | "system"; readonly text: string }[];
  readonly seq: number;
  readonly signal?: AbortSignal;
  /** Test seam. */
  readonly fetcher?: typeof fetch;
  readonly url?: string;
  /** Extra request headers (e.g. the phone-gateway's `Authorization: Bearer …`). */
  readonly headers?: Readonly<Record<string, string>>;
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
      headers: { "Content-Type": "application/json", ...(input.headers ?? {}) },
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

  const consumeFrame = (frame: string): void => {
    const line = frame.split(/\r?\n/u).find((value) => value.startsWith("data:"));
    if (!line) return;
    let event: AyasChatStreamEvent;
    try {
      event = JSON.parse(line.slice(5).trim()) as AyasChatStreamEvent;
    } catch {
      return;
    }
    if (event.type === "delta") {
      sawDelta = true;
      input.onDelta(event.text);
    } else if (event.type === "done") {
      terminal = event;
    }
  };

  const drainFrames = (): void => {
    for (;;) {
      const separator = buffer.match(/\r?\n\r?\n/u);
      if (!separator || separator.index === undefined) return;
      const frame = buffer.slice(0, separator.index);
      buffer = buffer.slice(separator.index + separator[0].length);
      consumeFrame(frame);
    }
  };

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        streamDone = true;
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      drainFrames();
    }
    buffer += decoder.decode();
    drainFrames();
    if (buffer.trim()) consumeFrame(buffer);
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

/**
 * AYAS PC-off phone fallback (Phase 2 · P0-A.4 · Option A).
 *
 * Tries the PC endpoint first (`runAyasChatStream`, unchanged behavior). Only
 * when that fails with a genuine **network** error (the PC/tunnel is
 * unreachable — not an HTTP error from a server that IS reachable, not an
 * abort, not a stream-read fault) does it retry once against the deployed
 * Cloudflare Worker, authenticated with the phone's stored key.
 *
 * No Worker URL configured, or no phone key stored yet (the one-time
 * `?ayasPhoneKey=` bootstrap hasn't run on this device) → behaves exactly
 * like the plain `runAyasChatStream` (returns its `network` failure as-is,
 * so the caller's existing `askAyas` Server Action fallback still applies).
 */
export async function runAyasChatStreamWithPhoneFallback(
  input: RunAyasChatStreamInput & {
    /** Test seams — default to the real resolvers. */
    readonly resolveWorkerUrl?: () => string | null;
    readonly getPhoneKey?: () => string | null;
  },
): Promise<RunAyasChatStreamResult> {
  const primary = await runAyasChatStream(input);
  if (primary.ok || primary.reason !== "network") return primary;

  const workerOrigin = (input.resolveWorkerUrl ?? resolveAyasWorkerUrl)();
  const phoneKey = (input.getPhoneKey ?? getStoredAyasPhoneKey)();
  if (!workerOrigin || !phoneKey) return primary;

  return runAyasChatStream({
    ...input,
    url: `${workerOrigin}/api/ayas/chat/stream`,
    headers: { ...(input.headers ?? {}), Authorization: `Bearer ${phoneKey}` },
  });
}
