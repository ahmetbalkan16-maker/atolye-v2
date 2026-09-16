import { readAyasApprovalInboxState, type AyasApprovalInboxReadState, type AyasInboxDecisionRead, type AyasInboxProposalRead, type AyasInboxResultRead } from "./AyasApprovalInboxReader";
import { isAyasDeferredEligibleNow } from "./AyasDeferredEligibility";
import { createAyasPatchArtifactStore, AyasPatchArtifactError } from "./AyasPatchArtifact";

export const ayasHumanExplanationFields = ["currentProblem", "selectionReason", "expectedUserBenefit", "expectedBehaviorChange", "unchangedBehavior", "riskIfNotDone", "technicalRisk", "productionImpact"] as const;
export type AyasHumanExplanationField = typeof ayasHumanExplanationFields[number];

/** M17 — the exact, human-reviewable content of a sandbox-drafted patch. `diffPreview` is each new/changed file's full content (every current candidate is a brand-new file, so "the diff" and "the file" are the same thing); `sandboxValidationSummary` and `validatorScripts` answer Gelişim Merkezi's "sandbox testleri geçti mi? / hangi validatorlar tekrar çalışacak?" requirement directly from the frozen artifact — never re-derived or guessed. */
export interface AyasDevelopmentPatchArtifact {
  readonly patchArtifactId: string;
  readonly patchHash: string;
  readonly generatorIdentity: string;
  readonly diffPreview: readonly { readonly filePath: string; readonly content: string; readonly isNewFile: boolean }[];
  readonly validatorScripts: readonly string[];
  readonly sandboxValidationSummary: readonly string[];
}

export interface AyasDevelopmentProposal extends AyasInboxProposalRead {
  readonly approvalReady: boolean;
  readonly missingExplanation: readonly AyasHumanExplanationField[];
  readonly decision?: AyasInboxDecisionRead;
  readonly result?: AyasInboxResultRead;
  /** Present only for a `patchArtifactId`-bearing proposal, and only when the artifact still loads and verifies — a missing/corrupt artifact never crashes the view, it just omits the diff (the proposal's other fields still render normally). */
  readonly patchArtifact?: AyasDevelopmentPatchArtifact;
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
    && proposal.baseHead.trim().length > 0
    && Boolean(proposal.mutationKind?.trim());
}

function loadAyasDevelopmentPatchArtifact(proposal: AyasInboxProposalRead): AyasDevelopmentPatchArtifact | undefined {
  if (!proposal.patchArtifactId) return undefined;
  try {
    const artifact = createAyasPatchArtifactStore().loadVerified(proposal.patchArtifactId);
    return {
      patchArtifactId: artifact.artifactId,
      patchHash: artifact.patchHash,
      generatorIdentity: artifact.generatorIdentity,
      diffPreview: artifact.replacements.map((r) => ({ filePath: r.filePath, content: r.content, isNewFile: r.expectedHash === null })),
      validatorScripts: artifact.validatorScripts,
      sandboxValidationSummary: artifact.sandboxValidationSummary,
    };
  } catch (error) {
    // A missing/corrupt artifact must never break the whole Gelişim Merkezi
    // view (BrainSafetyGovernor's fail-safe-for-display posture, applied
    // here) — the proposal itself still renders, just without a diff panel.
    void (error instanceof AyasPatchArtifactError ? error.code : error);
    return undefined;
  }
}

export function buildAyasApprovalInboxView(state: AyasApprovalInboxReadState, now = new Date().toISOString()): AyasApprovalInboxView {
  const enrich = (proposal: AyasInboxProposalRead): AyasDevelopmentProposal => ({
    ...proposal,
    approvalReady: isAyasDevelopmentApprovalReady(proposal),
    missingExplanation: missingAyasHumanExplanation(proposal),
    decision: [...state.decisions].reverse().find((item) => item.proposalId === proposal.proposalId),
    result: [...state.results].reverse().find((item) => item.proposalId === proposal.proposalId),
    patchArtifact: loadAyasDevelopmentPatchArtifact(proposal),
  });
  const all = state.proposals.map(enrich);
  // M8 — the SAME predicate the durable authority layer's decision gate now
  // uses (see `AyasDeferredEligibility.ts`), so an eligible-again deferred
  // proposal shown here as "pending" is always one that layer will actually
  // accept an APPROVE/REJECT for.
  const pending = all.filter((proposal) => proposal.status === "PENDING" || (proposal.status === "DEFERRED" && isAyasDeferredEligibleNow(proposal.nextEligibleAt, now))).slice(0, 20);
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
