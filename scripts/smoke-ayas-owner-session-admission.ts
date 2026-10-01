import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { AYAS_SESSION_COOKIE, AYAS_SESSION_TTL_SECONDS, issueSession, resolveAccessGate, verifySession } from "../src/lib/auth/accessGate";

// Execute the actual server-action guard, not a copied implementation. The VM supplies
// Next's cookie boundary and trusted env only; the real token verifier still runs.
const text = fs.readFileSync(path.join(__dirname, "../app/brain/actions.ts"), "utf8");
const source = ts.createSourceFile("actions.ts", text, ts.ScriptTarget.Latest, true);
const guard = source.statements.find((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === "requireBrainSession");
assert.ok(guard);
const code = ts.transpileModule(guard.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const key = "owner-session-smoke-key-long-enough";
let token: string | undefined;
let env: Record<string, string | undefined> = { AYAS_ACCESS_KEY: key, NODE_ENV: "production" };
let calls = 0;
const runGuard = vm.runInNewContext(`${code}\nrequireBrainSession`, {
  process: { get env() { return env; } }, resolveAccessGate, AYAS_SESSION_COOKIE,
  cookies: async () => ({ get: (name: string) => name === AYAS_SESSION_COOKIE && token !== undefined ? { value: token } : undefined }),
  verifySession: async (value: string | undefined, secret: string) => {
    await Promise.resolve(); // Validation cannot be treated as an immediate boolean.
    return verifySession(value, secret);
  },
}) as () => Promise<void>;
async function ownerAction() { await runGuard(); calls += 1; }
let scenarios = 0;
async function scenario(name: string, operation: () => Promise<void> | void) { await operation(); scenarios += 1; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${name}`); }
async function refused(value: string | undefined, error = "authentication_required") {
  token = value; const before = calls;
  await assert.rejects(ownerAction, new RegExp(error));
  assert.equal(calls, before, "denied session must not reach owner effect");
}
async function main() {
  await scenario("missing session cannot approve", () => refused(undefined));
  await scenario("malformed session cannot approve", () => refused("owner-approved:allow"));
  await scenario("wrong signer cannot approve", async () => refused(await issueSession("another-long-owner-session-key")));
  await scenario("expired session cannot approve", async () => refused(await issueSession(key, Date.now() - (AYAS_SESSION_TTL_SECONDS + 10) * 1000)));
  await scenario("future session cannot approve", async () => refused(await issueSession(key, Date.now() + 120_000)));
  await scenario("tampered signature cannot approve", async () => refused(`${await issueSession(key)}x`));
  await scenario("valid session waits for verification", async () => {
    token = await issueSession(key); const before = calls; const pending = ownerAction();
    assert.equal(calls, before); await pending; assert.equal(calls, before + 1);
  });
  await scenario("production missing key fails closed", async () => { env = { NODE_ENV: "production" }; await refused(token, "brain_report_decision_unavailable"); });
  await scenario("short configured key fails closed", async () => { env = { AYAS_ACCESS_KEY: "short", NODE_ENV: "development" }; await refused(token, "brain_report_decision_unavailable"); });
  await scenario("existing explicit local-dev policy preserved", async () => { env = { NODE_ENV: "development" }; token = undefined; const before = calls; await ownerAction(); assert.equal(calls, before + 1); });
  await scenario("owner actions await guard before processing input", () => {
    const names = ["decideAyasApproval", "executeAyasApprovedProposal", "batchOnaylaVeUygula", "proposalOnaylaVeUygula", "ayasOwnerApprovalDecision", "recordSelfHealDecision", "scheduleAyasGoalResearchAction", "createAndScheduleAyasGoalResearchAction", "controlAyasGoalResearchAction"];
    for (const name of names) {
      const fn = source.statements.find((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === name);
      assert.ok(fn?.body, `missing real owner action ${name}`);
      const first = fn.body.statements[0];
      assert.ok(ts.isExpressionStatement(first) && ts.isAwaitExpression(first.expression) && ts.isCallExpression(first.expression.expression));
      assert.equal(first.expression.expression.expression.getText(source), "requireBrainSession");
    }
  });
  console.log(`AYAS owner session admission smoke: PASS (${scenarios} scenarios)`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
