"use client";

import type { AyasApprovalInboxView } from "@/lib/brain/autonomy/AyasApprovalInboxView";
import { AyasDevelopmentCenter } from "./AyasDevelopmentCenter";

/**
 * Stage 7B: the ONAYLA control is offered only when `safetyClassification`
 * is "SAFE" — but that is a UI convenience, not the security boundary. The
 * server action (`decideAyasApproval`) and `AyasApprovalInboxStore.decide()`
 * both independently refuse to approve a non-SAFE proposal; the UI cannot
 * override that policy.
 */
export function AyasApprovalInboxPanel({ inbox, pendingId, onDecision }: { readonly inbox: AyasApprovalInboxView; readonly pendingId?: string | null; readonly onDecision: (input: { proposalId: string; decision: "APPROVE" | "REJECT" | "LATER" }) => void }) {
  return <AyasDevelopmentCenter inbox={inbox} pendingId={pendingId} onDecision={onDecision} />;
}
