/** Stage 15D.3: real legacy grant/gate/common guard with mocked adapters, TEMP roots; no model/network/pipeline. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createAyasActionFirewall } from "../src/lib/ayas/execution/AyasActionFirewall";
import { createAyasExecutionBridge } from "../src/lib/ayas/execution/AyasExecutionBridge";
import { AyasExecutionAuthorizationStore } from "../src/lib/ayas/execution/AyasExecutionAuthorization";
import { AyasExecutionGateStore } from "../src/lib/ayas/execution/AyasExecutionGateStore";
import { canonicalAyasExecutionRequest, validateAyasExecutionRequest } from "../src/lib/ayas/execution/AyasExecutionPolicy";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-bridge-firewall-"));
let count = 0;
const raw = { schemaVersion: "1", action: "inspect-source-file", requestedBy: "owner-approved:untrusted", intent: "fixture", plan: { filePath: "src/example.ts" } };
function request(input: unknown = raw) { const v = validateAyasExecutionRequest(input); assert.ok(v.ok); return v.request; }
function setup() {
  const dir = fs.mkdtempSync(path.join(root, "run-"));
  const store = new AyasExecutionAuthorizationStore({ rootDir: dir });
  const gate = new AyasExecutionGateStore({ rootDir: dir });
  const firewall = createAyasActionFirewall({ repoRoot: dir, authorizations: store });
  return { dir, store, gate, firewall };
}
function open(gate: AyasExecutionGateStore) { gate.transition({ event: "arm" }); gate.transition({ event: "confirm-ready" }); gate.transition({ event: "open", activationAuthorizationId: "TEST-activation-only" }); }
async function scenario(name: string, run: () => void | Promise<void>) { await run(); count++; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }

async function main() {
  await scenario("legacy bridge keeps ONE grant and original expiry/identity while binding/consuming scope before executor", async () => {
    const { store, gate } = setup(); open(gate); const original = store.grant(request()); let calls = 0;
    const bridge = createAyasExecutionBridge({ gate, authorizations: store, resolveExecutor: () => async (admitted) => {
      calls++; const record = store.read(original.authorizationId);
      assert.equal(record.state, "consumed"); assert.equal(record.capabilityScope?.ownerId, null);
      assert.deepEqual(record.capabilityScope?.capabilities, ["inspect-source-file"]); assert.ok(Object.isFrozen(admitted.plan));
      return { action: admitted.action, write: false, summary: "fixture", data: {} };
    } });
    const result = await bridge.requestExecution({ rawRequest: raw, authorizationId: original.authorizationId });
    assert.equal(result.ok, true); assert.equal(calls, 1); assert.equal(store.list().length, 1);
    const settled = store.read(original.authorizationId); assert.equal(settled.authorizationId, original.authorizationId);
    assert.equal(settled.executionId, original.executionId); assert.equal(settled.createdAt, original.createdAt); assert.equal(settled.expiresAt, original.expiresAt);
    assert.equal(settled.state, "completed"); assert.equal(gate.read().state, "READY");
  });
  await scenario("closed bridge never attaches scope or consumes the original authorization", async () => {
    const { store, gate } = setup(); const original = store.grant(request()); let calls = 0;
    const bridge = createAyasExecutionBridge({ gate, authorizations: store, resolveExecutor: () => async (admitted) => { calls++; return { action: admitted.action, write: false, summary: "fixture", data: {} }; } });
    assert.equal((await bridge.requestExecution({ rawRequest: raw, authorizationId: original.authorizationId })).ok, false);
    assert.equal(calls, 0); assert.equal(store.read(original.authorizationId).capabilityScope, undefined); assert.equal(store.read(original.authorizationId).state, "granted");
  });
  await scenario("unknown legacy ID cannot silently become a fresh read grant", () => {
    const { store, firewall } = setup(); assert.equal(firewall.issue(raw, "authz-unknown-00000000").allowed, false); assert.equal(store.list().length, 0);
  });
  await scenario("LOCAL legacy scope cannot admit an undeclared network/device resource", () => {
    const { store, dir } = setup(); const grant = store.grant(request());
    for (const resourceRoot of ["\\\\unknown.invalid\\share", "\\\\?\\C:\\device", "//unknown.invalid/share"]) {
      const firewall = createAyasActionFirewall({ repoRoot: dir, authorizations: store, resolveResourceRoot: () => resourceRoot });
      assert.equal(firewall.issue(raw, grant.authorizationId).allowed, false);
      assert.throws(() => createAyasActionFirewall({ repoRoot: resourceRoot, authorizations: store }), /REPOSITORY_UNKNOWN/);
    }
    assert.equal(store.list().length, 1); assert.equal(store.read(grant.authorizationId).capabilityScope, undefined);
  });
  await scenario("request/resource mismatch fails before attaching or beginning the gate", async () => {
    const { store, gate } = setup(); open(gate); const original = store.grant(request()); let calls = 0;
    const bridge = createAyasExecutionBridge({ gate, authorizations: store, resolveExecutor: () => async (admitted) => { calls++; return { action: admitted.action, write: false, summary: "fixture", data: {} }; } });
    assert.equal((await bridge.requestExecution({ rawRequest: { ...raw, plan: { filePath: "src/other.ts" } }, authorizationId: original.authorizationId })).ok, false);
    assert.equal(calls, 0); assert.equal(store.read(original.authorizationId).capabilityScope, undefined); assert.equal(gate.read().state, "OPEN");
  });
  await scenario("a persisted write descriptor cannot be relabelled as a read lease", () => {
    const { store, firewall } = setup(); const v = request();
    const readGrant = store.grant(v);
    const writeGrant = store.grant({ action: "resume-stage", requestedBy: v.requestedBy, intent: v.intent, plan: v.plan, canonical: canonicalAyasExecutionRequest(v) });
    assert.equal(firewall.issue(raw, writeGrant.authorizationId).allowed, false); assert.equal(store.read(writeGrant.authorizationId).capabilityScope, undefined);
    assert.equal(store.read(readGrant.authorizationId).state, "granted");
  });
  await scenario("revoked original grant cannot attach scope", () => {
    const { store, firewall } = setup(); const grant = store.grant(request()); store.revoke(grant.authorizationId);
    assert.equal(firewall.issue(raw, grant.authorizationId).allowed, false); assert.equal(store.list().length, 1);
  });
  await scenario("expired original expiry is preserved, not renewed by scope binding", () => {
    const dir = fs.mkdtempSync(path.join(root, "expired-")); let clock = Date.now();
    const store = new AyasExecutionAuthorizationStore({ rootDir: dir, ttlMs: 1000, now: () => new Date(clock) }); const grant = store.grant(request()); clock += 1000;
    const firewall = createAyasActionFirewall({ repoRoot: dir, authorizations: store });
    assert.equal(firewall.issue(raw, grant.authorizationId).allowed, false); assert.equal(store.read(grant.authorizationId).state, "expired");
    assert.equal(store.read(grant.authorizationId).expiresAt, grant.expiresAt);
  });
  await scenario("an attached scope cannot be rebound to a new task/run after restart", () => {
    const { store, firewall, dir } = setup(); const grant = store.grant(request()); assert.equal(firewall.issue(raw, grant.authorizationId).allowed, true);
    const fresh = createAyasActionFirewall({ repoRoot: dir, authorizations: new AyasExecutionAuthorizationStore({ rootDir: dir }) });
    assert.equal(fresh.issue(raw, grant.authorizationId).allowed, false); assert.equal(store.read(grant.authorizationId).state, "granted");
  });
  await scenario("same run cannot attach two opaque handles to one legacy authorization", () => {
    const { store, firewall } = setup(); const grant = store.grant(request()); assert.equal(firewall.issue(raw, grant.authorizationId).allowed, true);
    assert.equal(firewall.issue(raw, grant.authorizationId).allowed, false); assert.equal(store.list().length, 1);
  });
  await scenario("binding lock refusal leaves the existing grant untouched and gate unstarted", async () => {
    const { store, gate, dir } = setup(); open(gate); const grant = store.grant(request()); let calls = 0;
    fs.writeFileSync(path.join(dir, "execution", "authorizations", grant.authorizationId + ".json.lock"), "fixture");
    const bridge = createAyasExecutionBridge({ gate, authorizations: store, resolveExecutor: () => async (admitted) => { calls++; return { action: admitted.action, write: false, summary: "fixture", data: {} }; } });
    assert.equal((await bridge.requestExecution({ rawRequest: raw, authorizationId: grant.authorizationId })).ok, false);
    assert.equal(calls, 0); assert.equal(store.read(grant.authorizationId).capabilityScope, undefined); assert.equal(gate.read().state, "OPEN");
  });
  await scenario("two fresh Node processes cannot attach/consume one legacy grant for different runs", async () => {
    const { store, dir } = setup(); const grant = store.grant(request());
    const authModule = path.resolve("src/lib/ayas/execution/AyasExecutionAuthorization.ts"), firewallModule = path.resolve("src/lib/ayas/execution/AyasActionFirewall.ts");
    // Both contenders finish their scope attachment before either consumes. A losing attachment holds the same
    // non-waiting record lock briefly: consuming during that refusal can legitimately refuse BOTH processes.
    // This barrier tests the single-use race without assuming lock scheduling fairness; the exact-one assertion stays.
    const code = `
      const io=require('node:fs'),p=require('node:path');
      const {AyasExecutionAuthorizationStore}=require(${JSON.stringify(authModule)});
      const {createAyasActionFirewall}=require(${JSON.stringify(firewallModule)});
      const dir=${JSON.stringify(dir)},store=new AyasExecutionAuthorizationStore({rootDir:dir});
      const guard=createAyasActionFirewall({repoRoot:dir,authorizations:store});
      (async()=>{
        const issued=guard.issue(${JSON.stringify(raw)},${JSON.stringify(grant.authorizationId)});
        io.writeFileSync(p.join(dir,'scope-ready-'+process.pid),'');
        const deadline=Date.now()+10000;
        while(io.readdirSync(dir).filter(n=>n.startsWith('scope-ready-')).length<2){
          if(Date.now()>deadline)throw Error('FIXTURE_SCOPE_BARRIER_TIMEOUT');
          await new Promise(resolve=>setTimeout(resolve,5));
        }
        const result=issued.allowed?guard.admit(issued.lease,${JSON.stringify(raw)}):issued;
        process.stdout.write(result.allowed?'ALLOWED':result.reason);
      })().catch(error=>{console.error(error);process.exitCode=1;});`;
    const run = () => new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, ["--require", "tsx/cjs", "-e", code], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      let output = "", error = ""; child.stdout.on("data", (b) => output += b); child.stderr.on("data", (b) => error += b);
      child.on("error", reject); child.on("exit", (status) => status === 0 ? resolve(output) : reject(new Error(error)));
    });
    const results = await Promise.all([run(), run()]); assert.equal(results.filter((r) => r === "ALLOWED").length, 1, JSON.stringify(results));
    assert.equal(store.list().length, 1); assert.equal(store.read(grant.authorizationId).state, "consumed");
  });
  console.log(`Stage 15D legacy read bridge firewall: PASS (${count} scenarios; one grant; TEMP/mock adapters; model/network/pipeline actions 0)`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => fs.rmSync(root, { recursive: true, force: true }));
