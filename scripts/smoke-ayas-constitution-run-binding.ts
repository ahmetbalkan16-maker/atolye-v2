/** Actual admission seams, signed TEMP policies and loopback HTTP fixtures; no live adoption/provider. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import vm from "node:vm";
import ts from "typescript";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { issueSession } from "../src/lib/auth/accessGate";
import { proposeAyasOwnerConstitution } from "../src/lib/ayas/governance/AyasOwnerConstitution";
import { activateAyasOwnerConstitution } from "../src/lib/ayas/governance/AyasOwnerConstitutionStore";
import { bindAyasConstitutionRun, constitutionRootPath, readAyasOwnerConstitution } from "../src/lib/ayas/governance/AyasOwnerConstitutionReader";
import { createAyasActionFirewall } from "../src/lib/ayas/execution/AyasActionFirewall";
import { AyasExecutionAuthorizationStore } from "../src/lib/ayas/execution/AyasExecutionAuthorization";
import { AYAS_DISCOVERY_RUN_ACTION, type AyasOwnerCapabilityProof, type AyasOwnerCapabilityLeaseAudit } from "../src/lib/ayas/execution/AyasCapabilityScope";
import { ayasSafePublicFetch } from "../src/lib/brain/autonomy/AyasSafePublicFetch";
import { runAyasLightResearchScan } from "../src/lib/brain/autonomy/AyasLightResearchEngine";
import { runAyasDeepResearchScan } from "../src/lib/brain/autonomy/AyasDeepResearchEngine";
import { tickAyasResearchScheduler } from "../src/lib/brain/autonomy/AyasResearchScheduler";
import { createAyasResearchSchedulerStateStore } from "../src/lib/brain/autonomy/AyasResearchSchedulerStateStore";
import { createAyasResearchSourceStateStore } from "../src/lib/brain/autonomy/AyasResearchSourceStateStore";
import { createAyasExternalResearchStore } from "../src/lib/brain/autonomy/AyasExternalResearchStore";
import { createAyasResearchNoveltyStore } from "../src/lib/brain/autonomy/AyasResearchNoveltyStore";
import type { AyasResearchSource } from "../src/lib/brain/autonomy/AyasResearchSourceRegistry";
import { evaluateAyasMachineHealth } from "../src/lib/ayas/machine/AyasMachineHealthGuard";
import type { AyasMachineTelemetry } from "../src/lib/ayas/machine/AyasMachineTelemetry";
import { emitSmokeResult } from "./lib/SmokeResult";

const repo = path.resolve(__dirname, ".."); const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-constitution-binding-"));
const key = "synthetic-constitution-binding-key-123", env = { NODE_ENV: "test", AYAS_ACCESS_KEY: key };
const raw = { schemaVersion: "1", action: "inspect-source-file", intent: "read", requestedBy: "fixture", plan: { filePath: "src/example.ts" } };
let count = 0;
const fresh = () => fs.mkdtempSync(path.join(temp, "root-"));
async function scenario(name: string, fn: () => Promise<void> | void) { await fn(); count++; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }
async function adopt(root: string) {
  const state = readAyasOwnerConstitution(root);
  return activateAyasOwnerConstitution({ repoRoot: root, policy: proposeAyasOwnerConstitution(state.state === "ACTIVE" ? state.policy.version + 1 : 1, state.state === "ACTIVE" ? state.digest : null),
    expectedPreviousDigest: state.state === "ACTIVE" ? state.digest : null, ownerSession: await issueSession(key), env });
}
const corrupt = (root: string) => { const file = path.join(constitutionRootPath(root), "1.json"), record = JSON.parse(fs.readFileSync(file, "utf8")); record.signature = "f".repeat(128); fs.writeFileSync(file, JSON.stringify(record)); };
function firewall(root: string) { const store = new AyasExecutionAuthorizationStore({ rootDir: path.join(root, "audit") }); return { store, fw: createAyasActionFirewall({ repoRoot: root, authorizations: store }) }; }
function source(url: string, id = "fixture"): AyasResearchSource { return { sourceId: id, provider: "Fixture", category: "OPEN_SOURCE_AI", kind: "atom", url, officialSource: true, expectedContentTypes: ["application/atom+xml"], notes: "loopback fixture" }; }
const feed = '<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Fixture1</title><link href="https://example.invalid/1"/><summary>One</summary></entry><entry><title>Fixture2</title><link href="https://example.invalid/2"/><summary>Two</summary></entry></feed>';
async function serverCase(handler: (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void> | void, run: (url: string) => Promise<void>) {
  let fault: unknown;
  const server = http.createServer((req, res) => { Promise.resolve(handler(req, res)).catch((error) => { fault = error; res.destroy(); }); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try { const address = server.address(); assert.ok(address && typeof address === "object"); await run(`http://127.0.0.1:${address.port}/feed`); if (fault) throw fault; }
  finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}
async function main() {
  try {
    await scenario("existing unadopted mode is explicit and emits no active digest", () => {
      const { fw } = firewall(fresh()); assert.equal(fw.constitutionEvidence().state, "MISSING"); assert.equal(fw.constitutionEvidence().constitutionDigest, null); assert.equal(fw.constitutionEvidence().authority, "NONE");
    });
    await scenario("signed current digest binds common firewall; owner text cannot authorize publish", async () => {
      const r = fresh(), active = await adopt(r), { fw } = firewall(r); assert.equal(fw.constitutionEvidence().constitutionDigest, active.digest);
      const issued = fw.issue(raw); assert.ok(issued.allowed); assert.equal(fw.admit(issued.lease, raw).allowed, true); assert.equal(fw.issue({ ...raw, action: "publish-youtube", ownerApproved: true }).allowed, false);
    });
    await scenario("changed constitution refuses fresh issue and admission without consuming old grant; cleanup remains", async () => {
      const r = fresh(); await adopt(r); const { fw, store } = firewall(r), issued = fw.issue(raw); assert.ok(issued.allowed); await adopt(r);
      assert.equal(fw.issue(raw).allowed, false); const result = fw.admit(issued.lease, raw); assert.ok(!result.allowed); assert.equal(result.reason, "AYAS_CONSTITUTION_CHANGED");
      assert.equal(store.list().length, 1); assert.equal(store.list()[0]!.state, "granted"); assert.equal(fw.revoke(issued.lease).allowed, true);
      assert.equal(firewall(r).fw.issue(raw).allowed, true, "a new run binds the new signed revision");
    });
    await scenario("adoption during a legacy run stops new tool work", async () => {
      const r = fresh(), { fw } = firewall(r); await adopt(r); assert.equal(fw.issue(raw).allowed, false);
    });
    await scenario("discovery digest change refuses issue/admit and each already-admitted capability", async () => {
      const r = fresh(); await adopt(r); const { fw, store } = firewall(r);
      const request = { action: AYAS_DISCOVERY_RUN_ACTION, ledgerRunId: `ayas-local-discovery-${randomUUID()}`, baseHead: "a".repeat(40), capabilities: ["discovery.proposal-inbox"], publicReadSourceDigest: null };
      const issued = fw.issueDiscoveryRun(request), waiting = fw.issueDiscoveryRun({ ...request, ledgerRunId: `ayas-local-discovery-${randomUUID()}` }); assert.ok(issued.allowed && waiting.allowed);
      const admitted = fw.admitDiscoveryRun(issued.lease, request); assert.ok(admitted.allowed); assert.equal(admitted.permits("discovery.proposal-inbox"), true); await adopt(r);
      assert.equal(fw.issueDiscoveryRun(request).allowed, false); assert.equal(fw.admitDiscoveryRun(waiting.lease, request).allowed, false); assert.equal(admitted.permits("discovery.proposal-inbox"), false); assert.equal(store.list().length, 2);
    });
    await scenario("signed owner reservation cannot outlive constitution revision", async () => {
      const r = fresh(); await adopt(r); let audit: AyasOwnerCapabilityLeaseAudit | undefined;
      const proof: AyasOwnerCapabilityProof = { ownerId: "shared-passcode-owner", decisionId: `ayas-decision-${randomUUID()}`, reservedAt: new Date().toISOString(), request: {
        action: "self-development.apply-approved-proposal", proposalId: `ayas-proposal-${randomUUID()}`, proposalHash: "a".repeat(64), baseHead: "b".repeat(40), exactFiles: ["scripts/smoke-allowed.ts"], mutationKind: "fixture:v1", authorizationId: `ayas-dev-auth-${randomUUID()}`, reservationId: `ayas-reservation-${randomUUID()}` } };
      const fw = createAyasActionFirewall({ repoRoot: r, ownerReservation: { readProof: () => proof, readLease: () => audit, recordLease: (value) => { audit = value; } } });
      const issued = fw.bindOwnerReservation(proof.request); assert.ok(issued.allowed); await adopt(r);
      assert.equal(fw.bindOwnerReservation(proof.request).allowed, false); assert.equal(fw.admitOwnerReservation(issued.lease, proof.request).allowed, false); assert.equal(audit?.state, "granted"); assert.equal(fw.revokeOwnerReservation(issued.lease).allowed, true);
    });
    await scenario("unverifiable constitution refuses every fresh issuer before any authority write", async () => {
      const r = fresh(); await adopt(r); corrupt(r); const { fw, store } = firewall(r); assert.equal(fw.issue(raw).allowed, false); assert.equal(fw.issueDiscoveryRun({}).allowed, false); assert.equal(fw.bindOwnerReservation({}).allowed, false); assert.equal(store.list().length, 0);
    });
    await scenario("protected paths remain outside AYAS source mutation even with an exact owner reservation", async () => {
      const r = fresh(); await adopt(r); const binding = bindAyasConstitutionRun(r, "SELF_EVOLUTION", "protected");
      for (const file of [".env", ".env.local", ".git/config", "data/brain/owner-constitution/2.json", "src/lib/ayas/governance/AyasOwnerConstitution.ts", "app/brain/constitution/actions.ts"]) {
        assert.equal(binding.protectsPath(file), true); let writes = 0;
        const proof: AyasOwnerCapabilityProof = { ownerId: "shared-passcode-owner", decisionId: `ayas-decision-${randomUUID()}`, reservedAt: new Date().toISOString(), request: {
          action: "self-development.apply-approved-proposal", proposalId: `ayas-proposal-${randomUUID()}`, proposalHash: "a".repeat(64), baseHead: "b".repeat(40), exactFiles: [file], mutationKind: "fixture:v1", authorizationId: `ayas-dev-auth-${randomUUID()}`, reservationId: `ayas-reservation-${randomUUID()}` } };
        const fw = createAyasActionFirewall({ repoRoot: r, ownerReservation: { readProof: () => proof, readLease: () => undefined, recordLease: () => { writes++; } } });
        const result = fw.bindOwnerReservation(proof.request); assert.ok(!result.allowed); assert.equal(result.reason, "AYAS_CONSTITUTION_PROTECTED_PATH"); assert.equal(writes, 0);
      }
      assert.equal(binding.protectsPath("src/lib/example.ts"), false); assert.equal(binding.protectsPath("../escape"), true);
    });
    await scenario("research tick binds active digest and refuses invalid policy before new reservation", async () => {
      const r = fresh(), active = await adopt(r), gateRoot = path.join(r, "scheduler"), stateStore = createAyasResearchSchedulerStateStore({ rootDir: gateRoot });
      const args = { repoRoot: r, gateRoot, stateStore, sources: [], light: { stateStore: createAyasResearchSourceStateStore({ rootDir: path.join(r, "sources") }) }, deep: { researchStore: createAyasExternalResearchStore({ rootDir: path.join(r, "findings") }), noveltyStore: createAyasResearchNoveltyStore({ rootDir: path.join(r, "novelty") }) } };
      const result = await tickAyasResearchScheduler(args); assert.equal(result.constitution?.constitutionDigest, active.digest); corrupt(r);
      const before = stateStore.read(); await assert.rejects(tickAyasResearchScheduler(args), /AYAS_CONSTITUTION_UNAVAILABLE/); assert.deepEqual(stateStore.read(), before);
    });
    await scenario("uncertain research reservation reconciles under invalid policy without replay", async () => {
      const r = fresh(); await adopt(r); corrupt(r); const gateRoot = path.join(r, "scheduler"), stateStore = createAyasResearchSchedulerStateStore({ rootDir: gateRoot });
      stateStore.write({ schemaVersion: "1", consecutiveFailures: 0, currentRunId: "interrupted", currentMode: "LIGHT" });
      const result = await tickAyasResearchScheduler({ repoRoot: r, gateRoot, stateStore, sources: [] }); assert.equal(result.outcome, "RECOVERED_UNCERTAIN"); assert.equal(result.state.lastUncertainRunId, "interrupted"); assert.equal(result.state.totalAttempts, undefined);
    });
    for (const mode of ["redirect", "retry"] as const) await scenario(`safe fetch rechecks policy before ${mode} request`, async () => {
      const r = fresh(); await adopt(r); const binding = bindAyasConstitutionRun(r, "AGENT", mode); let calls = 0;
      await serverCase(async (_req, res) => { calls++; await adopt(r); if (mode === "retry") { res.destroy(); return; } res.writeHead(302, { location: "/next", "content-type": "application/atom+xml" }); res.end(feed); }, async (url) => {
        await assert.rejects(ayasSafePublicFetch(url, { dangerouslyAllowPrivateNetworkForTests: true, maxRetries: 2, retryBaseDelayMs: 0, admitRequest: () => { const refusal = binding.refusal(); if (refusal) throw new Error(refusal); } }), /CONSTITUTION_CHANGED/); assert.equal(calls, 1);
      });
    });
    await scenario("light scan stops on changed policy before second source and preserves parent binding", async () => {
      const r = fresh(); await adopt(r); let calls = 0;
      await serverCase(async (_req, res) => { calls++; await adopt(r); res.writeHead(200, { "content-type": "application/atom+xml" }); res.end(feed); }, async (url) => {
        await assert.rejects(runAyasLightResearchScan({ repoRoot: r, sources: [source(url), source(url, "second")], stateStore: createAyasResearchSourceStateStore({ rootDir: path.join(r, "sources") }), dangerouslyAllowPrivateNetworkForTests: true }), /CONSTITUTION_CHANGED/); assert.equal(calls, 1);
      });
      await assert.rejects(runAyasLightResearchScan({ repoRoot: r, sources: [], admitEffect: () => { throw new Error("parent revoked"); } }), /parent revoked/);
    });
    await scenario("deep scan never invokes model after source response changes constitution", async () => {
      const r = fresh(); await adopt(r); let models = 0;
      await serverCase(async (_req, res) => { await adopt(r); res.writeHead(200, { "content-type": "application/atom+xml" }); res.end(feed); }, async (url) => {
        await assert.rejects(runAyasDeepResearchScan({ repoRoot: r, sources: [source(url)], researchStore: createAyasExternalResearchStore({ rootDir: path.join(r, "findings") }), noveltyStore: createAyasResearchNoveltyStore({ rootDir: path.join(r, "novelty") }),
          provider: { generate: async () => { models++; return "{}"; } }, dangerouslyAllowPrivateNetworkForTests: true }), /CONSTITUTION_CHANGED/); assert.equal(models, 0);
      });
      await assert.rejects(runAyasDeepResearchScan({ repoRoot: r, sources: [], admitEffect: () => { throw new Error("parent revoked"); } }), /parent revoked/);
    });
    await scenario("deep run stops before second model and never records first model result after revision change", async () => {
      const r = fresh(); await adopt(r); let models = 0; const researchStore = createAyasExternalResearchStore({ rootDir: path.join(r, "findings") });
      await serverCase((_req, res) => { res.writeHead(200, { "content-type": "application/atom+xml" }); res.end(feed); }, async (url) => {
        await assert.rejects(runAyasDeepResearchScan({ repoRoot: r, sources: [source(url)], researchStore, noveltyStore: createAyasResearchNoveltyStore({ rootDir: path.join(r, "novelty") }),
          provider: { generate: async () => { models++; await adopt(r); return "{}"; } }, dangerouslyAllowPrivateNetworkForTests: true }), /CONSTITUTION_CHANGED/); assert.equal(models, 1); assert.equal(researchStore.list().length, 0);
      });
    });
    await scenario("actual observer tick refuses child dispatch on policy change while retaining observation", async () => {
      const r = fresh(); await adopt(r); const binding = bindAyasConstitutionRun(r, "AGENT", "observer"); await adopt(r); let children = 0, observations = 0;
      const text = fs.readFileSync(path.join(repo, "scripts/ayas-autonomy-daemon.ts"), "utf8"), ast = ts.createSourceFile("daemon.ts", text, ts.ScriptTarget.Latest, true);
      const fn = ast.statements.find((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === "tick"); assert.ok(fn);
      const code = ts.transpileModule(fn.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
      const logs: string[] = []; const tick = vm.runInNewContext(code + "\ntick", { root: r, Date, collectAyasMachineTelemetry: async () => ({}), readAyasOwnerConstitution, evaluateAyasMachineHealth: () => ({ action: "ALLOW" }), git: () => "a".repeat(40),
        graphifyFresh: () => true, loadBrainConsoleSnapshot: async () => ({ errors: [], tasks: { pendingApproval: 0 } }), runAyasDiscoveryDaemon: () => { children++; return { ok: true }; }, runDurableTaskRecovery: () => { children++; return { ok: true }; }, console: { log: (s: string) => logs.push(s) } });
      await tick({ observe: () => { observations++; }, state: {} }, 1000, false, binding); assert.equal(children, 0); assert.equal(observations, 1); assert.equal(JSON.parse(logs[0]!).status, "CONSTITUTION_HOLD");
    });
    await scenario("actual durable operator refuses invalid-policy enqueue before git or new task", async () => {
      const r = fresh(); await adopt(r); corrupt(r); const journalRoot = path.join(r, "journal");
      const childEnv: NodeJS.ProcessEnv = { ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !/KEY|TOKEN|SECRET|PASS|COOKIE|CREDENTIAL/i.test(name))), NODE_ENV: "test" };
      const child = spawnSync(process.execPath, ["--import", pathToFileURL(path.join(repo, "node_modules/tsx/dist/loader.mjs")).href, path.join(repo, "scripts/ayas-durable-task-recovery.ts"), "--root", journalRoot, "--apply", "--enqueue-head-check"], { cwd: r, env: childEnv, encoding: "utf8", windowsHide: true, timeout: 30_000 });
      assert.equal(child.status, 2, child.stderr + child.stdout); const result = JSON.parse(child.stdout); assert.equal(result.code, "AYAS_CONSTITUTION_UNAVAILABLE"); assert.equal(result.constitution.authority, "NONE"); assert.ok(!fs.existsSync(path.join(journalRoot, "tasks")));
    });
    await scenario("owner RAM threshold blocks new heavy work, preserves owned-work cleanup and default90", () => {
      const telemetry: AyasMachineTelemetry = { observedAt: new Date().toISOString(), cpuPercent: 20, gpuPercent: 10, ramUsedPercent: 88, vramUsedPercent: 20, diskFreePercent: 50, processRssMb: 100, ffmpegRunning: false, localModelRunning: false, unavailable: [] };
      assert.equal(evaluateAyasMachineHealth(telemetry, { stage: "video", ownedActive: false }, 85).mayStart, false); assert.equal(evaluateAyasMachineHealth(telemetry, { stage: "video", ownedActive: true }, 85).action, "THROTTLE");
      assert.equal(evaluateAyasMachineHealth({ ...telemetry, ramUsedPercent: 90 }, { stage: "video", ownedActive: false }).mayStart, false); assert.equal(evaluateAyasMachineHealth(telemetry, { stage: "video", ownedActive: false }, NaN).mayStart, false);
    });
    emitSmokeResult("ayas-constitution-run-binding", count);
  } finally { assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir())); assert.ok(path.basename(temp).startsWith("ayas-constitution-binding-")); fs.rmSync(temp, { recursive: true, force: true }); }
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
