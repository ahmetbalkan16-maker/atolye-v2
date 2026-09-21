import { execFileSync } from "node:child_process";

import { createAyasApprovalInboxStore, type AyasApprovalInboxHandle } from "./AyasApprovalInboxStore";
import { createAyasMicroBatchStore, type AyasMicroBatchStoreHandle } from "./AyasMicroBatch";
import { reconcileAyasMicroBatchStaleness } from "./AyasMicroBatchStaleness";
import { createAyasMicroItemStore, type AyasMicroItemStore } from "./AyasMicroItem";
import { reconcileAyasStaleProposals } from "./AyasProposalStaleness";

/**
 * The smallest authoritative lifecycle boundary for Development Center reads.
 * A page refresh may advance only HEAD-bound proposal/batch bookkeeping to
 * STALE; it cannot decide, approve, reserve, execute, open a gate, or mutate
 * source. This closes the window where an offline observer left an old item
 * looking actionable after the repository had already advanced.
 */
export interface AyasDevelopmentCenterReconciliationDeps {
  readonly repoRoot?: string;
  readonly brainRoot?: string;
  readonly now?: () => string;
  readonly readHead?: () => string;
  /** Narrow deterministic seams for persistence-failure tests; production omits them. */
  readonly inbox?: AyasApprovalInboxHandle;
  readonly batchStore?: AyasMicroBatchStoreHandle;
  readonly itemStore?: AyasMicroItemStore;
}

export interface AyasDevelopmentCenterReconciliationResult {
  readonly currentHead: string;
  readonly staleProposalIds: readonly string[];
  readonly staleBatchIds: readonly string[];
}

export function reconcileAyasDevelopmentCenterFreshness(deps: AyasDevelopmentCenterReconciliationDeps = {}): AyasDevelopmentCenterReconciliationResult {
  const repoRoot = deps.repoRoot ?? process.cwd();
  const now = deps.now?.() ?? new Date().toISOString();
  const currentHead = (deps.readHead?.() ?? execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] })).trim();
  if (!currentHead) throw new Error("AYAS_DEVELOPMENT_CENTER_HEAD_UNREADABLE");

  const inbox = deps.inbox ?? createAyasApprovalInboxStore(deps.brainRoot ? { rootDir: deps.brainRoot } : {});
  const batchStore = deps.batchStore ?? createAyasMicroBatchStore(deps.brainRoot ? { rootDir: deps.brainRoot } : {});
  const itemStore = deps.itemStore ?? createAyasMicroItemStore(deps.brainRoot ? { rootDir: deps.brainRoot } : {});
  const staleProposals = reconcileAyasStaleProposals(inbox, currentHead, now);
  const staleBatches = reconcileAyasMicroBatchStaleness(batchStore, itemStore, currentHead, now);
  return {
    currentHead,
    staleProposalIds: staleProposals.map((proposal) => proposal.proposalId),
    staleBatchIds: staleBatches.map((batch) => batch.batchId),
  };
}
