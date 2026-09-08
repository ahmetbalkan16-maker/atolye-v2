/**
 * Atölye Brain — orchestrator run-planner (pure, non-executing).
 *
 * Given a single command ("İstanbul'un Fethi 1453 hakkında kaliteli bir video
 * hazırla"), this builds the ordered plan the Brain *would* drive:
 *
 *   UNDERSTAND → RESEARCH → VERIFY → PLAN → FIND MEDIA → SELECT MEDIA → WRITE →
 *   SCENE PLAN → PRODUCE → REVIEW → REPAIR → RE-REVIEW → FINALIZE → LEARN
 *
 * Each phase says which existing pipeline stage(s) it maps onto, which existing
 * service it delegates to, the safety gate that applies, and whether the phase
 * needs user approval before it can run.
 *
 * It calls NOTHING. It does not import `PipelineRunner`. Wiring the plan to real
 * execution is a separate, user-approved phase — this planner is what that
 * wiring will consume, and what the "next single step" report is built from.
 */

import { BRAIN_PHASE_ORDER } from "@/types/brain";
import type {
  BrainPhase,
  BrainProductionRequest,
  BrainSafetyVerdict,
  BrainStrategyConstraint,
  BrainStrategyRecommendation,
} from "@/types/brain";
import type { ProductionStepKey } from "@/types/project";
import { stableProductionId } from "@/lib/production/ProductionDeterminism";

export interface BrainRunPhase {
  readonly phase: BrainPhase;
  readonly summary: string;
  /** Existing pipeline stage(s) this phase drives, in order. */
  readonly pipelineStages: readonly ProductionStepKey[];
  /** Existing Atölye service the Brain delegates the work to. */
  readonly delegatesTo: string;
  /** Safety constraints in force for this phase. */
  readonly constraints: readonly BrainStrategyConstraint[];
  /** `true` when the phase may not start without user approval. */
  readonly requiresApproval: boolean;
  /** Why approval is (not) required. */
  readonly approvalReason: string;
  /** Points where the Brain records a `BrainDecision`. */
  readonly decisionPoints: readonly string[];
}

export interface BrainRunPlan {
  readonly planId: string;
  readonly requestId: string;
  readonly topic: string;
  readonly safetyDecision: BrainSafetyVerdict["decision"];
  readonly costPolicy: BrainProductionRequest["costPolicy"];
  readonly phases: readonly BrainRunPhase[];
  /** First phase that is blocked (safety `hold`/`abort`, or approval), if any. */
  readonly firstBlockedPhase?: BrainPhase;
  readonly nextSingleStep: string;
}

const PHASE_STAGES: Readonly<Record<BrainPhase, readonly ProductionStepKey[]>> = Object.freeze({
  understand: [],
  research: ["research"],
  verify: ["research"],
  plan: [],
  "find-media": ["research"],
  "select-media": ["visuals"],
  write: ["script"],
  "scene-plan": ["scenes"],
  produce: ["visuals", "animation", "video", "audio", "assembly"],
  review: [],
  repair: ["visuals", "animation", "video", "audio", "assembly"],
  "re-review": [],
  finalize: ["thumbnail", "seo", "youtube", "export"],
  learn: [],
});

const PHASE_DELEGATE: Readonly<Record<BrainPhase, string>> = Object.freeze({
  understand: "BrainPlanner (topic → research questions + success criteria)",
  research: "AIManager.runResearch + ResearchMediaDiscovery",
  verify: "BrainCritic over research findings (claim ↔ evidence)",
  plan: "BrainComputationPlanner + BrainProductionStrategist + QualityPreset",
  "find-media": "ResearchMediaDiscovery / MediaSearchClient (Wikimedia)",
  "select-media": "SceneMediaSelection + RealPhotoImageProvider relevance gate",
  write: "AIManager.runScript + ScriptStructuredOutput",
  "scene-plan": "AIManager.runScenes + SceneStructuredOutput (grammar-constrained)",
  produce: "PipelineRunner stage-bounded execution (visuals…assembly)",
  review: "BrainQualityModel over an ffprobe + manifest report",
  repair: "PipelineCompletedStageRegenerationService / PipelineFailedStageRetry (scene-scoped)",
  "re-review": "BrainQualityModel (repeat)",
  finalize: "PipelineRunner (thumbnail…export) + youtube publish package",
  learn: "BrainExperienceModel.append + deriveInsights",
});

const PHASE_DECISIONS: Readonly<Record<BrainPhase, readonly string[]>> = Object.freeze({
  understand: ["topic category", "quality floor", "cost policy"],
  research: ["single-call vs split research", "model / provider"],
  verify: ["accept findings / request more research"],
  plan: ["quality preset", "per-stage provider", "computation mode per stage"],
  "find-media": ["which source clients", "how many candidates per scene"],
  "select-media": ["archival vs AI per scene", "AI image budget"],
  write: ["single-call vs split script", "narration budget"],
  "scene-plan": ["scene count", "grammar schema on/off"],
  produce: ["stage order gating", "cooldown between GPU stages", "retry admission"],
  review: ["release / repair / reject", "which repair targets"],
  repair: ["smallest fix per target", "retry budget"],
  "re-review": ["release / repair again / give up within budget"],
  finalize: ["thumbnail + SEO acceptance", "publish vs package-only"],
  learn: ["what worked / failed", "strategy hint for next run"],
});

function approvalFor(
  phase: BrainPhase,
  request: BrainProductionRequest,
): { requiresApproval: boolean; reason: string } {
  if (phase === "produce" || phase === "repair") {
    return {
      requiresApproval: false,
      reason:
        "local, $0, stage-bounded execution against existing pipeline — reversible (assets are append-only)",
    };
  }
  if (phase === "finalize") {
    return {
      requiresApproval: true,
      reason: "may publish to YouTube — outward-facing, needs explicit approval (package-only is safe)",
    };
  }
  if (
    (phase === "research" || phase === "write" || phase === "scene-plan") &&
    request.costPolicy === "allow-paid-with-approval"
  ) {
    return {
      requiresApproval: true,
      reason: "cost policy allows paid providers — first billable call needs per-run approval",
    };
  }
  return { requiresApproval: false, reason: "local, analysis/planning only — reversible" };
}

/**
 * Build the run plan. Deterministic. When safety says `hold`/`abort`, every
 * phase from `produce` on is marked blocked and `nextSingleStep` says why.
 */
export function planBrainRun(
  request: BrainProductionRequest,
  safety: BrainSafetyVerdict,
  recommendation?: BrainStrategyRecommendation,
): BrainRunPlan {
  const baseConstraints = [
    ...new Set([...safety.constraints, ...(recommendation?.suggestedConstraints ?? [])]),
  ].sort();

  const safetyBlocks = safety.decision === "hold" || safety.decision === "abort";

  const phases: BrainRunPhase[] = BRAIN_PHASE_ORDER.map((phase) => {
    const { requiresApproval, reason } = approvalFor(phase, request);
    const touchesProduction = PHASE_STAGES[phase].length > 0;
    return {
      phase,
      summary: phaseSummary(phase),
      pipelineStages: PHASE_STAGES[phase],
      delegatesTo: PHASE_DELEGATE[phase],
      constraints: touchesProduction ? baseConstraints : [],
      requiresApproval,
      approvalReason: reason,
      decisionPoints: PHASE_DECISIONS[phase],
    };
  });

  const firstBlockedPhase = safetyBlocks
    ? "produce"
    : phases.find((phase) => phase.requiresApproval)?.phase;

  const nextSingleStep = safetyBlocks
    ? `HOLD — ${safety.decision.toUpperCase()}: ${safety.reasons[0] ?? "resource safety"}. Resolve the hardware condition, re-probe, then re-plan.`
    : recommendation
      ? `Start UNDERSTAND for "${request.topic}" using experience hint "${recommendation.label}".`
      : `Start UNDERSTAND for "${request.topic}" (no prior experience — default strategy).`;

  return {
    planId: stableProductionId("brain-run-plan", {
      request: request.requestId,
      safety: safety.decision,
      constraints: baseConstraints,
    }),
    requestId: request.requestId,
    topic: request.topic,
    safetyDecision: safety.decision,
    costPolicy: request.costPolicy,
    phases,
    ...(firstBlockedPhase ? { firstBlockedPhase } : {}),
    nextSingleStep,
  };
}

function phaseSummary(phase: BrainPhase): string {
  return {
    understand: "Parse the topic: category, scope, what a good result looks like.",
    research: "Gather and structure facts; discover candidate real media.",
    verify: "Check the key claims against the gathered evidence.",
    plan: "Pick quality preset, per-stage providers, and per-stage computation mode.",
    "find-media": "Build per-scene media candidate lists from free/licensed sources.",
    "select-media": "Choose archival vs AI per scene under the AI-image budget and relevance gate.",
    write: "Write the documentary script within the narration budget.",
    "scene-plan": "Split the script into visually meaningful, grammar-constrained scenes.",
    produce: "Drive visuals→animation→video→audio→assembly stage by stage with cooldowns.",
    review: "Judge the finished MP4 across the technical + editorial dimensions.",
    repair: "Regenerate only the smallest failing pieces (a scene, a stage).",
    "re-review": "Re-judge after repair; stop when it passes or the budget is spent.",
    finalize: "Thumbnail, SEO, and a publish-ready package (publishing itself needs approval).",
    learn: "Record what strategy/models/media worked; derive a hint for next time.",
  }[phase];
}

/** Human-readable plan. */
export function describeBrainRunPlan(plan: BrainRunPlan): string {
  const lines = [
    `Brain run plan for "${plan.topic}"`,
    `  safety: ${plan.safetyDecision} · cost policy: ${plan.costPolicy}`,
    plan.firstBlockedPhase ? `  first blocked phase: ${plan.firstBlockedPhase}` : "  no blocked phases",
    "",
    ...plan.phases.map(
      (phase) =>
        `  ${phase.phase.toUpperCase()}${phase.requiresApproval ? " [approval]" : ""} — ${phase.summary}\n` +
        `      stages: ${phase.pipelineStages.join(", ") || "—"}\n` +
        `      delegate: ${phase.delegatesTo}`,
    ),
    "",
    `Next single step: ${plan.nextSingleStep}`,
  ];
  return lines.join("\n");
}
