import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { createAyasApprovalInboxStore, type AyasApprovalInboxHandle } from "./AyasApprovalInboxStore";
import { ayasGitFailureMessage, fetchAyasRemoteBranch, pushAyasBranchWithRetry } from "./AyasGitPushRetry";
import type { AyasMicroBatchStoreHandle } from "./AyasMicroBatch";
import { countAyasOpenMicroBatchRecoveries, createAyasMicroBatchArtifactView, createAyasMicroBatchRecoveryInbox } from "./AyasMicroBatchRecovery";
import { createAyasMicroItemStore, type AyasMicroItemStore } from "./AyasMicroItem";
import { createAyasPatchArtifactStore, type AyasPatchArtifactStore } from "./AyasPatchArtifact";
import { closeAyasPostPublication, refreshAyasGraphifyForHead } from "./AyasPostPublicationClosure";
import { ayasMicroBatchPublicationOperation, isAyasPublicationInFlight, reconcileAyasRecoveryRequiredProposals, type AyasRecoveryReconciliationResult } from "./AyasRecoveryReconciliation";

/**
 * Self-heal after a publication that did not finish (owner, 2026-11-05: "böyle hatalarda sistemin kendi kendini
 * düzeltmesini istiyorum" — and without Claude or Codex in the loop).
 *
 * The 2026-11-04 incident had two halves, and each gets its own step in the update executor, which the observer
 * starts every tick on a clean tree:
 *
 *  1. Publication recovery. An owner-approved commit whose push failed stays local and RECOVERY_REQUIRED. The
 *     recovery pass (AyasRecoveryReconciliation with a publisher) proves it is exactly the approved change on its
 *     approved base, fetches, pushes it once without force, and closes the record PUBLISHED_VERIFIED; then the
 *     ordinary post-publication closure (Graphify + health) runs for the pushed HEAD. The same proof covers a micro
 *     batch (AyasMicroBatchRecovery) and, in AyasUpdateApplyRunner, an "Uygula" whose push failed.
 *
 *  2. Graphify self-heal. A HEAD whose graph is still not fresh well after its commit — its publication closure
 *     failed or never ran — gets the closure's own Graphify refresh and verification, a bounded number of times.
 *     Without it, "Graphify ESKİ / KISMEN BOZUK" and the paused graph-dependent discovery waited for a human.
 *
 * Neither step approves, re-runs, rewrites, resets or forces anything. `AYAS_PUBLICATION_RECOVERY=0` and
 * `AYAS_GRAPH_SELF_HEAL=0` turn them off.
 */

export function ayasGateRoot(repoRoot: string): string {
  return path.join(repoRoot, "data", "brain", "self-improvement");
}

/* ------------------------------------------------------------ 1. recovery --- */

export function countAyasOpenRecoveries(inbox: AyasApprovalInboxHandle, batchStore?: AyasMicroBatchStoreHandle): number {
  return inbox.load().proposals.filter((proposal) => proposal.status === "RECOVERY_REQUIRED").length + (batchStore ? countAyasOpenMicroBatchRecoveries(batchStore) : 0);
}

export interface AyasPublicationRecoveryRun {
  readonly result: AyasRecoveryReconciliationResult;
  /** Present after a push: the post-publication closure of the pushed HEAD. */
  readonly closure?: { readonly ok: true } | { readonly ok: false; readonly code: string; readonly message: string };
}

export interface AyasPublicationRecoveryDeps {
  readonly repoRoot: string;
  readonly now: string;
  readonly inbox?: AyasApprovalInboxHandle;
  readonly remoteName?: string;
  /** Test seams; production fetches, pushes and closes for real. */
  readonly fetchRemote?: (repoRoot: string, remoteName: string, branch: string) => boolean;
  readonly push?: (repoRoot: string, remoteName: string, branch: string) => void;
  readonly closure?: (head: string) => void;
  readonly probe?: Parameters<typeof reconcileAyasRecoveryRequiredProposals>[0]["probe"];
  readonly artifactStore?: AyasPatchArtifactStore;
  readonly gateRoot?: string;
  /** The micro-batch lane (2026-11-05): its RECOVERY_REQUIRED batches get the same proof and push. */
  readonly microBatchStore?: AyasMicroBatchStoreHandle;
  readonly microItemStore?: AyasMicroItemStore;
}

/** Returns undefined when no record waits for recovery (no Git call is made then). */
export function runAyasPublicationRecovery(deps: AyasPublicationRecoveryDeps): AyasPublicationRecoveryRun | undefined {
  const inbox = deps.inbox ?? createAyasApprovalInboxStore();
  const batchStore = deps.microBatchStore;
  const proposalsOpen = countAyasOpenRecoveries(inbox) > 0;
  const batchesOpen = batchStore !== undefined && countAyasOpenMicroBatchRecoveries(batchStore) > 0;
  if (!proposalsOpen && !batchesOpen) return undefined;
  const remoteName = deps.remoteName ?? "origin";
  const fetchRemote = deps.fetchRemote ?? ((root, remote, branch) => fetchAyasRemoteBranch(root, remote, branch));
  const push = deps.push ?? ((root, remote, branch) => { pushAyasBranchWithRetry(root, remote, branch); });
  const artifacts = deps.artifactStore ?? createAyasPatchArtifactStore();
  const publisher = {
    fetch: ({ repoRoot, remoteName: remote, branch }: { readonly repoRoot: string; readonly remoteName: string; readonly branch: string }) => fetchRemote(repoRoot, remote, branch),
    push: ({ repoRoot, remoteName: remote, branch }: { readonly repoRoot: string; readonly remoteName: string; readonly branch: string }) => {
      try { push(repoRoot, remote, branch); return { ok: true }; } catch (error) { return { ok: false, message: ayasGitFailureMessage(error) }; }
    },
  };
  const pass = (lane: { readonly inbox: AyasApprovalInboxHandle; readonly artifactStore: AyasPatchArtifactStore; readonly publicationOperation?: (id: string) => string }) => reconcileAyasRecoveryRequiredProposals({
    repoRoot: deps.repoRoot, inbox: lane.inbox, now: deps.now, remoteName, artifactStore: lane.artifactStore, publisher,
    ...(deps.gateRoot ? { gateRoot: deps.gateRoot } : {}),
    ...(deps.probe ? { probe: deps.probe } : {}),
    ...(lane.publicationOperation ? { publicationOperation: lane.publicationOperation } : {}),
  });
  // Proposals first, then batches: each pass pushes only a chain made entirely of its own proven commits, so a
  // proposal's and a batch's failed pushes stacked on each other stay blocked for a human (never seen so far).
  const parts = [
    ...(proposalsOpen ? [pass({ inbox, artifactStore: artifacts })] : []),
    ...(batchesOpen ? [pass({
      inbox: createAyasMicroBatchRecoveryInbox(batchStore!, deps.microItemStore ?? createAyasMicroItemStore()),
      artifactStore: createAyasMicroBatchArtifactView(batchStore!, artifacts), publicationOperation: ayasMicroBatchPublicationOperation,
    })] : []),
  ];
  const pushedHead = parts.map((part) => part.pushedHead).filter((head): head is string => !!head).at(-1);
  const skipped = parts.find((part) => part.skipped)?.skipped;
  const result: AyasRecoveryReconciliationResult = {
    ...(skipped ? { skipped } : {}),
    resolved: parts.flatMap((part) => part.resolved), unresolved: parts.flatMap((part) => part.unresolved),
    autoPushed: parts.flatMap((part) => part.autoPushed ?? []), ...(pushedHead ? { pushedHead } : {}),
  };
  if (!result.pushedHead) return { result };
  try {
    (deps.closure ?? ((head) => { closeAyasPostPublication(head, { repoRoot: deps.repoRoot, remoteName }); }))(result.pushedHead);
    return { result, closure: { ok: true } };
  } catch (error) {
    // The push is real and proven; a closure failure (e.g. an unrelated health warning) is left to step 2 and the owner's view.
    const code = error instanceof Error && "code" in error ? String((error as { readonly code: unknown }).code) : "AYAS_POST_PUBLICATION_CLOSURE_FAILED";
    return { result, closure: { ok: false, code, message: ayasGitFailureMessage(error) } };
  }
}

/* ------------------------------------------------------ 2. Graphify heal --- */

/** A publication's own closure finishes within minutes; only a graph still stale after this long is healed. */
export const AYAS_GRAPH_HEAL_GRACE_MS = 15 * 60_000;
export const AYAS_GRAPH_HEAL_MAX_ATTEMPTS_PER_HEAD = 3;
export const AYAS_GRAPH_HEAL_RETRY_SPACING_MS = 30 * 60_000;
const ATTEMPT_HISTORY = 30;

export interface AyasGraphHealAttempt { readonly head: string; readonly at: string; readonly ok: boolean; readonly detail: string }

export interface AyasGraphHealFacts {
  readonly enabled: boolean;
  readonly head: string;
  readonly graphFresh: boolean;
  readonly treeClean: boolean;
  readonly publicationInFlight: boolean;
  /** Committer time of HEAD; undefined when unreadable. */
  readonly headCommittedAtMs: number | undefined;
  readonly nowMs: number;
  readonly attempts: readonly AyasGraphHealAttempt[];
}

export type AyasGraphHealDecision = { readonly kind: "HEAL" } | { readonly kind: "NONE"; readonly reason: string };

export function decideAyasGraphHeal(facts: AyasGraphHealFacts): AyasGraphHealDecision {
  if (!facts.enabled) return { kind: "NONE", reason: "DISABLED" };
  if (facts.graphFresh) return { kind: "NONE", reason: "GRAPH_FRESH" };
  if (!facts.treeClean) return { kind: "NONE", reason: "DIRTY_TREE" };
  if (facts.publicationInFlight) return { kind: "NONE", reason: "PUBLICATION_IN_FLIGHT" };
  if (facts.headCommittedAtMs === undefined || facts.nowMs - facts.headCommittedAtMs < AYAS_GRAPH_HEAL_GRACE_MS) return { kind: "NONE", reason: "WITHIN_CLOSURE_WINDOW" };
  const mine = facts.attempts.filter((attempt) => attempt.head === facts.head);
  if (mine.length >= AYAS_GRAPH_HEAL_MAX_ATTEMPTS_PER_HEAD) return { kind: "NONE", reason: "ATTEMPTS_EXHAUSTED" };
  const last = mine.at(-1);
  if (last && facts.nowMs - Date.parse(last.at) < AYAS_GRAPH_HEAL_RETRY_SPACING_MS) return { kind: "NONE", reason: "RETRY_SPACING" };
  return { kind: "HEAL" };
}

/** The daemons' freshness rule (`ayas-discovery-daemon.ts`): graph present, no pending update marker, analyzed at HEAD, not stale. */
export function isAyasGraphFresh(repoRoot: string, head: string): boolean {
  try {
    const graphifyRoot = path.join(repoRoot, ".graphify");
    if (!fs.statSync(path.join(graphifyRoot, "graph.json")).isFile()) return false;
    if (fs.existsSync(path.join(graphifyRoot, "needs_update"))) return false;
    const branch = JSON.parse(fs.readFileSync(path.join(graphifyRoot, "branch.json"), "utf8")) as { readonly lastAnalyzedHead?: unknown; readonly stale?: unknown };
    return branch.lastAnalyzedHead === head && branch.stale === false;
  } catch { return false; }
}

function graphHealFile(storeRoot: string): string { return path.join(storeRoot, "graph-heal.json"); }

export function readAyasGraphHealAttempts(storeRoot: string): readonly AyasGraphHealAttempt[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(graphHealFile(storeRoot), "utf8")) as { readonly attempts?: unknown };
    return Array.isArray(parsed.attempts)
      ? parsed.attempts.filter((a): a is AyasGraphHealAttempt => typeof a?.head === "string" && typeof a?.at === "string" && typeof a?.ok === "boolean" && typeof a?.detail === "string")
      : [];
  } catch { return []; }
}

function recordAttempt(storeRoot: string, attempt: AyasGraphHealAttempt): void {
  const attempts = [...readAyasGraphHealAttempts(storeRoot), attempt].slice(-ATTEMPT_HISTORY);
  fs.mkdirSync(storeRoot, { recursive: true });
  const file = graphHealFile(storeRoot);
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify({ schemaVersion: 1, attempts }, null, 2)}\n`);
  fs.renameSync(temp, file);
}

const gitRead = (repoRoot: string, args: readonly string[]): string | undefined => {
  try { return execFileSync("git", [...args], { cwd: repoRoot, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return undefined; }
};

export function collectAyasGraphHealFacts(repoRoot: string, storeRoot: string, now: Date = new Date()): AyasGraphHealFacts {
  const head = gitRead(repoRoot, ["rev-parse", "HEAD"]) ?? "";
  const committedAt = Number(gitRead(repoRoot, ["log", "-1", "--format=%ct", "HEAD"]));
  return {
    enabled: process.env.AYAS_GRAPH_SELF_HEAL !== "0",
    head,
    graphFresh: head !== "" && isAyasGraphFresh(repoRoot, head),
    treeClean: gitRead(repoRoot, ["status", "--porcelain"]) === "",
    publicationInFlight: isAyasPublicationInFlight(ayasGateRoot(repoRoot), now.toISOString()),
    headCommittedAtMs: Number.isFinite(committedAt) && committedAt > 0 ? committedAt * 1000 : undefined,
    nowMs: now.getTime(),
    attempts: readAyasGraphHealAttempts(storeRoot),
  };
}

export interface AyasGraphHealDeps {
  readonly repoRoot: string;
  /** Where the attempt history lives (the update executor's store root). */
  readonly storeRoot: string;
  readonly now?: () => Date;
  /** Test seam; production runs the closure's own refresh and verification. */
  readonly refresh?: (head: string) => void;
}

/** Runs one heal for `head` and records it. */
export function runAyasGraphHeal(head: string, deps: AyasGraphHealDeps): AyasGraphHealAttempt {
  const now = deps.now ?? (() => new Date());
  let attempt: AyasGraphHealAttempt;
  try {
    (deps.refresh ?? ((expected) => { refreshAyasGraphifyForHead(expected, { repoRoot: deps.repoRoot }); }))(head);
    // The heal analysed the tree it found; it is evidence for `head` only if nothing moved meanwhile.
    const after = gitRead(deps.repoRoot, ["rev-parse", "HEAD"]);
    const clean = gitRead(deps.repoRoot, ["status", "--porcelain"]) === "";
    attempt = after === head && clean
      ? { head, at: now().toISOString(), ok: true, detail: "GRAPH_CURRENT" }
      : { head, at: now().toISOString(), ok: false, detail: after !== head ? `HEAD moved to ${after?.slice(0, 8)}` : "the refresh left the tree dirty" };
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String((error as { readonly code: unknown }).code) : "GRAPH_HEAL_FAILED";
    attempt = { head, at: now().toISOString(), ok: false, detail: `${code}: ${ayasGitFailureMessage(error).slice(0, 300)}` };
  }
  recordAttempt(deps.storeRoot, attempt);
  return attempt;
}
