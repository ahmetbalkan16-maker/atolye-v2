import { readAyasApprovalInboxState, type AyasApprovalInboxReadState, type AyasInboxDecisionRead, type AyasInboxProposalRead, type AyasInboxResultRead } from "./AyasApprovalInboxReader";
import { isAyasDeferredEligibleNow } from "./AyasDeferredEligibility";
import { createAyasPatchArtifactStore, AyasPatchArtifactError } from "./AyasPatchArtifact";
import { classifyAyasFindingValue, type AyasFindingValueClass } from "./AyasFindingValueClass";
import { readAyasPublicationActivity, AYAS_PUBLICATION_ACTIVITY_UNKNOWN, type AyasPublicationActivitySnapshot } from "./AyasPublicationActivity";
import { isAyasOwnerApprovedDecisionReason } from "./AyasOwnerApprovalProvenance";

/**
 * Approval-race UX hardening (Part A). Purely a display hint derived from
 * already-durable facts at read time — never itself an authority signal and
 * never mutates anything:
 * - `EXECUTING_NOW`: THIS proposal reserved the gate and it is still open.
 * - `WAITING_OTHER_PUBLICATION`: the gate is open for a DIFFERENT governed
 *   action; this one has not decided/reserved yet, so it cannot be the owner.
 * - `REVALIDATING_FOR_NEW_HEAD`: the live repository HEAD has already moved
 *   past this proposal's `baseHead`, but the durable store has not yet run
 *   its next staleness-reconciliation pass — this closes the exact window
 *   that made the earlier incident confusing (an item that LOOKED pending
 *   and actionable was actually already dead).
 * - `STALE_SUPERSEDED`: the store has confirmed STALE, and a fresh
 *   rediscovery bound to the current HEAD already exists for the same files.
 * - `STALE_AWAITING_REDISCOVERY`: confirmed STALE, no successor seen yet.
 * - `NORMAL`: none of the above — render exactly as before this sprint.
 */
export type AyasPublicationDisplayState =
  | "NORMAL"
  | "EXECUTING_NOW"
  | "WAITING_OTHER_PUBLICATION"
  | "REVALIDATING_FOR_NEW_HEAD"
  | "STALE_SUPERSEDED"
  | "STALE_AWAITING_REDISCOVERY";

function computeAyasPublicationDisplayState(
  proposal: Pick<AyasInboxProposalRead, "status" | "baseHead" | "exactFiles" | "createdAt">,
  decision: AyasInboxDecisionRead | undefined,
  activity: AyasPublicationActivitySnapshot,
  all: readonly AyasInboxProposalRead[],
): { readonly displayState: AyasPublicationDisplayState; readonly supersededByProposalId?: string } {
  if (proposal.status === "STALE") {
    const successor = [...all]
      .filter((p) => p.status === "PENDING" && p.exactFiles.length > 0 && p.exactFiles.length === proposal.exactFiles.length && p.exactFiles.every((f) => proposal.exactFiles.includes(f)))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
    return successor ? { displayState: "STALE_SUPERSEDED", supersededByProposalId: successor.proposalId } : { displayState: "STALE_AWAITING_REDISCOVERY" };
  }
  if (proposal.status !== "PENDING" && proposal.status !== "APPROVED" && proposal.status !== "DEFERRED") return { displayState: "NORMAL" };
  if (activity.publicationActive) {
    const ownsReservation = Boolean(decision?.reservedAt) && !decision?.finalizedAt;
    return { displayState: ownsReservation ? "EXECUTING_NOW" : "WAITING_OTHER_PUBLICATION" };
  }
  if (activity.liveCurrentHead && activity.liveCurrentHead !== proposal.baseHead) return { displayState: "REVALIDATING_FOR_NEW_HEAD" };
  return { displayState: "NORMAL" };
}

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
  /** M20.1 — deterministic value classification, computed fresh from `exactFiles` on every read (never stored, never influenced by proposal prose, never an authority signal — purely "why does this matter" for a human reading Gelişim Merkezi). */
  readonly valueClass: AyasFindingValueClass;
  /** Approval-race UX hardening (Part A) — see `computeAyasPublicationDisplayState`. Purely descriptive; never gates or grants anything. */
  readonly displayState: AyasPublicationDisplayState;
  /** Set only when `displayState === "STALE_SUPERSEDED"`. */
  readonly supersededByProposalId?: string;
  /**
   * True only for an `APPROVED` proposal whose APPROVE came from the
   * owner-approval model (`AyasAutonomousExecutionGate.decideAyasOwnerApproval`)
   * while live execution was disabled — durably resumable by
   * `AyasOwnerApprovalResume.ts`, never by a second manual click. A legacy
   * `decideAyasApproval`-approved proposal is `false` here and keeps its
   * ordinary manual "YÜRÜT" control; this flag is what lets the UI show the
   * two differently without a client-side flag of its own.
   */
  readonly ownerApprovedPendingExecution: boolean;
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

export function buildAyasApprovalInboxView(state: AyasApprovalInboxReadState, now = new Date().toISOString(), activity: AyasPublicationActivitySnapshot = AYAS_PUBLICATION_ACTIVITY_UNKNOWN): AyasApprovalInboxView {
  const enrich = (proposal: AyasInboxProposalRead): AyasDevelopmentProposal => {
    const decision = [...state.decisions].reverse().find((item) => item.proposalId === proposal.proposalId);
    const { displayState, supersededByProposalId } = computeAyasPublicationDisplayState(proposal, decision, activity, state.proposals);
    return {
      ...proposal,
      approvalReady: isAyasDevelopmentApprovalReady(proposal),
      missingExplanation: missingAyasHumanExplanation(proposal),
      decision,
      result: [...state.results].reverse().find((item) => item.proposalId === proposal.proposalId),
      patchArtifact: loadAyasDevelopmentPatchArtifact(proposal),
      valueClass: classifyAyasFindingValue(proposal.exactFiles),
      displayState,
      supersededByProposalId,
      ownerApprovedPendingExecution: proposal.status === "APPROVED" && isAyasOwnerApprovedDecisionReason(decision?.reason),
    };
  };
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
    return buildAyasApprovalInboxView(readAyasApprovalInboxState(), new Date().toISOString(), readAyasPublicationActivity());
  } catch (error) {
    return { connected: false, pending: [], today: [], history: [], error: error instanceof Error ? error.message : String(error) };
  }
}
