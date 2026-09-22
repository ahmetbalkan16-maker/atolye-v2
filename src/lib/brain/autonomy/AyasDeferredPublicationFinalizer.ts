import { execFileSync } from "node:child_process";
import type { AyasApprovalInboxHandle } from "./AyasApprovalInboxStore";
import { createAyasExecutionJournal } from "./AyasExecutionJournal";
import type { AyasDeferredPublicationReceipt } from "./AyasAutonomyDaemon";

export class AyasDeferredPublicationFinalizerError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "AyasDeferredPublicationFinalizerError"; this.stack = undefined; }
}

function same(value: readonly string[] | undefined, receiptValue: readonly string[]): boolean {
  return JSON.stringify(value) === JSON.stringify(receiptValue);
}

function validateDurableReceipt(durable: ReturnType<ReturnType<typeof createAyasExecutionJournal>["read"]>, receipt: AyasDeferredPublicationReceipt): asserts durable is NonNullable<typeof durable> {
  if (!durable || durable.phase !== "MUTATION_COMPLETED_PENDING_PUBLICATION") throw new AyasDeferredPublicationFinalizerError("AYAS_DEFERRED_RECEIPT_NOT_PENDING", receipt.executionId);
  if (durable.executionId !== receipt.executionId || durable.proposalId !== receipt.proposalId || durable.proposalHash !== receipt.proposalHash ||
    durable.reservationId !== receipt.reservationId || durable.authorizationId !== receipt.authorizationId || durable.baseHead !== receipt.baseHead ||
    !same(durable.exactFiles, receipt.exactFiles) || durable.mutationFingerprint !== receipt.diffFingerprint ||
    !same(durable.changedFiles, receipt.changedFiles) || !same(durable.testsRun, receipt.testsRun) ||
    !same(durable.testResults, receipt.testResults) || durable.mutationCompletedAt !== receipt.mutationCompletedAt) {
    throw new AyasDeferredPublicationFinalizerError("AYAS_DEFERRED_RECEIPT_MISMATCH", receipt.executionId);
  }
}

function hasMatchingResult(state: ReturnType<AyasApprovalInboxHandle["load"]>, receipt: AyasDeferredPublicationReceipt): boolean {
  return state.results.some((result) => result.proposalId === receipt.proposalId &&
    result.authorizationId === receipt.authorizationId && result.outcome === "COMPLETED" &&
    same(result.changedFiles, receipt.changedFiles) && result.diffFingerprint === receipt.diffFingerprint &&
    same(result.testsRun, receipt.testsRun) && same(result.testResults, receipt.testResults));
}

export function finalizeAyasDeferredPublication(receipt: AyasDeferredPublicationReceipt, deps: { readonly repoRoot: string; readonly gateRoot: string; readonly inbox: AyasApprovalInboxHandle; readonly expectedHead: string; readonly remoteName?: string }): void {
  const journal = createAyasExecutionJournal({ rootDir: deps.gateRoot });
  const durable = journal.read(receipt.executionId);
  validateDurableReceipt(durable, receipt);
  const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: deps.repoRoot, encoding: "utf8", windowsHide: true }).trim();
  const local = execFileSync("git", ["rev-parse", "HEAD"], { cwd: deps.repoRoot, encoding: "utf8", windowsHide: true }).trim();
  const remote = execFileSync("git", ["rev-parse", (deps.remoteName ?? "origin") + "/" + branch], { cwd: deps.repoRoot, encoding: "utf8", windowsHide: true }).trim();
  if (local !== deps.expectedHead || remote !== deps.expectedHead) throw new AyasDeferredPublicationFinalizerError("AYAS_DEFERRED_PUBLICATION_HEAD_UNVERIFIED", local + "/" + remote);
  const state = deps.inbox.load();
  const proposal = state.proposals.find((entry) => entry.proposalId === receipt.proposalId);
  const decision = state.decisions.find((entry) => entry.reservationId === receipt.reservationId);
  if (!proposal || !decision) throw new AyasDeferredPublicationFinalizerError("AYAS_DEFERRED_RECEIPT_ALREADY_FINALIZED", receipt.executionId);
  const resultAlreadyRecorded = hasMatchingResult(state, receipt);
  // The inbox, approval decision and journal are deliberately separate
  // durable stores. A process may therefore die after recording the result,
  // or after spending the approval, but before advancing the journal. Resume
  // only that exact durable receipt; never replay the mutation and never add
  // a second result.
  if (decision.finalizedAt) {
    if (decision.finalizationOutcome !== "EXECUTED" || proposal.status !== "COMPLETED" || !resultAlreadyRecorded) {
      throw new AyasDeferredPublicationFinalizerError("AYAS_DEFERRED_RECEIPT_ALREADY_FINALIZED", receipt.executionId);
    }
    journal.record({ ...durable, phase: "RESULT_RECORDED", updatedAt: new Date().toISOString() });
    return;
  }
  if (proposal.status !== "RESERVED" && (proposal.status !== "COMPLETED" || !resultAlreadyRecorded)) {
    throw new AyasDeferredPublicationFinalizerError("AYAS_DEFERRED_RECEIPT_ALREADY_FINALIZED", receipt.executionId);
  }
  const completedAt = new Date().toISOString();
  if (!resultAlreadyRecorded) deps.inbox.recordResult({ resultId: "ayas-result-" + receipt.proposalId + "-" + Date.now(), proposalId: receipt.proposalId, authorizationId: receipt.authorizationId, startedAt: receipt.mutationCompletedAt, completedAt, changedFiles: receipt.changedFiles, diffFingerprint: receipt.diffFingerprint, testsRun: receipt.testsRun, testResults: receipt.testResults, outcome: "COMPLETED", gateAuditIdentity: receipt.authorizationId, operatorReviewStatus: "WAITING_REVIEW" }, "COMPLETED");
  deps.inbox.finalizeApproval(receipt.reservationId, "EXECUTED", completedAt);
  journal.record({ ...durable, phase: "RESULT_RECORDED", updatedAt: completedAt });
}

export function markAyasDeferredPublicationRecoveryRequired(receipt: AyasDeferredPublicationReceipt, deps: { readonly gateRoot: string; readonly inbox: AyasApprovalInboxHandle; readonly reason: string }): void {
  const journal = createAyasExecutionJournal({ rootDir: deps.gateRoot });
  const durable = journal.read(receipt.executionId);
  if (!durable || durable.phase !== "MUTATION_COMPLETED_PENDING_PUBLICATION") return;
  validateDurableReceipt(durable, receipt);
  const now = new Date().toISOString();
  deps.inbox.finalizeApproval(receipt.reservationId, "RECOVERY_REQUIRED", now);
  journal.record({ ...durable, phase: "RECOVERY_REQUIRED", updatedAt: now, lastError: deps.reason });
}
