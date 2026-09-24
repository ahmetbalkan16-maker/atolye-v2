/**
 * Stage 10 repository recovery. Pure: it interprets an already-collected Git /
 * Graphify / validation snapshot and decides what state an interrupted sprint
 * is really in and which gate is the first one still open. It never runs Git,
 * stages, commits, pushes, resets, or approves anything; the decision is
 * advice for the owner or a developer agent that still holds no authority.
 */
import { classifyAyasChangeAreas, type AyasChangeArea } from "./AyasDeveloperTaskModel";

export type AyasEntryKind = "tracked" | "untracked" | "ignored" | "unmerged";
export interface AyasRepositoryEntry {
  readonly path: string;
  readonly originalPath: string | null;
  /** Porcelain v2 status letters; "." means unchanged on that side. */
  readonly index: string;
  readonly worktree: string;
  readonly kind: AyasEntryKind;
}
export interface AyasCommitSummary { readonly hash: string; readonly subject: string; readonly files: readonly string[]; }
export interface AyasRepositorySnapshot {
  readonly branch: string | null;
  readonly head: string | null;
  readonly upstream: string | null;
  /** Local tracking ref; can be stale until the next fetch. */
  readonly upstreamHead: string | null;
  /** Real remote via ls-remote; null means it was not checked. */
  readonly remoteHead: string | null;
  readonly ahead: number | null;
  readonly behind: number | null;
  readonly entries: readonly AyasRepositoryEntry[];
  /** Commits in trustedBaseline..HEAD, newest first. */
  readonly commitsSinceBaseline: readonly AyasCommitSummary[];
}

/** Parses `git status --porcelain=v2 --branch -z [--ignored]`. */
export function parseAyasGitStatusPorcelainV2(raw: string): Pick<AyasRepositorySnapshot, "branch" | "head" | "upstream" | "ahead" | "behind" | "entries"> {
  const fields = String(raw ?? "").split("\0");
  let branch: string | null = null; let head: string | null = null; let upstream: string | null = null;
  let ahead: number | null = null; let behind: number | null = null;
  const entries: AyasRepositoryEntry[] = [];
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i]!;
    if (!field) continue;
    if (field.startsWith("# branch.oid ")) { const oid = field.slice(13).trim(); head = /^[0-9a-f]{7,64}$/.test(oid) ? oid : null; continue; }
    if (field.startsWith("# branch.head ")) { const name = field.slice(14).trim(); branch = name === "(detached)" ? null : name; continue; }
    if (field.startsWith("# branch.upstream ")) { upstream = field.slice(18).trim() || null; continue; }
    if (field.startsWith("# branch.ab ")) {
      const match = /^\+(\d+) -(\d+)$/.exec(field.slice(12).trim());
      if (match) { ahead = Number(match[1]); behind = Number(match[2]); }
      continue;
    }
    if (field.startsWith("#")) continue;
    const type = field[0];
    if (type === "?" || type === "!") {
      entries.push({ path: field.slice(2), originalPath: null, index: type, worktree: type, kind: type === "?" ? "untracked" : "ignored" });
      continue;
    }
    const parts = field.split(" ");
    const xy = parts[1] ?? "..";
    if (type === "1") entries.push({ path: parts.slice(8).join(" "), originalPath: null, index: xy[0]!, worktree: xy[1]!, kind: "tracked" });
    else if (type === "2") { entries.push({ path: parts.slice(9).join(" "), originalPath: fields[i + 1] ?? null, index: xy[0]!, worktree: xy[1]!, kind: "tracked" }); i += 1; }
    else if (type === "u") entries.push({ path: parts.slice(10).join(" "), originalPath: null, index: xy[0]!, worktree: xy[1]!, kind: "unmerged" });
  }
  return { branch, head, upstream, ahead, behind, entries };
}

export function isAyasEntryStaged(entry: AyasRepositoryEntry): boolean {
  return entry.kind === "tracked" && entry.index !== "." && entry.index !== " ";
}

export type AyasScopeClass = "EXPECTED" | "UNEXPECTED" | "CONFIG_DRIFT" | "GENERATED_ARTIFACT" | "DATA_DRIFT" | "SECRET_RISK" | "DAEMON_IGNORED" | "IGNORED_OTHER";
const BLOCKING_SCOPE: ReadonlySet<AyasScopeClass> = new Set(["UNEXPECTED", "CONFIG_DRIFT", "GENERATED_ARTIFACT", "DATA_DRIFT", "SECRET_RISK"]);
export function isAyasBlockingScope(scope: AyasScopeClass): boolean { return BLOCKING_SCOPE.has(scope); }

export interface AyasSprintContext {
  readonly trustedBaseline: string;
  /** Exact repo-relative paths, `dir/` prefixes, or `*`/`**` globs. */
  readonly expectedScope: readonly string[];
  /** Repository convention: a separate docs-only closure commit follows publication. */
  readonly closureRequired?: boolean;
  /** Ignored paths that a running daemon owns; attributed, never staged. */
  readonly daemonOwnedPrefixes?: readonly string[];
}

const DEFAULT_DAEMON_PREFIXES = ["data/brain/"] as const;
function scopePattern(pattern: string): RegExp {
  const normalized = pattern.replace(/\\/g, "/").replace(/^\.\//, "");
  if (normalized.endsWith("/")) return new RegExp(`^${normalized.replace(/[.+?^${}()|[\]\\]/g, "\\$&")}`);
  const body = normalized.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, ".*");
  return new RegExp(`^${body}$`);
}
export function matchesAyasExpectedScope(filePath: string, expectedScope: readonly string[]): boolean {
  const p = filePath.replace(/\\/g, "/");
  return expectedScope.some((pattern) => scopePattern(pattern).test(p));
}

export interface AyasScopedEntry extends AyasRepositoryEntry { readonly scope: AyasScopeClass; readonly areas: readonly AyasChangeArea[]; readonly staged: boolean; }
export function classifyAyasEntryScope(entry: AyasRepositoryEntry, context: AyasSprintContext): AyasScopedEntry {
  const areas = classifyAyasChangeAreas(entry.path);
  const daemonPrefixes = context.daemonOwnedPrefixes ?? DEFAULT_DAEMON_PREFIXES;
  let scope: AyasScopeClass;
  if (entry.kind === "ignored") scope = daemonPrefixes.some((prefix) => entry.path.replace(/\\/g, "/").startsWith(prefix)) ? "DAEMON_IGNORED" : "IGNORED_OTHER";
  else if (areas.includes("secret")) scope = "SECRET_RISK";
  else if (matchesAyasExpectedScope(entry.path, context.expectedScope)) scope = "EXPECTED";
  else if (areas.includes("config")) scope = "CONFIG_DRIFT";
  else if (areas.includes("generated")) scope = "GENERATED_ARTIFACT";
  else if (areas.includes("data")) scope = "DATA_DRIFT";
  else scope = "UNEXPECTED";
  return { ...entry, scope, areas, staged: isAyasEntryStaged(entry) };
}

export type AyasEvidenceTrust = "DIRECTLY_OBSERVED" | "INDEPENDENTLY_VERIFIED" | "RECORDED_FROM_PREVIOUS_AGENT" | "NOT_RERUN";
export interface AyasValidationEvidence {
  readonly id: string;
  readonly required: boolean;
  readonly outcome: "PASS" | "FAIL" | "TIMEOUT" | "NOT_RUN";
  readonly source: "this-session" | "previous-agent" | "checkpoint";
  /** HEAD + worktree fingerprint when observed; null when unknown. */
  readonly observedAtState: string | null;
  readonly rerunThisSession: boolean;
  /** Authority/security/data-integrity checks are never reused on another agent's word. */
  readonly safetyCritical?: boolean;
}
export function classifyAyasEvidenceTrust(evidence: AyasValidationEvidence, currentState: string): AyasEvidenceTrust {
  if (evidence.observedAtState === null || evidence.observedAtState !== currentState) return "NOT_RERUN";
  if (evidence.source === "this-session") return "DIRECTLY_OBSERVED";
  return evidence.rerunThisSession ? "INDEPENDENTLY_VERIFIED" : "RECORDED_FROM_PREVIOUS_AGENT";
}
export type AyasEvidenceReuse = "ACCEPTED" | "REUSABLE_RECORDED" | "MUST_RECHECK" | "FAILED";
/** Timeout is never a pass; a stale or safety-critical second-hand pass must be rerun. */
export function assessAyasEvidenceReuse(evidence: AyasValidationEvidence, currentState: string): { readonly trust: AyasEvidenceTrust; readonly reuse: AyasEvidenceReuse } {
  const trust = classifyAyasEvidenceTrust(evidence, currentState);
  if (evidence.outcome === "FAIL" || evidence.outcome === "TIMEOUT") return { trust, reuse: trust === "NOT_RERUN" ? "MUST_RECHECK" : "FAILED" };
  if (evidence.outcome !== "PASS") return { trust, reuse: "MUST_RECHECK" };
  if (trust === "DIRECTLY_OBSERVED" || trust === "INDEPENDENTLY_VERIFIED") return { trust, reuse: "ACCEPTED" };
  if (trust === "RECORDED_FROM_PREVIOUS_AGENT" && !evidence.safetyCritical) return { trust, reuse: "REUSABLE_RECORDED" };
  return { trust, reuse: "MUST_RECHECK" };
}

export interface AyasSprintProgress {
  readonly discoveryComplete: boolean;
  /** null = not reported; derived from the dirty/committed scope instead. */
  readonly implementationComplete: boolean | null;
  readonly validations: readonly AyasValidationEvidence[];
  readonly review: { readonly passesCompleted: number; readonly openBlockers: number; readonly openMajors: number } | null;
  readonly graphify: { readonly lastAnalyzedHead: string | null; readonly stale: boolean; readonly coversWorktree: boolean } | null;
  /** Current HEAD + worktree fingerprint used to judge evidence freshness. */
  readonly currentState: string;
}

export type AyasDeveloperGate =
  | "STOP_UNKNOWN_STATE" | "SYNC" | "SCOPE_REVIEW" | "DISCOVERY" | "IMPLEMENTATION" | "VALIDATION" | "GRAPHIFY_REFRESH"
  | "REVIEW" | "DOCUMENTATION" | "STAGE" | "COMMIT" | "POST_COMMIT_GRAPHIFY" | "PUSH" | "CLOSURE" | "REMOTE_VERIFICATION" | "CLOSED";
export type AyasRecoveryMode =
  | "STOP_UNKNOWN_STATE" | "DIVERGED" | "SYNC_REQUIRED" | "STOP_SCOPE_DRIFT" | "CLEAN_START" | "RESUME_UNCOMMITTED"
  | "RESUME_COMMITTED_UNPUSHED" | "RESUME_PUSHED_NEEDS_CLOSURE" | "RESUME_CLOSURE_IN_PROGRESS" | "CLOSED";
export type AyasGitReadiness = "NOT_READY" | "READY_TO_STAGE" | "READY_TO_COMMIT" | "READY_TO_PUSH" | "PUSHED_NEEDS_CLOSURE" | "FULLY_CLOSED";

export interface AyasWorkLifecycle {
  readonly implemented: boolean;
  readonly committed: boolean;
  readonly pushed: boolean;
  readonly pushEvidence: "REAL_REMOTE" | "TRACKING_REF_ONLY" | "NONE";
  readonly documented: boolean;
  readonly verified: boolean;
}

export interface AyasRepositoryRecovery {
  readonly mode: AyasRecoveryMode;
  readonly firstUnfinishedGate: AyasDeveloperGate;
  readonly readiness: AyasGitReadiness;
  readonly lifecycle: AyasWorkLifecycle;
  readonly trustedBaseline: string;
  readonly head: string | null;
  readonly entries: readonly AyasScopedEntry[];
  readonly scopeDrift: readonly string[];
  readonly committedOutOfScope: readonly string[];
  readonly attributedIgnored: readonly string[];
  readonly stagedPaths: readonly string[];
  readonly dirtyExpectedPaths: readonly string[];
  readonly featureCommit: string | null;
  readonly closureCommit: string | null;
  readonly acceptedEvidence: readonly string[];
  readonly reusableRecordedEvidence: readonly string[];
  readonly mustRecheckEvidence: readonly string[];
  readonly failedEvidence: readonly string[];
  /** The previous implementation is preserved: no gate ever implies reset, clean, stash or revert. */
  readonly preserveExistingWork: boolean;
  readonly reasonCodes: readonly string[];
}

const READINESS: Readonly<Record<AyasDeveloperGate, AyasGitReadiness>> = {
  STOP_UNKNOWN_STATE: "NOT_READY", SYNC: "NOT_READY", SCOPE_REVIEW: "NOT_READY", DISCOVERY: "NOT_READY",
  IMPLEMENTATION: "NOT_READY", VALIDATION: "NOT_READY", GRAPHIFY_REFRESH: "NOT_READY", REVIEW: "NOT_READY",
  DOCUMENTATION: "NOT_READY", STAGE: "READY_TO_STAGE", COMMIT: "READY_TO_COMMIT", POST_COMMIT_GRAPHIFY: "NOT_READY",
  PUSH: "READY_TO_PUSH", CLOSURE: "PUSHED_NEEDS_CLOSURE", REMOTE_VERIFICATION: "PUSHED_NEEDS_CLOSURE", CLOSED: "FULLY_CLOSED",
};
const isDocs = (p: string) => classifyAyasChangeAreas(p).every((area) => area === "documentation");
const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().every((value, index) => value === [...b].sort()[index]);

export function recoverAyasRepositoryState(snapshot: AyasRepositorySnapshot, context: AyasSprintContext, progress: AyasSprintProgress): AyasRepositoryRecovery {
  const reasons: string[] = [];
  const closureRequired = context.closureRequired ?? true;
  const entries = snapshot.entries.map((entry) => classifyAyasEntryScope(entry, context));
  const live = entries.filter((entry) => entry.kind !== "ignored");
  // A rename also changes its source path; an out-of-scope source is drift too.
  const renamedFromOutside = live.filter((entry) => entry.originalPath !== null && !matchesAyasExpectedScope(entry.originalPath, context.expectedScope)).map((entry) => entry.originalPath!);
  const scopeDrift = [...live.filter((entry) => isAyasBlockingScope(entry.scope)).map((entry) => entry.path), ...renamedFromOutside];
  const commits = snapshot.commitsSinceBaseline;
  const committedOutOfScope = [...new Set(commits.flatMap((commit) => commit.files).filter((file) => !matchesAyasExpectedScope(file, context.expectedScope)))];
  const attributedIgnored = entries.filter((entry) => entry.scope === "DAEMON_IGNORED").map((entry) => entry.path);
  const stagedPaths = live.filter((entry) => entry.staged).map((entry) => entry.path);
  const dirtyExpected = live.filter((entry) => entry.scope === "EXPECTED");
  const dirtyExpectedPaths = dirtyExpected.map((entry) => entry.path);
  const dirtySource = dirtyExpected.filter((entry) => !isDocs(entry.path));
  const featureCommits = commits.filter((commit) => commit.files.some((file) => !isDocs(file)));
  const featureCommit = featureCommits.length ? featureCommits[featureCommits.length - 1]!.hash : null;
  const latest = commits[0];
  const closureCommit = latest && featureCommits.length && latest.files.length > 0 && latest.files.every(isDocs) ? latest.hash : null;
  const committed = commits.length > 0;
  const documented = closureRequired ? closureCommit !== null || (committed && featureCommits.length === 0) : committed;

  const verdicts = progress.validations.filter((evidence) => evidence.required).map((evidence) => ({ evidence, ...assessAyasEvidenceReuse(evidence, progress.currentState) }));
  const acceptedEvidence = verdicts.filter((v) => v.reuse === "ACCEPTED").map((v) => v.evidence.id);
  const reusableRecordedEvidence = verdicts.filter((v) => v.reuse === "REUSABLE_RECORDED").map((v) => v.evidence.id);
  const mustRecheckEvidence = verdicts.filter((v) => v.reuse === "MUST_RECHECK").map((v) => v.evidence.id);
  const failedEvidence = verdicts.filter((v) => v.reuse === "FAILED").map((v) => v.evidence.id);
  const verified = verdicts.length > 0 && verdicts.every((v) => v.reuse === "ACCEPTED" || v.reuse === "REUSABLE_RECORDED");
  const validationOpen = verdicts.some((v) => v.reuse === "MUST_RECHECK" || v.reuse === "FAILED");

  const head = snapshot.head;
  const remoteKnown = snapshot.remoteHead !== null;
  const trackingPushed = snapshot.upstreamHead !== null && snapshot.upstreamHead === head && (snapshot.ahead ?? 1) === 0;
  const pushEvidence: AyasWorkLifecycle["pushEvidence"] = !committed ? "NONE" : remoteKnown ? (snapshot.remoteHead === head ? "REAL_REMOTE" : "NONE") : trackingPushed ? "TRACKING_REF_ONLY" : "NONE";
  const pushed = committed && pushEvidence !== "NONE";
  const implemented = dirtySource.length > 0 || featureCommits.length > 0 || (progress.implementationComplete ?? false);
  const lifecycle: AyasWorkLifecycle = Object.freeze({ implemented, committed, pushed, pushEvidence, documented, verified });

  const finish = (mode: AyasRecoveryMode, gate: AyasDeveloperGate): AyasRepositoryRecovery => Object.freeze({
    mode, firstUnfinishedGate: gate, readiness: READINESS[gate], lifecycle, trustedBaseline: context.trustedBaseline, head,
    entries, scopeDrift, committedOutOfScope, attributedIgnored, stagedPaths, dirtyExpectedPaths, featureCommit, closureCommit,
    acceptedEvidence, reusableRecordedEvidence, mustRecheckEvidence, failedEvidence,
    preserveExistingWork: true, reasonCodes: Object.freeze(reasons),
  });

  if (!head || !snapshot.branch || live.some((entry) => entry.kind === "unmerged")) {
    reasons.push(!head || !snapshot.branch ? "DETACHED_OR_UNBORN_HEAD" : "UNMERGED_PATHS_PRESENT");
    return finish("STOP_UNKNOWN_STATE", "STOP_UNKNOWN_STATE");
  }
  const ahead = snapshot.ahead ?? 0; const behind = snapshot.behind ?? 0;
  if (ahead > 0 && behind > 0) { reasons.push("LOCAL_AND_REMOTE_DIVERGED_NO_FORCE"); return finish("DIVERGED", "SYNC"); }
  const remoteMoved = remoteKnown && snapshot.remoteHead !== head && snapshot.remoteHead !== snapshot.upstreamHead;
  if (behind > 0 || remoteMoved) {
    reasons.push(behind > 0 ? "LOCAL_BEHIND_TRACKING" : "REAL_REMOTE_MOVED_FETCH_REQUIRED");
    if (live.length > 0) reasons.push("DIRTY_WHILE_BEHIND_OWNER_DECISION");
    return finish("SYNC_REQUIRED", "SYNC");
  }
  if (scopeDrift.length > 0 || committedOutOfScope.length > 0) {
    if (live.some((entry) => entry.staged && isAyasBlockingScope(entry.scope))) reasons.push("STAGED_SCOPE_DRIFT");
    if (scopeDrift.length > 0) reasons.push("WORKTREE_SCOPE_DRIFT");
    if (committedOutOfScope.length > 0) reasons.push("COMMITTED_SCOPE_DRIFT");
    return finish("STOP_SCOPE_DRIFT", "SCOPE_REVIEW");
  }
  if (attributedIgnored.length > 0) reasons.push("DAEMON_IGNORED_CHANGES_ATTRIBUTED");

  // Uncommitted work: either the feature itself or a docs-only closure.
  if (dirtyExpected.length > 0) {
    const closureInProgress = featureCommit !== null && dirtySource.length === 0;
    const mode: AyasRecoveryMode = closureInProgress ? "RESUME_CLOSURE_IN_PROGRESS" : "RESUME_UNCOMMITTED";
    if (!closureInProgress && progress.implementationComplete === false) { reasons.push("IMPLEMENTATION_REPORTED_INCOMPLETE"); return finish(mode, "IMPLEMENTATION"); }
    if (validationOpen || (dirtySource.length > 0 && verdicts.length === 0)) { reasons.push(verdicts.length === 0 ? "NO_VALIDATION_EVIDENCE" : "VALIDATION_EVIDENCE_NOT_ACCEPTABLE"); return finish(mode, "VALIDATION"); }
    if (dirtySource.length > 0) {
      const graph = progress.graphify;
      if (!graph || graph.stale || graph.lastAnalyzedHead !== head || !graph.coversWorktree) { reasons.push("GRAPHIFY_DOES_NOT_COVER_WORKTREE"); return finish(mode, "GRAPHIFY_REFRESH"); }
      const review = progress.review;
      if (!review || review.passesCompleted < 2 || review.openBlockers > 0 || review.openMajors > 0) { reasons.push(review && (review.openBlockers > 0 || review.openMajors > 0) ? "OPEN_BLOCKER_OR_MAJOR" : "REVIEW_INCOMPLETE"); return finish(mode, "REVIEW"); }
      const expectsDocs = context.expectedScope.some((pattern) => /\.md$|^docs\//.test(pattern));
      if (expectsDocs && !dirtyExpected.some((entry) => isDocs(entry.path)) && featureCommit === null) { reasons.push("DOCUMENTATION_NOT_UPDATED"); return finish(mode, "DOCUMENTATION"); }
    }
    // Staged-then-edited ("MM") or untracked entries would be left out of the commit.
    const fullyStaged = sameSet(stagedPaths, dirtyExpectedPaths) && dirtyExpected.every((entry) => entry.kind === "tracked" && entry.staged && entry.worktree === ".");
    if (!fullyStaged) { reasons.push(stagedPaths.length === 0 ? "NOTHING_STAGED" : sameSet(stagedPaths, dirtyExpectedPaths) ? "UNSTAGED_CHANGES_AFTER_STAGE" : "PARTIAL_STAGE"); return finish(mode, "STAGE"); }
    reasons.push("STAGED_SET_MATCHES_EXPECTED");
    return finish(mode, "COMMIT");
  }

  if (!committed) { reasons.push(progress.discoveryComplete ? "DISCOVERY_DONE_NO_CHANGES" : "NO_PRIOR_WORK"); return finish("CLEAN_START", progress.discoveryComplete ? "IMPLEMENTATION" : "DISCOVERY"); }

  // Clean worktree with committed work.
  if (validationOpen) { reasons.push("COMMITTED_WITHOUT_ACCEPTABLE_EVIDENCE"); return finish(ahead > 0 ? "RESUME_COMMITTED_UNPUSHED" : "RESUME_PUSHED_NEEDS_CLOSURE", "VALIDATION"); }
  const graph = progress.graphify;
  if (!graph || graph.stale || graph.lastAnalyzedHead !== head) { reasons.push("GRAPHIFY_BEHIND_HEAD"); return finish(ahead > 0 ? "RESUME_COMMITTED_UNPUSHED" : "RESUME_PUSHED_NEEDS_CLOSURE", "POST_COMMIT_GRAPHIFY"); }
  if (ahead > 0 || (remoteKnown && snapshot.remoteHead !== head)) { reasons.push("LOCAL_COMMITS_NOT_PUBLISHED"); return finish("RESUME_COMMITTED_UNPUSHED", "PUSH"); }
  if (!documented) { reasons.push("CLOSURE_DOCS_MISSING"); return finish("RESUME_PUSHED_NEEDS_CLOSURE", "CLOSURE"); }
  if (pushEvidence !== "REAL_REMOTE") { reasons.push("REAL_REMOTE_UNVERIFIED"); return finish("RESUME_PUSHED_NEEDS_CLOSURE", "REMOTE_VERIFICATION"); }
  reasons.push("LOCAL_TRACKING_REMOTE_MATCH_CLEAN");
  // Git closure is not verification; the lifecycle keeps VERIFIED separate.
  if (!verified) reasons.push("CLOSED_WITHOUT_ACCEPTED_VALIDATION_EVIDENCE");
  return finish("CLOSED", "CLOSED");
}

export interface AyasCheckpointFacts {
  readonly branch: string | null;
  readonly finalHead: string | null;
  readonly featureCommit: string | null;
  readonly closureCommit: string | null;
  readonly validations: readonly AyasValidationEvidence[];
  readonly currentState: string;
  readonly graphify: { readonly lastAnalyzedHead: string | null; readonly stale: boolean; readonly duplicateIds: number; readonly duplicateEdges: number; readonly dangling: number; readonly selfLoops: number } | null;
  readonly integrity: readonly { readonly name: string; readonly before: string | null; readonly after: string | null }[];
  readonly knownLimitations: readonly string[];
  readonly nextStage: string | null;
}
/** Builds checkpoint lines from verified facts only; everything else is listed as omitted. */
export function compileAyasVerifiedCheckpoint(facts: AyasCheckpointFacts): { readonly lines: readonly string[]; readonly omitted: readonly string[] } {
  const lines: string[] = []; const omitted: string[] = [];
  if (facts.branch && facts.finalHead) lines.push(`Branch ${facts.branch}; HEAD ${facts.finalHead}.`); else omitted.push("branch/HEAD unknown");
  if (facts.featureCommit) lines.push(`Feature commit ${facts.featureCommit}.`);
  if (facts.closureCommit) lines.push(`Closure commit ${facts.closureCommit}.`);
  const passed: string[] = [];
  for (const evidence of facts.validations) {
    const { reuse, trust } = assessAyasEvidenceReuse(evidence, facts.currentState);
    if (reuse === "ACCEPTED") passed.push(evidence.id);
    else omitted.push(`${evidence.id}: ${evidence.outcome} (${trust}) not recorded as verified`);
  }
  if (passed.length) lines.push(`Verified passing: ${passed.join(", ")}.`);
  const g = facts.graphify;
  if (g && facts.finalHead && g.lastAnalyzedHead === facts.finalHead && !g.stale && g.duplicateIds + g.duplicateEdges + g.dangling + g.selfLoops === 0) lines.push(`Graphify current at ${facts.finalHead}; zero structural anomalies.`);
  else omitted.push("Graphify currency/structure not verified at final HEAD");
  const measured = facts.integrity.filter((item) => item.before !== null && item.after !== null);
  const changed = measured.filter((item) => item.before !== item.after).map((item) => item.name);
  const unmeasured = facts.integrity.filter((item) => item.before === null || item.after === null).map((item) => item.name);
  if (unmeasured.length) omitted.push(`integrity not measured: ${unmeasured.join(", ")}`);
  if (measured.length && changed.length === 0 && unmeasured.length === 0) lines.push("Runtime/Test Mutation: NONE.");
  else if (changed.length) lines.push(`Changed between fingerprints (attribute before claiming NONE): ${changed.join(", ")}.`);
  for (const limitation of facts.knownLimitations) lines.push(`Limitation: ${limitation}`);
  if (facts.nextStage) lines.push(`Next: ${facts.nextStage}.`);
  return Object.freeze({ lines, omitted });
}
