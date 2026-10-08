/**
 * Owner provenance for approval decisions (AYAS V1 security condition, owner
 * decision 3 of 2026-10-08).
 *
 * Before this module a decision record carried what was decided and when, but
 * not who decided it: `requireBrainSession` verified the cookie and returned
 * nothing. An admission is the server's own record of that verification,
 * attached to the exact decision it authorized:
 *
 * - who: the one principal the access gate admits (single-owner studio — the
 *   holder of the owner passcode session; never a client-supplied name);
 * - which login: a keyed, non-reversible reference to the verified cookie;
 * - what: the exact proposal/batch id, its hash and the decision;
 * - when: the session's verified issue/expiry and the verification time;
 * - which operation: a server-generated action reference, usable once.
 *
 * It is built only from the verified cookie and server state, and sealed with
 * the access key. Nothing here grants authority: the existing session gate,
 * stores, hashes and firewalls stay the authority. This adds the missing
 * attribution and makes the owner actions fail closed when it is missing.
 *
 * No approval system of its own: the stores record an admission next to the
 * decision they already make, and owner actions refuse to decide without one.
 * Historical decisions are never rewritten; a decision recorded before this
 * existed simply has no admission and stays unattributed.
 */

import crypto from "node:crypto";

import { keyedAuditDigest, readVerifiedSessionClaims, resolveAccessGate, type AccessGateConfig } from "../../auth/accessGate";
import type { AyasInboxDecisionRecord } from "./AyasApprovalInboxStore";

export const AYAS_OWNER_ADMISSION_SCHEMA = "ayas-owner-admission:v1";
export const AYAS_OWNER_ADMISSION_AUTH_METHOD = "AYAS_OWNER_SESSION_HMAC_V1";
/** A decision must be recorded within this long after its session was verified. */
export const AYAS_OWNER_ADMISSION_MAX_AGE_MS = 5 * 60 * 1000;
const CLOCK_SKEW_MS = 60 * 1000;
const SESSION_REFERENCE_DOMAIN = "ayas-owner-session-reference:v1";
const SEAL_DOMAIN = "ayas-owner-admission-seal:v1";

export type AyasOwnerAdmissionAction =
  | "decideAyasApproval"
  | "executeAyasApprovedProposal"
  | "executeAyasApprovedMicroBatch"
  | "batchOnaylaVeUygula"
  | "proposalOnaylaVeUygula"
  | "ayasOwnerApprovalDecision";

export type AyasOwnerAdmissionSubject =
  | { readonly kind: "proposal"; readonly proposalId: string; readonly proposalHash: string; readonly decision: "APPROVE" | "REJECT" | "LATER" | "EXECUTE" }
  | { readonly kind: "micro-batch"; readonly batchId: string; readonly batchHash: string; readonly decision: "APPROVE" | "REJECT" | "EXECUTE" };

export interface AyasOwnerAdmission {
  readonly schema: typeof AYAS_OWNER_ADMISSION_SCHEMA;
  /** The single principal the access gate admits. Not a named person. */
  readonly principal: "OWNER";
  readonly authMethod: typeof AYAS_OWNER_ADMISSION_AUTH_METHOD;
  readonly action: AyasOwnerAdmissionAction;
  /** Server-generated, one per owner action call; a store accepts it once. */
  readonly actionRef: string;
  /** Keyed digest of the verified cookie: identifies the login, is not a credential. */
  readonly sessionRef: string;
  readonly sessionIssuedAt: string;
  readonly sessionExpiresAt: string;
  readonly verifiedAt: string;
  readonly subject: AyasOwnerAdmissionSubject;
  /** Keyed digest over every field above; verifiable later with the access key. */
  readonly seal: string;
}

export class AyasOwnerAdmissionError extends Error {
  constructor(readonly code: "OWNER_ADMISSION_REQUIRED" | "OWNER_ADMISSION_GATE_UNAVAILABLE" | "OWNER_ADMISSION_INVALID_SUBJECT") {
    // The message is the code: server actions surface `error.message`, and the
    // code is the only thing the owner-facing label lookup can match.
    super(code);
    this.name = "AyasOwnerAdmissionError";
    this.stack = undefined;
  }
}

const ACTIONS: ReadonlySet<string> = new Set<AyasOwnerAdmissionAction>(["decideAyasApproval", "executeAyasApprovedProposal", "executeAyasApprovedMicroBatch", "batchOnaylaVeUygula", "proposalOnaylaVeUygula", "ayasOwnerApprovalDecision"]);
const PROPOSAL_DECISIONS: ReadonlySet<string> = new Set(["APPROVE", "REJECT", "LATER", "EXECUTE"]);
const BATCH_DECISIONS: ReadonlySet<string> = new Set(["APPROVE", "REJECT", "EXECUTE"]);
const HEX64 = /^[0-9a-f]{64}$/;
const ACTION_REF = /^ayas-owner-action-[0-9a-f-]{36}$/;
const nonEmpty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= 200;
const isIso = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value;

/** Stable JSON with sorted keys, so a seal never depends on property order. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function normalizeSubject(subject: AyasOwnerAdmissionSubject): AyasOwnerAdmissionSubject | null {
  if (!subject || typeof subject !== "object") return null;
  if (subject.kind === "proposal" && nonEmpty(subject.proposalId) && nonEmpty(subject.proposalHash) && PROPOSAL_DECISIONS.has(subject.decision)) {
    return { kind: "proposal", proposalId: subject.proposalId, proposalHash: subject.proposalHash, decision: subject.decision };
  }
  if (subject.kind === "micro-batch" && nonEmpty(subject.batchId) && nonEmpty(subject.batchHash) && BATCH_DECISIONS.has(subject.decision)) {
    return { kind: "micro-batch", batchId: subject.batchId, batchHash: subject.batchHash, decision: subject.decision };
  }
  return null;
}

/**
 * Builds the admission for one owner action from the verified cookie. Fails
 * closed: a gate that is not enforced (including local dev with no access key)
 * or a cookie that does not verify yields no admission, so no decision.
 */
export async function admitAyasOwnerApproval(input: {
  readonly gate: AccessGateConfig;
  readonly token: string | undefined;
  readonly action: AyasOwnerAdmissionAction;
  readonly subject: AyasOwnerAdmissionSubject;
  readonly now?: number;
}): Promise<AyasOwnerAdmission> {
  if (input.gate.mode !== "enforced" || typeof input.gate.key !== "string") throw new AyasOwnerAdmissionError("OWNER_ADMISSION_GATE_UNAVAILABLE");
  if (!ACTIONS.has(input.action)) throw new AyasOwnerAdmissionError("OWNER_ADMISSION_INVALID_SUBJECT");
  const subject = normalizeSubject(input.subject);
  if (!subject) throw new AyasOwnerAdmissionError("OWNER_ADMISSION_INVALID_SUBJECT");
  const now = input.now ?? Date.now();
  const claims = await readVerifiedSessionClaims(input.token, input.gate.key, now);
  if (!claims?.nonce) throw new AyasOwnerAdmissionError("OWNER_ADMISSION_REQUIRED");
  const unsealed: Omit<AyasOwnerAdmission, "seal"> = {
    schema: AYAS_OWNER_ADMISSION_SCHEMA,
    principal: "OWNER",
    authMethod: AYAS_OWNER_ADMISSION_AUTH_METHOD,
    action: input.action,
    actionRef: `ayas-owner-action-${crypto.randomUUID()}`,
    sessionRef: await keyedAuditDigest(SESSION_REFERENCE_DOMAIN, input.token as string, input.gate.key),
    sessionIssuedAt: new Date(claims.issuedAt * 1000).toISOString(),
    sessionExpiresAt: new Date(claims.expiresAt * 1000).toISOString(),
    verifiedAt: new Date(now).toISOString(),
    subject,
  };
  return { ...unsealed, seal: await keyedAuditDigest(SEAL_DOMAIN, canonicalJson(unsealed), input.gate.key) };
}

/** True when the seal matches under `key`, i.e. the record was written by something holding the access key and was not edited since. */
export function verifyAyasOwnerAdmissionSealSync(admission: unknown, key: string | undefined = resolveAccessGate().key): admission is AyasOwnerAdmission {
  if (!key || key.length < 12 || !isAyasOwnerAdmissionShape(admission)) return false;
  const { seal, ...unsealed } = admission;
  const expected = crypto.createHmac("sha256", key).update(SEAL_DOMAIN + "\n" + canonicalJson(unsealed)).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(seal), Buffer.from(expected));
}

export async function verifyAyasOwnerAdmissionSeal(admission: AyasOwnerAdmission, key: string): Promise<boolean> {
  return verifyAyasOwnerAdmissionSealSync(admission, key);
}

/** Key-free structural check: every field present and well formed. */
export function isAyasOwnerAdmissionShape(value: unknown): value is AyasOwnerAdmission {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const a = value as Record<string, unknown>;
  const keys = Object.keys(a).sort().join(",");
  if (keys !== "action,actionRef,authMethod,principal,schema,seal,sessionExpiresAt,sessionIssuedAt,sessionRef,subject,verifiedAt") return false;
  return a.schema === AYAS_OWNER_ADMISSION_SCHEMA
    && a.principal === "OWNER"
    && a.authMethod === AYAS_OWNER_ADMISSION_AUTH_METHOD
    && typeof a.action === "string" && ACTIONS.has(a.action)
    && typeof a.actionRef === "string" && ACTION_REF.test(a.actionRef)
    && typeof a.sessionRef === "string" && HEX64.test(a.sessionRef)
    && typeof a.seal === "string" && HEX64.test(a.seal)
    && isIso(a.sessionIssuedAt) && isIso(a.sessionExpiresAt) && isIso(a.verifiedAt)
    && Date.parse(a.sessionExpiresAt as string) > Date.parse(a.verifiedAt as string)
    && normalizeSubject(a.subject as AyasOwnerAdmissionSubject) !== null
    && canonicalJson(normalizeSubject(a.subject as AyasOwnerAdmissionSubject)) === canonicalJson(a.subject);
}

export type AyasOwnerAdmissionBindingResult = { readonly ok: true } | { readonly ok: false; readonly reason: "INVALID_SEAL" | "INVALID_ACTION" | "MALFORMED" | "SUBJECT_MISMATCH" | "ACTION_REF_REUSED" | "STALE" | "FUTURE" };

/**
 * Cryptographic check a store runs before recording: the admission is well formed,
 * names exactly this subject, has not been used before, and is fresh at the
 * decision time `at`.
 */
export function checkAyasOwnerAdmissionBinding(admission: unknown, expected: {
  readonly subject: AyasOwnerAdmissionSubject;
  readonly at: string;
  readonly usedActionRefs: ReadonlySet<string>;
}): AyasOwnerAdmissionBindingResult {
  if (!isAyasOwnerAdmissionShape(admission)) return { ok: false, reason: "MALFORMED" };
  if (!verifyAyasOwnerAdmissionSealSync(admission)) return { ok: false, reason: "INVALID_SEAL" };
  if (!isAyasOwnerAdmissionActionCompatible(admission)) return { ok: false, reason: "INVALID_ACTION" };
  const subject = normalizeSubject(expected.subject);
  if (!subject || canonicalJson(subject) !== canonicalJson(admission.subject)) return { ok: false, reason: "SUBJECT_MISMATCH" };
  if (expected.usedActionRefs.has(admission.actionRef)) return { ok: false, reason: "ACTION_REF_REUSED" };
  const at = Date.parse(expected.at); const verified = Date.parse(admission.verifiedAt);
  if (!Number.isFinite(at)) return { ok: false, reason: "MALFORMED" };
  if (verified > at + CLOCK_SKEW_MS) return { ok: false, reason: "FUTURE" };
  if (at - verified > AYAS_OWNER_ADMISSION_MAX_AGE_MS || Date.parse(admission.sessionExpiresAt) <= at) return { ok: false, reason: "STALE" };
  return { ok: true };
}

/** Every action reference already recorded in a store's decisions. */
export function ayasUsedOwnerActionRefs(decisions: readonly { readonly ownerAdmission?: AyasOwnerAdmission; readonly executionOwnerAdmission?: AyasOwnerAdmission }[]): ReadonlySet<string> {
  return new Set(decisions.flatMap((decision) => [decision.ownerAdmission?.actionRef, decision.executionOwnerAdmission?.actionRef]).filter((ref): ref is string => typeof ref === "string"));
}

/**
 * True only when an APPROVE decision carries an admission for exactly this
 * proposal and hash, recorded within the freshness window. A decision made
 * before admissions existed is never treated as attributed.
 */
export function isAyasApprovalDecisionOwnerAdmitted(
  decision: Pick<AyasInboxDecisionRecord, "decision" | "decidedAt" | "proposalId" | "proposalHash" | "ownerAdmission" | "decisionId" | "authorizationId" | "ownerDecisionSeal"> | undefined,
  proposal: { readonly proposalId: string; readonly proposalHash: string },
): boolean {
  if (!decision || decision.decision !== "APPROVE" || decision.proposalId !== proposal.proposalId || decision.proposalHash !== proposal.proposalHash) return false;
  return verifyAyasOwnerDecisionSeal(decision) && checkAyasOwnerAdmissionBinding(decision.ownerAdmission, {
    subject: { kind: "proposal", proposalId: proposal.proposalId, proposalHash: proposal.proposalHash, decision: "APPROVE" },
    at: decision.decidedAt,
    usedActionRefs: new Set(),
  }).ok;
}

const RESERVED_REASON_PREFIXES = ["owner-approved:", "owner-rejected:", "ayas-internal:"] as const;

/**
 * Provenance prefixes only server code writes into a decision `reason` (one of
 * them is machine-matched by the resume worker). A reason typed by a client
 * must never carry one.
 */
export function isAyasReservedDecisionReason(reason: unknown): boolean {
  if (typeof reason !== "string") return false;
  const normalized = reason.normalize("NFKC").trim().toLowerCase();
  return RESERVED_REASON_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

/** A verified action must match its exact subject and decision. */
export function isAyasOwnerAdmissionActionCompatible(a: AyasOwnerAdmission): boolean {
  if (a.subject.kind === "micro-batch") return a.subject.decision === "EXECUTE" ? a.action === "executeAyasApprovedMicroBatch" : a.action === "batchOnaylaVeUygula";
  if (a.subject.decision === "EXECUTE") return a.action === "executeAyasApprovedProposal";
  if (a.action === "decideAyasApproval") return true;
  if (a.action === "ayasOwnerApprovalDecision") return a.subject.decision !== "LATER";
  return a.action === "proposalOnaylaVeUygula" && a.subject.decision === "APPROVE";
}

type OwnerDecision = { readonly decisionId: string; readonly authorizationId?: string; readonly decidedAt: string; readonly ownerAdmission?: AyasOwnerAdmission; readonly ownerDecisionSeal?: string };
function ownerDecisionMaterial(d: OwnerDecision): string {
  return canonicalJson({ decisionId: d.decisionId, authorizationId: d.authorizationId ?? null, decidedAt: d.decidedAt, ownerAdmission: d.ownerAdmission });
}
export function sealAyasOwnerDecision(d: OwnerDecision): string {
  const key = resolveAccessGate().key;
  if (!key || !verifyAyasOwnerAdmissionSealSync(d.ownerAdmission, key)) throw new AyasOwnerAdmissionError("OWNER_ADMISSION_REQUIRED");
  return crypto.createHmac("sha256", key).update("ayas-owner-decision:v1\n" + ownerDecisionMaterial(d)).digest("hex");
}
export function verifyAyasOwnerDecisionSeal(d: OwnerDecision): boolean {
  if (typeof d.ownerDecisionSeal !== "string" || !HEX64.test(d.ownerDecisionSeal) || !verifyAyasOwnerAdmissionSealSync(d.ownerAdmission)) return false;
  const expected = sealAyasOwnerDecision(d);
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(d.ownerDecisionSeal));
}

export function checkAyasOwnerExecutionAdmission(d: OwnerDecision, admission: unknown, subject: AyasOwnerAdmissionSubject, at: string, usedActionRefs: ReadonlySet<string>): boolean {
  if (!verifyAyasOwnerDecisionSeal(d) || !d.ownerAdmission || d.ownerAdmission.subject.decision !== "APPROVE" || !isAyasOwnerAdmissionShape(admission)) return false;
  const approvalSubject = { ...subject, decision: "APPROVE" } as AyasOwnerAdmissionSubject;
  if (!checkAyasOwnerAdmissionBinding(d.ownerAdmission, { subject: approvalSubject, at: d.decidedAt, usedActionRefs: new Set() }).ok) return false;
  // Every execution is a distinct, freshly verified action. Durable APPROVE is consent only.
  const action = subject.kind === "micro-batch" ? "executeAyasApprovedMicroBatch" : "executeAyasApprovedProposal";
  if (admission.action !== action || admission.subject.decision !== "EXECUTE") return false;
  return checkAyasOwnerAdmissionBinding(admission, { subject, at, usedActionRefs }).ok;
}
