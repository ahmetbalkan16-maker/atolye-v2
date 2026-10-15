import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { AyasSafeModeBlockedError, ayasSafeModeHold } from "../../ayas/safety/AyasSafeModeReader";
import {
  ayasUsedOwnerActionRefs, checkAyasOwnerAdmissionBinding, sealAyasOwnerDecision, verifyAyasOwnerDecisionSeal,
  type AyasOwnerAdmission, type AyasOwnerAdmissionSubject,
} from "./AyasOwnerApprovalAdmission";
import { AYAS_TRACKED_RELEASE_SOURCES, compareAyasReleaseVersions, resolveAyasInstalledVersion } from "./AyasResearchReleaseRelevance";
import { ayasUpdateRadarItemHash, ayasUpdateBump, type AyasUpdateRadarItem } from "./AyasUpdateRadar";
import { isAyasUpdateTrialIntact, type AyasUpdateTrialRecord, type AyasUpdateTrialStore } from "./AyasUpdateTrialStore";

/**
 * Owner approvals on the update radar (owner request 2026-10-15, option A). One click records consent for one exact
 * update (tool, installed version, target version), sealed with the owner admission like the other owner decisions.
 * Recording is the only effect: nothing is installed, committed or published here. A later update round reads
 * `listAyasUpdateApprovals` and carries out the WAITING ones. Append-only: a withdrawal is a new decision.
 */
export type AyasUpdateApprovalDecision = "APPROVE" | "WITHDRAW";

export interface AyasUpdateApprovalRecord {
  readonly decisionId: string;
  readonly sourceId: string;
  readonly toolName: string;
  readonly target: string;
  readonly installedVersion: string;
  readonly targetVersion: string;
  readonly bump: AyasUpdateRadarItem["bump"];
  readonly applyChannel: AyasUpdateRadarItem["applyChannel"];
  readonly itemHash: string;
  readonly decision: AyasUpdateApprovalDecision;
  readonly decidedAt: string;
  readonly ownerAdmission: AyasOwnerAdmission;
  readonly ownerDecisionSeal: string;
}

/** The owner's "Uygula" on one passed trial (owner decisions 2026-10-15): the one approval for its commit, push and live publish. */
export interface AyasUpdateApplyDecisionRecord {
  readonly decisionId: string;
  readonly trialId: string;
  readonly trialHash: string;
  readonly approvalDecisionId: string;
  readonly sourceId: string;
  readonly targetVersion: string;
  readonly decision: "APPLY";
  readonly decidedAt: string;
  readonly ownerAdmission: AyasOwnerAdmission;
  readonly ownerDecisionSeal: string;
}

export interface AyasUpdateApprovalState {
  readonly schemaVersion: 1;
  readonly decisions: readonly AyasUpdateApprovalRecord[];
  readonly applyDecisions?: readonly AyasUpdateApplyDecisionRecord[];
}

export interface AyasUpdateApprovalStore {
  load(): AyasUpdateApprovalState;
  append(record: AyasUpdateApprovalRecord): void;
  appendApply(record: AyasUpdateApplyDecisionRecord): void;
}

/** One JSON file, written atomically (temp + fsync + rename) like the other research stores. */
export function createAyasUpdateApprovalStore(options: { readonly rootDir?: string } = {}): AyasUpdateApprovalStore {
  const dir = path.resolve(options.rootDir ?? path.join(process.cwd(), "data", "brain", "self-improvement", "update-approvals"));
  const file = path.join(dir, "state.json");
  const load = (): AyasUpdateApprovalState => {
    let raw: string;
    try { raw = fs.readFileSync(file, "utf8"); } catch { return { schemaVersion: 1, decisions: [] }; }
    const parsed = JSON.parse(raw) as AyasUpdateApprovalState;
    if (parsed?.schemaVersion !== 1 || !Array.isArray(parsed.decisions)) throw new Error("update-approvals state has an unknown schema");
    return parsed;
  };
  const write = (state: AyasUpdateApprovalState): void => {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, `.state.${process.pid}.${crypto.randomUUID()}.tmp`);
    const fd = fs.openSync(tmp, "w");
    try { fs.writeFileSync(fd, `${JSON.stringify(state, null, 2)}\n`, "utf8"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, file);
  };
  return {
    load,
    // Synchronous read-modify-write: no other decision in this process can interleave.
    append(record) { const state = load(); write({ ...state, decisions: [...state.decisions, record] }); },
    appendApply(record) { const state = load(); write({ ...state, applyDecisions: [...(state.applyDecisions ?? []), record] }); },
  };
}

export type AyasUpdateApprovalErrorCode =
  | "UPDATE_APPROVAL_INVALID_INPUT"
  | "UPDATE_APPROVAL_ITEM_NOT_FOUND"
  | "UPDATE_APPROVAL_ITEM_CHANGED"
  | "UPDATE_APPROVAL_ALREADY_APPROVED"
  | "UPDATE_APPROVAL_NOT_APPROVED"
  | "UPDATE_APPROVAL_DECISION_CHANGED"
  | "UPDATE_APPROVAL_ADMISSION_REJECTED"
  | "UPDATE_APPLY_TRIAL_NOT_FOUND"
  | "UPDATE_APPLY_TRIAL_NOT_PASSED"
  | "UPDATE_APPLY_TRIAL_CHANGED"
  | "UPDATE_APPLY_TRIAL_STALE"
  | "UPDATE_APPLY_APPROVAL_WITHDRAWN"
  | "UPDATE_APPLY_ALREADY_DECIDED";

/** The message is the code, so a caller that reports `error.message` reports the reason. */
export class AyasUpdateApprovalError extends Error {
  constructor(readonly code: AyasUpdateApprovalErrorCode) { super(code); this.name = "AyasUpdateApprovalError"; this.stack = undefined; }
}

const HEX64 = /^[0-9a-f]{64}$/;

const subjectOf = (record: Pick<AyasUpdateApprovalRecord, "sourceId" | "itemHash" | "decision">): AyasOwnerAdmissionSubject =>
  ({ kind: "update-radar", sourceId: record.sourceId, itemHash: record.itemHash, decision: record.decision });

/**
 * True when the record carries an intact owner seal and an admission for exactly this subject at its decision time.
 * The seal covers the admission, whose item hash covers the versions; the record's own fields are re-derived against it,
 * so an edited target version or tool name is never trusted.
 */
export function isAyasUpdateApprovalOwnerAdmitted(record: AyasUpdateApprovalRecord): boolean {
  try {
    const tracked = AYAS_TRACKED_RELEASE_SOURCES[record.sourceId];
    if (!tracked || record.toolName !== tracked.toolName || record.bump !== ayasUpdateBump(record.installedVersion, record.targetVersion)) return false;
    if (ayasUpdateRadarItemHash({ sourceId: record.sourceId, target: record.target, installedVersion: record.installedVersion,
      latestVersion: record.targetVersion, applyChannel: record.applyChannel }) !== record.itemHash) return false;
    return verifyAyasOwnerDecisionSeal(record)
      && checkAyasOwnerAdmissionBinding(record.ownerAdmission, { subject: subjectOf(record), at: record.decidedAt, usedActionRefs: new Set() }).ok;
  } catch { return false; }
}

/** The latest owner-admitted decision per tool; an unverifiable record is ignored, never trusted. */
function latestAdmittedBySource(decisions: readonly AyasUpdateApprovalRecord[]): Map<string, AyasUpdateApprovalRecord> {
  const latest = new Map<string, AyasUpdateApprovalRecord>();
  for (const record of decisions) if (isAyasUpdateApprovalOwnerAdmitted(record)) latest.set(record.sourceId, record);
  return latest;
}

export async function decideAyasUpdateApproval(
  input: { readonly sourceId: string; readonly itemHash: string; readonly decision: AyasUpdateApprovalDecision },
  deps: {
    readonly radar: readonly AyasUpdateRadarItem[];
    readonly store: AyasUpdateApprovalStore;
    /** Builds the owner admission for this exact subject from the verified session (server side). */
    readonly admit: (subject: AyasOwnerAdmissionSubject) => Promise<AyasOwnerAdmission>;
    readonly now?: () => string;
    readonly safeModeHold?: () => "AYAS_SAFE_READ_ONLY" | "AYAS_SAFE_MODE_UNAVAILABLE" | undefined;
  },
): Promise<AyasUpdateApprovalRecord> {
  if (!input || typeof input.sourceId !== "string" || !Object.hasOwn(AYAS_TRACKED_RELEASE_SOURCES, input.sourceId)
    || typeof input.itemHash !== "string" || !HEX64.test(input.itemHash) || (input.decision !== "APPROVE" && input.decision !== "WITHDRAW")) {
    throw new AyasUpdateApprovalError("UPDATE_APPROVAL_INVALID_INPUT");
  }
  const hold = (deps.safeModeHold ?? (() => ayasSafeModeHold()))();
  if (hold) throw new AyasSafeModeBlockedError(hold);
  const now = deps.now ?? (() => new Date().toISOString());

  const activeBefore = latestAdmittedBySource(deps.store.load().decisions).get(input.sourceId);
  let fields: Omit<AyasUpdateApprovalRecord, "decisionId" | "decision" | "decidedAt" | "ownerAdmission" | "ownerDecisionSeal">;
  if (input.decision === "APPROVE") {
    const item = deps.radar.find((entry) => entry.sourceId === input.sourceId);
    if (!item) throw new AyasUpdateApprovalError("UPDATE_APPROVAL_ITEM_NOT_FOUND");
    if (item.itemHash !== input.itemHash || ayasUpdateRadarItemHash(item) !== item.itemHash) throw new AyasUpdateApprovalError("UPDATE_APPROVAL_ITEM_CHANGED");
    if (activeBefore?.decision === "APPROVE" && activeBefore.itemHash === item.itemHash) throw new AyasUpdateApprovalError("UPDATE_APPROVAL_ALREADY_APPROVED");
    fields = { sourceId: item.sourceId, toolName: item.toolName, target: item.target, installedVersion: item.installedVersion, targetVersion: item.latestVersion,
      bump: item.bump, applyChannel: item.applyChannel, itemHash: item.itemHash };
  } else {
    // A withdrawal names the approval it withdraws, which may no longer be on the radar.
    if (activeBefore?.decision !== "APPROVE" || activeBefore.itemHash !== input.itemHash) throw new AyasUpdateApprovalError("UPDATE_APPROVAL_NOT_APPROVED");
    const { sourceId, toolName, target, installedVersion, targetVersion, bump, applyChannel, itemHash } = activeBefore;
    fields = { sourceId, toolName, target, installedVersion, targetVersion, bump, applyChannel, itemHash };
  }

  const subject = subjectOf({ ...fields, decision: input.decision });
  const ownerAdmission = await deps.admit(subject);
  const state = deps.store.load();
  // Another decision on this tool landed while the session was verified: refuse rather than decide on old state.
  if (latestAdmittedBySource(state.decisions).get(input.sourceId)?.decisionId !== activeBefore?.decisionId) throw new AyasUpdateApprovalError("UPDATE_APPROVAL_DECISION_CHANGED");
  const decidedAt = now();
  if (!checkAyasOwnerAdmissionBinding(ownerAdmission, { subject, at: decidedAt, usedActionRefs: ayasUsedOwnerActionRefs(state.decisions) }).ok) {
    throw new AyasUpdateApprovalError("UPDATE_APPROVAL_ADMISSION_REJECTED");
  }
  const decisionId = `ayas-update-decision-${crypto.randomUUID()}`;
  const record: AyasUpdateApprovalRecord = Object.freeze({
    decisionId, ...fields, decision: input.decision, decidedAt, ownerAdmission,
    ownerDecisionSeal: sealAyasOwnerDecision({ decisionId, decidedAt, ownerAdmission }),
  });
  deps.store.append(record);
  return record;
}

export interface AyasUpdateApprovalView {
  readonly decisionId: string;
  readonly sourceId: string;
  readonly toolName: string;
  readonly target: string;
  readonly installedVersion: string;
  readonly targetVersion: string;
  readonly bump: AyasUpdateRadarItem["bump"];
  readonly applyChannel: AyasUpdateRadarItem["applyChannel"];
  readonly itemHash: string;
  readonly approvedAt: string;
  /** WAITING until the installed version reaches the approved one. */
  readonly status: "WAITING" | "APPLIED";
  readonly currentInstalledVersion?: string;
  /** The radar now shows a newer stable version than the approved one. */
  readonly newerVersionOnRadar?: string;
}

/** Active (owner-admitted, not withdrawn) approvals, WAITING first. Read-only. */
export function listAyasUpdateApprovals(input: {
  readonly decisions: readonly AyasUpdateApprovalRecord[];
  readonly radar: readonly AyasUpdateRadarItem[];
  readonly repoRoot: string;
}): readonly AyasUpdateApprovalView[] {
  const views: AyasUpdateApprovalView[] = [];
  for (const record of latestAdmittedBySource(input.decisions).values()) {
    if (record.decision !== "APPROVE") continue;
    const tracked = AYAS_TRACKED_RELEASE_SOURCES[record.sourceId];
    const current = tracked ? resolveAyasInstalledVersion(tracked, input.repoRoot) ?? undefined : undefined;
    const radarItem = input.radar.find((entry) => entry.sourceId === record.sourceId);
    views.push(Object.freeze({
      decisionId: record.decisionId, sourceId: record.sourceId, toolName: record.toolName, target: record.target,
      installedVersion: record.installedVersion, targetVersion: record.targetVersion, bump: record.bump, applyChannel: record.applyChannel,
      itemHash: record.itemHash, approvedAt: record.decidedAt,
      status: current && compareAyasReleaseVersions(current, record.targetVersion) >= 0 ? "APPLIED" as const : "WAITING" as const,
      ...(current ? { currentInstalledVersion: current } : {}),
      ...(radarItem && compareAyasReleaseVersions(radarItem.latestVersion, record.targetVersion) > 0 ? { newerVersionOnRadar: radarItem.latestVersion } : {}),
    }));
  }
  return Object.freeze(views.sort((a, b) => (a.status === b.status ? a.approvedAt.localeCompare(b.approvedAt) : a.status === "WAITING" ? -1 : 1)));
}

/* ------------------------------------------------------------ apply ("Uygula") --- */

const applySubjectOf = (record: Pick<AyasUpdateApplyDecisionRecord, "trialId" | "trialHash">): AyasOwnerAdmissionSubject =>
  ({ kind: "update-apply", trialId: record.trialId, trialHash: record.trialHash, decision: "APPLY" });

/** True when an "Uygula" record carries an intact owner seal and an admission for exactly this trial at its decision time. */
export function isAyasUpdateApplyOwnerAdmitted(record: AyasUpdateApplyDecisionRecord): boolean {
  try {
    return record.decision === "APPLY" && verifyAyasOwnerDecisionSeal(record)
      && checkAyasOwnerAdmissionBinding(record.ownerAdmission, { subject: applySubjectOf(record), at: record.decidedAt, usedActionRefs: new Set() }).ok;
  } catch { return false; }
}

/** Every owner-admitted "Uygula" decision, oldest first; an unverifiable record is ignored, never trusted. */
export function listAyasUpdateApplyDecisions(state: AyasUpdateApprovalState): readonly AyasUpdateApplyDecisionRecord[] {
  return Object.freeze((state.applyDecisions ?? []).filter(isAyasUpdateApplyOwnerAdmitted));
}

/**
 * Records the owner's "Uygula" on one passed trial. Refused unless the trial passed on the current HEAD, its stored
 * artifacts still hash to what was tested, the approval it tried is still the active one, and no "Uygula" was recorded
 * for it before. Recording is the only effect here; the observer's executor carries it out.
 */
export async function decideAyasUpdateApply(
  input: { readonly trialId: string; readonly trialHash: string },
  deps: {
    readonly approvals: AyasUpdateApprovalStore;
    readonly trials: AyasUpdateTrialStore;
    readonly head: string;
    readonly admit: (subject: AyasOwnerAdmissionSubject) => Promise<AyasOwnerAdmission>;
    readonly now?: () => string;
    readonly safeModeHold?: () => "AYAS_SAFE_READ_ONLY" | "AYAS_SAFE_MODE_UNAVAILABLE" | undefined;
  },
): Promise<AyasUpdateApplyDecisionRecord> {
  if (!input || typeof input.trialId !== "string" || !/^ayas-update-trial-[0-9a-f-]{36}$/.test(input.trialId) || typeof input.trialHash !== "string" || !HEX64.test(input.trialHash)) {
    throw new AyasUpdateApprovalError("UPDATE_APPROVAL_INVALID_INPUT");
  }
  const hold = (deps.safeModeHold ?? (() => ayasSafeModeHold()))();
  if (hold) throw new AyasSafeModeBlockedError(hold);
  const now = deps.now ?? (() => new Date().toISOString());

  const check = (): { readonly trial: AyasUpdateTrialRecord } => {
    const trial = deps.trials.load().trials.find((entry) => entry.trialId === input.trialId);
    if (!trial) throw new AyasUpdateApprovalError("UPDATE_APPLY_TRIAL_NOT_FOUND");
    if (trial.status !== "PASSED") throw new AyasUpdateApprovalError("UPDATE_APPLY_TRIAL_NOT_PASSED");
    if (trial.trialHash !== input.trialHash || !isAyasUpdateTrialIntact(trial, deps.trials.readArtifacts(trial.trialId))) throw new AyasUpdateApprovalError("UPDATE_APPLY_TRIAL_CHANGED");
    if (trial.baseHead !== deps.head) throw new AyasUpdateApprovalError("UPDATE_APPLY_TRIAL_STALE");
    const state = deps.approvals.load();
    const active = latestAdmittedBySource(state.decisions).get(trial.sourceId);
    if (active?.decision !== "APPROVE" || active.decisionId !== trial.approvalDecisionId) throw new AyasUpdateApprovalError("UPDATE_APPLY_APPROVAL_WITHDRAWN");
    if (listAyasUpdateApplyDecisions(state).some((entry) => entry.trialId === trial.trialId)) throw new AyasUpdateApprovalError("UPDATE_APPLY_ALREADY_DECIDED");
    return { trial };
  };

  check();
  const subject = applySubjectOf(input);
  const ownerAdmission = await deps.admit(subject);
  // Re-checked after the session was verified: a withdrawal or another click in between wins.
  const { trial } = check();
  const state = deps.approvals.load();
  const decidedAt = now();
  const usedActionRefs = ayasUsedOwnerActionRefs([...state.decisions, ...(state.applyDecisions ?? [])]);
  if (!checkAyasOwnerAdmissionBinding(ownerAdmission, { subject, at: decidedAt, usedActionRefs }).ok) throw new AyasUpdateApprovalError("UPDATE_APPROVAL_ADMISSION_REJECTED");
  const decisionId = `ayas-update-apply-${crypto.randomUUID()}`;
  const record: AyasUpdateApplyDecisionRecord = Object.freeze({
    decisionId, trialId: trial.trialId, trialHash: input.trialHash, approvalDecisionId: trial.approvalDecisionId, sourceId: trial.sourceId,
    targetVersion: trial.targetVersion, decision: "APPLY" as const, decidedAt, ownerAdmission,
    ownerDecisionSeal: sealAyasOwnerDecision({ decisionId, decidedAt, ownerAdmission }),
  });
  deps.approvals.appendApply(record);
  return record;
}
