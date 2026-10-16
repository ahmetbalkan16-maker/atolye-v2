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
  | "STORE_REFUSED";

export interface AyasRecoveryCommit { readonly sha: string; readonly committedAt: string }

/** The repository facts the rules need; production reads them with Git. */
export interface AyasRecoveryRepoProbe {
  hasUncommittedChanges(files: readonly string[]): boolean;
  /** Commits reachable from `ref` but not from `baseHead` that touch any of `files`; empty when `ref` does not exist. */
  commitsTouching(ref: string, baseHead: string, files: readonly string[]): readonly AyasRecoveryCommit[];
  /** Exact content of `file` at `commit`, or `undefined` when it does not exist there. */
  readFileAt(commit: string, file: string): string | undefined;
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
}

export interface AyasRecoveryReconciliationResult {
  /** Set when nothing was examined because a publication may be writing the same ledgers right now. */
  readonly skipped?: "PUBLICATION_ACTIVE";
  readonly resolved: readonly { readonly proposalId: string; readonly kind: AyasInboxRecoveryResolutionKind; readonly evidence: string }[];
  readonly unresolved: readonly { readonly proposalId: string; readonly reason: AyasRecoveryUnresolvedReason }[];
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

export function createAyasGitRecoveryProbe(repoRoot: string): AyasRecoveryRepoProbe {
  const git = (args: readonly string[]): string => execFileSync("git", [...args], { cwd: repoRoot, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"], maxBuffer: 20_000_000 });
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

export function reconcileAyasRecoveryRequiredProposals(deps: AyasRecoveryReconciliationDeps): AyasRecoveryReconciliationResult {
  const pending = deps.inbox.load().proposals.filter((proposal) => proposal.status === "RECOVERY_REQUIRED");
  if (!pending.length) return { resolved: [], unresolved: [] };
  const gateRoot = deps.gateRoot ?? path.join(deps.repoRoot, "data", "brain", "self-improvement");
  const stability = readStabilityRows(gateRoot);
  // A publication in flight writes these same ledgers; the next tick looks again.
  if (gateBusy(gateRoot, deps.now) || stability.some((row) => !TERMINAL_STABILITY_STATES.has(row.state) && recent(row.lastUpdatedAt, deps.now))) return { skipped: "PUBLICATION_ACTIVE", resolved: [], unresolved: [] };

  const journal = createAyasExecutionJournal({ rootDir: gateRoot }).list();
  const probe = deps.probe ?? createAyasGitRecoveryProbe(deps.repoRoot);
  const artifacts = deps.artifactStore ?? createAyasPatchArtifactStore();
  const remoteName = deps.remoteName ?? "origin";
  const resolved: { proposalId: string; kind: AyasInboxRecoveryResolutionKind; evidence: string }[] = [];
  const unresolved: { proposalId: string; reason: AyasRecoveryUnresolvedReason }[] = [];

  const settle = (proposal: AyasInboxProposal): { readonly kind: AyasInboxRecoveryResolutionKind; readonly evidence: string } | AyasRecoveryUnresolvedReason => {
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
    const own = probe.commitsTouching(`${remoteName}/${proposal.baseBranch}`, proposal.baseHead, proposal.exactFiles)
      .find((commit) => withinAttempt(commit, entry) && replacements.every((r) => probe.readFileAt(commit.sha, r.filePath) === r.content));
    return own ? { kind: "PUBLISHED_VERIFIED", evidence: own.sha } : "MUTATION_NOT_PUBLISHED";
  };

  for (const proposal of pending) {
    const outcome = settle(proposal);
    if (typeof outcome === "string") { unresolved.push({ proposalId: proposal.proposalId, reason: outcome }); continue; }
    // One refused row must not hold back the others; it stays open with its reason.
    try { deps.inbox.resolveRecovery(proposal.proposalId, outcome, deps.now); }
    catch { unresolved.push({ proposalId: proposal.proposalId, reason: "STORE_REFUSED" }); continue; }
    resolved.push({ proposalId: proposal.proposalId, ...outcome });
  }
  return { resolved, unresolved };
}
