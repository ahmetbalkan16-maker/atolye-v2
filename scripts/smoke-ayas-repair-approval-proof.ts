import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createAyasGuidedRepairService, createAyasRepairProposal, revokeAyasRepairAuthorization, type AyasPatch, type AyasRepairAuthorization } from "../src/lib/ayas/execution/AyasGuidedRepair";
import { AYAS_CAPABILITY_MAX_TTL_MS } from "../src/lib/ayas/execution/AyasCapabilityScope";

const roots: string[] = [];
const temp = () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-repair-proof-")); roots.push(root); return root; };
const hash = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
let scenarios = 0;
async function scenario(name: string, fn: () => Promise<void> | void) { await fn(); scenarios++; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${name}`); }
const start = Date.parse("2026-10-01T10:00:00Z");
function fixture(options: { ttlMs?: number; validator?: () => Promise<unknown>; journal?: () => void } = {}) {
  const root = temp(), rel = "src/fixture.ts", file = path.join(root, rel), before = "export const value = 1;\n";
  fs.mkdirSync(path.dirname(file)); fs.writeFileSync(file, before); let clock = start;
  const service = createAyasGuidedRepairService({ workspaceRoot: root, workspaceId: "fixture", ttlMs: options.ttlMs, now: () => new Date(clock), journal: options.journal,
    validators: { "run-registered-smoke-test": options.validator ?? (async () => ({ ok: true })) } });
  const proposal = createAyasRepairProposal({ workspaceId: "fixture", issueFingerprint: hash("fixture"), rootCauseStatus: "reproduced", rootCause: "fixture", evidence: [], graphifyFindings: [],
    approvedFiles: [rel], operationClasses: ["patch-source"], validationActions: ["run-registered-smoke-test"], forbiddenOperations: ["shell", "git"], exclusions: [], expectedResult: "value two", risk: "low",
    bounds: { maxFiles: 1, maxNewFiles: 0, maxRepairCycles: 1, maxValidationCycles: 1, maxDurationMs: 30_000, allowFileCreation: false } });
  const patches: AyasPatch[] = [{ filePath: rel, operation: "patch-source", expectedHash: hash(before), content: "export const value = 2;\n" }];
  const approve = () => service.approve(proposal, { proposalId: proposal.proposalId, proposalFingerprint: proposal.proposalFingerprint, issueFingerprint: proposal.issueFingerprint, workspaceId: "fixture", approvedByUser: true, userTurnId: "owner-turn", currentTurnId: "owner-turn" });
  const deny = async (auth: AyasRepairAuthorization) => { const result = await service.apply(proposal, auth, patches); assert.equal(result.ok, false); assert.equal(fs.readFileSync(file, "utf8"), before); };
  return { root, rel, file, before, proposal, patches, service, approve, deny, clock: (t: number) => { clock = t; } };
}
async function main() {
  await scenario("original explicit receipt works once", async () => { const f = fixture(), a = f.approve(); assert.equal((await f.service.apply(f.proposal, a, f.patches)).ok, true); assert.equal((await f.service.apply(f.proposal, a, f.patches)).ok, false); });
  for (const [name, copy] of [
    ["JSON authority denied", (a: AyasRepairAuthorization) => JSON.parse(JSON.stringify(a)) as AyasRepairAuthorization],
    ["spread authority denied", (a: AyasRepairAuthorization) => ({ ...a })],
    ["prototype authority denied", (a: AyasRepairAuthorization) => Object.create(a) as AyasRepairAuthorization],
    ["model generated authorization ID denied", (a: AyasRepairAuthorization) => ({ ...a, authorizationId: "repair-authz-model-generated" })],
  ] as const) await scenario(name, async () => { const f = fixture(); await f.deny(copy(f.approve())); });
  await scenario("auth and scope arrays immutable", () => { const a = fixture().approve(); assert.ok(Object.isFrozen(a)); for (const list of [a.approvedFiles, a.operationClasses, a.validationActions, a.forbiddenOperations]) assert.ok(Object.isFrozen(list)); });
  await scenario("revocation invalidates ORIGINAL receipt", async () => { const f = fixture(), a = f.approve(); revokeAyasRepairAuthorization(a); await f.deny(a); });
  await scenario("status restoration cannot undo revoke", async () => { const f = fixture(), a = f.approve(); const revoked = f.service.revoke(a); await f.deny({ ...revoked, status: "approved" }); await f.deny(a); });
  await scenario("same physical workspace but different service task denied", async () => { const f = fixture(), a = f.approve(); const other = createAyasGuidedRepairService({ workspaceRoot: f.root, workspaceId: "fixture" }); assert.equal((await other.apply(f.proposal, a, f.patches)).ok, false); assert.equal(fs.readFileSync(f.file, "utf8"), f.before); });
  await scenario("same logical workspace ID cannot transfer root", async () => { const f = fixture(), other = fixture(); assert.equal((await other.service.apply(f.proposal, f.approve(), f.patches)).ok, false); assert.equal(fs.readFileSync(other.file, "utf8"), other.before); });
  await scenario("exact expiry boundary denies", async () => { const f = fixture(), a = f.approve(); f.clock(start + AYAS_CAPABILITY_MAX_TTL_MS); await f.deny(a); });
  await scenario("backwards and invalid clocks deny", async () => { const f = fixture(), a = f.approve(); f.clock(start - 1); await f.deny(a); f.clock(NaN); await f.deny(a); });
  await scenario("oversized/nonpositive/fractional/invalid TTL cannot approve", () => { for (const ttlMs of [AYAS_CAPABILITY_MAX_TTL_MS + 1, 0, -1, 1.5, NaN]) assert.throws(() => fixture({ ttlMs }).approve(), /time\/resource/); });
  await scenario("invalid authorization cannot invoke remediation callback", async () => { const f = fixture(); let calls = 0; const a = { ...f.approve() }; const r = await f.service.applyWithBoundedRemediation(f.proposal, a, f.patches, async () => { calls++; return f.patches; }); assert.equal(r.ok, false); assert.equal(calls, 0); });
  await scenario("fresh Node cannot recreate issuer proof from audit", () => { const f = fixture(), a = f.approve(); const code = `const {createAyasGuidedRepairService}=require('./src/lib/ayas/execution/AyasGuidedRepair');const [root,p,a,patch]=process.argv.slice(1);const service=createAyasGuidedRepairService({workspaceRoot:root,workspaceId:'fixture',now:()=>new Date('${new Date(start).toISOString()}')});service.apply(JSON.parse(p),JSON.parse(a),JSON.parse(patch)).then(r=>process.stdout.write(JSON.stringify(r.ok)));`; const result = execFileSync(process.execPath, ["--import", "tsx", "-e", code, f.root, JSON.stringify(f.proposal), JSON.stringify(a), JSON.stringify(f.patches)], { cwd: path.join(__dirname, ".."), encoding: "utf8", windowsHide: true, timeout: 20_000 }); assert.equal(JSON.parse(result), false); assert.equal(fs.readFileSync(f.file, "utf8"), f.before); });
  await scenario("junction scope is rejected before foreign read/write", async () => { const f = fixture(), a = f.approve(), outside = temp(); fs.mkdirSync(path.join(outside, "dir")); fs.writeFileSync(path.join(outside, "dir", "fixture.ts"), f.before); fs.renameSync(path.join(f.root, "src"), path.join(f.root, "saved-src")); fs.symlinkSync(path.join(outside, "dir"), path.join(f.root, "src"), process.platform === "win32" ? "junction" : "dir"); assert.equal((await f.service.apply(f.proposal, a, f.patches)).ok, false); assert.equal(fs.readFileSync(path.join(outside, "dir", "fixture.ts"), "utf8"), f.before); fs.unlinkSync(path.join(f.root, "src")); });
  await scenario("ADS/device-like repair path denied", () => { const f = fixture(); assert.throws(() => createAyasRepairProposal({ ...f.proposal, approvedFiles: ["src/fixture.ts:secret"] }), /path denied/); });
  await scenario("tool/caller patch mutation during async validation cannot break rollback", async () => { const f: ReturnType<typeof fixture> = fixture({ validator: async () => { Reflect.set(f.patches[0]!, "content", "tool changed patch"); Reflect.set(f.patches[0]!, "filePath", "src/elsewhere.ts"); throw new Error("fixture validation fails"); } }); assert.equal((await f.service.apply(f.proposal, f.approve(), f.patches)).ok, false); assert.equal(fs.readFileSync(f.file, "utf8"), f.before); });
  await scenario("revocation during validation prevents bounded remediation", async () => { const f = fixture({ validator: async () => { f.service.revoke(a); throw new Error("fixture failure"); } }); const a = f.approve(); let calls = 0; const r = await f.service.applyWithBoundedRemediation(f.proposal, a, f.patches, async () => { calls++; return f.patches; }); assert.equal(r.ok, false); assert.equal(fs.readFileSync(f.file, "utf8"), f.before); assert.equal(calls, 0); });
  console.log(`AYAS repair approval proof: PASS (${scenarios} scenarios; TEMP only)`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  for (const root of roots) { const resolved = path.resolve(root), rel = path.relative(os.tmpdir(), resolved); if (!rel.startsWith("..") && !path.isAbsolute(rel) && path.basename(resolved).startsWith("ayas-repair-proof-")) fs.rmSync(resolved, { recursive: true, force: true }); }
});
