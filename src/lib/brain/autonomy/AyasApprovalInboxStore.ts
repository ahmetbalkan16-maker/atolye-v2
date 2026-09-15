import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { containsBrainSecret, redactBrainText } from "../BrainRedaction";
import { isAyasDeferredEligibleNow } from "./AyasDeferredEligibility";

export const ayasApprovalInboxSchemaVersion = "1" as const;
export type AyasInboxDecision = "APPROVE" | "REJECT" | "LATER";
/**
 * `RESERVED`: a one-shot authorization has been reserved (see
 * `reserveApproval`) but execution has not yet been finalized. `ABANDONED`:
 * a reservation was finalized without any possibility of mutation having
 * occurred (safe, but still terminal — the same reservation is never
 * reused). `RECOVERY_REQUIRED`: a reservation was finalized while mutation
 * may have occurred; a human must review before the proposal is considered
 * resolved. Neither `ABANDONED` nor `RECOVERY_REQUIRED` is re-decidable —
 * a fresh proposal (new content, new hash) is required to try again.
 */
export type AyasInboxProposalStatus = "PENDING" | "APPROVED" | "REJECTED" | "DEFERRED" | "STALE" | "COMPLETED" | "FAILED" | "RESERVED" | "ABANDONED" | "RECOVERY_REQUIRED";
export type AyasInboxReservationOutcome = "EXECUTED" | "ABANDONED" | "RECOVERY_REQUIRED";

export interface AyasInboxProposal {
  readonly schemaVersion: typeof ayasApprovalInboxSchemaVersion;
  readonly proposalId: string;
  readonly createdAt: string;
  readonly lastUpdatedAt: string;
  readonly baseBranch: string;
  readonly baseHead: string;
  readonly objective: string;
  /** Human-facing explanation fields are optional on reads for schema-v1 compatibility. */
  readonly currentProblem?: string;
  readonly selectionReason?: string;
  readonly expectedUserBenefit?: string;
  readonly expectedBehaviorChange?: string;
  readonly unchangedBehavior?: string;
  readonly riskIfNotDone?: string;
  readonly technicalRisk?: string;
  readonly productionImpact?: string;
  readonly rationale: string;
  readonly evidence: readonly string[];
  readonly graphifyEvidence: readonly string[];
  readonly candidateRank: number;
  readonly risk: string;
  readonly safetyClassification: "SAFE" | "REVIEW_REQUIRED" | "FORBIDDEN_AUTONOMOUS";
  readonly exactFiles: readonly string[];
  readonly expectedDiffScope: string;
  readonly testsPlanned: readonly string[];
  readonly estimatedCost: "zero-cost";
  readonly proposalHash: string;
  readonly status: AyasInboxProposalStatus;
  readonly supersedesProposalId?: string;
  readonly createdBy: "ayas-daemon";
  readonly nextEligibleAt?: string;
}

export interface AyasInboxDecisionRecord {
  readonly decisionId: string;
  readonly proposalId: string;
  readonly proposalHash: string;
  readonly decision: AyasInboxDecision;
  readonly decidedAt: string;
  readonly reason?: string;
  readonly evidenceFingerprint: string;
  readonly authorizationId?: string;
  /** @deprecated one-shot marker from the original single-phase `consumeApproval` — still enforced, kept for backward compatibility. New callers should use `reserveApproval`/`finalizeApproval`. */
  readonly authorizationConsumedAt?: string;
  readonly reservationId?: string;
  readonly reservedAt?: string;
  readonly finalizedAt?: string;
  readonly finalizationOutcome?: AyasInboxReservationOutcome;
}

export interface AyasInboxResultRecord {
  readonly resultId: string;
  readonly proposalId: string;
  readonly authorizationId: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly changedFiles: readonly string[];
  readonly diffFingerprint: string;
  readonly testsRun: readonly string[];
  readonly testResults: readonly string[];
  readonly outcome: "COMPLETED" | "FAILED" | "ROLLED_BACK" | "STALE";
  readonly gateAuditIdentity: string;
  readonly operatorReviewStatus: "WAITING_REVIEW" | "REVIEWED";
}

export interface AyasApprovalInboxState {
  readonly schemaVersion: typeof ayasApprovalInboxSchemaVersion;
  readonly revision: number;
  readonly proposals: readonly AyasInboxProposal[];
  readonly decisions: readonly AyasInboxDecisionRecord[];
  readonly results: readonly AyasInboxResultRecord[];
}

export class AyasApprovalInboxStoreError extends Error {
  constructor(readonly code: "AYAS_INBOX_CORRUPT" | "AYAS_INBOX_SCHEMA_MISMATCH" | "AYAS_INBOX_IO" | "AYAS_INBOX_SECRET_LEAK" | "AYAS_INBOX_INVALID" | "AYAS_INBOX_UNSAFE_APPROVAL", message: string) {
    super(message);
    this.name = "AyasApprovalInboxStoreError";
    this.stack = undefined;
  }
}

const digest = (value: unknown): string => crypto.createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
const scrub = (value: string, max: number): string => redactBrainText(String(value ?? "")).text.slice(0, max);
const cleanList = (values: readonly string[], max: number): string[] => values.map((value) => scrub(value, max)).filter(Boolean).slice(0, 40);

function assertNoSecret(values: readonly string[]): void {
  if (values.some(containsBrainSecret)) throw new AyasApprovalInboxStoreError("AYAS_INBOX_SECRET_LEAK", "approval inbox refused a secret-like value");
}

function proposalHash(input: Record<string, unknown>): string {
  const material = Object.fromEntries(Object.entries(input).filter(([key]) => key !== "proposalId"));
  return digest({ ...material, schemaVersion: ayasApprovalInboxSchemaVersion });
}

export interface AyasApprovalInboxStoreOptions { readonly rootDir?: string; }

export const ayasApprovalExplanationFields = [
  "objective",
  "currentProblem",
  "selectionReason",
  "expectedUserBenefit",
  "expectedBehaviorChange",
  "unchangedBehavior",
  "riskIfNotDone",
  "technicalRisk",
  "productionImpact",
] as const;

export type AyasApprovalExplanationField = typeof ayasApprovalExplanationFields[number];

export function missingAyasApprovalExplanation(proposal: AyasInboxProposal): readonly AyasApprovalExplanationField[] {
  return ayasApprovalExplanationFields.filter((field) => typeof proposal[field] !== "string" || !proposal[field]?.trim());
}

export function isAyasProposalApprovalReady(proposal: AyasInboxProposal): boolean {
  return proposal.safetyClassification === "SAFE"
    && missingAyasApprovalExplanation(proposal).length === 0
    && proposal.exactFiles.length > 0
    && proposal.expectedDiffScope.trim().length > 0
    && proposal.testsPlanned.length > 0
    && proposal.graphifyEvidence.length > 0
    && proposal.baseHead.trim().length > 0;
}

type AyasProposalCreateInput = Omit<AyasInboxProposal, "schemaVersion" | "proposalId" | "lastUpdatedAt" | "proposalHash" | "status" | "createdBy" | AyasApprovalExplanationField>
  & Required<Pick<AyasInboxProposal, AyasApprovalExplanationField>>
  & { readonly proposalId?: string };

export interface AyasApprovalInboxHandle {
  readonly stateFile: string;
  load(): AyasApprovalInboxState;
  save(state: AyasApprovalInboxState): AyasApprovalInboxState;
  createProposal(input: AyasProposalCreateInput): AyasInboxProposal;
  decide(proposalId: string, decision: AyasInboxDecision, now: string, reason?: string): { proposal: AyasInboxProposal; decision: AyasInboxDecisionRecord };
  /** @deprecated single-phase one-shot consumption. New callers should use `reserveApproval`/`finalizeApproval` instead. */
  consumeApproval(proposalId: string, proposalHashValue: string, baseHead: string, exactFiles: readonly string[], now: string): AyasInboxDecisionRecord;
  /** Phase 1 of the two-phase authority lifecycle: durably reserves the one-shot authorization (proposal moves to `RESERVED`) without implying anything about the gate or mutation. */
  reserveApproval(proposalId: string, proposalHashValue: string, baseHead: string, exactFiles: readonly string[], now: string): { readonly reservationId: string; readonly authorizationId: string; readonly decisionId: string };
  /** Phase 2: durably finalizes a reservation exactly once. Does not run anything — pure record-keeping. */
  finalizeApproval(reservationId: string, outcome: AyasInboxReservationOutcome, now: string): void;
  recordResult(result: AyasInboxResultRecord, status: "COMPLETED" | "FAILED" | "STALE"): void;
}

function emptyState(): AyasApprovalInboxState {
  return { schemaVersion: ayasApprovalInboxSchemaVersion, revision: 0, proposals: [], decisions: [], results: [] };
}

export function createAyasApprovalInboxStore(options: AyasApprovalInboxStoreOptions = {}): AyasApprovalInboxHandle {
  const root = path.resolve(options.rootDir ?? path.join(process.cwd(), "data", "brain"));
  const dir = path.join(root, "autonomy");
  const stateFile = path.join(dir, "approval-inbox.json");

  const writeAtomic = (state: AyasApprovalInboxState): void => {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, `.approval-inbox.${process.pid}.${crypto.randomUUID()}.tmp`);
    try {
      const fd = fs.openSync(tmp, "w");
      try { fs.writeFileSync(fd, `${JSON.stringify(state, null, 2)}\n`, "utf8"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(tmp, stateFile);
    } catch (error) {
      try { fs.rmSync(tmp, { force: true }); } catch { /* fail closed */ }
      throw new AyasApprovalInboxStoreError("AYAS_INBOX_IO", error instanceof Error ? error.message : String(error));
    }
  };

  const load = (): AyasApprovalInboxState => {
    if (!fs.existsSync(stateFile)) return emptyState();
    let parsed: unknown;
    try { parsed = JSON.parse(fs.readFileSync(stateFile, "utf8")); } catch (error) { throw new AyasApprovalInboxStoreError("AYAS_INBOX_CORRUPT", `approval-inbox.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`); }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new AyasApprovalInboxStoreError("AYAS_INBOX_CORRUPT", "approval-inbox.json has an invalid shape");
    const state = parsed as Partial<AyasApprovalInboxState>;
    if (state.schemaVersion !== ayasApprovalInboxSchemaVersion) throw new AyasApprovalInboxStoreError("AYAS_INBOX_SCHEMA_MISMATCH", "approval-inbox.json schema is unsupported");
    if (!Number.isInteger(state.revision) || !Array.isArray(state.proposals) || !Array.isArray(state.decisions) || !Array.isArray(state.results)) throw new AyasApprovalInboxStoreError("AYAS_INBOX_CORRUPT", "approval-inbox.json is structurally invalid");
    return state as AyasApprovalInboxState;
  };

  const save = (state: AyasApprovalInboxState): AyasApprovalInboxState => {
    const text = JSON.stringify(state);
    if (containsBrainSecret(text)) throw new AyasApprovalInboxStoreError("AYAS_INBOX_SECRET_LEAK", "approval inbox contains a secret-like value");
    const next = { ...state, revision: state.revision + 1 };
    writeAtomic(next);
    return next;
  };

  return {
    stateFile,
    load,
    save,
    createProposal(input) {
      const now = input.createdAt;
      const exactFiles = [...new Set(input.exactFiles.map((file) => scrub(file, 240)))];
      const evidence = cleanList(input.evidence, 500);
      const graphifyEvidence = cleanList(input.graphifyEvidence, 500);
      const explanations = ayasApprovalExplanationFields.map((field) => scrub(input[field], 700));
      assertNoSecret([...explanations, input.rationale, ...evidence, ...graphifyEvidence, ...exactFiles]);
      const base = {
        ...input,
        ...Object.fromEntries(ayasApprovalExplanationFields.map((field, index) => [field, explanations[index]])),
        proposalId: input.proposalId ?? `ayas-proposal-${crypto.randomUUID()}`,
        lastUpdatedAt: now,
        exactFiles,
        evidence,
        graphifyEvidence,
        createdBy: "ayas-daemon" as const,
      };
      const proposal = { ...base, schemaVersion: ayasApprovalInboxSchemaVersion, proposalHash: proposalHash(base), status: "PENDING" as const };
      const state = load();
      const duplicate = state.proposals.find((p) => p.proposalHash === proposal.proposalHash && ["PENDING", "APPROVED", "REJECTED", "DEFERRED", "RESERVED"].includes(p.status));
      if (duplicate) return duplicate;
      save({ ...state, proposals: [...state.proposals, proposal] });
      return proposal;
    },
    decide(proposalId, decision, now, reason) {
      const state = load();
      const existing = state.proposals.find((p) => p.proposalId === proposalId);
      if (!existing) throw new AyasApprovalInboxStoreError("AYAS_INBOX_INVALID", "proposal not found");
      // M8 — a DEFERRED proposal accepts a fresh LATER at any time (re-defer
      // further, unconditionally — unchanged, pre-existing behavior), and
      // ALSO accepts APPROVE/REJECT once `nextEligibleAt` has passed. Before
      // M8 this second case was structurally impossible: the View already
      // showed such a proposal as "pending" (actionable), but this guard
      // rejected any decision except another LATER for it — a real view/
      // authority mismatch. `isAyasDeferredEligibleNow` is the SAME
      // predicate the View uses, so the two can never disagree again.
      const decidable = existing.status === "PENDING"
        || (existing.status === "DEFERRED" && decision === "LATER")
        || (existing.status === "DEFERRED" && decision !== "LATER" && isAyasDeferredEligibleNow(existing.nextEligibleAt, now));
      if (!decidable) throw new AyasApprovalInboxStoreError("AYAS_INBOX_INVALID", `proposal is not pending: ${existing.status}`);
      // Authority boundary: only a SAFE-classified proposal may ever be
      // approved. This is enforced here, not merely by callers, so no future
      // caller of `decide()` can mint an authorization for a REVIEW_REQUIRED
      // or FORBIDDEN_AUTONOMOUS proposal by omitting its own pre-check.
      if (decision === "APPROVE" && existing.safetyClassification !== "SAFE") throw new AyasApprovalInboxStoreError("AYAS_INBOX_UNSAFE_APPROVAL", `only SAFE proposals may be approved, got: ${existing.safetyClassification}`);
      if (decision === "APPROVE" && !isAyasProposalApprovalReady(existing)) throw new AyasApprovalInboxStoreError("AYAS_INBOX_UNSAFE_APPROVAL", "SAFE proposal explanation or approval evidence is incomplete");
      const nextStatus: AyasInboxProposalStatus = decision === "APPROVE" ? "APPROVED" : decision === "REJECT" ? "REJECTED" : "DEFERRED";
      const record: AyasInboxDecisionRecord = { decisionId: `ayas-decision-${crypto.randomUUID()}`, proposalId, proposalHash: existing.proposalHash, decision, decidedAt: now, ...(reason ? { reason: scrub(reason, 400) } : {}), evidenceFingerprint: digest(existing.evidence), ...(decision === "APPROVE" ? { authorizationId: `ayas-dev-auth-${crypto.randomUUID()}` } : {}) };
      const proposal = { ...existing, status: nextStatus, lastUpdatedAt: now, ...(decision === "LATER" ? { nextEligibleAt: new Date(Date.parse(now) + 24 * 60 * 60 * 1000).toISOString() } : {}) };
      save({ ...state, proposals: state.proposals.map((p) => p.proposalId === proposalId ? proposal : p), decisions: [...state.decisions, record] });
      return { proposal, decision: record };
    },
    consumeApproval(proposalId, proposalHashValue, baseHead, exactFiles, now) {
      const state = load();
      const proposal = state.proposals.find((p) => p.proposalId === proposalId);
      const decision = [...state.decisions].reverse().find((d) => d.proposalId === proposalId && d.decision === "APPROVE");
      if (!proposal || !decision || proposal.status !== "APPROVED" || decision.authorizationConsumedAt) throw new AyasApprovalInboxStoreError("AYAS_INBOX_INVALID", "approval is missing, stale, or already consumed");
      // Redundant with the SAFE-only check in `decide()`: a proposal can only
      // reach status "APPROVED" via `decide()`, which already refuses
      // non-SAFE proposals — this re-check is defense-in-depth against any
      // future path that could otherwise flip `status` to "APPROVED" directly.
      if (!isAyasProposalApprovalReady(proposal) || !decision.authorizationId) throw new AyasApprovalInboxStoreError("AYAS_INBOX_UNSAFE_APPROVAL", `refusing to consume authorization for an unsafe or explanation-incomplete proposal: ${proposal.safetyClassification}`);
      if (proposal.proposalHash !== proposalHashValue || proposal.baseHead !== baseHead || JSON.stringify([...proposal.exactFiles]) !== JSON.stringify([...exactFiles])) throw new AyasApprovalInboxStoreError("AYAS_INBOX_INVALID", "approval scope or HEAD is stale");
      const consumed = { ...decision, authorizationConsumedAt: now };
      save({ ...state, decisions: state.decisions.map((d) => d.decisionId === decision.decisionId ? consumed : d) });
      return consumed;
    },
    reserveApproval(proposalId, proposalHashValue, baseHead, exactFiles, now) {
      const state = load();
      const proposal = state.proposals.find((p) => p.proposalId === proposalId);
      const decision = [...state.decisions].reverse().find((d) => d.proposalId === proposalId && d.decision === "APPROVE");
      // A decision already used by either phase-1 mechanism (this one or the
      // deprecated single-phase `consumeApproval`) can never be reserved
      // again — the two mechanisms share one underlying one-shot guard.
      if (!proposal || !decision || proposal.status !== "APPROVED" || decision.authorizationConsumedAt || decision.reservedAt) {
        throw new AyasApprovalInboxStoreError("AYAS_INBOX_INVALID", "approval is missing, stale, or already reserved/consumed");
      }
      if (!isAyasProposalApprovalReady(proposal) || !decision.authorizationId) {
        throw new AyasApprovalInboxStoreError("AYAS_INBOX_UNSAFE_APPROVAL", `refusing to reserve authorization for an unsafe or explanation-incomplete proposal: ${proposal.safetyClassification}`);
      }
      if (proposal.proposalHash !== proposalHashValue || proposal.baseHead !== baseHead || JSON.stringify([...proposal.exactFiles]) !== JSON.stringify([...exactFiles])) {
        throw new AyasApprovalInboxStoreError("AYAS_INBOX_INVALID", "approval scope or HEAD is stale");
      }
      const reservationId = `ayas-reservation-${crypto.randomUUID()}`;
      const reserved = { ...decision, reservationId, reservedAt: now };
      const reservedProposal = { ...proposal, status: "RESERVED" as const, lastUpdatedAt: now };
      save({
        ...state,
        proposals: state.proposals.map((p) => p.proposalId === proposalId ? reservedProposal : p),
        decisions: state.decisions.map((d) => d.decisionId === decision.decisionId ? reserved : d),
      });
      return { reservationId, authorizationId: decision.authorizationId, decisionId: decision.decisionId };
    },
    finalizeApproval(reservationId, outcome, now) {
      const state = load();
      const decision = state.decisions.find((d) => d.reservationId === reservationId);
      if (!decision) throw new AyasApprovalInboxStoreError("AYAS_INBOX_INVALID", "reservation not found");
      if (decision.finalizedAt) throw new AyasApprovalInboxStoreError("AYAS_INBOX_INVALID", "reservation already finalized");
      const proposal = state.proposals.find((p) => p.proposalId === decision.proposalId);
      // Structural invariant, enforced here rather than by caller ordering
      // discipline (the same principle as the SAFE-only check in `decide`):
      // "EXECUTED" may only be recorded once a real result already exists
      // (`recordResult` has already moved the proposal to a terminal result
      // status). Without this, a caller that finalized EXECUTED before
      // recording a result could leave a successfully-authorized proposal
      // durably stuck at "RESERVED" forever — indistinguishable from an
      // execution that never happened.
      if (outcome === "EXECUTED" && proposal?.status !== "COMPLETED" && proposal?.status !== "FAILED" && proposal?.status !== "STALE") {
        throw new AyasApprovalInboxStoreError("AYAS_INBOX_INVALID", "cannot finalize EXECUTED before a result has been durably recorded");
      }
      const finalized = { ...decision, finalizedAt: now, finalizationOutcome: outcome };
      // "EXECUTED" leaves the proposal's status alone — `recordResult` is
      // the durable record of a real execution outcome (COMPLETED/FAILED/
      // STALE) and remains the single source of truth for that. This call
      // only marks the reservation itself as spent. For ABANDONED/
      // RECOVERY_REQUIRED, `recordResult` is never reached (no execution to
      // record), so this is the only place those terminal statuses are set.
      const nextProposals = proposal && outcome !== "EXECUTED"
        ? state.proposals.map((p) => p.proposalId === decision.proposalId ? { ...p, status: outcome, lastUpdatedAt: now } : p)
        : state.proposals;
      save({ ...state, proposals: nextProposals, decisions: state.decisions.map((d) => d.decisionId === decision.decisionId ? finalized : d) });
    },
    recordResult(result, status) {
      const state = load();
      const proposal = state.proposals.find((p) => p.proposalId === result.proposalId);
      if (!proposal) throw new AyasApprovalInboxStoreError("AYAS_INBOX_INVALID", "result proposal not found");
      save({ ...state, proposals: state.proposals.map((p) => p.proposalId === result.proposalId ? { ...p, status, lastUpdatedAt: result.completedAt } : p), results: [...state.results, result].slice(-100) });
    },
  };
}
