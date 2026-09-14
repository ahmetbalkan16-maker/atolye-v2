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
import { routeAyasModel, type AyasModelRoute } from "./model/AyasModelRouter";
import type { AyasModelProviderId, AyasChatComplexity } from "./model/AyasModelTypes";
import { assembleAyasContext } from "./context/AyasContextAssembly";
import { recallAyasMemoryWithTrace, persistAyasMemoryFromTurn } from "./memory/AyasMemoryRecall";
import type { AyasMemoryStoreOptions } from "./memory/AyasMemoryStore";
import { shouldUseAyasReasoning, runAyasReasoning } from "./reasoning/AyasReasoningCore";
import type { AyasReasoningTrace } from "./reasoning/AyasReasoningTypes";
import { loadBrainSelfHealSnapshot } from "@/lib/brain/ui/BrainSelfHealConsoleSnapshot";

/**
 * Safe, secret-free memory observability trace (real-user-test root-cause
 * fix) — boolean/count metadata ONLY, never raw memory text, never the user
 * message, never a secret. `candidateCount`/`persisted` describe what THIS
 * turn's own message contributed to memory (computed synchronously — see
 * the `await persistAyasMemoryFromTurn` call below, moved BEFORE this event
 * is yielded so the numbers it reports are already real, not a guess about
 * a background task that might still be in flight). `recallCount`/
 * `identityRecallCount`/`promptInjected`/`historyCount` describe what was
 * recalled/used to build THIS reply.
 */
export interface AyasMemoryTrace {
  readonly candidateCount: number;
  readonly persisted: boolean;
  readonly recallCount: number;
  readonly identityRecallCount: number;
  readonly promptInjected: boolean;
  readonly historyCount: number;
}

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
      /** Which model answered — for the operational trace. Absent on the pure deterministic path. */
      readonly provider?: AyasModelProviderId;
      /** Coarse turn shape decided before the call. */
      readonly complexity?: AyasChatComplexity;
      /** Safe, secret-free reasoning summary (Phase D) — present only for COMPLEX/TOOL/REPAIR/RESEARCH turns that used the Reasoning Core. Never a raw model dump or chain-of-thought. */
      readonly reasoning?: AyasReasoningTrace;
      /** Safe, secret-free memory observability trace — see {@link AyasMemoryTrace}. Absent only on the pure deterministic (no-provider) fallback path, which never touches memory. */
      readonly memoryTrace?: AyasMemoryTrace;
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
  /** Test seam — inject a routing decision instead of probing model health. */
  readonly route?: AyasModelRoute;
  /**
   * Test seam — overrides the memory store's `rootDir` for BOTH the recall
   * and persist calls this turn. Omitted (the real production call from
   * `route.ts` never sets it) → both default to the real, unchanged
   * `data/brain/memory` root — production behavior is byte-for-byte
   * identical to before this field existed. Exists so the real-user-test
   * two-turn memory bug can be reproduced/asserted end-to-end against
   * `streamAyasChat` itself (the exact function the HTTP route calls)
   * without ever touching the operator's real memory file.
   */
  readonly memoryStore?: AyasMemoryStoreOptions;
}

/** Best-effort temperature for the model call — kept at the pipeline default. */
function resolveChatTemperature(env: NodeJS.ProcessEnv): number | undefined {
  try {
    return resolveOllamaConfig(env).temperature;
  } catch {
    return undefined;
  }
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

  const env = input.env ?? process.env;
  const fetcher = input.fetcher ?? fetch;

  // 1 — route: which model answers this turn (availability + complexity).
  const route =
    input.route ?? (await routeAyasModel({ text, env, fetcher, signal: input.signal }).catch(() => null));
  const complexity = route?.decision.complexity;

  if (!route || !route.provider) {
    yield {
      type: "done",
      text: route?.decision.unavailableMessage ?? deterministic(),
      source: "fallback",
      corrected: true,
      reason: route?.decision.reason ?? "no-provider",
      ...(complexity ? { complexity } : {}),
    };
    return;
  }
  const providerId = route.decision.providerId!;

  // Phase B — deterministic conversation context (state + reference resolution +
  // older-turn compression). Phase C — recalled long-term memory (top-K, safe).
  const ctx = assembleAyasContext({
    userText: text,
    history: input.history ?? [],
    ...(input.studio ? { studio: input.studio } : {}),
  });
  const memoryRecall = await recallAyasMemoryWithTrace(text, {
    ...(ctx.trace.activeProject ? { activeProject: ctx.trace.activeProject } : {}),
    ...(input.memoryStore ? { store: input.memoryStore } : {}),
  }).catch(() => ({ lines: [] as readonly string[], recallCount: 0, identityRecallCount: 0 }));
  const memoryLines = memoryRecall.lines;
  /** Shared by both terminal-event sites below — see `AyasMemoryTrace`'s own doc comment for what each field means and why persist is awaited BEFORE this is built. */
  const buildMemoryTrace = (persistOutcome: { candidates: number; stored: number }): AyasMemoryTrace => ({
    candidateCount: persistOutcome.candidates,
    persisted: persistOutcome.stored > 0,
    recallCount: memoryRecall.recallCount,
    identityRecallCount: memoryRecall.identityRecallCount,
    promptInjected: memoryLines.length > 0,
    historyCount: ctx.recentHistory.length,
  });

  // Phase D — the complexity gate. SIMPLE/NORMAL never reach the Reasoning
  // Core (falls through to the existing direct-stream path below, unchanged).
  // COMPLEX/TOOL/REPAIR/RESEARCH get a structured pass first; its `answer` is
  // what the user sees, guarded exactly like every other AYAS reply.
  if (shouldUseAyasReasoning(route.decision.complexity)) {
    const contextLines = [
      ...(ctx.block.stateLines ?? []),
      ...(ctx.block.referenceLines ?? []),
      ...(ctx.block.historySummary ?? []),
    ];
    // REPAIR only — a redacted, read-only self-heal summary. Never fetched for
    // any other complexity (no reason to touch that store otherwise).
    let selfHealLines: string[] | undefined;
    if (route.decision.complexity === "REPAIR") {
      try {
        const heal = loadBrainSelfHealSnapshot();
        selfHealLines = [
          `self-heal durumu: ${heal.health.summary} (açık olay: ${heal.health.openIncidents}, insan gerekiyor: ${heal.health.needsHuman}, risk: ${heal.currentRisk})`,
          ...(heal.lastRootCause ? [`son doğrulanmış kök neden: ${heal.lastRootCause}`] : []),
          ...heal.activeIncidents.slice(0, 2).map((i) => `aktif olay: ${i.symptom} (${i.rootCause ?? "kök neden bilinmiyor"})`),
        ];
      } catch {
        selfHealLines = undefined;
      }
    }

    const outcome = await runAyasReasoning({
      userText: text,
      complexity: route.decision.complexity,
      provider: route.provider,
      ...(contextLines.length ? { contextLines } : {}),
      ...(memoryLines.length ? { memoryLines } : {}),
      ...(selfHealLines?.length ? { selfHealLines } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
    });

    if (!outcome.ok) {
      yield {
        type: "done",
        text: deterministic(),
        source: "fallback",
        corrected: true,
        reason: outcome.reason,
        provider: providerId,
        complexity: route.decision.complexity,
      };
      return;
    }

    // Persist BEFORE the terminal event, AWAITED — see `AyasMemoryTrace`'s doc
    // comment: this makes "the write completed before the caller sees the
    // reply" an explicit, provable guarantee rather than an accident of
    // `AyasMemoryStore.append` currently being synchronous fs I/O hidden
    // behind an `async` wrapper (real-user-test race-condition audit item).
    const persistOutcome = await persistAyasMemoryFromTurn({
      userText: text,
      ayasReply: outcome.result.answer,
      ...(input.memoryStore ? { store: input.memoryStore } : {}),
    }).catch(() => ({ candidates: 0, stored: 0, rejected: 0 }));

    yield { type: "delta", text: outcome.result.answer };
    yield {
      type: "done",
      text: outcome.result.answer,
      source: "llm",
      corrected: false,
      provider: providerId,
      complexity: route.decision.complexity,
      reasoning: outcome.trace,
      memoryTrace: buildMemoryTrace(persistOutcome),
    };
    return;
  }

  const prompt = buildAyasChatPrompt({
    userText: text,
    snapshot: input.snapshot,
    history: ctx.recentHistory,
    format: "text",
    conversation: ctx.block,
    ...(memoryLines.length ? { memoryLines } : {}),
    ...(input.studio ? { studio: input.studio } : {}),
  });

  // 2 — stream from the chosen provider (Ollama or Cloud, same contract).
  let full = "";
  try {
    for await (const chunk of route.provider.stream({
      prompt,
      complexity: route.decision.complexity,
      maxTokens: AYAS_MAX_REPLY_TOKENS,
      temperature: resolveChatTemperature(env),
      signal: input.signal,
    })) {
      if (chunk.type === "delta") {
        full += chunk.text;
        yield { type: "delta", text: chunk.text };
      }
    }
  } catch (error) {
    const name = (error as Error)?.name === "AbortError" ? "aborted" : "fetch-failed";
    // Provider transport failure → honest deterministic reply. NOTE: only the
    // error NAME is used; a cloud error body is never surfaced.
    yield {
      type: "done",
      text: deterministic(),
      source: "fallback",
      corrected: true,
      reason: `${providerId}-${name}`,
      provider: providerId,
      ...(complexity ? { complexity } : {}),
    };
    return;
  }

  // 3 — the same safety backstops, provider-agnostic.
  const finalText = full.trim();
  if (!isUsableAyasReply(finalText)) {
    yield {
      type: "done",
      text: deterministic(),
      source: "fallback",
      corrected: true,
      reason: "unusable-reply",
      provider: providerId,
      ...(complexity ? { complexity } : {}),
    };
    return;
  }
  if (ayasReplyClaimsExecution(finalText)) {
    yield {
      type: "done",
      text: deterministic(),
      source: "fallback",
      corrected: true,
      reason: "execution-claim",
      provider: providerId,
      ...(complexity ? { complexity } : {}),
    };
    return;
  }
  // Phase C — memory write side. AWAITED, BEFORE the terminal event (moved
  // here from an unawaited "fire-and-forget" call — real-user-test
  // race-condition audit item): extract candidates from this turn, gate each
  // (candidate → scoring → redaction → store/reject), persist the survivors.
  // Still never throws into the stream (`.catch` below); `AyasMemoryStore.append`
  // is synchronous fs I/O today, so this was never actually slow — awaiting it
  // just makes "the write is done before the reply is shown" an explicit,
  // provable guarantee instead of relying on that implementation detail.
  const persistOutcome = await persistAyasMemoryFromTurn({
    userText: text,
    ayasReply: finalText,
    ...(input.memoryStore ? { store: input.memoryStore } : {}),
  }).catch(() => ({ candidates: 0, stored: 0, rejected: 0 }));

  yield {
    type: "done",
    text: finalText,
    source: "llm",
    corrected: false,
    provider: providerId,
    ...(complexity ? { complexity } : {}),
    memoryTrace: buildMemoryTrace(persistOutcome),
  };
}

/** Serialise a stream event as one SSE frame. */
export function ayasChatStreamEventToSse(event: AyasChatStreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}
