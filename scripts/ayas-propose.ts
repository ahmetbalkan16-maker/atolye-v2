import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { createAyasAutonomyDaemon, type AyasDaemonCandidate } from "../src/lib/brain/autonomy/AyasAutonomyDaemon";
import { createAyasApprovalInboxStore } from "../src/lib/brain/autonomy/AyasApprovalInboxStore";
import { isAyasMutationKindRegistered } from "../src/lib/brain/autonomy/AyasMutationRegistry";
import { resolveAyasBoundedPath } from "../src/lib/brain/autonomy/AyasBoundedFileWrite";

/**
 * AYAS proposal producer entrypoint (M15) — explicit, human-triggered only.
 *
 * This script does NOT discover improvements on its own: `CANDIDATE` below
 * is a declarative literal a human edits by hand before running
 * `npm run ayas:propose`. It gathers real, read-only evidence (git
 * branch/HEAD/clean state, Graphify freshness), validates the candidate's
 * `exactFiles` against a path-safety allowlist BEFORE any durable proposal
 * is written, and then calls the existing, already-tested
 * `AyasAutonomyDaemon.discover()` — the one canonical proposal producer —
 * to turn it into a durable `AyasInboxProposal`. It never approves,
 * reserves, executes, mutates code, or transitions the execution gate.
 */

const root = process.cwd();
const ALLOWED_CANDIDATE_ROOTS = ["src/", "scripts/", "app/", "docs/"];

function git(args: readonly string[]): string {
  return execFileSync("git", [...args], { cwd: root, encoding: "utf8", windowsHide: true }).trim();
}

function graphifyFresh(): boolean {
  return fs.existsSync(path.join(root, ".graphify", "graph.json"));
}

/**
 * Edit this literal by hand before running the script — it is the entire
 * "what should AYAS propose" decision, made by a human, not inferred.
 */
const CANDIDATE: AyasDaemonCandidate = {
  objective: "PLACEHOLDER — describe the improvement",
  currentProblem: "PLACEHOLDER — describe the current problem",
  selectionReason: "PLACEHOLDER — why this evidence supports the change",
  expectedUserBenefit: "PLACEHOLDER — what the human gains",
  expectedBehaviorChange: "PLACEHOLDER — what will behave differently",
  unchangedBehavior: "PLACEHOLDER — what stays the same",
  riskIfNotDone: "PLACEHOLDER — cost of not doing this",
  technicalRisk: "PLACEHOLDER — technical risk, if any",
  productionImpact: "none",
  rationale: "PLACEHOLDER — rationale",
  evidence: ["PLACEHOLDER — evidence reference"],
  graphifyEvidence: ["PLACEHOLDER — Graphify evidence reference"],
  exactFiles: [],
  expectedDiffScope: "PLACEHOLDER — expected diff scope",
  testsPlanned: [],
  risk: "PLACEHOLDER — risk summary",
  rank: 1,
  mutationKind: "PLACEHOLDER — must resolve in AyasMutationRegistry.ts",
};

function validateCandidate(candidate: AyasDaemonCandidate): void {
  if (candidate.exactFiles.length === 0) throw new Error("AYAS_PROPOSE_NO_EXACT_FILES");
  for (const filePath of candidate.exactFiles) {
    // Throws AyasBoundedFileWriteError for traversal/absolute/denied paths —
    // reused here purely as a path-safety check, no write happens.
    resolveAyasBoundedPath(root, filePath, ALLOWED_CANDIDATE_ROOTS);
  }
  if (!candidate.mutationKind.trim()) throw new Error("AYAS_PROPOSE_MUTATION_KIND_REQUIRED");
  if (!isAyasMutationKindRegistered(candidate.mutationKind)) {
    throw new Error(`AYAS_PROPOSE_MUTATION_KIND_UNREGISTERED: "${candidate.mutationKind}" has no reviewed implementation in AyasMutationRegistry.ts yet — write and review it before proposing`);
  }
}

function main(): void {
  validateCandidate(CANDIDATE);

  const branch = git(["branch", "--show-current"]);
  const head = git(["rev-parse", "HEAD"]);
  const repoClean = git(["status", "--porcelain"]).length === 0;
  const fresh = graphifyFresh();
  const now = new Date().toISOString();

  if (!repoClean) throw new Error("AYAS_PROPOSE_REPO_DIRTY");
  if (!fresh) throw new Error("AYAS_PROPOSE_GRAPHIFY_STALE");

  const inbox = createAyasApprovalInboxStore();
  const daemon = createAyasAutonomyDaemon({ inbox, now: () => now });
  const observation = { now, branch, head, repoClean, graphifyFresh: fresh, machineAction: "ALLOW" as const, gaps: [] as string[] };
  daemon.observe(observation);
  const proposals = daemon.discover(observation, [CANDIDATE]);

  if (proposals.length === 0) {
    console.log(JSON.stringify({ status: "NO_NEW_PROPOSAL", reason: "identical proposal already exists (deduped by proposalHash)" }));
    return;
  }
  const proposal = proposals[0]!;
  console.log(JSON.stringify({ status: "PROPOSAL_CREATED", proposalId: proposal.proposalId, safetyClassification: proposal.safetyClassification, mutationKind: proposal.mutationKind, exactFiles: proposal.exactFiles, baseHead: proposal.baseHead }, null, 2));
}

main();
