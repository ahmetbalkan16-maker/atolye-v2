import { buildAyasApprovalInboxView, type AyasApprovalInboxView } from "./AyasApprovalInboxView";
import { readAyasApprovalInboxState, type AyasApprovalInboxReadState } from "./AyasApprovalInboxReader";
import { readAyasPublicationActivity, AYAS_PUBLICATION_ACTIVITY_UNKNOWN, type AyasPublicationActivitySnapshot } from "./AyasPublicationActivity";
import type { AyasInboxProposal, AyasInboxDecisionRecord } from "./AyasApprovalInboxStore";
import { loadAyasOwnerExactPreview, type AyasOwnerExactPreviewOptions } from "./AyasOwnerExactPreview";
/** Owner-only enrichment. The shared chat/status projection gains no Git/evidence probe import. */
export function buildAyasOwnerPreviewInboxView(state: AyasApprovalInboxReadState, now = new Date().toISOString(),
  activity: AyasPublicationActivitySnapshot = AYAS_PUBLICATION_ACTIVITY_UNKNOWN, options: AyasOwnerExactPreviewOptions = {}): AyasApprovalInboxView {
  const base = buildAyasApprovalInboxView(state, now, activity);
  const enrich = (entry: AyasApprovalInboxView["today"][number]) => {
    const proposal = state.proposals.find(p => p.proposalId === entry.proposalId);
    const decision = [...state.decisions].reverse().find(d => d.proposalId === entry.proposalId);
    return { ...entry, exactPreview: proposal ? loadAyasOwnerExactPreview(proposal as AyasInboxProposal, decision as AyasInboxDecisionRecord | undefined, options) : undefined };
  };
  return { ...base, pending: base.pending.map(enrich), today: base.today.map(enrich), history: base.history.map(enrich) };
}

export function loadAyasOwnerPreviewInboxView(): AyasApprovalInboxView {
  try { return buildAyasOwnerPreviewInboxView(readAyasApprovalInboxState(), new Date().toISOString(), readAyasPublicationActivity()); }
  catch { return { connected: false, pending: [], today: [], history: [], error: "Owner önizlemesi okunamadı." }; }
}
