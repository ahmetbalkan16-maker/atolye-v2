"use client";

import type { AyasApprovalInboxView } from "@/lib/brain/autonomy/AyasApprovalInboxView";

/**
 * Stage 7A: display-only. Renders pending proposals for operator awareness;
 * it has no decision controls and no path to `decideAyasApproval` — approval
 * minting/consumption is out of scope for this sprint.
 */
export function AyasApprovalInboxPanel({ inbox }: { readonly inbox: AyasApprovalInboxView }) {
  if (!inbox.connected || inbox.pending.length === 0) return null;
  return (
    <section aria-label="AYAS Approval Inbox" data-testid="ayas-approval-inbox" style={{ margin: "0 auto 16px", maxWidth: 1120, padding: "12px 16px", border: "1px solid rgba(148,163,184,.22)", borderRadius: 14, background: "rgba(15,23,42,.72)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}><strong>AYAS Approval Inbox</strong><span>{inbox.pending.length} öneri</span></div>
      {inbox.pending.map((proposal) => (
        <article key={proposal.proposalId} style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid rgba(148,163,184,.16)" }}>
          <strong>{proposal.objective}</strong><p style={{ margin: "4px 0", opacity: .78 }}>{proposal.rationale}</p>
          <small>{proposal.safetyClassification} · {proposal.risk} · {proposal.exactFiles.join(", ") || "dosya kapsamı yok"}</small>
          {proposal.safetyClassification !== "SAFE" ? <p style={{ marginTop: 8, opacity: .7 }}><em>HUMAN REVIEW GEREKLİ</em></p> : null}
        </article>
      ))}
    </section>
  );
}
