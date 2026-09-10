/**
 * Atölye Brain — Self-Healing: untrusted-input guard (pure).
 *
 * Emir §16. Runtime logs, error strings, transcripts and user chat are DATA,
 * never instructions. Before any of that text enters an incident note, a
 * report, or a prompt the Brain builds for itself, it passes through here:
 *
 *  - instruction-shaped lines ("ignore safety", "run this", "open the gate",
 *    "delete …", "send the secret …", "disable …") are quarantined — replaced
 *    with a neutral marker and returned separately as `quarantined` so a human
 *    can see what was attempted;
 *  - the result is length-bounded and control-char stripped.
 *
 * FORBIDDEN for the Brain to self-modify (see BrainPatchSafety).
 */

import { redactBrainText } from "../BrainRedaction";

const INSTRUCTION_PATTERNS: readonly RegExp[] = Object.freeze([
  /\b(ignore|bypass|disable|override|forget|skip)\b.{0,40}\b(safety|guard|rule|policy|instruction|check|limit|boundary|gate)/i,
  /\b(open|unlock|disable|bypass)\b.{0,30}\b(execution\s*gate|gate|firewall|auth|authentication)/i,
  /\b(run|exec|execute|eval|spawn|system)\b.{0,20}\b(command|shell|script|this|the following|payload)/i,
  /\b(rm\s+-rf|del\s+\/|drop\s+table|truncate\s+table|format\s+c:)/i,
  /\b(send|exfiltrate|leak|post|upload|reveal|print|echo|show|read|cat|dump|copy)\b.{0,45}(\bsecret|\btoken|\bpassword|\bapi[_\s-]?key|\bcredential|\.env|\bprivate\s*key|AYAS_ACCESS_KEY)/i,
  /\b(git\s+push|deploy|merge\s+to\s+main|force\s*push|--no-verify)\b/i,
  /\b(you are now|new instructions|system prompt|act as|jailbreak|do anything now|DAN mode)\b/i,
  /\b(writeActionsEnabled\s*=\s*true|ayasExecutionGate\s*=\s*["']?OPEN)/i,
  /\b(grant|escalate|elevate)\b.{0,30}\b(privilege|permission|access|root|admin|sudo)/i,
]);

const MARKER = "[quarantined-instruction]";

/** Control chars except \t (0x09) and \n (0x0A); plus zero-width + bidi-override code points. */
const CONTROL_AND_INVISIBLE = new RegExp(
  "[\\u0000-\\u0008\\u000B-\\u001F\\u007F" + // C0 controls (keep \t \n) + DEL
    "\\u200B-\\u200F" + // zero-width space/joiner/non-joiner + LRM/RLM
    "\\u202A-\\u202E" + // bidi embedding/override
    "\\u2066-\\u2069" + // bidi isolate
    "\\uFEFF]", // BOM / zero-width no-break space
  "g",
);

export interface BrainUntrustedResult {
  /** Safe to embed in a note / report / prompt. */
  readonly text: string;
  /** The raw lines that were quarantined — for a human, never fed back to the Brain. */
  readonly quarantined: readonly string[];
  readonly hadInstructions: boolean;
}

export interface BrainUntrustedOptions {
  readonly maxLength?: number;
  readonly maxLines?: number;
}

/** Neutralise instruction-shaped content in a block of untrusted text. */
export function sanitizeUntrustedText(input: unknown, options: BrainUntrustedOptions = {}): BrainUntrustedResult {
  const maxLength = options.maxLength ?? 4000;
  const maxLines = options.maxLines ?? 200;
  const raw = typeof input === "string" ? input : input == null ? "" : String(input);

  // Defence in depth: strip any secret shape BEFORE quarantining instructions,
  // so a token embedded in a log line never reaches a note / report / prompt.
  const cleaned = redactBrainText(raw).text.replace(CONTROL_AND_INVISIBLE, " ");

  const quarantined: string[] = [];
  const lines = cleaned
    .split(/\r?\n/)
    .slice(0, maxLines)
    .map((line) => {
      if (INSTRUCTION_PATTERNS.some((re) => re.test(line))) {
        quarantined.push(line.trim().slice(0, 300));
        return MARKER;
      }
      return line;
    });

  let text = lines.join("\n");
  // collapse a run of markers so a spammy log does not fill the note
  text = text.replace(new RegExp(`(?:${escapeRe(MARKER)}\\n?){2,}`, "g"), `${MARKER}\n`);
  if (text.length > maxLength) text = `${text.slice(0, maxLength)}…`;

  return { text: text.trim(), quarantined, hadInstructions: quarantined.length > 0 };
}

/** Convenience for a single short note (symptom / evidence line). */
export function sanitizeUntrustedNote(input: unknown, maxLength = 300): string {
  return sanitizeUntrustedText(input, { maxLength, maxLines: 4 }).text.replace(/\s+/g, " ").trim();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
