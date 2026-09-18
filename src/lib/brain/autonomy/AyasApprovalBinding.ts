/**
 * Binds an owner's APPROVE decision to the exact reality it was shown
 * against — proposal identity, base HEAD, patch/artifact identity, declared
 * scope, and risk classification. Corrected authority model: "Approval
 * becomes INVALID if any of these materially change" — this module is that
 * check, run immediately before an APPROVE is ever allowed to reach real
 * execution (see `AyasAutonomousExecutionGate.ts`).
 *
 * A binding is a snapshot, not a second source of truth: it never itself
 * grants authority, it only records what the owner saw so the gate can
 * detect drift. Deliberately does not duplicate what `proposalHash` already
 * proves byte-for-byte (baseHead/scope/patchArtifactId/patchHash are all
 * part of its hash material in `AyasApprovalInboxStore.ts`) — a hash
 * mismatch alone would already prove SOMETHING changed, but the owner-
 * facing model wants a specific, plain-language reason, not just "hash
 * changed", so each field is compared individually too.
 */

import type { AyasInboxProposal } from "./AyasApprovalInboxStore";

export interface AyasApprovalBindingSnapshot {
  readonly proposalId: string;
  readonly proposalHash: string;
  readonly baseHead: string;
  readonly exactFiles: readonly string[];
  readonly safetyClassification: AyasInboxProposal["safetyClassification"];
  readonly patchArtifactId?: string;
  readonly patchHash?: string;
  readonly boundAt: string;
}

export function bindAyasOwnerApproval(proposal: AyasInboxProposal, now: string): AyasApprovalBindingSnapshot {
  return {
    proposalId: proposal.proposalId,
    proposalHash: proposal.proposalHash,
    baseHead: proposal.baseHead,
    exactFiles: [...proposal.exactFiles].sort(),
    safetyClassification: proposal.safetyClassification,
    patchArtifactId: proposal.patchArtifactId,
    patchHash: proposal.patchHash,
    boundAt: now,
  };
}

export type AyasApprovalBindingInvalidReason =
  | "PROPOSAL_NOT_FOUND"
  | "NOT_PENDING"
  | "BASE_HEAD_CHANGED"
  | "SCOPE_CHANGED"
  | "PATCH_ARTIFACT_CHANGED"
  | "RISK_CLASSIFICATION_CHANGED"
  | "PROPOSAL_HASH_CHANGED";

export type AyasApprovalBindingEvaluation =
  | { readonly valid: true }
  | { readonly valid: false; readonly reason: AyasApprovalBindingInvalidReason; readonly detail: string };

/**
 * Re-derives every bound fact from the CURRENT proposal state and compares.
 * Must be called with a freshly-loaded proposal (never a cached one) —
 * callers are responsible for the freshness of `currentProposal` itself;
 * this function only compares what it is given.
 */
export function reevaluateAyasApprovalBinding(
  binding: AyasApprovalBindingSnapshot,
  currentProposal: AyasInboxProposal | undefined,
): AyasApprovalBindingEvaluation {
  if (!currentProposal) {
    return { valid: false, reason: "PROPOSAL_NOT_FOUND", detail: `proposal ${binding.proposalId} no longer exists` };
  }
  if (currentProposal.status !== "PENDING") {
    return { valid: false, reason: "NOT_PENDING", detail: `proposal status is now ${currentProposal.status}, not PENDING` };
  }
  if (currentProposal.baseHead !== binding.baseHead) {
    return { valid: false, reason: "BASE_HEAD_CHANGED", detail: `baseHead moved from ${binding.baseHead} to ${currentProposal.baseHead}` };
  }
  const currentFiles = [...currentProposal.exactFiles].sort();
  if (JSON.stringify(currentFiles) !== JSON.stringify(binding.exactFiles)) {
    return { valid: false, reason: "SCOPE_CHANGED", detail: `declared files changed from ${JSON.stringify(binding.exactFiles)} to ${JSON.stringify(currentFiles)}` };
  }
  if (currentProposal.patchArtifactId !== binding.patchArtifactId || currentProposal.patchHash !== binding.patchHash) {
    return { valid: false, reason: "PATCH_ARTIFACT_CHANGED", detail: "patch artifact identity or hash no longer matches what the owner approved" };
  }
  if (currentProposal.safetyClassification !== binding.safetyClassification) {
    return { valid: false, reason: "RISK_CLASSIFICATION_CHANGED", detail: `safetyClassification changed from ${binding.safetyClassification} to ${currentProposal.safetyClassification}` };
  }
  if (currentProposal.proposalHash !== binding.proposalHash) {
    return { valid: false, reason: "PROPOSAL_HASH_CHANGED", detail: "proposal content changed in a way not covered by the checks above" };
  }
  return { valid: true };
}
