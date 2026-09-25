import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { createAyasApprovalInboxStore, isAyasProposalApprovalReady, type AyasApprovalInboxHandle, type AyasInboxProposal } from "./AyasApprovalInboxStore";
import { executeAyasApprovedProposalWith, AyasProposalExecutionError } from "./AyasProposalExecutionService";
import { createAyasPatchArtifactStore, type AyasPatchArtifactStore } from "./AyasPatchArtifact";
import { AyasBatchGraphifyCheckError } from "./AyasBatchGraphifyCheck";
import { createAyasGraphifyEvidenceStore, checkAyasItemWithGraphifyEvidenced, type AyasGraphifyEvidenceStore } from "./AyasGraphifyEvidenceStore";
import { AYAS_PATCH_ARTIFACT_MUTATION_KIND } from "./AyasNovelPatchDiscovery";
import { runGuardedAyasPublication, type AyasGuardedPublicationGuardDeps } from "./AyasGuardedPublication";
import { closeAyasPostPublication } from "./AyasPostPublicationClosure";
import { finalizeAyasDeferredPublication, markAyasDeferredPublicationRecoveryRequired } from "./AyasDeferredPublicationFinalizer";
import { classifyAyasRuntimeImpact } from "./AyasProposalRuntimeImpact";
import { ayasTraceErrorCode, startAyasTrace, type AyasTraceHandle, type AyasTraceSpanHandle, type AyasTraceStore } from "../../ayas/trace/AyasUnifiedTrace";

/**
 * M20.7 — "ONAYLA VE UYGULA": the individual-PRIORITY_SAFE-proposal
 * equivalent of M18.1's "BATCH ONAYLA VE UYGULA". Before this module, an
 * individual proposal's ONLY path was the older two-step "ONAYLA" (decide)
 * → "YÜRÜT" (execute) flow (`decideAyasApproval` / `executeAyasApprovedProposal`
 * in `app/brain/actions.ts`) — and even after YÜRÜT, NOTHING staged,
 * committed, or pushed the resulting real-repo mutation; that was left to a
 * human doing it manually outside this system entirely. This module closes
 * that gap the same way M18.1 closed it for batches: ONE human action,
 * bound to the exact reviewed `proposalId` + `proposalHash` (which itself
 * already transitively binds baseHead/patchArtifactId/patchHash/exactFiles —
 * see `AyasApprovalInboxStore`'s own `AYAS_PROPOSAL_HASH_VOLATILE_FIELDS`),
 * collapses decide → Package C execution (unmodified
 * `AyasAutonomyDaemon.executeApproved`, via the existing, untouched
 * `AyasProposalExecutionService`) → per-file Graphify structural check
 * (durably evidenced) → post-execution validation (project TypeScript +
 * `git diff --check`) → exact-scope Git staging → ONE commit → push →
 * local==remote verification.
 *
 * Scope, deliberately narrow for this first rollout: only proposals whose
 * `mutationKind` is the patch-artifact kind (`AYAS_PATCH_ARTIFACT_MUTATION_KIND`)
 * are accepted — every currently-generator-backed PRIORITY_SAFE proposal
 * (M19's `error-code-contract-drift` / `diagnostic-quality-gap`) is exactly
 * this kind. A static-registry (`AyasMutationRegistry`) proposal has no
 * `graphifyImportCounts` contract to check against and is refused here,
 * left to the pre-existing manual ONAYLA→YÜRÜT path unchanged.
 */
export class AyasProposalApprovalError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "AyasProposalApprovalError";
    this.stack = undefined;
  }
}

export function defaultAyasProposalApprovalDeps(): AyasProposalApprovalDeps {
  const repoRoot = process.cwd();
  return { repoRoot, gateRoot: path.join(repoRoot, "data", "brain", "self-improvement"), inbox: createAyasApprovalInboxStore() };
}

export interface AyasProposalApprovalDeps {
  readonly repoRoot: string;
  readonly gateRoot: string;
  readonly remoteName?: string;
  readonly inbox: AyasApprovalInboxHandle;
  /** Observer-only test seam. Disabling tracing never changes approval or execution inputs. */
  readonly traceEnabled?: boolean;
  /** Observer-only test seam for failure isolation. Production uses the bounded memory store. */
  readonly traceStore?: AyasTraceStore;
  readonly artifactStore?: AyasPatchArtifactStore;
  readonly graphifyEvidenceStore?: AyasGraphifyEvidenceStore;
  /**
   * Runtime Stability Guard wiring. Production leaves this undefined: the
   * guard then binds to the same `repoRoot`, `inbox` and `gateRoot` this
   * publication itself uses, so it can never observe a different system than
   * the one it is supervising. Tests inject isolated stores and probes so no
   * scenario reads or writes real runtime state.
   */
  readonly stabilityGuard?: AyasGuardedPublicationGuardDeps;
  /** M21.1 — test-only crash-injection hooks. Never set in production. */
  readonly onJournalPhase?: (phase: import("./AyasExecutionJournal").AyasExecutionJournalPhase) => void;
  readonly onBeforeCommit?: () => void;
  readonly onAfterCommitBeforePush?: () => void;
  /** Test seam only. Production runs the one canonical post-push Graphify/health closure. */
  readonly postPublicationClosure?: (expectedHead: string) => void;
}

export type AyasProposalApprovalOutcome =
  | { readonly ok: true; readonly commitSha: string; readonly pushed: true; readonly changedFiles: readonly string[]; readonly graphifyEvidenceItemIds: readonly string[] }
  | { readonly ok: false; readonly code: string; readonly stage: "APPROVAL" | "STABILITY_GUARD" | "EXECUTION" | "POST_VALIDATION" | "STAGING" | "COMMIT" | "PUSH" | "POST_PUBLICATION_CLOSURE"; readonly message: string; readonly graphifyEvidenceItemIds: readonly string[] };

function git(repoRoot: string, args: readonly string[]): string {
  return execFileSync("git", [...args], { cwd: repoRoot, encoding: "utf8", windowsHide: true }).trim();
}

/** Reverts every file in `files` to its state at HEAD — see the identical, independently-derived helper in `AyasMicroBatchApprovalService.ts` for the full rationale (nothing is committed yet at the point this runs, so HEAD still reflects the pre-mutation state; a genuinely new file has no HEAD blob and is deleted instead). */
function revertToHead(repoRoot: string, files: readonly string[]): void {
  for (const f of files) {
    try {
      execFileSync("git", ["checkout", "HEAD", "--", f], { cwd: repoRoot, encoding: "utf8", windowsHide: true });
    } catch {
      const abs = path.join(repoRoot, f);
      if (fs.existsSync(abs)) fs.rmSync(abs, { force: true });
    }
  }
}

function commitMessageFor(proposal: AyasInboxProposal): string {
  const isPureTests = proposal.exactFiles.every((f) => f.startsWith("scripts/smoke-"));
  const kind = isPureTests ? "test" : "chore";
  const lines = [
    `${kind}(ayas): apply approved priority-safe improvement`,
    "",
    "AYAS-governed individual proposal, human-approved as one unit (ONAYLA VE",
    "UYGULA), executed through Package C, Graphify-verified, and validated",
    "before publication.",
    "",
    `proposalId: ${proposal.proposalId}`,
    `proposalHash: ${proposal.proposalHash}`,
    "",
    "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>",
  ];
  return lines.join("\n");
}

/**
 * Shared precondition check for both publish entrypoints below — identical
 * except for which `status` the proposal must already be in. Re-derives the
 * proposal fresh from durable state; never trusts a caller-held copy.
 */
function loadAyasProposalForPublish(proposalId: string, approvedProposalHash: string, requiredStatus: "PENDING" | "APPROVED", deps: AyasProposalApprovalDeps): AyasInboxProposal {
  if (typeof proposalId !== "string" || !proposalId.trim()) throw new AyasProposalApprovalError("INVALID_INPUT", "proposalId is required");
  if (typeof approvedProposalHash !== "string" || !approvedProposalHash.trim()) throw new AyasProposalApprovalError("INVALID_INPUT", "approvedProposalHash is required");
  const proposal = deps.inbox.load().proposals.find((p) => p.proposalId === proposalId);
  if (!proposal) throw new AyasProposalApprovalError("NOT_FOUND", "proposal not found");
  if (proposal.status !== requiredStatus) throw new AyasProposalApprovalError("NOT_READY", `proposal status is ${proposal.status}, not ${requiredStatus}`);
  if (proposal.proposalHash !== approvedProposalHash) throw new AyasProposalApprovalError("PROPOSAL_HASH_MISMATCH", "the proposal changed since it was shown for review — authorization refused");
  if (proposal.safetyClassification !== "SAFE") throw new AyasProposalApprovalError("NOT_SAFE", "proposal is not SAFE-classified — never eligible for single-approval execution");
  if (proposal.mutationKind !== AYAS_PATCH_ARTIFACT_MUTATION_KIND || !proposal.patchArtifactId) {
    throw new AyasProposalApprovalError("NOT_PATCH_ARTIFACT", "single-approval execution is only wired for patch-artifact-backed proposals");
  }
  // Runtime-impact eligibility is checked HERE, before any decision is minted,
  // rather than inside the publish pipeline: `approveAndExecuteAyasProposal`
  // calls `inbox.decide()` before publishing, so a refusal raised later would
  // leave a durable APPROVE for a proposal this lane can never publish. The
  // classification is a pure function of `exactFiles` (already bound into
  // `proposalHash`), so it cannot disagree with the guard's own re-derivation.
  const impact = classifyAyasRuntimeImpact(proposal.exactFiles);
  if (!impact.publishable) {
    throw new AyasProposalApprovalError("RUNTIME_IMPACT_NOT_PUBLISHABLE", `declared runtime impact ${impact.impactClass} is never eligible for one-click publication — ${impact.summary}`);
  }
  return proposal;
}

/**
 * The one entrypoint for "ONAYLA VE UYGULA". Accepts only a proposalId and
 * the exact proposalHash the human reviewed. Every other input is
 * re-derived from durable state.
 */
export async function approveAndExecuteAyasProposal(proposalId: string, approvedProposalHash: string, deps: AyasProposalApprovalDeps): Promise<AyasProposalApprovalOutcome> {
  const trace = startAyasApprovalTrace(deps);
  const approvalSpan = trace.startSpan("approval", "ayas-approval", "decide");
  let approved: AyasInboxProposal;
  try {
    // Deliberately NO pre-emptive staleness reconciliation here (unlike the
    // older two-step `decideAyasApproval` action, where decide and execute can
    // be arbitrarily far apart in time): decide and execute happen inside the
    // SAME call below, and `executeAyasApprovedProposalWith` already
    // reconciles staleness internally, immediately before executing — mirrors
    // `AyasMicroBatchApprovalService`, which likewise leaves HEAD-drift
    // detection to Package C's own execution-time revalidation rather than a
    // separate pre-check, so a HEAD-drift failure here is consistently
    // reported at the EXECUTION stage, not thrown before it.
    loadAyasProposalForPublish(proposalId, approvedProposalHash, "PENDING", deps);

    // --- decide: one durable APPROVE decision ---
    deps.inbox.decide(proposalId, "APPROVE", new Date().toISOString());
    approved = deps.inbox.load().proposals.find((p) => p.proposalId === proposalId)!;
    if (!isAyasProposalApprovalReady(approved)) throw new AyasProposalApprovalError("NOT_READY", "proposal did not reach an approval-ready state after decide");
  } catch (error) {
    traceAyasApprovalRefusal(trace, approvalSpan, error);
    throw error;
  }
  approvalSpan.end("ok");

  return publishObservedAyasApprovedProposal(approved, deps, trace);
}

/**
 * The owner-approval-model resume entrypoint (Step 6 of the durable
 * one-click correction): publishes a proposal that is ALREADY durably
 * `APPROVED` — i.e. the owner already clicked ONAYLA while live execution
 * was off (`AyasAutonomousExecutionGate.decideAyasOwnerApproval`'s
 * `APPROVED_PENDING_EXECUTION` path already called `inbox.decide()`). Unlike
 * `approveAndExecuteAyasProposal` above, this never calls `decide()` itself
 * — recording the owner's decision and publishing it are now two separate
 * moments in time, potentially across a process restart, so this function
 * only ever consumes an approval that already exists; it can never mint one.
 * Reuses the exact same `publishAyasApprovedProposal` pipeline (execute →
 * Graphify → validate → stage → commit → push) as the immediate-execution
 * path, so there is exactly one mutation/publish implementation, not two.
 *
 * Callers are responsible for only ever invoking this on a proposal whose
 * APPROVE came from the owner-approval model specifically (see
 * `AyasOwnerApprovalResume.ts`, which is the only intended caller) — this
 * function itself only checks that a decidable APPROVED state exists, the
 * same authority boundary `approveAndExecuteAyasProposal` already enforces.
 */
export async function publishAlreadyOwnerApprovedAyasProposal(proposalId: string, approvedProposalHash: string, deps: AyasProposalApprovalDeps): Promise<AyasProposalApprovalOutcome> {
  const trace = startAyasApprovalTrace(deps);
  const approvalSpan = trace.startSpan("approval", "ayas-approval", "resume");
  let approved: AyasInboxProposal;
  try {
    approved = loadAyasProposalForPublish(proposalId, approvedProposalHash, "APPROVED", deps);
    if (!isAyasProposalApprovalReady(approved)) throw new AyasProposalApprovalError("NOT_READY", "proposal is not in an approval-ready state");
  } catch (error) {
    traceAyasApprovalRefusal(trace, approvalSpan, error);
    throw error;
  }
  approvalSpan.end("ok");
  return publishObservedAyasApprovedProposal(approved, deps, trace);
}

/*
 * Unified Trace observers for both entrypoints. Write-only: nothing below is
 * read back, and every domain value or error passes through unchanged — only
 * the domain call itself sits inside each `try`, so a trace call can never
 * replace a result or an error.
 */
function startAyasApprovalTrace(deps: AyasProposalApprovalDeps): AyasTraceHandle {
  return startAyasTrace({ rootKind: "owner-approval", enabled: deps.traceEnabled !== false, ...(deps.traceStore ? { store: deps.traceStore } : {}) });
}

function traceAyasApprovalRefusal(trace: AyasTraceHandle, span: AyasTraceSpanHandle, error: unknown): void {
  // A domain refusal is a denial; anything unexpected (I/O, corrupt state) stays an error.
  const status = error instanceof AyasProposalApprovalError ? "denied" : "error";
  const code = ayasTraceErrorCode(error);
  span.end(status, undefined, code);
  trace.finish(status, code);
}

async function publishObservedAyasApprovedProposal(approved: AyasInboxProposal, deps: AyasProposalApprovalDeps, trace: AyasTraceHandle): Promise<AyasProposalApprovalOutcome> {
  const executionSpan = trace.startSpan("execution", "ayas-publication", "guarded-publish");
  let outcome: AyasProposalApprovalOutcome;
  try {
    outcome = await publishAyasApprovedProposal(approved, deps);
  } catch (error) {
    const code = ayasTraceErrorCode(error);
    executionSpan.end("error", undefined, code);
    trace.finish("error", code);
    throw error;
  }
  const status = outcome.ok ? "ok" : outcome.stage === "APPROVAL" || outcome.stage === "STABILITY_GUARD" ? "denied" : "error";
  const code = outcome.ok ? undefined : outcome.code;
  executionSpan.event("gate-result", status, undefined, code);
  executionSpan.end(status, undefined, code);
  trace.finish(status, code);
  return outcome;
}

/**
 * The canonical mutation boundary for an individually owner-approved
 * proposal: both public entrypoints above funnel through exactly this
 * function, so wiring the Runtime Stability Guard here — and only here —
 * makes a guarded publication the ONLY kind of publication this lane can
 * perform. There is no second path to `runAyasProposalPublishPipeline`.
 *
 * The pipeline itself is handed to the guard unmodified, as an opaque
 * callback. Its own staging/whitespace/commit/push discipline, its own
 * pre-commit recovery, and its own deliberate refusal to auto-reset after a
 * commit are all untouched — the guard supervises that pipeline, it does not
 * replace, retry or second-guess any part of it.
 */
async function publishAyasApprovedProposal(approved: AyasInboxProposal, deps: AyasProposalApprovalDeps): Promise<AyasProposalApprovalOutcome> {
  const guarded = await runGuardedAyasPublication<AyasProposalApprovalOutcome>({
    lane: "proposal",
    subjectId: approved.proposalId,
    exactFiles: approved.exactFiles,
    repoRoot: deps.repoRoot,
    gateRoot: deps.gateRoot,
    inbox: deps.inbox,
    publish: () => runAyasProposalPublishPipeline(approved, deps),
    ...(deps.stabilityGuard === undefined ? {} : { guard: deps.stabilityGuard }),
  });

  switch (guarded.state) {
    case "COMPLETED":
      return guarded.value;

    case "REFUSED":
      // Nothing was attempted: no mutation, no commit, no push.
      return { ok: false, code: "AYAS_PROPOSAL_STABILITY_GUARD_REFUSED", stage: "STABILITY_GUARD", message: guarded.reasons.join(" | "), graphifyEvidenceItemIds: [] };

    case "ROLLED_BACK":
      // The pipeline failed and the guard PROVED the baseline was restored, so
      // the lane's own structured failure is the whole truth — reported
      // unchanged, with its original code and stage.
      return guarded.value;

    default: {
      // RECOVERY_REQUIRED / FAILED. Either the pipeline failed and its undo
      // could not be proven (a commit exists, or the tree is still dirty), or
      // it succeeded but a stability postcondition did not hold afterwards.
      // Both are human-visible states and neither is auto-resolved here.
      if (guarded.value !== undefined && !guarded.value.ok) {
        return { ...guarded.value, message: `${guarded.value.message} | runtime stability guard: ${guarded.state} — ${guarded.reasons.join(" | ")}` };
      }
      return {
        ok: false,
        code: "AYAS_PROPOSAL_STABILITY_POSTCONDITION_FAILED",
        stage: "STABILITY_GUARD",
        message: `${guarded.state}: ${guarded.reasons.join(" | ")}`,
        graphifyEvidenceItemIds: guarded.value?.ok ? guarded.value.graphifyEvidenceItemIds : [],
      };
    }
  }
}

async function runAyasProposalPublishPipeline(approved: AyasInboxProposal, deps: AyasProposalApprovalDeps): Promise<AyasProposalApprovalOutcome> {
  const artifactStore = deps.artifactStore ?? createAyasPatchArtifactStore();
  const graphifyEvidenceStore = deps.graphifyEvidenceStore ?? createAyasGraphifyEvidenceStore({ rootDir: path.join(deps.gateRoot, "graphify-evidence") });
  const remoteName = deps.remoteName ?? "origin";
  const graphifyEvidenceItemIds = new Set<string>();
  let deferredReceipt: Awaited<ReturnType<typeof executeAyasApprovedProposalWith>>;
  const requireRecovery = (reason: string): void => {
    if (deferredReceipt) markAyasDeferredPublicationRecoveryRequired(deferredReceipt, { gateRoot: deps.gateRoot, inbox: deps.inbox, reason });
  };

  // --- Package C execution (unmodified AyasAutonomyDaemon.executeApproved, via the existing AyasProposalExecutionService) ---
  try {
    deferredReceipt = await executeAyasApprovedProposalWith(approved.proposalId, { repoRoot: deps.repoRoot, gateRoot: deps.gateRoot, inbox: deps.inbox, patchArtifactStore: artifactStore, onJournalPhase: deps.onJournalPhase, deferredPublication: true });
    if (!deferredReceipt) throw new Error("AYAS_DEFERRED_RECEIPT_MISSING");
  } catch (error) {
    const code = error instanceof AyasProposalExecutionError ? error.code : error instanceof Error ? error.message : "EXECUTION_FAILED";
    return { ok: false, code, stage: "EXECUTION", message: error instanceof Error ? error.message : String(error), graphifyEvidenceItemIds: [] };
  }

  const artifact = artifactStore.loadVerified(approved.patchArtifactId!);
  const files = approved.exactFiles;

  // --- post-execution validation: per-file Graphify (evidenced) + project TypeScript + git diff --check ---
  try {
    for (const file of files) {
      // Always content-derived here (a missing per-file count is refused just below), so byte-verified reconciliation applies.
      const expected = artifact.graphifyImportCounts?.[file];
      if (expected === undefined) throw new AyasBatchGraphifyCheckError("AYAS_GRAPHIFY_UNEXPECTED_DEPENDENCY", `no declared Graphify import-count contract for generator "${artifact.generatorIdentity}" file "${file}" — refusing to guess`);
      checkAyasItemWithGraphifyEvidenced({ repoRoot: deps.repoRoot, evidenceStore: graphifyEvidenceStore, itemId: approved.proposalId, file, expectedImportCount: expected, approvedContent: artifact.replacements.find((r) => r.filePath === file)?.content });
      graphifyEvidenceItemIds.add(approved.proposalId);
    }
    const tscEntry = path.join(deps.repoRoot, "node_modules", "typescript", "bin", "tsc");
    execFileSync(process.execPath, [tscEntry, "--noEmit"], { cwd: deps.repoRoot, encoding: "utf8", windowsHide: true, timeout: 180_000 });
    git(deps.repoRoot, ["add", "-N", "--", ...files]);
    git(deps.repoRoot, ["diff", "--check", "--", ...files]);
  } catch (error) {
    git(deps.repoRoot, ["reset", "--", ...files]);
    revertToHead(deps.repoRoot, files);
    const message = error instanceof Error ? error.message : String(error);
    requireRecovery(message);
    const code = error instanceof AyasBatchGraphifyCheckError ? error.code : "POST_EXECUTION_VALIDATION_FAILED";
    return { ok: false, code, stage: "POST_VALIDATION", message, graphifyEvidenceItemIds: [...graphifyEvidenceItemIds] };
  }

  // --- exact-scope Git staging only — never `git add .` / `-A` / `commit -a` ---
  git(deps.repoRoot, ["add", "--", ...files]);
  const stagedFiles = git(deps.repoRoot, ["diff", "--cached", "--name-only"]).split("\n").filter(Boolean).sort();
  const expectedFiles = [...files].sort();
  if (JSON.stringify(stagedFiles) !== JSON.stringify(expectedFiles)) {
    git(deps.repoRoot, ["reset"]);
    revertToHead(deps.repoRoot, files);
    requireRecovery("AYAS_PROPOSAL_STAGE_SCOPE_MISMATCH");
    return { ok: false, code: "AYAS_PROPOSAL_STAGE_SCOPE_MISMATCH", stage: "STAGING", message: `staged scope ${JSON.stringify(stagedFiles)} did not exactly match the approved proposal's files ${JSON.stringify(expectedFiles)}`, graphifyEvidenceItemIds: [...graphifyEvidenceItemIds] };
  }
  try {
    git(deps.repoRoot, ["diff", "--cached", "--check"]);
  } catch (error) {
    git(deps.repoRoot, ["reset"]);
    revertToHead(deps.repoRoot, files);
    requireRecovery(error instanceof Error ? error.message : String(error));
    return { ok: false, code: "AYAS_PROPOSAL_WHITESPACE_ERROR", stage: "STAGING", message: error instanceof Error ? error.message : String(error), graphifyEvidenceItemIds: [...graphifyEvidenceItemIds] };
  }

  // --- ONE commit ---
  let commitSha: string;
  try {
    deps.onBeforeCommit?.();
    git(deps.repoRoot, ["commit", "-m", commitMessageFor(approved)]);
    commitSha = git(deps.repoRoot, ["rev-parse", "HEAD"]);
  } catch (error) {
    // A commit failure with content already staged is left exactly as-is for
    // human inspection — never auto-reset, never auto-retried.
    const message = error instanceof Error ? error.message : String(error);
    requireRecovery(message);
    return { ok: false, code: "AYAS_PROPOSAL_COMMIT_FAILED", stage: "COMMIT", message, graphifyEvidenceItemIds: [...graphifyEvidenceItemIds] };
  }

  // --- push, never force ---
  const branch = git(deps.repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
  try {
    deps.onAfterCommitBeforePush?.();
    git(deps.repoRoot, ["push", remoteName, branch]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    requireRecovery(message);
    return { ok: false, code: "AYAS_PROPOSAL_PUSH_FAILED", stage: "PUSH", message, graphifyEvidenceItemIds: [...graphifyEvidenceItemIds] };
  }

  const localHead = git(deps.repoRoot, ["rev-parse", "HEAD"]);
  const remoteHead = git(deps.repoRoot, ["rev-parse", `${remoteName}/${branch}`]);
  if (localHead !== remoteHead) {
    requireRecovery(`local HEAD ${localHead} does not match ${remoteName}/${branch} ${remoteHead} after push`);
    return { ok: false, code: "AYAS_PROPOSAL_PUBLISH_UNVERIFIED", stage: "PUSH", message: `local HEAD ${localHead} does not match ${remoteName}/${branch} ${remoteHead} after push`, graphifyEvidenceItemIds: [...graphifyEvidenceItemIds] };
  }

  // The published SHA becomes authoritative only here.  A stale graph or
  // unhealthy runtime therefore cannot be reported as a clean publication.
  try {
    (deps.postPublicationClosure ?? ((head) => closeAyasPostPublication(head, { repoRoot: deps.repoRoot, remoteName })))(localHead);
    finalizeAyasDeferredPublication(deferredReceipt!, { repoRoot: deps.repoRoot, gateRoot: deps.gateRoot, inbox: deps.inbox, expectedHead: localHead, remoteName });
  } catch (error) {
    if (deferredReceipt) markAyasDeferredPublicationRecoveryRequired(deferredReceipt, { gateRoot: deps.gateRoot, inbox: deps.inbox, reason: error instanceof Error ? error.message : String(error) });
    return { ok: false, code: error instanceof Error && "code" in error ? String((error as { code: unknown }).code) : "AYAS_POST_PUBLICATION_CLOSURE_FAILED", stage: "POST_PUBLICATION_CLOSURE", message: error instanceof Error ? error.message : String(error), graphifyEvidenceItemIds: [...graphifyEvidenceItemIds] };
  }

  return { ok: true, commitSha, pushed: true, changedFiles: files, graphifyEvidenceItemIds: [...graphifyEvidenceItemIds] };
}
