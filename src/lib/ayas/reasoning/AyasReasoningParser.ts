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

export type AyasReasoningParseFailureReason =
  | "empty-output"
  | "no-json-object"
  | "invalid-json"
  | "missing-fields"
  | "invalid-field-types";

export type AyasReasoningParseOutcome =
  | { readonly ok: true; readonly result: AyasReasoningResult }
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
      risk,
      verification,
      answer,
    },
  };
}
