import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { issueSession, resolveAccessGate } from "../src/lib/auth/accessGate";
import { admitAyasOwnerApproval, type AyasOwnerAdmission } from "../src/lib/brain/autonomy/AyasOwnerApprovalAdmission";
import { resumeAyasOwnerApprovedProposals } from "../src/lib/brain/autonomy/AyasOwnerApprovalResume";
import { decideAyasOwnerApproval, AYAS_AUTONOMOUS_EXECUTION_ENV_VAR } from "../src/lib/brain/autonomy/AyasAutonomousExecutionGate";
import { bindAyasOwnerApproval } from "../src/lib/brain/autonomy/AyasApprovalBinding";
import { AYAS_OWNER_APPROVED_PENDING_EXECUTION_REASON, isAyasOwnerApprovedDecisionReason } from "../src/lib/brain/autonomy/AyasOwnerApprovalProvenance";
import { createAyasApprovalInboxStore, type AyasApprovalInboxHandle, type AyasInboxProposal } from "../src/lib/brain/autonomy/AyasApprovalInboxStore";
import { createAyasPatchArtifactStore, type AyasPatchArtifactStore } from "../src/lib/brain/autonomy/AyasPatchArtifact";
import { AYAS_PATCH_ARTIFACT_MUTATION_KIND } from "../src/lib/brain/autonomy/AyasNovelPatchDiscovery";
import { isolatedStabilityGuardDeps } from "./ayas-isolated-stability-guard";

/**
 * Autonomous-execution-gate V2 — a separately versioned successor for the tail
 * of `smoke-ayas-autonomous-execution-gate.ts`, which stays byte-identical with
 * its preserved raw FAIL. Its scenario 20e expected the resume worker to pick
 * up a durably approved proposal automatically once the flag turned on; the
 * owner's K3 session policy (2026-10-08: automaticResume false, fresh manual
 * EXECUTE required) forbids that, so 20e failed and 20f–20i never ran.
 *
 * V2 keeps every part of 20e that is still policy — flag off is a no-op, the
 * durable APPROVE survives, a completed proposal is never executed twice —
 * and replaces only the automatic pickup with its opposite: flag on alone
 * resumes nothing; one explicit manual action with a fresh EXECUTE resumes
 * exactly that proposal. 20f–20i are carried over with the same intent, so
 * that coverage runs again. Scenarios 1–20d of the original still pass there
 * and are not repeated.
 *
 * Isolation as in `smoke-ayas-owner-approval-resume-v2.ts`: TEMP Git repos
 * with local bare remotes under one run root, synthetic in-process access key,
 * isolated stability guard; the run root is removed junctions first.
 */

const KEY = "gate-v2-isolated-synthetic-key";
process.env.AYAS_ACCESS_KEY = KEY;
delete process.env[AYAS_AUTONOMOUS_EXECUTION_ENV_VAR];
const gate = resolveAccessGate({ AYAS_ACCESS_KEY: KEY, NODE_ENV: "production" });
const ON = { [AYAS_AUTONOMOUS_EXECUTION_ENV_VAR]: "1" };
const OFF: Record<string, string | undefined> = {};

const RUN_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-gate-v2-"));
const junctions: string[] = [];
let count = 0;
async function scenario(name: string, fn: () => void | Promise<void>) {
  await fn();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}
function git(cwd: string, ...args: string[]) { return execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).trim(); }
function dir(label: string) { return fs.mkdtempSync(path.join(RUN_ROOT, `${label}-`)); }

interface Fixture {
  readonly repoRoot: string;
  readonly remoteDir: string;
  readonly gateRoot: string;
  readonly inbox: AyasApprovalInboxHandle;
  readonly artifactStore: AyasPatchArtifactStore;
  readonly stabilityGuard: ReturnType<typeof isolatedStabilityGuardDeps>;
  readonly postPublicationClosure: (expectedHead: string) => void;
}

function makeFixture(options: { readonly strict?: boolean } = {}): Fixture {
  const remoteDir = dir("remote");
  git(remoteDir, "init", "-q", "--bare");
  const repoRoot = dir("repo");
  git(repoRoot, "init", "-q");
  git(repoRoot, "config", "user.email", "f@example.com");
  git(repoRoot, "config", "user.name", "f");
  fs.mkdirSync(path.join(repoRoot, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, "scripts", "existing.ts"), "export const existing = 1;\n");
  fs.writeFileSync(path.join(repoRoot, ".gitignore"), "node_modules/\n.graphify/\nscripts/.graphify/\n");
  fs.writeFileSync(
    path.join(repoRoot, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { target: "ES2020", module: "commonjs", moduleResolution: "node", esModuleInterop: true, strict: true, skipLibCheck: true, noEmit: true, types: ["node"] }, include: ["src/**/*.ts", "scripts/**/*.ts"], exclude: ["node_modules"] }, null, 2),
    "utf8",
  );
  git(repoRoot, "add", "-A"); git(repoRoot, "commit", "-q", "-m", "initial");
  git(repoRoot, "remote", "add", "origin", remoteDir);
  git(repoRoot, "push", "-q", "-u", "origin", "master");
  fs.mkdirSync(path.join(repoRoot, "node_modules"), { recursive: true });
  for (const dep of ["tsx", "typescript", "@types"]) {
    const link = path.join(repoRoot, "node_modules", dep);
    fs.symlinkSync(fs.realpathSync.native(path.join(process.cwd(), "node_modules", dep)), link, process.platform === "win32" ? "junction" : "dir");
    junctions.push(link);
  }
  return {
    repoRoot, remoteDir,
    gateRoot: dir("gate"),
    inbox: createAyasApprovalInboxStore({ rootDir: dir("inbox"), ...(options.strict === false ? {} : { requireOwnerAdmission: true }) }),
    artifactStore: createAyasPatchArtifactStore({ rootDir: dir("artifacts") }),
    stabilityGuard: isolatedStabilityGuardDeps(),
    postPublicationClosure: (expectedHead) => {
      assert.equal(git(repoRoot, "rev-parse", "HEAD"), expectedHead);
      assert.equal(git(remoteDir, "rev-parse", "master"), expectedHead);
    },
  };
}

function seedNewFileProposal(f: Fixture): AyasInboxProposal {
  const head = git(f.repoRoot, "rev-parse", "HEAD");
  const content = 'console.log(JSON.stringify({ status: "PASS", suite: "fixture-generated", scenarios: 1 }));\n';
  const artifact = f.artifactStore.freeze({
    artifactId: `ayas-patch-artifact-${crypto.randomUUID()}`,
    candidateId: "ayas-novel-fixture", generatorIdentity: "ayas-detector:diagnostic-quality-gap-v1",
    baseBranch: "master", baseHead: head, exactFiles: ["scripts/smoke-fixture-generated.ts"], allowedRoots: ["scripts/"],
    replacements: [{ filePath: "scripts/smoke-fixture-generated.ts", expectedHash: null, content, allowCreate: true }],
    validatorScripts: [], graphifyEvidence: ["fixture"], graphifyImportCounts: { "scripts/smoke-fixture-generated.ts": 0 },
    safetyClassification: "SAFE", problemStatement: "p", rationale: "r", expectedUserBenefit: "b", expectedBehaviorChange: "c",
    unchangedBehavior: "u", risk: "low", productionImpact: "none", sandboxValidationSummary: ["PASS"], generatedAt: "2026-10-08T09:00:00.000Z",
  } as never);
  return f.inbox.createProposal({
    createdAt: "2026-10-08T09:00:00.000Z", baseBranch: "master", baseHead: head,
    objective: "AYAS-generated fixture improvement", currentProblem: "fixture problem", selectionReason: "fixture selection reason",
    expectedUserBenefit: "a regression that would otherwise go unnoticed is now caught", expectedBehaviorChange: "fixture change", unchangedBehavior: "fixture unchanged",
    riskIfNotDone: "fixture risk", technicalRisk: "low", productionImpact: "none", rationale: "fixture rationale",
    evidence: ["fixture evidence"], graphifyEvidence: ["fixture graphify evidence"], candidateRank: 1, risk: "low and reversible",
    safetyClassification: "SAFE", exactFiles: artifact.exactFiles, expectedDiffScope: "+1 file", testsPlanned: ["smoke-fixture-generated"],
    estimatedCost: "zero-cost", mutationKind: AYAS_PATCH_ARTIFACT_MUTATION_KIND, patchArtifactId: artifact.artifactId, patchHash: artifact.patchHash,
  } as never);
}

const admit = async (p: AyasInboxProposal, decision: "APPROVE" | "EXECUTE"): Promise<AyasOwnerAdmission> => admitAyasOwnerApproval({
  gate, token: await issueSession(KEY), action: decision === "APPROVE" ? "ayasOwnerApprovalDecision" : "executeAyasApprovedProposal",
  subject: { kind: "proposal", proposalId: p.proposalId, proposalHash: p.proposalHash, decision },
});
const deps = (f: Fixture) => ({ repoRoot: f.repoRoot, gateRoot: f.gateRoot, inbox: f.inbox, artifactStore: f.artifactStore, stabilityGuard: f.stabilityGuard, postPublicationClosure: f.postPublicationClosure, traceEnabled: false });
const statusOf = (f: Fixture, p: AyasInboxProposal) => f.inbox.load().proposals.find((x) => x.proposalId === p.proposalId)!.status;

async function main(): Promise<void> {
  await scenario("20e-v2. a durable owner APPROVE is never picked up automatically when the flag turns on; one explicit manual action with a fresh EXECUTE runs it exactly once", async () => {
    const f = makeFixture();
    const p = seedNewFileProposal(f);
    const disabledOutcome = await decideAyasOwnerApproval(bindAyasOwnerApproval(p, new Date().toISOString()), "APPROVE", { ...deps(f), ownerAdmission: await admit(p, "APPROVE"), envOverride: OFF });
    assert.equal(disabledOutcome.executed, false);
    assert.equal(!disabledOutcome.executed && disabledOutcome.reason, "APPROVED_PENDING_EXECUTION");
    const base = git(f.repoRoot, "rev-parse", "HEAD");

    assert.deepEqual(await resumeAyasOwnerApprovedProposals({ ...deps(f), envOverride: OFF }), [], "flag off: no-op, never a fail-open resume");
    assert.deepEqual(await resumeAyasOwnerApprovedProposals({ ...deps(f), envOverride: ON }), [], "flag on alone: historical consent is not an execution action");
    assert.deepEqual(await resumeAyasOwnerApprovedProposals({ ...deps(f), envOverride: ON, executionOwnerAdmission: await admit(p, "EXECUTE") }), [], "a fresh EXECUTE without an explicit manual owner action is still nothing");
    assert.equal(statusOf(f, p), "APPROVED");
    assert.equal(git(f.repoRoot, "rev-parse", "HEAD"), base);
    assert.equal(git(f.repoRoot, "status", "--short"), "");

    const attempts = await resumeAyasOwnerApprovedProposals({ ...deps(f), envOverride: ON, explicitManualOwnerAction: true, executionOwnerAdmission: await admit(p, "EXECUTE") });
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0]!.proposalId, p.proposalId);
    assert.equal(attempts[0]!.outcome.ok, true, JSON.stringify(attempts[0]!.outcome));
    assert.equal(statusOf(f, p), "COMPLETED");
    assert.notEqual(git(f.repoRoot, "log", "-1", "--format=%s"), "initial", "a real commit was published");
    assert.equal(git(f.remoteDir, "rev-parse", "master"), git(f.repoRoot, "rev-parse", "HEAD"));

    const published = git(f.repoRoot, "rev-parse", "HEAD");
    const again = await resumeAyasOwnerApprovedProposals({ ...deps(f), envOverride: ON, explicitManualOwnerAction: true, executionOwnerAdmission: await admit(p, "EXECUTE") });
    assert.deepEqual(again, [], "a completed proposal is no longer APPROVED — no double execution even with another fresh manual action");
    assert.equal(git(f.repoRoot, "rev-parse", "HEAD"), published);
  });

  await scenario("20f-v2. the resume worker never touches a proposal approved through the legacy manual ONAYLA flow, even with a fresh manual EXECUTE", async () => {
    const f = makeFixture({ strict: false });
    const p = seedNewFileProposal(f);
    // The pre-existing `decideAyasApproval` path records an APPROVE with no reason at all.
    f.inbox.decide(p.proposalId, "APPROVE", new Date().toISOString());
    const before = fs.readFileSync(f.inbox.stateFile);
    const attempts = await resumeAyasOwnerApprovedProposals({ ...deps(f), envOverride: ON, explicitManualOwnerAction: true, executionOwnerAdmission: await admit(p, "EXECUTE") });
    assert.deepEqual(attempts, [], "its own manual YÜRÜT control is how a human runs it");
    assert.equal(statusOf(f, p), "APPROVED", "untouched");
    assert.deepEqual(fs.readFileSync(f.inbox.stateFile), before, "no actor or reason is backfilled");
    assert.equal(git(f.repoRoot, "status", "--short"), "");
  });

  await scenario("20g. AYAS_OWNER_APPROVED_PENDING_EXECUTION_REASON itself is recognized by isAyasOwnerApprovedDecisionReason", () => {
    assert.equal(isAyasOwnerApprovedDecisionReason(AYAS_OWNER_APPROVED_PENDING_EXECUTION_REASON), true);
    assert.equal(isAyasOwnerApprovedDecisionReason(undefined), false);
    assert.equal(isAyasOwnerApprovedDecisionReason("some operator-typed note"), false);
  });

  await scenario("20h. the Server Action maps BOTH non-mutating accepted outcomes (APPROVED_PENDING_EXECUTION and OWNER_REJECTED) to ok:true", () => {
    // "use server" module: asserted by source inspection, as in the original scenario.
    const source = fs.readFileSync(path.join(__dirname, "..", "app", "brain", "actions.ts"), "utf8");
    assert.match(source, /if \(outcome\.reason === "APPROVED_PENDING_EXECUTION" \|\| outcome\.reason === "OWNER_REJECTED"\) \{\s*return \{ ok: true,/);
  });

  await scenario("20i. the Server Action's catch prefers AyasProposalApprovalError's stable short code over its English prose", () => {
    const source = fs.readFileSync(path.join(__dirname, "..", "app", "brain", "actions.ts"), "utf8");
    const action = source.slice(source.indexOf("export async function ayasOwnerApprovalDecision"));
    const body = action.slice(0, action.indexOf("export interface RecordSelfHealDecisionInput"));
    assert.match(body, /error instanceof AyasProposalApprovalError \? error\.code/);
  });

  await scenario("20j. the unattended resume CLI supplies neither an explicit manual action nor an execution admission, so it can never publish", () => {
    const source = fs.readFileSync(path.join(__dirname, "ayas-owner-approval-resume.ts"), "utf8");
    assert.match(source, /resumeAyasOwnerApprovedProposals\(defaultAyasProposalApprovalDeps\(\)\)/);
    assert.doesNotMatch(source, /explicitManualOwnerAction|executionOwnerAdmission/);
  });

  console.log(`AYAS autonomous execution gate V2 smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-autonomous-execution-gate-v2", scenarios: count }));
}

function cleanup(): boolean {
  for (const link of junctions) {
    try { fs.rmdirSync(link); } catch { /* checked below */ }
    try { fs.lstatSync(link); return false; } catch { /* gone */ }
  }
  fs.rmSync(RUN_ROOT, { recursive: true, force: true, maxRetries: 3 });
  return !fs.existsSync(RUN_ROOT);
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => { if (!cleanup()) console.error(`cleanup incomplete: run root kept at ${RUN_ROOT}`); });
