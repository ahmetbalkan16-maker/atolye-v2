/**
 * Lost-response recheck for the one-click owner actions: ONAYLA VE UYGULA,
 * BATCH ONAYLA VE UYGULA, and an owner-recommendation ONAYLA that executes.
 *
 * Each of those Server Actions runs the whole guarded publication (Package C,
 * Graphify, TypeScript, commit, push, post-publication closure) inside ONE
 * request that takes minutes. A proxy in front of the server (the Cloudflare
 * tunnel answers 524 after about 100 s) or a mobile browser can drop that
 * request while the server carries on and finishes. The client then sees only
 * a transport error although the durable state has already moved on, and the
 * page kept showing the proposal as still awaiting approval.
 *
 * Nothing here re-sends the action or decides anything. It only re-reads
 * durable state through the existing read-only refresh actions, on a fixed,
 * bounded schedule, until the subject is no longer in flight. One awaited
 * read per step; no interval, no fetch.
 */

import type { AyasApprovalInboxView } from "@/lib/brain/autonomy/AyasApprovalInboxView";
import type { AyasMicroBatchDevelopmentView } from "@/lib/brain/autonomy/AyasMicroBatchDevelopmentView";

/** The wait before each re-read; its length caps the number of reads. */
export const AYAS_LOST_RESPONSE_RECHECK_DELAYS_MS = [0, 5_000, 10_000, 20_000, 30_000, 45_000, 60_000, 60_000] as const;

/**
 * What one durable read says about the subject of a lost one-click action:
 * - `NOT_STARTED`: still awaiting the owner, so the click never took effect.
 * - `RUNNING`: decided or reserved, and not finished yet.
 * - `SETTLED`: the run is over, whatever its outcome; its own card shows it.
 * - `UNKNOWN`: the read gave nothing usable.
 */
export type AyasLostResponseProgress = "NOT_STARTED" | "RUNNING" | "SETTLED" | "UNKNOWN";

/** APPROVED and RESERVED proposals always stay in the view, so one missing from a connected view has finished. */
export function ayasProposalProgress(inbox: AyasApprovalInboxView, proposalId: string): AyasLostResponseProgress {
  if (!inbox.connected) return "UNKNOWN";
  const proposal = [...inbox.pending, ...inbox.today, ...inbox.history].find((p) => p.proposalId === proposalId);
  if (!proposal) return "SETTLED";
  if (proposal.status === "PENDING" || proposal.status === "DEFERRED") return "NOT_STARTED";
  // An owner-model APPROVE recorded without executing waits for a manual YÜRÜT: settled, not running.
  if (proposal.status === "RESERVED" || (proposal.status === "APPROVED" && !proposal.ownerApprovedPendingExecution)) return "RUNNING";
  return "SETTLED";
}

/** Same reading for a micro batch; APPROVED and RESERVED batches always stay in the view's history. */
export function ayasMicroBatchProgress(view: AyasMicroBatchDevelopmentView, batchId: string): AyasLostResponseProgress {
  if (!view.connected) return "UNKNOWN";
  const batch = [view.active, ...view.history].find((entry) => entry?.batchId === batchId);
  if (!batch) return "SETTLED";
  if (batch.status === "ACCUMULATING" || batch.status === "READY_FOR_REVIEW") return "NOT_STARTED";
  if (batch.status === "APPROVED" || batch.status === "RESERVED") return "RUNNING";
  return "SETTLED";
}

export interface AyasLostResponseRecheck<T> {
  /** An existing read-only refresh Server Action. */
  readonly read: () => Promise<T>;
  readonly progress: (view: T) => AyasLostResponseProgress;
  /** Receives every usable read, so the page shows the durable state even while the run continues. */
  readonly apply: (view: T) => void;
  readonly wait?: (milliseconds: number) => Promise<void>;
  readonly delaysMs?: readonly number[];
}

const waitMs = (milliseconds: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, milliseconds); });

/**
 * Returns `NOT_STARTED` or `SETTLED` as soon as a read shows it. Otherwise,
 * once the schedule is spent, the last usable progress (`RUNNING`), or
 * `UNKNOWN` when no read succeeded.
 */
export async function recheckAyasAfterLostResponse<T>(recheck: AyasLostResponseRecheck<T>): Promise<AyasLostResponseProgress> {
  const wait = recheck.wait ?? waitMs;
  let last: AyasLostResponseProgress = "UNKNOWN";
  for (const delay of recheck.delaysMs ?? AYAS_LOST_RESPONSE_RECHECK_DELAYS_MS) {
    if (delay > 0) await wait(delay);
    let view: T;
    try {
      view = await recheck.read();
    } catch {
      continue; // this read was lost as well; the next step tries again
    }
    const progress = recheck.progress(view);
    if (progress === "UNKNOWN") continue;
    last = progress;
    recheck.apply(view);
    if (progress !== "RUNNING") return progress;
  }
  return last;
}

/**
 * The error left on the control once the recheck ends: none when the run is
 * over, the plain transport error when the click never took effect (retrying
 * is then correct), otherwise "result unknown" so the owner checks before
 * clicking again.
 */
export function ayasLostResponseErrorCode(progress: AyasLostResponseProgress): string | null {
  if (progress === "SETTLED") return null;
  if (progress === "NOT_STARTED") return "NETWORK_ERROR";
  return "RESULT_UNKNOWN";
}
