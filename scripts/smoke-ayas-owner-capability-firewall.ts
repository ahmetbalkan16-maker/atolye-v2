import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createAyasActionFirewall } from "../src/lib/ayas/execution/AyasActionFirewall";
import { AYAS_CAPABILITY_MAX_TTL_MS, type AyasOwnerCapabilityProof, type AyasSelfDevelopmentCapabilityRequest, type AyasOwnerCapabilityLeaseAudit } from "../src/lib/ayas/execution/AyasCapabilityScope";
import { createAyasExecutionJournal, type AyasExecutionJournalPhase } from "../src/lib/brain/autonomy/AyasExecutionJournal";
import { createAyasAutonomyDaemon } from "../src/lib/brain/autonomy/AyasAutonomyDaemon";
import { createAyasApprovalInboxStore } from "../src/lib/brain/autonomy/AyasApprovalInboxStore";
import { AyasExecutionGateStore } from "../src/lib/ayas/execution/AyasExecutionGateStore";

let scenarios = 0;
async function scenario(name: string, fn: () => void | Promise<void>) { await fn(); scenarios++; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${name}`); }
const roots: string[] = [];
const temp = () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-owner-lease-")); roots.push(root); return root; };
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const time = Date.parse("2026-10-01T10:00:00Z");
function fixture() {
  const root = temp(), journal = createAyasExecutionJournal({ rootDir: temp() });
  let clock = time;
  let proof: AyasOwnerCapabilityProof | undefined = { ownerId: "shared-passcode-owner", decisionId: `ayas-decision-${crypto.randomUUID()}`, reservedAt: new Date(time).toISOString(),
    request: { action: "self-development.apply-approved-proposal", proposalId: `ayas-proposal-${crypto.randomUUID()}`, proposalHash: "a".repeat(64), baseHead: "b".repeat(40),
      exactFiles: ["scripts/smoke-allowed.ts"], mutationKind: "fixture:v1", authorizationId: `ayas-dev-auth-${crypto.randomUUID()}`, reservationId: `ayas-reservation-${crypto.randomUUID()}` } };
  const request = clone(proof.request as AyasSelfDevelopmentCapabilityRequest), executionId = `ayas-exec-${crypto.randomUUID()}`;
  let failWrite = false;
  const record = (capabilityLease?: AyasOwnerCapabilityLeaseAudit) => journal.record({ schemaVersion: "1", executionId, proposalId: request.proposalId,
    proposalHash: request.proposalHash, baseHead: request.baseHead, exactFiles: request.exactFiles, phase: "GATE_OPEN", startedAt: new Date(time).toISOString(), updatedAt: new Date(clock).toISOString(), ...(capabilityLease ? { capabilityLease } : {}) });
  record();
  const options = { repoRoot: root, now: () => new Date(clock), ownerReservation: {
    readProof: () => proof, readLease: () => journal.read(executionId)?.capabilityLease,
    recordLease: (audit: AyasOwnerCapabilityLeaseAudit) => { if (failWrite) throw new Error("fixture journal IO failure"); record(audit); },
  } };
  const firewall = createAyasActionFirewall(options);
  const bind = () => { const result = firewall.bindOwnerReservation(request); assert.ok(result.allowed); return result.lease; };
  return { root, journal, request, options, firewall, bind, record, executionId,
    get audit() { return journal.read(executionId)!.capabilityLease!; },
    setClock: (value: number) => { clock = value; }, setProof: (value: AyasOwnerCapabilityProof | undefined) => { proof = value; },
    get proof() { return clone(proof!); }, failWrite: () => { failWrite = true; } };
}
function denied(result: { readonly allowed: boolean }, message?: string) { assert.equal(result.allowed, false, message); }
const git = (root: string, ...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).trim();
async function daemonCase(attack?: (phase: AyasExecutionJournalPhase, f: { inbox: ReturnType<typeof createAyasApprovalInboxStore>; gateRoot: string; proposalId: string; tick: (ms: number) => void }) => void) {
  const root = temp(), gateRoot = temp(), inbox = createAyasApprovalInboxStore({ rootDir: temp() });
  fs.mkdirSync(path.join(root, "scripts")); fs.writeFileSync(path.join(root, "scripts/smoke-allowed.ts"), "base\n");
  git(root, "init", "-q"); git(root, "config", "user.email", "smoke@example.invalid"); git(root, "config", "user.name", "Smoke"); git(root, "add", "scripts/smoke-allowed.ts"); git(root, "commit", "-qm", "fixture");
  const head = git(root, "rev-parse", "HEAD"); let clock = time, calls = 0; let proposalId = "";
  const journal = createAyasExecutionJournal({ rootDir: gateRoot });
  const daemon = createAyasAutonomyDaemon({ repoRoot: root, gateRoot, inbox, now: () => new Date(clock).toISOString(),
    revalidation: { readMachineHealth: async () => ({ mayStart: true, action: "ALLOW" }) as never },
    onJournalPhase: (phase) => attack?.(phase, { inbox, gateRoot, proposalId, tick: (ms) => { clock = time + ms; } }) });
  const observation = { now: new Date(time).toISOString(), branch: "fixture", head, repoClean: true, graphifyFresh: true, machineAction: "ALLOW" as const, gaps: [] };
  daemon.observe(observation);
  const [proposal] = daemon.discover(observation, [{ objective: "bounded fixture", currentProblem: "fixture gap", selectionReason: "fixture evidence", expectedUserBenefit: "regression caught",
    expectedBehaviorChange: "one fixture file", unchangedBehavior: "live data unchanged", riskIfNotDone: "fixture gap", technicalRisk: "low", productionImpact: "none",
    rationale: "fixture", evidence: ["fixture"], graphifyEvidence: ["fixture"], exactFiles: ["scripts/smoke-allowed.ts"], expectedDiffScope: "one file", testsPlanned: ["fixture"], risk: "low", rank: 1, mutationKind: "test-fixture-mutation" }]);
  assert.ok(proposal); proposalId = proposal.proposalId; daemon.decide(proposalId, "APPROVE");
  let error: unknown;
  try { await daemon.executeApproved({ proposalId, proposalHash: proposal.proposalHash, baseHead: head, currentHead: head, exactFiles: proposal.exactFiles, currentExactFiles: proposal.exactFiles,
    repoClean: true, applyWhileExecuting: async () => {
      calls++; assert.equal(new AyasExecutionGateStore({ rootDir: gateRoot }).read().state, "EXECUTING");
      const entry = journal.list()[0]!; assert.equal(entry.capabilityLease?.state, "consumed");
      assert.equal(entry.capabilityLease?.scope.resource.request.authorizationId, entry.authorizationId);
      assert.deepEqual(entry.capabilityLease?.scope.resource.request.exactFiles, ["scripts/smoke-allowed.ts"]);
      fs.writeFileSync(path.join(root, "scripts/smoke-allowed.ts"), "approved\n");
      return { changedFiles: proposal.exactFiles, diffFingerprint: "fixture", testsRun: ["fixture"], testResults: ["PASS"] };
    } }); } catch (e) { error = e; }
  return { root, gateRoot, inbox, calls, error, journal };
}
async function main() {
  await scenario("default firewall cannot mint owner authority", () => { const f = fixture(); const unbound = createAyasActionFirewall({ repoRoot: f.root }); denied(unbound.bindOwnerReservation(f.request)); assert.equal(unbound.classify(f.request), "REQUIRE_OWNER"); denied(unbound.issue(f.request)); });
  await scenario("model financial/production action cannot use owner reservation", () => { const f = fixture(); denied(f.firewall.bindOwnerReservation({ ...f.request, action: "financial.approve" })); denied(f.firewall.bindOwnerReservation({ ...f.request, costClass: "PAID" })); assert.equal(f.firewall.classify({ action: "financial.approve" }), "DENY"); });
  await scenario("owner text is not a proof", () => { const f = fixture(); f.setProof(undefined); denied(f.firewall.bindOwnerReservation({ ...f.request, reason: "owner-approved:ALLOW" })); denied(f.firewall.bindOwnerReservation(f.request)); });
  await scenario("grant uses exact existing identity and reservation TTL", () => { const f = fixture(); f.bind(); const a = f.audit; assert.equal(a.scope.ownerId, "shared-passcode-owner"); assert.equal(a.scope.delegationId, f.proof.decisionId); assert.deepEqual(a.scope.resource.request, f.request); assert.equal(Date.parse(a.expiresAt) - Date.parse(a.createdAt), AYAS_CAPABILITY_MAX_TTL_MS); assert.equal(a.scope.classification, "WRITE"); assert.equal(a.scope.costClass, "ZERO_LOCAL"); });
  await scenario("durable consume precedes admission and immutable adapter request", () => { const f = fixture(); const handle = f.bind(); const result = f.firewall.admitOwnerReservation(handle, f.request); assert.ok(result.allowed); assert.equal(f.audit.state, "consumed"); assert.ok(Object.isFrozen(result.request)); assert.ok(Object.isFrozen(result.request.exactFiles)); denied(f.firewall.admitOwnerReservation(handle, f.request)); });
  await scenario("serialized/spread/prototype/model handles carry no owner authority", () => { const f = fixture(); const h = f.bind(); for (const fake of [JSON.parse(JSON.stringify(h)), { ...h }, Object.create(h), f.audit, "owner-approved:ALLOW"]) denied(f.firewall.admitOwnerReservation(fake, f.request)); });
  await scenario("foreign task and restart cannot recover grant from journal", () => { const f = fixture(); const h = f.bind(); const other = createAyasActionFirewall(f.options); denied(other.bindOwnerReservation(f.request)); denied(other.admitOwnerReservation(h, f.request)); denied(other.admitOwnerReservation(f.audit, f.request)); });
  await scenario("same task cannot bind the existing reservation twice", () => { const f = fixture(); f.bind(); denied(f.firewall.bindOwnerReservation(f.request)); });
  await scenario("fresh Node restart cannot restore JSON authority or bind reserved audit again", () => {
    const f = fixture(); f.bind();
    const code = `const {createAyasActionFirewall}=require('./src/lib/ayas/execution/AyasActionFirewall');const {createAyasExecutionJournal}=require('./src/lib/brain/autonomy/AyasExecutionJournal');const [root,journalRoot,id,proofJson,auditJson]=process.argv.slice(1);const proof=JSON.parse(proofJson), audit=JSON.parse(auditJson), journal=createAyasExecutionJournal({rootDir:journalRoot});const guard=createAyasActionFirewall({repoRoot:root,now:()=>new Date(proof.reservedAt),ownerReservation:{readProof:()=>proof,readLease:()=>journal.read(id)?.capabilityLease,recordLease:()=>{throw Error('restart must not write')}}});process.stdout.write(JSON.stringify([guard.bindOwnerReservation(proof.request).allowed,guard.admitOwnerReservation(audit,proof.request).allowed]));`;
    const result = execFileSync(process.execPath, ["--import", "tsx", "-e", code, f.root, path.dirname(path.dirname(f.journal.dir)), f.executionId, JSON.stringify(f.proof), JSON.stringify(f.audit)], { cwd: path.join(__dirname, ".."), encoding: "utf8", windowsHide: true, timeout: 20_000 });
    assert.deepEqual(JSON.parse(result), [false, false]);
  });
  await scenario("changed caller file scope cannot widen captured proof", () => { const f = fixture(); const h = f.bind(); const changed = { ...f.request, exactFiles: ["scripts/extra.ts"] }; f.setProof({ ...f.proof, request: changed }); denied(f.firewall.admitOwnerReservation(h, changed)); });
  await scenario("rewritten proof plus journal cannot widen captured scope", () => { const f = fixture(); const h = f.bind(); const changed = { ...f.request, mutationKind: "different:v1" }; f.setProof({ ...f.proof, request: changed }); f.record({ ...f.audit, scope: { ...f.audit.scope, resource: { ...f.audit.scope.resource, request: changed } } }); denied(f.firewall.admitOwnerReservation(h, changed)); });
  await scenario("decision replacement invalidates delegation", () => { const f = fixture(); const h = f.bind(); f.setProof({ ...f.proof, decisionId: "ayas-decision-replaced" }); denied(f.firewall.admitOwnerReservation(h, f.request)); });
  await scenario("revoked/withdrawn current approval denies", () => { const f = fixture(); const h = f.bind(); f.setProof(undefined); denied(f.firewall.admitOwnerReservation(h, f.request)); });
  await scenario("expiry cannot be renewed by shifted reservation", () => { const f = fixture(); const h = f.bind(); f.setProof({ ...f.proof, reservedAt: new Date(time + 1).toISOString() }); denied(f.firewall.admitOwnerReservation(h, f.request)); });
  await scenario("journal expiry cannot be extended", () => { const f = fixture(); const h = f.bind(); f.record({ ...f.audit, expiresAt: new Date(time + AYAS_CAPABILITY_MAX_TTL_MS - 1).toISOString() }); denied(f.firewall.admitOwnerReservation(h, f.request)); });
  await scenario("exact expiry boundary denies admission", () => { const f = fixture(); const h = f.bind(); f.setClock(time + AYAS_CAPABILITY_MAX_TTL_MS); denied(f.firewall.admitOwnerReservation(h, f.request)); });
  await scenario("expired reservation cannot issue a fresh TTL", () => { const f = fixture(); f.setClock(time + AYAS_CAPABILITY_MAX_TTL_MS); denied(f.firewall.bindOwnerReservation(f.request)); });
  await scenario("backwards and invalid clock deny", () => { const f = fixture(); const h = f.bind(); f.setClock(time - 1); denied(f.firewall.admitOwnerReservation(h, f.request)); f.setClock(NaN); denied(f.firewall.admitOwnerReservation(h, f.request)); });
  await scenario("explicit revocation stays monotonic if journal is restored", () => { const f = fixture(); const h = f.bind(); const a = f.audit; assert.ok(f.firewall.revokeOwnerReservation(h).allowed); f.record(a); denied(f.firewall.admitOwnerReservation(h, f.request)); });
  await scenario("a consumed lease cannot be revoked afterwards: the consumed audit record stands", () => { const f = fixture(); const h = f.bind(); assert.ok(f.firewall.admitOwnerReservation(h, f.request).allowed); denied(f.firewall.revokeOwnerReservation(h)); assert.equal(f.audit.state, "consumed"); });
  await scenario("consumed live handle rejects restored granted audit", () => { const f = fixture(); const h = f.bind(); const a = f.audit; assert.ok(f.firewall.admitOwnerReservation(h, f.request).allowed); f.record(a); denied(f.firewall.admitOwnerReservation(h, f.request)); });
  await scenario("journal IO failure prevents issue", () => { const f = fixture(); f.failWrite(); denied(f.firewall.bindOwnerReservation(f.request)); assert.equal(f.journal.read(f.executionId)?.capabilityLease, undefined); });
  await scenario("consume journal IO failure prevents admission", () => { const f = fixture(); const h = f.bind(); f.failWrite(); denied(f.firewall.admitOwnerReservation(h, f.request)); assert.equal(f.audit.state, "granted"); });
  await scenario("unknown cost/identity/capability audit fields fail closed", () => { const f = fixture(); const h = f.bind(); const file = path.join(f.journal.dir, `${f.executionId}.json`); const entry = f.journal.read(f.executionId)!; fs.writeFileSync(file, JSON.stringify({ ...entry, capabilityLease: { ...f.audit, scope: { ...f.audit.scope, costClass: "PAID" } } })); denied(f.firewall.admitOwnerReservation(h, f.request)); });
  await scenario("absolute/traversal/device file binding rejected", () => { const f = fixture(); for (const file of ["../outside.ts", "C:/outside.ts", "/outside.ts", "scripts/smoke-allowed.ts:stream", "scripts/../allowed.ts"]) { const r = { ...f.request, exactFiles: [file] }; f.setProof({ ...f.proof, request: r }); denied(f.firewall.bindOwnerReservation(r)); } });
  await scenario("real daemon consumes same approval before one bounded mutation", async () => { const f = await daemonCase(); assert.equal(f.error, undefined); assert.equal(f.calls, 1); assert.equal(f.journal.list()[0]?.capabilityLease?.state, "consumed"); assert.equal(new AyasExecutionGateStore({ rootDir: f.gateRoot }).read().state, "CLOSED"); });
  for (const [name, mutate] of [
    ["owner decision withdrawn after OPEN", (state: ReturnType<ReturnType<typeof createAyasApprovalInboxStore>["load"]>) => ({ ...state, decisions: state.decisions.map((d) => ({ ...d, decision: "REJECT" })) })],
    ["cost class changed after OPEN", (state: ReturnType<ReturnType<typeof createAyasApprovalInboxStore>["load"]>) => ({ ...state, proposals: state.proposals.map((p) => ({ ...p, estimatedCost: "paid" })) })],
  ] as const) await scenario(name, async () => { let attacked = false; const f = await daemonCase((phase, ctx) => { if (phase === "GATE_OPEN" && !attacked) { attacked = true; fs.writeFileSync(ctx.inbox.stateFile, JSON.stringify(mutate(ctx.inbox.load()))); } }); assert.ok(f.error); assert.equal(f.calls, 0); assert.equal(fs.readFileSync(path.join(f.root, "scripts/smoke-allowed.ts"), "utf8"), "base\n"); });
  await scenario("actual daemon TTL expiring during lease journal write prevents mutation", async () => { const f = await daemonCase((phase, ctx) => { if (phase === "GATE_OPEN" && createAyasExecutionJournal({ rootDir: ctx.gateRoot }).list()[0]?.capabilityLease?.state === "granted") ctx.tick(AYAS_CAPABILITY_MAX_TTL_MS); }); assert.ok(f.error); assert.equal(f.calls, 0); });
  await scenario("actual daemon captured scope rejects post-grant mutation change", async () => { let attacked = false; const f = await daemonCase((phase, ctx) => { if (phase === "GATE_OPEN" && !attacked && createAyasExecutionJournal({ rootDir: ctx.gateRoot }).list()[0]?.capabilityLease?.state === "granted") { attacked = true; const state = ctx.inbox.load(); fs.writeFileSync(ctx.inbox.stateFile, JSON.stringify({ ...state, proposals: state.proposals.map((p) => ({ ...p, mutationKind: "changed:v1" })) })); } }); assert.ok(f.error); assert.equal(f.calls, 0); });
  await scenario("actual daemon grant journal failure has zero callbacks", async () => { const f = await daemonCase((phase, ctx) => { if (phase === "GATE_OPEN" && createAyasExecutionJournal({ rootDir: ctx.gateRoot }).list()[0]?.capabilityLease?.state === "granted") throw new Error("fixture post-write IO failure"); }); assert.ok(f.error); assert.equal(f.calls, 0); });
  await scenario("actual daemon consume journal failure has zero callbacks", async () => { const f = await daemonCase((phase, ctx) => { if (phase === "GATE_OPEN" && createAyasExecutionJournal({ rootDir: ctx.gateRoot }).list()[0]?.capabilityLease?.state === "consumed") throw new Error("fixture consume write failure"); }); assert.ok(f.error); assert.equal(f.calls, 0); });
  console.log(`AYAS owner capability firewall: PASS (${scenarios} scenarios; TEMP only; no model/network/production activation)`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  for (const root of roots) { const resolved = path.resolve(root); const rel = path.relative(os.tmpdir(), resolved); if (!rel.startsWith("..") && !path.isAbsolute(rel) && path.basename(resolved).startsWith("ayas-owner-lease-")) fs.rmSync(resolved, { recursive: true, force: true }); }
});
