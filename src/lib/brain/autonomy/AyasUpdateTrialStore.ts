import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { AyasUpdateApplyDecisionRecord, AyasUpdateApprovalView } from "./AyasUpdateApprovalStore";
import type { AyasUpdateRadarItem } from "./AyasUpdateRadar";

/**
 * Owner-approved update trials (owner decisions 2026-10-15: "dene, sonra uygula"). A trial installs one approved update
 * in a separate worktree and runs the CI-equivalent checks; the canonical repository is never touched. This module
 * holds only the durable records and the pure decisions around them (install plan, lock and package.json checks, job
 * selection, the trial hash an "Uygula" click binds to). Running commands lives in AyasUpdateTrialRunner.
 */
export type AyasUpdateTrialStatus = "RUNNING" | "PASSED" | "FAILED" | "ABANDONED";
export type AyasUpdateTrialStepName =
  | "WORKTREE" | "NPM_CI" | "BASELINE_SMOKES" | "NPM_INSTALL" | "LOCK_CHECK" | "SIGNATURES" | "TYPECHECK" | "LINT" | "BUILD" | "SMOKES";

export interface AyasUpdateTrialStep {
  readonly name: AyasUpdateTrialStepName;
  readonly ok: boolean;
  readonly durationMs: number;
  /** Short, path-free output tail; never a secret (the runner gives children no access key). */
  readonly summary: string;
}

export interface AyasUpdateTrialPackageChange { readonly name: string; readonly from?: string; readonly to?: string }

export interface AyasUpdateTrialRecord {
  readonly schemaVersion: 1;
  readonly trialId: string;
  readonly approvalDecisionId: string;
  readonly sourceId: string;
  readonly toolName: string;
  readonly target: string;
  readonly installedVersion: string;
  readonly targetVersion: string;
  readonly bump: AyasUpdateRadarItem["bump"];
  readonly itemHash: string;
  readonly baseHead: string;
  readonly installSpecs: readonly string[];
  readonly status: AyasUpdateTrialStatus;
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly steps: readonly AyasUpdateTrialStep[];
  readonly failedStep?: AyasUpdateTrialStepName;
  readonly failureReason?: string;
  /** Smokes that already failed before the update: reported, not counted against it. */
  readonly preExistingSmokeFailures?: readonly string[];
  readonly lockChanges?: { readonly added: number; readonly removed: number; readonly changed: number; readonly direct: readonly AyasUpdateTrialPackageChange[] };
  readonly packageJsonSha256?: string;
  readonly packageLockSha256?: string;
  /** Present only on PASSED: what an "Uygula" decision binds to. */
  readonly trialHash?: string;
}

/**
 * One "Uygula" carried out: the dependency-update publication of a passed trial, then the live publish. ABANDONED means
 * an interrupted attempt that provably touched nothing (same HEAD, clean tree); RECOVERY_REQUIRED means it may have,
 * and is never retried automatically.
 */
export type AyasUpdateApplyStatus = "RUNNING" | "COMPLETED" | "STALE" | "REFUSED" | "ROLLED_BACK" | "RECOVERY_REQUIRED" | "FAILED" | "ABANDONED";
export interface AyasUpdateApplyRecord {
  readonly schemaVersion: 1;
  readonly applyId: string;
  readonly applyDecisionId: string;
  readonly trialId: string;
  readonly sourceId: string;
  readonly toolName: string;
  readonly installedVersion: string;
  readonly targetVersion: string;
  readonly baseHead: string;
  readonly status: AyasUpdateApplyStatus;
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly reasons?: readonly string[];
  readonly commitSha?: string;
  readonly pushed?: boolean;
  /** Graphify refreshed and checked for the new HEAD (the established post-publication closure). */
  readonly closure?: { readonly ok: boolean; readonly summary: string };
  /** The live copy: published, rolled back by the publish script's health check, or not yet done. */
  readonly live?: { readonly status: "PUBLISHED" | "ROLLED_BACK" | "FAILED"; readonly summary: string; readonly attempts: number; readonly at: string };
  readonly livePending?: boolean;
}

export interface AyasUpdateTrialState { readonly schemaVersion: 1; readonly trials: readonly AyasUpdateTrialRecord[]; readonly applies?: readonly AyasUpdateApplyRecord[] }

export interface AyasUpdateTrialArtifacts { readonly packageJson: string; readonly packageLock: string }

export interface AyasUpdateTrialStore {
  readonly rootDir: string;
  load(): AyasUpdateTrialState;
  /** Inserts or replaces the record with the same trialId. */
  upsert(record: AyasUpdateTrialRecord): void;
  /** Inserts or replaces the apply record with the same applyId. */
  upsertApply(record: AyasUpdateApplyRecord): void;
  writeArtifacts(trialId: string, artifacts: AyasUpdateTrialArtifacts): void;
  readArtifacts(trialId: string): AyasUpdateTrialArtifacts | undefined;
}

const TRIAL_ID = /^ayas-update-trial-[0-9a-f-]{36}$/;
const sha256 = (text: string): string => crypto.createHash("sha256").update(text, "utf8").digest("hex");

function writeAtomic(dir: string, file: string, content: string): void {
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  const fd = fs.openSync(tmp, "w");
  try { fs.writeFileSync(fd, content, "utf8"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}

/** One JSON file plus one artifact folder per trial, written atomically (temp + fsync + rename). */
export function createAyasUpdateTrialStore(options: { readonly rootDir?: string } = {}): AyasUpdateTrialStore {
  const dir = path.resolve(options.rootDir ?? path.join(process.cwd(), "data", "brain", "self-improvement", "update-trials"));
  const file = path.join(dir, "state.json");
  const load = (): AyasUpdateTrialState => {
    let raw: string;
    try { raw = fs.readFileSync(file, "utf8"); } catch { return { schemaVersion: 1, trials: [] }; }
    const parsed = JSON.parse(raw) as AyasUpdateTrialState;
    if (parsed?.schemaVersion !== 1 || !Array.isArray(parsed.trials)) throw new Error("update-trials state has an unknown schema");
    return parsed;
  };
  const artifactDir = (trialId: string): string => {
    if (!TRIAL_ID.test(trialId)) throw new Error("update trial id is malformed");
    return path.join(dir, trialId);
  };
  return {
    rootDir: dir,
    load,
    upsert(record) {
      const state = load();
      const trials = state.trials.some((entry) => entry.trialId === record.trialId)
        ? state.trials.map((entry) => (entry.trialId === record.trialId ? record : entry))
        : [...state.trials, record];
      writeAtomic(dir, file, `${JSON.stringify({ ...state, trials }, null, 2)}\n`);
    },
    upsertApply(record) {
      const state = load();
      const current = state.applies ?? [];
      const applies = current.some((entry) => entry.applyId === record.applyId)
        ? current.map((entry) => (entry.applyId === record.applyId ? record : entry))
        : [...current, record];
      writeAtomic(dir, file, `${JSON.stringify({ ...state, applies }, null, 2)}\n`);
    },
    writeArtifacts(trialId, artifacts) {
      const target = artifactDir(trialId);
      writeAtomic(target, path.join(target, "package.json"), artifacts.packageJson);
      writeAtomic(target, path.join(target, "package-lock.json"), artifacts.packageLock);
    },
    readArtifacts(trialId) {
      const target = artifactDir(trialId);
      try {
        return { packageJson: fs.readFileSync(path.join(target, "package.json"), "utf8"), packageLock: fs.readFileSync(path.join(target, "package-lock.json"), "utf8") };
      } catch { return undefined; }
    },
  };
}

/**
 * A committed update changes package-lock.json while the canonical tree's node_modules still holds the old packages;
 * the always-on observer runs from that tree, and Windows locks files in use, so it is replaced only between two
 * observer launches: the observer exits with a planned-restart code when this marker exists and its wrapper
 * (scripts/ayas-autonomy-daemon.ps1) installs from the lock beside the old tree and swaps it in. Both read the file
 * name literally; neither imports this module.
 */
export const AYAS_CANONICAL_SYNC_MARKER = "canonical-sync-required.json";
export interface AyasCanonicalSyncRequest { readonly schemaVersion: 1; readonly requestedAt: string; readonly applyId: string; readonly commitSha: string; readonly packageLockSha256: string }

/** Asks for the canonical node_modules sync; a later request replaces an earlier one (the wrapper installs from HEAD's lock). */
export function requestAyasCanonicalDependencySync(rootDir: string, request: Omit<AyasCanonicalSyncRequest, "schemaVersion">): void {
  writeAtomic(rootDir, path.join(rootDir, AYAS_CANONICAL_SYNC_MARKER), `${JSON.stringify({ schemaVersion: 1, ...request }, null, 2)}\n`);
}

export function readAyasCanonicalSyncRequest(rootDir: string): AyasCanonicalSyncRequest | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(rootDir, AYAS_CANONICAL_SYNC_MARKER), "utf8")) as AyasCanonicalSyncRequest;
    return parsed?.schemaVersion === 1 ? parsed : undefined;
  } catch { return undefined; }
}

export const newAyasUpdateTrialId = (): string => `ayas-update-trial-${crypto.randomUUID()}`;

/** sha256 over the exact tested bytes, the approved item and the base commit; what an "Uygula" click binds to. */
export function ayasUpdateTrialHash(record: Pick<AyasUpdateTrialRecord, "trialId" | "itemHash" | "baseHead" | "packageJsonSha256" | "packageLockSha256" | "installSpecs">): string {
  return sha256(JSON.stringify(["ayas-update-trial:v1", record.trialId, record.itemHash, record.baseHead, record.packageJsonSha256, record.packageLockSha256, record.installSpecs]));
}

/** A PASSED trial whose stored artifacts still hash to what was tested and whose trial hash re-derives. */
export function isAyasUpdateTrialIntact(record: AyasUpdateTrialRecord, artifacts: AyasUpdateTrialArtifacts | undefined): boolean {
  if (record.status !== "PASSED" || !artifacts || !record.trialHash) return false;
  if (sha256(artifacts.packageJson) !== record.packageJsonSha256 || sha256(artifacts.packageLock) !== record.packageLockSha256) return false;
  if (!record.steps.length || record.steps.some((step) => !step.ok)) return false;
  return ayasUpdateTrialHash(record) === record.trialHash;
}

export const ayasUpdateTrialSha256 = sha256;

/* ------------------------------------------------------------- install plan --- */

type PackageJson = { readonly dependencies?: Record<string, string>; readonly devDependencies?: Record<string, string>; readonly [key: string]: unknown };

/** Packages that must move in lockstep with the tracked one (same version), when this repository lists them. */
const COMPANIONS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  next: ["eslint-config-next"],
  react: ["react-dom"],
});

const NPM_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const EXACT_VERSION = /^\d+\.\d+\.\d+$/;

export interface AyasUpdateInstallPlan {
  readonly specs: readonly string[];
  /** Keep exact pins exact (next 16.4.1 stays "16.4.2", not "^16.4.2"); a range stays a range. */
  readonly saveExact: boolean;
}

export function buildAyasUpdateInstallPlan(packageJson: PackageJson, packageName: string, version: string): AyasUpdateInstallPlan {
  if (!NPM_NAME.test(packageName) || !EXACT_VERSION.test(version)) throw new Error("update install plan: invalid package or version");
  const spec = (name: string): string | undefined => packageJson.dependencies?.[name] ?? packageJson.devDependencies?.[name];
  const current = spec(packageName);
  if (current === undefined) throw new Error(`update install plan: ${packageName} is not a direct dependency`);
  const companions = (COMPANIONS[packageName] ?? []).filter((name) => spec(name) !== undefined);
  return Object.freeze({
    specs: Object.freeze([packageName, ...companions].map((name) => `${name}@${version}`)),
    saveExact: EXACT_VERSION.test(current),
  });
}

/**
 * The install may change only the dependency entries it was asked to; anything else in package.json (scripts, other
 * dependencies, overrides, engines) is a refusal.
 */
export function checkAyasPackageJsonChange(before: PackageJson, after: PackageJson, specs: readonly string[]): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  const names = new Set(specs.map((spec) => spec.slice(0, spec.lastIndexOf("@"))));
  const strip = (pkg: PackageJson): string => {
    const clone: Record<string, unknown> = { ...pkg };
    for (const key of ["dependencies", "devDependencies"] as const) {
      const deps: Record<string, string> = { ...(pkg[key] ?? {}) };
      for (const name of names) delete deps[name];
      clone[key] = deps;
    }
    return canonicalJson(clone);
  };
  if (strip(before) !== strip(after)) return { ok: false, reason: "package.json changed beyond the approved dependency entries" };
  for (const name of names) {
    const section: "dependencies" | "devDependencies" = before.dependencies?.[name] !== undefined ? "dependencies" : "devDependencies";
    if (after[section]?.[name] === undefined) return { ok: false, reason: `${name} moved out of ${section}` };
  }
  return { ok: true };
}

/** Stable JSON with sorted keys at every level. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** A lockfile's packages map; the root entry ("") carries a name, not a version. */
type PackageLock = { readonly packages?: Readonly<Record<string, Readonly<Record<string, unknown>>>> };

/** Every installed package that appeared, disappeared or changed version; direct dependencies listed by name. */
export function diffAyasPackageLocks(before: PackageLock, after: PackageLock, directNames: readonly string[]): NonNullable<AyasUpdateTrialRecord["lockChanges"]> {
  const a = before.packages ?? {}; const b = after.packages ?? {};
  const version = (map: typeof a, key: string): string | undefined => { const value = map[key]?.version; return typeof value === "string" ? value : undefined; };
  let added = 0; let removed = 0; let changed = 0;
  for (const key of Object.keys(b)) if (key && !(key in a)) added += 1; else if (key && version(a, key) !== version(b, key)) changed += 1;
  for (const key of Object.keys(a)) if (key && !(key in b)) removed += 1;
  const direct = directNames
    .map((name) => ({ name, from: version(a, `node_modules/${name}`), to: version(b, `node_modules/${name}`) }))
    .filter((entry) => entry.from !== entry.to)
    .map((entry) => Object.freeze({ name: entry.name, ...(entry.from ? { from: entry.from } : {}), ...(entry.to ? { to: entry.to } : {}) }));
  return Object.freeze({ added, removed, changed, direct: Object.freeze(direct) });
}

/** The smokes CI itself runs, read from the workflow so the trial and CI cannot drift apart. */
export function readAyasCiSmokeCommands(workflow: string): readonly (readonly string[])[] {
  const commands: string[][] = [];
  for (const match of workflow.matchAll(/^\s*run:\s*npx tsx (scripts\/smoke-[A-Za-z0-9._-]+\.ts)((?:\s+--[A-Za-z0-9-]+)*)\s*$/gm)) {
    commands.push([match[1]!, ...(match[2] ?? "").trim().split(/\s+/).filter(Boolean)]);
  }
  return Object.freeze(commands.map((command) => Object.freeze(command)));
}

/* ------------------------------------------------------------ job selection --- */

/** Two interrupted attempts for the same approval stop automatic retries; the owner re-approves to try again. */
export const AYAS_UPDATE_TRIAL_MAX_ABANDONED = 2;

export type AyasUpdateTrialJob =
  | { readonly kind: "TRIAL"; readonly approval: AyasUpdateApprovalView; readonly reason: "FIRST" | "RETRY_ABANDONED" | "HEAD_MOVED" }
  | { readonly kind: "NONE"; readonly reason: string };

/**
 * Which approval to try next, deterministically: the oldest waiting npm approval that has no trial on this HEAD yet.
 * A FAILED trial is never retried automatically (the result would not change without a code change); a PASSED one is
 * re-run once per new HEAD so "Uygula" always binds to a trial of the commit it will land on.
 */
export function selectAyasUpdateTrialJob(input: {
  readonly approvals: readonly AyasUpdateApprovalView[];
  readonly trials: readonly AyasUpdateTrialRecord[];
  readonly head: string;
}): AyasUpdateTrialJob {
  const waiting = input.approvals.filter((approval) => approval.status === "WAITING" && approval.applyChannel === "DEVELOPMENT_SESSION" && approval.target.startsWith("npm:"))
    .sort((a, b) => a.approvedAt.localeCompare(b.approvedAt));
  for (const approval of waiting) {
    const trials = input.trials.filter((trial) => trial.approvalDecisionId === approval.decisionId);
    if (trials.some((trial) => trial.status === "RUNNING")) continue;
    if (trials.some((trial) => trial.status === "FAILED")) continue;
    if (trials.some((trial) => trial.baseHead === input.head && trial.status === "PASSED")) continue;
    const abandoned = trials.filter((trial) => trial.status === "ABANDONED").length;
    if (abandoned >= AYAS_UPDATE_TRIAL_MAX_ABANDONED) continue;
    const passedElsewhere = trials.some((trial) => trial.status === "PASSED");
    return Object.freeze({ kind: "TRIAL", approval, reason: passedElsewhere ? "HEAD_MOVED" : abandoned ? "RETRY_ABANDONED" : "FIRST" });
  }
  return Object.freeze({ kind: "NONE", reason: waiting.length ? "every waiting approval has a current trial" : "no waiting npm approval" });
}

/** At most this many untouched, interrupted attempts per "Uygula", and this many live publish attempts per commit. */
export const AYAS_UPDATE_APPLY_MAX_ABANDONED = 2;
export const AYAS_UPDATE_LIVE_MAX_ATTEMPTS = 3;

export type AyasUpdateApplyJob =
  | { readonly kind: "APPLY"; readonly decision: AyasUpdateApplyDecisionRecord; readonly trial: AyasUpdateTrialRecord }
  | { readonly kind: "LIVE_PUBLISH"; readonly apply: AyasUpdateApplyRecord }
  | { readonly kind: "NONE" };

/**
 * The owner already clicked, so an "Uygula" goes before any new trial. A decision is carried out once: any apply record
 * for it ends the matter except an untouched interruption (ABANDONED), which is retried a bounded number of times. A
 * committed and pushed update whose live publish has not succeeded is published again, also bounded.
 */
export function selectAyasUpdateApplyJob(input: {
  readonly decisions: readonly AyasUpdateApplyDecisionRecord[];
  readonly trials: readonly AyasUpdateTrialRecord[];
  readonly applies: readonly AyasUpdateApplyRecord[];
}): AyasUpdateApplyJob {
  const live = input.applies.find((apply) => apply.status === "COMPLETED" && apply.livePending && (apply.live?.attempts ?? 0) < AYAS_UPDATE_LIVE_MAX_ATTEMPTS);
  if (live) return Object.freeze({ kind: "LIVE_PUBLISH", apply: live });
  for (const decision of [...input.decisions].sort((a, b) => a.decidedAt.localeCompare(b.decidedAt))) {
    const records = input.applies.filter((apply) => apply.applyDecisionId === decision.decisionId);
    if (records.some((apply) => apply.status !== "ABANDONED")) continue;
    if (records.length >= AYAS_UPDATE_APPLY_MAX_ABANDONED) continue;
    const trial = input.trials.find((entry) => entry.trialId === decision.trialId && entry.status === "PASSED" && entry.trialHash === decision.trialHash);
    if (trial) return Object.freeze({ kind: "APPLY", decision, trial });
  }
  return Object.freeze({ kind: "NONE" });
}

/* ------------------------------------------------------------------- view --- */

export interface AyasUpdateTrialView {
  readonly trialId: string;
  readonly approvalDecisionId: string;
  readonly sourceId: string;
  readonly targetVersion: string;
  readonly status: AyasUpdateTrialStatus;
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly onCurrentHead: boolean;
  readonly baseHead: string;
  readonly steps: readonly AyasUpdateTrialStep[];
  readonly failedStep?: AyasUpdateTrialStepName;
  readonly failureReason?: string;
  readonly preExistingSmokeFailures: readonly string[];
  readonly lockChanges?: AyasUpdateTrialRecord["lockChanges"];
  readonly trialHash?: string;
}

/**
 * The HEAD the observer last saw (data/brain/autonomy/daemon-state.json): the commit the executor trials against.
 * Read from the file so the owner view never starts a process.
 */
export function readAyasObservedHead(repoRoot: string = process.cwd()): string | undefined {
  try {
    const state = JSON.parse(fs.readFileSync(path.join(repoRoot, "data", "brain", "autonomy", "daemon-state.json"), "utf8")) as { readonly lastObservationHead?: unknown };
    return typeof state.lastObservationHead === "string" && /^[0-9a-f]{40}$/.test(state.lastObservationHead) ? state.lastObservationHead : undefined;
  } catch { return undefined; }
}

/** The latest trial of each active approval, for the radar card. Read-only. */
export function listAyasUpdateTrialViews(input: { readonly approvals: readonly AyasUpdateApprovalView[]; readonly trials: readonly AyasUpdateTrialRecord[]; readonly head: string | undefined }): readonly AyasUpdateTrialView[] {
  const views: AyasUpdateTrialView[] = [];
  for (const approval of input.approvals) {
    const latest = input.trials.filter((trial) => trial.approvalDecisionId === approval.decisionId).sort((a, b) => a.startedAt.localeCompare(b.startedAt)).at(-1);
    if (!latest) continue;
    views.push(Object.freeze({
      trialId: latest.trialId, approvalDecisionId: latest.approvalDecisionId, sourceId: latest.sourceId, targetVersion: latest.targetVersion,
      status: latest.status, startedAt: latest.startedAt, ...(latest.finishedAt ? { finishedAt: latest.finishedAt } : {}),
      onCurrentHead: input.head !== undefined && latest.baseHead === input.head, baseHead: latest.baseHead, steps: latest.steps,
      ...(latest.failedStep ? { failedStep: latest.failedStep } : {}), ...(latest.failureReason ? { failureReason: latest.failureReason } : {}),
      preExistingSmokeFailures: latest.preExistingSmokeFailures ?? [], ...(latest.lockChanges ? { lockChanges: latest.lockChanges } : {}),
      ...(latest.trialHash ? { trialHash: latest.trialHash } : {}),
    }));
  }
  return Object.freeze(views);
}
