import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { AyasSafeModeBlockedError, ayasSafeModeHold } from "../../ayas/safety/AyasSafeModeReader";
import { AYAS_CODE_JOB_ID, ayasCodeBuildHash, ayasCodeLaneRefusals, isAyasCodeBuildShape, type AyasCodeBuild } from "./AyasCodeChangeLane";
import {
  ayasUsedOwnerActionRefs, checkAyasOwnerAdmissionBinding, sealAyasOwnerDecision, verifyAyasOwnerDecisionSeal,
  type AyasOwnerAdmission, type AyasOwnerAdmissionSubject,
} from "./AyasOwnerApprovalAdmission";

/**
 * The owner's "ONAYLA VE UYGULA" on one developer build (owner decision 2026-11-09; CLAUDE.md standing exception for
 * this click). Recording is the only effect here: the decision is sealed with the owner admission and bound to the
 * build's exact identity (AyasCodeChangeLane.ayasCodeBuildHash: job, branch, commit, base and every file's bytes). The
 * observer's update executor carries it out (AyasCodeChangeApplyRunner) and writes the apply records into the same
 * store. Append-only for decisions; one JSON file, written atomically.
 */
export interface AyasCodeApplyDecisionRecord {
  readonly decisionId: string;
  readonly jobId: string;
  readonly buildHash: string;
  readonly commit: string;
  readonly title: string;
  readonly decision: "APPLY";
  readonly decidedAt: string;
  readonly ownerAdmission: AyasOwnerAdmission;
  readonly ownerDecisionSeal: string;
}

export type AyasCodeApplyStatus = "RUNNING" | "COMPLETED" | "STALE" | "REFUSED" | "FAILED" | "ROLLED_BACK" | "RECOVERY_REQUIRED" | "ABANDONED";

export interface AyasCodeApplyRecord {
  readonly schemaVersion: 1;
  readonly applyId: string;
  readonly decisionId: string;
  readonly jobId: string;
  readonly buildHash: string;
  /** The canonical HEAD when the apply started. */
  readonly baseHead: string;
  readonly status: AyasCodeApplyStatus;
  readonly startedAt: string;
  readonly finishedAt?: string;
  /** The published commit: the build commit itself (fast-forward) or its cherry-pick onto a newer HEAD. */
  readonly commitSha?: string;
  readonly pushed?: boolean;
  /** How the bytes were proven: the build's own base (its checks stand), or the checks again on the newer HEAD. */
  readonly verified?: "SAME_BASE" | "REVERIFIED";
  readonly reasons?: readonly string[];
  readonly closure?: { readonly ok: boolean; readonly summary: string };
}

export interface AyasCodeChangeState {
  readonly schemaVersion: 1;
  readonly decisions: readonly AyasCodeApplyDecisionRecord[];
  readonly applies: readonly AyasCodeApplyRecord[];
}

export interface AyasCodeChangeStore {
  readonly rootDir: string;
  load(): AyasCodeChangeState;
  appendDecision(record: AyasCodeApplyDecisionRecord): void;
  upsertApply(record: AyasCodeApplyRecord): void;
}

/** Outside Git (.gitignore: /data/brain/self-improvement/code-changes/), so a decision never dirties the tree. */
export function resolveAyasCodeChangeRoot(repoRoot: string = process.cwd()): string {
  return path.join(repoRoot, "data", "brain", "self-improvement", "code-changes");
}

export function createAyasCodeChangeStore(options: { readonly rootDir?: string } = {}): AyasCodeChangeStore {
  const rootDir = path.resolve(options.rootDir ?? resolveAyasCodeChangeRoot());
  const file = path.join(rootDir, "state.json");
  const load = (): AyasCodeChangeState => {
    let raw: string;
    try { raw = fs.readFileSync(file, "utf8"); } catch { return { schemaVersion: 1, decisions: [], applies: [] }; }
    const parsed = JSON.parse(raw) as AyasCodeChangeState;
    if (parsed?.schemaVersion !== 1 || !Array.isArray(parsed.decisions) || !Array.isArray(parsed.applies)) throw new Error("code-changes state has an unknown schema");
    return parsed;
  };
  const write = (state: AyasCodeChangeState): void => {
    fs.mkdirSync(rootDir, { recursive: true });
    const tmp = path.join(rootDir, `.state.${process.pid}.${crypto.randomUUID()}.tmp`);
    const fd = fs.openSync(tmp, "w");
    try { fs.writeFileSync(fd, `${JSON.stringify(state, null, 2)}\n`, "utf8"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, file);
  };
  return {
    rootDir,
    load,
    // Synchronous read-modify-write: nothing in this process can interleave.
    appendDecision(record) { const state = load(); write({ ...state, decisions: [...state.decisions, record] }); },
    upsertApply(record) {
      const state = load();
      write({ ...state, applies: [...state.applies.filter((entry) => entry.applyId !== record.applyId), record] });
    },
  };
}

export type AyasCodeChangeErrorCode =
  | "CODE_APPLY_INVALID_INPUT"
  | "CODE_APPLY_BUILD_NOT_FOUND"
  | "CODE_APPLY_BUILD_CHANGED"
  | "CODE_APPLY_OUTSIDE_LANE"
  | "CODE_APPLY_ALREADY_DECIDED"
  | "CODE_APPLY_ADMISSION_REJECTED";

/** The message is the code, so a caller that reports `error.message` reports the reason. */
export class AyasCodeChangeError extends Error {
  constructor(readonly code: AyasCodeChangeErrorCode) { super(code); this.name = "AyasCodeChangeError"; this.stack = undefined; }
}

const HEX64 = /^[0-9a-f]{64}$/;

const subjectOf = (record: Pick<AyasCodeApplyDecisionRecord, "jobId" | "buildHash">): AyasOwnerAdmissionSubject =>
  ({ kind: "code-apply", jobId: record.jobId, buildHash: record.buildHash, decision: "APPLY" });

/** True when the record carries an intact owner seal and an admission for exactly this build at its decision time. */
export function isAyasCodeApplyOwnerAdmitted(record: AyasCodeApplyDecisionRecord): boolean {
  try {
    return record.decision === "APPLY" && verifyAyasOwnerDecisionSeal(record)
      && checkAyasOwnerAdmissionBinding(record.ownerAdmission, { subject: subjectOf(record), at: record.decidedAt, usedActionRefs: new Set() }).ok;
  } catch { return false; }
}

/** Every owner-admitted decision, oldest first; an unverifiable record is ignored, never trusted. */
export function listAyasCodeApplyDecisions(state: AyasCodeChangeState): readonly AyasCodeApplyDecisionRecord[] {
  return Object.freeze(state.decisions.filter(isAyasCodeApplyOwnerAdmitted));
}

/** An apply that leaves its decision spent; FAILED, ROLLED_BACK and ABANDONED let the owner click the same build again. */
const SPENT: ReadonlySet<AyasCodeApplyStatus> = new Set(["RUNNING", "COMPLETED", "STALE", "REFUSED", "RECOVERY_REQUIRED"]);
/** An interrupted apply (nothing happened) is retried this many times for one decision. */
export const AYAS_CODE_APPLY_MAX_ABANDONED = 2;

const appliesOf = (state: Pick<AyasCodeChangeState, "applies">, decisionId: string) => state.applies.filter((entry) => entry.decisionId === decisionId);

/** Whether the owner may click "ONAYLA VE UYGULA" on this build again (no live decision for it). */
export function ayasCodeBuildDecisionOpen(state: AyasCodeChangeState, jobId: string, buildHash: string): boolean {
  return !listAyasCodeApplyDecisions(state).some((decision) => {
    if (decision.jobId !== jobId || decision.buildHash !== buildHash) return false;
    const applies = appliesOf(state, decision.decisionId);
    if (!applies.length) return true;
    if (applies.some((entry) => SPENT.has(entry.status))) return true;
    return applies.filter((entry) => entry.status === "ABANDONED").length < AYAS_CODE_APPLY_MAX_ABANDONED && !applies.some((entry) => entry.status === "FAILED" || entry.status === "ROLLED_BACK");
  });
}

/**
 * Records the owner's "ONAYLA VE UYGULA" on one build. Refused unless the build is ready, its recorded identity still
 * hashes to the hash on the owner's card, every file is inside the code lane, and no decision for the same build is
 * still open. Recording is the only effect; the observer's executor carries it out.
 */
export async function decideAyasCodeChangeApply(
  input: { readonly jobId: string; readonly buildHash: string },
  deps: {
    readonly store: AyasCodeChangeStore;
    /** The job's ready build as the development queue records it now (undefined when it is not ready). */
    readonly build: () => Promise<AyasCodeBuild | undefined>;
    readonly admit: (subject: AyasOwnerAdmissionSubject) => Promise<AyasOwnerAdmission>;
    readonly now?: () => string;
    readonly safeModeHold?: () => "AYAS_SAFE_READ_ONLY" | "AYAS_SAFE_MODE_UNAVAILABLE" | undefined;
  },
): Promise<AyasCodeApplyDecisionRecord> {
  if (!input || typeof input.jobId !== "string" || !AYAS_CODE_JOB_ID.test(input.jobId) || typeof input.buildHash !== "string" || !HEX64.test(input.buildHash)) {
    throw new AyasCodeChangeError("CODE_APPLY_INVALID_INPUT");
  }
  const hold = (deps.safeModeHold ?? (() => ayasSafeModeHold()))();
  if (hold) throw new AyasSafeModeBlockedError(hold);
  const now = deps.now ?? (() => new Date().toISOString());

  const check = async (): Promise<AyasCodeBuild> => {
    const build = await deps.build();
    if (!build || !isAyasCodeBuildShape(build) || build.jobId !== input.jobId) throw new AyasCodeChangeError("CODE_APPLY_BUILD_NOT_FOUND");
    if (ayasCodeBuildHash(build) !== input.buildHash) throw new AyasCodeChangeError("CODE_APPLY_BUILD_CHANGED");
    if (ayasCodeLaneRefusals(build.files.map((file) => file.path)).length) throw new AyasCodeChangeError("CODE_APPLY_OUTSIDE_LANE");
    if (!ayasCodeBuildDecisionOpen(deps.store.load(), build.jobId, input.buildHash)) throw new AyasCodeChangeError("CODE_APPLY_ALREADY_DECIDED");
    return build;
  };

  await check();
  const subject = subjectOf(input);
  const ownerAdmission = await deps.admit(subject);
  // Re-checked after the session was verified: a new build or another click in between wins.
  const build = await check();
  const state = deps.store.load();
  const decidedAt = now();
  if (!checkAyasOwnerAdmissionBinding(ownerAdmission, { subject, at: decidedAt, usedActionRefs: ayasUsedOwnerActionRefs(state.decisions) }).ok) {
    throw new AyasCodeChangeError("CODE_APPLY_ADMISSION_REJECTED");
  }
  const decisionId = `ayas-code-apply-${crypto.randomUUID()}`;
  const record: AyasCodeApplyDecisionRecord = Object.freeze({
    decisionId, jobId: build.jobId, buildHash: input.buildHash, commit: build.commit, title: build.title.slice(0, 200), decision: "APPLY" as const, decidedAt, ownerAdmission,
    ownerDecisionSeal: sealAyasOwnerDecision({ decisionId, decidedAt, ownerAdmission }),
  });
  deps.store.appendDecision(record);
  return record;
}

export type AyasCodeApplyJob =
  | { readonly kind: "NONE"; readonly reason: string }
  | { readonly kind: "APPLY"; readonly decision: AyasCodeApplyDecisionRecord; readonly build: AyasCodeBuild }
  /** The admitted decision's build is gone or changed since the click: the decision is closed as REFUSED. */
  | { readonly kind: "REFUSE"; readonly decision: AyasCodeApplyDecisionRecord; readonly reason: string };

/**
 * The oldest admitted decision that has not been carried out yet (an interrupted, provably untouched attempt is tried
 * again a bounded number of times). Its build must still be the one the owner clicked.
 */
export function selectAyasCodeApplyJob(input: {
  readonly state: AyasCodeChangeState;
  readonly builds: ReadonlyMap<string, AyasCodeBuild>;
}): AyasCodeApplyJob {
  for (const decision of listAyasCodeApplyDecisions(input.state)) {
    const applies = appliesOf(input.state, decision.decisionId);
    if (applies.some((entry) => entry.status !== "ABANDONED")) continue;
    if (applies.length >= AYAS_CODE_APPLY_MAX_ABANDONED) continue;
    const build = input.builds.get(decision.jobId);
    if (!build || !isAyasCodeBuildShape(build) || ayasCodeBuildHash(build) !== decision.buildHash) return { kind: "REFUSE", decision, reason: "onaylanan yapı artık yok ya da değişmiş" };
    return { kind: "APPLY", decision, build };
  }
  return { kind: "NONE", reason: "uygulanacak kod değişikliği yok" };
}

/** The latest apply of a job, for the owner's card. */
export function latestAyasCodeApply(state: AyasCodeChangeState, jobId: string): AyasCodeApplyRecord | undefined {
  return state.applies.filter((entry) => entry.jobId === jobId).sort((a, b) => a.startedAt.localeCompare(b.startedAt)).at(-1);
}
