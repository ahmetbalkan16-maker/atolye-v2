import { readAyasApprovalInboxState, type AyasApprovalInboxReadState, type AyasInboxDecisionRead, type AyasInboxProposalRead, type AyasInboxResultRead } from "./AyasApprovalInboxReader";

export const ayasHumanExplanationFields = ["currentProblem", "selectionReason", "expectedUserBenefit", "expectedBehaviorChange", "unchangedBehavior", "riskIfNotDone", "technicalRisk", "productionImpact"] as const;
export type AyasHumanExplanationField = typeof ayasHumanExplanationFields[number];

export interface AyasDevelopmentProposal extends AyasInboxProposalRead {
  readonly approvalReady: boolean;
  readonly missingExplanation: readonly AyasHumanExplanationField[];
  readonly decision?: AyasInboxDecisionRead;
  readonly result?: AyasInboxResultRead;
}

export interface AyasApprovalInboxView {
  readonly connected: boolean;
  readonly pending: readonly AyasDevelopmentProposal[];
  readonly today: readonly AyasDevelopmentProposal[];
  readonly history: readonly AyasDevelopmentProposal[];
  readonly error?: string;
}

/** Exported so other read-only consumers (e.g. AYAS's natural-language development-status answers) use the SAME "today" boundary as this view, rather than inventing a second one. */
export const istanbulDay = (iso: string): string => {
  const time = Date.parse(iso);
  return Number.isFinite(time) ? new Date(time + 3 * 60 * 60 * 1000).toISOString().slice(0, 10) : "invalid";
};

export function missingAyasHumanExplanation(proposal: AyasInboxProposalRead): readonly AyasHumanExplanationField[] {
  return ayasHumanExplanationFields.filter((field) => typeof proposal[field] !== "string" || !proposal[field]?.trim());
}

export function isAyasDevelopmentApprovalReady(proposal: AyasInboxProposalRead): boolean {
  return proposal.safetyClassification === "SAFE"
    && missingAyasHumanExplanation(proposal).length === 0
    && proposal.exactFiles.length > 0
    && proposal.expectedDiffScope?.trim().length > 0
    && proposal.testsPlanned.length > 0
    && proposal.graphifyEvidence?.length > 0
    && proposal.baseHead.trim().length > 0;
}

export function buildAyasApprovalInboxView(state: AyasApprovalInboxReadState, now = new Date().toISOString()): AyasApprovalInboxView {
  const enrich = (proposal: AyasInboxProposalRead): AyasDevelopmentProposal => ({
    ...proposal,
    approvalReady: isAyasDevelopmentApprovalReady(proposal),
    missingExplanation: missingAyasHumanExplanation(proposal),
    decision: [...state.decisions].reverse().find((item) => item.proposalId === proposal.proposalId),
    result: [...state.results].reverse().find((item) => item.proposalId === proposal.proposalId),
  });
  const all = state.proposals.map(enrich);
  const nowMs = Date.parse(now);
  const pending = all.filter((proposal) => proposal.status === "PENDING" || (proposal.status === "DEFERRED" && (!proposal.nextEligibleAt || Date.parse(proposal.nextEligibleAt) <= nowMs))).slice(0, 20);
  const today = all.filter((proposal) => istanbulDay(proposal.createdAt) === istanbulDay(now)).slice(-40).reverse();
  const history = all.filter((proposal) => proposal.status !== "PENDING" || proposal.decision || proposal.result).slice(-100).reverse();
  return { connected: true, pending, today, history };
}

export function loadAyasApprovalInboxView(): AyasApprovalInboxView {
  try {
    return buildAyasApprovalInboxView(readAyasApprovalInboxState());
  } catch (error) {
    return { connected: false, pending: [], today: [], history: [], error: error instanceof Error ? error.message : String(error) };
  }
}
