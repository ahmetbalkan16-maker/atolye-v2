"use client";

import type { AyasApprovalInboxView } from "@/lib/brain/autonomy/AyasApprovalInboxView";

/**
 * Stage 7B: the ONAYLA control is offered only when `safetyClassification`
 * is "SAFE" — but that is a UI convenience, not the security boundary. The
 * server action (`decideAyasApproval`) and `AyasApprovalInboxStore.decide()`
 * both independently refuse to approve a non-SAFE proposal; the UI cannot
 * override that policy.
 */
export function AyasApprovalInboxPanel({ inbox, pendingId, onDecision }: { readonly inbox: AyasApprovalInboxView; readonly pendingId?: string | null; readonly onDecision: (input: { proposalId: string; decision: "APPROVE" | "REJECT" | "LATER" }) => void }) {
  if (!inbox.connected || inbox.pending.length === 0) return null;
  return (
    <section aria-label="AYAS Approval Inbox" data-testid="ayas-approval-inbox" style={{ margin: "0 auto 16px", maxWidth: 1120, padding: "12px 16px", border: "1px solid rgba(148,163,184,.22)", borderRadius: 14, background: "rgba(15,23,42,.72)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}><strong>AYAS Approval Inbox</strong><span>{inbox.pending.length} öneri</span></div>
      {inbox.pending.map((proposal) => (
        <article key={proposal.proposalId} style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid rgba(148,163,184,.16)" }}>
          <strong>{proposal.objective}</strong><p style={{ margin: "4px 0", opacity: .78 }}>{proposal.rationale}</p>
          <small>{proposal.safetyClassification} · {proposal.risk} · {proposal.exactFiles.join(", ") || "dosya kapsamı yok"}</small>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            {proposal.safetyClassification === "SAFE" ? <button type="button" disabled={pendingId === proposal.proposalId} onClick={() => onDecision({ proposalId: proposal.proposalId, decision: "APPROVE" })}>ONAYLA</button> : <span>HUMAN REVIEW GEREKLİ</span>}
            <button type="button" disabled={pendingId === proposal.proposalId} onClick={() => onDecision({ proposalId: proposal.proposalId, decision: "REJECT" })}>REDDET</button>
            <button type="button" disabled={pendingId === proposal.proposalId} onClick={() => onDecision({ proposalId: proposal.proposalId, decision: "LATER" })}>DAHA SONRA</button>
          </div>
        </article>
      ))}
    </section>
  );
}
