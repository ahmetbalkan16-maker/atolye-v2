import { estimateTokenCallCeiling, estimateTokenCost } from "../../ai/AiPricing";
import type { AIProvider, AIProviderGenerateOptions, AIProviderOutput, AIProviderResult } from "../../ai/providers/AIProvider";
import { governProductionCostCheckpoint, PRODUCTION_COST_POLICY } from "../../production/ProductionCostGovernor";

/**
 * Per-episode spend guard for V3. Every paid call is priced at its worst case (prompt + the full output budget)
 * from Atölye's single price table and checked against the reserved cap with the production cost checkpoint
 * before it goes out; a call that would cross the cap is never made — it falls back to the free local model, or
 * stops when there is none. The owner's rule: one video costs at most $1 (`technicalCeilingUsd`).
 */
export interface V3ModelChoice {
  /** `ollama` and `mock` are free; `openai` is billed. */
  readonly provider: "openai" | "ollama" | "mock";
  /** OpenAI model id; ignored by free providers. */
  readonly model?: string;
}

export interface V3SpendEntry {
  readonly step: string;
  readonly provider: string;
  readonly model: string;
  /** Worst-case estimate the checkpoint saw. */
  readonly ceilingUsd: number;
  /** Priced from the reported usage; the ceiling when the provider reported none. */
  readonly costUsd: number;
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  /** Set when the planned paid call was replaced by the free fallback. */
  readonly fellBackFrom?: string;
  readonly reason: string;
}

export class V3BudgetError extends Error {
  constructor(readonly code: "V3_BUDGET_EXCEEDED" | "V3_BUDGET_UNKNOWN_PRICE" | "V3_BUDGET_INPUT", message: string) {
    super(`${code}: ${message}`);
  }
}

/** Turkish tokenises denser than English; inflate the char count before the price table's chars/4 rule. */
const TURKISH_CHAR_FACTOR = 1.4;

/** Videos longer than this are long form: written chapter by chapter, with their own spending cap. */
export const LONG_FORM_MIN_S = 300;
/** Owner, 21 Oct 2026: a 15–20 minute video may spend up to $4 on OpenAI (a short one stays at the policy's $1). */
export const LONG_FORM_CAP_USD = 4;

/** The paid-call ceiling of a whole video of `seconds` (script, costumes, YouTube package together). */
export function videoCapUsd(seconds: number): number {
  return seconds > LONG_FORM_MIN_S ? LONG_FORM_CAP_USD : PRODUCTION_COST_POLICY.technicalCeilingUsd;
}

export interface V3BudgetOptions {
  readonly capUsd?: number;
  /** Providers by name; tests inject fakes. */
  readonly providers: Readonly<Partial<Record<V3ModelChoice["provider"], AIProvider>>>;
  /** Free provider used when a paid call would cross the cap; none = stop instead. */
  readonly fallback?: V3ModelChoice;
}

function asResult(out: AIProviderOutput): AIProviderResult {
  return typeof out === "string" ? { content: out, finishReason: "unknown", refused: false, complete: true, truncated: false } : out;
}

export class V3Budget {
  readonly capUsd: number;
  private readonly entries: V3SpendEntry[] = [];

  constructor(private readonly options: V3BudgetOptions) {
    this.capUsd = options.capUsd ?? PRODUCTION_COST_POLICY.technicalCeilingUsd;
  }

  get spentUsd(): number {
    return Math.round(this.entries.reduce((sum, e) => sum + e.costUsd, 0) * 1e6) / 1e6;
  }

  get ledger(): readonly V3SpendEntry[] {
    return this.entries;
  }

  async generate(step: string, choice: V3ModelChoice, prompt: string, opts: AIProviderGenerateOptions & { readonly maxTokens: number }): Promise<{ result: AIProviderResult; used: V3ModelChoice }> {
    const model = choice.provider === "openai" ? (choice.model ?? "") : choice.provider;
    const ceiling = estimateTokenCallCeiling({ provider: choice.provider, model, promptChars: Math.ceil(prompt.length * TURKISH_CHAR_FACTOR), maxTokens: opts.maxTokens });
    if (ceiling.status === "unknown") throw new V3BudgetError("V3_BUDGET_UNKNOWN_PRICE", `${choice.provider}/${model} fiyat tablosunda yok; çağrı yapılmadı`);
    const decision = governProductionCostCheckpoint({
      observedUsd: this.spentUsd,
      observedPricing: "KNOWN",
      nextCallUsd: ceiling.costUsd,
      nextCallPricing: "KNOWN",
      reservedCapUsd: this.capUsd,
    });
    if (decision.decision === "BLOCK") throw new V3BudgetError("V3_BUDGET_INPUT", `${step}: ${decision.reason}`);
    if (decision.decision === "PAUSE_BEFORE_BILLABLE_CALL") {
      const fb = this.options.fallback;
      if (!fb || fb.provider === "openai") {
        throw new V3BudgetError("V3_BUDGET_EXCEEDED", `${step}: tahmini toplam $${decision.projectedUsd.toFixed(4)} > tavan $${this.capUsd.toFixed(2)}; çağrı yapılmadı`);
      }
      const out = await this.call(fb, prompt, opts);
      this.entries.push({ step, provider: fb.provider, model: fb.provider, ceilingUsd: 0, costUsd: 0, fellBackFrom: `${choice.provider}/${model}`, reason: decision.reason });
      return { result: out, used: fb };
    }
    const out = await this.call(choice, prompt, opts);
    const actual = estimateTokenCost({ provider: choice.provider, model, promptTokens: out.usage?.promptTokens, completionTokens: out.usage?.completionTokens });
    this.entries.push({
      step,
      provider: choice.provider,
      model,
      ceilingUsd: ceiling.costUsd,
      // Missing usage cannot be priced, so the worst case is booked rather than zero.
      costUsd: actual.status === "known" || actual.status === "free" ? actual.costUsd : ceiling.costUsd,
      ...(out.usage?.promptTokens !== undefined ? { promptTokens: out.usage.promptTokens } : {}),
      ...(out.usage?.completionTokens !== undefined ? { completionTokens: out.usage.completionTokens } : {}),
      reason: decision.reason,
    });
    return { result: out, used: choice };
  }

  private async call(choice: V3ModelChoice, prompt: string, opts: AIProviderGenerateOptions): Promise<AIProviderResult> {
    const provider = this.options.providers[choice.provider];
    if (!provider) throw new V3BudgetError("V3_BUDGET_INPUT", `sağlayıcı yapılandırılmamış: ${choice.provider}`);
    return asResult(await provider.generate(prompt, { ...opts, ...(choice.model ? { model: choice.model } : {}) }));
  }
}
