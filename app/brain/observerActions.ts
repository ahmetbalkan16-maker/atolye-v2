"use server";

/**
 * Stage 7A — read-only observer/inbox Server Actions.
 *
 * `refreshAyasApprovalInbox` re-reads the durable approval-inbox file
 * (read-only) for display. This module's import chain never reaches a
 * mutating authority module — it cannot mint or consume authorization and
 * cannot reach the execution gate. The Package B decision action lives in a
 * separate module and is deliberately NOT re-exported or imported here — it
 * stays out of the Stage 7A dependency closure.
 */

import { loadAyasApprovalInboxView, type AyasApprovalInboxView } from "@/lib/brain/autonomy/AyasApprovalInboxView";

export async function refreshAyasApprovalInbox(): Promise<AyasApprovalInboxView> {
  return loadAyasApprovalInboxView();
}
