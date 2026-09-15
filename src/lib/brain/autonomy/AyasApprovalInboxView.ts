import { readAyasApprovalInboxProposals, type AyasInboxProposalRead } from "./AyasApprovalInboxReader";

export interface AyasApprovalInboxView {
  readonly connected: boolean;
  readonly pending: readonly Pick<AyasInboxProposalRead, "proposalId" | "proposalHash" | "createdAt" | "objective" | "rationale" | "exactFiles" | "risk" | "safetyClassification" | "testsPlanned" | "status" | "baseHead">[];
  readonly error?: string;
}

export function loadAyasApprovalInboxView(): AyasApprovalInboxView {
  try {
    const now = Date.now();
    const proposals = readAyasApprovalInboxProposals();
    return { connected: true, pending: proposals.filter((proposal) => proposal.status === "PENDING" || (proposal.status === "DEFERRED" && (!proposal.nextEligibleAt || Date.parse(proposal.nextEligibleAt) <= now))).slice(0, 20).map(({ proposalId, proposalHash, createdAt, objective, rationale, exactFiles, risk, safetyClassification, testsPlanned, status, baseHead }) => ({ proposalId, proposalHash, createdAt, objective, rationale, exactFiles, risk, safetyClassification, testsPlanned, status, baseHead })) };
  } catch (error) {
    return { connected: false, pending: [], error: error instanceof Error ? error.message : String(error) };
  }
}
