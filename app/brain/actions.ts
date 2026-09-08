"use server";

/**
 * Atölye Brain Core — server actions (Sprint 186).
 *
 * `refreshBrainConsole` re-reads the Brain's durable state (read-only).
 *
 * `askAyas` is the ONE behavioural addition: it wires the chat panel to the
 * project's EXISTING local model. It builds a deterministic AYAS prompt (see
 * `buildAyasChatPrompt`) and calls the EXISTING `OllamaProvider` via the
 * EXISTING `AIRouter` — hard-pinned to `"ollama"`, never resolved from
 * `AI_PROVIDER`, so a stray `AI_PROVIDER=openai` can never route AYAS chat to a
 * paid API.
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

import { AIRouter } from "@/lib/ai/router/AIRouter";
import type { AIProviderOutput } from "@/lib/ai/providers/AIProvider";
import {
  loadBrainConsoleSnapshot,
  type BrainConsoleSnapshot,
} from "@/lib/brain/ui/BrainConsoleSnapshot";
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
  const snapshot = await loadBrainConsoleSnapshot();
  return resolveAyasReply({
    text: input.text,
    snapshot,
    history: input.history ?? [],
    seq: input.seq,
    // EXISTING provider, hard-pinned to the free local model — never resolved
    // from `AI_PROVIDER`, so a stray `AI_PROVIDER=openai` cannot bill AYAS chat.
    // The backend runs `format: "json"`, so we pass the existing `jsonSchema`
    // option (a `{ reply: string }` envelope) and unwrap the natural-language
    // answer.
    generate: async (prompt) =>
      extractAyasReplyText(
        textOf(
          await new AIRouter()
            .getProvider("ollama")
            .generate(prompt, { maxTokens: AYAS_MAX_REPLY_TOKENS, jsonSchema: AYAS_CHAT_JSON_SCHEMA }),
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
  return Boolean(process.env.OLLAMA_HOST || process.env.OLLAMA_MODEL);
}
