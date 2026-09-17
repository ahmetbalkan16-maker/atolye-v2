import { classifyPatchSet, type BrainPatchSafetyLevel } from "../selfheal/BrainPatchSafety";
import type { AyasExternalResearchFinding } from "./AyasExternalResearchStore";

/**
 * M22.8 — the independent adaptation pipeline. Turns ONE external research
 * finding into a governed, classified PLAN — never a generated diff, never
 * an executed mutation. External research must NEVER directly mutate
 * source (M22.8's own explicit requirement): this module has no sandbox
 * step, no patch-artifact freeze, no file write of any kind. It exists to
 * answer, deterministically, "if Atölye were to build an independent
 * (not-copied) version of this capability, which governance lane would it
 * have to go through" — using the SAME unmodified BrainPatchSafety domain
 * classifier every other AYAS mutation already answers to, applied to the
 * DECLARED target files a human (or a future, more specific generator)
 * would actually need to touch.
 *
 * Routing (per M22.8's own spec):
 *   - domain FORBIDDEN_AUTONOMOUS -> routingDecision "FORBIDDEN_AUTONOMOUS"
 *   - domain REVIEW_REQUIRED, or the finding's own atolyeGapNotes/
 *     licenseCostStatus flags an unresolved concern (e.g. licensing) ->
 *     "REVIEW_REQUIRED"
 *   - domain SAFE and the plan is small (<= AYAS_ADAPTATION_SMALL_MAX_FILES
 *     declared files) -> "MICRO_SAFE_CANDIDATE"
 *   - domain SAFE but larger -> "PRIORITY_SAFE_CANDIDATE"
 *
 * A REVIEW_REQUIRED/FORBIDDEN_AUTONOMOUS routing is not a failure state —
 * per M22's own "Live M22 Proof" section, leaving a real candidate
 * WAITING_FOR_AUTHORITY is an explicitly valid, successful outcome. This
 * module never tries to force something into a safer lane than its real
 * domain and content warrant.
 */
export type AyasAdaptationRouting = "MICRO_SAFE_CANDIDATE" | "PRIORITY_SAFE_CANDIDATE" | "REVIEW_REQUIRED" | "FORBIDDEN_AUTONOMOUS";

export const AYAS_ADAPTATION_SMALL_MAX_FILES = 2;

export interface AyasAdaptationPlanInput {
  readonly finding: AyasExternalResearchFinding;
  /** The Atölye file(s) an independent implementation would need to touch — declared by whoever is designing the adaptation (a human, or a future targeted generator), never invented by this module. */
  readonly declaredTargetFiles: readonly string[];
  /** A short, human-authored description of the INDEPENDENT (not-copied) design — the actual mechanism Atölye would use, in Atölye's own terms. */
  readonly independentDesignSummary: string;
}

export interface AyasAdaptationPlan {
  readonly findingId: string;
  readonly provider: string;
  readonly capability: string;
  readonly declaredTargetFiles: readonly string[];
  readonly independentDesignSummary: string;
  readonly domainSafety: BrainPatchSafetyLevel;
  readonly domainSafetyReason: string;
  readonly routingDecision: AyasAdaptationRouting;
  readonly routingReason: string;
  readonly unresolvedConcerns: readonly string[];
}

/** Structural, deterministic flags — never a judgment call about whether the finding itself is a good idea, only whether it's SAFE to route autonomously. */
function findUnresolvedConcerns(finding: AyasExternalResearchFinding): readonly string[] {
  const concerns: string[] = [];
  if (finding.licenseCostStatus === "unknown") concerns.push("license/cost status is unknown — M22.5 requires this be resolved before any autonomous integration");
  if (!finding.isOfficialSource) concerns.push("source is not an official provider source — lower evidentiary confidence");
  if (finding.confidence === "low") concerns.push("finding confidence is low");
  return concerns;
}

export function planAyasAdaptation(input: AyasAdaptationPlanInput): AyasAdaptationPlan {
  const { finding, declaredTargetFiles, independentDesignSummary } = input;
  const domain = classifyPatchSet(declaredTargetFiles);
  const unresolvedConcerns = findUnresolvedConcerns(finding);

  let routingDecision: AyasAdaptationRouting;
  let routingReason: string;

  if (domain.level === "FORBIDDEN_AUTONOMOUS") {
    routingDecision = "FORBIDDEN_AUTONOMOUS";
    routingReason = `declared target files fall in a FORBIDDEN_AUTONOMOUS domain: ${domain.summary}`;
  } else if (domain.level === "REVIEW_REQUIRED" || unresolvedConcerns.length > 0) {
    routingDecision = "REVIEW_REQUIRED";
    routingReason = domain.level === "REVIEW_REQUIRED"
      ? `declared target files fall in a REVIEW_REQUIRED domain: ${domain.summary}`
      : `domain is SAFE, but unresolved concerns require explicit human review: ${unresolvedConcerns.join("; ")}`;
  } else if (declaredTargetFiles.length <= AYAS_ADAPTATION_SMALL_MAX_FILES) {
    routingDecision = "MICRO_SAFE_CANDIDATE";
    routingReason = `domain SAFE, ${declaredTargetFiles.length} declared file(s) <= ${AYAS_ADAPTATION_SMALL_MAX_FILES} — small enough for the fully-unattended micro lane IF a real generator for it is later hand-reviewed onto the micro-eligible allowlist (see AyasMicroClassifier.ts)`;
  } else {
    routingDecision = "PRIORITY_SAFE_CANDIDATE";
    routingReason = `domain SAFE, but ${declaredTargetFiles.length} declared file(s) exceed the small-batch threshold — a meaningful-but-safe change, single-approval (ONAYLA VE UYGULA) tier`;
  }

  return {
    findingId: finding.findingId,
    provider: finding.provider,
    capability: finding.capability,
    declaredTargetFiles,
    independentDesignSummary,
    domainSafety: domain.level,
    domainSafetyReason: domain.summary,
    routingDecision,
    routingReason,
    unresolvedConcerns,
  };
}
