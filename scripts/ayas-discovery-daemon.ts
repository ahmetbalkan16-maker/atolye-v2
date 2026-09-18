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
function graphifyFresh(): boolean {
  return fs.existsSync(path.join(root, ".graphify", "graph.json"));
}

async function main(): Promise<void> {
  const now = new Date().toISOString();
  const telemetry = await collectAyasMachineTelemetry({ cwd: root, now: () => now });
  const health = evaluateAyasMachineHealth(telemetry, { stage: "video", ownedActive: false });
  const observation = {
    now,
    branch: git(["branch", "--show-current"]),
    head: git(["rev-parse", "HEAD"]),
    repoClean: git(["status", "--porcelain"]).length === 0,
    graphifyFresh: graphifyFresh(),
    machineAction: health.action,
    gaps: [] as string[],
  };

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

  const discovered = daemon.discover(observation, [...discoverAyasSafeCandidates({ repoRoot: root, observation }), ...novel.candidates]);

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

  // AYAS CONTINUOUS EXTERNAL INTELLIGENCE sprint (Part B/Q) — one scheduler
  // tick per discovery-daemon tick, the exact same "spawned once per cycle,
  // never a second parallel mechanism" posture as everything else in this
  // script. `tickAyasResearchScheduler` is itself a fast no-op the
  // overwhelming majority of the time (cadence not due yet) and is
  // independently lease-protected against a second concurrent daemon
  // process, so this can never produce a duplicate scan. A research failure
  // (network down, every source erroring) is folded into `gaps` exactly
  // like the other best-effort signals above — it must never abort
  // discovery, staleness reconciliation, or anything else in this script.
  // `AYAS_RESEARCH_SCHEDULER_ENABLED=0` is a real operator opt-out (e.g. "I
  // don't want AYAS reaching the internet right now"), and is also how a
  // repo-root-spawning test that has nothing to do with research (e.g.
  // smoke-ayas-discovery-registry.ts's isolated-fixture-repo integration
  // test) avoids incurring a real, first-ever-tick network+local-model
  // research cycle as an unrelated side effect — confirmed live: without
  // this, that test's spawned child process could exceed its own timeout
  // budget waiting on a real DEEP scan it never asked for.
  let research: AyasResearchSchedulerTickResult | undefined;
  const researchSchedulerEnabled = process.env.AYAS_RESEARCH_SCHEDULER_ENABLED !== "0";
  if (researchSchedulerEnabled) {
    try {
      research = await tickAyasResearchScheduler({ repoRoot: root });
    } catch (error) {
      observation.gaps.push(`research scheduler tick failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

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
  }));
}
main().catch((error) => { console.error("AYAS discovery daemon FAILED:", error); process.exitCode = 1; });
