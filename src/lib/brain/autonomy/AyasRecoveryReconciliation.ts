import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import type { AyasApprovalInboxHandle, AyasInboxProposal, AyasInboxRecoveryResolutionKind } from "./AyasApprovalInboxStore";
import { createAyasExecutionJournal, type AyasExecutionJournalEntry } from "./AyasExecutionJournal";
import { createAyasPatchArtifactStore, type AyasPatchArtifactStore } from "./AyasPatchArtifact";

/**
 * Closes `RECOVERY_REQUIRED` proposals whose outcome the durable record
 * already proves, so a failed attempt does not wait on the owner forever.
 *
 * `RECOVERY_REQUIRED` means "a mutation may have happened and nobody proved
 * what is left". This module only reads the proof that already exists:
 *
 *   1. ROLLBACK_VERIFIED: the attempt's latest runtime stability transaction
 *      is `ROLLED_BACK`, i.e. the guard verified the baseline restored.
 *   2. PUBLISHED_VERIFIED: the journal recorded a completed mutation, and a
 *      commit made inside the attempt's own time window, reachable from the
 *      remote branch, holds the approved content of every exact file.
 *   3. NO_MUTATION_REMAINS: the journal never recorded a completed mutation
 *      (the bounded writer restores its own writes on failure, and only a
 *      completed mutation can reach the commit step) and the exact files
 *      have no uncommitted change now.
 *
 * Anything else stays `RECOVERY_REQUIRED` with a reason code; a human
 * settles the repository (pushes the commit, reverts the change) and the
 * next tick proves it. Nothing is re-run, reserved or re-decided, and the
 * journal and stability ledgers are left untouched as the forensic record.
 *
 * One case no longer waits for a human (owner, 2026-11-05: "böyle hatalarda
 * sistem kendi kendini düzeltsin"): the publication committed the approved
 * change but its push failed, so the commit exists only here. When a
 * `publisher` is supplied — only the update executor does; the discovery
 * child passes none and this module stays read-only there — the pass fetches
 * the remote branch and pushes once, never forced, but only if every commit
 * between the remote branch and HEAD is the proven commit of an open
 * recovery (approved content, inside its attempt's window, parent = its
 * approved base, in order on top of the remote). Anything else in between is
 * someone else's work and is never published by this pass.
 *
 * Both ledgers are parsed here read-only instead of importing their stores:
 * the stability store's types pull the snapshot collector (a process
 * spawner) into whatever imports it, and this runs in the discovery child.
 */
export type AyasRecoveryUnresolvedReason =
  | "NO_JOURNAL"
  | "MUTATION_NOT_PUBLISHED"
  | "UNCOMMITTED_CHANGES"
  | "ARTIFACT_UNVERIFIABLE"
  /** The proof held but the inbox refused the close (e.g. a legacy row without its RECOVERY_REQUIRED reservation). */
  | "STORE_REFUSED"
  /** The proven local commit could not be pushed by the pass: something else sits between the remote branch and HEAD, the checkout is not on that branch, or the tree is dirty. */
  | "AUTO_PUSH_BLOCKED"
  /** The remote could not be reached (fetch failed); the next pass tries again. */
  | "AUTO_PUSH_DEFERRED"
  /** The push was attempted and still failed after its bounded retries; the next pass tries again. */
  | "AUTO_PUSH_FAILED"
  /** The push reported success, yet the remote branch does not hold the proven commit. */
  | "AUTO_PUSH_UNVERIFIED";

export interface AyasRecoveryCommit { readonly sha: string; readonly committedAt: string }

/** The repository facts the rules need; production reads them with Git. */
export interface AyasRecoveryRepoProbe {
  /** With no files, the whole working tree. */
  hasUncommittedChanges(files: readonly string[]): boolean;
  /** Commits reachable from `ref` but not from `baseHead` that touch any of `files`; empty when `ref` does not exist. */
  commitsTouching(ref: string, baseHead: string, files: readonly string[]): readonly AyasRecoveryCommit[];
  /** Exact content of `file` at `commit`, or `undefined` when it does not exist there. */
  readFileAt(commit: string, file: string): string | undefined;
  /** Only the publishing pass reads these. */
  head?(): string | undefined;
  currentBranch?(): string | undefined;
  /** The commit a ref points at, or `undefined` when it does not exist. */
  resolve?(ref: string): string | undefined;
  /** The parents of `commit`, in order. */
  parentsOf?(commit: string): readonly string[];
  /** Commits reachable from `to` but not from `from`, oldest first. */
  between?(from: string, to: string): readonly string[];
}

/**
 * The only mutations the publishing pass can make: refresh the remote-tracking
 * ref, and one non-force `git push <remote> <branch>` (with the publication
 * lanes' own bounded transient retry).
 */
export interface AyasRecoveryPublisher {
  fetch(input: { readonly repoRoot: string; readonly remoteName: string; readonly branch: string }): boolean;
  push(input: { readonly repoRoot: string; readonly remoteName: string; readonly branch: string }): { readonly ok: boolean; readonly message?: string };
}

export interface AyasRecoveryReconciliationDeps {
  readonly repoRoot: string;
  readonly inbox: AyasApprovalInboxHandle;
  readonly now: string;
  /** Package C's gate root; defaults to the production `data/brain/self-improvement`. */
  readonly gateRoot?: string;
  readonly remoteName?: string;
  readonly artifactStore?: AyasPatchArtifactStore;
  readonly probe?: AyasRecoveryRepoProbe;
  /** Present only in the update executor: may complete a failed push of a proven commit. */
  readonly publisher?: AyasRecoveryPublisher;
}

export interface AyasRecoveryReconciliationResult {
  /** Set when nothing was examined because a publication may be writing the same ledgers right now. */
  readonly skipped?: "PUBLICATION_ACTIVE";
  readonly resolved: readonly { readonly proposalId: string; readonly kind: AyasInboxRecoveryResolutionKind; readonly evidence: string }[];
  readonly unresolved: readonly { readonly proposalId: string; readonly reason: AyasRecoveryUnresolvedReason }[];
  /** Only with a publisher: the proposals whose commit this pass pushed and then proved on the remote. */
  readonly autoPushed?: readonly { readonly proposalId: string; readonly commitSha: string }[];
  /** Only with a publisher: the pushed HEAD, for the caller's post-publication closure. */
  readonly pushedHead?: string;
}

/** Same string `AyasGuardedPublication.ayasPublicationOperationName("proposal", id)` writes (pinned by its smoke). */
export function ayasProposalPublicationOperation(proposalId: string): string {
  return `ayas-publication:proposal:${proposalId}`;
}

/** Stability states that end a transaction; anything else is a publication in flight. */
const TERMINAL_STABILITY_STATES: ReadonlySet<string> = new Set(["COMPLETED", "ROLLED_BACK", "FAILED", "ABANDONED", "RECOVERY_REQUIRED"]);
/**
 * How long an open gate or unfinished stability transaction counts as a
 * publication in flight. A real one (typecheck, commit, push, closure) ends
 * well inside this; older leftovers of a crashed process belong to the
 * guard's own crash sweep and must not hold this reconciliation forever.
 */
const AYAS_RECOVERY_ACTIVE_WINDOW_MS = 2 * 60 * 60_000;

interface StabilityRow { readonly transactionId: string; readonly operation: string; readonly state: string; readonly createdAt: string; readonly lastUpdatedAt: string }

/** Read-only parse of the guard's ledger; a missing file is no history, an unreadable one throws (never "no history"). */
function readStabilityRows(gateRoot: string): readonly StabilityRow[] {
  const file = path.join(gateRoot, "stability", "stability-transactions.json");
  let raw: string;
  try { raw = fs.readFileSync(file, "utf8"); } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return [];
    throw error;
  }
  const parsed = JSON.parse(raw) as { readonly transactions?: unknown };
  if (!Array.isArray(parsed.transactions)) throw new Error("AYAS_RECOVERY_STABILITY_LEDGER_INVALID");
  return parsed.transactions.map((row: Partial<StabilityRow>) => {
    if (typeof row?.transactionId !== "string" || typeof row.operation !== "string" || typeof row.state !== "string" || typeof row.createdAt !== "string" || typeof row.lastUpdatedAt !== "string") throw new Error("AYAS_RECOVERY_STABILITY_LEDGER_INVALID");
    return { transactionId: row.transactionId, operation: row.operation, state: row.state, createdAt: row.createdAt, lastUpdatedAt: row.lastUpdatedAt };
  });
}

const recent = (at: unknown, now: string): boolean => typeof at === "string" && Date.parse(now) - Date.parse(at) < AYAS_RECOVERY_ACTIVE_WINDOW_MS;

/** Package C's isolated gate is open or mid-transition (absent or unreadable means no execution is running). */
function gateBusy(gateRoot: string, now: string): boolean {
  try {
    const gate = JSON.parse(fs.readFileSync(path.join(gateRoot, "execution", "gate.json"), "utf8")) as { readonly state?: unknown; readonly updatedAt?: unknown };
    return typeof gate.state === "string" && gate.state !== "CLOSED" && recent(gate.updatedAt, now);
  } catch { return false; }
}

/**
 * A publication may be writing the ledgers, the commit or `.graphify` right now: Package C's gate is open, or a
 * stability transaction is unfinished and recent. Shared with the update executor's Graphify self-heal, which must
 * not refresh the graph under a publication's own closure. An unreadable stability ledger counts as active.
 */
export function isAyasPublicationInFlight(gateRoot: string, now: string): boolean {
  if (gateBusy(gateRoot, now)) return true;
  try {
    return readStabilityRows(gateRoot).some((row) => !TERMINAL_STABILITY_STATES.has(row.state) && recent(row.lastUpdatedAt, now));
  } catch { return true; }
}

export function createAyasGitRecoveryProbe(repoRoot: string): AyasRecoveryRepoProbe {
  const git = (args: readonly string[]): string => execFileSync("git", [...args], { cwd: repoRoot, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"], maxBuffer: 20_000_000 });
  const tryGit = (args: readonly string[]): string | undefined => { try { return git(args).trim(); } catch { return undefined; } };
  return {
    hasUncommittedChanges: (files) => git(["status", "--porcelain", "--untracked-files=all", "--", ...files]).trim().length > 0,
    commitsTouching(ref, baseHead, files) {
      let out: string;
      try { out = git(["log", "--format=%H %cI", ref, `^${baseHead}`, "--", ...files]); } catch { return []; }
      return out.split("\n").filter(Boolean).map((line) => { const [sha = "", committedAt = ""] = line.split(" "); return { sha, committedAt }; });
    },
    readFileAt(commit, file) {
      try { return git(["show", `${commit}:${file}`]); } catch { return undefined; }
    },
    head: () => tryGit(["rev-parse", "--verify", "HEAD"]),
    currentBranch: () => tryGit(["symbolic-ref", "--quiet", "--short", "HEAD"]),
    resolve: (ref) => tryGit(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]),
    parentsOf: (commit) => (tryGit(["rev-list", "--parents", "-n", "1", commit]) ?? "").split(/\s+/).filter(Boolean).slice(1),
    between: (from, to) => (tryGit(["rev-list", "--reverse", `${from}..${to}`]) ?? "").split(/\s+/).filter(Boolean),
  };
}

function latestRecoveryJournal(entries: readonly AyasExecutionJournalEntry[], proposalId: string): AyasExecutionJournalEntry | undefined {
  return entries.filter((entry) => entry.proposalId === proposalId && entry.phase === "RECOVERY_REQUIRED").sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)).at(-1);
}

/** A commit belongs to the attempt when Git dated it between the attempt's start and its recovery record (Git dates have whole seconds). */
function withinAttempt(commit: AyasRecoveryCommit, journal: AyasExecutionJournalEntry): boolean {
  const at = Date.parse(commit.committedAt);
  return Number.isFinite(at) && at >= Math.floor(Date.parse(journal.startedAt) / 1000) * 1000 && at <= Date.parse(journal.updatedAt) + 1000;
}

type AyasRecoverySettlement = { readonly kind: AyasInboxRecoveryResolutionKind; readonly evidence: string } | AyasRecoveryUnresolvedReason;

export function reconcileAyasRecoveryRequiredProposals(deps: AyasRecoveryReconciliationDeps): AyasRecoveryReconciliationResult {
  const publishing = deps.publisher !== undefined;
  const empty = (): AyasRecoveryReconciliationResult => (publishing ? { resolved: [], unresolved: [], autoPushed: [] } : { resolved: [], unresolved: [] });
  const pending = deps.inbox.load().proposals.filter((proposal) => proposal.status === "RECOVERY_REQUIRED");
  if (!pending.length) return empty();
  const gateRoot = deps.gateRoot ?? path.join(deps.repoRoot, "data", "brain", "self-improvement");
  const stability = readStabilityRows(gateRoot);
  // A publication in flight writes these same ledgers; the next tick looks again.
  if (gateBusy(gateRoot, deps.now) || stability.some((row) => !TERMINAL_STABILITY_STATES.has(row.state) && recent(row.lastUpdatedAt, deps.now))) return { ...empty(), skipped: "PUBLICATION_ACTIVE" };

  const journal = createAyasExecutionJournal({ rootDir: gateRoot }).list();
  const probe = deps.probe ?? createAyasGitRecoveryProbe(deps.repoRoot);
  const artifacts = deps.artifactStore ?? createAyasPatchArtifactStore();
  const remoteName = deps.remoteName ?? "origin";
  const resolved: { proposalId: string; kind: AyasInboxRecoveryResolutionKind; evidence: string }[] = [];
  const unresolved: { proposalId: string; reason: AyasRecoveryUnresolvedReason }[] = [];
  /** The proposals whose approved commit exists only locally, with that commit (filled by `settle`). */
  const localOnly = new Map<string, { readonly proposal: AyasInboxProposal; readonly sha: string; readonly proven: (ref: string) => boolean }>();

  const settle = (proposal: AyasInboxProposal): AyasRecoverySettlement => {
    const latest = stability.filter((row) => row.operation === ayasProposalPublicationOperation(proposal.proposalId)).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1);
    if (latest?.state === "ROLLED_BACK") return { kind: "ROLLBACK_VERIFIED", evidence: latest.transactionId };

    const entry = latestRecoveryJournal(journal, proposal.proposalId);
    if (!entry) return "NO_JOURNAL";
    if (!entry.mutationCompletedAt && !entry.mutationFingerprint) {
      return probe.hasUncommittedChanges(proposal.exactFiles) ? "UNCOMMITTED_CHANGES" : { kind: "NO_MUTATION_REMAINS", evidence: entry.executionId };
    }

    let replacements: readonly { readonly filePath: string; readonly content: string }[];
    try { replacements = artifacts.loadVerified(proposal.patchArtifactId ?? "").replacements; } catch { return "ARTIFACT_UNVERIFIABLE"; }
    if (!replacements.length || JSON.stringify(replacements.map((r) => r.filePath).sort()) !== JSON.stringify([...proposal.exactFiles].sort())) return "ARTIFACT_UNVERIFIABLE";
    /** The attempt's own commits reachable from `ref`: inside its window, holding the approved content of every exact file. */
    const ownCommits = (ref: string): readonly AyasRecoveryCommit[] => probe.commitsTouching(ref, proposal.baseHead, proposal.exactFiles)
      .filter((commit) => withinAttempt(commit, entry) && replacements.every((r) => probe.readFileAt(commit.sha, r.filePath) === r.content));
    const own = ownCommits(`${remoteName}/${proposal.baseBranch}`)[0];
    if (own) return { kind: "PUBLISHED_VERIFIED", evidence: own.sha };
    if (publishing) {
      // The publication's own commit sits directly on its approved base; any other shape is not this attempt's.
      const local = ownCommits("HEAD").find((commit) => JSON.stringify(probe.parentsOf?.(commit.sha) ?? []) === JSON.stringify([proposal.baseHead]));
      if (local) localOnly.set(proposal.proposalId, { proposal, sha: local.sha, proven: (ref) => ownCommits(ref).some((commit) => commit.sha === local.sha) });
    }
    return "MUTATION_NOT_PUBLISHED";
  };

  const outcomes = new Map<string, AyasRecoverySettlement>(pending.map((proposal) => [proposal.proposalId, settle(proposal)]));
  let autoPushed: { proposalId: string; commitSha: string }[] | undefined;
  let pushedHead: string | undefined;
  if (deps.publisher && localOnly.size) {
    const pass = publishProvenLocalCommits(deps, deps.publisher, probe, remoteName, [...localOnly.values()]);
    for (const [proposalId, outcome] of pass.outcomes) outcomes.set(proposalId, outcome);
    autoPushed = pass.autoPushed;
    pushedHead = pass.pushedHead;
  }

  for (const proposal of pending) {
    const outcome = outcomes.get(proposal.proposalId)!;
    if (typeof outcome === "string") { unresolved.push({ proposalId: proposal.proposalId, reason: outcome }); continue; }
    // One refused row must not hold back the others; it stays open with its reason.
    try { deps.inbox.resolveRecovery(proposal.proposalId, outcome, deps.now); }
    catch { unresolved.push({ proposalId: proposal.proposalId, reason: "STORE_REFUSED" }); continue; }
    resolved.push({ proposalId: proposal.proposalId, ...outcome });
  }
  if (!publishing) return { resolved, unresolved };
  // A pushed commit whose record the inbox then refused to close is still reported as pushed: it is on the remote.
  return { resolved, unresolved, autoPushed: autoPushed ?? [], ...(pushedHead ? { pushedHead } : {}) };
}

/**
 * Completes failed pushes: fetch, check that the remote branch is an ancestor of HEAD and that every commit in
 * between is one of `candidates`' proven commits in parent order, then push the branch once. Returns the new
 * outcome of each candidate.
 */
function publishProvenLocalCommits(
  deps: AyasRecoveryReconciliationDeps,
  publisher: AyasRecoveryPublisher,
  probe: AyasRecoveryRepoProbe,
  remoteName: string,
  candidates: readonly { readonly proposal: AyasInboxProposal; readonly sha: string; readonly proven: (ref: string) => boolean }[],
): { readonly outcomes: ReadonlyMap<string, AyasRecoverySettlement>; readonly autoPushed: { proposalId: string; commitSha: string }[]; readonly pushedHead?: string } {
  const outcomes = new Map<string, AyasRecoverySettlement>();
  const autoPushed: { proposalId: string; commitSha: string }[] = [];
  const all = (reason: AyasRecoveryUnresolvedReason) => { for (const candidate of candidates) outcomes.set(candidate.proposal.proposalId, reason); return { outcomes, autoPushed }; };

  const branch = probe.currentBranch?.();
  const head = probe.head?.();
  if (!branch || !head || candidates.some((candidate) => candidate.proposal.baseBranch !== branch)) return all("AUTO_PUSH_BLOCKED");
  if (probe.resolve?.(`refs/heads/${branch}`) !== head || probe.hasUncommittedChanges([])) return all("AUTO_PUSH_BLOCKED");
  const remoteRef = `${remoteName}/${branch}`;
  if (!publisher.fetch({ repoRoot: deps.repoRoot, remoteName, branch })) return all("AUTO_PUSH_DEFERRED");

  // Someone may have published them meanwhile (the other PC, a later publication that carried them along).
  const stillLocal = candidates.filter((candidate) => {
    if (!candidate.proven(remoteRef)) return true;
    outcomes.set(candidate.proposal.proposalId, { kind: "PUBLISHED_VERIFIED", evidence: candidate.sha });
    return false;
  });
  if (!stillLocal.length) return { outcomes, autoPushed };

  const remoteHead = probe.resolve?.(remoteRef);
  const chain = remoteHead ? probe.between?.(remoteHead, head) ?? [] : [];
  const bySha = new Map(stillLocal.map((candidate) => [candidate.sha, candidate]));
  // HEAD must be the remote plus exactly these commits, each on the one before it; the remote holds nothing HEAD lacks.
  const exact = remoteHead !== undefined && chain.length === stillLocal.length && chain.at(-1) === head
    && (probe.between?.(head, remoteHead) ?? ["?"]).length === 0
    && chain.every((sha, index) => bySha.has(sha) && JSON.stringify(probe.parentsOf?.(sha) ?? []) === JSON.stringify([index === 0 ? remoteHead : chain[index - 1]]));
  if (!exact) {
    for (const candidate of stillLocal) outcomes.set(candidate.proposal.proposalId, "AUTO_PUSH_BLOCKED");
    return { outcomes, autoPushed };
  }

  const push = publisher.push({ repoRoot: deps.repoRoot, remoteName, branch });
  if (!push.ok) {
    for (const candidate of stillLocal) outcomes.set(candidate.proposal.proposalId, "AUTO_PUSH_FAILED");
    return { outcomes, autoPushed };
  }
  for (const candidate of stillLocal) {
    if (candidate.proven(remoteRef)) {
      outcomes.set(candidate.proposal.proposalId, { kind: "PUBLISHED_VERIFIED", evidence: candidate.sha });
      autoPushed.push({ proposalId: candidate.proposal.proposalId, commitSha: candidate.sha });
    } else outcomes.set(candidate.proposal.proposalId, "AUTO_PUSH_UNVERIFIED");
  }
  return { outcomes, autoPushed, pushedHead: head };
}
