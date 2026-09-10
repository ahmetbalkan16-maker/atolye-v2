/**
 * Atölye Brain — Self-Healing: the operator decision record (pure).
 *
 * Emir §10 / §11 / §21. The Report Center gives the operator three buttons on a
 * verified incident — ÇÖZÜMÜ ONAYLA / REDDET / DAHA SONRA. Clicking one does NOT
 * run git, touch the working tree, or open the execution gate. It records a
 * decision:
 *
 *   { incidentId, decision, operatorApprovalId, decidedAt, note }
 *
 * The actual `git apply --index` still happens ONLY through the Node operator CLI
 * (`npm run selfheal -- apply <id>`), which reads this record, checks it is an
 * APPROVE, and uses its `operatorApprovalId`. Browser → decision; CLI → apply.
 *
 * This module is PURE: it builds + validates the record. `BrainSelfHealStore`
 * persists it; the CLI consumes it.
 */

import { stableBrainId } from "../BrainId";
import { sanitizeUntrustedNote } from "./BrainUntrustedInput";

export const brainSelfHealDecisionSchemaVersion = "1" as const;

export type BrainSelfHealDecisionKind = "APPROVE" | "REJECT" | "LATER";

export interface BrainSelfHealDecision {
  readonly schemaVersion: typeof brainSelfHealDecisionSchemaVersion;
  /** The incident this decision is about. */
  readonly incidentId: string;
  readonly decision: BrainSelfHealDecisionKind;
  /**
   * A single-use-ish audit id the CLI passes to the runner as the operator
   * approval id. Deterministic from (incidentId, decision, decidedAt).
   */
  readonly operatorApprovalId: string;
  readonly decidedAt: string;
  /** Optional operator note — redacted + instruction-quarantined, never code. */
  readonly note: string;
  /** The incident status when the decision was taken (audit only). */
  readonly incidentStatusAtDecision: string;
}

export interface BuildSelfHealDecisionInput {
  readonly incidentId: string;
  readonly decision: BrainSelfHealDecisionKind;
  readonly now: string;
  readonly note?: string;
  readonly incidentStatusAtDecision?: string;
}

const ID_RE = /^[A-Za-z0-9._-]{1,80}$/;

export function buildSelfHealDecision(input: BuildSelfHealDecisionInput): BrainSelfHealDecision {
  if (!ID_RE.test(input.incidentId)) {
    throw new Error(`BrainSelfHealDecision: bad incidentId ${JSON.stringify(input.incidentId)}`);
  }
  if (input.decision !== "APPROVE" && input.decision !== "REJECT" && input.decision !== "LATER") {
    throw new Error(`BrainSelfHealDecision: bad decision ${JSON.stringify(input.decision)}`);
  }
  const decidedAt = String(input.now);
  return {
    schemaVersion: brainSelfHealDecisionSchemaVersion,
    incidentId: input.incidentId,
    decision: input.decision,
    operatorApprovalId: stableBrainId("op", {
      incidentId: input.incidentId,
      decision: input.decision,
      decidedAt,
    }),
    decidedAt,
    note: input.note ? sanitizeUntrustedNote(input.note, 280) : "",
    incidentStatusAtDecision: sanitizeUntrustedNote(input.incidentStatusAtDecision ?? "", 40),
  };
}

/**
 * The CLI `apply` gate: a patch may be applied from a UI decision ONLY when the
 * latest decision for the incident is an APPROVE. REJECT / LATER / no-decision
 * all mean "do not apply".
 */
export function canApplyFromDecision(decision: BrainSelfHealDecision | undefined | null): boolean {
  return decision?.decision === "APPROVE";
}

/** A short, operator-facing line for the CLI `decisions` listing. */
export function describeSelfHealDecision(d: BrainSelfHealDecision): string {
  const verb =
    d.decision === "APPROVE" ? "ONAYLANDI" : d.decision === "REJECT" ? "REDDEDİLDİ" : "SONRAYA BIRAKILDI";
  return `${d.incidentId} — ${verb} @ ${d.decidedAt.slice(0, 19)} (approvalId ${d.operatorApprovalId})${d.note ? ` — not: ${d.note}` : ""}`;
}
