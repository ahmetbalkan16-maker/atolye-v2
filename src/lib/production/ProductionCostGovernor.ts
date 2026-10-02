import type { ProductionCostEstimate } from "./ProductionCostEstimate";

/**
 * Stage 15K — the production cost governor.
 *
 * The pipeline already estimates a render's cost, blocks a paid call that
 * would pass the technical ceiling, and writes a receipt. This module adds the
 * policy above that: three separate numbers (the preferred target, the cap the
 * owner approved for this project, the technical ceiling) and one decision
 * before any paid dispatch.
 *
 *   estimate is zero                          -> CONTINUE, nothing to reserve
 *   pricing unknown                           -> BLOCK
 *   estimate above the technical ceiling      -> BLOCK
 *   no cap approved for the project           -> PAUSE and ask the owner
 *   estimate above the approved cap           -> PAUSE and ask the exact escalation
 *   allowance not declared                    -> PAUSE and ask the owner
 *   reserving the cap would oversubscribe     -> BLOCK
 *   otherwise                                 -> CONTINUE, reserve the approved cap
 *
 * It never raises a cap. The escalation is a question for the owner, and the
 * answer is not taken here. It decides from numbers it is given; it reads no
 * file, calls no provider and holds no state.
 */
export const PRODUCTION_COST_POLICY = Object.freeze({
  /** What a normal video should cost. A target, not an approval. */
  preferredTargetUsd: 0.25,
  /** The ordinary technical ceiling per video until the owner changes the policy. */
  technicalCeilingUsd: 1.0,
  /** The allowance the owner declared at planning time. It has to be revalidated or labelled when used. */
  planningAllowanceUsd: 9.85,
});

/** The lines of the preflight. `video` and `music` are local and cost nothing today; they are listed so that is said, not assumed. */
export const PRODUCTION_COST_COMPONENTS = Object.freeze(["llm", "image", "video", "tts", "music", "animation", "thumbnail", "youtube"] as const);
export type ProductionCostComponentId = (typeof PRODUCTION_COST_COMPONENTS)[number];
export interface ProductionCostComponent { readonly id: ProductionCostComponentId; readonly provider: string; readonly estimatedUsd: number }

export type CostAllowanceBasis = "OWNER_DECLARED_AT_PLANNING" | "REVALIDATED" | "NOT_DECLARED";
export interface CostAllowance {
  readonly basis: CostAllowanceBasis;
  readonly totalUsd: number | null;
  /** What is already spoken for: settled spend and the caps other projects hold. */
  readonly committedUsd: number;
}
export interface CostGovernorPolicy { readonly preferredTargetUsd: number; readonly technicalCeilingUsd: number }
export interface CostGovernorInput {
  readonly components: readonly ProductionCostComponent[];
  /** Whether every remaining component has a price. */
  readonly remainingPricing: "KNOWN" | "UNKNOWN";
  readonly observedUsd: number;
  /** Whether everything already spent on the project has a price. */
  readonly observedPricing: "KNOWN" | "UNKNOWN";
  /** The cap the owner approved for this project. Null when none was approved. */
  readonly approvedProjectCapUsd: number | null;
  readonly policy: CostGovernorPolicy;
  readonly allowance: CostAllowance;
}

export type CostGovernorDecision = "CONTINUE" | "PAUSE_ASK_OWNER" | "BLOCK";
export type CostGovernorReason =
  | "ZERO_COST" | "WITHIN_APPROVED_CAP" | "NO_APPROVED_CAP" | "ABOVE_APPROVED_CAP" | "ALLOWANCE_NOT_DECLARED"
  | "UNKNOWN_PRICING" | "ABOVE_TECHNICAL_CEILING" | "ALLOWANCE_OVERSUBSCRIBED" | "INPUT_INVALID";
export type CostQualityTradeoff =
  | "LOCAL_TEXT_MODEL_NOT_QUALIFIED" | "LOCAL_VOICE_IS_THE_PIPER_BASELINE" | "REAL_PHOTOS_DEPEND_ON_ARCHIVE_COVERAGE" | "LOCAL_THUMBNAIL_IS_A_FRAME_COMPOSITE";
export interface CostAlternative { readonly component: ProductionCostComponentId; readonly provider: string; readonly alternative: string; readonly savesUsd: number; readonly qualityTradeoff: CostQualityTradeoff }
export interface CostGovernorReport {
  readonly decision: CostGovernorDecision;
  readonly reason: CostGovernorReason;
  /** What was spent plus what the rest is estimated to cost. */
  readonly estimatedTotalUsd: number;
  /** One more run of the most expensive remaining component. */
  readonly retryReserveUsd: number;
  readonly conservativeMaxUsd: number;
  /** Whether the conservative maximum still fits the cap the decision used. Reported; the decision uses the estimate. */
  readonly retryReserveFitsCap: boolean | null;
  readonly approvedProjectCapUsd: number | null;
  /** An approved cap above the technical ceiling counts only up to the ceiling. */
  readonly effectiveCapUsd: number | null;
  readonly preferredTargetUsd: number;
  readonly technicalCeilingUsd: number;
  readonly aboveTarget: boolean;
  /** The exact question for the owner, when the decision is to pause. */
  readonly escalation: string | null;
  /** What has to be reserved before execution: the approved cap. Zero when nothing is paid. */
  readonly reserveUsd: number;
  readonly alternatives: readonly CostAlternative[];
  readonly allowance: { readonly basis: CostAllowanceBasis; readonly totalUsd: number | null; readonly committedUsd: number; readonly projectedRemainingUsd: number | null; readonly label: string };
  /** The report decides nothing by itself and approves nothing. */
  readonly authority: "NONE";
}

/** A zero-cost provider the production path already recognises for a component, and what it gives up. */
const ZERO_COST_ALTERNATIVE: Readonly<Partial<Record<ProductionCostComponentId, { readonly alternative: string; readonly qualityTradeoff: CostQualityTradeoff }>>> = Object.freeze({
  llm: { alternative: "ollama", qualityTradeoff: "LOCAL_TEXT_MODEL_NOT_QUALIFIED" },
  animation: { alternative: "ollama", qualityTradeoff: "LOCAL_TEXT_MODEL_NOT_QUALIFIED" },
  youtube: { alternative: "ollama", qualityTradeoff: "LOCAL_TEXT_MODEL_NOT_QUALIFIED" },
  tts: { alternative: "piper", qualityTradeoff: "LOCAL_VOICE_IS_THE_PIPER_BASELINE" },
  image: { alternative: "real", qualityTradeoff: "REAL_PHOTOS_DEPEND_ON_ARCHIVE_COVERAGE" },
  thumbnail: { alternative: "local", qualityTradeoff: "LOCAL_THUMBNAIL_IS_A_FRAME_COMPOSITE" },
});

const round = (value: number) => Math.round(value * 1e6) / 1e6;
const usd = (value: number) => `$${value.toFixed(2)}`;
const money = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const ALLOWANCE_LABEL: Readonly<Record<CostAllowanceBasis, string>> = Object.freeze({
  OWNER_DECLARED_AT_PLANNING: "owner-declared at planning time; not revalidated",
  REVALIDATED: "revalidated by the owner for this execution",
  NOT_DECLARED: "no allowance declared",
});

/** The decision before any paid dispatch. The same numbers always give the same report. */
export function governProductionCost(input: CostGovernorInput): CostGovernorReport {
  const { policy, allowance } = input;
  const valid = money(policy.preferredTargetUsd) && money(policy.technicalCeilingUsd) && policy.preferredTargetUsd <= policy.technicalCeilingUsd && money(input.observedUsd) && money(allowance.committedUsd) &&
    (input.approvedProjectCapUsd === null || money(input.approvedProjectCapUsd)) && (allowance.totalUsd === null ? allowance.basis === "NOT_DECLARED" : money(allowance.totalUsd) && allowance.basis !== "NOT_DECLARED") &&
    input.components.every((component) => (PRODUCTION_COST_COMPONENTS as readonly string[]).includes(component.id) && money(component.estimatedUsd)) && new Set(input.components.map((component) => component.id)).size === input.components.length;

  const remainingUsd = valid ? round(input.components.reduce((sum, component) => sum + component.estimatedUsd, 0)) : 0;
  const estimatedTotalUsd = valid ? round(input.observedUsd + remainingUsd) : 0;
  const retryReserveUsd = valid ? round(Math.max(0, ...input.components.map((component) => component.estimatedUsd))) : 0;
  const conservativeMaxUsd = round(estimatedTotalUsd + retryReserveUsd);
  const effectiveCapUsd = valid && input.approvedProjectCapUsd !== null ? Math.min(input.approvedProjectCapUsd, policy.technicalCeilingUsd) : null;
  const alternatives: CostAlternative[] = valid ? input.components.flatMap((component) => {
    const alternative = ZERO_COST_ALTERNATIVE[component.id];
    return alternative && component.estimatedUsd > 0 && component.provider !== alternative.alternative ? [{ component: component.id, provider: component.provider, alternative: alternative.alternative, savesUsd: round(component.estimatedUsd), qualityTradeoff: alternative.qualityTradeoff }] : [];
  }) : [];

  const report = (decision: CostGovernorDecision, reason: CostGovernorReason, escalation: string | null, reserveUsd: number): CostGovernorReport => ({
    decision, reason, estimatedTotalUsd, retryReserveUsd, conservativeMaxUsd,
    retryReserveFitsCap: effectiveCapUsd === null ? null : conservativeMaxUsd <= effectiveCapUsd,
    approvedProjectCapUsd: input.approvedProjectCapUsd, effectiveCapUsd, preferredTargetUsd: policy.preferredTargetUsd, technicalCeilingUsd: policy.technicalCeilingUsd,
    aboveTarget: estimatedTotalUsd > policy.preferredTargetUsd, escalation, reserveUsd, alternatives,
    allowance: { basis: allowance.basis, totalUsd: allowance.totalUsd, committedUsd: allowance.committedUsd, projectedRemainingUsd: allowance.totalUsd === null || !valid ? null : round(allowance.totalUsd - allowance.committedUsd - reserveUsd), label: ALLOWANCE_LABEL[allowance.basis] ?? ALLOWANCE_LABEL.NOT_DECLARED },
    authority: "NONE",
  });

  if (!valid) return report("BLOCK", "INPUT_INVALID", null, 0);
  // A price that is not known is never read as zero.
  if (input.remainingPricing !== "KNOWN" || input.observedPricing !== "KNOWN") return report("BLOCK", "UNKNOWN_PRICING", null, 0);
  if (estimatedTotalUsd === 0) return report("CONTINUE", "ZERO_COST", null, 0);
  if (estimatedTotalUsd > policy.technicalCeilingUsd) return report("BLOCK", "ABOVE_TECHNICAL_CEILING", null, 0);
  if (effectiveCapUsd === null) {
    // The target is suggested when the estimate fits it; otherwise the ceiling. Either way the owner decides.
    const suggested = estimatedTotalUsd <= policy.preferredTargetUsd ? policy.preferredTargetUsd : policy.technicalCeilingUsd;
    return report("PAUSE_ASK_OWNER", "NO_APPROVED_CAP", `Estimated ${usd(estimatedTotalUsd)}. No cap is approved for this project. Authorize this project up to ${usd(suggested)}?`, 0);
  }
  if (estimatedTotalUsd > effectiveCapUsd) return report("PAUSE_ASK_OWNER", "ABOVE_APPROVED_CAP", `Estimated ${usd(estimatedTotalUsd)}. Current cap ${usd(effectiveCapUsd)}. Authorize this project up to ${usd(policy.technicalCeilingUsd)}?`, 0);
  if (allowance.totalUsd === null) return report("PAUSE_ASK_OWNER", "ALLOWANCE_NOT_DECLARED", `Estimated ${usd(estimatedTotalUsd)} within the approved cap ${usd(effectiveCapUsd)}. No allowance is declared. Declare the allowance this project may draw on?`, 0);
  if (round(allowance.committedUsd + effectiveCapUsd) > allowance.totalUsd) return report("BLOCK", "ALLOWANCE_OVERSUBSCRIBED", null, 0);
  return report("CONTINUE", "WITHIN_APPROVED_CAP", null, effectiveCapUsd);
}

/**
 * The governor's lines from the pipeline's own pre-run estimate. Video rendering and the music library are local and
 * are listed at zero. An estimate the pipeline could not price stays unknown; its numbers are not used.
 */
export function costComponentsFromEstimate(estimate: Pick<ProductionCostEstimate, "status" | "breakdown" | "providers">): { readonly components: ProductionCostComponent[]; readonly remainingPricing: "KNOWN" | "UNKNOWN" } {
  const known = estimate.status === "known" && estimate.breakdown.unknownComponents.length === 0;
  const amount = (value: number) => (known && Number.isFinite(value) && value >= 0 ? value : 0);
  return {
    remainingPricing: known ? "KNOWN" : "UNKNOWN",
    components: [
      { id: "llm", provider: estimate.providers.text, estimatedUsd: amount(estimate.breakdown.llmUsd) },
      { id: "image", provider: estimate.providers.image, estimatedUsd: amount(estimate.breakdown.imageUsd) },
      { id: "video", provider: "ffmpeg", estimatedUsd: 0 },
      { id: "tts", provider: estimate.providers.tts, estimatedUsd: amount(estimate.breakdown.ttsUsd) },
      { id: "music", provider: "music-library", estimatedUsd: 0 },
      { id: "animation", provider: estimate.providers.animation, estimatedUsd: amount(estimate.breakdown.animationUsd) },
      { id: "thumbnail", provider: estimate.providers.thumbnail, estimatedUsd: amount(estimate.breakdown.thumbnailUsd) },
      { id: "youtube", provider: estimate.providers.youtube, estimatedUsd: amount(estimate.breakdown.youtubeUsd) },
    ],
  };
}

export type CostCheckpointDecision = "CONTINUE" | "PAUSE_BEFORE_BILLABLE_CALL" | "BLOCK";
export interface CostCheckpointInput {
  readonly observedUsd: number;
  readonly observedPricing: "KNOWN" | "UNKNOWN";
  /** The conservative cost of the call about to be made; zero for a free one. */
  readonly nextCallUsd: number;
  readonly nextCallPricing: "KNOWN" | "UNKNOWN";
  /** The cap reserved for this project before execution. Null when nothing was reserved. */
  readonly reservedCapUsd: number | null;
}

/**
 * In the middle of a project, before the next billable call: a projected total above the reserved cap pauses before
 * the call is made. A free call always continues. Without a reservation a paid call does not go out.
 */
export function governProductionCostCheckpoint(input: CostCheckpointInput): { readonly decision: CostCheckpointDecision; readonly reason: "FREE_CALL" | "WITHIN_RESERVED_CAP" | "PROJECTED_ABOVE_RESERVED_CAP" | "NOTHING_RESERVED" | "UNKNOWN_PRICING" | "INPUT_INVALID"; readonly projectedUsd: number } {
  if (!money(input.observedUsd) || !money(input.nextCallUsd) || !(input.reservedCapUsd === null || money(input.reservedCapUsd))) return { decision: "BLOCK", reason: "INPUT_INVALID", projectedUsd: 0 };
  const projectedUsd = round(input.observedUsd + input.nextCallUsd);
  if (input.observedPricing !== "KNOWN" || input.nextCallPricing !== "KNOWN") return { decision: "BLOCK", reason: "UNKNOWN_PRICING", projectedUsd };
  if (input.nextCallUsd === 0) return { decision: "CONTINUE", reason: "FREE_CALL", projectedUsd };
  if (input.reservedCapUsd === null) return { decision: "PAUSE_BEFORE_BILLABLE_CALL", reason: "NOTHING_RESERVED", projectedUsd };
  return projectedUsd > input.reservedCapUsd ? { decision: "PAUSE_BEFORE_BILLABLE_CALL", reason: "PROJECTED_ABOVE_RESERVED_CAP", projectedUsd } : { decision: "CONTINUE", reason: "WITHIN_RESERVED_CAP", projectedUsd };
}
