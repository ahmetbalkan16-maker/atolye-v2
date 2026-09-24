/**
 * Stage 10 developer handoff CLI — read-only. Recovers the real repository
 * state and prints a scoped task packet for the owner to paste into Claude or
 * Codex. It never mutates the repository, dispatches an agent or approves
 * anything; the real remote is queried only with --remote.
 *
 *   npx tsx scripts/ayas-developer-handoff.ts --task "<request>" --baseline <rev> \
 *     [--scope <path|dir/|glob>]... [--host claude|codex] [--registered-skills a,b] \
 *     [--unavailable-agents codex] [--progress <file.json>] [--deferred <text>]... \
 *     [--done <text>]... [--remote] [--json]
 */
import fs from "node:fs";
import { performance } from "node:perf_hooks";

import { describeAyasDeveloperTask, planAyasDeveloperChange } from "../src/lib/ayas/developer/AyasDeveloperTaskModel";
import { recoverAyasRepositoryState, type AyasSprintProgress } from "../src/lib/ayas/developer/AyasRepositoryRecovery";
import { selectAyasDeveloperSkills, type AyasSkillHost } from "../src/lib/ayas/developer/AyasDeveloperSkillIntelligence";
import { planAyasTestStrategy } from "../src/lib/ayas/developer/AyasDeveloperTestIntelligence";
import { planAyasReview } from "../src/lib/ayas/developer/AyasDeveloperReviewIntelligence";
import { compileAyasTaskPacket, selectAyasDeveloperAgent } from "../src/lib/ayas/developer/AyasDeveloperHandoff";
import { buildAyasTestIndex, collectAyasRepositoryState, discoverAyasSkillEvidence } from "../src/lib/ayas/developer/AyasRepositoryStateCollector";

function parseArgs(argv: readonly string[]) {
  const multi: Record<string, string[]> = {}; const flags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) throw new Error(`unexpected argument: ${arg}`);
    const key = arg.slice(2);
    if (key === "remote" || key === "json") { flags.add(key); continue; }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`--${key} needs a value`);
    (multi[key] ??= []).push(value); i += 1;
  }
  const one = (key: string) => multi[key]?.at(-1);
  const csv = (key: string) => (multi[key] ?? []).flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean);
  return { one, csv, many: (key: string) => multi[key] ?? [], flag: (key: string) => flags.has(key) };
}

async function main() {
  const started = performance.now();
  const args = parseArgs(process.argv.slice(2));
  const text = args.one("task"); const baseline = args.one("baseline");
  if (!text || !baseline) throw new Error("--task and --baseline are required");
  const hostArg = args.one("host");
  if (hostArg && hostArg !== "claude" && hostArg !== "codex") throw new Error("--host must be claude or codex");
  const host = (hostArg ?? null) as AyasSkillHost | null;
  const cwd = process.cwd();
  const expectedScope = args.many("scope");

  const state = await collectAyasRepositoryState({ cwd, trustedBaseline: baseline, checkRealRemote: args.flag("remote") });
  if (state.fatal) throw new Error(`STOP: repository state could not be established (${state.errors.join(", ")}); no packet was generated.`);
  const changedFiles = [...new Set([
    ...state.snapshot.entries.filter((entry) => entry.kind !== "ignored").map((entry) => entry.path),
    ...state.snapshot.commitsSinceBaseline.flatMap((commit) => commit.files),
  ])];
  const task = describeAyasDeveloperTask({ text, changedPaths: changedFiles });
  const supplied = args.one("progress") ? JSON.parse(fs.readFileSync(args.one("progress")!, "utf8")) as Partial<AyasSprintProgress> : {};
  const count = (value: unknown) => (Number.isInteger(value) && (value as number) >= 0 ? value as number : null);
  const reviewProgress = supplied.review && count(supplied.review.passesCompleted) !== null && count(supplied.review.openBlockers) !== null && count(supplied.review.openMajors) !== null ? supplied.review : null;
  const outcomes = new Set(["PASS", "FAIL", "TIMEOUT", "NOT_RUN"]); const sources = new Set(["this-session", "previous-agent", "checkpoint"]);
  const progress: AyasSprintProgress = {
    discoveryComplete: supplied.discoveryComplete === true,
    implementationComplete: typeof supplied.implementationComplete === "boolean" ? supplied.implementationComplete : null,
    // Malformed evidence is dropped, never promoted: missing evidence keeps VALIDATION open.
    validations: (Array.isArray(supplied.validations) ? supplied.validations : []).filter((v) => v && typeof v.id === "string" && typeof v.required === "boolean"
      && outcomes.has(v.outcome) && sources.has(v.source) && (v.observedAtState === null || typeof v.observedAtState === "string") && typeof v.rerunThisSession === "boolean"),
    review: reviewProgress,
    graphify: state.graphify,
    currentState: state.stateFingerprint,
  };
  const recovery = recoverAyasRepositoryState(state.snapshot, { trustedBaseline: baseline, expectedScope }, progress);
  const skills = selectAyasDeveloperSkills(task, discoverAyasSkillEvidence({ cwd, host, reportedRegistered: args.csv("registered-skills") }), recovery.firstUnfinishedGate);
  const tests = task.requiresTests ? planAyasTestStrategy({ task, changedFiles, graphAffectedFiles: [], index: buildAyasTestIndex(cwd) }) : null;
  const review = task.mutating || task.kind === "code-review" || task.kind === "architecture-review" ? planAyasReview(task, changedFiles) : null;
  const graphCurrent = Boolean(state.graphify && !state.graphify.stale && state.graphify.lastAnalyzedHead === state.snapshot.head && state.graphify.coversWorktree);
  const plan = planAyasDeveloperChange(task, { current: graphCurrent, targetSymbols: [], candidateFiles: changedFiles, affectedFiles: [] });
  const agent = selectAyasDeveloperAgent(task, recovery, { unavailableAgentIds: args.csv("unavailable-agents"), dispatchAdapterIds: [] });
  const packet = compileAyasTaskPacket({
    mission: text, task, recovery, agent, skills, tests, plan, review, expectedScope,
    graphify: state.graphify, knownDeferred: args.many("deferred"), doneItems: args.many("done"), acceptance: [],
  });
  const notes = [
    ...(expectedScope.length === 0 && changedFiles.length ? ["SCOPE_UNDECLARED: pass --scope for every intended path; undeclared changes are treated as drift."] : []),
    ...(args.flag("remote") ? [] : ["REAL_REMOTE_NOT_CHECKED: pass --remote to verify with git ls-remote."]),
    ...state.errors,
  ];
  const elapsedMs = Math.round(performance.now() - started);
  if (args.flag("json")) {
    console.log(JSON.stringify({ stateFingerprint: state.stateFingerprint, task, recovery, agent, skills, tests, review, plan, packet: { sizeChars: packet.sizeChars, approxTokens: packet.approxTokens, text: packet.text }, notes, elapsedMs }, null, 2));
    return;
  }
  console.log(packet.text);
  console.log(`\n---\nstate ${state.stateFingerprint} · ${packet.sizeChars} chars (~${packet.approxTokens} tokens) · ${elapsedMs} ms${notes.length ? `\n${notes.join("\n")}` : ""}`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
