/**
 * Stage 10 developer handoff: agent choice, context compression and a bounded
 * task-packet compiler. Pure. AYAS has no live Claude/Codex adapter, so a
 * packet is text the owner pastes manually; choosing an agent is advice,
 * never a dispatch, approval or publication. Safety-critical constraints are
 * always emitted, however small the packet is made.
 */
import type { AyasChangePlan, AyasDeveloperAgentId, AyasDeveloperTask } from "./AyasDeveloperTaskModel";
import type { AyasDeveloperGate, AyasRepositoryRecovery } from "./AyasRepositoryRecovery";
import type { AyasReviewPlan } from "./AyasDeveloperReviewIntelligence";
import type { AyasSkillSelection } from "./AyasDeveloperSkillIntelligence";
import { AYAS_KNOWN_UNSAFE_TESTS, type AyasTestStrategy } from "./AyasDeveloperTestIntelligence";
import { AYAS_GRAPHIFY_REFRESH_COMMAND } from "./AyasGraphifyState";

export type AyasAgentTarget = AyasDeveloperAgentId | "any-developer-agent" | "local-tool" | "none";
export type AyasAgentDelivery = "LOCAL_READ_ONLY_TOOLS" | "MANUAL_OWNER_PASTE" | "ADAPTER_REQUIRES_OWNER_APPROVAL" | "WAIT_FOR_AGENT_AVAILABILITY" | "NO_AGENT_NEEDED" | "OWNER_DECISION_REQUIRED";
export interface AyasAgentEvidence {
  /** Agents reported unavailable (token/session limit, not installed). */
  readonly unavailableAgentIds: readonly string[];
  /** Real caller-owned dispatch adapters. None exist in AYAS today. */
  readonly dispatchAdapterIds: readonly string[];
  /** Optional bounded 0–5 prior evidence; a tie never picks a brand. */
  readonly priorEvidence?: Readonly<Record<string, number>>;
}
export interface AyasAgentRoute { readonly target: AyasAgentTarget; readonly delivery: AyasAgentDelivery; readonly packetStyle: "IMPLEMENTATION" | "ANALYSIS"; readonly reasonCodes: readonly string[]; }

const AGENTS: readonly AyasDeveloperAgentId[] = ["claude", "codex"];

export function selectAyasDeveloperAgent(task: AyasDeveloperTask, recovery: AyasRepositoryRecovery, evidence: AyasAgentEvidence): AyasAgentRoute {
  const reasons: string[] = [];
  const route = (target: AyasAgentTarget, delivery: AyasAgentDelivery): AyasAgentRoute => Object.freeze({ target, delivery, packetStyle: task.packetStyle, reasonCodes: Object.freeze(reasons) });
  const dirty = recovery.entries.some((entry) => entry.kind !== "ignored");
  // A read-only state question is safe to answer locally even while the repository needs an owner decision.
  if (task.handledLocally) { reasons.push("READ_ONLY_STATE_QUESTION"); return route("local-tool", "LOCAL_READ_ONLY_TOOLS"); }
  if (recovery.mode === "STOP_SCOPE_DRIFT" || recovery.mode === "DIVERGED" || recovery.mode === "STOP_UNKNOWN_STATE" || (recovery.mode === "SYNC_REQUIRED" && dirty)) {
    reasons.push("OWNER_DECISION_BEFORE_ANY_AGENT");
    return route("none", "OWNER_DECISION_REQUIRED");
  }
  if (recovery.mode === "CLOSED" && task.kind === "recovery-continuation") { reasons.push("NOTHING_TO_CONTINUE"); return route("none", "NO_AGENT_NEEDED"); }
  if (task.privateLocal) { reasons.push("PRIVATE_LOCAL_NO_EXTERNAL_AGENT"); return task.mutating ? route("none", "OWNER_DECISION_REQUIRED") : route("local-tool", "LOCAL_READ_ONLY_TOOLS"); }
  const unavailable = new Set<string>([...task.unavailableAgents, ...evidence.unavailableAgentIds]);
  const usable = AGENTS.filter((agent) => !unavailable.has(agent));
  if (unavailable.size) reasons.push("AGENT_UNAVAILABLE_EXCLUDED");
  const deliver = (target: AyasDeveloperAgentId | "any-developer-agent"): AyasAgentRoute => {
    if (target !== "any-developer-agent" && evidence.dispatchAdapterIds.includes(target)) { reasons.push("REGISTERED_ADAPTER_STILL_NEEDS_OWNER_APPROVAL"); return route(target, "ADAPTER_REQUIRES_OWNER_APPROVAL"); }
    reasons.push("NO_DISPATCH_ADAPTER_MANUAL_PASTE");
    return route(target, "MANUAL_OWNER_PASTE");
  };
  if (usable.length === 0) { reasons.push("ALL_DEVELOPER_AGENTS_UNAVAILABLE"); return route("none", "WAIT_FOR_AGENT_AVAILABILITY"); }
  if (task.namedAgent && usable.includes(task.namedAgent)) { reasons.push("OWNER_NAMED_AGENT"); return deliver(task.namedAgent); }
  const scored = usable.map((agent) => ({ agent, score: evidence.priorEvidence?.[agent] })).filter((item) => Number.isFinite(item.score) && item.score! >= 0 && item.score! <= 5);
  if (scored.length === usable.length && usable.length > 1) {
    scored.sort((a, b) => b.score! - a.score!);
    if (scored[0]!.score! > scored[1]!.score!) { reasons.push("PRIOR_EVIDENCE_WINNER"); return deliver(scored[0]!.agent); }
    reasons.push("PRIOR_EVIDENCE_TIE_NO_BRAND_PREFERENCE");
  }
  if (usable.length === 1 && unavailable.size > 0) { reasons.push("ONLY_REMAINING_AGENT"); return deliver(usable[0]!); }
  reasons.push("TASK_NEEDS_NOT_BRAND");
  return deliver("any-developer-agent");
}

const SECRET_PATTERNS: readonly RegExp[] = [
  /-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g,
  /\bsk-[A-Za-z0-9_-]{16,}/g, /\bgh[pousr]_[A-Za-z0-9]{20,}/g, /\bxox[baprs]-[A-Za-z0-9-]{10,}/g, /\bAKIA[0-9A-Z]{16}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/g,
  /\b(api[_-]?key|access[_-]?token|token|secret|password|passwd|authorization)\s*[:=]\s*["']?[^\s"']{6,}/gi,
];
export function redactAyasHandoffText(text: string, max = 600): string {
  let value = String(text ?? "");
  for (const pattern of SECRET_PATTERNS) value = value.replace(pattern, "[REDACTED]");
  value = value.replace(/\s+/g, " ").trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export type AyasContextItemKind = "checkpoint" | "plan" | "log" | "investigation" | "safety-rule" | "owner-decision" | "hazard" | "validation-evidence" | "dirty-state" | "unfinished-gate";
export interface AyasContextItem { readonly id: string; readonly kind: AyasContextItemKind; readonly text: string; readonly at: string; readonly superseded?: boolean; readonly closed?: boolean; }
const NEVER_DROP: ReadonlySet<AyasContextItemKind> = new Set(["safety-rule", "owner-decision", "hazard"]);
const LATEST_ONLY: ReadonlySet<AyasContextItemKind> = new Set(["checkpoint", "log", "dirty-state", "unfinished-gate"]);

/** Keeps what a continuing agent needs; a superseded checkpoint never overrides a newer one. */
export function compressAyasDeveloperContext(items: readonly AyasContextItem[]): { readonly kept: readonly AyasContextItem[]; readonly dropped: readonly { readonly id: string; readonly reason: string }[] } {
  const kept: AyasContextItem[] = []; const dropped: { id: string; reason: string }[] = [];
  const newest = new Map<AyasContextItemKind, string>();
  for (const item of items) {
    const current = newest.get(item.kind);
    if (!current || Date.parse(item.at) > Date.parse(items.find((other) => other.id === current)!.at)) newest.set(item.kind, item.id);
  }
  const latestEvidence = new Map<string, AyasContextItem>();
  for (const item of items) if (item.kind === "validation-evidence") {
    const key = item.text.split(":")[0]!.trim();
    const prior = latestEvidence.get(key);
    if (!prior || Date.parse(item.at) > Date.parse(prior.at)) latestEvidence.set(key, item);
  }
  for (const item of items) {
    if (NEVER_DROP.has(item.kind)) { kept.push(item); continue; }
    if (LATEST_ONLY.has(item.kind) && newest.get(item.kind) !== item.id) { dropped.push({ id: item.id, reason: item.kind === "checkpoint" ? "SUPERSEDED_CHECKPOINT" : `OLDER_${item.kind.toUpperCase().replace(/-/g, "_")}` }); continue; }
    if (item.kind === "plan" && item.superseded) { dropped.push({ id: item.id, reason: "SUPERSEDED_PLAN" }); continue; }
    if (item.kind === "investigation" && item.closed) { dropped.push({ id: item.id, reason: "CLOSED_INVESTIGATION" }); continue; }
    if (item.kind === "validation-evidence" && latestEvidence.get(item.text.split(":")[0]!.trim())?.id !== item.id) { dropped.push({ id: item.id, reason: "OLDER_EVIDENCE_SAME_CHECK" }); continue; }
    kept.push(item);
  }
  return Object.freeze({ kept, dropped });
}

export interface AyasTaskPacketInput {
  readonly mission: string;
  readonly task: AyasDeveloperTask;
  readonly recovery: AyasRepositoryRecovery;
  readonly agent: AyasAgentRoute;
  readonly skills: AyasSkillSelection;
  readonly tests: AyasTestStrategy | null;
  readonly plan: AyasChangePlan | null;
  readonly review: AyasReviewPlan | null;
  readonly expectedScope: readonly string[];
  readonly graphify: { readonly lastAnalyzedHead: string | null; readonly stale: boolean; readonly coversWorktree?: boolean } | null;
  readonly knownDeferred: readonly string[];
  readonly doneItems: readonly string[];
  readonly acceptance: readonly string[];
  readonly context?: readonly AyasContextItem[];
}
export interface AyasTaskPacketSection { readonly id: string; readonly title: string; readonly lines: readonly string[]; }
export interface AyasTaskPacket {
  readonly sections: readonly AyasTaskPacketSection[];
  readonly text: string;
  readonly sizeChars: number;
  readonly approxTokens: number;
  readonly includedOptional: readonly string[];
}

const GATE_ORDER: readonly AyasDeveloperGate[] = ["SYNC", "SCOPE_REVIEW", "DISCOVERY", "IMPLEMENTATION", "VALIDATION", "GRAPHIFY_REFRESH", "REVIEW", "DOCUMENTATION", "STAGE", "COMMIT", "POST_COMMIT_GRAPHIFY", "PUSH", "CLOSURE", "REMOTE_VERIFICATION", "CLOSED"];
const MAX_LIST = 20;
const list = (values: readonly string[]) => values.length === 0 ? "none" : values.length > MAX_LIST ? `${values.slice(0, MAX_LIST).join(", ")} (+${values.length - MAX_LIST} more)` : values.join(", ");

function gateInstruction(gate: AyasDeveloperGate, input: AyasTaskPacketInput): string {
  const r = input.recovery;
  switch (gate) {
    case "STOP_UNKNOWN_STATE": return "STOP: detached/unborn HEAD or unmerged paths. Report state; owner decides. No reset/checkout.";
    case "SYNC":
      if (r.mode === "DIVERGED") return "STOP: local and remote diverged. Report both heads; no rebase, reset or force push.";
      if (r.entries.some((entry) => entry.kind !== "ignored")) return "STOP: behind the remote with local changes. Report both; owner decides — no stash, reset or pull over dirty work.";
      return "git fetch, then git pull --ff-only; stop on any conflict or non-fast-forward.";
    case "SCOPE_REVIEW": return `STOP: scope drift in ${list([...r.scopeDrift, ...r.committedOutOfScope])}. Do not stage, revert or delete them; report and wait for owner decision.`;
    case "DISCOVERY": return "Graphify-first discovery and the latest checkpoint entry; no mutation yet.";
    case "IMPLEMENTATION": return input.plan ? `Implement per plan: ${input.plan.steps.filter((s) => s.id === "implement" || s.id.startsWith("graphify") || s.id === "read-candidates").map((s) => s.detail).join(" ")}` : "Implement the bounded change inside the declared scope.";
    case "VALIDATION": {
      const open = [...r.mustRecheckEvidence, ...r.failedEvidence];
      if (open.length === 0) {
        const runnable = input.tests?.runnable ?? [];
        return `No validation evidence is recorded for this state: run the TESTS section (${runnable.length ? `${list(runnable)} + ` : ""}static checks) and record each result against the current state fingerprint.`;
      }
      return `Re-run only what is not already accepted: ${list(open)}. Reuse accepted: ${list(r.acceptedEvidence)}; recorded and reusable: ${list(r.reusableRecordedEvidence)}.`;
    }
    case "GRAPHIFY_REFRESH": return `${AYAS_GRAPHIFY_REFRESH_COMMAND} (AST-only, no description batches); verify lastAnalyzedHead == HEAD, stale=false, zero duplicate/dangling/self-loop edges.`;
    case "REVIEW": return `Focused review (${input.review?.passes ?? 2} passes) on: ${list(input.review?.dimensions ?? ["correctness", "scope"])}. Fix valid findings only.`;
    case "DOCUMENTATION": return "Update docs/checkpoint with verified facts only.";
    // Never truncated: a partial list would stage a partial change.
    case "STAGE": return `Stage explicitly: git add -- ${r.dirtyExpectedPaths.join(" ")}; then git diff --cached --name-status and git diff --cached --check.`;
    case "COMMIT": return "Conventional commit of the staged set only; never --no-verify or --amend of published commits.";
    case "POST_COMMIT_GRAPHIFY": return `Refresh Graphify to the new HEAD (${AYAS_GRAPHIFY_REFRESH_COMMAND}) and verify structure before pushing.`;
    case "PUSH": return "Normal git push (never force); verify local HEAD == tracking == git ls-remote origin.";
    case "CLOSURE": return "Separate docs-only closure commit recording verified post-push facts, then normal push.";
    case "REMOTE_VERIFICATION": return "Verify git ls-remote origin <branch> equals HEAD; ahead/behind 0/0; worktree/index clean.";
    case "CLOSED": return "Nothing remains: report the closed state; do not reopen or redo work.";
  }
}

/** Compiles a scoped, size-measured packet. Optional sections appear only when relevant. */
export function compileAyasTaskPacket(input: AyasTaskPacketInput): AyasTaskPacket {
  const { task, recovery: r, agent } = input;
  const sections: AyasTaskPacketSection[] = [];
  const optional: string[] = [];
  const add = (id: string, title: string, lines: readonly string[], isOptional = false) => { if (lines.length) { sections.push({ id, title, lines }); if (isOptional) optional.push(id); } };
  const deliveryLine = agent.delivery === "MANUAL_OWNER_PASTE" ? "Delivery: manual — the owner pastes this packet; AYAS did not dispatch any agent."
    : agent.delivery === "ADAPTER_REQUIRES_OWNER_APPROVAL" ? "Delivery: a registered adapter exists but dispatch still needs explicit owner approval."
      : `Delivery: ${agent.delivery}.`;
  add("must-know", "MUST KNOW", [
    `Mission: ${redactAyasHandoffText(input.mission, 400)}`,
    `Task: ${task.kind} (${task.mutating ? "mutating" : "read-only"}, ${agent.packetStyle.toLowerCase()} packet) for ${agent.target}. ${deliveryLine}`,
    "Developer intelligence is not execution authority: owner approval and the execution gate stay external.",
    ...(input.knownDeferred.length ? [`Known deferred / pre-existing (not blockers, do not absorb): ${list(input.knownDeferred.map((item) => redactAyasHandoffText(item, 160)))}.`] : []),
  ]);
  const l = r.lifecycle;
  add("current-state", "CURRENT STATE", [
    `Baseline ${r.trustedBaseline}; HEAD ${r.head ?? "unknown"}; mode ${r.mode}; readiness ${r.readiness}.`,
    `IMPLEMENTED=${l.implemented} COMMITTED=${l.committed} PUSHED=${l.pushed}(${l.pushEvidence}) DOCUMENTED=${l.documented} VERIFIED=${l.verified} — these are not equivalent.`,
    `Dirty in scope: ${list(r.dirtyExpectedPaths)}; staged: ${list(r.stagedPaths)}.`,
    ...(r.scopeDrift.length || r.committedOutOfScope.length ? [`SCOPE DRIFT: ${list([...r.scopeDrift, ...r.committedOutOfScope])}.`] : []),
    ...(r.attributedIgnored.length ? [`Daemon-owned ignored changes (attribute, never stage): ${list(r.attributedIgnored)}.`] : []),
    `Evidence — accepted: ${list(r.acceptedEvidence)}; recorded by previous agent, reusable: ${list(r.reusableRecordedEvidence)}; must recheck: ${list([...r.mustRecheckEvidence, ...r.failedEvidence])}.`,
  ]);
  add("first-open-gate", "FIRST OPEN GATE", [`${r.firstUnfinishedGate}: ${gateInstruction(r.firstUnfinishedGate, input)}`]);
  const startIndex = GATE_ORDER.indexOf(r.firstUnfinishedGate);
  // After a sync the state changes, so later gates must be re-derived rather than listed (listing IMPLEMENTATION would invite a restart).
  const stopHere = ["STOP_UNKNOWN_STATE", "SCOPE_REVIEW", "CLOSED", "SYNC"].includes(r.firstUnfinishedGate) || !task.mutating;
  const notForClosure: readonly AyasDeveloperGate[] = r.mode === "RESUME_CLOSURE_IN_PROGRESS" ? ["IMPLEMENTATION", "GRAPHIFY_REFRESH", "REVIEW", "DOCUMENTATION", "CLOSURE"] : [];
  const remaining = stopHere || startIndex < 0 ? [] : GATE_ORDER.slice(startIndex + 1).filter((gate) => gate !== "SYNC" && gate !== "SCOPE_REVIEW" && gate !== "DISCOVERY" && !notForClosure.includes(gate));
  add("must-do", "MUST DO", [
    "Recover first: confirm branch, HEAD, tracking, real remote, staged/unstaged/untracked before any mutation.",
    ...(remaining.length ? [`Then, in order, only if each gate passes: ${remaining.join(" → ")}.`] : []),
    ...(r.firstUnfinishedGate === "SYNC" && r.mode === "SYNC_REQUIRED" && task.mutating ? ["After syncing, regenerate this packet from the new state; do not restart or redo completed work."] : []),
    ...(input.doneItems.length ? [`Already done — do NOT redo: ${list(input.doneItems.map((item) => redactAyasHandoffText(item, 160)))}.`] : []),
  ]);
  add("must-not-do", "MUST NOT DO", [
    "No git reset, clean, stash, blind revert, force checkout, force push, git add -A / git add . / commit -a, or --no-verify.",
    ...AYAS_KNOWN_UNSAFE_TESTS.map((hazard) => `DO NOT RUN ${hazard.scriptPath}: ${hazard.reason}.`),
    "No mutating test until its runtime/authority/legacy/brain roots are known; UNKNOWN isolation is never auto-run; timeout is never PASS.",
    "No live runtime/authority/legacy/memory/ledger/data/brain mutation; no paid provider calls; no live agent dispatch.",
    "Never print, stage or commit secrets, .env*, credential files, .graphify, runtime data or TEMP artifacts.",
    ...(task.mutating ? ["Do not stage files outside the declared scope; stop on unexpected drift."] : ["Read-only task: make no file, index or Git mutation."]),
  ]);
  if (input.expectedScope.length && task.mutating) add("scope", "SCOPE", [`Allowed paths: ${list(input.expectedScope)}.`, "Anything else changed = SCOPE DRIFT → stop and report."], true);
  if (task.requiresGraphify) {
    const g = input.graphify;
    const coverage = g?.lastAnalyzedHead === r.head ? (g.coversWorktree === false ? " (== HEAD, dirty files not yet in graph)" : " (== HEAD)") : " (behind HEAD)";
    const graphState = g ? `lastAnalyzedHead ${g.lastAnalyzedHead ?? "unknown"}${coverage}, stale=${g.stale}` : "graph state unknown";
    add("graphify", "GRAPHIFY", [
      `${graphState}. Graphify CLI: query/explain/path for ownership, explain for a symbol's dependents before changing it, review-delta/review-analysis on the final diff.`,
      ...(input.plan?.impactedFiles.length ? [`Graph-affected files: ${list(input.plan.impactedFiles)}.`] : []),
      ...(input.plan?.needsGraphFirst ? ["No graph evidence yet: locate symbols with Graphify first — do not read the whole repository."] : []),
    ], true);
  }
  const usable = input.skills.selected;
  if (usable.length || input.skills.missingRequired.length) {
    add("skills", "SKILLS (minimum set)", [
      ...usable.map((skill) => skill.delivery === "INVOKE" ? `${skill.skillId}: ${skill.status} — invoke (registered on host).` : `${skill.skillId}: INSTALLED_BUT_NOT_REGISTERED — read ${skill.localPath} directly; do not claim it was invoked.`),
      ...(input.skills.missingRequired.length ? [`Unavailable required guidance: ${list(input.skills.missingRequired)} — follow CLAUDE.md/AGENTS.md rules instead.`] : []),
      "Report actual use per skill with concrete evidence; file presence is not use.",
    ], true);
  }
  const t = input.tests;
  if (t && task.mutating && (t.selected.length || t.staticChecks.length)) {
    add("tests", "TESTS", [
      ...(t.runnable.length ? [`Runnable (isolation established): ${list(t.runnable)}.`] : []),
      ...(t.requiresTempRoot.length ? [`Needs TEMP roots before running: ${list(t.requiresTempRoot)}.`] : []),
      ...(t.unknownIsolation.length ? [`Isolation UNKNOWN — classify roots first, do not auto-run: ${list(t.unknownIsolation)}.`] : []),
      ...(t.requiresOwnerApproval.length ? [`Owner approval required (network/provider/OS/dispatch): ${list(t.requiresOwnerApproval)}.`] : []),
      ...(t.excludedUnsafe.length ? [`Excluded as known unsafe: ${list(t.excludedUnsafe.map((item) => item.scriptPath))}.`] : []),
      ...(t.missingAreaSuites.length ? [`Area suites not found (report, do not invent): ${list(t.missingAreaSuites)}.`] : []),
      `Static: ${t.staticChecks.join("; ")}.`,
    ], true);
  }
  if (input.review && task.mutating) add("review", "REVIEW", [`${input.review.passes} passes. ${input.review.checklist.join(" | ")}`], true);
  if (task.mutating && (task.dataSensitive || (t?.requiresTempRoot.length ?? 0) > 0 || (t?.selected.length ?? 0) > 0)) {
    add("data-integrity", "DATA INTEGRITY", ["Fingerprint runtime, authority, legacy projects, memory, usage ledger and data/brain before/after mutating tests; attribute daemon writes separately; target Runtime/Test Mutation: NONE."], true);
  }
  if (input.acceptance.length) add("acceptance", "ACCEPTANCE", input.acceptance.map((item) => redactAyasHandoffText(item, 200)), true);
  add("final-report", "FINAL REPORT", ["Report gates passed, evidence per check (directly observed / independently verified / recorded / not rerun), Git state (local/tracking/real remote), findings by class, and skill actual-use evidence."]);
  const compressed = input.context ? compressAyasDeveloperContext(input.context).kept : [];
  if (compressed.length) add("context", "CONTEXT (compressed)", compressed.map((item) => `${item.kind}: ${redactAyasHandoffText(item.text, 200)}`), true);
  const text = sections.map((section) => `## ${section.title}\n${section.lines.map((line) => `- ${line}`).join("\n")}`).join("\n\n");
  return Object.freeze({ sections, text, sizeChars: text.length, approxTokens: Math.ceil(text.length / 4), includedOptional: optional });
}
