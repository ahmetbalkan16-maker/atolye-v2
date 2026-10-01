/**
 * Atölye Brain — AYAS Reasoning Core (Phase 2 · Phase D).
 *
 *   USER INPUT → CONTEXT → MEMORY → INTENT → COMPLEXITY
 *     SIMPLE/NORMAL → (bypass — the existing direct chat path, unchanged)
 *     COMPLEX/TOOL/REPAIR/RESEARCH → Reasoning Core → structured result →
 *       execution-permission check (always DENY/blocked — gate is CLOSED) → answer
 *
 * One-shot, not token-streamed: the model must return one JSON object, so this
 * calls `provider.chat()` (not `.stream()`) once. The caller (`AyasChatStream.ts`)
 * still emits it to the client as a normal delta+done pair — the SSE contract
 * doesn't change, only how the text was produced.
 *
 * Reuses the SAME safety backstops as every other AYAS reply path
 * (`isUsableAyasReply` / `ayasReplyClaimsExecution`) — a reasoning "answer" is
 * not special-cased past them.
 */

import {
  AyasContextBudgetError,
  ayasHistoryContextCandidates,
  ayasMemoryContextCandidates,
  buildBudgetedAyasPrompt,
  type AyasContextBudgetEvidence,
} from "../context/AyasContextBudget";
import { isUsableAyasReply, ayasReplyClaimsExecution } from "@/components/brain/brainCore";
import type { AyasModelProvider, AyasChatComplexity } from "../model/AyasModelTypes";
import { buildAyasReasoningPrompt } from "./AyasReasoningPrompt";
import { parseAyasReasoningOutput, AYAS_REASONING_JSON_SCHEMA } from "./AyasReasoningParser";
import { checkAyasToolPermission } from "./AyasToolRegistry";
import type { AyasReasoningResult, AyasReasoningTrace } from "./AyasReasoningTypes";

const REASONING_COMPLEXITIES: readonly AyasChatComplexity[] = Object.freeze(["COMPLEX", "TOOL", "REPAIR", "RESEARCH"]);
const REASONING_MAX_TOKENS = 900;

export function shouldUseAyasReasoning(complexity: AyasChatComplexity): boolean {
  return REASONING_COMPLEXITIES.includes(complexity);
}

/** Heading the earlier turns are rendered under. */
const RECENT_TURNS_HEADING = "Yakın konuşma turları (en güncel bağlam; kalıcı hafızadan önceliklidir):";

function reasoningTurnLine(turn: { readonly role: string; readonly text: string }): string {
  return `${turn.role === "user" ? "Kullanıcı" : "AYAS"}: ${turn.text}`;
}

export interface RunAyasReasoningInput {
  /**
   * Post-freeze 15C — the model window. When given, the prompt is admitted against it: `historyTurns` and the
   * recalled lines outside `protectedMemoryLines` are shed under pressure, the rest is kept or the call is refused
   * with `CONTEXT_BUDGET_UNSAFE`. `null` is an unknown window and always refuses. Omitted = no admission here.
   */
  readonly contextCeiling?: number | null;
  /** Earlier turns, rendered after `contextLines` under the recent-turns heading. */
  readonly historyTurns?: readonly { readonly role: string; readonly text: string }[];
  readonly protectedMemoryLines?: readonly string[];
  readonly userText: string;
  readonly complexity: AyasChatComplexity;
  readonly provider: AyasModelProvider;
  readonly contextLines?: readonly string[];
  readonly memoryLines?: readonly string[];
  readonly selfHealLines?: readonly string[];
  readonly signal?: AbortSignal;
  /** Stream integration defers answer guards to its shared final-response pipeline. */
  readonly deferAnswerGuards?: boolean;
}

export type RunAyasReasoningOutcome =
  | {
      readonly ok: true;
      readonly result: AyasReasoningResult;
      readonly trace: AyasReasoningTrace;
      /**
       * `true` when the model named at least one tool BEFORE the registry
       * filter ran — even if every one of them was unknown/disallowed and
       * `result.requiredTools` ended up empty. An adversarial-sweep finding:
       * without this, a model asked to use an invented tool name (filtered
       * out entirely) looked identical to a turn that named no tool at all,
       * so the Action Runtime's fake-completion-claim guard never armed —
       * exactly the turn where a fabricated "here's the result" answer is
       * most likely.
       */
      readonly anyToolNamedBeforeFilter: boolean;
      /** Body-free record of what the context budget kept and shed; present when a window was given. */
      readonly contextBudget?: AyasContextBudgetEvidence;
    }
  | { readonly ok: false; readonly reason: string; readonly contextBudget?: AyasContextBudgetEvidence };

/** Builds the safe, secret-free trace (spec §10) — never the raw model JSON, never a CoT. */
export function buildAyasReasoningTrace(result: AyasReasoningResult): AyasReasoningTrace {
  return {
    intent: result.intent,
    goal: result.goal,
    plan: result.plan,
    requiredTools: result.requiredTools,
    risk: result.risk,
    verification: result.verification,
  };
}

export async function runAyasReasoning(input: RunAyasReasoningInput): Promise<RunAyasReasoningOutcome> {
  const turns = input.historyTurns ?? [];
  const memory = input.memoryLines ?? [];
  const render = (keptTurns: typeof turns, keptMemory: readonly string[]) => {
    const contextLines = [...(input.contextLines ?? []), ...(keptTurns.length ? [RECENT_TURNS_HEADING, ...keptTurns.map(reasoningTurnLine)] : [])];
    return buildAyasReasoningPrompt({
      userText: input.userText,
      complexity: input.complexity,
      ...(contextLines.length ? { contextLines } : {}),
      ...(keptMemory.length ? { memoryLines: keptMemory } : {}),
      ...(input.selfHealLines ? { selfHealLines: input.selfHealLines } : {}),
    });
  };

  let prompt: string;
  let contextBudget: AyasContextBudgetEvidence | undefined;
  if (input.contextCeiling === undefined) {
    prompt = render(turns, memory);
  } else {
    const protectedMemory = new Set(input.protectedMemoryLines ?? []);
    try {
      const budgeted = buildBudgetedAyasPrompt({
        ceiling: input.contextCeiling,
        outputReserve: REASONING_MAX_TOKENS,
        candidates: [...ayasHistoryContextCandidates(turns, reasoningTurnLine), ...ayasMemoryContextCandidates(memory, protectedMemory)],
        render: (selected) =>
          render(
            turns.filter((_, index) => selected.has(`history:${index}`)),
            memory.filter((line, index) => protectedMemory.has(line) || selected.has(`memory:${index}`)),
          ),
      });
      prompt = budgeted.prompt;
      contextBudget = budgeted.evidence;
    } catch (error) {
      if (!(error instanceof AyasContextBudgetError)) throw error;
      return { ok: false, reason: "CONTEXT_BUDGET_UNSAFE", contextBudget: error.evidence };
    }
  }

  let raw: string;
  try {
    const out = await input.provider.chat({
      prompt,
      complexity: input.complexity,
      maxTokens: REASONING_MAX_TOKENS,
      // Action Runtime RELIABILITY sprint — pinned to 0 (greedy decoding),
      // scoped to ONLY this one-shot structured-JSON call. A live
      // acceptance report found the SAME explicit, unambiguous request
      // could dispatch on one run and honestly decline on the next, purely
      // from the reasoning call's non-zero sampling temperature (the
      // pipeline's shared default, otherwise used everywhere). Pinning it
      // here makes THIS call's output consistent for a given input without
      // touching the direct-stream path's or the grounding call's
      // temperature — both keep the pipeline default, since naturalness of
      // the user-facing prose (not tool selection) is what matters there.
      temperature: 0,
      // M12 — ask a provider that supports it (currently Ollama) to
      // constrain its raw output to this exact shape via grammar-based
      // decoding, instead of relying on prompt instructions alone. Never a
      // substitute for validation: `parseAyasReasoningOutput` below still
      // independently checks every field exactly as before, for every
      // provider, including one that has no such capability and ignores
      // this entirely.
      responseSchema: AYAS_REASONING_JSON_SCHEMA,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    raw = out.text;
  } catch (error) {
    // The transport refused the prompt, or measured it past the window after the fact: not a transport fault.
    if (error instanceof AyasContextBudgetError) return { ok: false, reason: "CONTEXT_BUDGET_UNSAFE", contextBudget: error.evidence };
    return { ok: false, reason: "reasoning-transport-failed" };
  }

  const parsed = parseAyasReasoningOutput(raw, input.complexity);
  if (!parsed.ok) {
    return { ok: false, reason: `reasoning-parse-failed:${parsed.reason}` };
  }

  // Every named tool is re-checked against the live registry — belt + suspenders
  // on top of the parser's own filtering. A tool the registry does not currently
  // allow (execution-gate-gated, or unknown) is dropped from `requiredTools`
  // here — the field is a guarantee ("this is actually permitted right now"),
  // never a wishlist. None of this ever calls an executor.
  const allowedTools = parsed.result.requiredTools.filter((id) => checkAyasToolPermission(id).allowed);
  const result: AyasReasoningResult = { ...parsed.result, requiredTools: allowedTools };

  if (!input.deferAnswerGuards && !isUsableAyasReply(result.answer)) {
    return { ok: false, reason: "reasoning-unusable-answer" };
  }
  if (!input.deferAnswerGuards && ayasReplyClaimsExecution(result.answer)) {
    return { ok: false, reason: "reasoning-execution-claim" };
  }

  return {
    ok: true,
    result,
    trace: buildAyasReasoningTrace(result),
    anyToolNamedBeforeFilter: parsed.rawToolCount > 0,
    ...(contextBudget ? { contextBudget } : {}),
  };
}
