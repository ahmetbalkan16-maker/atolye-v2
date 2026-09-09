"use server";

/**
 * Atölye Brain Core — server actions (Sprint 186).
 *
 * `refreshBrainConsole` re-reads the Brain's durable state (read-only).
 *
 * `askAyas` wires the chat panel to the project's EXISTING local model. It builds
 * a deterministic AYAS prompt (see `buildAyasChatPrompt`) and calls the EXISTING
 * `OllamaProvider` directly — via `createAyasChatProvider`, which is the same
 * `OllamaProvider` class the `AIRouter` uses, never resolved from `AI_PROVIDER`,
 * so a stray `AI_PROVIDER=openai` can never route AYAS chat to a paid API. The
 * only difference from the pipeline provider is an OPTIONAL `AYAS_OLLAMA_MODEL`
 * override that applies to AYAS chat alone (spec §3).
 *
 * It deliberately does NOT go through `runObservedAIRequest`: that path writes
 * `data/projects/<slug>/ai-usage.json` (`unknown` slug when context-less — a
 * file the operator asked us not to touch), and its cost guard is a no-op for
 * the free `ollama` provider anyway. So `askAyas` calls the provider directly
 * and writes no telemetry.
 *
 * The execution gate stays CLOSED: chat is prompt → text. It enqueues nothing,
 * runs no task/pipeline/GPU, approves nothing.
 */

import type { AIProviderOutput } from "@/lib/ai/providers/AIProvider";
import {
  loadBrainConsoleSnapshot,
  type BrainConsoleSnapshot,
} from "@/lib/brain/ui/BrainConsoleSnapshot";
import { loadAyasStudioContext } from "@/lib/ayas/AyasStudioContext";
import { createAyasChatProvider, resolveAyasChatModelProfile, AYAS_MODEL_ENV } from "@/lib/ayas/AyasModelProfile";
import {
  AYAS_CHAT_JSON_SCHEMA,
  AYAS_MAX_REPLY_TOKENS,
  extractAyasReplyText,
  resolveAyasReply,
  type AyasReplyOutcome,
  type BrainChatMessage,
} from "@/components/brain/brainCore";

export async function refreshBrainConsole(): Promise<BrainConsoleSnapshot> {
  return loadBrainConsoleSnapshot();
}

export interface AskAyasInput {
  readonly text: string;
  readonly history: readonly { readonly role: BrainChatMessage["role"]; readonly text: string }[];
  readonly seq: number;
}

function textOf(output: AIProviderOutput): string {
  if (typeof output === "string") return output;
  return output.refused ? "" : output.content ?? "";
}

export async function askAyas(input: AskAyasInput): Promise<AyasReplyOutcome> {
  const [snapshot, studio] = await Promise.all([
    loadBrainConsoleSnapshot(),
    // Read-only: the active runtime authority path + real project inventory,
    // so AYAS answers "kaç proje var" / "runtime authority neresi" from fact.
    loadAyasStudioContext(),
  ]);
  return resolveAyasReply({
    text: input.text,
    snapshot,
    studio,
    history: input.history ?? [],
    seq: input.seq,
    // The local `OllamaProvider`, hard-pinned — never resolved from `AI_PROVIDER`,
    // so a stray `AI_PROVIDER=openai` cannot bill AYAS chat. The backend runs
    // `format: "json"`, so we pass the existing `jsonSchema` option (a
    // `{ reply: string }` envelope) and unwrap the natural-language answer.
    generate: async (prompt) =>
      extractAyasReplyText(
        textOf(
          await createAyasChatProvider().generate(prompt, {
            maxTokens: AYAS_MAX_REPLY_TOKENS,
            jsonSchema: AYAS_CHAT_JSON_SCHEMA,
          }),
        ),
      ),
  });
}

/**
 * Whether the local model backend is *configured* (a cheap env check — no
 * network call). Lets the UI drop the "not connected" note when AYAS is
 * expected to answer via the model. A configured-but-unreachable model still
 * falls back gracefully per `askAyas`.
 */
export async function ayasModelConfigured(): Promise<boolean> {
  return Boolean(process.env.OLLAMA_HOST || process.env.OLLAMA_MODEL || process.env[AYAS_MODEL_ENV]);
}

/**
 * The model AYAS chat will use + whether `AYAS_OLLAMA_MODEL` overrode the
 * pipeline default (spec §3 — surfaced in the activation report, not the UI).
 */
export async function ayasChatModel(): Promise<{ model: string; overridden: boolean }> {
  const profile = resolveAyasChatModelProfile();
  return { model: profile.model, overridden: profile.overridden };
}
