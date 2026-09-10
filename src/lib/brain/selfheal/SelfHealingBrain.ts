/**
 * Atölye Brain — Self-Healing orchestrator (pure).
 *
 * The loop from the emir:
 *
 *   OBSERVE → DETECT → CORRELATE → DIAGNOSE → PLAN → SANDBOX PATCH → TEST →
 *   REGRESSION → VERIFY → REPORT → APPROVAL/APPLY → LEARN
 *
 * This module owns ONLY the decision logic. Given an incident + context it
 * returns the NEXT step as an INTENT — it never touches git, fs, a test runner
 * or the clock. The operator CLI (`scripts/selfheal-run.ts`) executes each
 * intent through injected adapters and feeds the result back via `advanceIncident`.
 *
 * The Brain may progress an incident autonomously up to AWAITING_APPROVAL.
 * APPLIED requires an operator approval id — see BrainSelfHealGuards.
 */

import {
  advanceIncident,
  brainIncidentSignature,
  BRAIN_INCIDENT_AUTONOMOUS_CEILING,
  type BrainIncident,
  type BrainIncidentCheck,
  type BrainIncidentEvent,
} from "./BrainIncident";
import { diagnoseRootCause, type BrainRecentCommit, type BrainTimelineEvent } from "./BrainRootCauseEngine";
import { classifyPatchSet, patchRisk } from "./BrainPatchSafety";
import { checkSelfHealAttempt, BRAIN_SELFHEAL_LIMITS } from "./BrainSelfHealLimits";
import type { BrainLearnedPattern } from "./BrainLearnedPattern";

export interface SelfHealContext {
  readonly now: string;
  readonly nowMs: number;
  readonly startedAtMs: number;
  readonly timeline: readonly BrainTimelineEvent[];
  readonly recentCommits: readonly BrainRecentCommit[];
  readonly learnedPatterns: readonly BrainLearnedPattern[];
  /** Set once a candidate patch has been drafted (by the operator loop / an LLM step). */
  readonly candidatePatch?: {
    readonly changedFiles: readonly string[];
    readonly diff: string;
    readonly diffLines: number;
    readonly baseCommit: string;
    readonly rationale: string;
  } | null;
  /** Results of the last checks run in the sandbox. */
  readonly lastCheckResults?: readonly BrainIncidentCheck[] | null;
  /** An explicit operator approval id, when the operator has approved this incident's patch. */
  readonly operatorApprovalId?: string | null;
}

export type SelfHealStep =
  | { readonly kind: "diagnose" }
  | { readonly kind: "draft-patch"; readonly suspectFiles: readonly string[]; readonly hypothesis: string }
  | { readonly kind: "create-sandbox"; readonly baseCommit: string }
  | { readonly kind: "apply-patch-to-sandbox"; readonly changedFiles: readonly string[]; readonly diffLines: number }
  | { readonly kind: "run-checks"; readonly checks: readonly BrainIncidentCheck["kind"][] }
  | { readonly kind: "verify" }
  | { readonly kind: "await-approval"; readonly summary: string }
  | { readonly kind: "apply-to-working-tree"; readonly operatorApprovalId: string }
  | { readonly kind: "rollback"; readonly reason: string }
  | { readonly kind: "learn"; readonly outcome: "confirmed" | "failed" }
  | { readonly kind: "halt"; readonly reason: string; readonly needsHuman: boolean };

export interface SelfHealDecision {
  readonly step: SelfHealStep;
  /** Apply this to the incident BEFORE executing the step (records intent). */
  readonly preEvent?: BrainIncidentEvent;
  readonly note: string;
}

const REQUIRED_CHECKS: readonly BrainIncidentCheck["kind"][] = Object.freeze(["typecheck", "lint", "build", "smoke"]);
const REGRESSION_CHECKS: readonly BrainIncidentCheck["kind"][] = Object.freeze(["regression", "graphify", "security"]);
/** Every check the sandbox must show green before an incident can be VERIFIED. */
const ALL_CHECKS: readonly BrainIncidentCheck["kind"][] = Object.freeze([...REQUIRED_CHECKS, ...REGRESSION_CHECKS]);

/** Decide the next step for an incident. Deterministic; no side effects. */
export function planSelfHealStep(incident: BrainIncident, ctx: SelfHealContext): SelfHealDecision {
  const runtimeMs = ctx.nowMs - ctx.startedAtMs;
  const attempt = (incident.patch?.attempt ?? 0) + 1;

  // hard limits — halt to FAILED / needs-human before doing more work
  const limit = checkSelfHealAttempt({
    attempt,
    runtimeMs,
    filesChanged: ctx.candidatePatch?.changedFiles.length ?? incident.patch?.changedFiles.length ?? 0,
    diffLines: ctx.candidatePatch?.diffLines ?? incident.patch?.diffLines ?? 0,
  });
  if (!limit.ok && incident.status !== "AWAITING_APPROVAL" && incident.status !== "APPLIED") {
    return {
      step: { kind: "halt", reason: limit.reason, needsHuman: true },
      preEvent: { kind: "fail", reason: `self-heal limit tripped (${limit.violation}): ${limit.reason}`, now: ctx.now },
      note: "A safety limit tripped — the incident is handed to a human, not retried.",
    };
  }

  switch (incident.status) {
    case "OBSERVED": {
      if (incident.classification !== "REAL_INCIDENT" && incident.classification !== "UNKNOWN") {
        return {
          step: { kind: "halt", reason: `classification is ${incident.classification} — not a self-heal target`, needsHuman: false },
          note: "Not a real incident; recorded and closed without a patch.",
        };
      }
      return { step: { kind: "diagnose" }, note: "Correlating the timeline + recent commits + learned patterns." };
    }

    case "DIAGNOSED": {
      // Use the hypotheses already recorded on the incident (the `diagnose` step
      // ran `diagnoseRootCause` in the operator loop and stored the result);
      // fall back to a fresh diagnosis only if none were recorded.
      const recorded = incident.hypotheses;
      const best = recorded.length
        ? recorded[0]
        : diagnoseRootCause({ incident, timeline: ctx.timeline, recentCommits: ctx.recentCommits, learnedPatterns: ctx.learnedPatterns }).best;
      if (!best) {
        return {
          step: { kind: "halt", reason: "no root-cause hypothesis crossed the confidence floor", needsHuman: true },
          preEvent: { kind: "fail", reason: "diagnosis inconclusive — needs a human", now: ctx.now },
          note: "Diagnosis produced nothing actionable.",
        };
      }
      const isNotEstablished = best.statement === "Root cause not established from the available evidence.";
      const selfHealCandidate = best.confidence >= 0.65 && !isNotEstablished;

      // classify the fix's blast radius before we even draft it
      const verdict = classifyPatchSet(best.suspectFiles);
      if (verdict.forbidden.length > 0) {
        return {
          step: { kind: "await-approval", summary: `${best.statement} — but the fix would touch a FORBIDDEN area: ${verdict.forbidden.map((f) => f.path).join(", ")}` },
          preEvent: { kind: "await-approval", now: ctx.now },
          note: "The likely fix is in a never-autonomous area — a human must handle it.",
        };
      }
      if (!selfHealCandidate) {
        return {
          step: { kind: "await-approval", summary: `Best hypothesis (confidence ${best.confidence.toFixed(2)}): ${best.statement}` },
          preEvent: { kind: "await-approval", now: ctx.now },
          note: "Confidence is below the auto-heal bar — surfacing the diagnosis for a human.",
        };
      }
      if (verdict.review.length > 0 && verdict.level === "REVIEW_REQUIRED") {
        // A REVIEW_REQUIRED fix may be DRAFTED autonomously and tested in the
        // sandbox, but it can never be auto-applied — the loop stops at
        // AWAITING_APPROVAL. Drafting + testing it still saves the operator work.
        return {
          step: { kind: "draft-patch", suspectFiles: best.suspectFiles, hypothesis: best.statement },
          note: `Drafting + sandbox-testing a REVIEW_REQUIRED patch for: ${best.statement} (operator must approve before it is applied).`,
        };
      }
      return {
        step: { kind: "draft-patch", suspectFiles: best.suspectFiles, hypothesis: best.statement },
        note: `Drafting a candidate patch for: ${best.statement}`,
      };
    }

    case "PATCHING_SANDBOX": {
      if (!incident.patch) {
        return { step: { kind: "halt", reason: "no candidate patch available", needsHuman: true }, note: "Waiting on a drafted patch." };
      }
      return decideAfterChecks(incident, ctx, ALL_CHECKS);
    }

    case "TESTING":
      return decideAfterChecks(incident, ctx, ALL_CHECKS);

    case "VERIFIED": {
      const summary = buildApprovalSummary(incident);
      if (incident.status !== BRAIN_INCIDENT_AUTONOMOUS_CEILING) {
        return {
          step: { kind: "await-approval", summary },
          preEvent: { kind: "await-approval", now: ctx.now },
          note: "Sandbox is green — the Brain stops here and asks the operator to apply.",
        };
      }
      return { step: { kind: "await-approval", summary }, note: "Awaiting operator approval." };
    }

    case "AWAITING_APPROVAL": {
      if (ctx.operatorApprovalId) {
        const verdict = classifyPatchSet(incident.patch?.changedFiles ?? []);
        if (verdict.forbidden.length > 0) {
          return {
            step: { kind: "halt", reason: "operator approval cannot apply a FORBIDDEN_AUTONOMOUS patch through the self-heal loop", needsHuman: true },
            note: "Forbidden-area patches are applied by a human directly, never by this loop.",
          };
        }
        return {
          step: { kind: "apply-to-working-tree", operatorApprovalId: ctx.operatorApprovalId },
          preEvent: { kind: "apply", operatorId: ctx.operatorApprovalId, now: ctx.now },
          note: "Operator approved — applying the verified patch to the working tree (no push).",
        };
      }
      return { step: { kind: "halt", reason: "waiting for operator approval", needsHuman: false }, note: "Idle until an operator applies or rejects." };
    }

    case "APPLIED":
      if (!incident.learnedPatternId) {
        return { step: { kind: "learn", outcome: "confirmed" }, preEvent: { kind: "learned", learnedPatternId: `pending-${incident.id}`, now: ctx.now }, note: "Recording the verified fix as a learned pattern." };
      }
      return { step: { kind: "halt", reason: "incident closed — applied + learned", needsHuman: false }, note: "Done." };

    case "ROLLED_BACK": {
      if (attempt <= BRAIN_SELFHEAL_LIMITS.maxPatchAttempts) {
        return {
          step: { kind: "draft-patch", suspectFiles: incident.hypotheses[0]?.suspectFiles ?? [], hypothesis: incident.hypotheses[0]?.statement ?? "" },
          note: `Rolled back — retrying with a fresh patch (attempt ${attempt}/${BRAIN_SELFHEAL_LIMITS.maxPatchAttempts}).`,
        };
      }
      if (!incident.learnedPatternId) {
        return { step: { kind: "learn", outcome: "failed" }, preEvent: { kind: "learned", learnedPatternId: `failed-${incident.id}`, now: ctx.now }, note: "Recording the failed fix so it is not tried again." };
      }
      return { step: { kind: "halt", reason: "rolled back and out of attempts", needsHuman: true }, note: "Handed to a human." };
    }

    case "FAILED":
      if (!incident.learnedPatternId) {
        return { step: { kind: "learn", outcome: "failed" }, preEvent: { kind: "learned", learnedPatternId: `failed-${incident.id}`, now: ctx.now }, note: "Recording the failure." };
      }
      return { step: { kind: "halt", reason: incident.needsHumanReason ?? "failed", needsHuman: true }, note: "Handed to a human." };
  }
}

function decideAfterChecks(
  incident: BrainIncident,
  ctx: SelfHealContext,
  expected: readonly BrainIncidentCheck["kind"][],
): SelfHealDecision {
  // `incident.checks` is the cumulative record. Judge failures + coverage from it.
  const all = incident.checks;
  const realFailures = all.filter((c) => c.status === "FAIL" && !c.baseline);
  if (realFailures.length > 0) {
    const names = realFailures.map((c) => c.name).join(", ");
    return {
      step: { kind: "rollback", reason: `checks failed: ${names}` },
      preEvent: { kind: "rollback", reason: `checks failed: ${names}`, now: ctx.now },
      note: "A check regressed in the sandbox — rolling the patch back.",
    };
  }
  const ran = new Set(all.map((c) => c.kind));
  // Run REQUIRED first, then REGRESSION — one batch at a time.
  const requiredMissing = REQUIRED_CHECKS.filter((k) => !ran.has(k));
  if (requiredMissing.length > 0) {
    return { step: { kind: "run-checks", checks: requiredMissing }, note: `Running the required sandbox checks: ${requiredMissing.join(", ")}.` };
  }
  const regressionMissing = expected.filter((k) => REGRESSION_CHECKS.includes(k) && !ran.has(k));
  if (regressionMissing.length > 0) {
    return { step: { kind: "run-checks", checks: regressionMissing }, note: `Running the regression sweep: ${regressionMissing.join(", ")}.` };
  }
  return {
    step: { kind: "verify" },
    preEvent: { kind: "verified", now: ctx.now },
    note: "All required checks + regression + Graphify + security green in the sandbox — verified.",
  };
}

function buildApprovalSummary(incident: BrainIncident): string {
  const p = incident.patch;
  const risk = p ? patchRisk(p.safetyLevel, p.diffLines, p.changedFiles.length) : "MEDIUM";
  return [
    `Incident ${incident.id} (${incident.category} / ${incident.severity})`,
    `Root cause: ${incident.confirmedRootCause ?? incident.hypotheses[0]?.statement ?? "n/a"}`,
    p ? `Patch: ${p.changedFiles.length} file(s), ${p.diffLines} diff lines, ${p.safetyLevel}, risk ${risk}` : "Patch: none",
    `Checks: ${incident.checks.filter((c) => c.status === "PASS").length} pass / ${incident.checks.filter((c) => c.status === "FAIL" && !c.baseline).length} fail`,
    p ? `Rollback: ${p.rollbackPlan}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Convenience: apply a decision's preEvent (if any) and return the updated incident. */
export function applySelfHealDecision(incident: BrainIncident, decision: SelfHealDecision): BrainIncident {
  if (!decision.preEvent) return incident;
  const t = advanceIncident(incident, decision.preEvent);
  return t.incident;
}

export { brainIncidentSignature };
