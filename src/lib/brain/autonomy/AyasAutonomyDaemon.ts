import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { classifyPatchSet } from "../selfheal/BrainPatchSafety";
import type { AyasExactPatchSafetyProof } from "../selfheal/AyasExactPatchSafety";
import { verifyAyasExactProposalSafety } from "./AyasExactProposalSafety";
import { verifyAyasExecutedExactPatch } from "../selfheal/AyasExactPatchSafety";
import { AYAS_DEFAULT_IMPROVEMENT_REGISTRY } from "./AyasResearchExperimentRegistry";
import { execFileSync } from "node:child_process";
import type { AyasPatchArtifactStore } from "./AyasPatchArtifact";
import type { AyasResearchExperimentStore } from "./AyasResearchExperimentStore";
import { AyasExecutionGateStore } from "../../ayas/execution/AyasExecutionGateStore";
import { applyVerifiedGateTransition } from "./AyasVerifiedGateTransition";
import { createAyasExecutionJournal, classifyExecutionRecovery, ayasExecutionJournalSchemaVersion, type AyasExecutionJournalPhase } from "./AyasExecutionJournal";
import { createAyasApprovalInboxStore, type AyasApprovalInboxHandle, type AyasInboxDecision, type AyasInboxProposal, type AyasProposalDiscoverySource } from "./AyasApprovalInboxStore";
import type { AyasProposalStructuredImpact } from "./AyasProposalImpact";
import { createAyasIsolatedGateRoot, type AyasIsolatedGateRoot } from "./AyasIsolatedGateRoot";
import { withAyasExecutionAuthorityLock } from "./AyasExecutionAuthorityLock";
import { revalidateAyasExecution, type AyasExecutionRevalidationDeps } from "./AyasExecutionRevalidation";
import { AyasMutationScopeError, canonicalizeAyasExactFiles, createAyasMutationBoundary } from "./AyasMutationScope";
import { classifyAyasRegressionReport, type AyasMutationReliabilityAudit } from "../../ayas/observability/AyasReliabilitySlo";
import { classifyAyasRestartRecovery } from "./AyasExecutionRecoveryPolicy";
import { createAyasActionFirewall } from "../../ayas/execution/AyasActionFirewall";
import type { AyasOwnerCapabilityLeaseAudit, AyasOwnerCapabilityRequest } from "../../ayas/execution/AyasCapabilityScope";

export const ayasAutonomyDaemonSchemaVersion = "1" as const;
export type AyasAutonomyDaemonPhase = "STARTING" | "OBSERVING" | "PROPOSAL_PENDING" | "WAITING_APPROVAL" | "APPROVED_PENDING_EXECUTION" | "EXECUTING" | "WAITING_REVIEW" | "DEFERRED" | "PAUSED_MACHINE_HEALTH" | "PAUSED_DIRTY_REPO" | "BACKOFF" | "ERROR" | "STOPPED";

export interface AyasAutonomyDaemonState { readonly schemaVersion: typeof ayasAutonomyDaemonSchemaVersion; readonly phase: AyasAutonomyDaemonPhase; readonly updatedAt: string; readonly lastObservationAt?: string; readonly lastError?: string; readonly activeProposalId?: string; readonly heartbeatCount: number; }
export interface AyasDaemonObservation { readonly now: string; readonly branch: string; readonly head: string; readonly repoClean: boolean; readonly graphifyFresh: boolean; readonly machineAction: "ALLOW" | "THROTTLE" | "PAUSE" | "STOP OWN WORKLOAD" | "BLOCK NEW HEAVY WORK"; readonly gaps: readonly string[]; }
export interface AyasDaemonCandidate {
  readonly objective: string;
  readonly currentProblem: string;
  readonly selectionReason: string;
  readonly expectedUserBenefit: string;
  readonly expectedBehaviorChange: string;
  readonly unchangedBehavior: string;
  readonly riskIfNotDone: string;
  readonly technicalRisk: string;
  readonly productionImpact: string;
  readonly rationale: string;
  readonly evidence: readonly string[];
  readonly graphifyEvidence: readonly string[];
  readonly exactFiles: readonly string[];
  readonly expectedDiffScope: string;
  readonly testsPlanned: readonly string[];
  readonly risk: string;
  readonly rank: number;
  /** Identity of the server-owned mutation implementation this candidate would run if approved and executed — see `AyasMutationRegistry`. Required so a candidate can never become execution-eligible without one. */
  readonly mutationKind: string;
  /** M17 — set only for a sandbox-drafted, frozen `AyasPatchArtifact` (`mutationKind: "patch-artifact:v1"`); absent for every statically pre-written registry entry. Both fields participate in `proposalHash`, so neither can be silently rebound after the proposal is created. */
  readonly patchArtifactId?: string;
  readonly patchHash?: string;
  readonly exactPatchSafetyProof?: AyasExactPatchSafetyProof;
  /** Optional — see `AyasProposalImpact.ts`. A discovery source that doesn't model this yet simply omits it; `evaluateAyasImpactPolicy` treats that exactly like an explicit fully-unresolved impact, never a free pass. */
  readonly structuredImpact?: AyasProposalStructuredImpact;
  readonly discoverySource?: AyasProposalDiscoverySource;
  readonly sourceReference?: string;
}
export interface AyasDeferredPublicationReceipt {
  readonly executionId: string; readonly proposalId: string; readonly proposalHash: string;
  readonly authorizationId: string; readonly reservationId: string; readonly baseHead: string;
  readonly exactFiles: readonly string[]; readonly changedFiles: readonly string[];
  readonly diffFingerprint: string; readonly testsRun: readonly string[]; readonly testResults: readonly string[];
  readonly mutationCompletedAt: string;
}
export interface AyasDaemonOptions {
  readonly inbox?: AyasApprovalInboxHandle;
  readonly exactPatchArtifactStore?: AyasPatchArtifactStore;
  readonly exactExperimentStore?: AyasResearchExperimentStore;
  readonly stateFile?: string;
  readonly gateRoot?: string;
  readonly repoRoot?: string;
  readonly now?: () => string;
  readonly revalidation?: Pick<AyasExecutionRevalidationDeps, "readMachineHealth" | "readRepository" | "workload">;
  /**
   * M21.1 — fires synchronously immediately AFTER each execution-journal
   * phase is durably written (`writeJournal` inside `executeApproved`),
   * before the next step runs. Every real caller omits this — its only
   * purpose is deterministic crash-injection testing (see
   * `scripts/ayas-crash-injection-worker.ts`): a test can throw or call
   * `process.exit()` inside it to simulate a genuine interruption at an
   * EXACT, named journal boundary, with the guarantee that the journal
   * record for that phase is already durable on disk before it fires (a
   * crash "during" a phase is indistinguishable, for recovery purposes,
   * from a crash immediately after the phase's own journal write — the
   * durable state is what recovery classification reads either way). Never
   * influences control flow itself: if it throws, that throw propagates
   * through `executeApproved`'s own existing try/catch exactly like any
   * other execution-time failure already does — no new failure path.
   */
  readonly onJournalPhase?: (phase: AyasExecutionJournalPhase) => void;
}

const initialState = (now: string): AyasAutonomyDaemonState => ({ schemaVersion: ayasAutonomyDaemonSchemaVersion, phase: "STARTING", updatedAt: now, heartbeatCount: 0 });

export function isRepoClean(rootDir = process.cwd()): boolean {
  const gitDir = path.join(rootDir, ".git");
  return fs.existsSync(gitDir);
}

export function createAyasAutonomyDaemon(options: AyasDaemonOptions = {}) {
  const now = options.now ?? (() => new Date().toISOString());
  const inbox = options.inbox ?? createAyasApprovalInboxStore();
  const stateFile = options.stateFile ? path.resolve(options.stateFile) : undefined;
  const repoRoot = path.resolve(options.repoRoot ?? process.cwd());
  const isolatedGateRoot: AyasIsolatedGateRoot | undefined = options.gateRoot ? createAyasIsolatedGateRoot(options.gateRoot) : undefined;
  let state: AyasAutonomyDaemonState = initialState(now());
  if (stateFile && fs.existsSync(stateFile)) {
    const parsed = JSON.parse(fs.readFileSync(stateFile, "utf8")) as Partial<AyasAutonomyDaemonState>;
    if (parsed.schemaVersion !== ayasAutonomyDaemonSchemaVersion || typeof parsed.phase !== "string" || typeof parsed.heartbeatCount !== "number") throw new Error("AYAS_DAEMON_STATE_CORRUPT");
    state = parsed as AyasAutonomyDaemonState;
  }

  const persist = (): void => { if (!stateFile) return; fs.mkdirSync(path.dirname(stateFile), { recursive: true }); const tmp = `${stateFile}.${process.pid}.tmp`; fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8"); fs.renameSync(tmp, stateFile); };
  const transition = (phase: AyasAutonomyDaemonPhase, extra: Partial<AyasAutonomyDaemonState> = {}): AyasAutonomyDaemonState => { state = { ...state, ...extra, phase, updatedAt: now(), heartbeatCount: state.heartbeatCount + 1 }; persist(); return state; };
  const observe = (observation: AyasDaemonObservation): AyasAutonomyDaemonState => {
    if (observation.machineAction === "PAUSE" || observation.machineAction === "STOP OWN WORKLOAD") return transition("PAUSED_MACHINE_HEALTH", { lastObservationAt: observation.now, lastError: `Machine Health: ${observation.machineAction}` });
    if (!observation.repoClean) return transition("PAUSED_DIRTY_REPO", { lastObservationAt: observation.now, lastError: "working tree is dirty — no mutation allowed" });
    return transition("OBSERVING", { lastObservationAt: observation.now, lastError: undefined });
  };
  const discover = (observation: AyasDaemonObservation, candidates: readonly AyasDaemonCandidate[]): readonly AyasInboxProposal[] => {
    if (state.phase === "PAUSED_DIRTY_REPO" || state.phase === "PAUSED_MACHINE_HEALTH" || !observation.repoClean || !observation.graphifyFresh) return [];
    const proposals = candidates.map((candidate) => {
      const safety = classifyPatchSet(candidate.exactFiles);
      const exactSafety = safety.level === "REVIEW_REQUIRED" && verifyAyasExactProposalSafety({
        baseHead: observation.head, exactFiles: candidate.exactFiles, safetyClassification: "SAFE",
        mutationKind: candidate.mutationKind, patchArtifactId: candidate.patchArtifactId,
        patchHash: candidate.patchHash, exactPatchSafetyProof: candidate.exactPatchSafetyProof,
      }, { repoRoot, artifactStore: options.exactPatchArtifactStore, experimentStore: options.exactExperimentStore });
      return inbox.createProposal({ createdAt: observation.now, baseBranch: observation.branch, baseHead: observation.head, objective: candidate.objective, currentProblem: candidate.currentProblem, selectionReason: candidate.selectionReason, expectedUserBenefit: candidate.expectedUserBenefit, expectedBehaviorChange: candidate.expectedBehaviorChange, unchangedBehavior: candidate.unchangedBehavior, riskIfNotDone: candidate.riskIfNotDone, technicalRisk: candidate.technicalRisk, productionImpact: candidate.productionImpact, rationale: candidate.rationale, evidence: candidate.evidence, graphifyEvidence: candidate.graphifyEvidence, candidateRank: candidate.rank, risk: candidate.risk, safetyClassification: exactSafety ? "SAFE" : safety.level, exactFiles: candidate.exactFiles, expectedDiffScope: candidate.expectedDiffScope, testsPlanned: candidate.testsPlanned, estimatedCost: "zero-cost", mutationKind: candidate.mutationKind, ...(candidate.patchArtifactId ? { patchArtifactId: candidate.patchArtifactId } : {}), ...(candidate.patchHash ? { patchHash: candidate.patchHash } : {}), ...(exactSafety ? { exactPatchSafetyProof: candidate.exactPatchSafetyProof } : {}), ...(candidate.structuredImpact ? { structuredImpact: candidate.structuredImpact } : {}), ...(candidate.discoverySource ? { discoverySource: candidate.discoverySource } : {}), ...(candidate.sourceReference ? { sourceReference: candidate.sourceReference } : {}) });
    }).filter((proposal, index, all) => all.findIndex((other) => other.proposalHash === proposal.proposalHash) === index);
    if (proposals.length) transition("WAITING_APPROVAL", { activeProposalId: proposals[0]?.proposalId });
    return proposals;
  };
  const decide = (proposalId: string, decision: AyasInboxDecision, reason?: string): AyasInboxProposal => {
    const current = inbox.load().proposals.find((proposal) => proposal.proposalId === proposalId);
    if (decision === "APPROVE" && current?.safetyClassification !== "SAFE") throw new Error("AYAS_DAEMON_APPROVAL_REQUIRES_SAFE_CLASSIFICATION");
    const result = inbox.decide(proposalId, decision, now(), reason);
    transition(decision === "APPROVE" ? "APPROVED_PENDING_EXECUTION" : decision === "LATER" ? "DEFERRED" : "OBSERVING", { activeProposalId: proposalId });
    return result.proposal;
  };
  const executeApproved = async (input: { readonly mutationKind?: string; readonly proposalId: string; readonly proposalHash: string; readonly baseHead: string; readonly currentHead: string; readonly exactFiles: readonly string[]; readonly currentExactFiles: readonly string[]; readonly repoClean: boolean; readonly deferredPublication?: boolean; readonly onDeferredReceipt?: (receipt: AyasDeferredPublicationReceipt) => void; readonly applyWhileExecuting: (authorizationId: string) => Promise<{ readonly changedFiles: readonly string[]; readonly diffFingerprint: string; readonly testsRun: readonly string[]; readonly testResults: readonly string[] }>; }): Promise<AyasInboxProposal> => {
    // Isolate authority scope from caller arrays while asynchronous checks are running.
    input = { ...input, mutationKind: input.mutationKind ?? inbox.load().proposals.find((p) => p.proposalId === input.proposalId)?.mutationKind, exactFiles: Object.freeze([...input.exactFiles]), currentExactFiles: Object.freeze([...input.currentExactFiles]) };
    if (!input.repoClean) { transition("PAUSED_DIRTY_REPO", { lastError: "working tree became dirty before execution" }); throw new Error("AYAS_DAEMON_DIRTY_REPO"); }
    if (!isolatedGateRoot) throw new Error("AYAS_DAEMON_DEVELOPMENT_GATE_ROOT_REQUIRED");
    if (input.currentHead !== input.baseHead) { transition("ERROR", { lastError: "proposal HEAD is stale" }); throw new Error("AYAS_DAEMON_STALE_HEAD"); }
    if (JSON.stringify([...input.currentExactFiles]) !== JSON.stringify([...input.exactFiles])) { transition("ERROR", { lastError: "proposal file scope is stale" }); throw new Error("AYAS_DAEMON_STALE_SCOPE"); }

    // Crash-recoverable execution journal: a durable, atomic record of
    // exactly how far this attempt got, written at every phase boundary.
    // It never triggers anything itself — it only lets a future restart
    // classify what happened (see `classifyExecutionRecovery`) instead of
    // requiring a human to reconstruct it from three separate files by hand.
    const executionId = `ayas-exec-${crypto.randomUUID()}`;
    const journal = createAyasExecutionJournal({ rootDir: isolatedGateRoot });
    const startedAt = now();
    const journalContext: { authorizationId?: string; reservationId?: string; capabilityLease?: AyasOwnerCapabilityLeaseAudit } = {};
    let reliabilityAudit: AyasMutationReliabilityAudit = { version: "1", mutationStarted: false, observedBaseHead: null,
      scopeVerified: false, violation: "NONE", regression: "NOT_REPORTED", testCount: 0, completionRecorded: false };
    const writeJournal = (phase: AyasExecutionJournalPhase, extra: { readonly gateSequence?: number; readonly mutationFingerprint?: string; readonly lastError?: string; readonly changedFiles?: readonly string[]; readonly testsRun?: readonly string[]; readonly testResults?: readonly string[]; readonly mutationCompletedAt?: string } = {}): void => {
      journal.record({
        schemaVersion: ayasExecutionJournalSchemaVersion,
        executionId,
        proposalId: input.proposalId,
        proposalHash: input.proposalHash,
        baseHead: input.baseHead,
        exactFiles: input.exactFiles,
        phase,
        startedAt,
        updatedAt: now(),
        reliabilityAudit,
        ...(journalContext.authorizationId ? { authorizationId: journalContext.authorizationId } : {}),
        ...(journalContext.reservationId ? { reservationId: journalContext.reservationId } : {}),
        ...(journalContext.capabilityLease ? { capabilityLease: journalContext.capabilityLease } : {}),
        ...extra,
      });
      options.onJournalPhase?.(phase);
    };

    writeJournal("APPROVED_NOT_STARTED");
    // Phase 1 of the two-phase authority lifecycle: the one-shot
    // authorization is reserved here, before any gate transition — a crash
    // between this line and `begin-execution` is Window A/B/C (durably
    // classified below as no-mutation-possible), never a silent replay.
    const reservation = inbox.reserveApproval(input.proposalId, input.proposalHash, input.baseHead, input.exactFiles, now());
    journalContext.authorizationId = reservation.authorizationId;
    journalContext.reservationId = reservation.reservationId;
    writeJournal("AUTHORIZATION_RESERVED");

    const gate = new AyasExecutionGateStore({ rootDir: isolatedGateRoot });
    transition("EXECUTING", { activeProposalId: input.proposalId });
    try {
      const result = await withAyasExecutionAuthorityLock(isolatedGateRoot, async () => {
        const binding = { proposalId: input.proposalId, proposalHash: input.proposalHash, baseHead: input.baseHead, exactFiles: input.exactFiles, reservationId: reservation.reservationId, authorizationId: reservation.authorizationId };
        const validationDeps = { repoRoot, inbox, ...options.revalidation };
        await revalidateAyasExecution(binding, validationDeps);
        let record = applyVerifiedGateTransition(gate, { event: "arm" }, "ARMED");
        writeJournal("GATE_ARMED", { gateSequence: record.sequence });
        record = applyVerifiedGateTransition(gate, { event: "confirm-ready" }, "READY");
        writeJournal("GATE_READY", { gateSequence: record.sequence });
        record = applyVerifiedGateTransition(gate, { event: "open", activationAuthorizationId: reservation.authorizationId }, "OPEN");
        writeJournal("GATE_OPEN", { gateSequence: record.sequence });
        await revalidateAyasExecution(binding, validationDeps);
        // This adapter reads ONLY the already-reserved owner decision. It cannot approve,
        // widen scope or mint an alternative authorization. Both journal writes occur while
        // holding the existing authority lock; restart never reconstructs its live handle.
        const readOwnerProof = () => {
          const current = inbox.load();
          const proposal = current.proposals.find((p) => p.proposalId === input.proposalId);
          const decision = [...current.decisions].reverse().find((d) => d.proposalId === input.proposalId);
          if (!proposal || proposal.status !== "RESERVED" || proposal.safetyClassification !== "SAFE" || proposal.estimatedCost !== "zero-cost" ||
              proposal.proposalHash !== binding.proposalHash || proposal.baseHead !== binding.baseHead || !proposal.mutationKind || proposal.mutationKind !== input.mutationKind ||
              !decision || decision.decision !== "APPROVE" || decision.decisionId !== reservation.decisionId || decision.proposalHash !== binding.proposalHash ||
              decision.authorizationId !== reservation.authorizationId || decision.reservationId !== reservation.reservationId || !decision.reservedAt ||
              decision.finalizedAt || decision.authorizationConsumedAt) return undefined;
          const exactFiles = canonicalizeAyasExactFiles(repoRoot, proposal.exactFiles);
          if (JSON.stringify(exactFiles) !== JSON.stringify(canonicalizeAyasExactFiles(repoRoot, binding.exactFiles))) return undefined;
          const request: AyasOwnerCapabilityRequest = { action: "self-development.apply-approved-proposal", proposalId: proposal.proposalId,
            proposalHash: proposal.proposalHash, baseHead: proposal.baseHead, exactFiles, mutationKind: proposal.mutationKind,
            authorizationId: reservation.authorizationId, reservationId: reservation.reservationId };
          return { ownerId: "shared-passcode-owner" as const, decisionId: decision.decisionId, reservedAt: decision.reservedAt, request };
        };
        const firewall = createAyasActionFirewall({ repoRoot, now: () => new Date(now()), ownerReservation: {
          readProof: readOwnerProof,
          readLease: () => journal.read(executionId)?.capabilityLease,
          recordLease: (lease) => {
            if (gate.read().state !== "OPEN" || journal.read(executionId)?.phase !== "GATE_OPEN") throw new Error("AYAS_DAEMON_LEASE_GATE_CHANGED");
            journalContext.capabilityLease = lease;
            writeJournal("GATE_OPEN", { gateSequence: record.sequence });
          },
        } });
        const ownerRequest = readOwnerProof()?.request;
        const issued = firewall.bindOwnerReservation(ownerRequest);
        if (!issued.allowed) throw new Error(issued.reason);
        // The mutation boundary can await Git. Re-check owner, repository and health after
        // that wait, then consume the lease durably immediately before entering execution.
        const boundary = await createAyasMutationBoundary(repoRoot, input.exactFiles);
        reliabilityAudit = { ...reliabilityAudit, observedBaseHead: boundary.baseHead };
        await revalidateAyasExecution(binding, validationDeps);
        const admitted = firewall.admitOwnerReservation(issued.lease, ownerRequest);
        if (!admitted.allowed) throw new Error(admitted.reason);
        record = applyVerifiedGateTransition(gate, { event: "begin-execution" }, "EXECUTING");
        reliabilityAudit = { ...reliabilityAudit, mutationStarted: true };
        writeJournal("EXECUTING", { gateSequence: record.sequence });

        const callbackReport = await input.applyWhileExecuting(reservation.authorizationId);
        reliabilityAudit = { ...reliabilityAudit, ...classifyAyasRegressionReport(callbackReport.testsRun, callbackReport.testResults) };
        // Preserve the report checked here across the awaited boundary and phase hooks.
        const reported = { ...callbackReport, testsRun: Object.freeze(Array.isArray(callbackReport.testsRun) ? [...callbackReport.testsRun] : []),
          testResults: Object.freeze(Array.isArray(callbackReport.testResults) ? [...callbackReport.testResults] : []) };
        const actual = await boundary.verify();
        reliabilityAudit = { ...reliabilityAudit, scopeVerified: true };
        // The callback cannot mark a failed or malformed regression report COMPLETED.
        // Empty legacy reports remain compatible and explicitly unmeasured.
        if (reliabilityAudit.regression === "FAIL" || reliabilityAudit.regression === "INVALID") throw new Error("AYAS_DAEMON_REGRESSION_REPORT_REFUSED");
        const executedProposal = inbox.load().proposals.find((entry) => entry.proposalId === input.proposalId);
        if (executedProposal?.exactPatchSafetyProof) {
          const proof = executedProposal.exactPatchSafetyProof;
          const file = proof.exactFiles[0];
          const manifest = AYAS_DEFAULT_IMPROVEMENT_REGISTRY.strategies.find((entry) => entry.strategyId === proof.strategyId
            && entry.version === proof.strategyVersion)?.reviewedExactPatch;
          if (!file || !manifest || !verifyAyasExactProposalSafety(executedProposal, { repoRoot,
            artifactStore: options.exactPatchArtifactStore, experimentStore: options.exactExperimentStore, requireUnchangedSource: false })) {
            throw new Error("AYAS_EXACT_PATCH_POST_VERIFICATION_FAILED");
          }
          const base = execFileSync("git", ["show", `${proof.baseHead}:${file}`],
            { cwd: repoRoot, encoding: "utf8", windowsHide: true, timeout: 30_000, maxBuffer: 1_000_000 });
          const applied = fs.readFileSync(path.join(repoRoot, file), "utf8");
          if (!verifyAyasExecutedExactPatch(proof, manifest, file, base, applied)
            || JSON.stringify(actual.changedFiles) !== JSON.stringify(proof.exactFiles)) {
            throw new Error("AYAS_EXACT_PATCH_POST_VERIFICATION_FAILED");
          }
        }
        writeJournal("MUTATION_COMPLETED", { gateSequence: record.sequence, mutationFingerprint: actual.diffFingerprint });
        record = applyVerifiedGateTransition(gate, { event: "complete-execution" }, "COMPLETED");
        writeJournal("GATE_COMPLETED", { gateSequence: record.sequence, mutationFingerprint: actual.diffFingerprint });
        record = applyVerifiedGateTransition(gate, { event: "settle" }, "READY");
        writeJournal("GATE_SETTLED", { gateSequence: record.sequence, mutationFingerprint: actual.diffFingerprint });
        record = applyVerifiedGateTransition(gate, { event: "close" }, "CLOSED");
        writeJournal("GATE_CLOSED", { gateSequence: record.sequence, mutationFingerprint: actual.diffFingerprint });
        const result = { ...reported, changedFiles: actual.changedFiles, diffFingerprint: actual.diffFingerprint };
        if (input.deferredPublication) {
          const receipt: AyasDeferredPublicationReceipt = { executionId, proposalId: input.proposalId, proposalHash: input.proposalHash, authorizationId: reservation.authorizationId, reservationId: reservation.reservationId, baseHead: input.baseHead, exactFiles: input.exactFiles, changedFiles: result.changedFiles, diffFingerprint: result.diffFingerprint, testsRun: result.testsRun, testResults: result.testResults, mutationCompletedAt: now() };
          writeJournal("MUTATION_COMPLETED_PENDING_PUBLICATION", { mutationFingerprint: result.diffFingerprint, changedFiles: result.changedFiles, testsRun: result.testsRun, testResults: result.testResults, mutationCompletedAt: receipt.mutationCompletedAt });
          input.onDeferredReceipt?.(receipt);
          return inbox.load().proposals.find((entry) => entry.proposalId === input.proposalId)!;
        }
        inbox.recordResult({ resultId: `ayas-result-${input.proposalId}-${Date.now()}`, proposalId: input.proposalId, authorizationId: reservation.authorizationId, startedAt: state.updatedAt, completedAt: now(), changedFiles: result.changedFiles, diffFingerprint: result.diffFingerprint, testsRun: result.testsRun, testResults: result.testResults, outcome: "COMPLETED", gateAuditIdentity: reservation.authorizationId, operatorReviewStatus: "WAITING_REVIEW" }, "COMPLETED");
        inbox.finalizeApproval(reservation.reservationId, "EXECUTED", now());
        reliabilityAudit = { ...reliabilityAudit, completionRecorded: true };
        writeJournal("RESULT_RECORDED", { mutationFingerprint: result.diffFingerprint });
        const proposal = inbox.load().proposals.find((entry) => entry.proposalId === input.proposalId);
        if (!proposal) throw new Error("AYAS_DAEMON_RESULT_PROPOSAL_MISSING");
        return proposal;
      });
      transition("WAITING_REVIEW", { activeProposalId: input.proposalId });
      return result;
    } catch (error) {
      if (error instanceof AyasMutationScopeError && (error.code === "HEAD_CHANGED" || error.code === "UNAUTHORIZED_MUTATION")) {
        reliabilityAudit = { ...reliabilityAudit, scopeVerified: false, violation: error.code };
      }
      // Fail-closed recovery classification: read back the last durably
      // journaled phase (never trust in-memory state alone, since a real
      // crash would have lost it) and finalize the reservation accordingly.
      // "no automatic replay": this never re-invokes `applyWhileExecuting`
      // and never lets the proposal return to a re-decidable state — only a
      // fresh proposal (new content/hash) can be attempted again.
      let mutationPossible = true;
      try {
        const lastJournaled = journal.read(executionId);
        mutationPossible = lastJournaled ? classifyExecutionRecovery(lastJournaled).mutationPossible : true;
      } catch { /* journal itself unreadable — fail closed to "mutation possible" */ }
      const finalizationOutcome = mutationPossible ? "RECOVERY_REQUIRED" : "ABANDONED";
      try { inbox.finalizeApproval(reservation.reservationId, finalizationOutcome, now()); } catch { /* fail closed — must not mask the original error below */ }
      try { writeJournal(mutationPossible ? "RECOVERY_REQUIRED" : "FAILED", { lastError: error instanceof Error ? error.message : String(error) }); } catch { /* fail closed */ }
      try { gate.transition({ event: "fault", reason: "development apply failed" }); } catch { /* fail closed */ }
      transition("ERROR", { lastError: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  };
  const inspectRecovery = () => isolatedGateRoot ? createAyasExecutionJournal({ rootDir: isolatedGateRoot }).list().map((entry) => ({ entry, decision: classifyAyasRestartRecovery(entry) })) : [];
  return { get state() { return state; }, inbox, observe, discover, decide, executeApproved, inspectRecovery, transition };
}
