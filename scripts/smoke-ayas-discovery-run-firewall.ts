/**
 * Stage 15D — the observer discovery child's run lease. TEMP only: every
 * store, repository and spawned daemon run lives under one TEMP directory.
 * No model, no network (the research scheduler is disabled for the spawned
 * runs), no production action.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

import { createAyasActionFirewall } from "../src/lib/ayas/execution/AyasActionFirewall";
import { AYAS_DISCOVERY_RUN_ACTION, AYAS_DISCOVERY_RUN_CAPABILITIES, ayasLocalActionClassification, isAyasDiscoveryRunRequest, type AyasDiscoveryRunCapability, type AyasDiscoveryRunRequest } from "../src/lib/ayas/execution/AyasCapabilityScope";
import { withAyasExecutionAuditRoot } from "../src/lib/ayas/execution/AyasExecutionAuditContext";
import { AyasExecutionAuthorizationStore } from "../src/lib/ayas/execution/AyasExecutionAuthorization";
import { AYAS_EXECUTION_ALLOWLIST, validateAyasExecutionRequest } from "../src/lib/ayas/execution/AyasExecutionPolicy";
import { createAyasApprovalInboxStore } from "../src/lib/brain/autonomy/AyasApprovalInboxStore";
import { AyasDiscoveryRunNotAdmittedError, admitAyasDiscoveryRun, ayasDiscoveryPublicReadSourceDigest } from "../src/lib/brain/autonomy/AyasDiscoveryRunGuard";
import { createAyasLocalDiscoveryRunLedger } from "../src/lib/brain/autonomy/AyasLocalDiscoveryRunLedger";

const repo = process.cwd();
const root = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-discovery-run-"));
let count = 0;
let clock = Date.parse("2026-10-01T12:00:00.000Z");

const EVOLVE = "discovery.controlled-evolution-cycle", MICRO = "discovery.micro-batch-accumulation", NOVEL = "discovery.novel-patch-sandbox";
const INBOX = "discovery.proposal-inbox", IMPROVE = "discovery.research-improvement-cycle", RESEARCH = "discovery.research-scheduler-tick";
const HEAD = "a".repeat(40);
const DIGEST = "b".repeat(64);

function runRequest(over: Partial<Record<keyof AyasDiscoveryRunRequest, unknown>> = {}): AyasDiscoveryRunRequest {
  return { action: AYAS_DISCOVERY_RUN_ACTION, ledgerRunId: `ayas-local-discovery-${crypto.randomUUID()}`, baseHead: HEAD, capabilities: [MICRO, NOVEL, INBOX], publicReadSourceDigest: null, ...over } as AyasDiscoveryRunRequest;
}
function setup(ttlMs = 300_000) {
  const dir = fs.mkdtempSync(path.join(root, "run-"));
  const store = new AyasExecutionAuthorizationStore({ rootDir: dir, ttlMs, now: () => new Date(clock) });
  const firewall = createAyasActionFirewall({ repoRoot: dir, authorizations: store, now: () => new Date(clock) });
  return { dir, store, firewall };
}
function admitted(firewall: ReturnType<typeof createAyasActionFirewall>, request: AyasDiscoveryRunRequest) {
  const issued = firewall.issueDiscoveryRun(request); assert.ok(issued.allowed);
  const run = firewall.admitDiscoveryRun(issued.lease, request); assert.ok(run.allowed);
  return { lease: issued.lease, run };
}
function link(target: string, at: string) { fs.symlinkSync(target, at, process.platform === "win32" ? "junction" : "dir"); }
async function scenario(name: string, test: () => void | Promise<void>) {
  await test(); count++; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

function git(repoRoot: string, ...args: string[]) { return execFileSync("git", ["-C", repoRoot, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
/** The same fixture shape the existing discovery daemon integration tests use. */
function fixtureRepo(): { readonly repoRoot: string; readonly head: string } {
  const repoRoot = fs.mkdtempSync(path.join(root, "checkout-"));
  git(repoRoot, "init", "-q"); git(repoRoot, "config", "user.email", "smoke@example.invalid"); git(repoRoot, "config", "user.name", "Smoke");
  git(repoRoot, "config", "core.autocrlf", "false");
  fs.writeFileSync(path.join(repoRoot, "fixture.txt"), "fixture\n");
  fs.writeFileSync(path.join(repoRoot, ".gitignore"), "/data/\n.graphify/\n");
  git(repoRoot, "add", "fixture.txt", ".gitignore"); git(repoRoot, "commit", "-qm", "base");
  const head = git(repoRoot, "rev-parse", "HEAD");
  // Untracked, as in the real repository: a graph bound to this HEAD, so the run really discovers.
  fs.mkdirSync(path.join(repoRoot, ".graphify"), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, ".graphify", "graph.json"), "{}\n");
  fs.writeFileSync(path.join(repoRoot, ".graphify", "branch.json"), `${JSON.stringify({ lastSeenHead: head, lastAnalyzedHead: head, stale: false })}\n`);
  return { repoRoot, head };
}
function spawnDaemon(cwd: string) {
  // The research scheduler is disabled: enabled against an empty fixture it would start a real network and model run.
  return spawnSync(process.execPath, [path.join(repo, "node_modules", "tsx", "dist", "cli.mjs"), path.join(repo, "scripts", "ayas-discovery-daemon.ts")],
    { cwd, encoding: "utf8", windowsHide: true, timeout: 120_000, env: { ...process.env, AYAS_RESEARCH_SCHEDULER_ENABLED: "0", AYAS_CONTROLLED_EVOLUTION_REGISTER_FILE: "" } });
}

async function main() {
  await scenario("a run receives identity, an exact capability set, resource, cost class and a TTL, durably, before admission", () => {
    const { dir, store, firewall } = setup(); const request = runRequest();
    const issued = firewall.issueDiscoveryRun(request); assert.ok(issued.allowed);
    const record = store.list()[0]!; const plan = record.plan as Record<string, unknown>; const resource = plan.resource as Record<string, unknown>;
    assert.deepEqual([record.state, record.action, record.requestedBy, record.capabilityScope], ["granted", AYAS_DISCOVERY_RUN_ACTION, "ayas-observer-discovery", undefined]);
    assert.deepEqual([plan.agentId, plan.ownerId, plan.delegationId, plan.costClass, plan.classification], ["ayas-observer-discovery", null, "builtin-observer-discovery-v1", "ZERO_LOCAL", "BOUNDED_LOCAL"]);
    assert.match(String(plan.runId), /^[a-f0-9-]{36}$/); assert.match(String(plan.taskId), /^[a-f0-9-]{36}$/);
    assert.deepEqual(plan.capabilities, [MICRO, NOVEL, INBOX]);
    assert.deepEqual([resource.repoRoot, resource.sandboxRoot, resource.platform], [fs.realpathSync(dir), fs.realpathSync(os.tmpdir()), "LOCAL"]);
    assert.deepEqual(resource.request, request);
    assert.ok(Date.parse(record.expiresAt) - Date.parse(record.createdAt) <= 300_000);
    const run = firewall.admitDiscoveryRun(issued.lease, request); assert.ok(run.allowed);
    assert.deepEqual([run.decision, store.read(run.authorizationId).state], ["ALLOW_BOUNDED_LOCAL", "consumed"]);
    for (const capability of [MICRO, NOVEL, INBOX]) assert.equal(run.permits(capability), true);
    // Not in this run's set, not a discovery capability at all, or not a string.
    for (const capability of [RESEARCH, IMPROVE, EVOLVE, "discovery.publish", "self-development.apply-approved-proposal", "resume-stage", "inspect-source-file", "", 7, null, undefined, [INBOX], { toString: () => INBOX }]) {
      assert.equal(run.permits(capability), false);
    }
  });

  await scenario("the capability names are a closed vocabulary and never chat tools", () => {
    const { store, firewall } = setup(); const request = runRequest();
    assert.equal(firewall.classify(request), "ALLOW_BOUNDED_LOCAL");
    assert.equal(firewall.classify({ ...request, capabilities: ["discovery.publish"] }), "DENY");
    for (const name of [AYAS_DISCOVERY_RUN_ACTION, ...AYAS_DISCOVERY_RUN_CAPABILITIES]) {
      assert.equal(Object.hasOwn(AYAS_EXECUTION_ALLOWLIST, name), false);
      assert.equal(ayasLocalActionClassification(name), undefined);
      assert.equal(validateAyasExecutionRequest({ schemaVersion: "1", action: name, requestedBy: "model", intent: "run discovery", plan: {} }).ok, false);
    }
    // The tool path refuses a well-formed run request, and one dressed as a tool request.
    for (const input of [request, { schemaVersion: "1", requestedBy: "model", intent: "x", plan: {}, ...request }]) {
      const refused = firewall.issue(input); assert.equal(refused.allowed, false);
    }
    assert.equal(store.list().length, 0);
    assert.deepEqual([...AYAS_DISCOVERY_RUN_CAPABILITIES], [...AYAS_DISCOVERY_RUN_CAPABILITIES].sort());
    assert.ok(Object.isFrozen(AYAS_DISCOVERY_RUN_CAPABILITIES));
  });

  await scenario("a malformed, unknown or self-widened request is refused before any record", () => {
    const { store, firewall } = setup();
    const bad: unknown[] = [
      null, "observer-discovery.run", [], runRequest({ action: "observer-discovery.run2" }), runRequest({ capabilities: [] }), runRequest({ capabilities: [INBOX, INBOX] }),
      runRequest({ capabilities: [INBOX, MICRO] }), runRequest({ capabilities: [INBOX, "discovery.publish"] }), runRequest({ capabilities: [INBOX, "resume-stage"] }),
      runRequest({ capabilities: INBOX }), runRequest({ capabilities: [...AYAS_DISCOVERY_RUN_CAPABILITIES, "discovery.zz"] }),
      runRequest({ ledgerRunId: "ayas-local-discovery-owner-approved" }), runRequest({ ledgerRunId: "" }), runRequest({ baseHead: "HEAD" }), runRequest({ baseHead: HEAD.slice(1) }),
      // The research tick and its source digest come together or not at all.
      runRequest({ capabilities: [INBOX, RESEARCH] }), runRequest({ capabilities: [INBOX, RESEARCH], publicReadSourceDigest: "short" }), runRequest({ publicReadSourceDigest: DIGEST }),
      { ...runRequest(), ownerApproved: true }, { ...runRequest(), ttlMs: 86_400_000 }, { ...runRequest(), repoRoot: "C:\\elsewhere" },
    ];
    for (const input of bad) {
      assert.equal(isAyasDiscoveryRunRequest(input), false);
      const refused = firewall.issueDiscoveryRun(input); assert.equal(refused.allowed, false);
    }
    assert.equal(store.list().length, 0);
    assert.equal(isAyasDiscoveryRunRequest(runRequest({ capabilities: [INBOX, RESEARCH], publicReadSourceDigest: DIGEST })), true);
    assert.equal(isAyasDiscoveryRunRequest(runRequest({ capabilities: [...AYAS_DISCOVERY_RUN_CAPABILITIES], publicReadSourceDigest: DIGEST })), true);
  });

  await scenario("the admitted request must be the issued one: no widening, no other HEAD, run or source list", () => {
    const { store, firewall } = setup(); const request = runRequest({ capabilities: [INBOX] });
    const issued = firewall.issueDiscoveryRun(request); assert.ok(issued.allowed);
    for (const changed of [{ ...request, capabilities: [NOVEL, INBOX] }, { ...request, capabilities: [INBOX, RESEARCH], publicReadSourceDigest: DIGEST }, { ...request, baseHead: "c".repeat(40) },
      { ...request, ledgerRunId: `ayas-local-discovery-${crypto.randomUUID()}` }]) {
      const refused = firewall.admitDiscoveryRun(issued.lease, changed);
      assert.deepEqual([refused.allowed, refused.allowed ? "" : refused.reason], [false, "AYAS_FIREWALL_SCOPE_CHANGED"]);
    }
    assert.equal(store.list()[0]!.state, "granted");
    const run = firewall.admitDiscoveryRun(issued.lease, { ...request }); assert.ok(run.allowed);
    assert.deepEqual([run.permits(INBOX), run.permits(NOVEL)], [true, false]);
    const replay = firewall.admitDiscoveryRun(issued.lease, request);
    assert.deepEqual([replay.allowed, replay.allowed ? "" : replay.reason], [false, "AYAS_FIREWALL_REPLAY"]);
    // A caller mutating its request after issue changes nothing that was recorded.
    const mutable = { ...runRequest(), capabilities: [INBOX] as AyasDiscoveryRunCapability[] };
    const second = firewall.issueDiscoveryRun(mutable); assert.ok(second.allowed);
    mutable.capabilities.push(RESEARCH);
    assert.deepEqual((store.list().find((record) => record.state === "granted")!.plan as { capabilities: unknown }).capabilities, [INBOX]);
    assert.equal(firewall.admitDiscoveryRun(second.lease, mutable).allowed, false);
  });

  await scenario("a lease is a live object: its copy, its serialization, another run's handle and a restart carry nothing", () => {
    const { dir, store, firewall } = setup(); const request = runRequest();
    const issued = firewall.issueDiscoveryRun(request); assert.ok(issued.allowed);
    const other = createAyasActionFirewall({ repoRoot: dir, authorizations: store, now: () => new Date(clock) });
    const foreign = other.issueDiscoveryRun(request); assert.ok(foreign.allowed);
    const record = store.list()[0]!;
    for (const forged of [JSON.parse(JSON.stringify(issued.lease)), { ...issued.lease }, Object.create(issued.lease), record, record.authorizationId, { authorizationId: record.authorizationId }, foreign.lease, null, undefined]) {
      const refused = firewall.admitDiscoveryRun(forged, request);
      assert.deepEqual([refused.allowed, refused.allowed ? "" : refused.reason], [false, "AYAS_FIREWALL_HANDLE_UNKNOWN"]);
    }
    // The tool-path admit and the owner-path admit do not know a run lease either.
    assert.equal(firewall.admit(issued.lease, request).allowed, false);
    assert.equal(firewall.admitOwnerReservation(issued.lease, request).allowed, false);
    // Restart: a new firewall over the same store cannot admit the persisted grant.
    const restarted = createAyasActionFirewall({ repoRoot: dir, authorizations: new AyasExecutionAuthorizationStore({ rootDir: dir, now: () => new Date(clock) }) });
    assert.equal(restarted.admitDiscoveryRun(issued.lease, request).allowed, false);
    assert.ok(store.list().every((item) => item.state === "granted"));
  });

  await scenario("expiry: an expired grant is not admitted, and an admitted run stops being permitted at its expiry", () => {
    const late = setup(1000); const request = runRequest();
    const issued = late.firewall.issueDiscoveryRun(request); assert.ok(issued.allowed);
    clock += 1000;
    const refused = late.firewall.admitDiscoveryRun(issued.lease, request);
    assert.deepEqual([refused.allowed, refused.allowed ? "" : refused.reason, late.store.list()[0]!.state], [false, "AYAS_EXEC_AUTH_EXPIRED", "expired"]);
    const live = setup(1000); const { run } = admitted(live.firewall, request);
    clock += 999; assert.equal(run.permits(INBOX), true);
    clock += 1; assert.equal(run.permits(INBOX), false);
    // A clock that went backwards past issuance is not a valid time either.
    clock -= 5000; assert.equal(run.permits(INBOX), false);
    clock += 5000;
    assert.throws(() => new AyasExecutionAuthorizationStore({ rootDir: root, ttlMs: 300_001 }));
  });

  await scenario("revocation: by the run's own firewall, or durably by any other process, and never undone", () => {
    const own = setup(); const first = admitted(own.firewall, runRequest());
    assert.equal(first.run.permits(NOVEL), true);
    assert.equal(own.firewall.revoke(first.lease).allowed, true);
    assert.deepEqual([first.run.permits(NOVEL), own.store.read(first.run.authorizationId).state], [false, "revoked"]);
    // Another process (a second store over the same directory) writes the revocation.
    const external = setup(); const second = admitted(external.firewall, runRequest());
    new AyasExecutionAuthorizationStore({ rootDir: external.dir }).revoke(second.run.authorizationId);
    assert.deepEqual([second.run.permits(INBOX), second.run.permits(MICRO)], [false, false]);
    // Revoked before admission.
    const early = setup(); const request = runRequest();
    const issued = early.firewall.issueDiscoveryRun(request); assert.ok(issued.allowed);
    assert.equal(early.firewall.revoke(issued.lease).allowed, true);
    const refused = early.firewall.admitDiscoveryRun(issued.lease, request);
    assert.deepEqual([refused.allowed, refused.allowed ? "" : refused.reason], [false, "AYAS_EXEC_AUTH_REVOKED"]);
  });

  await scenario("an audit record that cannot be written or read means no admission and no permission", () => {
    const grant = setup(); grant.store.grant = () => { throw new Error("fixture grant IO"); };
    assert.equal(grant.firewall.issueDiscoveryRun(runRequest()).allowed, false);
    const consume = setup(); const request = runRequest();
    const issued = consume.firewall.issueDiscoveryRun(request); assert.ok(issued.allowed);
    consume.store.consume = () => { throw new Error("fixture consume IO"); };
    assert.equal(consume.firewall.admitDiscoveryRun(issued.lease, request).allowed, false);
    const read = setup(); const { run } = admitted(read.firewall, runRequest());
    assert.equal(run.permits(INBOX), true);
    const original = read.store.read.bind(read.store);
    read.store.read = () => { throw new Error("fixture read IO"); };
    assert.equal(run.permits(INBOX), false);
    read.store.read = original;
    // A record edited on disk to look unconsumed, completed or corrupt does not permit.
    const file = path.join(read.dir, "execution", "authorizations", `${run.authorizationId}.json`);
    const stored = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    for (const tampered of [{ ...stored, state: "granted" }, { ...stored, state: "completed" }, { ...stored, unknownField: true }, "not json"]) {
      fs.writeFileSync(file, typeof tampered === "string" ? tampered : JSON.stringify(tampered));
      assert.equal(run.permits(INBOX), false);
    }
    fs.writeFileSync(file, JSON.stringify(stored)); assert.equal(run.permits(INBOX), true);
    assert.equal(createAyasActionFirewall({ repoRoot: read.dir }).issueDiscoveryRun(runRequest()).allowed, false);
  });

  await scenario("a redirected, missing or network repository is not the resource that was leased", () => {
    const base = fs.mkdtempSync(path.join(root, "roots-")); const a = path.join(base, "a"), b = path.join(base, "b"), binding = path.join(base, "binding");
    fs.mkdirSync(a); fs.mkdirSync(b); link(a, binding);
    const store = new AyasExecutionAuthorizationStore({ rootDir: path.join(base, "audit"), now: () => new Date(clock) });
    const firewall = createAyasActionFirewall({ repoRoot: binding, authorizations: store, now: () => new Date(clock) });
    const request = runRequest();
    const issued = firewall.issueDiscoveryRun(request); assert.ok(issued.allowed);
    assert.equal(((store.list()[0]!.plan as { resource: { repoRoot: string } }).resource).repoRoot, fs.realpathSync(a));
    fs.unlinkSync(binding); link(b, binding);
    const refused = firewall.admitDiscoveryRun(issued.lease, request);
    assert.deepEqual([refused.allowed, refused.allowed ? "" : refused.reason], [false, "AYAS_FIREWALL_RESOURCE_CHANGED"]);
    fs.unlinkSync(binding); link(a, binding);
    const run = firewall.admitDiscoveryRun(issued.lease, request); assert.ok(run.allowed); assert.equal(run.permits(INBOX), true);
    fs.unlinkSync(binding); link(b, binding); assert.equal(run.permits(INBOX), false);
    fs.unlinkSync(binding); assert.equal(run.permits(INBOX), false);
    for (const unknown of [path.join(base, "missing"), "\\\\untrusted-server\\share", "relative/root"]) {
      assert.throws(() => admitAyasDiscoveryRun({ repoRoot: unknown, authorizations: store, ledgerRunId: request.ledgerRunId, baseHead: HEAD, capabilities: [INBOX] }), AyasDiscoveryRunNotAdmittedError);
    }
  });

  await scenario("the daemon's guard: one sorted set, the source list pinned, refusal thrown, outcome recorded once", () => {
    const { dir, store } = setup(); const ledgerRunId = `ayas-local-discovery-${crypto.randomUUID()}`;
    const sources = [{ sourceId: "ollama", url: "https://github.com/ollama/ollama/releases.atom" }, { sourceId: "ffmpeg", url: "https://github.com/FFmpeg/FFmpeg/releases.atom" }];
    const guard = admitAyasDiscoveryRun({ repoRoot: dir, authorizations: store, now: () => new Date(clock), ledgerRunId, baseHead: HEAD, publicReadSources: sources,
      capabilities: [INBOX, RESEARCH, NOVEL, INBOX] });
    assert.deepEqual(guard.capabilities, [NOVEL, INBOX, RESEARCH]); assert.ok(Object.isFrozen(guard) && Object.isFrozen(guard.capabilities));
    const request = (store.read(guard.authorizationId).plan as { resource: { request: AyasDiscoveryRunRequest } }).resource.request;
    assert.deepEqual([request.ledgerRunId, request.baseHead, request.publicReadSourceDigest], [ledgerRunId, HEAD, ayasDiscoveryPublicReadSourceDigest([...sources].reverse())]);
    assert.notEqual(ayasDiscoveryPublicReadSourceDigest(sources), ayasDiscoveryPublicReadSourceDigest([sources[0]!, { sourceId: "ffmpeg", url: "https://example.invalid/releases.atom" }]));
    assert.deepEqual([guard.permits(RESEARCH), guard.permits(MICRO)], [true, false]);
    assert.equal(guard.settle({ ok: true, summary: { candidates: 0 } }), true);
    const settled = store.read(guard.authorizationId);
    assert.deepEqual([settled.state, /^[a-f0-9]{64}$/.test(settled.resultDigest ?? ""), guard.permits(RESEARCH)], ["completed", true, false]);
    assert.equal(guard.settle({ ok: true, summary: {} }), false);
    // A failed run records a closed code, never an error message.
    const failed = admitAyasDiscoveryRun({ repoRoot: dir, authorizations: store, now: () => new Date(clock), ledgerRunId, baseHead: HEAD, capabilities: [INBOX] });
    assert.equal(failed.settle({ ok: false }), true);
    assert.deepEqual([store.read(failed.authorizationId).state, store.read(failed.authorizationId).failureReason], ["failed", "DISCOVERY_RUN_FAILED"]);
    // Without a source list the research tick cannot be leased; a refusal names its reason.
    for (const publicReadSources of [undefined, []]) {
      assert.throws(() => admitAyasDiscoveryRun({ repoRoot: dir, authorizations: store, ledgerRunId, baseHead: HEAD, capabilities: [RESEARCH], ...(publicReadSources ? { publicReadSources } : {}) }),
        (error: unknown) => error instanceof AyasDiscoveryRunNotAdmittedError && error.reason === "AYAS_DISCOVERY_PUBLIC_READ_SOURCES_REQUIRED");
    }
    assert.throws(() => admitAyasDiscoveryRun({ repoRoot: dir, authorizations: store, ledgerRunId, baseHead: "HEAD", capabilities: [INBOX] }),
      (error: unknown) => error instanceof AyasDiscoveryRunNotAdmittedError && error.reason === "AYAS_FIREWALL_REQUEST_INVALID" && /AYAS_DISCOVERY_RUN_NOT_ADMITTED/.test(error.message));
    assert.throws(() => admitAyasDiscoveryRun({ repoRoot: dir, authorizations: store, ledgerRunId, baseHead: HEAD, capabilities: [] }), AyasDiscoveryRunNotAdmittedError);
    assert.equal(store.list().length, 2);
    // With no store given, the audit goes to the trusted audit root: here, TEMP.
    const before = fs.existsSync(path.join(root, "capability-audit", "execution", "authorizations")) ? fs.readdirSync(path.join(root, "capability-audit", "execution", "authorizations")).length : 0;
    admitAyasDiscoveryRun({ repoRoot: dir, ledgerRunId, baseHead: HEAD, capabilities: [INBOX] });
    assert.equal(fs.readdirSync(path.join(root, "capability-audit", "execution", "authorizations")).length, before + 1);
  });

  await scenario("the discovery script admits its run before any capability, and asks the lease at every one", () => {
    const code = fs.readFileSync(path.join(repo, "scripts", "ayas-discovery-daemon.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const admitAt = code.indexOf("admitAyasDiscoveryRun(");
    assert.ok(admitAt > 0);
    const calls = ["tickAyasResearchScheduler(", "reconcileAyasStaleProposals(", "discoverAyasNovelPatchCandidates(", "runAyasResearchImprovementCycle(", "runAyasControlledSelfEvolutionCycle(",
      "daemon.discover(", "reviewAyasPendingProposals(", "reconcileAyasMicroBatchStaleness(", "accumulateAyasMicroBatchCandidates("];
    for (const call of calls) {
      assert.ok(code.indexOf(call) > admitAt, `${call} runs before the run is admitted`);
      assert.equal(code.split(call).length - 1, 1, `${call} has more than one call site`);
    }
    for (const guardedCall of [
      /leased\("discovery\.research-scheduler-tick"\)\) \{[^}]*tickAyasResearchScheduler\(\{ repoRoot: root, sources: researchSources \}\)/,
      /leased\("discovery\.proposal-inbox"\) \? reconcileAyasStaleProposals\(/,
      /if \(leased\("discovery\.novel-patch-sandbox"\)\) \{[^}]*discoverAyasNovelPatchCandidates\(/,
      /leased\("discovery\.research-improvement-cycle"\)\) \{[^}]*runAyasResearchImprovementCycle\(/,
      /leased\("discovery\.controlled-evolution-cycle"\)\) \{[^}]*runAyasControlledSelfEvolutionCycle\(/,
      /leased\("discovery\.proposal-inbox"\) \? daemon\.discover\(/,
      /if \(leased\("discovery\.proposal-inbox"\)\) \{[^}]*reviewAyasPendingProposals\(/,
      /microBatchLeased = leased\("discovery\.micro-batch-accumulation"\)/,
      /microBatchLeased \? reconcileAyasMicroBatchStaleness\(/,
      /if \(microBatchLeased\) \{[^}]*accumulateAyasMicroBatchCandidates\(/,
      /publicReadSources: researchSources/,
      /lease\.settle\(\{ ok: true,/, /run\?\.settle\(\{ ok: false \}\)/,
    ]) assert.match(code, guardedCall);
    // The script names every capability of the closed set and no other.
    const named = new Set([...code.matchAll(/"(discovery\.[a-z-]+)"/g)].map((match) => match[1]!));
    assert.deepEqual([...named].sort(), [...AYAS_DISCOVERY_RUN_CAPABILITIES]);
    // The observer still reaches discovery only as a child process and imports no lease or store module.
    const observer = fs.readFileSync(path.join(repo, "scripts", "ayas-autonomy-daemon.ts"), "utf8");
    assert.doesNotMatch(observer, /AyasDiscoveryRunGuard|AyasActionFirewall|AyasExecutionAuthorization/);
  });

  await scenario("integration: a real spawned discovery run leaves exactly one settled lease naming what it ran", () => {
    const { repoRoot, head } = fixtureRepo();
    const child = spawnDaemon(repoRoot);
    assert.equal(child.status, 0, child.stderr + child.stdout);
    const result = JSON.parse(child.stdout.trim().split("\n").pop()!) as { status: string; head: string; gaps: string[]; localDiscoveryRunId: string; capabilityLease: string; discovered: string[] };
    assert.deepEqual([result.status, result.head], ["OK", head]);
    assert.ok(result.gaps.every((gap) => !gap.startsWith("capability not leased")), result.gaps.join("; "));
    const records = new AyasExecutionAuthorizationStore({ rootDir: path.join(repoRoot, "data", "brain") }).list();
    assert.equal(records.length, 1);
    const record = records[0]!; const plan = record.plan as { capabilities: string[]; resource: { repoRoot: string; request: AyasDiscoveryRunRequest } };
    assert.deepEqual([record.authorizationId, record.state, record.action], [result.capabilityLease, "completed", AYAS_DISCOVERY_RUN_ACTION]);
    assert.deepEqual(plan.capabilities, [MICRO, NOVEL, INBOX, IMPROVE]);
    assert.deepEqual([plan.resource.repoRoot, plan.resource.request.baseHead, plan.resource.request.ledgerRunId, plan.resource.request.publicReadSourceDigest], [fs.realpathSync(repoRoot), head, result.localDiscoveryRunId, null]);
    // The leased run still does its work: the registry's real candidate becomes one pending proposal.
    const proposals = createAyasApprovalInboxStore({ rootDir: path.join(repoRoot, "data", "brain") }).load().proposals;
    assert.deepEqual([result.discovered.length, proposals.map((item) => item.status)], [1, ["PENDING"]]);
    assert.equal(git(repoRoot, "status", "--porcelain"), "");
  });

  await scenario("integration: when the lease cannot be recorded the real run does nothing and fails", () => {
    const { repoRoot } = fixtureRepo();
    const inbox = createAyasApprovalInboxStore({ rootDir: path.join(repoRoot, "data", "brain") });
    // A stale approved proposal: an admitted run would reconcile it. It must stay untouched.
    const proposal = inbox.createProposal({ createdAt: "2026-09-16T09:00:00.000Z", baseBranch: "wip/test", baseHead: "a-head-that-no-longer-exists", objective: "fixture objective",
      currentProblem: "fixture problem", selectionReason: "fixture reason", expectedUserBenefit: "fixture benefit", expectedBehaviorChange: "fixture change", unchangedBehavior: "fixture unchanged",
      riskIfNotDone: "fixture risk", technicalRisk: "fixture technical risk", productionImpact: "none", rationale: "fixture rationale", evidence: ["fixture evidence"],
      graphifyEvidence: ["fixture graphify evidence"], candidateRank: 1, risk: "low", safetyClassification: "SAFE", exactFiles: ["scripts/smoke-fixture.ts"], expectedDiffScope: "+1 line",
      testsPlanned: ["fixture"], estimatedCost: "zero-cost", mutationKind: "fixture-registered-kind" });
    const before = fs.readFileSync(path.join(repoRoot, "data", "brain", "autonomy", "approval-inbox.json"), "utf8");
    // The audit directory's parent is a file, so no grant can be written.
    fs.writeFileSync(path.join(repoRoot, "data", "brain", "execution"), "not a directory\n");
    const child = spawnDaemon(repoRoot);
    assert.equal(child.status, 1, child.stdout);
    assert.match(child.stderr, /AYAS_DISCOVERY_RUN_NOT_ADMITTED: AYAS_EXEC_AUTH_IO/);
    assert.doesNotMatch(child.stdout, /"status":"OK"/);
    assert.equal(fs.readFileSync(path.join(repoRoot, "data", "brain", "autonomy", "approval-inbox.json"), "utf8"), before);
    assert.equal(inbox.load().proposals.find((item) => item.proposalId === proposal.proposalId)?.status, "PENDING");
    const runs = createAyasLocalDiscoveryRunLedger({ rootDir: path.join(repoRoot, "data", "brain", "self-improvement", "discovery-runs") }).read().runs;
    assert.deepEqual(runs.map((item) => item.status), ["FAILED"]);
    assert.deepEqual(fs.readdirSync(path.join(repoRoot, "data", "brain")).sort(), ["autonomy", "execution", "self-improvement"]);
  });

  console.log(`Stage 15D discovery run firewall: PASS (${count} scenarios; TEMP only; network/model/production actions 0)`);
}

withAyasExecutionAuditRoot(path.join(root, "capability-audit"), main).catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => fs.rmSync(root, { recursive: true, force: true }));
