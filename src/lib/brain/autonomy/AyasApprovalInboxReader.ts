import fs from "node:fs";
import path from "node:path";

export const ayasApprovalInboxSchemaVersion = "1" as const;
/**
 * Kept in sync with the Store's own `AyasInboxProposalStatus` by hand (this
 * module deliberately has zero import of the Store — see the module doc
 * below) rather than imported, so this listing must be updated whenever the
 * Store's status union changes. This is a compile-time accuracy concern
 * only: `readAyasApprovalInboxProposals` never validates `status` against
 * this union at runtime (see below), so an out-of-date list here cannot
 * cause a crash or a misread — only a stale type hint.
 */
export type AyasInboxProposalStatus = "PENDING" | "APPROVED" | "REJECTED" | "DEFERRED" | "STALE" | "COMPLETED" | "FAILED" | "RESERVED" | "ABANDONED" | "RECOVERY_REQUIRED";

export interface AyasInboxProposalRead {
  readonly proposalId: string;
  readonly proposalHash: string;
  readonly createdAt: string;
  readonly lastUpdatedAt: string;
  readonly objective: string;
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
  readonly exactFiles: readonly string[];
  readonly expectedDiffScope: string;
  readonly risk: string;
  readonly safetyClassification: "SAFE" | "REVIEW_REQUIRED" | "FORBIDDEN_AUTONOMOUS";
  readonly testsPlanned: readonly string[];
  readonly status: AyasInboxProposalStatus;
  readonly baseHead: string;
  readonly nextEligibleAt?: string;
}

export interface AyasInboxDecisionRead {
  readonly decisionId: string;
  readonly proposalId: string;
  readonly decision: "APPROVE" | "REJECT" | "LATER";
  readonly decidedAt: string;
  readonly reservedAt?: string;
  readonly finalizedAt?: string;
  readonly finalizationOutcome?: "EXECUTED" | "ABANDONED" | "RECOVERY_REQUIRED";
}

export interface AyasInboxResultRead {
  readonly resultId: string;
  readonly proposalId: string;
  readonly completedAt: string;
  readonly outcome: "COMPLETED" | "FAILED" | "ROLLED_BACK" | "STALE";
  readonly testsRun: readonly string[];
  readonly testResults: readonly string[];
}

export interface AyasApprovalInboxReadState {
  readonly proposals: readonly AyasInboxProposalRead[];
  readonly decisions: readonly AyasInboxDecisionRead[];
  readonly results: readonly AyasInboxResultRead[];
}

export class AyasApprovalInboxReaderError extends Error {
  constructor(readonly code: "AYAS_INBOX_READ_CORRUPT" | "AYAS_INBOX_READ_SCHEMA_MISMATCH", message: string) {
    super(message);
    this.name = "AyasApprovalInboxReaderError";
    this.stack = undefined;
  }
}

export interface AyasApprovalInboxReaderOptions { readonly rootDir?: string; }

/**
 * Read-only projection over the durable approval-inbox file, for the Stage 7A
 * display path. It parses `data/brain/autonomy/approval-inbox.json` directly
 * and never writes to it. It imports no authority-bearing store/daemon/gate
 * module and exposes no proposal-creation, decision, consumption, or
 * authorization API — only `readAyasApprovalInboxProposals()`.
 *
 * Failure semantics mirror the durable store's own read path exactly: a
 * missing file is an empty inbox (no proposals yet); malformed JSON or an
 * unsupported/invalid shape throws rather than being silently reinterpreted,
 * so a corrupt file is never mistaken for an empty or partial one. The
 * caller (`AyasApprovalInboxView`) already treats any thrown error as
 * "disconnected" for display purposes — this module does not repair or
 * rewrite corrupt state.
 */
export function readAyasApprovalInboxState(options: AyasApprovalInboxReaderOptions = {}): AyasApprovalInboxReadState {
  const root = path.resolve(options.rootDir ?? path.join(process.cwd(), "data", "brain"));
  const stateFile = path.join(root, "autonomy", "approval-inbox.json");
  if (!fs.existsSync(stateFile)) return { proposals: [], decisions: [], results: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  } catch (error) {
    throw new AyasApprovalInboxReaderError("AYAS_INBOX_READ_CORRUPT", `approval-inbox.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new AyasApprovalInboxReaderError("AYAS_INBOX_READ_CORRUPT", "approval-inbox.json has an invalid shape");
  const state = parsed as { readonly schemaVersion?: unknown; readonly proposals?: unknown; readonly decisions?: unknown; readonly results?: unknown };
  if (state.schemaVersion !== ayasApprovalInboxSchemaVersion) throw new AyasApprovalInboxReaderError("AYAS_INBOX_READ_SCHEMA_MISMATCH", "approval-inbox.json schema is unsupported");
  if (!Array.isArray(state.proposals) || !Array.isArray(state.decisions) || !Array.isArray(state.results)) throw new AyasApprovalInboxReaderError("AYAS_INBOX_READ_CORRUPT", "approval-inbox.json durable collections are invalid");
  return { proposals: state.proposals as readonly AyasInboxProposalRead[], decisions: state.decisions as readonly AyasInboxDecisionRead[], results: state.results as readonly AyasInboxResultRead[] };
}

export function readAyasApprovalInboxProposals(options: AyasApprovalInboxReaderOptions = {}): readonly AyasInboxProposalRead[] {
  return readAyasApprovalInboxState(options).proposals;
}
