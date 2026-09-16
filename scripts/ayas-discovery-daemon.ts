import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { collectAyasMachineTelemetry } from "../src/lib/ayas/machine/AyasMachineTelemetry";
import { evaluateAyasMachineHealth } from "../src/lib/ayas/machine/AyasMachineHealthGuard";
import { createAyasApprovalInboxStore } from "../src/lib/brain/autonomy/AyasApprovalInboxStore";
import { createAyasAutonomyDaemon } from "../src/lib/brain/autonomy/AyasAutonomyDaemon";
import { reconcileAyasStaleProposals } from "../src/lib/brain/autonomy/AyasProposalStaleness";
import { discoverAyasSafeCandidates } from "../src/lib/brain/autonomy/AyasDiscoveryRegistry";
import { discoverAyasNovelPatchCandidates } from "../src/lib/brain/autonomy/AyasNovelPatchDiscovery";

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
  }));
}
main().catch((error) => { console.error("AYAS discovery daemon FAILED:", error); process.exitCode = 1; });
