/** TEMP policies and synthetic owner sessions only; never activates the host policy. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { createHash, createPrivateKey, sign } from "node:crypto";
import { activateAyasOwnerConstitution } from "../src/lib/ayas/governance/AyasOwnerConstitutionStore";
import { readAyasOwnerConstitution, bindAyasConstitutionRun, constitutionPhysicalRoot, constitutionRootPath, constitutionSignatureBytes } from "../src/lib/ayas/governance/AyasOwnerConstitutionReader";
import { constitutionDigest, isAyasOwnerConstitution, proposeAyasOwnerConstitution } from "../src/lib/ayas/governance/AyasOwnerConstitution";
import { issueSession, verifySession, resolveAccessGate, AYAS_SESSION_COOKIE, AYAS_SESSION_TTL_SECONDS } from "../src/lib/auth/accessGate";
import { emitSmokeResult } from "./lib/SmokeResult";

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-constitution-smoke-"));
const key = "synthetic-owner-key-constitution-123"; const env = { NODE_ENV: "test", AYAS_ACCESS_KEY: key }; const now = Date.now();
let count = 0, rootCounter = 0;
const fresh = () => { const root = path.join(temp, `repo-${++rootCounter}`); fs.mkdirSync(root); return root; };
async function scenario(name: string, run: () => Promise<void> | void) { await run(); count++; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }
async function main() {
  const session = await issueSession(key, now);
  const activate = (repoRoot: string, policy: unknown = proposeAyasOwnerConstitution(), expectedPreviousDigest: string | null = null, ownerSession: string | null = session) =>
    activateAyasOwnerConstitution({ repoRoot, policy, expectedPreviousDigest, ownerSession: ownerSession ?? undefined, env, nowMs: () => now });
  try {
    await scenario("missing is unadopted and proposals have no activation effect", () => {
      const root = fresh(); const proposal = proposeAyasOwnerConstitution(); assert.ok(isAyasOwnerConstitution(proposal));
      assert.equal(readAyasOwnerConstitution(root).state, "MISSING"); assert.equal(bindAyasConstitutionRun(root, "TOOL", "test").evidence.constitutionDigest, null);
      assert.ok(Object.isFrozen(proposal.rules.protectedPaths)); assert.deepEqual(fs.readdirSync(root), []);
    });
    await scenario("all eleven non-negotiable rule categories and required paths refuse weakening", () => {
      const proposal = proposeAyasOwnerConstitution();
      for (const [field, value] of Object.entries({ approval: "MODEL_APPROVAL", autonomousSpendUsd: 1, publishing: "AUTO", production: "AUTO", protectedPaths: [], privacy: "ANY", zeroCostDefault: false,
        graphifyFirst: false, silentCloudFallback: true, selfApproval: true, selfPromotion: true, localRuntime: "ALWAYS_ON", maxRamAdmissionPercent: 100 })) {
        assert.equal(isAyasOwnerConstitution({ ...proposal, rules: { ...proposal.rules, [field]: value } }), false, field);
      }
      for (const extra of [{ ownerApproved: true }, { execute: true }]) assert.equal(isAyasOwnerConstitution({ ...proposal, ...extra }), false);
      assert.equal(isAyasOwnerConstitution({ ...proposal, rules: { ...proposal.rules, protectedPaths: [...proposal.rules.protectedPaths, "../private"] } }), false);
      assert.equal(isAyasOwnerConstitution({ ...proposal, rules: { ...proposal.rules, protectedPaths: proposal.rules.protectedPaths.map((p) => p === ".git" ? "safe-extra" : p) } }), false);
      assert.equal(isAyasOwnerConstitution({ ...proposal, rules: { ...proposal.rules, maxRamAdmissionPercent: 85 } }), true, "RAM threshold is owner-configurable; current default stays90");
    });
    await scenario("missing, forged, wrong-signer and expired owner sessions cause no filesystem effects", async () => {
      for (const token of [null, "owner-approved:true", await issueSession("different-synthetic-owner-key", now), await issueSession(key, now - (AYAS_SESSION_TTL_SECONDS + 10) * 1000)]) {
        const root = fresh(); await assert.rejects(activate(root, proposeAyasOwnerConstitution(), null, token), /OWNER_SESSION_REQUIRED/); assert.deepEqual(fs.readdirSync(root), []);
      }
    });
    await scenario("development bypass never activates constitution", async () => {
      for (const unconfigured of [{ NODE_ENV: "development" }, { NODE_ENV: "production" }, { NODE_ENV: "development", AYAS_ACCESS_KEY: "short" }]) {
        const root = fresh(); await assert.rejects(activateAyasOwnerConstitution({ repoRoot: root, policy: proposeAyasOwnerConstitution(), expectedPreviousDigest: null, ownerSession: session, env: unconfigured }), /OWNER_SESSION_REQUIRED/); assert.deepEqual(fs.readdirSync(root), []);
      }
    });
    const root = fresh(), policy = proposeAyasOwnerConstitution();
    await scenario("real session atomically publishes signed bootstrap and public reader verifies it", async () => {
      const adopted = await activate(root); const state = readAyasOwnerConstitution(root);
      assert.equal(state.state, "ACTIVE"); assert.equal(adopted.digest, constitutionDigest(policy)); if (state.state !== "ACTIVE") throw new Error("Missing active state");
      assert.equal(state.policy.rules.autonomousSpendUsd, 0); assert.equal(state.digest, adopted.digest); assert.ok(Object.isFrozen(state.policy.rules));
      const folder = constitutionRootPath(root); assert.deepEqual(fs.readdirSync(folder).sort(), ["1.json", "root.json"]);
      const bytes = fs.readdirSync(folder).map((name) => fs.readFileSync(path.join(folder, name), "utf8")).join("");
      assert.ok(!bytes.includes(key) && !bytes.includes(session)); assert.ok(!/privateKey|ownerSession|cookie/.test(bytes));
    });
    const firstDigest = constitutionDigest(policy); const before = fs.readFileSync(path.join(constitutionRootPath(root), "1.json"));
    const binding = bindAyasConstitutionRun(root, "SELF_EVOLUTION", "run-1");
    await scenario("all run domains bind current digest; binding is not execution authority", () => {
      for (const domain of ["AGENT", "TOOL", "REVENUE", "SELF_EVOLUTION"] as const) {
        const b = bindAyasConstitutionRun(root, domain, `run-${domain}`); assert.equal(b.evidence.constitutionDigest, firstDigest); assert.equal(b.evidence.authority, "NONE"); assert.equal(b.refusal(), undefined);
      } assert.throws(() => bindAyasConstitutionRun(root, "TOOL", "../bad"));
    });
    await scenario("replay and stale previous digest cannot overwrite or append", async () => {
      await assert.rejects(activate(root)); await assert.rejects(activate(root, proposeAyasOwnerConstitution(2, "f".repeat(64)), "f".repeat(64)));
      await assert.rejects(activate(root, proposeAyasOwnerConstitution(3, firstDigest), firstDigest));
      assert.equal(fs.existsSync(path.join(constitutionRootPath(root), "3.json")), false, "rejected version must not be durably appended");
      assert.deepEqual(fs.readFileSync(path.join(constitutionRootPath(root), "1.json")), before); assert.equal(fs.existsSync(path.join(constitutionRootPath(root), "2.json")), false);
    });
    await scenario("two owner requests for same previous revision append exactly once", async () => {
      const proposal = proposeAyasOwnerConstitution(2, firstDigest); const result = await Promise.allSettled([activate(root, proposal, firstDigest), activate(root, proposal, firstDigest)]);
      assert.equal(result.filter((r) => r.status === "fulfilled").length, 1); assert.equal(result.filter((r) => r.status === "rejected").length, 1);
      assert.equal(readAyasOwnerConstitution(root).state, "ACTIVE"); assert.deepEqual(fs.readFileSync(path.join(constitutionRootPath(root), "1.json")), before);
      assert.equal(binding.refusal(), "AYAS_CONSTITUTION_CHANGED");
    });
    await scenario("old unadopted run refuses new dispatch after adoption", async () => {
      const root = fresh(), b = bindAyasConstitutionRun(root, "AGENT", "legacy"); assert.equal(b.refusal(), undefined); await activate(root); assert.equal(b.refusal(), "AYAS_CONSTITUTION_UNAVAILABLE");
    });
    await scenario("tampered policy, digest and signature refuse active state and run dispatch", async () => {
      for (const change of [(r: Record<string, unknown>) => r.signature = "f".repeat(128), (r: Record<string, unknown>) => r.policyDigest = "f".repeat(64),
        (r: Record<string, unknown>) => r.approvedAt = "2026-01-01T00:00:00Z"]) {
        const root = fresh(); await activate(root); const b = bindAyasConstitutionRun(root, "TOOL", "run"); const file = path.join(constitutionRootPath(root), "1.json"), record = JSON.parse(fs.readFileSync(file, "utf8"));
        change(record); fs.writeFileSync(file, JSON.stringify(record)); assert.equal(readAyasOwnerConstitution(root).state, "UNAVAILABLE"); assert.equal(b.refusal(), "AYAS_CONSTITUTION_UNAVAILABLE"); await assert.rejects(activate(root));
      }
    });
    await scenario("deleted/missing version chain and unknown inventory never become active or bootstrap", async () => {
      const root = fresh(); await activate(root); fs.unlinkSync(path.join(constitutionRootPath(root), "1.json")); assert.equal(readAyasOwnerConstitution(root).state, "UNAVAILABLE"); await assert.rejects(activate(root));
      fs.writeFileSync(path.join(constitutionRootPath(root), "unexpected.json"), "{}"); assert.equal(readAyasOwnerConstitution(root).state, "UNAVAILABLE");
    });
    await scenario("valid signature alone cannot bless invalid digest or a skipped version; root metadata is bound", async () => {
      const fixturePrivateKey = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), createHash("sha256").update("AYAS_OWNER_CONSTITUTION_SIGNER_V1\n").update(key).digest()]), format: "der", type: "pkcs8" });
      for (const kind of ["bad-digest", "skipped-version", "bad-root"] as const) {
        const r = fresh(); const first = await activate(r); await activate(r, proposeAyasOwnerConstitution(2, first.digest), first.digest); const folder = constitutionRootPath(r);
        if (kind === "bad-root") {
          const file = path.join(folder, "root.json"), anchor = JSON.parse(fs.readFileSync(file, "utf8")); anchor.repositoryRootDigest = "f".repeat(64); fs.writeFileSync(file, JSON.stringify(anchor));
        } else {
          const file = path.join(folder, "2.json"), record = JSON.parse(fs.readFileSync(file, "utf8"));
          if (kind === "bad-digest") record.policyDigest = "f".repeat(64);
          else { record.policy.version = 3; record.policyDigest = constitutionDigest(record.policy); }
          const { signature: ignored, ...body } = record; void ignored; record.signature = sign(null, constitutionSignatureBytes(body), fixturePrivateKey).toString("hex");
          fs.writeFileSync(file, JSON.stringify(record)); if (kind === "skipped-version") fs.renameSync(file, path.join(folder, "3.json"));
        }
        assert.equal(readAyasOwnerConstitution(r).state, "UNAVAILABLE", kind);
      }
    });
    await scenario("cross-root copied signed record is refused", async () => {
      const other = fresh(); fs.mkdirSync(path.join(other, "data", "brain"), { recursive: true }); fs.cpSync(constitutionRootPath(root), constitutionRootPath(other), { recursive: true });
      assert.equal(readAyasOwnerConstitution(other).state, "UNAVAILABLE");
    });
    await scenario("another spelling of the same repository reads, binds and appends the same constitution", async () => {
      const r = fresh(), first = await activate(r);
      // Windows gives a child its caller's spelling of the working directory; a case-sensitive host has no second spelling of one directory.
      const spellings = process.platform === "win32" ? [r.replace(/[a-z]/g, (c) => c.toUpperCase()), r.replace(/[A-Z]/g, (c) => c.toLowerCase()), r[0]!.toLowerCase() + r.slice(1)] : [path.join(r, "data", "..")];
      for (const spelled of spellings) {
        const state = readAyasOwnerConstitution(spelled); assert.equal(state.state, "ACTIVE", spelled); if (state.state !== "ACTIVE") throw new Error("Missing active state");
        assert.equal(state.digest, first.digest); const b = bindAyasConstitutionRun(spelled, "TOOL", "spelled"); assert.equal(b.evidence.constitutionDigest, first.digest); assert.equal(b.refusal(), undefined);
      }
      const second = await activate(spellings[0]!, proposeAyasOwnerConstitution(2, first.digest), first.digest); const current = readAyasOwnerConstitution(r);
      assert.equal(current.state, "ACTIVE"); if (current.state !== "ACTIVE") throw new Error("Missing active state"); assert.equal(current.digest, second.digest); assert.equal(current.policy.version, 2);
    });
    await scenario("adoption state is ignored local runtime state, so adopting cannot dirty the repository", () => {
      const ignored = new Set(fs.readFileSync(path.join(__dirname, "../.gitignore"), "utf8").split(/\r?\n/));
      for (const rule of ["/data/brain/owner-constitution/", "/data/brain/.owner-constitution-authority/", "/data/brain/.owner-constitution-staging-*/"]) assert.ok(ignored.has(rule), rule);
      // The rules name what the writer really creates: everything beside the tracked README is one of the three.
      const created = fs.readdirSync(path.join(root, "data", "brain")); assert.ok(created.includes("owner-constitution") && created.includes(".owner-constitution-authority"));
      assert.deepEqual(created.filter((name) => name !== "owner-constitution" && name !== ".owner-constitution-authority" && !name.startsWith(".owner-constitution-staging-")), []);
    });
    await scenario("changed owner key needs explicit rebind, never silently replaces trust root", async () => {
      const token = await issueSession("new-synthetic-owner-key-123", now); const current = readAyasOwnerConstitution(root); assert.equal(current.state, "ACTIVE"); if (current.state !== "ACTIVE") return;
      await assert.rejects(activateAyasOwnerConstitution({ repoRoot: root, policy: proposeAyasOwnerConstitution(3, current.digest), expectedPreviousDigest: current.digest,
        ownerSession: token, env: { NODE_ENV: "test", AYAS_ACCESS_KEY: "new-synthetic-owner-key-123" }, nowMs: () => now }), /OWNER_REBIND_REQUIRED/);
      assert.equal(readAyasOwnerConstitution(root).state, "ACTIVE");
    });
    await scenario("bootstrap promotion failure leaves no active partial anchor or policy", async () => {
      const root = fresh(), rename = fs.renameSync;
      Reflect.set(fs, "renameSync", (...args: unknown[]) => { if (args[1] === constitutionRootPath(constitutionPhysicalRoot(root))) throw new Error("injected bootstrap refusal"); return Reflect.apply(rename, fs, args); });
      try { await assert.rejects(activate(root), /bootstrap refusal/); } finally { Reflect.set(fs, "renameSync", rename); }
      assert.equal(readAyasOwnerConstitution(root).state, "MISSING"); assert.ok(!fs.readdirSync(path.join(root, "data", "brain")).some((name) => name.startsWith(".owner-constitution-staging-")));
    });
    await scenario("actual owner server action authenticates cookies before input and binds exact review digest", async () => {
      const text = fs.readFileSync(path.join(__dirname, "../app/brain/constitution/actions.ts"), "utf8");
      const ast = ts.createSourceFile("constitution/actions.ts", text, ts.ScriptTarget.Latest, true);
      const fn = ast.statements.find((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === "adoptAyasOwnerConstitution"); assert.ok(fn);
      const code = ts.transpileModule(fn.getText(ast).replace(/^export /, ""), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
      const sessionState: { cookie?: string } = {}; let writes = 0;
      const action = vm.runInNewContext(code + "\nadoptAyasOwnerConstitution", { process: { env, cwd: () => temp }, AYAS_SESSION_COOKIE, resolveAccessGate, verifySession, proposeAyasOwnerConstitution, constitutionDigest,
        cookies: async () => ({ get: () => sessionState.cookie ? { value: sessionState.cookie } : undefined }), activateAyasOwnerConstitution: async (input: Record<string, unknown>) => { assert.equal(input.ownerSession, session); writes++; }, redirect: (url: string) => assert.equal(url, "/brain/constitution") }) as (form: FormData) => Promise<void>;
      const poison = { get: () => { throw new Error("input read before authentication"); }, keys: () => ["ownerApproved"] } as unknown as FormData;
      await assert.rejects(action(poison), /OWNER_SESSION_REQUIRED/); assert.equal(writes, 0);
      sessionState.cookie = session; const form = new FormData(); form.set("proposalDigest", constitutionDigest(proposeAyasOwnerConstitution()));
      form.set("ownerSession", "forged"); await assert.rejects(action(form), /REVIEW_BINDING_REQUIRED/); assert.equal(writes, 0); form.delete("ownerSession");
      form.set("proposalDigest", "f".repeat(64)); await assert.rejects(action(form), /REVIEW_BINDING_REQUIRED/); assert.equal(writes, 0);
      form.set("proposalDigest", constitutionDigest(proposeAyasOwnerConstitution())); await action(form); assert.equal(writes, 1);
    });
    emitSmokeResult("ayas-owner-constitution", count);
  } finally { assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir())); assert.ok(path.basename(temp).startsWith("ayas-constitution-smoke-")); fs.rmSync(temp, { recursive: true, force: true }); }
}
main().catch((e: unknown) => { console.error(e); process.exitCode = 1; });
