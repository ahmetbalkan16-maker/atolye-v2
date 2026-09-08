/**
 * Atölye Brain — the port interfaces.
 *
 * These are the seams the Brain is built along. Each port is deliberately small
 * and **delegates to an existing Atölye service** rather than re-implementing
 * it — the Brain decides *what* and *when*, the existing pipeline/production
 * layers still do the work.
 *
 * | Brain port                | Delegates to (existing code)                                  |
 * |---------------------------|--------------------------------------------------------------|
 * | BrainSafetyGovernor       | (new, pure) + a Phase 8 read-only host probe                 |
 * | BrainComputationStrategist| `AIManager` / `runObservedAIRequest` call shaping            |
 * | BrainResearchAgent        | `AIManager.runResearch` + `ResearchMediaDiscovery`          |
 * | BrainMediaIntelligence    | `RealPhotoImageProvider` / `SceneMediaSelection` / `VideoMediaIngestion` |
 * | BrainScriptIntelligence   | `AIManager.runScript` + `ScriptStructuredOutput`            |
 * | BrainSceneIntelligence    | `AIManager.runScenes` + `SceneStructuredOutput`             |
 * | BrainProductionStrategist | `QualityPreset` + `ProductionProviderResolution`            |
 * | BrainQualityJudge         | (new, pure) fed by an `ffprobe` adapter + `ProjectManager`  |
 * | BrainRepairAgent          | `PipelineFailedStageRetry` / `PipelineCompletedStageRegenerationService` |
 * | BrainExperienceStore      | (new) JSON-file-backed, sibling of `AIUsageManager`         |
 * | BrainSystemOptimizer      | (new, pure) reads `BrainExperienceStore`                    |
 * | BrainOrchestrator         | drives the `BrainPhase` loop over `PipelineRunner`          |
 *
 * Nothing here is implemented in this phase — this file is types only, and no
 * runtime module in `src/lib/pipeline` or `src/lib/production` imports it.
 */

import type {
  BrainComputationPlan,
  BrainDecision,
  BrainDecisionInput,
  BrainExperienceInsight,
  BrainExperienceQuery,
  BrainExperienceRecord,
  BrainFinalRenderReport,
  BrainHardwareProfile,
  BrainImprovementProposal,
  BrainProductionRequest,
  BrainQualityVerdict,
  BrainRepairTarget,
  BrainResourceSnapshot,
  BrainSafetyVerdict,
  BrainStageWorkload,
  BrainStrategyConstraint,
  BrainStrategyRecommendation,
} from "@/types/brain";
import type { ProductionStepKey } from "@/types/project";

/* ------------------------------------------------------------------------- */

/** Reads (never tunes) the machine state and returns a go / hold / abort verdict. */
export interface BrainSafetyGovernor {
  /**
   * A read-only host probe. A Phase 8 implementation shells `nvidia-smi
   * --query-gpu=...` / reads `/proc` etc.; it must be small, read-only and
   * timeout-bounded. Returns a snapshot with `source: "unavailable"` rather
   * than throwing when it cannot read.
   */
  probe(): Promise<BrainResourceSnapshot>;

  evaluate(
    profile: BrainHardwareProfile,
    snapshot: BrainResourceSnapshot,
    plannedConstraints: readonly BrainStrategyConstraint[],
  ): BrainSafetyVerdict;
}

/** Turns a stage's estimated workload into a single-call or split plan. */
export interface BrainComputationStrategist {
  estimateWorkload(input: {
    readonly stage: ProductionStepKey;
    readonly promptCharacters: number;
    readonly expectedOutputCharacters: number;
    readonly structuredOutputItems: number;
    readonly modelContextWindow: number;
  }): BrainStageWorkload;

  plan(
    workload: BrainStageWorkload,
    profile: BrainHardwareProfile,
    safety: BrainSafetyVerdict,
  ): BrainComputationPlan;
}

/* ------------------------------------------------------------------------- */

export interface BrainUnderstoodRequest {
  readonly request: BrainProductionRequest;
  readonly researchQuestions: readonly string[];
  readonly successCriteria: readonly string[];
}

export interface BrainPlanner {
  understand(request: BrainProductionRequest): Promise<BrainUnderstoodRequest>;
}

export interface BrainResearchAgent {
  research(
    understood: BrainUnderstoodRequest,
    computation: BrainComputationPlan,
  ): Promise<{
    readonly findingsRef: string;
    readonly sourceReliability: "low" | "mixed" | "solid";
    readonly openQuestions: readonly string[];
  }>;
}

export interface BrainMediaIntelligence {
  proposeMedia(sceneCount: number): Promise<
    readonly {
      readonly sceneId: number;
      readonly candidates: readonly {
        readonly kind: string;
        readonly relevance: number;
        readonly rightsStatus: string;
      }[];
    }[]
  >;
}

export interface BrainScriptIntelligence {
  write(understood: BrainUnderstoodRequest, computation: BrainComputationPlan): Promise<{
    readonly scriptRef: string;
  }>;
}

export interface BrainSceneIntelligence {
  plan(scriptRef: string, computation: BrainComputationPlan): Promise<{
    readonly scenesRef: string;
    readonly sceneCount: number;
  }>;
}

export interface BrainProductionStrategist {
  chooseStageStrategy(
    stage: ProductionStepKey,
    request: BrainProductionRequest,
    safety: BrainSafetyVerdict,
    recommendation?: BrainStrategyRecommendation,
  ): {
    readonly provider: string;
    readonly constraints: readonly BrainStrategyConstraint[];
  };
}

/* ------------------------------------------------------------------------- */

export interface BrainQualityJudge {
  evaluate(report: BrainFinalRenderReport): BrainQualityVerdict;
}

export interface BrainRepairAgent {
  planRepairs(targets: readonly BrainRepairTarget[]): Promise<
    readonly {
      readonly target: BrainRepairTarget;
      readonly plannedStage: ProductionStepKey;
      readonly scope: "asset" | "scene" | "stage";
    }[]
  >;
}

/* ------------------------------------------------------------------------- */

export interface BrainExperienceStore {
  append(record: BrainExperienceRecord): Promise<void>;
  list(query?: Partial<BrainExperienceQuery>): Promise<readonly BrainExperienceRecord[]>;
}

export interface BrainSystemOptimizer {
  deriveInsights(
    records: readonly BrainExperienceRecord[],
    query: BrainExperienceQuery,
  ): readonly BrainExperienceInsight[];

  recommendStrategy(
    insights: readonly BrainExperienceInsight[],
    request: BrainProductionRequest,
  ): BrainStrategyRecommendation | undefined;

  /** Weak spots worth a `USER APPROVAL REQUIRED` proposal — never auto-applied. */
  proposeImprovements(
    insights: readonly BrainExperienceInsight[],
  ): readonly BrainImprovementProposal[];
}

/* ------------------------------------------------------------------------- */

/** Port shape; the concrete `BrainDecisionRecorder` class lives in `BrainDecisionJournal.ts`. */
export interface BrainDecisionRecorderPort {
  record(input: BrainDecisionInput): BrainDecision;
  snapshot(): readonly BrainDecision[];
}

export interface BrainOrchestratorResult {
  readonly requestId: string;
  readonly projectSlug?: string;
  readonly finalPhase: string;
  readonly quality?: BrainQualityVerdict;
  readonly decisions: readonly BrainDecision[];
  readonly experienceRecordId?: string;
}

export interface BrainOrchestrator {
  run(request: BrainProductionRequest): Promise<BrainOrchestratorResult>;
}
