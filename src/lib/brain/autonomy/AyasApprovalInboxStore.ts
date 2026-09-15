import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { containsBrainSecret, redactBrainText } from "../BrainRedaction";

export const ayasApprovalInboxSchemaVersion = "1" as const;
export type AyasInboxDecision = "APPROVE" | "REJECT" | "LATER";
export type AyasInboxProposalStatus = "PENDING" | "APPROVED" | "REJECTED" | "DEFERRED" | "STALE" | "COMPLETED" | "FAILED";

export interface AyasInboxProposal {
  readonly schemaVersion: typeof ayasApprovalInboxSchemaVersion;
  readonly proposalId: string;
  readonly createdAt: string;
  readonly lastUpdatedAt: string;
  readonly baseBranch: string;
  readonly baseHead: string;
  readonly objective: string;
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
  readonly authorizationConsumedAt?: string;
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

export interface AyasApprovalInboxHandle {
  readonly stateFile: string;
  load(): AyasApprovalInboxState;
  save(state: AyasApprovalInboxState): AyasApprovalInboxState;
  createProposal(input: Omit<AyasInboxProposal, "schemaVersion" | "proposalId" | "lastUpdatedAt" | "proposalHash" | "status" | "createdBy"> & { proposalId?: string }): AyasInboxProposal;
  decide(proposalId: string, decision: AyasInboxDecision, now: string, reason?: string): { proposal: AyasInboxProposal; decision: AyasInboxDecisionRecord };
  consumeApproval(proposalId: string, proposalHashValue: string, baseHead: string, exactFiles: readonly string[], now: string): AyasInboxDecisionRecord;
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
      assertNoSecret([input.objective, input.rationale, ...evidence, ...graphifyEvidence, ...exactFiles]);
      const base = {
        ...input,
        proposalId: input.proposalId ?? `ayas-proposal-${crypto.randomUUID()}`,
        lastUpdatedAt: now,
        exactFiles,
        evidence,
        graphifyEvidence,
        createdBy: "ayas-daemon" as const,
      };
      const proposal = { ...base, schemaVersion: ayasApprovalInboxSchemaVersion, proposalHash: proposalHash(base), status: "PENDING" as const };
      const state = load();
      const duplicate = state.proposals.find((p) => p.proposalHash === proposal.proposalHash && ["PENDING", "APPROVED", "REJECTED", "DEFERRED"].includes(p.status));
      if (duplicate) return duplicate;
      save({ ...state, proposals: [...state.proposals, proposal] });
      return proposal;
    },
    decide(proposalId, decision, now, reason) {
      const state = load();
      const existing = state.proposals.find((p) => p.proposalId === proposalId);
      if (!existing) throw new AyasApprovalInboxStoreError("AYAS_INBOX_INVALID", "proposal not found");
      if (existing.status !== "PENDING" && !(decision === "LATER" && existing.status === "DEFERRED")) throw new AyasApprovalInboxStoreError("AYAS_INBOX_INVALID", `proposal is not pending: ${existing.status}`);
      // Authority boundary: only a SAFE-classified proposal may ever be
      // approved. This is enforced here, not merely by callers, so no future
      // caller of `decide()` can mint an authorization for a REVIEW_REQUIRED
      // or FORBIDDEN_AUTONOMOUS proposal by omitting its own pre-check.
      if (decision === "APPROVE" && existing.safetyClassification !== "SAFE") throw new AyasApprovalInboxStoreError("AYAS_INBOX_UNSAFE_APPROVAL", `only SAFE proposals may be approved, got: ${existing.safetyClassification}`);
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
      if (proposal.safetyClassification !== "SAFE" || !decision.authorizationId) throw new AyasApprovalInboxStoreError("AYAS_INBOX_UNSAFE_APPROVAL", `refusing to consume authorization for a non-SAFE proposal: ${proposal.safetyClassification}`);
      if (proposal.proposalHash !== proposalHashValue || proposal.baseHead !== baseHead || JSON.stringify([...proposal.exactFiles]) !== JSON.stringify([...exactFiles])) throw new AyasApprovalInboxStoreError("AYAS_INBOX_INVALID", "approval scope or HEAD is stale");
      const consumed = { ...decision, authorizationConsumedAt: now };
      save({ ...state, decisions: state.decisions.map((d) => d.decisionId === decision.decisionId ? consumed : d) });
      return consumed;
    },
    recordResult(result, status) {
      const state = load();
      const proposal = state.proposals.find((p) => p.proposalId === result.proposalId);
      if (!proposal) throw new AyasApprovalInboxStoreError("AYAS_INBOX_INVALID", "result proposal not found");
      save({ ...state, proposals: state.proposals.map((p) => p.proposalId === result.proposalId ? { ...p, status, lastUpdatedAt: result.completedAt } : p), results: [...state.results, result].slice(-100) });
    },
  };
}
