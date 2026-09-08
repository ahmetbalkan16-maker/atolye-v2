/**
 * Atölye Brain — domain model (PHASE 6 "Intelligence" of `ATOLYE_MASTER_ROADMAP.md`:
 * AI Director + Production Memory + Knowledge Engine).
 *
 * The Brain is NOT a second orchestrator and NOT one large LLM prompt. It is a
 * thin, deterministic decision layer that sits *above* the existing pipeline
 * (`src/lib/pipeline`) and production execution layer (`src/lib/production`) and
 * decides, per production:
 *
 *   UNDERSTAND → RESEARCH → VERIFY → PLAN → FIND MEDIA → SELECT MEDIA → WRITE →
 *   SCENE PLAN → PRODUCE → REVIEW → REPAIR → RE-REVIEW → FINALIZE → LEARN
 *
 * This file only defines the shared types. It wires into **nothing** yet — every
 * consumer (orchestrator, planner, quality judge, experience store, …) is a
 * later, separately-approved phase. Nothing in `src/lib/pipeline` or
 * `src/lib/production` imports from here.
 *
 * Design rules carried from the rest of the codebase:
 *  - schema-versioned records (`brainSchemaVersion`);
 *  - deterministic ids (`stableProductionId` in `ProductionDeterminism.ts`);
 *  - fail-closed evaluators (an unknown / unreadable input never silently
 *    upgrades a safety or quality verdict);
 *  - sanitized evidence strings (no secrets, no absolute paths).
 */

import type { ProductionStepKey } from "./project";

export const brainSchemaVersion = "1" as const;

/* ------------------------------------------------------------------------- *
 * The Brain loop
 * ------------------------------------------------------------------------- */

export type BrainPhase =
  | "understand"
  | "research"
  | "verify"
  | "plan"
  | "find-media"
  | "select-media"
  | "write"
  | "scene-plan"
  | "produce"
  | "review"
  | "repair"
  | "re-review"
  | "finalize"
  | "learn";

export const BRAIN_PHASE_ORDER: readonly BrainPhase[] = Object.freeze([
  "understand",
  "research",
  "verify",
  "plan",
  "find-media",
  "select-media",
  "write",
  "scene-plan",
  "produce",
  "review",
  "repair",
  "re-review",
  "finalize",
  "learn",
]);

/* ------------------------------------------------------------------------- *
 * The single command
 * ------------------------------------------------------------------------- */

export type BrainTopicCategory =
  | "history"
  | "documentary"
  | "science"
  | "technology"
  | "space"
  | "education"
  | "mystery"
  | "culture"
  | "art"
  | "other";

/** How good the finished cut has to be — maps onto `QualityPreset` bands. */
export type BrainQualityFloor = "watchable" | "documentary" | "cinematic";

/**
 * The cost stance for a production. `local-only` and `prefer-local` never make a
 * paid call; `allow-paid-with-approval` still requires an explicit, per-run user
 * approval before the first billable request (the Brain never auto-escalates to
 * OpenAI just because `OPENAI_API_KEY` is present).
 */
export type BrainCostPolicy =
  | "local-only"
  | "prefer-local"
  | "allow-paid-with-approval";

export interface BrainProductionRequest {
  readonly schemaVersion: typeof brainSchemaVersion;
  readonly requestId: string;
  readonly topic: string;
  readonly topicCategory: BrainTopicCategory;
  readonly qualityFloor: BrainQualityFloor;
  readonly costPolicy: BrainCostPolicy;
  readonly hardwareProfileId: string;
  readonly requestedAt: string;
  readonly notes?: string;
}

/* ------------------------------------------------------------------------- *
 * Hardware profile (Safety Governor input #1 — the machine)
 * ------------------------------------------------------------------------- */

export interface BrainHardwareProfile {
  readonly id: string;
  readonly label: string;
  readonly gpuModel: string;
  readonly vramGb: number;
  readonly gpuPowerLimitW: number;
  /**
   * Conservative operating ceiling. The Brain acts *before* this — it is a
   * "start slowing down / holding here" number, never a "safe until here" one.
   * It must not be raised past the value the running project's checkpoint
   * already validated.
   */
  readonly thermalCeilingC: number;
  readonly cpuThreads: number;
  readonly ramGb: number;
  readonly ollama: {
    readonly reachableExpected: boolean;
    readonly viableModels: readonly string[];
    readonly nonViableModels: readonly string[];
  };
  readonly tools: {
    readonly ffmpeg: boolean;
    readonly ffprobe: boolean;
    readonly piper: boolean;
  };
  readonly notes: readonly string[];
}

/* ------------------------------------------------------------------------- *
 * Resource snapshot (Safety Governor input #2 — the moment)
 * ------------------------------------------------------------------------- */

export type BrainResourceSource = "measured" | "assumed" | "unavailable";

/**
 * Signals that must stop a production immediately when observed. A read-only
 * probe reports them; the Brain never has to "wait for 80°C" to react.
 */
export type BrainAbnormalSignal =
  | "thermal-slowdown"
  | "driver-reset"
  | "tdr"
  | "bsod"
  | "fatal-whea"
  | "display-loss"
  | "gpu-fallen-off-bus"
  | "ollama-unreachable"
  | "out-of-memory";

export interface BrainResourceSnapshot {
  readonly observedAt: string;
  readonly source: BrainResourceSource;
  readonly gpuTempC?: number;
  readonly gpuUtilizationPct?: number;
  readonly gpuPowerW?: number;
  readonly vramUsedGb?: number;
  readonly vramTotalGb?: number;
  readonly activeInference?: boolean;
  readonly cpuLoadPct?: number;
  readonly ramUsedGb?: number;
  readonly ramTotalGb?: number;
  readonly ollamaReachable?: boolean;
  readonly abnormalSignals?: readonly BrainAbnormalSignal[];
}

/* ------------------------------------------------------------------------- *
 * Safety verdict
 * ------------------------------------------------------------------------- */

export type BrainSafetyDecision =
  | "proceed"
  | "proceed-with-constraints"
  | "hold"
  | "abort";

export type BrainStrategyConstraint =
  | "serialize-stages"
  | "cooldown-between-stages"
  | "single-inference-at-a-time"
  | "forbid-large-model"
  | "prefer-cpu-stages"
  | "reduce-context-window"
  | "small-work-units"
  | "defer-gpu-stages"
  | "assume-shared-gpu";

export interface BrainSafetyVerdict {
  readonly schemaVersion: typeof brainSchemaVersion;
  readonly observedAt: string;
  readonly decision: BrainSafetyDecision;
  readonly constraints: readonly BrainStrategyConstraint[];
  readonly reasons: readonly string[];
  readonly snapshotSource: BrainResourceSource;
  readonly triggeredSignals: readonly BrainAbnormalSignal[];
}

/* ------------------------------------------------------------------------- *
 * Computation planning (strategy selection — "split a heavy call, don't
 * shrink it")
 * ------------------------------------------------------------------------- */

export type BrainComputationMode = "single-call" | "split-sequential";

export type BrainWorkUnitKind =
  | "single"
  | "research-subtopic"
  | "chapter-draft"
  | "scene-batch"
  | "summary-merge";

export interface BrainWorkUnit {
  readonly id: string;
  readonly label: string;
  readonly kind: BrainWorkUnitKind;
  readonly estimatedPromptTokens: number;
  readonly estimatedOutputTokens: number;
  /** A unit whose output is merged back into one artifact downstream. */
  readonly recombine: boolean;
}

export interface BrainStageWorkload {
  readonly stage: ProductionStepKey;
  readonly estimatedPromptTokens: number;
  readonly estimatedOutputTokens: number;
  /** Structured-output cardinality (chapter count, scene count, …). */
  readonly structuredOutputItems: number;
  readonly modelContextWindow: number;
}

export interface BrainComputationPlan {
  readonly schemaVersion: typeof brainSchemaVersion;
  readonly stage: ProductionStepKey;
  readonly mode: BrainComputationMode;
  readonly units: readonly BrainWorkUnit[];
  readonly rationale: readonly string[];
  /**
   * Invariant: a split plan produces the *same* information coverage as the
   * single call (per-chapter units recombine into the full script, etc.). The
   * Brain never trades quality for a smaller prompt.
   */
  readonly qualityPreserving: true;
  readonly cooldownBetweenUnitsMs: number;
}

/* ------------------------------------------------------------------------- *
 * Decision journal (section 12 of the emir)
 * ------------------------------------------------------------------------- */

export interface BrainDecisionInput {
  readonly phase: BrainPhase;
  readonly stage?: ProductionStepKey;
  readonly decision: string;
  readonly reason: string;
  readonly alternatives: readonly string[];
  readonly rejectedBecause: string;
  readonly strategy: string;
  readonly expectedBenefit: string;
  readonly occurredAt: string;
  readonly evidence: readonly string[];
}

export interface BrainDecision extends BrainDecisionInput {
  readonly schemaVersion: typeof brainSchemaVersion;
  readonly decisionId: string;
  readonly sequence: number;
  readonly inputsFingerprint: string;
}

export type BrainDecisionLogReasonCode =
  | "BRAIN_DECISION_LOG_VALID"
  | "BRAIN_DECISION_LOG_EMPTY"
  | "BRAIN_DECISION_LOG_SEQUENCE_GAP"
  | "BRAIN_DECISION_LOG_SEQUENCE_DUPLICATE"
  | "BRAIN_DECISION_LOG_ID_DUPLICATE"
  | "BRAIN_DECISION_LOG_TIMESTAMP_REGRESSION"
  | "BRAIN_DECISION_LOG_PHASE_REGRESSION"
  | "BRAIN_DECISION_LOG_UNSAFE_EVIDENCE"
  | "BRAIN_DECISION_LOG_INDETERMINATE";

export interface BrainDecisionLogValidation {
  readonly valid: boolean;
  readonly reasonCode: BrainDecisionLogReasonCode;
  readonly canonicalDecisions: readonly BrainDecision[];
}

/* ------------------------------------------------------------------------- *
 * Quality judge (sections 6 + 11 of the emir)
 * ------------------------------------------------------------------------- */

export type BrainQualityDimension =
  | "container-integrity"
  | "video-stream"
  | "audio-stream"
  | "av-sync"
  | "duration-band"
  | "resolution"
  | "framerate"
  | "leading-trailing-silence"
  | "loudness"
  | "scene-duration-fidelity"
  | "visual-script-alignment"
  | "repeated-visuals"
  | "black-or-dark-frames"
  | "asset-completeness"
  | "subtitle-sync"
  | "narrative-flow";

export type BrainQualityStatus = "pass" | "warn" | "fail" | "not-evaluated";

export interface BrainQualityObservation {
  readonly dimension: BrainQualityDimension;
  readonly status: BrainQualityStatus;
  /** 0 (worst) … 1 (best). `not-evaluated` carries `1` and is de-weighted. */
  readonly score: number;
  readonly detail: string;
  readonly evidence: readonly string[];
}

export type BrainQualityOutcome = "release" | "repair" | "reject";

export interface BrainRepairTarget {
  readonly stage: ProductionStepKey;
  readonly scope: "asset" | "scene" | "stage";
  readonly sceneId?: number;
  readonly assetId?: string;
  readonly reason: string;
  /** The smallest regeneration that fixes it — never "re-run the pipeline". */
  readonly minimalAction: string;
}

export interface BrainQualityVerdict {
  readonly schemaVersion: typeof brainSchemaVersion;
  readonly observedAt: string;
  readonly outcome: BrainQualityOutcome;
  readonly score: number;
  readonly observations: readonly BrainQualityObservation[];
  readonly repairTargets: readonly BrainRepairTarget[];
}

/** Per-scene slice of the structured technical report fed to the quality judge. */
export interface BrainRenderedSceneReport {
  readonly sceneId: number;
  readonly plannedDurationSeconds: number;
  readonly renderedDurationSeconds: number;
  readonly visualAssetId?: string;
  readonly visualDigest?: string;
  readonly narrationCharacters?: number;
  /** Mean luma 0–255 when measured; omit when not probed. */
  readonly meanLuma?: number;
}

/**
 * The structured input to `evaluateBrainQuality`. A Phase 6 adapter fills this
 * from `ffprobe` + the project manifest; the judge itself runs no binaries.
 */
export interface BrainFinalRenderReport {
  readonly projectSlug: string;
  readonly observedAt: string;
  readonly container: {
    readonly format: string;
    readonly durationSeconds: number;
    readonly sizeBytes: number;
  };
  readonly video?: {
    readonly codec: string;
    readonly width: number;
    readonly height: number;
    readonly frameRate: number;
  };
  readonly audio?: {
    readonly codec: string;
    readonly sampleRate: number;
    readonly channels: number;
  };
  readonly narrationDurationSeconds?: number;
  readonly leadingSilenceSeconds?: number;
  readonly trailingSilenceSeconds?: number;
  readonly integratedLoudnessLufs?: number;
  readonly targetDurationBand: { readonly minSeconds: number; readonly maxSeconds: number };
  readonly targetResolution: { readonly width: number; readonly height: number };
  readonly targetFrameRate: number;
  readonly targetLoudnessLufs?: number;
  readonly scenes: readonly BrainRenderedSceneReport[];
  readonly expectedAssetKinds: readonly string[];
  readonly presentAssetKinds: readonly string[];
  readonly subtitleCueCount?: number;
}

/* ------------------------------------------------------------------------- *
 * Experience / memory store (section 2 of the emir)
 * ------------------------------------------------------------------------- */

export type BrainStageOutcome =
  | "success"
  | "recovered"
  | "degraded"
  | "failed"
  | "skipped";

export type BrainErrorClass =
  | "provider-timeout"
  | "provider-refusal"
  | "schema-invalid"
  | "truncated-output"
  | "context-starvation"
  | "model-capability"
  | "thermal"
  | "out-of-memory"
  | "network"
  | "ffmpeg-render"
  | "asset-missing"
  | "cost-budget"
  | "unknown";

export interface BrainStageExperience {
  readonly stage: ProductionStepKey;
  readonly provider: string;
  readonly model: string;
  readonly strategyLabel: string;
  readonly computationMode: BrainComputationMode;
  readonly attempts: number;
  readonly durationMs: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly estimatedCostUsd: number;
  readonly outcome: BrainStageOutcome;
  readonly errorClass?: BrainErrorClass;
  /** 0 … 1 contribution to the final quality score, when attributable. */
  readonly qualityContribution?: number;
}

export type BrainMediaStrategy =
  | "existing-asset"
  | "archival-photo"
  | "archival-video"
  | "ai-image"
  | "ai-video"
  | "local-placeholder"
  | "map-graphic"
  | "text-card";

export interface BrainMediaStrategyOutcome {
  readonly strategy: BrainMediaStrategy;
  readonly sceneCount: number;
  readonly acceptedCount: number;
  readonly rejectedCount: number;
  readonly meanRelevanceScore?: number;
}

/**
 * How an experience record was produced.
 *  - `production` — a real pipeline run finished (or was abandoned/failed). This
 *    is the only mode the learning layer (`deriveBrainExperienceInsights`) reads.
 *  - `dry-run`    — the planner produced a `BrainRunPlan` and nothing was
 *    executed. No stage ran, no model was called, no GPU was touched. Stored so
 *    the plan/strategy/constraints are auditable, but **never** counted as a
 *    real outcome and never used to derive a strategy hint.
 *
 * Absent ⇒ `production` (backward compatible with pre-Sprint-181 records).
 */
export type BrainExperienceMode = "production" | "dry-run";

export interface BrainExperienceRecord {
  readonly schemaVersion: typeof brainSchemaVersion;
  readonly recordId: string;
  /** Absent ⇒ `"production"`. A `"dry-run"` record is never fed to the learner. */
  readonly mode?: BrainExperienceMode;
  readonly topic: string;
  readonly topicCategory: BrainTopicCategory;
  readonly hardwareProfileId: string;
  readonly qualityFloor: BrainQualityFloor;
  readonly requestedAt: string;
  readonly completedAt: string;
  readonly finalStatus:
    | "released"
    | "released-after-repair"
    | "abandoned"
    | "failed"
    | "dry-run-planned";
  readonly strategyLabel: string;
  /** Safety + strategy constraints the plan/run operated under. */
  readonly strategyConstraints?: readonly BrainStrategyConstraint[];
  /** The `BrainRunPlan.planId` this record came from, when planner-sourced. */
  readonly planId?: string;
  /** Sanitised, human-readable notes (redacted before storage). */
  readonly notes?: readonly string[];
  readonly stages: readonly BrainStageExperience[];
  readonly media: readonly BrainMediaStrategyOutcome[];
  readonly totals: {
    readonly wallClockMs: number;
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly aiCostUsd: number;
    readonly regenerationCount: number;
    readonly gpuPeakTempC?: number;
  };
  readonly qualityScore: number;
  readonly qualityOutcome: BrainQualityOutcome;
  readonly errorClasses: readonly BrainErrorClass[];
  readonly userFeedback?: {
    readonly rating: "kept" | "revised" | "rejected";
    readonly note?: string;
  };
}

export interface BrainExperienceQuery {
  readonly topicCategory?: BrainTopicCategory;
  readonly hardwareProfileId?: string;
  readonly stage?: ProductionStepKey;
  /** Minimum matching records before an insight may be emitted. */
  readonly minSupport: number;
}

export type BrainInsightKind =
  | "media-strategy-quality"
  | "provider-reliability"
  | "computation-mode"
  | "cost-efficiency"
  | "error-pattern"
  | "thermal-pattern";

export interface BrainExperienceInsight {
  readonly kind: BrainInsightKind;
  readonly scope: string;
  readonly statement: string;
  readonly support: number;
  readonly confidence: "low" | "moderate" | "high";
  readonly evidence: readonly string[];
}

export interface BrainStrategyRecommendation {
  readonly label: string;
  readonly rationale: readonly string[];
  readonly suggestedConstraints: readonly BrainStrategyConstraint[];
  readonly derivedFromInsightCount: number;
}

/* ------------------------------------------------------------------------- *
 * Self-improvement proposal engine (sections 8 + 16 of the emir)
 * ------------------------------------------------------------------------- */

export type BrainSelfImprovementStep =
  | "observe"
  | "measure"
  | "evaluate"
  | "identify-weakness"
  | "generate-proposal"
  | "estimate-risk-benefit"
  | "await-approval"
  | "checkpoint"
  | "implement"
  | "test"
  | "evaluate-result"
  | "keep-or-rollback"
  | "record-experience";

export const BRAIN_SELF_IMPROVEMENT_STEPS: readonly BrainSelfImprovementStep[] =
  Object.freeze([
    "observe",
    "measure",
    "evaluate",
    "identify-weakness",
    "generate-proposal",
    "estimate-risk-benefit",
    "await-approval",
    "checkpoint",
    "implement",
    "test",
    "evaluate-result",
    "keep-or-rollback",
    "record-experience",
  ]);

export type BrainImprovementApprovalState =
  | "draft"
  | "awaiting-user-approval"
  | "approved"
  | "rejected"
  | "implemented"
  | "verified"
  | "rolled-back";

export interface BrainImprovementOption {
  readonly id: string;
  readonly summary: string;
  readonly approach: string;
  readonly risks: readonly string[];
  readonly effort: "small" | "medium" | "large";
}

export interface BrainImprovementProposalInput {
  readonly title: string;
  readonly problem: string;
  readonly currentBehaviorEvidence: readonly string[];
  readonly options: readonly BrainImprovementOption[];
  readonly recommendedOptionId: string;
  readonly riskAssessment: string;
  readonly filesLikelyToChange: readonly string[];
  readonly testPlan: readonly string[];
  readonly expectedBenefit: string;
  readonly createdAt: string;
}

export type BrainImprovementEvent =
  | "submit-for-approval"
  | "user-approve"
  | "user-reject"
  | "mark-implemented"
  | "mark-verified"
  | "rollback";

export interface BrainImprovementTransition {
  readonly event: BrainImprovementEvent;
  readonly from: BrainImprovementApprovalState;
  readonly to: BrainImprovementApprovalState;
  readonly occurredAt: string;
  readonly note?: string;
}

export interface BrainImprovementProposal extends BrainImprovementProposalInput {
  readonly schemaVersion: typeof brainSchemaVersion;
  readonly proposalId: string;
  readonly approvalState: BrainImprovementApprovalState;
  readonly history: readonly BrainImprovementTransition[];
}

export type BrainImprovementTransitionReasonCode =
  | "BRAIN_IMPROVEMENT_TRANSITION_OK"
  | "BRAIN_IMPROVEMENT_TRANSITION_ILLEGAL"
  | "BRAIN_IMPROVEMENT_TRANSITION_TIMESTAMP_REGRESSION"
  | "BRAIN_IMPROVEMENT_TRANSITION_UNKNOWN_OPTION";

export interface BrainImprovementTransitionResult {
  readonly ok: boolean;
  readonly reasonCode: BrainImprovementTransitionReasonCode;
  readonly proposal: BrainImprovementProposal;
}
