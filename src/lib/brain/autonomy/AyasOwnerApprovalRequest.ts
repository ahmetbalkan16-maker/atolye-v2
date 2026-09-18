/**
 * Formats a `RECOMMEND_FOR_APPROVAL` internal decision into the plain-
 * language, owner-facing approval request the corrected authority model
 * requires: no code, no hashes, no patch internals, no Graphify output, no
 * implementation architecture — just enough for a non-technical owner to
 * answer APPROVE or REJECT. Pure formatting; carries no authority itself
 * (see `AyasApprovalBinding.ts` for the machine-checked binding that
 * actually gates execution).
 */

import { classifyPatchSet, patchRisk } from "../selfheal/BrainPatchSafety";
import type { AyasInboxProposal } from "./AyasApprovalInboxStore";
import type { AyasInternalDecisionResult } from "./AyasInternalDecision";
import { describeAyasProposalImpactForOwner, type AyasProposalStructuredImpact } from "./AyasProposalImpact";

export type AyasOwnerRiskLabel = "LOW" | "MEDIUM" | "HIGH";

export interface AyasOwnerApprovalRequest {
  readonly proposalId: string;
  readonly wantsTo: string;
  readonly why: string;
  readonly expectedBenefit: string;
  readonly scope: string;
  readonly risk: AyasOwnerRiskLabel;
  readonly riskExplanation: string;
  readonly validationSummary: string;
  readonly externalCost: string;
  /** Plain-language, one-sentence dependency/cost/licensing disclosure (Step 2/3) — always shown, never gated behind "advanced". */
  readonly dependencyDisclosure: string;
  /** Always "PROCEED" — this object is only ever built for a RECOMMEND_FOR_APPROVAL decision. */
  readonly recommendation: "PROCEED";
  /** False for a REVIEW_REQUIRED recommendation, or one whose structured impact forbids autonomous execution, that is informational only — the owner should see this before answering. */
  readonly executable: boolean;
  /** Raw internal metadata — never rendered inline; a UI must explicitly open an "advanced details" section to show this. Absent when the proposal predates structured impact modeling. */
  readonly advanced?: { readonly structuredImpact: AyasProposalStructuredImpact };
}

function commonScope(files: readonly string[]): string {
  if (files.length === 0) return "no files declared";
  const dirs = files.map((f) => f.split("/").slice(0, 2).join("/"));
  const unique = [...new Set(dirs)];
  return unique.length === 1 ? unique[0] : `${unique.length} areas (${unique.slice(0, 3).join(", ")}${unique.length > 3 ? ", …" : ""})`;
}

/** Only ever call this for a `RECOMMEND_FOR_APPROVAL` decision — a REJECT/DEFER never produces an owner-facing artifact at all. */
export function buildAyasOwnerApprovalRequest(proposal: AyasInboxProposal, decision: AyasInternalDecisionResult): AyasOwnerApprovalRequest {
  if (decision.decision !== "RECOMMEND_FOR_APPROVAL") {
    throw new Error("buildAyasOwnerApprovalRequest called for a non-RECOMMEND_FOR_APPROVAL decision — REJECT/DEFER must never reach the owner");
  }
  const domain = classifyPatchSet(proposal.exactFiles);
  const risk = patchRisk(domain.level, 0, proposal.exactFiles.length);
  const riskExplanation = decision.executable
    ? domain.level === "SAFE"
      ? "low-risk, well-understood area; sandbox-validated before this request was created"
      : "AYAS classified this outside its normal safe area"
    : `${proposal.safetyClassification} — this touches a sensitive area AYAS cannot execute on its own even if you approve; approving only records your decision, it does not apply the change`;

  return {
    proposalId: proposal.proposalId,
    wantsTo: proposal.objective || "make an unspecified improvement",
    why: proposal.currentProblem || proposal.rationale || "no problem statement recorded",
    expectedBenefit: proposal.expectedUserBenefit || "no benefit statement recorded",
    scope: commonScope(proposal.exactFiles),
    risk,
    riskExplanation,
    validationSummary: proposal.testsPlanned.length > 0
      ? `sandbox-validated; ${proposal.testsPlanned.length} test file(s) must pass: ${proposal.testsPlanned.join(", ")}`
      : "no validating tests declared",
    externalCost: proposal.estimatedCost === "zero-cost" ? "none" : String(proposal.estimatedCost),
    dependencyDisclosure: describeAyasProposalImpactForOwner(proposal.structuredImpact),
    recommendation: "PROCEED",
    executable: decision.executable,
    ...(proposal.structuredImpact ? { advanced: { structuredImpact: proposal.structuredImpact } } : {}),
  };
}
