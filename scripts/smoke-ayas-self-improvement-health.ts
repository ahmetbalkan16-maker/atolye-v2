import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  AYAS_HEALTH_HEARTBEAT_STALE_FACTOR,
  AYAS_HEALTH_KNOWN_OBSERVER_PHASES,
  AYAS_HEALTH_LOCK_STALE_AFTER_MS,
  AYAS_HEALTH_RESEARCH_FAILURE_CRITICAL,
  AYAS_HEALTH_RESEARCH_FAILURE_WARN,
  AYAS_HEALTH_RESEARCH_LOCK_LONG_HOLD_MS,
  AYAS_HEALTH_RESEARCH_OVERDUE_GRACE_MS,
  evaluateAyasSelfImprovementHealth,
  type AyasHealthFinding,
  type AyasSelfImprovementHealthInput,
} from "../src/lib/brain/autonomy/AyasSelfImprovementHealth";
import {
  AYAS_HEALTH_DEFAULT_DEEP_INTERVAL_MS,
  AYAS_HEALTH_DEFAULT_LIGHT_INTERVAL_MS,
  AYAS_HEALTH_DEFAULT_OBSERVER_INTERVAL_MS,
  collectAyasSelfImprovementHealthInput,
  readAyasSelfImprovementHealth,
} from "../src/lib/brain/autonomy/AyasSelfImprovementHealthCollector";
import { readProcessStartEpochMs } from "../src/lib/brain/autonomy/AyasProcessLiveness";
import { AYAS_RESEARCH_DEEP_INTERVAL_MS, AYAS_RESEARCH_LIGHT_INTERVAL_MS } from "../src/lib/brain/autonomy/AyasResearchScheduler";

let count = 0;
function scenario(name: string, fn: () => void | Promise<void>) { return Promise.resolve(fn()).then(() => { count += 1; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }); }
function delay(ms: number) { return new Promise<void>((resolve) => setTimeout(resolve, ms)); }

const SRC = path.join(__dirname, "..", "src", "lib", "brain", "autonomy");
const NOW = "2026-09-21T12:00:00.000Z";
const NOW_MS = Date.parse(NOW);
const iso = (offsetMs: number): string => new Date(NOW_MS + offsetMs).toISOString();
const SHA = "a".repeat(40);
const MIN = 60_000;

function healthy(): AyasSelfImprovementHealthInput {
  return {
    now: NOW,
    observer: { intervalMs: 5 * MIN, state: { kind: "ok", value: { schemaVersion: "1", phase: "OBSERVING", updatedAt: iso(-60_000), heartbeatCount: 10 } }, lock: { kind: "ok", value: { ownerStatus: "alive" } } },
    research: { enabled: true, lightIntervalMs: AYAS_HEALTH_DEFAULT_LIGHT_INTERVAL_MS, deepIntervalMs: AYAS_HEALTH_DEFAULT_DEEP_INTERVAL_MS, state: { kind: "ok", value: { schemaVersion: "1", consecutiveFailures: 0, nextLightAt: iso(3 * 60 * MIN), nextDeepAt: iso(20 * 60 * MIN) } }, lock: { kind: "absent" } },
    repo: { head: { kind: "ok", value: SHA }, clean: { kind: "ok", value: true }, graph: { kind: "ok", value: SHA } },
  };
}
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
function variant(edit: (input: Mutable<AyasSelfImprovementHealthInput>) => void): AyasSelfImprovementHealthInput {
  const copy = JSON.parse(JSON.stringify(healthy())) as Mutable<AyasSelfImprovementHealthInput>;
  edit(copy);
  return copy;
}
const codes = (findings: readonly AyasHealthFinding[]): string[] => findings.map((f) => f.code);
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); for (const inner of Object.values(value as object)) deepFreeze(inner); }
  return value;
}

/** Spawns and awaits a genuinely short-lived child, returning its (now-dead) PID. */
async function deadPid(): Promise<number> {
  const child = spawn(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore" });
  const pid = child.pid;
  if (!pid) throw new Error("failed to spawn fixture child process");
  await new Promise<void>((resolve) => child.on("exit", () => resolve()));
  await delay(80);
  return pid;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=fixture", "-c", "user.email=fixture@example.test", ...args], { cwd, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] }).trim();
}
function injectedGitReader(head: string | Error, status: string | Error): (repoRoot: string, args: readonly string[]) => string {
  return (_repoRoot, args) => {
    const result = args[0] === "rev-parse" ? head : status;
    if (result instanceof Error) throw result;
    return result;
  };
}
function writeJson(root: string, rel: string, value: unknown): void {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value)}\n`);
}
function backdate(target: string, ageMs: number): void {
  const past = new Date(Date.now() - ageMs);
  fs.utimesSync(target, past, past);
}
function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

interface Fixture { readonly root: string; readonly head: string }
/** A real, clean git repo whose runtime-state directories are ignored (as in production), so a fixture is `clean` unless a scenario dirties it on purpose. */
function makeRepo(): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-health-"));
  git(root, "init", "-q");
  fs.writeFileSync(path.join(root, ".gitignore"), "data/\n.graphify/\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "fixture");
  return { root, head: git(root, "rev-parse", "HEAD") };
}
function writeHealthyState(fixture: Fixture, myStart: number): void {
  writeJson(fixture.root, ".graphify/graph.json", {});
  writeJson(fixture.root, ".graphify/branch.json", { lastAnalyzedHead: fixture.head });
  writeJson(fixture.root, "data/brain/autonomy/daemon-state.json", { schemaVersion: "1", phase: "OBSERVING", updatedAt: new Date(Date.now() - 30_000).toISOString(), heartbeatCount: 7 });
  writeJson(fixture.root, "data/brain/autonomy/daemon.lock", { pid: process.pid, processStartEpochMs: myStart });
  writeJson(fixture.root, "data/brain/self-improvement/research/scheduler-state.json", { schemaVersion: "1", consecutiveFailures: 0, nextLightAt: new Date(Date.now() + 3 * 60 * MIN).toISOString(), nextDeepAt: new Date(Date.now() + 20 * 60 * MIN).toISOString() });
}
function researchLockDir(root: string): string { return path.join(root, "data", "brain", "self-improvement", "research", "execution", ".authority-lock"); }
function snapshotTree(root: string): string {
  const rows: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (entry.name === ".git") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { rows.push(`D ${path.relative(root, full)} ${fs.statSync(full).mtimeMs}`); walk(full); }
      else rows.push(`F ${path.relative(root, full)} ${fs.statSync(full).mtimeMs} ${fs.readFileSync(full, "utf8")}`);
    }
  };
  walk(root);
  return rows.join("\n");
}
function runCli(cwd: string, ...args: string[]): { readonly code: number; readonly stdout: string } {
  const repo = path.join(__dirname, "..");
  try {
    const stdout = execFileSync(process.execPath, [path.join(repo, "node_modules", "tsx", "dist", "cli.mjs"), path.join(repo, "scripts", "ayas-self-improvement-health.ts"), ...args], { cwd, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 });
    return { code: 0, stdout };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string };
    return { code: failure.status ?? -1, stdout: failure.stdout ?? "" };
  }
}

async function main() {
  // ---------------------------------------------------------------- pure evaluator
  await scenario("a fully healthy loop is HEALTHY with no findings and no owner action", () => {
    const result = evaluateAyasSelfImprovementHealth(healthy());
    assert.equal(result.verdict, "HEALTHY");
    assert.deepEqual(result.findings, []);
    assert.equal(result.ownerActionRecommended, false);
  });

  await scenario("a dead observer owner is DOWN and recommends owner action", () => {
    const result = evaluateAyasSelfImprovementHealth(variant((i) => { i.observer = { ...i.observer, lock: { kind: "ok", value: { ownerStatus: "dead" } } }; }));
    assert.equal(result.verdict, "DOWN");
    assert.equal(result.ownerActionRecommended, true);
    assert.equal(result.findings.find((f) => f.code === "OBSERVER_OWNER_DEAD")?.severity, "CRITICAL");
  });

  await scenario("no observer lock at all is DOWN — nobody claims to be the observer", () => {
    const result = evaluateAyasSelfImprovementHealth(variant((i) => { i.observer = { ...i.observer, lock: { kind: "absent" } }; }));
    assert.equal(result.verdict, "DOWN");
    assert.ok(codes(result.findings).includes("OBSERVER_LOCK_ABSENT"));
  });

  await scenario("no observer state file is DOWN, not healthy-by-default", () => {
    const result = evaluateAyasSelfImprovementHealth(variant((i) => { i.observer = { ...i.observer, state: { kind: "absent" } }; }));
    assert.equal(result.verdict, "DOWN");
    assert.ok(codes(result.findings).includes("OBSERVER_STATE_ABSENT"));
  });

  await scenario("an unreadable observer state is UNKNOWN — never guessed healthy", () => {
    const result = evaluateAyasSelfImprovementHealth(variant((i) => { i.observer = { ...i.observer, state: { kind: "unreadable" } }; }));
    assert.equal(result.verdict, "UNKNOWN");
    assert.equal(result.ownerActionRecommended, true);
  });

  await scenario("invalid required observer counters and intervals cannot fall through to HEALTHY", () => {
    const counter = evaluateAyasSelfImprovementHealth(variant((i) => { i.observer = { ...i.observer, state: { kind: "ok", value: { schemaVersion: "1", phase: "OBSERVING", updatedAt: NOW, heartbeatCount: -1 } } }; }));
    assert.equal(counter.verdict, "UNKNOWN");
    assert.ok(codes(counter.findings).includes("OBSERVER_STATE_UNREADABLE"));
    const interval = evaluateAyasSelfImprovementHealth(variant((i) => { i.observer = { ...i.observer, intervalMs: Number.NaN }; }));
    assert.equal(interval.verdict, "STALLED");
    assert.ok(codes(interval.findings).includes("OBSERVER_HEARTBEAT_UNREADABLE"));
  });

  await scenario("missing observer schema and a future heartbeat cannot fall through to HEALTHY", () => {
    const schema = evaluateAyasSelfImprovementHealth(variant((i) => { i.observer = { ...i.observer, state: { kind: "ok", value: { phase: "OBSERVING", updatedAt: NOW, heartbeatCount: 1 } as never } }; }));
    assert.equal(schema.verdict, "UNKNOWN");
    assert.ok(codes(schema.findings).includes("OBSERVER_STATE_UNREADABLE"));
    const future = evaluateAyasSelfImprovementHealth(variant((i) => { i.observer = { ...i.observer, state: { kind: "ok", value: { schemaVersion: "1", phase: "OBSERVING", updatedAt: iso(1), heartbeatCount: 1 } } }; }));
    assert.equal(future.verdict, "STALLED");
    assert.ok(codes(future.findings).includes("OBSERVER_HEARTBEAT_UNREADABLE"));
  });

  await scenario("heartbeat staleness boundary: exactly the threshold is fine, one millisecond past it is STALLED", () => {
    const threshold = 5 * MIN * AYAS_HEALTH_HEARTBEAT_STALE_FACTOR;
    const atLimit = evaluateAyasSelfImprovementHealth(variant((i) => { i.observer = { ...i.observer, state: { kind: "ok", value: { schemaVersion: "1", phase: "OBSERVING", updatedAt: iso(-threshold), heartbeatCount: 1 } } }; }));
    assert.equal(atLimit.verdict, "HEALTHY");
    const past = evaluateAyasSelfImprovementHealth(variant((i) => { i.observer = { ...i.observer, state: { kind: "ok", value: { schemaVersion: "1", phase: "OBSERVING", updatedAt: iso(-threshold - 1), heartbeatCount: 1 } } }; }));
    assert.equal(past.verdict, "STALLED");
    assert.equal(past.findings[0]?.code, "OBSERVER_HEARTBEAT_STALE");
    assert.equal(past.findings[0]?.severity, "CRITICAL");
  });

  await scenario("a stale heartbeat explained by a dead owner is evidence (WARN), not a second alarm — and the verdict stays DOWN", () => {
    const result = evaluateAyasSelfImprovementHealth(variant((i) => {
      i.observer = { intervalMs: 5 * MIN, state: { kind: "ok", value: { schemaVersion: "1", phase: "OBSERVING", updatedAt: iso(-3 * 60 * MIN), heartbeatCount: 1 } }, lock: { kind: "ok", value: { ownerStatus: "dead" } } };
    }));
    assert.equal(result.verdict, "DOWN");
    assert.equal(result.findings.find((f) => f.code === "OBSERVER_HEARTBEAT_STALE")?.severity, "WARN");
  });

  await scenario("a garbage heartbeat timestamp is CRITICAL — an unusable timestamp can never read as fresh", () => {
    const result = evaluateAyasSelfImprovementHealth(variant((i) => { i.observer = { ...i.observer, state: { kind: "ok", value: { schemaVersion: "1", phase: "OBSERVING", updatedAt: "not-a-date", heartbeatCount: 1 } } }; }));
    assert.equal(result.verdict, "STALLED");
    assert.ok(codes(result.findings).includes("OBSERVER_HEARTBEAT_UNREADABLE"));
  });

  await scenario("paused / error phases are DEGRADED (informational), not an alarm", () => {
    for (const [phase, code] of [["PAUSED_DIRTY_REPO", "OBSERVER_PAUSED_DIRTY_REPO"], ["PAUSED_MACHINE_HEALTH", "OBSERVER_PAUSED_MACHINE_HEALTH"], ["ERROR", "OBSERVER_IN_ERROR"]] as const) {
      const result = evaluateAyasSelfImprovementHealth(variant((i) => { i.observer = { ...i.observer, state: { kind: "ok", value: { schemaVersion: "1", phase, updatedAt: iso(-1000), heartbeatCount: 1 } } }; }));
      assert.equal(result.verdict, "DEGRADED", phase);
      assert.equal(result.ownerActionRecommended, false, phase);
      assert.ok(codes(result.findings).includes(code), phase);
    }
  });

  await scenario("an unrecognized phase is flagged and its text is never echoed into a finding", () => {
    const hostile = "<script>alert('x')</script> sk-live-SECRET";
    const result = evaluateAyasSelfImprovementHealth(variant((i) => { i.observer = { ...i.observer, state: { kind: "ok", value: { schemaVersion: "1", phase: hostile, updatedAt: iso(-1000), heartbeatCount: 1 } } }; }));
    assert.ok(codes(result.findings).includes("OBSERVER_PHASE_UNRECOGNIZED"));
    assert.ok(!JSON.stringify(result).includes("SECRET") && !JSON.stringify(result).includes("script"), "hostile phase text must not appear in the output");
  });

  await scenario("research lateness boundary: within grace is silent, past grace is WARN, a whole missed cadence is CRITICAL", () => {
    const evalNext = (nextLightOffset: number) => evaluateAyasSelfImprovementHealth(variant((i) => {
      i.research = { ...i.research, state: { kind: "ok", value: { schemaVersion: "1", consecutiveFailures: 0, nextLightAt: iso(nextLightOffset), nextDeepAt: iso(20 * 60 * MIN) } } };
    }));
    assert.equal(evalNext(-AYAS_HEALTH_RESEARCH_OVERDUE_GRACE_MS).verdict, "HEALTHY");
    const warn = evalNext(-AYAS_HEALTH_RESEARCH_OVERDUE_GRACE_MS - 1);
    assert.equal(warn.verdict, "DEGRADED");
    assert.equal(warn.findings[0]?.code, "RESEARCH_LIGHT_OVERDUE");
    assert.equal(warn.findings[0]?.severity, "WARN");
    const critical = evalNext(-AYAS_HEALTH_DEFAULT_LIGHT_INTERVAL_MS);
    assert.equal(critical.verdict, "STALLED");
    assert.equal(critical.findings[0]?.severity, "CRITICAL");
  });

  await scenario("the DEEP cadence is judged against its own (24h) interval, not LIGHT's", () => {
    const at = (offset: number) => evaluateAyasSelfImprovementHealth(variant((i) => {
      i.research = { ...i.research, state: { kind: "ok", value: { schemaVersion: "1", consecutiveFailures: 0, nextLightAt: iso(3 * 60 * MIN), nextDeepAt: iso(offset) } } };
    }));
    assert.equal(at(-7 * 60 * MIN).verdict, "DEGRADED", "7h late is only a delay for a 24h cadence");
    assert.equal(at(-24 * 60 * MIN).verdict, "STALLED");
    assert.equal(at(-24 * 60 * MIN).findings[0]?.code, "RESEARCH_DEEP_OVERDUE");
  });

  await scenario("a never-scheduled cadence (no nextAt yet) is not an overdue finding", () => {
    const result = evaluateAyasSelfImprovementHealth(variant((i) => { i.research = { ...i.research, state: { kind: "ok", value: { schemaVersion: "1", consecutiveFailures: 0 } } }; }));
    assert.equal(result.verdict, "HEALTHY");
  });

  await scenario("an empty research state is unreadable and can never report HEALTHY", () => {
    const result = evaluateAyasSelfImprovementHealth(variant((i) => { i.research = { ...i.research, state: { kind: "ok", value: {} as never } }; }));
    assert.equal(result.verdict, "DEGRADED");
    assert.deepEqual(codes(result.findings), ["RESEARCH_STATE_UNREADABLE"]);
  });

  await scenario("malformed LIGHT and DEEP cadence dates make the complete research state unreadable", () => {
    const result = evaluateAyasSelfImprovementHealth(variant((i) => { i.research = { ...i.research, state: { kind: "ok", value: { schemaVersion: "1", consecutiveFailures: 0, nextLightAt: "not-a-date", nextDeepAt: "also-bad" } } }; }));
    assert.equal(result.verdict, "DEGRADED");
    assert.deepEqual(codes(result.findings), ["RESEARCH_STATE_UNREADABLE"]);
  });

  await scenario("one malformed cadence date is not silently dropped when the other date is valid", () => {
    const result = evaluateAyasSelfImprovementHealth(variant((i) => { i.research = { ...i.research, state: { kind: "ok", value: { schemaVersion: "1", consecutiveFailures: 0, nextLightAt: iso(3 * 60 * MIN), nextDeepAt: "bad-deep-date" } } }; }));
    assert.equal(result.verdict, "DEGRADED");
    assert.deepEqual(codes(result.findings), ["RESEARCH_STATE_UNREADABLE"]);
  });

  await scenario("a wrong primitive type in research state is unreadable, not a healthy default", () => {
    const result = evaluateAyasSelfImprovementHealth(variant((i) => { i.research = { ...i.research, state: { kind: "ok", value: { schemaVersion: "1", consecutiveFailures: "0", nextLightAt: iso(3 * 60 * MIN), nextDeepAt: iso(20 * 60 * MIN) } as never } }; }));
    assert.equal(result.verdict, "DEGRADED");
    assert.deepEqual(codes(result.findings), ["RESEARCH_STATE_UNREADABLE"]);
  });

  await scenario("consecutive research failures: below the warn threshold is silent, then WARN, then CRITICAL", () => {
    const at = (failures: number) => evaluateAyasSelfImprovementHealth(variant((i) => {
      i.research = { ...i.research, state: { kind: "ok", value: { schemaVersion: "1", consecutiveFailures: failures, nextLightAt: iso(3 * 60 * MIN), nextDeepAt: iso(20 * 60 * MIN) } } };
    }));
    assert.equal(at(AYAS_HEALTH_RESEARCH_FAILURE_WARN - 1).verdict, "HEALTHY");
    assert.equal(at(AYAS_HEALTH_RESEARCH_FAILURE_WARN).verdict, "DEGRADED");
    assert.equal(at(AYAS_HEALTH_RESEARCH_FAILURE_CRITICAL - 1).verdict, "DEGRADED");
    assert.equal(at(AYAS_HEALTH_RESEARCH_FAILURE_CRITICAL).verdict, "STALLED");
  });

  await scenario("research disabled by env is INFO only and does not demand a state file", () => {
    const result = evaluateAyasSelfImprovementHealth(variant((i) => { i.research = { ...i.research, enabled: false, state: { kind: "absent" } }; }));
    assert.equal(result.verdict, "HEALTHY");
    assert.deepEqual(codes(result.findings), ["RESEARCH_DISABLED_BY_ENV"]);
  });

  await scenario("a missing research enabled flag or scheduler schema cannot fall through to HEALTHY", () => {
    const config = evaluateAyasSelfImprovementHealth(variant((i) => { delete (i.research as { enabled?: unknown }).enabled; }));
    assert.equal(config.verdict, "DEGRADED");
    assert.deepEqual(codes(config.findings), ["RESEARCH_CONFIG_UNREADABLE"]);
    const schema = evaluateAyasSelfImprovementHealth(variant((i) => { i.research = { ...i.research, state: { kind: "ok", value: { consecutiveFailures: 0 } as never } }; }));
    assert.equal(schema.verdict, "DEGRADED");
    assert.deepEqual(codes(schema.findings), ["RESEARCH_STATE_UNREADABLE"]);
  });

  await scenario("missing or unreadable research state is a WARN — cadence cannot be verified", () => {
    for (const kind of ["absent", "unreadable"] as const) {
      const result = evaluateAyasSelfImprovementHealth(variant((i) => { i.research = { ...i.research, state: { kind } }; }));
      assert.equal(result.verdict, "DEGRADED", kind);
    }
  });

  await scenario("an interrupted run (currentRunId, no live lock owner) and an in-progress run (live owner) are both INFO", () => {
    const stateWithRun = { kind: "ok" as const, value: { schemaVersion: "1" as const, consecutiveFailures: 0, nextLightAt: iso(3 * 60 * MIN), nextDeepAt: iso(20 * 60 * MIN), currentRunId: "run-1" } };
    const interrupted = evaluateAyasSelfImprovementHealth(variant((i) => { i.research = { ...i.research, state: stateWithRun }; }));
    assert.deepEqual(codes(interrupted.findings), ["RESEARCH_RUN_INTERRUPTED"]);
    assert.equal(interrupted.verdict, "HEALTHY");
    const inProgress = evaluateAyasSelfImprovementHealth(variant((i) => { i.research = { ...i.research, state: stateWithRun, lock: { kind: "ok", value: { ownerStatus: "alive", ageMs: 30_000 } } }; }));
    assert.deepEqual(codes(inProgress.findings), ["RESEARCH_RUN_IN_PROGRESS"]);
  });

  await scenario("a live research lock is fine while short and a WARN once held longer than a research cycle could take", () => {
    const at = (ageMs: number) => evaluateAyasSelfImprovementHealth(variant((i) => { i.research = { ...i.research, lock: { kind: "ok", value: { ownerStatus: "alive", ageMs } } }; }));
    assert.equal(at(AYAS_HEALTH_RESEARCH_LOCK_LONG_HOLD_MS - 1).verdict, "HEALTHY");
    assert.equal(at(AYAS_HEALTH_RESEARCH_LOCK_LONG_HOLD_MS).verdict, "DEGRADED");
    assert.equal(at(AYAS_HEALTH_RESEARCH_LOCK_LONG_HOLD_MS).findings[0]?.code, "RESEARCH_LOCK_HELD_LONG");
  });

  await scenario("a dead research-lock owner is a WARN that reports when it becomes reclaimable", () => {
    const young = evaluateAyasSelfImprovementHealth(variant((i) => { i.research = { ...i.research, lock: { kind: "ok", value: { ownerStatus: "dead", ageMs: 3 * MIN } } }; }));
    assert.equal(young.verdict, "DEGRADED");
    assert.equal(young.findings[0]?.evidence.reclaimableInMs, AYAS_HEALTH_LOCK_STALE_AFTER_MS - 3 * MIN);
    const old = evaluateAyasSelfImprovementHealth(variant((i) => { i.research = { ...i.research, lock: { kind: "ok", value: { ownerStatus: "dead", ageMs: 30 * MIN } } }; }));
    assert.equal(old.findings[0]?.evidence.reclaimableInMs, 0);
  });

  await scenario("a lock with no valid owner record is INFO while young and CRITICAL (unrecoverable) once past the stale window — the case the lock itself can never reclaim", () => {
    for (const ownerStatus of ["missing", "invalid"] as const) {
      const young = evaluateAyasSelfImprovementHealth(variant((i) => { i.research = { ...i.research, lock: { kind: "ok", value: { ownerStatus, ageMs: 1 * MIN } } }; }));
      assert.deepEqual(codes(young.findings), ["RESEARCH_LOCK_OWNER_UNREADABLE_YOUNG"], ownerStatus);
      assert.equal(young.verdict, "DEGRADED", ownerStatus);
      const stuck = evaluateAyasSelfImprovementHealth(variant((i) => { i.research = { ...i.research, lock: { kind: "ok", value: { ownerStatus, ageMs: AYAS_HEALTH_LOCK_STALE_AFTER_MS + 1 } } }; }));
      assert.equal(stuck.verdict, "STALLED", ownerStatus);
      assert.equal(stuck.findings[0]?.code, "RESEARCH_LOCK_UNRECOVERABLE", ownerStatus);
    }
  });

  await scenario("an unverifiable research-lock owner is DEGRADED — the lock stays held, fail-closed", () => {
    const result = evaluateAyasSelfImprovementHealth(variant((i) => { i.research = { ...i.research, lock: { kind: "ok", value: { ownerStatus: "unknown", ageMs: 20 * MIN } } }; }));
    assert.deepEqual(codes(result.findings), ["RESEARCH_LOCK_OWNER_UNVERIFIABLE"]);
    assert.equal(result.verdict, "DEGRADED");
  });

  await scenario("unreadable or structurally invalid research-lock facts cannot fall through to HEALTHY", () => {
    const unreadable = evaluateAyasSelfImprovementHealth(variant((i) => { i.research = { ...i.research, lock: { kind: "unreadable" } }; }));
    assert.equal(unreadable.verdict, "DEGRADED");
    assert.deepEqual(codes(unreadable.findings), ["RESEARCH_LOCK_UNREADABLE"]);
    const malformed = evaluateAyasSelfImprovementHealth(variant((i) => { i.research = { ...i.research, lock: { kind: "ok", value: { ownerStatus: "surprise", ageMs: Number.NaN } as never } }; }));
    assert.equal(malformed.verdict, "DEGRADED");
    assert.deepEqual(codes(malformed.findings), ["RESEARCH_LOCK_UNREADABLE"]);
  });

  await scenario("a dirty working tree is DEGRADED; a Graphify graph analyzed at a different commit than HEAD is flagged even though the daemon's own gate would pass", () => {
    assert.equal(evaluateAyasSelfImprovementHealth(variant((i) => { i.repo = { ...i.repo, clean: { kind: "ok", value: false } }; })).verdict, "DEGRADED");
    const stale = evaluateAyasSelfImprovementHealth(variant((i) => { i.repo = { head: { kind: "ok", value: SHA }, clean: { kind: "ok", value: true }, graph: { kind: "ok", value: "b".repeat(40) } }; }));
    assert.equal(stale.verdict, "DEGRADED");
    assert.equal(stale.findings[0]?.code, "GRAPH_STALE_VS_HEAD");
    assert.deepEqual(stale.findings[0]?.evidence, { head: SHA.slice(0, 12), analyzedHead: "b".repeat(12) });
    const absent = evaluateAyasSelfImprovementHealth(variant((i) => { i.repo = { head: { kind: "ok", value: SHA }, clean: { kind: "ok", value: true }, graph: { kind: "absent" } }; }));
    assert.equal(absent.findings[0]?.code, "GRAPH_METADATA_ABSENT");
  });

  await scenario("a commit id read from disk is echoed only if it really is one — a hostile value never reaches a finding", () => {
    const result = evaluateAyasSelfImprovementHealth(variant((i) => { i.repo = { head: { kind: "ok", value: SHA }, clean: { kind: "ok", value: true }, graph: { kind: "ok", value: "sk-live-SECRET-not-a-sha" } }; }));
    assert.equal(result.findings[0]?.code, "GRAPH_METADATA_UNREADABLE");
    assert.ok(!JSON.stringify(result).includes("SECRET"));
  });

  await scenario("an omitted required Graphify fact is unreadable and never HEALTHY", () => {
    const input = variant((i) => { delete (i.repo as { graph?: unknown }).graph; });
    const result = evaluateAyasSelfImprovementHealth(input);
    assert.equal(result.verdict, "DEGRADED");
    assert.deepEqual(codes(result.findings), ["GRAPH_METADATA_UNREADABLE"]);
  });

  await scenario("malformed Git fact primitives are unreadable and never HEALTHY", () => {
    const result = evaluateAyasSelfImprovementHealth(variant((i) => {
      i.repo = { head: { kind: "ok", value: 7 as never }, clean: { kind: "ok", value: "yes" as never }, graph: { kind: "ok", value: SHA } };
    }));
    assert.equal(result.verdict, "DEGRADED");
    assert.deepEqual(codes(result.findings), ["REPO_HEAD_UNREADABLE", "REPO_STATUS_UNREADABLE"]);
  });

  await scenario("an invalid clock makes the whole verdict UNKNOWN (no age can be computed) instead of throwing", () => {
    const result = evaluateAyasSelfImprovementHealth(variant((i) => { (i as { now: string }).now = "yesterday-ish"; }));
    assert.equal(result.verdict, "UNKNOWN");
    assert.deepEqual(codes(result.findings), ["INPUT_CLOCK_INVALID"]);
  });

  await scenario("evaluation is deterministic, never mutates its (frozen) input, and orders findings CRITICAL → WARN → INFO", () => {
    const input = deepFreeze(variant((i) => {
      i.observer = { intervalMs: 5 * MIN, state: { kind: "ok", value: { schemaVersion: "1", phase: "PAUSED_DIRTY_REPO", updatedAt: iso(-3 * 60 * MIN), heartbeatCount: 1 } }, lock: { kind: "ok", value: { ownerStatus: "alive" } } };
      i.research = { ...i.research, state: { kind: "ok", value: { schemaVersion: "1", consecutiveFailures: 0, nextLightAt: iso(3 * 60 * MIN), nextDeepAt: iso(20 * 60 * MIN), currentRunId: "r" } } };
      i.repo = { head: { kind: "ok", value: SHA }, clean: { kind: "ok", value: false }, graph: { kind: "ok", value: SHA } };
    }));
    const first = evaluateAyasSelfImprovementHealth(input);
    const second = evaluateAyasSelfImprovementHealth(input);
    assert.deepEqual(first, second);
    const rank = { CRITICAL: 0, WARN: 1, INFO: 2 } as const;
    const ranks = first.findings.map((f) => rank[f.severity]);
    assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), "findings must be ordered by severity");
    assert.ok(first.findings.length >= 3);
  });

  // ---------------------------------------------------------------- pins (drift + authority boundary)
  await scenario("thresholds are pinned to their documented values", () => {
    assert.equal(AYAS_HEALTH_HEARTBEAT_STALE_FACTOR, 3);
    assert.equal(AYAS_HEALTH_RESEARCH_OVERDUE_GRACE_MS, 30 * MIN);
    assert.equal(AYAS_HEALTH_RESEARCH_FAILURE_WARN, 3);
    assert.equal(AYAS_HEALTH_RESEARCH_FAILURE_CRITICAL, 6);
    assert.equal(AYAS_HEALTH_RESEARCH_LOCK_LONG_HOLD_MS, 60 * MIN);
    assert.equal(AYAS_HEALTH_LOCK_STALE_AFTER_MS, 10 * MIN);
  });

  await scenario("mirrored constants cannot drift from their sources: lock stale window, scheduler cadence, daemon interval, observer phase vocabulary", () => {
    const lockSrc = fs.readFileSync(path.join(SRC, "AyasExecutionAuthorityLock.ts"), "utf8");
    assert.match(lockSrc, /const DEFAULT_STALE_AFTER_MS = 10 \* 60_000;/, "the lock's stale window changed — update AYAS_HEALTH_LOCK_STALE_AFTER_MS");
    assert.equal(AYAS_HEALTH_DEFAULT_LIGHT_INTERVAL_MS, AYAS_RESEARCH_LIGHT_INTERVAL_MS);
    assert.equal(AYAS_HEALTH_DEFAULT_DEEP_INTERVAL_MS, AYAS_RESEARCH_DEEP_INTERVAL_MS);
    const daemonScript = fs.readFileSync(path.join(__dirname, "ayas-autonomy-daemon.ts"), "utf8");
    assert.match(daemonScript, /: 5 \* 60_000;/, "the observer's default interval changed");
    assert.equal(AYAS_HEALTH_DEFAULT_OBSERVER_INTERVAL_MS, 5 * 60_000);
    const daemonSrc = fs.readFileSync(path.join(SRC, "AyasAutonomyDaemon.ts"), "utf8");
    const union = /export type AyasAutonomyDaemonPhase = ([^;]+);/.exec(daemonSrc)?.[1];
    assert.ok(union, "could not find the AyasAutonomyDaemonPhase union");
    const phases = [...union.matchAll(/"([A-Z_]+)"/g)].map((match) => match[1]);
    assert.deepEqual([...phases].sort(), [...AYAS_HEALTH_KNOWN_OBSERVER_PHASES].sort(), "the observer phase vocabulary changed — update AYAS_HEALTH_KNOWN_OBSERVER_PHASES");
  });

  await scenario("authority boundary: the evaluator imports nothing; the collector is read-only and reaches no approval / execution / mutation / write API", () => {
    // Comments legitimately NAME the modules this one mirrors (the lock, the observer lock), so the boundary is enforced on
    // real code: an ALLOW-list of import specifiers (stronger than a deny-list — a new import fails even if nobody thought
    // to forbid it) plus a token scan over comment-stripped source.
    const stripComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/.*$/gm, "$1");
    const specifiers = (source: string): string[] => [...stripComments(source).matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*)["']([^"']+)["']/g)].map((match) => match[1] as string);
    const evaluator = fs.readFileSync(path.join(SRC, "AyasSelfImprovementHealth.ts"), "utf8");
    const collector = fs.readFileSync(path.join(SRC, "AyasSelfImprovementHealthCollector.ts"), "utf8");
    assert.deepEqual(specifiers(evaluator), [], "the pure evaluator must have no imports at all");
    assert.deepEqual(specifiers(collector).sort(), ["./AyasProcessLiveness", "./AyasSelfImprovementHealth", "node:child_process", "node:fs", "node:path"], "the collector may import only these five modules");
    assert.ok(!/^\s*import\s/m.test(stripComments(evaluator)), "the pure evaluator must have no import statement");

    const writeApis = ["writeFile", "appendFile", "mkdirSync", "mkdir(", "rmSync", "rm(", "renameSync", "rename(", "unlinkSync", "utimesSync", "copyFile", "createWriteStream", "process.kill", "spawn(", "fork("];
    const authorityNames = ["ApprovalService", "ExecutionGate", "GuardedPublication", "MutationScope", "MutationRegistry", "BoundedFileWrite", "PatchArtifact", "AuthorityLock", "SingletonLock", "InboxStore", "simple-git"];
    for (const [file, source] of [["evaluator", evaluator], ["collector", collector]] as const) {
      const code = stripComments(source);
      for (const token of [...writeApis, ...authorityNames]) assert.ok(!code.includes(token), `the ${file} code must never reference ${token}`);
    }
    const gitSubcommands = [...stripComments(collector).matchAll(/readGit\(repoRoot, \[([^\]]+)\], gitReader\)/g)].map((match) => match[1]?.split(",")[0]?.trim());
    assert.deepEqual([...gitSubcommands].sort(), ['"rev-parse"', '"status"'], "the collector may only run the read-only git subcommands rev-parse and status");
  });

  // ---------------------------------------------------------------- collector against real fixtures
  const myStart = await readProcessStartEpochMs(process.pid);

  await scenario("an empty root collects without throwing and reads as DOWN, with no repo findings from a non-repo directory", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-health-empty-"));
    const result = await readAyasSelfImprovementHealth({ repoRoot: root });
    assert.equal(result.verdict, "DOWN");
    const found = codes(result.findings);
    assert.ok(found.includes("OBSERVER_STATE_ABSENT") && found.includes("OBSERVER_LOCK_ABSENT"));
    assert.ok(!found.includes("REPO_DIRTY"), "a non-repo directory has no cleanliness to report");
  });

  await scenario("a genuinely healthy fixture — live owner, fresh heartbeat, clean repo, graph at HEAD — reads HEALTHY", async () => {
    const fixture = makeRepo();
    writeHealthyState(fixture, myStart);
    const result = await readAyasSelfImprovementHealth({ repoRoot: fixture.root });
    assert.deepEqual(result.findings, []);
    assert.equal(result.verdict, "HEALTHY");
  });

  await scenario("an absent research-lock directory is the normal idle state and does not create a false alarm", async () => {
    const fixture = makeRepo();
    writeHealthyState(fixture, myStart);
    const input = await collectAyasSelfImprovementHealthInput({ repoRoot: fixture.root });
    assert.deepEqual(input.research.lock, { kind: "absent" });
    assert.equal(evaluateAyasSelfImprovementHealth(input).verdict, "HEALTHY");
  });

  for (const errorCode of ["EACCES", "EPERM", "EIO"] as const) {
    await scenario(`a research-lock stat ${errorCode} failure is unreadable and never HEALTHY`, async () => {
      const fixture = makeRepo();
      writeHealthyState(fixture, myStart);
      const result = await readAyasSelfImprovementHealth({
        repoRoot: fixture.root,
        statPath(target) {
          if (path.resolve(target) === path.resolve(researchLockDir(fixture.root))) throw errno(errorCode);
          return fs.statSync(target);
        },
      });
      assert.equal(result.verdict, "DEGRADED");
      assert.deepEqual(codes(result.findings), ["RESEARCH_LOCK_UNREADABLE"]);
    });
  }

  await scenario("a research-lock mtime in the future is unreadable and never normalized to age zero", async () => {
    const fixture = makeRepo();
    writeHealthyState(fixture, myStart);
    const dir = researchLockDir(fixture.root);
    fs.mkdirSync(dir, { recursive: true });
    writeJson(dir, "owner.json", { schemaVersion: "1", gateRoot: "x", ownerNonce: "n", pid: process.pid, processStartEpochMs: myStart, acquiredAt: new Date().toISOString() });
    const future = new Date(Date.now() + MIN);
    fs.utimesSync(dir, future, future);
    const result = await readAyasSelfImprovementHealth({ repoRoot: fixture.root });
    assert.equal(result.verdict, "DEGRADED");
    assert.deepEqual(codes(result.findings), ["RESEARCH_LOCK_UNREADABLE"]);
  });

  await scenario("injected Git HEAD and status success preserve a clean fixture as HEALTHY", async () => {
    const fixture = makeRepo();
    writeHealthyState(fixture, myStart);
    const result = await readAyasSelfImprovementHealth({ repoRoot: fixture.root, readGit: injectedGitReader(`${fixture.head}\n`, "") });
    assert.equal(result.verdict, "HEALTHY");
    assert.deepEqual(result.findings, []);
  });

  await scenario("injected Git status success distinguishes a genuinely dirty worktree", async () => {
    const fixture = makeRepo();
    writeHealthyState(fixture, myStart);
    const result = await readAyasSelfImprovementHealth({ repoRoot: fixture.root, readGit: injectedGitReader(fixture.head, "?? dirty.txt\n") });
    assert.equal(result.verdict, "DEGRADED");
    assert.deepEqual(codes(result.findings), ["REPO_DIRTY"]);
  });

  await scenario("a failed Git HEAD read with a successful clean status is explicit and never HEALTHY", async () => {
    const fixture = makeRepo();
    writeHealthyState(fixture, myStart);
    const result = await readAyasSelfImprovementHealth({ repoRoot: fixture.root, readGit: injectedGitReader(new Error("head unavailable"), "") });
    assert.equal(result.verdict, "DEGRADED");
    assert.deepEqual(codes(result.findings), ["REPO_HEAD_UNREADABLE"]);
  });

  await scenario("a successful Git HEAD read with a failed status read is explicit and never HEALTHY", async () => {
    const fixture = makeRepo();
    writeHealthyState(fixture, myStart);
    const result = await readAyasSelfImprovementHealth({ repoRoot: fixture.root, readGit: injectedGitReader(fixture.head, new Error("status unavailable")) });
    assert.equal(result.verdict, "DEGRADED");
    assert.deepEqual(codes(result.findings), ["REPO_STATUS_UNREADABLE"]);
  });

  await scenario("failed Git HEAD and status reads produce both closed findings and never HEALTHY", async () => {
    const fixture = makeRepo();
    writeHealthyState(fixture, myStart);
    const result = await readAyasSelfImprovementHealth({ repoRoot: fixture.root, readGit: injectedGitReader(new Error("head unavailable"), new Error("status unavailable")) });
    assert.equal(result.verdict, "DEGRADED");
    assert.deepEqual(codes(result.findings), ["REPO_HEAD_UNREADABLE", "REPO_STATUS_UNREADABLE"]);
  });

  await scenario("a dead observer PID and a REUSED observer PID (alive, wrong start time) both read as DOWN; a legacy bare-integer lock naming a live PID is alive", async () => {
    const fixture = makeRepo();
    writeHealthyState(fixture, myStart);
    writeJson(fixture.root, "data/brain/autonomy/daemon.lock", { pid: await deadPid(), processStartEpochMs: myStart });
    assert.equal((await readAyasSelfImprovementHealth({ repoRoot: fixture.root })).verdict, "DOWN");
    writeJson(fixture.root, "data/brain/autonomy/daemon.lock", { pid: process.pid, processStartEpochMs: myStart - 86_400_000 });
    const reused = await readAyasSelfImprovementHealth({ repoRoot: fixture.root });
    assert.equal(reused.verdict, "DOWN");
    assert.ok(codes(reused.findings).includes("OBSERVER_OWNER_DEAD"));
    fs.writeFileSync(path.join(fixture.root, "data/brain/autonomy/daemon.lock"), `${process.pid}\n`);
    assert.equal((await readAyasSelfImprovementHealth({ repoRoot: fixture.root })).verdict, "HEALTHY");
  });

  await scenario("a malformed observer process-start identity is unreadable rather than downgraded to legacy PID-only ownership", async () => {
    const fixture = makeRepo();
    writeHealthyState(fixture, myStart);
    writeJson(fixture.root, "data/brain/autonomy/daemon.lock", { pid: process.pid, processStartEpochMs: "not-a-number" });
    const result = await readAyasSelfImprovementHealth({ repoRoot: fixture.root });
    assert.equal(result.verdict, "DEGRADED");
    assert.deepEqual(codes(result.findings), ["OBSERVER_LOCK_UNREADABLE"]);
  });

  await scenario("corrupt or shapeless state files read as UNKNOWN / unreadable, never as a default", async () => {
    const fixture = makeRepo();
    writeHealthyState(fixture, myStart);
    fs.writeFileSync(path.join(fixture.root, "data/brain/autonomy/daemon-state.json"), "{ not json");
    assert.equal((await readAyasSelfImprovementHealth({ repoRoot: fixture.root })).verdict, "UNKNOWN");
    writeJson(fixture.root, "data/brain/autonomy/daemon-state.json", { phase: "OBSERVING" });
    assert.equal((await readAyasSelfImprovementHealth({ repoRoot: fixture.root })).verdict, "UNKNOWN");
    writeHealthyState(fixture, myStart);
    let result: Awaited<ReturnType<typeof readAyasSelfImprovementHealth>>;
    for (const invalidText of ["[]", "{ not json"]) {
      fs.writeFileSync(path.join(fixture.root, "data/brain/self-improvement/research/scheduler-state.json"), invalidText);
      result = await readAyasSelfImprovementHealth({ repoRoot: fixture.root });
      assert.equal(result.verdict, "DEGRADED", invalidText);
      assert.ok(codes(result.findings).includes("RESEARCH_STATE_UNREADABLE"), invalidText);
    }
    for (const malformed of [
      {},
      { schemaVersion: "1", consecutiveFailures: 0, nextLightAt: "not-a-date", nextDeepAt: "also-bad" },
      { schemaVersion: "1", consecutiveFailures: 0, nextLightAt: new Date().toISOString(), nextDeepAt: "bad-deep-date" },
      { schemaVersion: "1", consecutiveFailures: "0" },
    ]) {
      writeJson(fixture.root, "data/brain/self-improvement/research/scheduler-state.json", malformed);
      result = await readAyasSelfImprovementHealth({ repoRoot: fixture.root });
      assert.equal(result.verdict, "DEGRADED", JSON.stringify(malformed));
      assert.ok(codes(result.findings).includes("RESEARCH_STATE_UNREADABLE"), JSON.stringify(malformed));
    }
  });

  await scenario("the collector classifies real research-lock fixtures: ownerless and invalid locks 1 hour old are UNRECOVERABLE, a dead-owner lock is a WARN, a live-owner lock is silent", async () => {
    const fixture = makeRepo();
    writeHealthyState(fixture, myStart);
    const dir = researchLockDir(fixture.root);

    fs.mkdirSync(dir, { recursive: true });
    backdate(dir, 60 * MIN);
    let result = await readAyasSelfImprovementHealth({ repoRoot: fixture.root });
    assert.equal(result.verdict, "STALLED");
    assert.ok(codes(result.findings).includes("RESEARCH_LOCK_UNRECOVERABLE"), "ownerless lock directory");

    for (const invalid of ["", "{\"not\":\"an owner\"}", "garbage"]) {
      fs.writeFileSync(path.join(dir, "owner.json"), invalid);
      backdate(dir, 60 * MIN);
      result = await readAyasSelfImprovementHealth({ repoRoot: fixture.root });
      assert.ok(codes(result.findings).includes("RESEARCH_LOCK_UNRECOVERABLE"), `owner.json ${JSON.stringify(invalid)}`);
    }

    writeJson(dir, "owner.json", { schemaVersion: "1", gateRoot: "x", ownerNonce: "n", pid: process.pid, processStartEpochMs: myStart, acquiredAt: "not-a-date" });
    backdate(dir, 1 * MIN);
    result = await readAyasSelfImprovementHealth({ repoRoot: fixture.root });
    assert.equal(result.verdict, "DEGRADED");
    assert.ok(codes(result.findings).includes("RESEARCH_LOCK_OWNER_UNREADABLE_YOUNG"));

    const owner = (pid: number, start: number) => ({ schemaVersion: "1", gateRoot: "x", ownerNonce: "n", pid, processStartEpochMs: start, acquiredAt: new Date().toISOString() });
    writeJson(dir, "owner.json", owner(await deadPid(), myStart));
    backdate(dir, 2 * MIN);
    result = await readAyasSelfImprovementHealth({ repoRoot: fixture.root });
    assert.ok(codes(result.findings).includes("RESEARCH_LOCK_OWNER_DEAD"));
    assert.equal(result.verdict, "DEGRADED");

    writeJson(dir, "owner.json", owner(process.pid, myStart));
    backdate(dir, 1 * MIN);
    result = await readAyasSelfImprovementHealth({ repoRoot: fixture.root });
    assert.deepEqual(result.findings, []);
  });

  await scenario("a present research lock whose owner record cannot be read remains distinct from absent and invalid", async () => {
    const fixture = makeRepo();
    writeHealthyState(fixture, myStart);
    const dir = researchLockDir(fixture.root);
    const ownerFile = path.join(dir, "owner.json");
    writeJson(dir, "owner.json", { schemaVersion: "1", gateRoot: "x", ownerNonce: "n", pid: process.pid, processStartEpochMs: myStart, acquiredAt: new Date().toISOString() });
    const input = await collectAyasSelfImprovementHealthInput({
      repoRoot: fixture.root,
      readTextFile(file) {
        if (path.resolve(file) === path.resolve(ownerFile)) throw errno("EACCES");
        return fs.readFileSync(file, "utf8");
      },
    });
    assert.equal(input.research.lock.kind, "ok");
    assert.equal(input.research.lock.kind === "ok" ? input.research.lock.value.ownerStatus : "wrong-kind", "unreadable");
    assert.ok(input.research.lock.kind === "ok" && Number.isFinite(input.research.lock.value.ageMs));
    const result = evaluateAyasSelfImprovementHealth(input);
    assert.equal(result.verdict, "DEGRADED");
    assert.deepEqual(codes(result.findings), ["RESEARCH_LOCK_OWNER_UNREADABLE_YOUNG"]);
  });

  await scenario("the untrusted lastError text of daemon-state.json never reaches the report", async () => {
    const fixture = makeRepo();
    writeHealthyState(fixture, myStart);
    writeJson(fixture.root, "data/brain/autonomy/daemon-state.json", { schemaVersion: "1", phase: "ERROR", updatedAt: new Date().toISOString(), heartbeatCount: 3, lastError: "boom sk-live-SECRET C:\\Users\\Metod\\.env.local" });
    const result = await readAyasSelfImprovementHealth({ repoRoot: fixture.root });
    assert.ok(codes(result.findings).includes("OBSERVER_IN_ERROR"));
    const text = JSON.stringify(result);
    assert.ok(!text.includes("SECRET") && !text.includes(".env.local") && !text.includes("boom"), "raw lastError must not be echoed");
  });

  await scenario("AYAS_RESEARCH_SCHEDULER_ENABLED=0 reads as research disabled; a dirty repo is reported", async () => {
    const fixture = makeRepo();
    writeHealthyState(fixture, myStart);
    const disabled = await readAyasSelfImprovementHealth({ repoRoot: fixture.root, env: { AYAS_RESEARCH_SCHEDULER_ENABLED: "0" } });
    assert.deepEqual(codes(disabled.findings), ["RESEARCH_DISABLED_BY_ENV"]);
    fs.writeFileSync(path.join(fixture.root, "untracked.txt"), "x");
    const dirty = await readAyasSelfImprovementHealth({ repoRoot: fixture.root });
    assert.equal(dirty.verdict, "DEGRADED");
    assert.ok(codes(dirty.findings).includes("REPO_DIRTY"));
  });

  await scenario("a Graphify graph analyzed at an older commit is caught end to end", async () => {
    const fixture = makeRepo();
    writeHealthyState(fixture, myStart);
    writeJson(fixture.root, ".graphify/branch.json", { lastAnalyzedHead: "c".repeat(40) });
    const result = await readAyasSelfImprovementHealth({ repoRoot: fixture.root });
    assert.deepEqual(codes(result.findings), ["GRAPH_STALE_VS_HEAD"]);
    fs.rmSync(path.join(fixture.root, ".graphify", "graph.json"));
    assert.deepEqual(codes((await readAyasSelfImprovementHealth({ repoRoot: fixture.root })).findings), ["GRAPH_METADATA_ABSENT"]);
    fs.rmSync(path.join(fixture.root, ".graphify"), { recursive: true, force: true });
    assert.deepEqual(codes((await readAyasSelfImprovementHealth({ repoRoot: fixture.root })).findings), ["GRAPH_METADATA_ABSENT"]);
  });

  await scenario("a Graphify metadata read failure is unreadable and never HEALTHY", async () => {
    const fixture = makeRepo();
    writeHealthyState(fixture, myStart);
    const graphFile = path.join(fixture.root, ".graphify", "branch.json");
    const result = await readAyasSelfImprovementHealth({
      repoRoot: fixture.root,
      readTextFile(file) {
        if (path.resolve(file) === path.resolve(graphFile)) throw errno("EACCES");
        return fs.readFileSync(file, "utf8");
      },
    });
    assert.equal(result.verdict, "DEGRADED");
    assert.deepEqual(codes(result.findings), ["GRAPH_METADATA_UNREADABLE"]);
  });

  await scenario("collecting is strictly read-only: every file's bytes and mtime, and the directory listing, are identical afterwards", async () => {
    const fixture = makeRepo();
    writeHealthyState(fixture, myStart);
    const dir = researchLockDir(fixture.root);
    fs.mkdirSync(dir, { recursive: true });
    writeJson(dir, "owner.json", { schemaVersion: "1", gateRoot: "x", ownerNonce: "n", pid: await deadPid(), processStartEpochMs: myStart, acquiredAt: new Date().toISOString() });
    const before = snapshotTree(fixture.root);
    await collectAyasSelfImprovementHealthInput({ repoRoot: fixture.root });
    await readAyasSelfImprovementHealth({ repoRoot: fixture.root });
    assert.equal(snapshotTree(fixture.root), before);
  });

  await scenario("the CLI reports through its exit code: HEALTHY 0, DEGRADED 1, DOWN 2, UNKNOWN 3 — and it prints valid JSON", () => {
    const fixture = makeRepo();
    writeHealthyState(fixture, myStart);
    const ok = runCli(fixture.root);
    assert.equal(ok.code, 0);
    const parsed = JSON.parse(ok.stdout) as { status: string; verdict: string; findings: unknown[] };
    assert.equal(parsed.status, "AYAS_SELF_IMPROVEMENT_HEALTH");
    assert.equal(parsed.verdict, "HEALTHY");
    fs.rmSync(path.join(fixture.root, "data/brain/autonomy/daemon.lock"));
    const down = runCli(fixture.root);
    assert.equal(down.code, 2);
    assert.equal((JSON.parse(down.stdout) as { verdict: string }).verdict, "DOWN");

    writeHealthyState(fixture, myStart);
    fs.writeFileSync(path.join(fixture.root, "untracked.txt"), "x");
    const degraded = runCli(fixture.root);
    assert.equal(degraded.code, 1);
    assert.equal((JSON.parse(degraded.stdout) as { verdict: string }).verdict, "DEGRADED");

    fs.writeFileSync(path.join(fixture.root, "data/brain/autonomy/daemon-state.json"), "{ broken");
    const unknown = runCli(fixture.root);
    assert.equal(unknown.code, 3);
    assert.equal((JSON.parse(unknown.stdout) as { verdict: string }).verdict, "UNKNOWN");
    assert.equal(runCli(fixture.root, "--interval-ms", "5").code, 3);
  });

  console.log(`AYAS self-improvement health smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-self-improvement-health", scenarios: count }));
}
main().catch((error) => { console.error("AYAS self-improvement health smoke FAILED:", error); process.exitCode = 1; });
