import { isExplicitQualityPreset } from "@/lib/production/QualityPreset";

export const scriptTokenBudget = Object.freeze({
  environmentName: "OPENAI_SCRIPT_MAX_TOKENS",
  defaultTokens: 3200,
  minimumTokens: 2000,
  maximumTokens: 4800,
  // Sprint 178C: an explicit ATOLYE_QUALITY_PRESET scales the finished-video
  // length (Sprint 173 P2), so `resolveScriptChapterCount` grows and the strict
  // script's structured output grows with it — a documentary-length script needs
  // more room than the frozen legacy 4800-token ceiling. These preset bounds keep
  // the script prompt + completion inside a single Ollama num_ctx=8192 window
  // given the per-field-capped research block (`formatResearchForPrompt`) the
  // local pipeline produces (~1.6-2.4k prompt tokens). They are NOT a reliability
  // guarantee: a documentary-length one-shot structured script is at the upper
  // edge of what a 3B model can sustain (see the Sprint 178C report) — the
  // reliable local path is chapter-by-chapter generation.
  presetDefaultTokens: 5400,
  presetMaximumTokens: 5600,
});

export class ScriptAIConfigError extends Error {
  readonly code = "AI_SCRIPT_MAX_TOKENS_INVALID";

  constructor() {
    super("Script AI token configuration is invalid.");
    this.name = "ScriptAIConfigError";
    this.stack = undefined;
  }
}

export function getScriptMaxTokens(
  environment: NodeJS.ProcessEnv = process.env,
): number {
  const preset = isExplicitQualityPreset(environment);
  const fallbackTokens = preset
    ? scriptTokenBudget.presetDefaultTokens
    : scriptTokenBudget.defaultTokens;
  const ceilingTokens = preset
    ? scriptTokenBudget.presetMaximumTokens
    : scriptTokenBudget.maximumTokens;
  const raw = environment[scriptTokenBudget.environmentName];
  if (raw === undefined) return fallbackTokens;
  const normalized = raw.trim();
  if (!/^[0-9]+$/.test(normalized)) throw new ScriptAIConfigError();
  const parsed = Number(normalized);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < scriptTokenBudget.minimumTokens ||
    parsed > ceilingTokens
  ) throw new ScriptAIConfigError();
  return parsed;
}
