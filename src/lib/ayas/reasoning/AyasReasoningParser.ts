/**
 * Atölye Brain — AYAS Reasoning Core output parser (Phase 2 · Phase D · §5).
 *
 * Turns the model's raw text into a validated {@link AyasReasoningResult}, or
 * a typed failure the caller falls back on. Never throws. Bounded (a runaway
 * model cannot balloon the prompt/trace) and defensive about `requiredTools`
 * (an id the tool registry doesn't know is DROPPED, not trusted — this parser
 * does not itself decide permission; {@link checkAyasToolPermission} does).
 *
 * The caller's classified `complexity` — not whatever the model claims — is
 * always the one written into the result, so a reply cannot understate its
 * own complexity to dodge the guards.
 */

import type { AyasChatComplexity } from "../model/AyasModelTypes";
import type { AyasReasoningResult } from "./AyasReasoningTypes";
import { findAyasTool } from "./AyasToolRegistry";

const MAX_STRING = 4_000;
const MAX_SHORT_STRING = 400;
const MAX_ARRAY = 12;

/**
 * JSON Schema for the SAME shape this parser validates below — passed to a
 * provider's own constrained-generation support (currently Ollama's
 * `format`) so the raw model output is far more likely to already conform,
 * instead of relying on prompt instructions alone. This is a generation
 * HINT only: `parseAyasReasoningOutput` below still independently validates
 * every field exactly as before, unconditionally, for every provider
 * (including one that ignores this schema entirely). Keep this in sync by
 * hand with the fields `parseAyasReasoningOutput` reads — there is no
 * runtime link between the two, only this shared file.
 */
export const AYAS_REASONING_JSON_SCHEMA: Readonly<Record<string, unknown>> = Object.freeze({
  type: "object",
  properties: {
    intent: { type: "string" },
    goal: { type: "string" },
    constraints: { type: "array", items: { type: "string" } },
    assumptions: { type: "array", items: { type: "string" } },
    plan: { type: "array", items: { type: "string" } },
    requiredTools: { type: "array", items: { type: "string" } },
    toolInput: {
      type: "object",
      properties: { documentId: { type: "string" }, filePath: { type: "string" } },
    },
    risk: { type: "string" },
    verification: { type: "array", items: { type: "string" } },
    answer: { type: "string" },
  },
  required: ["intent", "goal", "constraints", "assumptions", "plan", "requiredTools", "risk", "verification", "answer"],
});

export type AyasReasoningParseFailureReason =
  | "empty-output"
  | "no-json-object"
  | "invalid-json"
  | "missing-fields"
  | "invalid-field-types";

export type AyasReasoningParseOutcome =
  | {
      readonly ok: true;
      readonly result: AyasReasoningResult;
      /**
       * How many tool ids the model's raw JSON named BEFORE `findAyasTool`
       * dropped the ones the registry has never heard of — an invented tool
       * name (e.g. "run_shell_command") is filtered out at THIS layer, so
       * `result.requiredTools` alone can't distinguish "named an invented
       * tool" from "named nothing at all". The Action Runtime's
       * fake-completion-claim guard needs the former to still arm.
       */
      readonly rawToolCount: number;
    }
  | { readonly ok: false; readonly reason: AyasReasoningParseFailureReason };

/**
 * `undefined`/`null` (the field is simply absent) is treated as "" — a
 * `missing-fields` failure downstream, not a type error. A field that IS
 * present but the wrong type (a number, an object, …) is a genuine
 * `invalid-field-types` failure — `null` here.
 */
function clampString(v: unknown, max: number): string | null {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function clampStringArray(v: unknown, maxItems: number, maxLen: number): readonly string[] | null {
  if (!Array.isArray(v)) return null;
  return v
    .filter((x) => typeof x === "string" && x.trim())
    .slice(0, maxItems)
    .map((x) => ((x as string).length > maxLen ? (x as string).slice(0, maxLen) : (x as string).trim()));
}

/** Extracts the first top-level `{...}` object from text that may carry stray prose or a markdown fence. */
function extractJsonObject(raw: string): string | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return candidate.slice(start, end + 1);
}

export function parseAyasReasoningOutput(raw: string, complexity: AyasChatComplexity): AyasReasoningParseOutcome {
  const text = (raw ?? "").trim();
  if (!text) return { ok: false, reason: "empty-output" };

  const jsonText = extractJsonObject(text);
  if (!jsonText) return { ok: false, reason: "no-json-object" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { ok: false, reason: "invalid-json" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, reason: "invalid-json" };
  }
  const p = parsed as Record<string, unknown>;

  const intent = clampString(p.intent, MAX_SHORT_STRING);
  const goal = clampString(p.goal, MAX_SHORT_STRING);
  const risk = clampString(p.risk, MAX_SHORT_STRING);
  const answer = clampString(p.answer, MAX_STRING);
  if (intent === null || goal === null || risk === null || answer === null) {
    return { ok: false, reason: "invalid-field-types" };
  }
  if (!intent || !goal || !answer) {
    return { ok: false, reason: "missing-fields" };
  }

  const constraints = clampStringArray(p.constraints, MAX_ARRAY, MAX_SHORT_STRING);
  const assumptions = clampStringArray(p.assumptions, MAX_ARRAY, MAX_SHORT_STRING);
  const plan = clampStringArray(p.plan, MAX_ARRAY, MAX_SHORT_STRING);
  const verification = clampStringArray(p.verification, MAX_ARRAY, MAX_SHORT_STRING);
  const rawTools = clampStringArray(p.requiredTools, MAX_ARRAY, 200);
  if (constraints === null || assumptions === null || plan === null || verification === null || rawTools === null) {
    return { ok: false, reason: "invalid-field-types" };
  }

  // Drop any tool id the registry doesn't recognise — never trust a model-invented id.
  const requiredTools = rawTools.filter((id) => findAyasTool(id) !== null);

  // Fail-soft, never fails the whole parse: an absent/malformed `toolInput`
  // (or either of its fields) just means no hint reached the Action Runtime —
  // dispatch for a tool that needs one is then skipped, not crashed. The
  // Action Runtime re-validates whatever DOES come through from scratch
  // regardless (closed enum / strict path checks) — this is only a hint.
  const toolInput = parseToolInputHint(p.toolInput);

  return {
    ok: true,
    result: {
      intent,
      goal,
      constraints,
      assumptions,
      complexity, // caller's classification wins, never the model's own claim
      plan,
      requiredTools,
      ...(toolInput ? { toolInput } : {}),
      risk,
      verification,
      answer,
    },
    rawToolCount: rawTools.length,
  };
}

const MAX_TOOL_INPUT_STRING = 300;

function parseToolInputHint(v: unknown): { documentId?: string; filePath?: string } | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const raw = v as Record<string, unknown>;
  const documentId = clampString(raw.documentId, MAX_TOOL_INPUT_STRING);
  const filePath = clampString(raw.filePath, MAX_TOOL_INPUT_STRING);
  // clampString returns null only for a present-but-wrong-typed field — drop
  // that one field rather than the whole hint (still fail-soft overall).
  const out: { documentId?: string; filePath?: string } = {};
  if (documentId) out.documentId = documentId;
  if (filePath) out.filePath = filePath;
  return Object.keys(out).length ? out : null;
}
