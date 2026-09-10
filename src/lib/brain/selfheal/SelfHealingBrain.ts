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
  type BrainIncident,
  type BrainIncidentCheck,
  type BrainIncidentEvent,
} from "./BrainIncident";
import { diagnoseRootCause, type BrainRecentCommit, type BrainTimelineEvent } from "./BrainRootCauseEngine";
import { classifyPatchSet, patchRisk } from "./BrainPatchSafety";
import { checkSelfHealAttempt, checkRollbackAttempts, checkAutonomousApplyRate, BRAIN_SELFHEAL_LIMITS } from "./BrainSelfHealLimits";
import { decideAutoApply, DEFAULT_AUTO_APPLY_CONFIG, type BrainAutoApplyConfig } from "./BrainAutoApplyPolicy";
import { runHealWatchdog, DEFAULT_HEAL_WATCHDOG_CONFIG, type BrainHealWatchdogConfig } from "./BrainHealWatchdog";
import type { BrainRuntimeEvent } from "./BrainRuntimeEvent";
import type { BrainBenchmarkVerdict } from "./BrainOptimizationBenchmark";
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

  /* ---- v2 ---- */
  readonly autoApply?: BrainAutoApplyConfig;
  /** `null` ⇒ no post-apply watchdog (v1 behaviour: an operator apply → learn). */
  readonly healWatchdog?: BrainHealWatchdogConfig | null;
  /** Epoch ms of prior autonomous applies (rate-limit). */
  readonly autonomousApplyTimestampsMs?: readonly number[];
  /** Signatures whose last auto-apply ended in HEAL_FAILED. */
  readonly recentlyFailedSignatures?: readonly string[];
  /** For a MONITORING incident: the post-apply observation. */
  readonly monitor?: {
    readonly appliedAtMs: number;
    readonly eventsSinceApply: readonly BrainRuntimeEvent[];
    readonly signatureRecurrences: number;
    readonly postApplyChecks?: readonly { readonly name: string; readonly status: "PASS" | "FAIL" }[];
    readonly benchmark?: BrainBenchmarkVerdict | null;
    /** Auto-rollbacks already done for this incident. */
    readonly rollbackCount: number;
  } | null;
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
  /** v2: SAFE auto-apply to the working tree (staged, never pushed). */
  | { readonly kind: "auto-apply-to-working-tree"; readonly checklist: readonly { readonly name: string; readonly ok: boolean; readonly detail: string }[] }
  /** v2: start / continue the post-apply watchdog. */
  | { readonly kind: "monitor"; readonly elapsedMs: number }
  | { readonly kind: "rollback"; readonly reason: string }
  | { readonly kind: "auto-rollback"; readonly reason: string; readonly evidence: readonly string[] }
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
      // v2 — the auto-apply policy decides. Default (opt-in OFF, or anything but
      // an all-SAFE high-confidence patch) → the Brain still stops for a human.
      const rate = checkAutonomousApplyRate(ctx.autonomousApplyTimestampsMs ?? [], ctx.nowMs);
      const verdict = decideAutoApply({
        incident,
        config: ctx.autoApply ?? DEFAULT_AUTO_APPLY_CONFIG,
        recentlyFailedSignatures: ctx.recentlyFailedSignatures,
        incidentSignature: brainIncidentSignature(incident),
      });
      if (verdict.decision === "AUTO_APPLY" && rate.ok) {
        return {
          step: { kind: "auto-apply-to-working-tree", checklist: verdict.checklist },
          preEvent: { kind: "auto-apply", now: ctx.now },
          note: `SAFE auto-apply: ${verdict.reason}`,
        };
      }
      const why =
        verdict.decision === "AUTO_APPLY" && !rate.ok
          ? `${verdict.reason} — but ${rate.reason}`
          : verdict.reason;
      return {
        step: { kind: "await-approval", summary: `${summary}\nauto-apply: ${verdict.decision} (${why})` },
        preEvent: { kind: "await-approval", now: ctx.now },
        note: `Sandbox green — ${why}. Awaiting operator approval.`,
      };
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

    case "APPLIED": {
      // v2 — an APPLIED patch (operator OR autonomous) is now MONITORED by the
      // watchdog before it can be called HEALED. An operator apply with the
      // watchdog disabled skips straight to learn.
      if (ctx.healWatchdog === null && incident.appliedBy === "operator") {
        if (!incident.learnedPatternId) {
          return { step: { kind: "learn", outcome: "confirmed" }, preEvent: { kind: "learned", learnedPatternId: `pending-${incident.id}`, now: ctx.now }, note: "Operator-applied; recording the verified fix as a learned pattern." };
        }
        return { step: { kind: "halt", reason: "incident closed — applied + learned", needsHuman: false }, note: "Done." };
      }
      return {
        step: { kind: "monitor", elapsedMs: 0 },
        preEvent: { kind: "monitor", now: ctx.now },
        note: "Patch is live — starting the post-apply watchdog.",
      };
    }

    case "MONITORING": {
      const m = ctx.monitor;
      const cfg = ctx.healWatchdog ?? DEFAULT_HEAL_WATCHDOG_CONFIG;
      if (!m) {
        return { step: { kind: "monitor", elapsedMs: 0 }, note: "Watchdog — waiting for the first observation window." };
      }
      const wd = runHealWatchdog({
        config: cfg,
        elapsedMs: ctx.nowMs - m.appliedAtMs,
        eventsSinceApply: m.eventsSinceApply,
        signatureRecurrences: m.signatureRecurrences,
        postApplyChecks: m.postApplyChecks,
        benchmark: m.benchmark,
      });
      if (wd.verdict === "HEALED") {
        return {
          step: { kind: "learn", outcome: "confirmed" },
          preEvent: { kind: "healed", evidence: wd.evidence, now: ctx.now },
          note: `HEALED — ${wd.reason}. Recording the pattern.`,
        };
      }
      if (wd.verdict === "HEAL_FAILED") {
        const rb = checkRollbackAttempts(m.rollbackCount);
        if (!rb.ok) {
          return {
            step: { kind: "halt", reason: rb.reason, needsHuman: true },
            preEvent: { kind: "fail", reason: rb.reason, now: ctx.now },
            note: "Watchdog says the fix failed and we are out of auto-rollbacks — handing to a human.",
          };
        }
        return {
          step: { kind: "auto-rollback", reason: wd.reason, evidence: wd.evidence },
          preEvent: { kind: "heal-failed", reason: wd.reason, now: ctx.now },
          note: `Watchdog: ${wd.reason} — auto-rolling back.`,
        };
      }
      return { step: { kind: "monitor", elapsedMs: ctx.nowMs - m.appliedAtMs }, note: wd.reason };
    }

    case "HEALED":
      if (!incident.learnedPatternId) {
        return { step: { kind: "learn", outcome: "confirmed" }, preEvent: { kind: "learned", learnedPatternId: `pending-${incident.id}`, now: ctx.now }, note: "Recording the healed fix as a learned pattern." };
      }
      return { step: { kind: "halt", reason: "incident HEALED + learned", needsHuman: false }, note: "Done — self-healed." };

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
