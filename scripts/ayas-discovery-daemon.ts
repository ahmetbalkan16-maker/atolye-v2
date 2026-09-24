import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { collectAyasMachineTelemetry } from "../src/lib/ayas/machine/AyasMachineTelemetry";
import { evaluateAyasMachineHealth } from "../src/lib/ayas/machine/AyasMachineHealthGuard";
import { createAyasApprovalInboxStore } from "../src/lib/brain/autonomy/AyasApprovalInboxStore";
import { createAyasAutonomyDaemon } from "../src/lib/brain/autonomy/AyasAutonomyDaemon";
import { reconcileAyasStaleProposals } from "../src/lib/brain/autonomy/AyasProposalStaleness";
import { reviewAyasPendingProposals } from "../src/lib/brain/autonomy/AyasAutonomousReview";
import { discoverAyasSafeCandidates } from "../src/lib/brain/autonomy/AyasDiscoveryRegistry";
import { discoverAyasNovelPatchCandidates } from "../src/lib/brain/autonomy/AyasNovelPatchDiscovery";
import { accumulateAyasMicroBatchCandidates } from "../src/lib/brain/autonomy/AyasMicroBatchAccumulator";
import { createAyasMicroBatchStore } from "../src/lib/brain/autonomy/AyasMicroBatch";
import { createAyasMicroItemStore } from "../src/lib/brain/autonomy/AyasMicroItem";
import { reconcileAyasMicroBatchStaleness } from "../src/lib/brain/autonomy/AyasMicroBatchStaleness";
import { tickAyasResearchScheduler, type AyasResearchSchedulerTickResult } from "../src/lib/brain/autonomy/AyasResearchScheduler";
import { createAyasLocalDiscoveryRunLedger } from "../src/lib/brain/autonomy/AyasLocalDiscoveryRunLedger";
import { createAyasExternalResearchStore } from "../src/lib/brain/autonomy/AyasExternalResearchStore";
import { discoverAyasResearchProposalCandidates } from "../src/lib/brain/autonomy/AyasResearchProposalBridge";

/**
 * AYAS discovery daemon (M16) — a single-shot, read-mostly companion to the
 * always-on observer (`scripts/ayas-autonomy-daemon.ts`). Split into its
 * own process and module graph deliberately: the observer's own
 * zero-authority import graph is a load-bearing, separately tested
 * invariant (see `smoke-ayas-observer-autostart.ts`), and must never gain a
 * direct import of `AyasApprovalInboxStore`/`AyasAutonomyDaemon`. This
 * script is spawned BY the observer, once per tick, as a plain child
 * process — the same arm's-length pattern the observer already uses for
 * `git` — never imported into the observer's own process.
 *
 * Authority: reads git/Machine Health/Graphify state, durably reconciles
 * PENDING/APPROVED proposals whose `baseHead` has gone stale to `STALE`,
 * and calls the existing, unmodified `AyasAutonomyDaemon.discover()` with
 * server-owned SAFE candidates from `AyasDiscoveryRegistry`. It never
 * decides, reserves, executes, opens a gate, or runs a mutation's `run()`.
 */
const root = process.cwd();

function git(args: readonly string[]): string {
  return execFileSync("git", [...args], { cwd: root, encoding: "utf8", windowsHide: true }).trim();
}
function graphifyFresh(head: string): boolean {
  try {
    if (!fs.statSync(path.join(root, ".graphify", "graph.json")).isFile()) return false;
    const branch = JSON.parse(fs.readFileSync(path.join(root, ".graphify", "branch.json"), "utf8")) as { readonly lastAnalyzedHead?: unknown; readonly stale?: unknown };
    return branch.lastAnalyzedHead === head && branch.stale === false;
  } catch { return false; }
}

async function main(): Promise<void> {
  const now = new Date().toISOString();
  const telemetry = await collectAyasMachineTelemetry({ cwd: root, now: () => now });
  const health = evaluateAyasMachineHealth(telemetry, { stage: "video", ownedActive: false });
  const head = git(["rev-parse", "HEAD"]);
  const observation = {
    now,
    branch: git(["branch", "--show-current"]),
    head,
    repoClean: git(["status", "--porcelain"]).length === 0,
    graphifyFresh: graphifyFresh(head),
    machineAction: health.action,
    gaps: [] as string[],
  };
  const nextExpectedArg = process.argv.indexOf("--next-expected-at");
  const nextExpectedAt = nextExpectedArg >= 0 ? process.argv[nextExpectedArg + 1] : undefined;
  const ledger = createAyasLocalDiscoveryRunLedger();
  const ledgerRun = ledger.start({ startedAt: now, baseHead: observation.head, ...(nextExpectedAt ? { nextExpectedAt } : {}) });

  try {

  // One lock-protected scheduler tick per child process. Reconcile durable
  // research before unrelated discovery/inbox work, so their failures do
  // not suppress missed-window detection. Operator opt-out remains honored.
  let research: AyasResearchSchedulerTickResult | undefined;
  const researchSchedulerEnabled = process.env.AYAS_RESEARCH_SCHEDULER_ENABLED !== "0";
  if (researchSchedulerEnabled) {
    try { research = await tickAyasResearchScheduler({ repoRoot: root }); }
    catch (error) { observation.gaps.push(`research scheduler tick failed: ${error instanceof Error ? error.message : String(error)}`); }
  }

  const inbox = createAyasApprovalInboxStore();
  // Backend-authoritative staleness reconciliation: unconditional, since it
  // only ever flips PENDING/APPROVED -> STALE (see AyasProposalStaleness.ts)
  // and never reserves/executes/opens a gate.
  const staled = reconcileAyasStaleProposals(inbox, observation.head, now);

  const daemon = createAyasAutonomyDaemon({ inbox, now: () => now });
  daemon.observe(observation);

  // M17 — sandboxed, structurally-detected novel candidates (never
  // hand-embedded). Drafting, applying, and validating all happen inside an
  // isolated `git worktree` under os.tmpdir() (see AyasPatchSandbox.ts) — this
  // call never touches the real working tree, never stages/commits/pushes,
  // and only ever returns a candidate for a patch that already passed
  // sandbox validation and was frozen as an immutable artifact. A failure
  // here is folded into `gaps`, exactly like every other best-effort signal
  // in this script — it never aborts staleness reconciliation or the
  // existing static-source discovery below.
  let novel: Awaited<ReturnType<typeof discoverAyasNovelPatchCandidates>> = { candidates: [], rejections: [], findings: [] };
  try {
    novel = await discoverAyasNovelPatchCandidates({ repoRoot: root, observation });
  } catch (error) {
    observation.gaps.push(`novel patch discovery failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const researchCandidates = discoverAyasResearchProposalCandidates(createAyasExternalResearchStore().list(), inbox.load().proposals);
  const candidates = [...discoverAyasSafeCandidates({ repoRoot: root, observation }), ...novel.candidates, ...researchCandidates];
  const proposalIdsBefore = new Set(inbox.load().proposals.map((proposal) => proposal.proposalId));
  const discovered = daemon.discover(observation, candidates);
  const proposalCount = inbox.load().proposals.filter((proposal) => !proposalIdsBefore.has(proposal.proposalId)).length;

  // Owner-approval model — AYAS's own internal REJECT/DEFER/RECOMMEND_FOR_APPROVAL
  // filter, run once per tick over every currently-PENDING proposal (including
  // ones from a prior tick, not just what `discovered` just added). REJECT/DEFER
  // are durably recorded here so the owner never has to see them; only a
  // RECOMMEND_FOR_APPROVAL + executable proposal is ever surfaced by
  // `AyasOwnerRecommendationsView`'s read-only projection. Never executes
  // anything — same best-effort posture as every other signal in this tick.
  let ownerReview: ReturnType<typeof reviewAyasPendingProposals> = { rejected: [], deferred: [], recommended: [] };
  try {
    ownerReview = reviewAyasPendingProposals(inbox, () => now);
  } catch (error) {
    observation.gaps.push(`owner-approval internal review failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  // M18 — MICRO_SAFE candidates never reach the line above (AyasNovelPatchDiscovery
  // skips them); they accumulate here instead, in the persistent isolated batch
  // worktree, never the real working tree. Same best-effort posture as the novel
  // patch discovery above: a failure here never aborts staleness reconciliation
  // or the individual-proposal discovery already completed.
  const microBatchStore = createAyasMicroBatchStore();
  const microItemStore = createAyasMicroItemStore();
  const staledBatches = reconcileAyasMicroBatchStaleness(microBatchStore, microItemStore, observation.head, now);
  let microBatch: Awaited<ReturnType<typeof accumulateAyasMicroBatchCandidates>> = { itemsAdded: [], batch: null, rejections: [], readyForReview: false, staledPreviousBatchId: null };
  try {
    microBatch = await accumulateAyasMicroBatchCandidates({ repoRoot: root, observation, batchStore: microBatchStore, itemStore: microItemStore });
  } catch (error) {
    observation.gaps.push(`micro batch accumulation failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  ledger.complete(ledgerRun.runId, {
    completedAt: new Date().toISOString(),
    candidateCount: candidates.length,
    proposalCount,
    duplicateCount: Math.max(0, discovered.length - proposalCount),
    staleProposalCount: staled.length,
    staleBatchCount: staledBatches.length,
    researchOutcome: research?.outcome ?? (researchSchedulerEnabled ? "ERROR" : "DISABLED"),
  });

  console.log(JSON.stringify({
    status: "OK",
    head: observation.head,
    repoClean: observation.repoClean,
    graphifyFresh: observation.graphifyFresh,
    machineAction: observation.machineAction,
    staleReconciled: staled.map((p) => p.proposalId),
    discovered: discovered.map((p) => p.proposalId),
    novelRejections: novel.rejections,
    findings: novel.findings.length,
    microBatchStaleReconciled: staledBatches.map((b) => b.batchId),
    microItemsAdded: microBatch.itemsAdded.map((i) => i.microItemId),
    microBatchId: microBatch.batch?.batchId ?? null,
    microBatchStatus: microBatch.batch?.status ?? null,
    microBatchReadyForReview: microBatch.readyForReview,
    microBatchRejections: microBatch.rejections,
    researchOutcome: research?.outcome ?? (researchSchedulerEnabled ? "ERROR" : "DISABLED"),
    researchNextLightAt: research?.state.nextLightAt ?? null,
    researchNextDeepAt: research?.state.nextDeepAt ?? null,
    researchFindingsRecorded: research?.deep?.findingsRecorded ?? 0,
    ownerReviewRejected: ownerReview.rejected.map((r) => r.proposalId),
    ownerReviewDeferred: ownerReview.deferred.map((d) => d.proposalId),
    ownerReviewRecommended: ownerReview.recommended.map((r) => r.binding.proposalId),
    localDiscoveryRunId: ledgerRun.runId,
    localCandidateCount: candidates.length,
    localProposalCount: proposalCount,
  }));
  } catch (error) {
    try { ledger.fail(ledgerRun.runId, new Date().toISOString()); } catch { /* preserve the original failure */ }
    throw error;
  }
}
main().catch((error) => { console.error("AYAS discovery daemon FAILED:", error); process.exitCode = 1; });
