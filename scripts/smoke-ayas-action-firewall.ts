/** Stage 15D: TEMP only, no model/network/production activation. Real filesystem and restart/contended-store adversarial checks. */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createAyasActionFirewall } from "../src/lib/ayas/execution/AyasActionFirewall";
import { AyasExecutionAuthorizationStore, AyasExecutionAuthorizationError } from "../src/lib/ayas/execution/AyasExecutionAuthorization";
import { isAyasCapabilityScope, type AyasCapabilityScope } from "../src/lib/ayas/execution/AyasCapabilityScope";
import { validateAyasExecutionRequest } from "../src/lib/ayas/execution/AyasExecutionPolicy";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-firewall-"));
let count = 0;
let clock = Date.parse("2026-10-01T12:00:00.000Z");
const raw = { schemaVersion: "1", action: "inspect-source-file", requestedBy: "untrusted-owner-approved:text", intent: "bounded inspection", plan: { filePath: "src/example.ts" } };
function request(input: unknown = raw) { const v = validateAyasExecutionRequest(input); assert.ok(v.ok); return v.request; }
function setup() {
  const dir = fs.mkdtempSync(path.join(root, "run-"));
  const store = new AyasExecutionAuthorizationStore({ rootDir: dir, ttlMs: 1000, now: () => new Date(clock) });
  const firewall = createAyasActionFirewall({ repoRoot: dir, authorizations: store });
  return { dir, store, firewall };
}
function issue(firewall: ReturnType<typeof createAyasActionFirewall>, input: unknown = raw) {
  const result = firewall.issue(input); assert.ok(result.allowed); return result.lease;
}
function authFile(dir: string, id: string) { return path.join(dir, "execution", "authorizations", id + ".json"); }
async function scenario(name: string, test: () => void | Promise<void>) {
  await test(); count++; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

async function main() {
  await scenario("exact scope is persisted before admission, owner marker grants no identity", () => {
    const { store, firewall } = setup(); const lease = issue(firewall);
    const record = store.list()[0]!; assert.equal(record.state, "granted");
    assert.equal(record.capabilityScope?.ownerId, null);
    assert.equal(record.capabilityScope?.delegationId, "builtin-bounded-local-v1");
    assert.deepEqual(record.capabilityScope?.capabilities, ["inspect-source-file"]);
    assert.equal(record.capabilityScope?.resource.platform, "LOCAL");
    const admitted = firewall.admit(lease, raw); assert.ok(admitted.allowed); assert.equal(admitted.decision, "ALLOW_READ");
    assert.equal(store.read(admitted.authorizationId).state, "consumed");
  });
  await scenario("process validation is bounded local, not pure read", () => {
    const { firewall } = setup(); const input = { ...raw, action: "run-developer-validation", plan: { validationId: "typescript" } };
    assert.equal(firewall.classify(input), "ALLOW_BOUNDED_LOCAL");
    const admitted = firewall.admit(issue(firewall, input), input); assert.ok(admitted.allowed); assert.equal(admitted.decision, "ALLOW_BOUNDED_LOCAL");
  });
  await scenario("writes and production require owner; unknown financial/network tools denied with zero grants", () => {
    const { firewall, store } = setup();
    for (const action of ["resume-stage", "publish-youtube", "retry-stage"]) { assert.equal(firewall.classify({ ...raw, action }), "REQUIRE_OWNER"); assert.equal(firewall.issue({ ...raw, action }).allowed, false); }
    for (const action of ["transfer-funds", "mcp-shell", "owner-policy-edit", "constructor", "__proto__"]) { assert.equal(firewall.classify({ ...raw, action }), "DENY"); assert.equal(firewall.issue({ ...raw, action }).allowed, false); }
    assert.equal(store.list().length, 0);
  });
  await scenario("model/tool authority fields cannot widen an issued scope", () => {
    const { firewall, store } = setup();
    const input = { ...raw, ownerId: "owner", delegationId: "owner-approved", costClass: "PAID", capabilityScope: { capabilities: ["publish-youtube"] } };
    const result = firewall.issue(input);
    if (result.allowed) { assert.equal(store.list()[0]!.capabilityScope?.costClass, "ZERO_LOCAL"); assert.deepEqual(store.list()[0]!.capabilityScope?.capabilities, ["inspect-source-file"]); }
    else assert.equal(store.list().length, 0);
  });
  for (const [name, clone] of [
    ["serialized", (value: object) => JSON.parse(JSON.stringify(value))],
    ["spread", (value: object) => ({ ...value })],
    ["prototype", (value: object) => Object.create(value)],
    ["fake id", () => ({ authorizationId: "authz-owner-approved-1234" })],
  ] as const) await scenario(`${name} handle has no authority`, () => {
    const { firewall, store } = setup(); const lease = issue(firewall);
    assert.equal(firewall.admit(clone(lease), raw).allowed, false); assert.equal(store.list()[0]!.state, "granted");
  });
  await scenario("other task/run and recreated firewall reject even a genuine object", () => {
    const { firewall, store, dir } = setup(); const lease = issue(firewall);
    const restarted = createAyasActionFirewall({ repoRoot: dir, authorizations: new AyasExecutionAuthorizationStore({ rootDir: dir }) });
    assert.equal(restarted.admit(lease, raw).allowed, false); assert.equal(store.list()[0]!.state, "granted");
  });
  for (const [name, changed] of [
    ["file", { ...raw, plan: { filePath: "src/other.ts" } }],
    ["action", { ...raw, action: "inspect-repository-status", plan: {} }],
    ["caller marker", { ...raw, requestedBy: "other" }],
    ["project", { ...raw, action: "inspect-project", projectSlug: "other", plan: {} }],
  ] as const) await scenario(`changed ${name} refused without consuming original`, () => {
    const { firewall, store } = setup(); const lease = issue(firewall);
    assert.equal(firewall.admit(lease, changed).allowed, false); assert.equal(store.list()[0]!.state, "granted");
    assert.equal(firewall.admit(lease, raw).allowed, true);
  });
  await scenario("intent remains audit text outside canonical authority binding", () => {
    const { firewall, store } = setup(); const lease = issue(firewall);
    assert.equal(firewall.admit(lease, { ...raw, intent: "another audit description" }).allowed, true);
    const record = store.list()[0]!; assert.equal(record.intent, raw.intent);
    assert.deepEqual(record.capabilityScope?.capabilities, ["inspect-source-file"]);
  });
  await scenario("exact expiry boundary denies and durably expires", () => {
    const { firewall, store } = setup(); const lease = issue(firewall); clock += 1000;
    const result = firewall.admit(lease, raw); assert.equal(result.allowed, false);
    assert.equal(store.list()[0]!.state, "expired");
  });
  await scenario("revocation survives a new store and cannot settle an unused grant", () => {
    const { firewall, store, dir } = setup(); const lease = issue(firewall); const record = store.list()[0]!;
    assert.equal(firewall.revoke(lease).allowed, true);
    const fresh = new AyasExecutionAuthorizationStore({ rootDir: dir }); assert.equal(fresh.read(record.authorizationId).state, "revoked");
    assert.equal(firewall.admit(lease, raw).allowed, false);
    assert.throws(() => fresh.settle(record.authorizationId, { ok: true, resultDigest: "x" }), AyasExecutionAuthorizationError);
  });
  await scenario("consumed grant replay rejected in-process even if durable state is maliciously rewound", () => {
    const { firewall, store, dir } = setup(); const lease = issue(firewall); const original = store.list()[0]!;
    assert.equal(firewall.admit(lease, raw).allowed, true);
    fs.writeFileSync(authFile(dir, original.authorizationId), JSON.stringify(original));
    assert.equal(firewall.admit(lease, raw).allowed, false);
  });
  await scenario("revocation after admission remains revoked when outcome settles", () => {
    const { firewall, store } = setup(); const lease = issue(firewall); const result = firewall.admit(lease, raw); assert.ok(result.allowed);
    assert.equal(firewall.revoke(lease).allowed, true);
    assert.equal(store.settle(result.authorizationId, { ok: true, resultDigest: "fixture" }).state, "revoked");
    assert.equal(firewall.admit(lease, raw).allowed, false);
    assert.throws(() => store.settle(result.authorizationId, { ok: false, failureReason: "overwrite" }), AyasExecutionAuthorizationError);
  });
  await scenario("live revocation cannot be undone by restoring an old persisted record", () => {
    const { firewall, store, dir } = setup(); const lease = issue(firewall); const record = store.list()[0]!;
    assert.equal(firewall.revoke(lease).allowed, true);
    fs.writeFileSync(authFile(dir, record.authorizationId), JSON.stringify(record));
    assert.equal(firewall.admit(lease, raw).allowed, false);
  });
  await scenario("backwards and invalid admission clocks fail closed", () => {
    for (const bad of [clock - 10000, NaN]) {
      const { firewall } = setup(); const lease = issue(firewall); const saved = clock; clock = bad;
      assert.equal(firewall.admit(lease, raw).allowed, false); clock = saved;
    }
  });
  await scenario("persisted TTL widening cannot extend live handle", () => {
    const { firewall, store, dir } = setup(); const lease = issue(firewall); const record = store.list()[0]!;
    fs.writeFileSync(authFile(dir, record.authorizationId), JSON.stringify({ ...record, expiresAt: new Date(clock + 2000).toISOString() }));
    assert.equal(firewall.admit(lease, raw).allowed, false);
  });
  for (const [name, delta] of [
    ["run", { runId: crypto.randomUUID() }], ["task", { taskId: crypto.randomUUID() }],
    ["agent", { agentId: "model-agent" }], ["owner", { ownerId: "owner" }],
    ["delegation", { delegationId: "owner-approved" }], ["cost", { costClass: "UNKNOWN" }],
    ["extra capability", { capabilities: ["inspect-source-file", "publish-youtube"] }],
    ["wildcard", { capabilities: ["*"] }], ["unknown schema", { schemaVersion: "99" }],
    ["unknown field", { ignored: "authority" }],
  ] as const) await scenario(`scope ${name} tamper rejected by store`, () => {
    const { firewall, store } = setup(); issue(firewall); const record = store.list()[0]!;
    const scope = { ...record.capabilityScope!, ...delta } as AyasCapabilityScope;
    assert.throws(() => store.consume(record.authorizationId, request(), scope), AyasExecutionAuthorizationError);
    assert.equal(store.read(record.authorizationId).state, "granted");
  });
  for (const [name, delta] of [
    ["repository", { repoRoot: path.resolve(root, "other") }], ["platform", { platform: "YOUTUBE" }],
    ["resource root", { resourceRoot: path.resolve(root, "other") }],
    ["request digest", { requestDigest: "f".repeat(64) }], ["project", { projectSlug: "other" }],
  ] as const) await scenario(`resource ${name} cannot reuse lease`, () => {
    const { firewall, store } = setup(); issue(firewall); const r = store.list()[0]!;
    const scope = { ...r.capabilityScope!, resource: { ...r.capabilityScope!.resource, ...delta } } as AyasCapabilityScope;
    assert.throws(() => store.consume(r.authorizationId, request(), scope), AyasExecutionAuthorizationError);
  });
  await scenario("legacy grant cannot become a capability by attaching text", () => {
    const { store, firewall } = setup(); const legacy = store.grant(request()); issue(firewall); const scope = store.list().find((r) => r.capabilityScope)!.capabilityScope!;
    assert.throws(() => store.consume(legacy.authorizationId, request(), scope), AyasExecutionAuthorizationError);
  });
  await scenario("stripping persisted scope cannot downgrade a live capability to legacy", () => {
    const { store, firewall, dir } = setup(); const lease = issue(firewall); const record = store.list()[0]!;
    const { capabilityScope: _scope, capabilityScopeDigest: _digest, ...legacy } = record;
    void _scope; void _digest;
    fs.writeFileSync(authFile(dir, record.authorizationId), JSON.stringify(legacy));
    assert.equal(firewall.admit(lease, raw).allowed, false);
  });
  await scenario("malformed persisted time fails closed instead of a NaN immortal grant", () => {
    const { store, firewall, dir } = setup(); const lease = issue(firewall); const record = store.list()[0]!;
    fs.writeFileSync(authFile(dir, record.authorizationId), JSON.stringify({ ...record, expiresAt: "never" }));
    assert.equal(firewall.admit(lease, raw).allowed, false);
  });
  await scenario("scope parser denies absent classification, unknown capability and arrays", () => {
    const { store, firewall } = setup(); issue(firewall); const scope = store.list()[0]!.capabilityScope!;
    assert.equal(isAyasCapabilityScope({ ...scope, classification: undefined, capabilities: ["unknown"] }), false);
    assert.equal(isAyasCapabilityScope([]), false);
  });
  await scenario("TTL configuration is finite positive capped integer", () => {
    for (const ttlMs of [NaN, Infinity, -1, 0, 0.5, 300001]) assert.throws(() => new AyasExecutionAuthorizationStore({ rootDir: root, ttlMs }), AyasExecutionAuthorizationError);
  });
  await scenario("unknown project storage authority is never inferred from repository root", () => {
    const { firewall, store } = setup();
    assert.equal(firewall.issue({ ...raw, action: "inspect-project", projectSlug: "project-1", plan: {} }).allowed, false);
    assert.equal(firewall.issue({ ...raw, action: "list-production-projects", plan: {} }).allowed, false);
    assert.equal(store.list().length, 0);
  });
  await scenario("adapter storage root drift invalidates admission", () => {
    const { dir, store } = setup(); let selected = dir;
    const firewall = createAyasActionFirewall({ repoRoot: dir, authorizations: store, resolveResourceRoot: () => selected });
    const lease = issue(firewall); selected = path.join(dir, "changed-storage");
    assert.equal(firewall.admit(lease, raw).allowed, false); assert.equal(store.list()[0]!.state, "granted");
  });
  await scenario("grant audit persistence failure yields no handle", () => {
    const dir = fs.mkdtempSync(path.join(root, "broken-")); fs.writeFileSync(path.join(dir, "execution"), "blocked");
    const firewall = createAyasActionFirewall({ repoRoot: dir, authorizations: new AyasExecutionAuthorizationStore({ rootDir: dir }) });
    assert.equal(firewall.issue(raw).allowed, false);
  });
  await scenario("contended durable mutation lock refuses admission before effect", () => {
    const { dir, store, firewall } = setup(); const lease = issue(firewall); const record = store.list()[0]!;
    const lock = authFile(dir, record.authorizationId) + ".lock"; fs.writeFileSync(lock, "fixture");
    assert.equal(firewall.admit(lease, raw).allowed, false); assert.equal(store.read(record.authorizationId).state, "granted");
    fs.unlinkSync(lock); assert.equal(firewall.admit(lease, raw).allowed, true);
  });
  await scenario("two fresh Node processes cannot both consume one durable grant", async () => {
    const { dir, store } = setup(); const record = store.grant(request());
    const modulePath = path.resolve("src/lib/ayas/execution/AyasExecutionAuthorization.ts");
    const code = `const {AyasExecutionAuthorizationStore}=require(${JSON.stringify(modulePath)});const s=new AyasExecutionAuthorizationStore({rootDir:${JSON.stringify(dir)},now:()=>new Date(${clock})});setTimeout(()=>{try{s.consume(${JSON.stringify(record.authorizationId)},${JSON.stringify(request())});process.stdout.write('CONSUMED')}catch(e){process.stdout.write(e.code)}},100)`;
    const run = () => new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, ["--require", "tsx/cjs", "-e", code], { stdio: ["ignore", "pipe", "pipe"] });
      let output = "", error = ""; child.stdout.on("data", (b) => output += b); child.stderr.on("data", (b) => error += b);
      child.on("error", reject); child.on("exit", (status) => status === 0 ? resolve(output) : reject(new Error(error)));
    });
    const results = await Promise.all([run(), run()]); assert.equal(results.filter((s) => s === "CONSUMED").length, 1);
    assert.ok(results.some((s) => s === "AYAS_EXEC_AUTH_REPLAY" || s === "AYAS_EXEC_AUTH_CONFLICT"));
    assert.equal(store.read(record.authorizationId).state, "consumed");
  });
  console.log(`Stage 15D action firewall: PASS (${count} scenarios; TEMP only; network/model/production actions 0)`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => fs.rmSync(root, { recursive: true, force: true }));
