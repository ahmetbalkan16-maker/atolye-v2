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

import { isUsableAyasReply, ayasReplyClaimsExecution } from "@/components/brain/brainCore";
import type { AyasModelProvider, AyasChatComplexity } from "../model/AyasModelTypes";
import { buildAyasReasoningPrompt } from "./AyasReasoningPrompt";
import { parseAyasReasoningOutput } from "./AyasReasoningParser";
import { checkAyasToolPermission } from "./AyasToolRegistry";
import type { AyasReasoningResult, AyasReasoningTrace } from "./AyasReasoningTypes";

const REASONING_COMPLEXITIES: readonly AyasChatComplexity[] = Object.freeze(["COMPLEX", "TOOL", "REPAIR", "RESEARCH"]);
const REASONING_MAX_TOKENS = 900;

export function shouldUseAyasReasoning(complexity: AyasChatComplexity): boolean {
  return REASONING_COMPLEXITIES.includes(complexity);
}

export interface RunAyasReasoningInput {
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
  | { readonly ok: true; readonly result: AyasReasoningResult; readonly trace: AyasReasoningTrace }
  | { readonly ok: false; readonly reason: string };

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
  const prompt = buildAyasReasoningPrompt({
    userText: input.userText,
    complexity: input.complexity,
    ...(input.contextLines ? { contextLines: input.contextLines } : {}),
    ...(input.memoryLines ? { memoryLines: input.memoryLines } : {}),
    ...(input.selfHealLines ? { selfHealLines: input.selfHealLines } : {}),
  });

  let raw: string;
  try {
    const out = await input.provider.chat({
      prompt,
      complexity: input.complexity,
      maxTokens: REASONING_MAX_TOKENS,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    raw = out.text;
  } catch {
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

  return { ok: true, result, trace: buildAyasReasoningTrace(result) };
}
