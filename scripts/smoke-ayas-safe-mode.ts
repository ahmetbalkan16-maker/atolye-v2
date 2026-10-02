/**
 * Stage 15R — the durable SAFE_READ_ONLY mode, its binding in the action firewall and in the
 * existing mutation entry points: approval and execution, production stage admission, publish, the mutating
 * production routes, cost reservation, the discovery child, the self-heal CLI and the owner page.
 * TEMP repository roots and child processes of this suite only; synthetic owner sessions with a
 * fixture key. The live mode, gate, constitution and authorization store are never read or written.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { issueSession } from "../src/lib/auth/accessGate";
import { createAyasActionFirewall } from "../src/lib/ayas/execution/AyasActionFirewall";
import { AYAS_DISCOVERY_RUN_ACTION, type AyasOwnerCapabilityLeaseAudit, type AyasOwnerCapabilityProof } from "../src/lib/ayas/execution/AyasCapabilityScope";
import { AyasExecutionAuthorizationStore } from "../src/lib/ayas/execution/AyasExecutionAuthorization";
import { AYAS_EXECUTION_ALLOWLIST, AYAS_EXECUTION_RESERVED_ACTIONS } from "../src/lib/ayas/execution/AyasExecutionPolicy";
import {
  AyasSafeModeBlockedError, assertAyasSafeModeAllowsMutation, ayasSafeModeDigest, ayasSafeModeEventFile, ayasSafeModeRefusal, isAyasSafeModeEvent,
  readAyasSafeMode, resolveAyasSafeModeRoot, type AyasSafeModeEvent, type AyasSafeModeHealthCheck,
} from "../src/lib/ayas/safety/AyasSafeModeReader";
import { AyasSafeModeExitRefusedError, collectAyasSafeModeExitHealth, enterAyasSafeMode, exitAyasSafeMode } from "../src/lib/ayas/safety/AyasSafeModeStore";
import { classifyPatchTarget } from "../src/lib/brain/selfheal/BrainPatchSafety";

const repo = process.cwd();
const SCENARIOS = 14;
const NOW = Date.parse("2026-10-02T12:00:00.000Z");
const KEY = "fixture-owner-access-key-0001", env = { AYAS_ACCESS_KEY: KEY, NODE_ENV: "test" };
const healthy = async (): Promise<readonly AyasSafeModeHealthCheck[]> => [{ id: "fixture", ok: true, code: "FIXTURE_OK" }];
const selectedCase = process.env.AYAS_SAFE_MODE_MUTATION_CASE;
if (selectedCase !== undefined) {
  // Private to the mutation audit: a gitless TEMP copy only. The declared baseline always runs every scenario.
  const cwd = fs.realpathSync(repo);
  assert.equal(path.dirname(cwd).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase()); assert.ok(path.basename(cwd).startsWith("ayas-safe-mode-audit-")); assert.ok(!fs.existsSync(path.join(cwd, ".git")));
  assert.match(selectedCase, /^(?:[1-9]|1[0-4])$/);
}
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-safe-mode-"));
let scenarios = 0, scenarioIndex = 0, serial = 0;
async function scenario(name: string, run: () => Promise<void> | void) {
  scenarioIndex++; if (selectedCase !== undefined && Number(selectedCase) !== scenarioIndex) return;
  await run(); scenarios++; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${scenarioIndex}: ${name}`);
}
const freshRepo = () => { const dir = path.join(temp, `repo-${++serial}`); fs.mkdirSync(dir, { recursive: true }); return dir; };
const events = (root: string) => { const dir = resolveAyasSafeModeRoot(root); return !fs.existsSync(dir) ? [] : fs.statSync(dir).isDirectory() ? fs.readdirSync(dir).sort() : [`not a directory: ${fs.readFileSync(dir, "utf8")}`]; };
const source = (file: string) => fs.readFileSync(path.join(repo, file), "utf8");
const code = (file: string) => source(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const session = (key = KEY, at = NOW) => issueSession(key, at);
const enter = (root: string, ownerSession?: string) => enterAyasSafeMode({ repoRoot: root, env, nowMs: () => NOW, ...(ownerSession ? { ownerSession } : {}) });
const exit = async (root: string, patch: Partial<Parameters<typeof exitAyasSafeMode>[0]> = {}) => exitAyasSafeMode({ repoRoot: root, ownerSession: await session(), env, nowMs: () => NOW, health: healthy, ...patch });
const rejects = async (run: Promise<unknown>, message: string) => assert.rejects(run, (error: unknown) => error instanceof Error && error.message === message, message);
/** Writes one raw event file, chained to whatever is already there, without going through the store. */
function forge(root: string, patch: Partial<AyasSafeModeEvent> & Record<string, unknown>, name?: string): void {
  const dir = resolveAyasSafeModeRoot(root); fs.mkdirSync(dir, { recursive: true });
  const existing = fs.readdirSync(dir).filter((file) => /^\d{6}\.json$/.test(file)).sort(), sequence = existing.length + 1;
  const previousDigest = existing.length ? ayasSafeModeDigest(fs.readFileSync(path.join(dir, existing[existing.length - 1]!), "utf8")) : null;
  fs.writeFileSync(path.join(dir, name ?? ayasSafeModeEventFile(sequence)), `${JSON.stringify({ schemaVersion: "1", sequence, event: "ENTER", at: new Date(NOW).toISOString(), actor: "LOCAL_OPERATOR", previousDigest, healthChecks: null, ...patch }, null, 2)}\n`);
}
const tsx = (script: string, args: readonly string[], cwd: string) => spawnSync(process.execPath, [path.join(repo, "node_modules", "tsx", "dist", "cli.mjs"), path.join(repo, "scripts", script), ...args], { cwd, encoding: "utf8", windowsHide: true, timeout: 60_000 });

const read = { schemaVersion: "1", action: "inspect-source-file", requestedBy: "ayas-chat", intent: "bounded inspection", plan: { filePath: "src/example.ts" } };
const bounded = { ...read, action: "run-developer-validation", plan: { validationId: "typescript" } };
function firewallFixture(root: string) {
  const authorizations = new AyasExecutionAuthorizationStore({ rootDir: path.join(temp, `audit-${++serial}`) });
  const request = { action: "self-development.apply-approved-proposal" as const, proposalId: `ayas-proposal-${crypto.randomUUID()}`, proposalHash: "a".repeat(64), baseHead: "b".repeat(40),
    exactFiles: ["scripts/smoke-allowed.ts"], mutationKind: "fixture:v1", authorizationId: `ayas-dev-auth-${crypto.randomUUID()}`, reservationId: `ayas-reservation-${crypto.randomUUID()}` };
  const proof: AyasOwnerCapabilityProof = { ownerId: "shared-passcode-owner", decisionId: `ayas-decision-${crypto.randomUUID()}`, reservedAt: new Date().toISOString(), request };
  let lease: AyasOwnerCapabilityLeaseAudit | undefined;
  const firewall = createAyasActionFirewall({ repoRoot: root, authorizations, ownerReservation: { readProof: () => proof, readLease: () => lease, recordLease: (audit) => { lease = audit; } } });
  const discovery = (capabilities: readonly string[]) => ({ action: AYAS_DISCOVERY_RUN_ACTION, ledgerRunId: `ayas-local-discovery-${crypto.randomUUID()}`, baseHead: "c".repeat(40), capabilities: [...capabilities].sort(), publicReadSourceDigest: null });
  return { firewall, authorizations, request, discovery, ownerLease: () => lease };
}

async function main() {
  await scenario("the mode's modules, page, log, CLI and graders are never-autonomous; the log lives in the ignored execution tree", () => {
    for (const file of ["src/lib/ayas/safety/AyasSafeModeReader.ts", "src/lib/ayas/safety/AyasSafeModeStore.ts", "app/brain/safe-mode/actions.ts", "app/brain/safe-mode/page.tsx",
      "data/brain/execution/safe-mode/000001.json", "scripts/ayas-safe-mode.ts", "scripts/smoke-ayas-safe-mode.ts", "scripts/smoke-ayas-safe-mode-mutations.ts"])
      for (const spelling of [file, file.toUpperCase(), `./${file.replace(/\//g, "\\")}`]) assert.equal(classifyPatchTarget(spelling).level, "FORBIDDEN_AUTONOMOUS", spelling);
    assert.equal(resolveAyasSafeModeRoot(), path.join(path.resolve(repo), "data", "brain", "execution", "safe-mode"));
    assert.ok(source(".gitignore").split(/\r?\n/).includes("/data/brain/execution/"));
  });

  await scenario("the mode is one durable event: absent reads NORMAL, an entry holds, repeats write nothing and a fresh process still sees it", async () => {
    const root = freshRepo();
    assert.deepEqual(readAyasSafeMode(root), { state: "NORMAL", sequence: 0, lastDigest: null, exitedAt: null });
    assert.equal(ayasSafeModeRefusal(readAyasSafeMode(root)), undefined); assertAyasSafeModeAllowsMutation(root);
    assert.ok(!fs.existsSync(path.join(root, "data")), "a read creates nothing");
    const entered = await enter(root);
    assert.equal(entered.state, "SAFE_READ_ONLY"); assert.deepEqual(events(root), ["000001.json"]);
    const stored = JSON.parse(fs.readFileSync(path.join(resolveAyasSafeModeRoot(root), "000001.json"), "utf8"));
    assert.deepEqual(stored, { schemaVersion: "1", sequence: 1, event: "ENTER", at: new Date(NOW).toISOString(), actor: "LOCAL_OPERATOR", previousDigest: null, healthChecks: null });
    assert.ok(isAyasSafeModeEvent(stored));
    assert.deepEqual([ayasSafeModeRefusal(entered), entered.state === "SAFE_READ_ONLY" && entered.sequence, entered.state === "SAFE_READ_ONLY" && entered.actor], ["AYAS_SAFE_READ_ONLY", 1, "LOCAL_OPERATOR"]);
    assert.throws(() => assertAyasSafeModeAllowsMutation(root), (error: unknown) => error instanceof AyasSafeModeBlockedError && error.code === "AYAS_SAFE_READ_ONLY" && error.stack === undefined);
    // Idempotent, with or without the owner: the mode already holds.
    assert.deepEqual(await enter(root), entered); assert.deepEqual(await enter(root, await session()), entered); assert.deepEqual(events(root), ["000001.json"]);
    // Nothing in this process holds the mode: a new process reads the same state from the files.
    const child = tsx("ayas-safe-mode.ts", ["status"], root); assert.equal(child.status, 0, child.stderr);
    const seen = JSON.parse(child.stdout) as { state: { state: string; sequence: number }; holds: string | null; changed: boolean };
    assert.deepEqual([seen.state.state, seen.state.sequence, seen.holds, seen.changed], ["SAFE_READ_ONLY", 1, "AYAS_SAFE_READ_ONLY", false]);
    // The actor is derived from the verified session, never taken from the caller.
    const owned = freshRepo(), byOwner = await enter(owned, await session());
    assert.equal(byOwner.state === "SAFE_READ_ONLY" && byOwner.actor, "OWNER_SESSION");
    for (const [badSession, badEnv] of [[await session("another-owner-key-00002"), env], ["not-a-session", env], [await session(), {}], [await session(), { AYAS_ACCESS_KEY: "short", NODE_ENV: "production" }]] as const) {
      const other = freshRepo(), state = await enterAyasSafeMode({ repoRoot: other, ownerSession: badSession, env: badEnv, nowMs: () => NOW });
      assert.equal(state.state === "SAFE_READ_ONLY" && state.actor, "LOCAL_OPERATOR");
    }
  });

  await scenario("only the owner session leaves the mode, with every health check passing now", async () => {
    const root = freshRepo(); await enter(root);
    let healthCalls = 0; const counted = async () => { healthCalls++; return healthy(); };
    // No session, a forged one, another key, an expired one, an unconfigured or misconfigured gate: refused before anything is read.
    const expired = await session(KEY, NOW - 13 * 60 * 60 * 1000), valid = await session(), forged = valid.slice(0, -1) + (valid.endsWith("A") ? "B" : "A");
    for (const [ownerSession, sessionEnv] of [[undefined, env], ["", env], ["a.b", env], [forged, env], [await session("another-owner-key-00002"), env], [expired, env],
      [await session(), {}], [await session(), { NODE_ENV: "test" }], [await session(), { AYAS_ACCESS_KEY: "short", NODE_ENV: "production" }]] as const)
      await rejects(exitAyasSafeMode({ repoRoot: root, ownerSession, env: sessionEnv, nowMs: () => NOW, health: counted }), "AYAS_SAFE_MODE_OWNER_SESSION_REQUIRED");
    assert.equal(healthCalls, 0); assert.deepEqual(events(root), ["000001.json"]);
    // A failing or empty health report keeps the mode and writes nothing.
    for (const report of [[{ id: "gate", ok: false, code: "GATE_OPEN" }], [{ id: "a", ok: true, code: "OK" }, { id: "b", ok: false, code: "BAD" }], []] as AyasSafeModeHealthCheck[][])
      await assert.rejects(exit(root, { health: async () => report }), (error: unknown) => error instanceof AyasSafeModeExitRefusedError && error.code === "AYAS_SAFE_MODE_HEALTH_CHECK_FAILED" && error.healthChecks.length === report.length);
    // The session is checked again after the checks have run.
    let clock = NOW; await rejects(exit(root, { nowMs: () => clock, health: async () => { clock = NOW + 13 * 60 * 60 * 1000; return healthy(); } }), "AYAS_SAFE_MODE_OWNER_SESSION_REQUIRED");
    assert.deepEqual(events(root), ["000001.json"]); assert.equal(readAyasSafeMode(root).state, "SAFE_READ_ONLY");
    const left = await exit(root);
    assert.deepEqual([left.state, left.state === "NORMAL" && left.sequence, left.state === "NORMAL" && left.exitedAt], ["NORMAL", 2, new Date(NOW).toISOString()]); assert.deepEqual(events(root), ["000001.json", "000002.json"]);
    const dir = resolveAyasSafeModeRoot(root), first = fs.readFileSync(path.join(dir, "000001.json"), "utf8");
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, "000002.json"), "utf8")), { schemaVersion: "1", sequence: 2, event: "EXIT", at: new Date(NOW).toISOString(), actor: "OWNER_SESSION", previousDigest: ayasSafeModeDigest(first), healthChecks: [{ id: "fixture", ok: true, code: "FIXTURE_OK" }] });
    assert.equal(ayasSafeModeRefusal(left), undefined); assertAyasSafeModeAllowsMutation(root);
    await rejects(exit(root), "AYAS_SAFE_MODE_NOT_ACTIVE"); assert.equal(events(root).length, 2);
    // The log goes on: a later entry is chained to the exit.
    const again = await enter(root); assert.deepEqual([again.state, again.state === "SAFE_READ_ONLY" && again.sequence], ["SAFE_READ_ONLY", 3]);
    // Two exits at once: one wins, the other is refused, and the log stays valid.
    await rejects(exit(root, { health: async () => { await exit(root); return healthy(); } }), "AYAS_SAFE_MODE_CONCURRENT_CHANGE");
    assert.deepEqual([readAyasSafeMode(root).state, events(root).length], ["NORMAL", 4]);
  });

  await scenario("the exit health checks are facts of this moment: constitution, both execution gates, machine health, the occupancy inventory", async () => {
    const root = freshRepo(), report = await collectAyasSafeModeExitHealth(root);
    assert.deepEqual(report.map((check) => check.id), ["owner-constitution", "execution-gate", "self-improvement-gate", "machine-health", "resource-occupancy"]);
    assert.deepEqual(report.filter((check) => check.id !== "machine-health"), [{ id: "owner-constitution", ok: true, code: "CONSTITUTION_MISSING" }, { id: "execution-gate", ok: true, code: "GATE_CLOSED" },
      { id: "self-improvement-gate", ok: true, code: "GATE_CLOSED" }, { id: "resource-occupancy", ok: true, code: "INVENTORY_READ" }]);
    const machine = report.find((check) => check.id === "machine-health")!; assert.match(machine.code, /^MACHINE_HEALTH_/);
    assert.equal(machine.ok, ["MACHINE_HEALTH_NOMINAL", "MACHINE_HEALTH_ELEVATED_PRESSURE", "MACHINE_HEALTH_TELEMETRY_PARTIAL"].includes(machine.code));
    // Each source failing turns its own line red.
    const broken = freshRepo();
    fs.mkdirSync(path.join(broken, "data", "brain", "owner-constitution"), { recursive: true });
    fs.mkdirSync(path.join(broken, "data", "brain", "execution"), { recursive: true }); fs.writeFileSync(path.join(broken, "data", "brain", "execution", "gate.json"), "{");
    fs.mkdirSync(path.join(broken, "data", "brain", "self-improvement", "execution"), { recursive: true }); fs.writeFileSync(path.join(broken, "data", "brain", "self-improvement", "execution", "gate.json"), JSON.stringify({ state: "OPEN" }));
    fs.mkdirSync(path.join(broken, "data", "brain", "execution", "resource-capacity"), { recursive: true }); fs.writeFileSync(path.join(broken, "data", "brain", "execution", "resource-capacity", "occupancy"), "not a directory");
    const red = await collectAyasSafeModeExitHealth(broken);
    assert.deepEqual(red.filter((check) => check.id !== "machine-health"), [{ id: "owner-constitution", ok: false, code: "CONSTITUTION_UNAVAILABLE" }, { id: "execution-gate", ok: false, code: "GATE_UNREADABLE" },
      { id: "self-improvement-gate", ok: false, code: "GATE_UNREADABLE" }, { id: "resource-occupancy", ok: false, code: "INVENTORY_UNREADABLE" }]);
    // With the default checks an unhealthy repository cannot leave the mode.
    await enter(broken);
    await assert.rejects(exitAyasSafeMode({ repoRoot: broken, ownerSession: await session(), env, nowMs: () => NOW }), (error: unknown) => error instanceof AyasSafeModeExitRefusedError && error.healthChecks.some((check) => check.id === "execution-gate" && !check.ok));
    assert.equal(readAyasSafeMode(broken).state, "SAFE_READ_ONLY");
  });

  await scenario("a log that does not verify holds like an active mode; a malformed exit clears nothing", async () => {
    const cases: readonly (readonly [string, (root: string) => void, string])[] = [
      ["malformed event", (root) => { forge(root, {}); fs.writeFileSync(path.join(resolveAyasSafeModeRoot(root), "000001.json"), "{"); }, "SAFE_MODE_EVENT_MALFORMED"],
      ["unknown field", (root) => forge(root, { cleared: true }), "SAFE_MODE_EVENT_INVALID"],
      ["sequence does not match its file", (root) => forge(root, { sequence: 2, previousDigest: "a".repeat(64) }), "SAFE_MODE_EVENT_INVALID"],
      ["first event is missing", (root) => forge(root, { sequence: 2, previousDigest: "a".repeat(64) }, "000002.json"), "SAFE_MODE_CHAIN_GAP_OR_UNEXPECTED_ENTRY"],
      ["unexpected file", (root) => { forge(root, {}); fs.writeFileSync(path.join(resolveAyasSafeModeRoot(root), "cleared.txt"), "NORMAL"); }, "SAFE_MODE_CHAIN_GAP_OR_UNEXPECTED_ENTRY"],
      ["broken chain", (root) => { forge(root, {}); forge(root, { event: "EXIT", actor: "OWNER_SESSION", healthChecks: [{ id: "x", ok: true, code: "OK" }], previousDigest: "0".repeat(64) }); }, "SAFE_MODE_CHAIN_BROKEN"],
      ["two entries in a row", (root) => { forge(root, {}); forge(root, {}); }, "SAFE_MODE_CHAIN_ORDER_INVALID"],
      ["log starts with an exit", (root) => forge(root, { event: "EXIT", actor: "OWNER_SESSION", healthChecks: [{ id: "x", ok: true, code: "OK" }] }), "SAFE_MODE_CHAIN_ORDER_INVALID"],
      ["exit by a local operator", (root) => { forge(root, {}); forge(root, { event: "EXIT", actor: "LOCAL_OPERATOR", healthChecks: [{ id: "x", ok: true, code: "OK" }] }); }, "SAFE_MODE_EVENT_INVALID"],
      ["exit without health checks", (root) => { forge(root, {}); forge(root, { event: "EXIT", actor: "OWNER_SESSION", healthChecks: null }); }, "SAFE_MODE_EVENT_INVALID"],
      ["exit with an empty health report", (root) => { forge(root, {}); forge(root, { event: "EXIT", actor: "OWNER_SESSION", healthChecks: [] }); }, "SAFE_MODE_EVENT_INVALID"],
      ["exit with a failed health check", (root) => { forge(root, {}); forge(root, { event: "EXIT", actor: "OWNER_SESSION", healthChecks: [{ id: "x", ok: false, code: "BAD" }] }); }, "SAFE_MODE_EVENT_INVALID"],
      ["store is a file", (root) => { fs.mkdirSync(path.dirname(resolveAyasSafeModeRoot(root)), { recursive: true }); fs.writeFileSync(resolveAyasSafeModeRoot(root), "NORMAL"); }, "SAFE_MODE_STORE_NOT_A_DIRECTORY"],
    ];
    for (const [name, tamper, reason] of cases) {
      const root = freshRepo(); tamper(root); const before = events(root);
      assert.deepEqual(readAyasSafeMode(root), { state: "UNAVAILABLE", reason }, name);
      assert.equal(ayasSafeModeRefusal(readAyasSafeMode(root)), "AYAS_SAFE_MODE_UNAVAILABLE", name);
      assert.throws(() => assertAyasSafeModeAllowsMutation(root), (error: unknown) => error instanceof AyasSafeModeBlockedError && error.code === "AYAS_SAFE_MODE_UNAVAILABLE", name);
      // It already holds: entering writes nothing, and a log that does not verify is never appended to by an exit.
      assert.equal((await enter(root)).state, "UNAVAILABLE", name);
      await rejects(exit(root), "AYAS_SAFE_MODE_STORE_UNAVAILABLE");
      assert.deepEqual(events(root), before, name);
    }
    // A writer's unpublished temp file is not an event.
    const root = freshRepo(); await enter(root); fs.writeFileSync(path.join(resolveAyasSafeModeRoot(root), ".pending-fixture"), "{");
    assert.equal(readAyasSafeMode(root).state, "SAFE_READ_ONLY");
  });

  await scenario("the firewall keeps reads and refuses everything else while the mode holds, including leases issued before it", async () => {
    const root = freshRepo(), f = firewallFixture(root);
    // NORMAL: issue what will be admitted after the mode is entered.
    const readLease = f.firewall.issue(read), boundedLease = f.firewall.issue(bounded), ownerLease = f.firewall.bindOwnerReservation(f.request);
    const runRequest = f.discovery(["discovery.novel-patch-sandbox", "discovery.proposal-inbox"]), runLease = f.firewall.issueDiscoveryRun(runRequest);
    assert.ok(readLease.allowed && boundedLease.allowed && ownerLease.allowed && runLease.allowed);
    const run = f.firewall.admitDiscoveryRun(runLease.lease, runRequest); assert.ok(run.allowed); assert.equal(run.permits("discovery.proposal-inbox"), true);
    const recordsBefore = f.authorizations.list().length;
    await enter(root);
    const refused = (result: { readonly allowed: boolean; readonly reason?: string; readonly decision?: string }, reason = "AYAS_SAFE_READ_ONLY") => assert.deepEqual([result.allowed, result.reason, result.decision], [false, reason, "DENY"]);
    // Leases from before the mode: the read is admitted, nothing else is.
    const admittedRead = f.firewall.admit(readLease.lease, read); assert.ok(admittedRead.allowed); assert.equal(admittedRead.decision, "ALLOW_READ");
    refused(f.firewall.admit(boundedLease.lease, bounded)); refused(f.firewall.admitOwnerReservation(ownerLease.lease, f.request));
    assert.equal(f.ownerLease()?.state, "granted", "the owner lease was not consumed");
    assert.equal(run.permits("discovery.proposal-inbox"), false); assert.equal(run.permits("discovery.novel-patch-sandbox"), false);
    // New requests: a read is issued and admitted; bounded local work, a source write and a discovery run are not issued.
    const laterRead = f.firewall.issue(read); assert.ok(laterRead.allowed); assert.ok(f.firewall.admit(laterRead.lease, read).allowed);
    refused(f.firewall.issue(bounded));
    const second = firewallFixture(root); refused(second.firewall.bindOwnerReservation(second.request)); assert.equal(second.ownerLease(), undefined);
    refused(second.firewall.issueDiscoveryRun(second.discovery(["discovery.proposal-inbox"]))); assert.equal(second.authorizations.list().length, 0);
    assert.equal(f.authorizations.list().length, recordsBefore + 1, "only the later read left a record");
    // Classification is unchanged and names no way out: the mode is not an action.
    assert.deepEqual([f.firewall.classify(read), f.firewall.classify(bounded), f.firewall.classify(f.request)], ["ALLOW_READ", "ALLOW_BOUNDED_LOCAL", "REQUIRE_OWNER"]);
    for (const action of ["exit-safe-mode", "safe-mode.exit", "clear-safe-read-only", "enter-safe-mode"]) { assert.equal(f.firewall.classify({ ...read, action }), "DENY"); refused(f.firewall.issue({ ...read, action }), "AYAS_FIREWALL_SCOPE_NOT_ISSUABLE"); }
    for (const action of [...Object.keys(AYAS_EXECUTION_ALLOWLIST), ...AYAS_EXECUTION_RESERVED_ACTIONS]) assert.doesNotMatch(action, /safe/i);
    // An unreadable log refuses the same way under its own reason.
    const broken = freshRepo(), b = firewallFixture(broken); forge(broken, { cleared: true });
    assert.ok(b.firewall.issue(read).allowed); refused(b.firewall.issue(bounded), "AYAS_SAFE_MODE_UNAVAILABLE"); refused(b.firewall.bindOwnerReservation(b.request), "AYAS_SAFE_MODE_UNAVAILABLE");
    // After the owner leaves, the same firewall issues and admits again.
    await exit(root);
    const after = f.firewall.issue(bounded); assert.ok(after.allowed); assert.ok(f.firewall.admit(after.lease, bounded).allowed);
    const third = firewallFixture(root), bound = third.firewall.bindOwnerReservation(third.request); assert.ok(bound.allowed); assert.ok(third.firewall.admitOwnerReservation(bound.lease, third.request).allowed);
    const nextRun = third.discovery(["discovery.proposal-inbox"]), nextLease = third.firewall.issueDiscoveryRun(nextRun); assert.ok(nextLease.allowed);
    const admittedRun = third.firewall.admitDiscoveryRun(nextLease.lease, nextRun); assert.ok(admittedRun.allowed); assert.equal(admittedRun.permits("discovery.proposal-inbox"), true);
  });

  await scenario("a mode entered between a run's admission and its next capability withholds the rest of the run", async () => {
    const root = freshRepo(), f = firewallFixture(root), request = f.discovery(["discovery.micro-batch-accumulation", "discovery.proposal-inbox"]);
    const lease = f.firewall.issueDiscoveryRun(request); assert.ok(lease.allowed);
    await enter(root);
    assert.deepEqual([f.firewall.admitDiscoveryRun(lease.lease, request).allowed, f.authorizations.list().map((record) => record.state)], [false, ["granted"]]);
  });

  await scenario("the operator CLI reports and enters; it has no exit", async () => {
    const cwd = freshRepo();
    const run = (args: readonly string[]) => { const child = tsx("ayas-safe-mode.ts", args, cwd); assert.equal(child.status, 0, child.stderr + child.stdout); return JSON.parse(child.stdout) as { command: string; authority: string; state: { state: string; actor?: string }; holds: string | null; changed: boolean; exit: string }; };
    const status = run([]); assert.deepEqual([status.command, status.authority, status.state.state, status.holds, status.changed], ["status", "NONE", "NORMAL", null, false]);
    assert.ok(!fs.existsSync(path.join(cwd, "data")), "a status read creates nothing");
    const entered = run(["enter"]); assert.deepEqual([entered.state.state, entered.state.actor, entered.holds, entered.changed, entered.exit], ["SAFE_READ_ONLY", "LOCAL_OPERATOR", "AYAS_SAFE_READ_ONLY", true, "OWNER_SESSION_ONLY: /brain/safe-mode"]);
    assert.equal(run(["enter"]).changed, false); assert.equal(run(["status"]).state.state, "SAFE_READ_ONLY"); assert.deepEqual(events(cwd), ["000001.json"]);
    for (const args of [["exit"], ["clear"], ["leave"], ["enter", "--force"], ["status", "exit"]]) { const bad = tsx("ayas-safe-mode.ts", args, cwd); assert.equal(bad.status, 1); assert.match(bad.stderr, /ARGUMENT_INVALID/); assert.equal(bad.stdout, ""); }
    assert.deepEqual([readAyasSafeMode(cwd).state, events(cwd)], ["SAFE_READ_ONLY", ["000001.json"]]);
  });

  await scenario("the bindings: the reader carries no authority, the firewall asks at every decision, nothing but the owner action can leave", () => {
    const reader = code("src/lib/ayas/safety/AyasSafeModeReader.ts");
    assert.deepEqual([...reader.matchAll(/from "([^"]+)"/g)].map((match) => match[1]), ["node:crypto", "node:fs", "node:path"]);
    assert.doesNotMatch(reader, /writeFileSync|mkdirSync|linkSync|rmSync|unlinkSync|renameSync|appendFileSync/);
    const firewall = code("src/lib/ayas/execution/AyasActionFirewall.ts");
    assert.match(firewall, /const safeModeRefusal = \(\): string \| undefined => ayasSafeModeRefusal\(readAyasSafeMode\(repoRoot\)\);/);
    assert.equal(firewall.split("safeModeRefusal()").length - 1, 7, "issue, admit, owner bind, owner admit, discovery issue, discovery admit, permits");
    assert.doesNotMatch(firewall, /AyasSafeModeStore|exitAyasSafeMode|enterAyasSafeMode/);
    // The store has one importer in product code: the owner page's action module.
    const product = (dir: string): string[] => fs.readdirSync(path.join(repo, dir), { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? product(`${dir}/${entry.name}`) : /\.tsx?$/.test(entry.name) ? [`${dir}/${entry.name}`] : []);
    const importers = [...product("src"), ...product("app")].filter((file) => file !== "src/lib/ayas/safety/AyasSafeModeStore.ts" && /AyasSafeModeStore|exitAyasSafeMode/.test(source(file)));
    assert.deepEqual(importers.filter((file) => !file.startsWith("app/brain/safe-mode/")), []);
    for (const file of product("src/components")) assert.doesNotMatch(source(file), /AyasSafeMode(?:Store|Reader)|exitAyasSafeMode/, file);
    const cli = code("scripts/ayas-safe-mode.ts"); assert.doesNotMatch(cli, /exitAyasSafeMode|ownerSession/); assert.match(cli, /await enterAyasSafeMode\(\{ repoRoot \}\)/);
    const store = code("src/lib/ayas/safety/AyasSafeModeStore.ts");
    assert.ok(store.indexOf("await requireOwner();") > 0 && store.indexOf("await requireOwner();") < store.indexOf("const current = readAyasSafeMode(input.repoRoot);\n  if (current.state === \"NORMAL\") throw"));
    assert.equal(store.split("await requireOwner();").length - 1, 2);
  });

  /** Every mutating production route, and the mutating routes that stay open in the mode with the reason. */
  const GUARDED_ROUTES = ["animations", "assembly", "assets", "audio", "export", "pipeline", "projects/[slug]/pipeline/jobs/[jobId]", "projects/[slug]/pipeline/resume", "projects/[slug]/pipeline/retry",
    "research", "seo", "thumbnail", "thumbnails", "video", "visuals", "youtube"].map((route) => `app/api/${route}/route.ts`);
  const OPEN_ROUTES: Readonly<Record<string, string>> = {
    "app/api/auth/login/route.ts": "the owner signs in; leaving the mode needs a session",
    "app/api/auth/logout/route.ts": "ends a session",
    "app/api/ayas/chat/stream/route.ts": "chat stays allowed; its tools go through the firewall",
    "app/api/ayas/intake/route.ts": "owner messages queued for chat",
    "app/api/ayas/stt/route.ts": "speech to text for chat input",
  };
  const blocked = (error: unknown) => error instanceof AyasSafeModeBlockedError && error.code === "AYAS_SAFE_READ_ONLY" && error.message === "AYAS_SAFE_READ_ONLY";

  await scenario("approval and execution refuse before a decision is minted or an authorization reserved", async () => {
    const { approveAndExecuteAyasProposal, publishAlreadyOwnerApprovedAyasProposal } = await import("../src/lib/brain/autonomy/AyasProposalApprovalService");
    const { approveAndExecuteAyasMicroBatch } = await import("../src/lib/brain/autonomy/AyasMicroBatchApprovalService");
    const { createAyasAutonomyDaemon } = await import("../src/lib/brain/autonomy/AyasAutonomyDaemon");
    const touched: string[] = [];
    const trip = (name: string) => (): never => { touched.push(name); throw new assert.AssertionError({ message: `TOUCHED_${name}` }); };
    const inbox = { load: trip("inbox.load"), decide: trip("inbox.decide"), reserveApproval: trip("inbox.reserveApproval") };
    const proposalDeps = (repoRoot: string) => ({ repoRoot, gateRoot: path.join(repoRoot, "gate"), inbox, traceEnabled: false }) as never;
    const batchDeps = (repoRoot: string) => ({ repoRoot, gateRoot: path.join(repoRoot, "gate"), batchStore: { load: trip("batch.load") }, itemStore: {}, artifactStore: {}, graphifyEvidenceStore: {} }) as never;
    const execute = (repoRoot: string) => createAyasAutonomyDaemon({ inbox: { load: () => ({ proposals: [], decisions: [] }), reserveApproval: trip("daemon.reserveApproval") } as never, repoRoot, gateRoot: path.join(repoRoot, "gate") })
      .executeApproved({ mutationKind: "fixture:v1", proposalId: "ayas-proposal-fixture", proposalHash: "a".repeat(64), baseHead: "b".repeat(40), currentHead: "b".repeat(40), exactFiles: ["scripts/x.ts"], currentExactFiles: ["scripts/x.ts"], repoClean: true, applyWhileExecuting: trip("daemon.apply") } as never);
    const safe = freshRepo(); await enter(safe);
    await assert.rejects(approveAndExecuteAyasProposal("p", "h", proposalDeps(safe)), blocked);
    await assert.rejects(publishAlreadyOwnerApprovedAyasProposal("p", "h", proposalDeps(safe)), blocked);
    await assert.rejects(approveAndExecuteAyasMicroBatch("b", "h", batchDeps(safe)), blocked);
    await assert.rejects(execute(safe), blocked);
    assert.deepEqual(touched, [], "nothing was read, decided or reserved"); assert.ok(!fs.existsSync(path.join(safe, "gate")), "no journal was started");
    // Outside the mode the same calls reach their stores, so the refusals above are the mode and not the fixture.
    const normal = freshRepo();
    await assert.rejects(approveAndExecuteAyasProposal("p", "h", proposalDeps(normal)), /TOUCHED_inbox\.load/);
    await assert.rejects(publishAlreadyOwnerApprovedAyasProposal("p", "h", proposalDeps(normal)), /TOUCHED_inbox\.load/);
    await assert.rejects(approveAndExecuteAyasMicroBatch("b", "h", batchDeps(normal)), /TOUCHED_batch\.load/);
    await assert.rejects(execute(normal), /TOUCHED_daemon\.reserveApproval/);
  });

  await scenario("every mutating entry point asks the mode first: routes, production stage admission, publish, cost, discovery, self-heal", () => {
    const routes = (dir: string): string[] => fs.readdirSync(path.join(repo, dir), { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? routes(`${dir}/${entry.name}`) : entry.name === "route.ts" ? [`${dir}/${entry.name}`] : []);
    const mutating = routes("app/api").filter((file) => /^export async function (?:POST|PUT|PATCH|DELETE)\(/m.test(source(file))).sort();
    assert.deepEqual(mutating, [...GUARDED_ROUTES, ...Object.keys(OPEN_ROUTES)].sort(), "a mutating route is neither guarded nor listed as open in the mode");
    const guard = /^export async function (?:POST|PUT|PATCH|DELETE)\([^)]*\)(?:: [^{]+)? \{\r?\n  \/\/ Stage 15R: nothing but a read starts while AYAS is in SAFE_READ_ONLY\.\r?\n  const safeMode = ayasSafeModeHold\(\);\r?\n  if \(safeMode\) return NextResponse\.json\(\{ success: false, error: safeMode \}, \{ status: 423 \}\);\r?\n/gm;
    for (const file of GUARDED_ROUTES) {
      const text = source(file), handlers = text.match(/^export async function (?:POST|PUT|PATCH|DELETE)\(/gm) ?? [];
      assert.equal((text.match(guard) ?? []).length, handlers.length, `${file}: the guard is the first statement of every mutating handler`); assert.ok(handlers.length >= 1);
      assert.match(text, /import \{ ayasSafeModeHold \} from "@\/lib\/ayas\/safety\/AyasSafeModeReader";/);
    }
    for (const file of Object.keys(OPEN_ROUTES)) assert.doesNotMatch(source(file), /ayasSafeModeHold/, file);
    // Production stage admission: before the occupancy and before durable preparation.
    const runtime = code("src/lib/production/ProductionPipelineExecutionCanonicalRuntime.ts");
    assert.match(runtime, /if \(!active\) throw new ProductionRuntimeOperationContextError\("RUNTIME_OPERATION_CONTEXT_MISSING"\);\s+assertAyasSafeModeAllowsMutation\(\);\s+return withAyasProductionStageOccupancy\(context\.stage,/);
    const publish = code("src/lib/youtube/publish/YouTubePublishPipeline.ts");
    assert.match(publish, /\}\): Promise<YouTubePublishRecord> \{\s+assertAyasSafeModeAllowsMutation\(\);\s+try \{/);
    const cost = code("src/lib/production/ProductionCostReservationStore.ts");
    assert.match(cost, /safeModeHold: \(\) => string \| undefined = ayasSafeModeHold\): CostLedgerAppendResult \{\s+if \(safeModeHold\(\)\) return \{ ok: false, reason: "SAFE_READ_ONLY" \};/);
    assert.equal(cost.split("safeModeHold()").length - 1, 1, "settling and releasing stay possible in the mode");
    const discovery = code("scripts/ayas-discovery-daemon.ts");
    assert.match(discovery, /async function main\(\): Promise<void> \{\s+const safeMode = ayasSafeModeHold\(root\);\s+if \(safeMode\) \{ console\.log\(JSON\.stringify\(\{ status: "SAFE_READ_ONLY_HOLD", code: safeMode \}\)\); return; \}/);
    const daemon = code("src/lib/brain/autonomy/AyasAutonomyDaemon.ts");
    assert.ok(daemon.indexOf("assertAyasSafeModeAllowsMutation(repoRoot);") > 0 && daemon.indexOf("assertAyasSafeModeAllowsMutation(repoRoot);") < daemon.indexOf("inbox.reserveApproval("));
    const selfheal = code("scripts/selfheal.ts");
    assert.equal(selfheal.split("const safeMode = ayasSafeModeHold(repoRoot); if (safeMode) return { ok: false, detail: safeMode };").length - 1, 2);
    assert.equal(selfheal.split("\"apply\", \"--index\"").length - 1, 2, "a third working-tree apply needs its own check");
  });

  await scenario("in the mode every guarded route answers 423 before reading its body; publish and a new cost reservation are refused", async () => {
    const safe = freshRepo(); await enter(safe);
    const ledger = path.join(temp, `cost-${++serial}`), reservation = { reservationId: "reservation-1", projectId: "project-1", capUsd: 1, at: new Date(NOW).toISOString() };
    const cwd = process.cwd(); process.chdir(safe);
    try {
      for (const file of GUARDED_ROUTES) {
        const route = await import(pathToFileURL(path.join(repo, file)).href) as { POST: (request: Request, context: unknown) => Promise<Response> };
        // The body is never read: a stream that fails on read proves the refusal comes first.
        const request = new Request("http://localhost/fixture", { method: "POST", body: new ReadableStream({ pull() { throw new Error("BODY_READ"); } }), duplex: "half" } as RequestInit);
        const response = await route.POST(request, { params: Promise.resolve({ slug: "fixture-project", jobId: "fixture-job" }) });
        assert.equal(response.status, 423, file); assert.deepEqual(await response.json(), { success: false, error: "AYAS_SAFE_READ_ONLY" }, file);
      }
      const { YouTubePublishPipeline } = await import("../src/lib/youtube/publish/YouTubePublishPipeline");
      await assert.rejects(YouTubePublishPipeline.publishStoredPackage({ projectSlug: "fixture-project" }), blocked);
      const { reserveProjectCost, settleProjectCost } = await import("../src/lib/production/ProductionCostReservationStore");
      assert.deepEqual(reserveProjectCost(ledger, reservation, 10), { ok: false, reason: "SAFE_READ_ONLY" }); assert.ok(!fs.existsSync(ledger));
      assert.deepEqual(reserveProjectCost(ledger, reservation, 10, () => "AYAS_SAFE_MODE_UNAVAILABLE"), { ok: false, reason: "SAFE_READ_ONLY" });
      // Outside the mode the reservation is made; back in the mode it can still be settled.
      assert.equal(reserveProjectCost(ledger, reservation, 10, () => undefined).ok, true);
      assert.equal(settleProjectCost(ledger, { reservationId: "reservation-1", actualUsd: 0.5, at: new Date(NOW).toISOString() }).ok, true);
      assert.deepEqual(fs.readdirSync(path.join(safe, "data", "brain")), ["execution"]); assert.deepEqual(fs.readdirSync(path.join(safe, "data", "brain", "execution")), ["safe-mode"]);
      assert.deepEqual(fs.readdirSync(path.join(safe, "data")), ["brain"], "no project was created");
    } finally { process.chdir(cwd); }
  });

  await scenario("the discovery child holds the whole run in the mode: no ledger entry, no lease, no sandbox", async () => {
    const safe = freshRepo(); await enter(safe);
    const child = tsx("ayas-discovery-daemon.ts", [], safe); assert.equal(child.status, 0, child.stderr + child.stdout);
    assert.deepEqual(JSON.parse(child.stdout.trim()), { status: "SAFE_READ_ONLY_HOLD", code: "AYAS_SAFE_READ_ONLY" });
    assert.deepEqual(fs.readdirSync(path.join(safe, "data", "brain")), ["execution"]); assert.deepEqual(fs.readdirSync(path.join(safe, "data", "brain", "execution")), ["safe-mode"]);
    const broken = freshRepo(); forge(broken, { cleared: true });
    const unavailable = tsx("ayas-discovery-daemon.ts", [], broken); assert.equal(unavailable.status, 0, unavailable.stderr);
    assert.deepEqual(JSON.parse(unavailable.stdout.trim()), { status: "SAFE_READ_ONLY_HOLD", code: "AYAS_SAFE_MODE_UNAVAILABLE" });
  });

  await scenario("the owner page: one action enters; the exit takes the session from the cookie and binds the mode the owner was shown", () => {
    const actions = code("app/brain/safe-mode/actions.ts"), page = code("app/brain/safe-mode/page.tsx");
    assert.match(actions, /^"use server";/);
    assert.deepEqual([...actions.matchAll(/^export async function (\w+)/gm)].map((match) => match[1]), ["enterSafeReadOnly", "exitSafeReadOnly"]);
    // The session comes from the trusted cookie in both actions and from nowhere else; the form carries no authority.
    assert.equal(actions.split("(await cookies()).get(AYAS_SESSION_COOKIE)?.value").length - 1, 2);
    assert.deepEqual([...actions.matchAll(/form\.get\(["']([^"']+)["']\)/g)].map((match) => match[1]), ["modeDigest"]);
    assert.match(actions, /if \(ownFields\(form\)\.length > 0\) throw new Error\("AYAS_SAFE_MODE_FORM_INVALID"\);/);
    assert.match(actions, /if \(ownFields\(form\)\.some\(\(key\) => key !== "modeDigest"\)\) throw new Error\("AYAS_SAFE_MODE_FORM_INVALID"\);/);
    assert.match(actions, /if \(current\.state !== "SAFE_READ_ONLY" \|\| form\.get\("modeDigest"\) !== current\.lastDigest\) throw new Error\("AYAS_SAFE_MODE_REVIEW_BINDING_REQUIRED"\);/);
    assert.match(actions, /await exitAyasSafeMode\(\{ repoRoot: process\.cwd\(\), ownerSession: session \}\);/);
    assert.doesNotMatch(actions, /health\s*:|nowMs|env\s*:/, "the action supplies no health report, clock or environment of its own");
    // Only this action module can leave the mode.
    const product = (dir: string): string[] => fs.readdirSync(path.join(repo, dir), { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? product(`${dir}/${entry.name}`) : /\.tsx?$/.test(entry.name) ? [`${dir}/${entry.name}`] : []);
    assert.deepEqual([...product("src"), ...product("app")].filter((file) => file !== "src/lib/ayas/safety/AyasSafeModeStore.ts" && /exitAyasSafeMode/.test(source(file))), ["app/brain/safe-mode/actions.ts"]);
    // The page is a server page: it reads the mode and, in the mode, the checks as they are now.
    assert.doesNotMatch(page, /"use client"|exitAyasSafeMode|enterAyasSafeMode/);
    assert.match(page, /const state = readAyasSafeMode\(process\.cwd\(\)\);/); assert.match(page, /state\.state === "SAFE_READ_ONLY" \? await collectAyasSafeModeExitHealth\(process\.cwd\(\)\) : \[\]/);
    assert.match(page, /state\.state === "NORMAL" && <form action=\{enterSafeReadOnly\}>/); assert.match(page, /<form action=\{exitSafeReadOnly\}>\s*<input type="hidden" name="modeDigest" value=\{state\.lastDigest\} \/>/);
    assert.match(page, /disabled=\{!ownerAuthenticationReady \|\| !healthy\}/);
  });

  assert.equal(scenarioIndex, SCENARIOS); assert.equal(scenarios, selectedCase === undefined ? SCENARIOS : 1);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-safe-mode", scenarios, selectedMutationCase: selectedCase ?? null, liveModeTouched: false, evidenceClass: "TEMP_MODE_LOG_SYNTHETIC_OWNER_SESSION_AND_SOURCE_BINDING" }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  assert.equal(path.dirname(fs.realpathSync(temp)).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase()); assert.ok(path.basename(temp).startsWith("ayas-safe-mode-"));
  fs.rmSync(temp, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
});
