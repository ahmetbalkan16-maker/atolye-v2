import { AYAS_LOCAL_CODING_MAX_FEEDBACK_CHARS } from "./AyasLocalCodingModelAdapter";

/**
 * Owner protocol v2 (2026-10-15): the only failure information a repair round may show the model. An evaluator failure
 * keeps the error message and its actual/expected values; stack frames, evaluator paths and line numbers are dropped.
 * The candidate runs inside the evaluator and could print the frozen evaluator itself, so a summary that carries the
 * start of any evaluator source line is withheld entirely. Pure and deterministic; grants nothing.
 */
const LEAK_FRAGMENT_CHARS = 24;
const WITHHELD = "EVALUATOR_FAILED: details withheld.";
const STACK = /^\s+at\s/;
const PROPS = /^\s*(?:actual|expected|operator):\s/;
const ERROR = /\b(?:[A-Z][A-Za-z]*)?Error\b/;
const GENERATED_EXPRESSION = "The expression evaluated to a falsy value";
const PATHS = [/(?:\/tmp|\/opt\/ayas|[A-Za-z]:[\\/])[^\s:)'"]*/g, /\b[\w.-]*smoke-[\w.-]+/g];
const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();

export class AyasLocalCodingRepairFeedbackError extends Error {
  constructor(reason: string) { super(reason); this.name = "AyasLocalCodingRepairFeedbackError"; }
}

export function summarizeAyasLocalCodingEvaluatorFailure(input: { readonly output: string; readonly evaluatorSource: string }): {
  readonly feedback: string; readonly withheld: boolean;
} {
  if (!input || typeof input.output !== "string" || typeof input.evaluatorSource !== "string"
    || !input.evaluatorSource.trim()) throw new AyasLocalCodingRepairFeedbackError("FEEDBACK_INPUT_INVALID");
  const lines = input.output.split(/\r?\n/);
  const start = lines.findIndex((line) => ERROR.test(line));
  if (start === -1) return Object.freeze({ feedback: "EVALUATOR_FAILED: no error message.", withheld: false });
  const end = lines.findIndex((line, index) => index > start && STACK.test(line));
  const message: string[] = [];
  for (const line of lines.slice(start, end === -1 ? lines.length : end)) {
    // Node's generated assert.ok message quotes the evaluator expression itself.
    const generated = line.indexOf(GENERATED_EXPRESSION);
    if (generated !== -1) { message.push(`${line.slice(0, generated)}${GENERATED_EXPRESSION}.`); break; }
    message.push(line);
  }
  const props = end === -1 ? [] : lines.slice(end).filter((line) => PROPS.test(line)).map((line) => line.trim());
  let summary = [...message, ...props].join("\n");
  for (const pattern of PATHS) summary = summary.replace(pattern, "<evaluator>");
  summary = summary.replace(/\n{3,}/g, "\n\n").trim() || "EVALUATOR_FAILED: no error message.";
  if (summary.length > AYAS_LOCAL_CODING_MAX_FEEDBACK_CHARS) summary = `${summary.slice(0, AYAS_LOCAL_CODING_MAX_FEEDBACK_CHARS - 1).toWellFormed()}…`;
  const flat = normalize(summary);
  const leaked = input.evaluatorSource.split(/\r?\n/).map(normalize)
    .some((line) => line.length >= LEAK_FRAGMENT_CHARS && flat.includes(line.slice(0, LEAK_FRAGMENT_CHARS)));
  return Object.freeze(leaked ? { feedback: WITHHELD, withheld: true } : { feedback: summary, withheld: false });
}

/** Strict-adapter refusals restate rules the prompt already gives; scope escapes and tool calls never reach here. */
const REFUSALS: Readonly<Record<string, string>> = Object.freeze({
  PATCH_LINE_BUDGET_EXCEEDED: "PATCH_LINE_BUDGET_EXCEEDED: removed plus inserted lines exceeded maxChangedLines. Make a smaller, focused change.",
  PATCH_BASE_OR_UNIQUE_SEARCH_MISMATCH: "PATCH_BASE_OR_UNIQUE_SEARCH_MISMATCH: beforeSha256 must equal the given source sha256 and each search must occur exactly once in the original source.",
  PATCH_SCHEMA_INVALID: "PATCH_SCHEMA_INVALID: return schemaVersion \"1\" and one edit per exact file.",
  PATCH_SCOPE_OR_SCHEMA_INVALID: "PATCH_SCOPE_OR_SCHEMA_INVALID: each edit has only path, beforeSha256, search and replace, names an exact file once, and search differs from replace.",
  PATCH_TOO_LARGE: "PATCH_TOO_LARGE: the edit or the resulting file is too large.",
  MODEL_OUTPUT_INVALID: "MODEL_OUTPUT_INVALID: return exactly one complete submit_patch JSON object and nothing else.",
  MODEL_PATCH_JSON_INVALID: "MODEL_PATCH_JSON_INVALID: return exactly one complete submit_patch JSON object and nothing else.",
});

/** Fixed text for a repairable adapter refusal, or null when the refusal ends the attempt. */
export function describeAyasLocalCodingRefusal(reason: string): string | null {
  const code = typeof reason === "string" ? reason.split(":")[0]!.trim() : "";
  return Object.hasOwn(REFUSALS, code) ? REFUSALS[code]! : null;
}
