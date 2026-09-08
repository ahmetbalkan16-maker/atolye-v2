/**
 * Atölye Brain — the decision journal (section 12 of the emir).
 *
 * Every meaningful Brain decision is recorded in an explainable form:
 *
 *   Decision:            Qwen 3B seçildi.
 *   Reason:              GPU thermal profile.
 *   Alternative:         7B
 *   Rejected because:    thermal risk / unnecessary compute.
 *   Strategy:            split research into smaller units.
 *   Expected benefit:    lower peak thermal load + comparable coverage.
 *
 * This module is **pure** — deterministic ids, no IO, no clock reads. It mirrors
 * the validation shape of `ProductionOperationJournal` (contiguous sequence,
 * monotonic timestamps, sanitized evidence) but is a separate, Brain-only log
 * and never touches production durable state.
 */

import { stableProductionId, stableProductionValue } from "@/lib/production/ProductionDeterminism";
import {
  BRAIN_PHASE_ORDER,
  brainSchemaVersion,
  type BrainDecision,
  type BrainDecisionInput,
  type BrainDecisionLogReasonCode,
  type BrainDecisionLogValidation,
} from "@/types/brain";

const MAX_EVIDENCE_ITEMS = 12;
const MAX_EVIDENCE_LENGTH = 200;

/** No secrets, no stack traces, no absolute paths — same rule as the production journal. */
const UNSAFE_EVIDENCE = /secret|api.?key|bearer|token|password|stack trace|[a-zA-Z]:[\\/]|\/(home|root|Users)\//i;

function isSafeEvidence(items: readonly string[]): boolean {
  return (
    items.length <= MAX_EVIDENCE_ITEMS &&
    items.every(
      (item) =>
        typeof item === "string" &&
        item.length > 0 &&
        item.length <= MAX_EVIDENCE_LENGTH &&
        !UNSAFE_EVIDENCE.test(item),
    )
  );
}

function isIsoInstant(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function phaseRank(phase: BrainDecision["phase"]): number {
  return BRAIN_PHASE_ORDER.indexOf(phase);
}

/**
 * Build one canonical, deterministic decision record. `sequence` is 1-based and
 * assigned by the caller (the recorder), so a rebuilt log from the same inputs
 * is byte-identical.
 */
export function buildBrainDecision(
  input: BrainDecisionInput,
  sequence: number,
): BrainDecision {
  const evidence = [...input.evidence];
  const canonicalInput: BrainDecisionInput = {
    phase: input.phase,
    ...(input.stage ? { stage: input.stage } : {}),
    decision: input.decision.trim(),
    reason: input.reason.trim(),
    alternatives: input.alternatives.map((item) => item.trim()).filter(Boolean),
    rejectedBecause: input.rejectedBecause.trim(),
    strategy: input.strategy.trim(),
    expectedBenefit: input.expectedBenefit.trim(),
    occurredAt: input.occurredAt,
    evidence,
  };
  const inputsFingerprint = stableProductionId("brain-decision-input", {
    ...canonicalInput,
    sequence,
  });
  return {
    schemaVersion: brainSchemaVersion,
    ...canonicalInput,
    decisionId: stableProductionId("brain-decision", { canonicalInput, sequence }),
    sequence,
    inputsFingerprint,
  };
}

/**
 * Validate an ordered decision log. Fail-closed: any anomaly downgrades the log
 * to `valid: false` with a specific reason code, and unsafe evidence blanks the
 * canonical output entirely.
 */
export function validateBrainDecisionLog(
  decisions: readonly BrainDecision[],
): BrainDecisionLogValidation {
  try {
    if (decisions.length === 0) {
      return {
        valid: false,
        reasonCode: "BRAIN_DECISION_LOG_EMPTY",
        canonicalDecisions: [],
      };
    }

    const ordered = [...decisions].sort(
      (left, right) =>
        left.sequence - right.sequence || left.decisionId.localeCompare(right.decisionId),
    );

    let reasonCode: BrainDecisionLogReasonCode = "BRAIN_DECISION_LOG_VALID";

    if (new Set(ordered.map((entry) => entry.decisionId)).size !== ordered.length) {
      reasonCode = "BRAIN_DECISION_LOG_ID_DUPLICATE";
    } else if (new Set(ordered.map((entry) => entry.sequence)).size !== ordered.length) {
      reasonCode = "BRAIN_DECISION_LOG_SEQUENCE_DUPLICATE";
    } else if (ordered.some((entry, index) => entry.sequence !== index + 1)) {
      reasonCode = "BRAIN_DECISION_LOG_SEQUENCE_GAP";
    } else if (ordered.some((entry) => !isIsoInstant(entry.occurredAt))) {
      reasonCode = "BRAIN_DECISION_LOG_TIMESTAMP_REGRESSION";
    } else if (
      ordered.some(
        (entry, index) =>
          index > 0 && Date.parse(entry.occurredAt) < Date.parse(ordered[index - 1].occurredAt),
      )
    ) {
      reasonCode = "BRAIN_DECISION_LOG_TIMESTAMP_REGRESSION";
    } else if (
      ordered.some(
        (entry, index) =>
          index > 0 && phaseRank(entry.phase) < phaseRank(ordered[index - 1].phase),
      )
    ) {
      // The Brain loop only moves forward through phases; `repair` → `re-review`
      // is still forward. A backward jump means a mis-ordered log.
      reasonCode = "BRAIN_DECISION_LOG_PHASE_REGRESSION";
    } else if (ordered.some((entry) => !isSafeEvidence(entry.evidence))) {
      reasonCode = "BRAIN_DECISION_LOG_UNSAFE_EVIDENCE";
    }

    return {
      valid: reasonCode === "BRAIN_DECISION_LOG_VALID",
      reasonCode,
      canonicalDecisions:
        reasonCode === "BRAIN_DECISION_LOG_UNSAFE_EVIDENCE" ? [] : ordered,
    };
  } catch {
    return {
      valid: false,
      reasonCode: "BRAIN_DECISION_LOG_INDETERMINATE",
      canonicalDecisions: [],
    };
  }
}

/**
 * A small stateful recorder — the only stateful thing in the module. It just
 * assigns sequence numbers and keeps the list; `snapshot()` returns a frozen,
 * validated copy.
 */
export class BrainDecisionRecorder {
  private readonly decisions: BrainDecision[] = [];

  record(input: BrainDecisionInput): BrainDecision {
    const decision = buildBrainDecision(input, this.decisions.length + 1);
    this.decisions.push(decision);
    return decision;
  }

  snapshot(): readonly BrainDecision[] {
    return Object.freeze([...this.decisions]);
  }

  validate(): BrainDecisionLogValidation {
    return validateBrainDecisionLog(this.decisions);
  }
}

/**
 * Render the log as the human-readable report from section 12 of the emir.
 * Deterministic; safe to show a non-technical user.
 */
export function renderBrainDecisionReport(
  decisions: readonly BrainDecision[],
): string {
  const validation = validateBrainDecisionLog(decisions);
  const header = [
    "# Atölye Brain — Karar Günlüğü / Decision Log",
    "",
    `- Kayıt sayısı / decisions: ${decisions.length}`,
    `- Doğrulama / validation: ${validation.reasonCode}`,
    "",
  ];
  if (!validation.valid) {
    header.push(
      "> ⚠️ Bu günlük tutarsız görünüyor; ham kayıtlar aşağıda sıralanmıştır.",
      "",
    );
  }
  const body = (validation.valid ? validation.canonicalDecisions : [...decisions])
    .map((entry) => {
      const lines = [
        `## ${entry.sequence}. ${entry.phase.toUpperCase()}${entry.stage ? ` · ${entry.stage}` : ""}`,
        "",
        `**Decision:** ${entry.decision}`,
        `**Reason:** ${entry.reason}`,
        `**Alternative:** ${entry.alternatives.length ? entry.alternatives.join("; ") : "—"}`,
        `**Rejected because:** ${entry.rejectedBecause || "—"}`,
        `**Strategy:** ${entry.strategy || "—"}`,
        `**Expected benefit:** ${entry.expectedBenefit || "—"}`,
        `**When:** ${entry.occurredAt}`,
      ];
      if (entry.evidence.length && isSafeEvidence(entry.evidence)) {
        lines.push(`**Evidence:** ${entry.evidence.join(" · ")}`);
      }
      lines.push("");
      return lines.join("\n");
    })
    .join("\n");
  return `${header.join("\n")}${body}`;
}

/** Stable, log-wide fingerprint — useful as an experience-record cross-reference. */
export function brainDecisionLogFingerprint(
  decisions: readonly BrainDecision[],
): string {
  return stableProductionId(
    "brain-decision-log",
    decisions.map((entry) => entry.inputsFingerprint),
  );
}

/** Escape hatch for debugging: canonical text form of a single decision. */
export function stringifyBrainDecision(decision: BrainDecision): string {
  return stableProductionValue(decision);
}
