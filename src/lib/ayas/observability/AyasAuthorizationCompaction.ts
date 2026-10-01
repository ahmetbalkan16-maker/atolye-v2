import { AYAS_AUTHORIZATION_RETENTION_FLOOR_MS, type AyasExecutionAuthorizationRecord, type AyasExecutionAuthorizationStore } from "../execution/AyasExecutionAuthorization";
import { deriveAyasLeaseEvidence, type AyasOperationEvidence } from "./AyasOperationEvidence";
import type { AyasOperationEvidenceStore } from "./AyasOperationEvidenceStore";

/**
 * Stage 15F — retention for the authorization store.
 *
 * Every lease is one file and nothing removed them, so the directory grows
 * with every tool call and every observer tick. Compaction moves an old
 * record into the evidence stream and then removes the file:
 *
 *   record (identity, times, state)  ->  one evidence line  ->  file removed
 *
 * What is kept is the privacy-bounded evidence: who, what action, when, how
 * it ended. What is dropped is the bounded plan and scope of a lease that
 * can never be used again.
 *
 * Same shape as `AyasStorageHygiene`: `audit` is read-only and says exactly
 * what would be compacted; `apply` does that and nothing else. A record is
 * removed only after its evidence is in the stream. Order makes it safe to
 * interrupt: a crash between the two steps leaves the record in place, and
 * the next run finds the evidence already written and only removes the file.
 *
 * Never compacted: a record younger than the minimum age, a file that is not
 * a valid record (left for review), and a record whose evidence cannot be
 * expressed in the closed evidence shape.
 *
 * This is an operator action. No daemon calls it.
 */
export const AYAS_AUTHORIZATION_COMPACTION_DEFAULT_MIN_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface AyasAuthorizationCompactionOptions {
  readonly authorizations: Pick<AyasExecutionAuthorizationStore, "scan" | "removeInert">;
  readonly evidence: Pick<AyasOperationEvidenceStore, "append" | "read">;
  readonly nowMs: number;
  /** Age past a record's expiry. Never below the store's own retention floor. */
  readonly minAgeMs?: number;
}

export interface AyasAuthorizationCompactionCandidate {
  readonly authorizationId: string;
  readonly action: string;
  readonly outcome: AyasOperationEvidence["outcome"];
  readonly expiresAt: string;
  /** True when the evidence line is already in the stream from an interrupted run. */
  readonly evidencePresent: boolean;
}

export interface AyasAuthorizationCompactionPlan {
  readonly minAgeMs: number;
  readonly scanned: number;
  readonly eligible: readonly AyasAuthorizationCompactionCandidate[];
  readonly retainedYoung: number;
  /** Consumed records may still settle, even after expiry. Never removed. */
  readonly retainedUnsettled: readonly string[];
  /** Old enough, but the record does not fit the evidence shape. Kept. */
  readonly retainedNotRepresentable: readonly string[];
  /** Files that are not valid records. Kept and never touched. */
  readonly unreadable: readonly string[];
}

export interface AyasAuthorizationCompactionResult extends AyasAuthorizationCompactionPlan {
  readonly compacted: readonly string[];
  readonly failed: readonly { readonly authorizationId: string; readonly reason: "EVIDENCE_NOT_WRITTEN" | "REMOVE_REFUSED" }[];
}

function minAge(options: AyasAuthorizationCompactionOptions): number {
  const requested = options.minAgeMs ?? AYAS_AUTHORIZATION_COMPACTION_DEFAULT_MIN_AGE_MS;
  if (!Number.isSafeInteger(requested) || requested < AYAS_AUTHORIZATION_RETENTION_FLOOR_MS) throw new Error("AYAS_AUTHORIZATION_COMPACTION_MIN_AGE_BELOW_FLOOR");
  if (!Number.isFinite(options.nowMs)) throw new Error("AYAS_AUTHORIZATION_COMPACTION_CLOCK_INVALID");
  return requested;
}

interface Planned { readonly plan: AyasAuthorizationCompactionPlan; readonly work: readonly { readonly record: AyasExecutionAuthorizationRecord; readonly evidence: AyasOperationEvidence; readonly present: boolean }[]; }

function planCompaction(options: AyasAuthorizationCompactionOptions): Planned {
  const minAgeMs = minAge(options);
  const { records, unreadable } = options.authorizations.scan();
  const present = new Set(options.evidence.read().records.filter((record) => record.source === "lease").map((record) => record.id));
  const work: { record: AyasExecutionAuthorizationRecord; evidence: AyasOperationEvidence; present: boolean }[] = [];
  const retainedNotRepresentable: string[] = [];
  const retainedUnsettled: string[] = [];
  let retainedYoung = 0;
  for (const record of records) {
    if (!(options.nowMs - Date.parse(record.expiresAt) >= minAgeMs)) { retainedYoung += 1; continue; }
    if (record.consumedAt !== undefined && record.settledAt === undefined) { retainedUnsettled.push(record.authorizationId); continue; }
    const evidence = deriveAyasLeaseEvidence(record, options.nowMs);
    if (!evidence) { retainedNotRepresentable.push(record.authorizationId); continue; }
    work.push({ record, evidence, present: present.has(record.authorizationId) });
  }
  return {
    work,
    plan: {
      minAgeMs, scanned: records.length + unreadable.length, retainedYoung, retainedUnsettled, retainedNotRepresentable, unreadable,
      eligible: work.map((item) => ({ authorizationId: item.record.authorizationId, action: item.record.action, outcome: item.evidence.outcome, expiresAt: item.record.expiresAt, evidencePresent: item.present })),
    },
  };
}

/** Read-only: what a compaction run would do. Touches no file. */
export function auditAyasAuthorizationCompaction(options: AyasAuthorizationCompactionOptions): AyasAuthorizationCompactionPlan {
  return planCompaction(options).plan;
}

/** Writes the evidence line for each eligible record, then removes the record. */
export function applyAyasAuthorizationCompaction(options: AyasAuthorizationCompactionOptions): AyasAuthorizationCompactionResult {
  const { plan, work } = planCompaction(options);
  const compacted: string[] = [];
  const failed: { authorizationId: string; reason: "EVIDENCE_NOT_WRITTEN" | "REMOVE_REFUSED" }[] = [];
  for (const item of work) {
    const authorizationId = item.record.authorizationId;
    let evidenceReady = true;
    try {
      options.authorizations.removeInert(authorizationId, (current) => {
        const evidence = deriveAyasLeaseEvidence(current, options.nowMs);
        evidenceReady = false;
        if (!evidence || evidence.evidenceDigest !== item.evidence.evidenceDigest) return false;
        const existing = options.evidence.read().records.find((record) => record.source === "lease" && record.id === authorizationId);
        if (existing && existing.evidenceDigest !== evidence.evidenceDigest) return false;
        if (!existing && !options.evidence.append(evidence)) return false;
        evidenceReady = options.evidence.read().records.some((record) => record.source === "lease" && record.id === authorizationId && record.evidenceDigest === evidence.evidenceDigest);
        return evidenceReady;
      });
      compacted.push(authorizationId);
    } catch { failed.push({ authorizationId, reason: evidenceReady ? "REMOVE_REFUSED" : "EVIDENCE_NOT_WRITTEN" }); }
  }
  return { ...plan, compacted, failed };
}
