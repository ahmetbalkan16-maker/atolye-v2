import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { classifyPatchSet } from "../selfheal/BrainPatchSafety";
import { AyasExecutionGateStore } from "../../ayas/execution/AyasExecutionGateStore";
import { applyVerifiedGateTransition } from "./AyasVerifiedGateTransition";
import { createAyasExecutionJournal, classifyExecutionRecovery, ayasExecutionJournalSchemaVersion, type AyasExecutionJournalPhase } from "./AyasExecutionJournal";
import { createAyasApprovalInboxStore, type AyasApprovalInboxHandle, type AyasInboxDecision, type AyasInboxProposal } from "./AyasApprovalInboxStore";
import { createAyasIsolatedGateRoot, type AyasIsolatedGateRoot } from "./AyasIsolatedGateRoot";
import { withAyasExecutionAuthorityLock } from "./AyasExecutionAuthorityLock";
import { revalidateAyasExecution, type AyasExecutionRevalidationDeps } from "./AyasExecutionRevalidation";
import { createAyasMutationBoundary } from "./AyasMutationScope";
import { classifyAyasRestartRecovery } from "./AyasExecutionRecoveryPolicy";

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
}
export interface AyasDaemonOptions {
  readonly inbox?: AyasApprovalInboxHandle;
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
      return inbox.createProposal({ createdAt: observation.now, baseBranch: observation.branch, baseHead: observation.head, objective: candidate.objective, currentProblem: candidate.currentProblem, selectionReason: candidate.selectionReason, expectedUserBenefit: candidate.expectedUserBenefit, expectedBehaviorChange: candidate.expectedBehaviorChange, unchangedBehavior: candidate.unchangedBehavior, riskIfNotDone: candidate.riskIfNotDone, technicalRisk: candidate.technicalRisk, productionImpact: candidate.productionImpact, rationale: candidate.rationale, evidence: candidate.evidence, graphifyEvidence: candidate.graphifyEvidence, candidateRank: candidate.rank, risk: candidate.risk, safetyClassification: safety.level, exactFiles: candidate.exactFiles, expectedDiffScope: candidate.expectedDiffScope, testsPlanned: candidate.testsPlanned, estimatedCost: "zero-cost", mutationKind: candidate.mutationKind, ...(candidate.patchArtifactId ? { patchArtifactId: candidate.patchArtifactId } : {}), ...(candidate.patchHash ? { patchHash: candidate.patchHash } : {}) });
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
  const executeApproved = async (input: { readonly proposalId: string; readonly proposalHash: string; readonly baseHead: string; readonly currentHead: string; readonly exactFiles: readonly string[]; readonly currentExactFiles: readonly string[]; readonly repoClean: boolean; readonly applyWhileExecuting: (authorizationId: string) => Promise<{ readonly changedFiles: readonly string[]; readonly diffFingerprint: string; readonly testsRun: readonly string[]; readonly testResults: readonly string[] }>; }): Promise<AyasInboxProposal> => {
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
    const journalContext: { authorizationId?: string; reservationId?: string } = {};
    const writeJournal = (phase: AyasExecutionJournalPhase, extra: { readonly gateSequence?: number; readonly mutationFingerprint?: string; readonly lastError?: string } = {}): void => {
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
        ...(journalContext.authorizationId ? { authorizationId: journalContext.authorizationId } : {}),
        ...(journalContext.reservationId ? { reservationId: journalContext.reservationId } : {}),
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
        record = applyVerifiedGateTransition(gate, { event: "begin-execution" }, "EXECUTING");
        writeJournal("EXECUTING", { gateSequence: record.sequence });

        const boundary = await createAyasMutationBoundary(repoRoot, input.exactFiles);
        const reported = await input.applyWhileExecuting(reservation.authorizationId);
        const actual = await boundary.verify();
        writeJournal("MUTATION_COMPLETED", { gateSequence: record.sequence, mutationFingerprint: actual.diffFingerprint });
        record = applyVerifiedGateTransition(gate, { event: "complete-execution" }, "COMPLETED");
        writeJournal("GATE_COMPLETED", { gateSequence: record.sequence, mutationFingerprint: actual.diffFingerprint });
        record = applyVerifiedGateTransition(gate, { event: "settle" }, "READY");
        writeJournal("GATE_SETTLED", { gateSequence: record.sequence, mutationFingerprint: actual.diffFingerprint });
        record = applyVerifiedGateTransition(gate, { event: "close" }, "CLOSED");
        writeJournal("GATE_CLOSED", { gateSequence: record.sequence, mutationFingerprint: actual.diffFingerprint });
        const result = { ...reported, changedFiles: actual.changedFiles, diffFingerprint: actual.diffFingerprint };
        inbox.recordResult({ resultId: `ayas-result-${input.proposalId}-${Date.now()}`, proposalId: input.proposalId, authorizationId: reservation.authorizationId, startedAt: state.updatedAt, completedAt: now(), changedFiles: result.changedFiles, diffFingerprint: result.diffFingerprint, testsRun: result.testsRun, testResults: result.testResults, outcome: "COMPLETED", gateAuditIdentity: reservation.authorizationId, operatorReviewStatus: "WAITING_REVIEW" }, "COMPLETED");
        inbox.finalizeApproval(reservation.reservationId, "EXECUTED", now());
        writeJournal("RESULT_RECORDED", { mutationFingerprint: result.diffFingerprint });
        const proposal = inbox.load().proposals.find((entry) => entry.proposalId === input.proposalId);
        if (!proposal) throw new Error("AYAS_DAEMON_RESULT_PROPOSAL_MISSING");
        return proposal;
      });
      transition("WAITING_REVIEW", { activeProposalId: input.proposalId });
      return result;
    } catch (error) {
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
