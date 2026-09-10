/**
 * Atölye Brain — Self-Healing runner (Node, operator-CLI only).
 *
 * Drives one incident through the loop by repeatedly asking `planSelfHealStep`
 * for the next INTENT and executing it via adapters:
 *
 *   diagnose               → BrainRootCauseEngine (pure)
 *   draft-patch            → the injected `draftPatch` adapter (an LLM step, or
 *                            in the synthetic test a fixture)
 *   create-sandbox / …     → BrainSelfHealSandbox
 *   run-checks             → the injected `runChecks` adapter (tsc / lint /
 *                            build / smoke / regression, run IN the sandbox)
 *   apply-to-working-tree  → the injected `applyToWorkingTree` adapter, gated by
 *                            an operator approval id
 *   learn                  → BrainLearnedPattern + store
 *
 * The Brain reaches AWAITING_APPROVAL on its own; APPLIED needs an operator id.
 * Never pushes, never merges, never deploys, never touches the execution gate.
 *
 * FORBIDDEN for the Brain to self-modify (BrainPatchSafety).
 */

import {
  advanceIncident,
  brainIncidentSignature,
  type BrainIncident,
  type BrainIncidentCheck,
} from "./BrainIncident";
import { diagnoseRootCause, type BrainRecentCommit, type BrainTimelineEvent } from "./BrainRootCauseEngine";
import { planSelfHealStep, applySelfHealDecision, type SelfHealContext, type SelfHealStep } from "./SelfHealingBrain";
import { patchRisk, classifyPatchSet } from "./BrainPatchSafety";
import type { BrainAutoApplyConfig } from "./BrainAutoApplyPolicy";
import type { BrainHealWatchdogConfig } from "./BrainHealWatchdog";
import type { BrainRuntimeEvent } from "./BrainRuntimeEvent";
import type { BrainBenchmarkVerdict } from "./BrainOptimizationBenchmark";
import { buildLearnedPattern, reinforceLearnedPattern, type BrainLearnedPattern } from "./BrainLearnedPattern";
import { checkSignatureNotMuted, checkConcurrency, type BrainSignatureHistoryEntry } from "./BrainSelfHealLimits";
import { sanitizeUntrustedText } from "./BrainUntrustedInput";
import { assertSelfHealActionAllowed } from "./BrainSelfHealGuards";
import type { BrainSelfHealStoreHandle } from "./BrainSelfHealStore";
import type { BrainSelfHealSandboxHandle } from "./BrainSelfHealSandbox";

export interface DraftedPatch {
  readonly files: readonly { readonly path: string; readonly content: string }[];
  readonly rationale: string;
  readonly rollbackPlan: string;
}

export interface BrainSelfHealAdapters {
  /** Propose a concrete file-level patch for a hypothesis. Returns null when it cannot. */
  readonly draftPatch: (input: {
    readonly incident: BrainIncident;
    readonly hypothesis: string;
    readonly suspectFiles: readonly string[];
    readonly attempt: number;
    readonly sandboxDir: string;
  }) => Promise<DraftedPatch | null>;
  /** Run the named checks in the sandbox. Must classify a KNOWN baseline failure as `BASELINE_KNOWN_FAIL`. */
  readonly runChecks: (input: {
    readonly sandbox: BrainSelfHealSandboxHandle;
    readonly checks: readonly BrainIncidentCheck["kind"][];
  }) => Promise<readonly BrainIncidentCheck[]>;
  /** Create a sandbox worktree at the base commit. */
  readonly createSandbox: (baseCommit: string) => Promise<BrainSelfHealSandboxHandle>;
  /** Apply a verified sandbox change to the live working tree (operator step, never a push). */
  readonly applyToWorkingTree: (input: {
    readonly incident: BrainIncident;
    readonly operatorApprovalId: string;
    readonly diff: string;
    readonly changedFiles: readonly string[];
  }) => Promise<{ readonly ok: boolean; readonly detail: string }>;
  readonly now: () => string;
  readonly nowMs: () => number;

  /* ---- v2 (optional) ---- */
  /** SAFE auto-apply to the working tree, STAGED — never committed / pushed. */
  readonly autoApplyToWorkingTree?: (input: {
    readonly incident: BrainIncident;
    readonly diff: string;
    readonly changedFiles: readonly string[];
  }) => Promise<{ readonly ok: boolean; readonly detail: string }>;
  /** Undo a working-tree apply (restore the staged files from the base commit). */
  readonly rollbackWorkingTree?: (input: {
    readonly incident: BrainIncident;
    readonly changedFiles: readonly string[];
    readonly baseCommit: string;
  }) => Promise<{ readonly ok: boolean; readonly detail: string }>;
  /** Observe the live runtime for the post-apply watchdog. */
  readonly observePostApply?: (input: {
    readonly incident: BrainIncident;
    readonly appliedAtMs: number;
    readonly elapsedMs: number;
  }) => Promise<{
    readonly eventsSinceApply: readonly BrainRuntimeEvent[];
    readonly signatureRecurrences: number;
    readonly postApplyChecks?: readonly { readonly name: string; readonly status: "PASS" | "FAIL" }[];
    readonly benchmark?: BrainBenchmarkVerdict | null;
  }>;
}

export interface BrainSelfHealRunInput {
  readonly incident: BrainIncident;
  readonly timeline: readonly BrainTimelineEvent[];
  readonly recentCommits: readonly BrainRecentCommit[];
  readonly baseCommit: string;
  readonly store: BrainSelfHealStoreHandle;
  readonly adapters: BrainSelfHealAdapters;
  /** Set by the operator `--apply` command. */
  readonly operatorApprovalId?: string | null;
  /** Hard cap on loop iterations (belt & braces vs the pure limits). */
  readonly maxIterations?: number;
  /* ---- v2 (optional; omitted ⇒ v1 behaviour) ---- */
  readonly autoApply?: BrainAutoApplyConfig;
  readonly healWatchdog?: BrainHealWatchdogConfig;
  readonly autonomousApplyTimestampsMs?: readonly number[];
  readonly recentlyFailedSignatures?: readonly string[];
}

export interface BrainSelfHealRunResult {
  readonly incident: BrainIncident;
  readonly steps: readonly { readonly step: SelfHealStep; readonly note: string }[];
  readonly report: string;
  readonly learnedPattern: BrainLearnedPattern | null;
}

export async function runBrainSelfHeal(input: BrainSelfHealRunInput): Promise<BrainSelfHealRunResult> {
  const { store, adapters } = input;
  const startedAtMs = adapters.nowMs();
  const maxIterations = input.maxIterations ?? 24;

  // ---- pre-flight: concurrency + signature mute -------------------------
  const inFlight = store.listIncidents().filter((i) => !["HEALED", "FAILED"].includes(i.status)).length;
  const conc = checkConcurrency(inFlight);
  const sig = brainIncidentSignature(input.incident);
  const history: BrainSignatureHistoryEntry[] = [...store.loadSignatureHistory()];
  const muted = checkSignatureNotMuted(sig, history, startedAtMs);

  let incident = input.incident;
  const steps: { step: SelfHealStep; note: string }[] = [];

  if (!conc.ok || !muted.ok) {
    const reason = !conc.ok ? conc.reason : muted.reason;
    incident = advanceIncident(incident, { kind: "fail", reason, now: adapters.now() }).incident;
    store.saveIncident(incident);
    return { incident, steps, report: buildReport(incident, steps), learnedPattern: null };
  }
  store.recordSignature({ signature: sig, openedAt: startedAtMs });
  store.saveIncident(incident);

  let sandbox: BrainSelfHealSandboxHandle | null = null;
  let candidatePatch: SelfHealContext["candidatePatch"] = null;
  let lastCheckResults: readonly BrainIncidentCheck[] | null = null;
  let learnedPattern: BrainLearnedPattern | null = null;
  // v2 monitoring state
  const v2 = Boolean(input.autoApply || input.healWatchdog || adapters.observePostApply);
  let appliedAtMs = 0;
  let monitor: SelfHealContext["monitor"] = null;
  let rollbackCount = 0;

  try {
    for (let iter = 0; iter < maxIterations; iter += 1) {
      const ctx: SelfHealContext = {
        now: adapters.now(),
        nowMs: adapters.nowMs(),
        startedAtMs,
        timeline: input.timeline,
        recentCommits: input.recentCommits,
        learnedPatterns: store.listLearnedPatterns(),
        candidatePatch,
        lastCheckResults,
        operatorApprovalId: input.operatorApprovalId ?? null,
        autoApply: input.autoApply,
        autonomousApplyTimestampsMs: input.autonomousApplyTimestampsMs,
        recentlyFailedSignatures: input.recentlyFailedSignatures,
        monitor,
        // v1 runner (no v2 config): no watchdog — an operator apply → learn.
        healWatchdog: v2 ? input.healWatchdog : null,
      };

      const decision = planSelfHealStep(incident, ctx);
      incident = applySelfHealDecision(incident, decision);
      steps.push({ step: decision.step, note: decision.note });

      const step = decision.step;
      if (step.kind === "halt") {
        store.saveIncident(incident);
        // A halt into FAILED / ROLLED_BACK still gets ONE learning pass so the
        // failed fix is recorded (never as a win). Then stop.
        if ((incident.status === "FAILED" || incident.status === "ROLLED_BACK") && !incident.learnedPatternId) {
          learnedPattern = recordLearning(incident, "failed", store, adapters.now());
          if (learnedPattern) {
            incident = advanceIncident(incident, { kind: "learned", learnedPatternId: learnedPattern.id, now: adapters.now() }).incident;
            steps.push({ step: { kind: "learn", outcome: "failed" }, note: "Recorded the failed fix so it is not retried." });
            store.saveIncident(incident);
          }
        }
        break;
      }

      if (step.kind === "diagnose") {
        const report = diagnoseRootCause({
          incident,
          timeline: input.timeline,
          recentCommits: input.recentCommits,
          learnedPatterns: store.listLearnedPatterns(),
        });
        incident = advanceIncident(incident, { kind: "diagnose", hypotheses: report.hypotheses, now: adapters.now() }).incident;
        if (report.best?.matchedLearnedPatternId) {
          incident = advanceIncident(incident, { kind: "confirm-root-cause", rootCause: report.best.statement, now: adapters.now() }).incident;
        }
        store.saveIncident(incident);
        continue;
      }

      if (step.kind === "draft-patch") {
        if (!sandbox) sandbox = await adapters.createSandbox(input.baseCommit);
        const attempt = (incident.patch?.attempt ?? 0) + 1;
        const drafted = await adapters.draftPatch({
          incident,
          hypothesis: step.hypothesis,
          suspectFiles: step.suspectFiles,
          attempt,
          sandboxDir: sandbox.dir,
        });
        if (!drafted) {
          incident = advanceIncident(incident, { kind: "fail", reason: "the patch drafter could not produce a fix", now: adapters.now() }).incident;
          store.saveIncident(incident);
          continue;
        }
        // reset the worktree to base before applying a fresh attempt
        await sandbox.command(["git", "checkout", "--", "."]).catch(() => undefined);
        await sandbox.applyFiles(drafted.files);
        const { diff, changedFiles, diffLines } = await sandbox.diff();
        const verdict = classifyPatchSet(changedFiles);
        candidatePatch = { changedFiles, diff, diffLines, baseCommit: sandbox.baseCommit, rationale: sanitizeUntrustedText(drafted.rationale, { maxLength: 400 }).text };
        incident = advanceIncident(incident, {
          kind: "sandbox-patch",
          now: adapters.now(),
          patch: {
            patchId: `${incident.id}-a${attempt}`,
            baseCommit: sandbox.baseCommit,
            changedFiles,
            diff,
            diffLines,
            safetyLevel: verdict.level,
            risk: patchRisk(verdict.level, diffLines, changedFiles.length),
            rollbackPlan: sanitizeUntrustedText(drafted.rollbackPlan, { maxLength: 300 }).text || "git worktree remove --force <sandbox>",
            attempt,
          },
        }).incident;
        lastCheckResults = null;
        store.saveIncident(incident);
        continue;
      }

      if (step.kind === "run-checks") {
        if (!sandbox) {
          incident = advanceIncident(incident, { kind: "fail", reason: "no sandbox for checks", now: adapters.now() }).incident;
          store.saveIncident(incident);
          continue;
        }
        const results = await adapters.runChecks({ sandbox, checks: step.checks });
        lastCheckResults = results;
        incident = advanceIncident(incident, { kind: "checks", checks: results, now: adapters.now() }).incident;
        store.saveIncident(incident);
        continue;
      }

      if (step.kind === "verify") {
        // handled by the decision's preEvent (advanceIncident already ran)
        lastCheckResults = null;
        store.saveIncident(incident);
        continue;
      }

      if (step.kind === "await-approval") {
        store.saveIncident(incident);
        // The Brain stops here unless the operator supplied an approval id.
        if (!input.operatorApprovalId) break;
        continue;
      }

      if (step.kind === "rollback") {
        // advanceIncident already applied the rollback via preEvent
        candidatePatch = null;
        lastCheckResults = null;
        if (sandbox) await sandbox.command(["git", "checkout", "--", "."]).catch(() => undefined);
        store.saveIncident(incident);
        continue;
      }

      if (step.kind === "apply-to-working-tree") {
        const guard = assertSelfHealActionAllowed({
          kind: "apply-patch",
          paths: incident.patch?.changedFiles ?? [],
          safetyLevel: incident.patch?.safetyLevel,
          operatorApprovalId: step.operatorApprovalId,
        });
        if (!guard.allowed) {
          incident = advanceIncident(incident, { kind: "fail", reason: `apply denied: ${guard.reason}`, now: adapters.now() }).incident;
          store.saveIncident(incident);
          break;
        }
        const applied = await adapters.applyToWorkingTree({
          incident,
          operatorApprovalId: step.operatorApprovalId,
          diff: incident.patch?.diff ?? "",
          changedFiles: incident.patch?.changedFiles ?? [],
        });
        if (!applied.ok) {
          incident = advanceIncident(incident, { kind: "rollback", reason: `working-tree apply failed: ${applied.detail}`, now: adapters.now() }).incident;
        } else {
          appliedAtMs = adapters.nowMs();
        }
        store.saveIncident(incident);
        continue;
      }

      if (step.kind === "auto-apply-to-working-tree") {
        // The guard STILL applies — but the "operator id" is the autonomous
        // policy's own decision id (recorded on the incident as appliedBy).
        const guard = assertSelfHealActionAllowed({
          kind: "apply-patch",
          paths: incident.patch?.changedFiles ?? [],
          safetyLevel: incident.patch?.safetyLevel,
          operatorApprovalId: `autonomous-safe:${incident.id}`,
        });
        const apply = adapters.autoApplyToWorkingTree ?? (async () => ({ ok: false, detail: "no autoApplyToWorkingTree adapter" }));
        if (!guard.allowed) {
          incident = advanceIncident(incident, { kind: "fail", reason: `auto-apply denied: ${guard.reason}`, now: adapters.now() }).incident;
          store.saveIncident(incident);
          break;
        }
        const applied = await apply({ incident, diff: incident.patch?.diff ?? "", changedFiles: incident.patch?.changedFiles ?? [] });
        if (!applied.ok) {
          incident = advanceIncident(incident, { kind: "rollback", reason: `auto-apply failed: ${applied.detail}`, now: adapters.now() }).incident;
        } else {
          appliedAtMs = adapters.nowMs();
        }
        store.saveIncident(incident);
        continue;
      }

      if (step.kind === "monitor") {
        const obs = adapters.observePostApply
          ? await adapters.observePostApply({ incident, appliedAtMs: appliedAtMs || adapters.nowMs(), elapsedMs: adapters.nowMs() - (appliedAtMs || adapters.nowMs()) })
          : { eventsSinceApply: [], signatureRecurrences: 0 };
        monitor = {
          appliedAtMs: appliedAtMs || adapters.nowMs(),
          eventsSinceApply: obs.eventsSinceApply,
          signatureRecurrences: obs.signatureRecurrences,
          postApplyChecks: obs.postApplyChecks,
          benchmark: obs.benchmark ?? null,
          rollbackCount,
        };
        // the "monitor" preEvent moved the incident to MONITORING on the first pass
        store.saveIncident(incident);
        // If the watchdog will need more time and there is no live clock advance
        // (a synchronous test), stop here rather than spin.
        if (!adapters.observePostApply) break;
        continue;
      }

      if (step.kind === "auto-rollback") {
        rollbackCount += 1;
        const rb = adapters.rollbackWorkingTree ?? (async () => ({ ok: true, detail: "no rollback adapter — nothing applied to undo" }));
        const done = await rb({ incident, changedFiles: incident.patch?.changedFiles ?? [], baseCommit: incident.patch?.baseCommit ?? input.baseCommit });
        incident = advanceIncident(incident, {
          kind: "rollback",
          reason: `${step.reason}${done.ok ? " — working tree restored" : ` — RESTORE FAILED: ${done.detail}`}`,
          now: adapters.now(),
        }).incident;
        monitor = null;
        candidatePatch = null;
        lastCheckResults = null;
        store.saveIncident(incident);
        continue;
      }

      if (step.kind === "learn") {
        learnedPattern = recordLearning(incident, step.outcome, store, adapters.now());
        if (learnedPattern) {
          incident = advanceIncident(incident, { kind: "learned", learnedPatternId: learnedPattern.id, now: adapters.now() }).incident;
        }
        store.saveIncident(incident);
        continue;
      }

      if (step.kind === "create-sandbox" || step.kind === "apply-patch-to-sandbox") {
        // reserved intents — the runner creates the sandbox lazily in draft-patch
        continue;
      }
    }
  } finally {
    if (sandbox) await sandbox.destroy().catch(() => undefined);
  }

  return { incident, steps, report: buildReport(incident, steps), learnedPattern };
}

function recordLearning(
  incident: BrainIncident,
  outcome: "confirmed" | "failed",
  store: BrainSelfHealStoreHandle,
  now: string,
): BrainLearnedPattern | null {
  const signature = brainIncidentSignature(incident);
  const existing = store.listLearnedPatterns().find((p) => p.signature === signature);
  if (outcome === "failed") {
    if (!existing) return null; // do not learn a fresh pattern from a failure
    const updated = reinforceLearnedPattern(existing, {
      confirmed: false,
      incidentId: incident.id,
      failedFix: incident.patch ? `attempt ${incident.patch.attempt}: ${incident.patch.changedFiles.join(", ")}` : "n/a",
      now,
    });
    return store.saveLearnedPattern(updated);
  }
  // confirmed
  if (existing) {
    return store.saveLearnedPattern(reinforceLearnedPattern(existing, { confirmed: true, incidentId: incident.id, now }));
  }
  const pattern = buildLearnedPattern(incident, {
    successfulFix: incident.patch ? `${incident.patch.changedFiles.join(", ")} — ${incident.hypotheses[0]?.statement ?? "fix"}` : "manual",
    regressionResult: incident.checks.filter((c) => c.kind === "regression").every((c) => c.status === "PASS") ? "regression PASS" : "regression not run",
    performanceResult: null,
    risk: incident.patch?.risk ?? "MEDIUM",
    status: incident.status === "APPLIED" || incident.status === "HEALED" ? "APPLIED" : "VERIFIED",
    now,
  });
  return store.saveLearnedPattern(pattern);
}

/** The operator-facing incident report (emir §17). */
export function buildReport(incident: BrainIncident, steps: readonly { step: SelfHealStep; note: string }[]): string {
  const p = incident.patch;
  const realFails = incident.checks.filter((c) => c.status === "FAIL" && !c.baseline);
  const passes = incident.checks.filter((c) => c.status === "PASS");
  const risk = p ? patchRisk(p.safetyLevel, p.diffLines, p.changedFiles.length) : "—";
  const action =
    incident.status === "APPLIED"
      ? "APPLIED (working tree only — not pushed)"
      : incident.status === "VERIFIED" || incident.status === "AWAITING_APPROVAL"
        ? "AWAITING OPERATOR APPROVAL"
        : incident.status === "ROLLED_BACK"
          ? "ROLLED BACK"
          : incident.status === "FAILED"
            ? "FAILED — NEEDS A HUMAN"
            : incident.status;
  return [
    "🧠 ATÖLYE BRAIN — SELF-HEALING",
    "",
    `INCIDENT:    ${incident.id}  (${incident.category} / ${incident.severity})`,
    `CLASSIFIED:  ${incident.classification}`,
    `SYMPTOM:     ${incident.symptom}`,
    `DETECTION:   ${incident.classification === "REAL_INCIDENT" ? "automatic" : "automatic (held)"}`,
    "",
    `ROOT CAUSE:  ${incident.confirmedRootCause ?? incident.hypotheses[0]?.statement ?? "not established"}`,
    `CONFIDENCE:  ${incident.hypotheses[0]?.confidence?.toFixed(2) ?? "—"}`,
    incident.hypotheses[0]?.counterEvidence?.length ? `COUNTER-EV:  ${incident.hypotheses[0].counterEvidence.join("; ")}` : null,
    "",
    `FIX:         ${p ? `${p.changedFiles.length} file(s), ${p.diffLines} diff lines — ${p.safetyLevel}` : "none"}`,
    p ? `FILES:       ${p.changedFiles.join(", ")}` : null,
    "",
    `SANDBOX:     ${realFails.length === 0 && passes.length > 0 ? "PASS" : realFails.length ? `FAIL (${realFails.map((c) => c.name).join(", ")})` : "—"}`,
    `REGRESSION:  ${incident.checks.filter((c) => c.kind === "regression").map((c) => `${c.name}:${c.status}`).join(", ") || "—"}`,
    `RISK:        ${risk}`,
    "",
    `ACTION:      ${action}`,
    `LEARNED:     ${incident.learnedPatternId ? "YES" : "no"}`,
    p ? `ROLLBACK:    ${p.rollbackPlan}` : null,
    "",
    "STEPS:",
    ...steps.map((s, i) => `  ${String(i + 1).padStart(2, " ")}. ${s.step.kind} — ${s.note}`),
  ]
    .filter((l) => l !== null)
    .join("\n");
}
