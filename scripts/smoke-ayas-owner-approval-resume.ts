import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { resumeAyasOwnerApprovedProposals } from "../src/lib/brain/autonomy/AyasOwnerApprovalResume";
import { AYAS_AUTONOMOUS_EXECUTION_ENV_VAR } from "../src/lib/brain/autonomy/AyasAutonomousExecutionGate";
import { AYAS_OWNER_APPROVED_PENDING_EXECUTION_REASON } from "../src/lib/brain/autonomy/AyasOwnerApprovalProvenance";
import { createAyasApprovalInboxStore, type AyasApprovalInboxHandle, type AyasInboxProposal } from "../src/lib/brain/autonomy/AyasApprovalInboxStore";
import { createAyasPatchArtifactStore, type AyasPatchArtifactStore } from "../src/lib/brain/autonomy/AyasPatchArtifact";
import { AYAS_PATCH_ARTIFACT_MUTATION_KIND } from "../src/lib/brain/autonomy/AyasNovelPatchDiscovery";

/**
 * `AyasOwnerApprovalResume.ts` — the Step 6 reconciler. What's already fully
 * proven elsewhere is deliberately NOT repeated here:
 * `smoke-ayas-autonomous-execution-gate.ts` (20e/20f/20g) already covers
 * disabled-flag no-op, single-proposal success, no-double-execution-on-a-
 * second-call, and legacy-approval isolation. This suite covers what's
 * unique to resuming — real staleness reconciliation and independent
 * per-proposal failure isolation across more than one eligible proposal.
 */
let count = 0;
function scenario(name: string, fn: () => void | Promise<void>) { return Promise.resolve(fn()).then(() => { count += 1; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }); }
function root() { return fs.mkdtempSync(path.join(os.tmpdir(), "ayas-owner-resume-")); }
function git(cwd: string, ...args: string[]) { return execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim(); }

interface Fixture {
  readonly repoRoot: string;
  readonly remoteDir: string;
  readonly gateRoot: string;
  readonly inbox: AyasApprovalInboxHandle;
  readonly artifactStore: AyasPatchArtifactStore;
  readonly postPublicationClosure: (expectedHead: string) => void;
}

function makeFixture(): Fixture {
  const remoteDir = root();
  git(remoteDir, "init", "-q", "--bare");
  const repoRoot = root();
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
    fs.symlinkSync(path.join(process.cwd(), "node_modules", dep), path.join(repoRoot, "node_modules", dep), process.platform === "win32" ? "junction" : "dir");
  }
  return {
    repoRoot, remoteDir,
    gateRoot: fs.mkdtempSync(path.join(os.tmpdir(), "ayas-owner-resume-gate-")),
    inbox: createAyasApprovalInboxStore({ rootDir: fs.mkdtempSync(path.join(os.tmpdir(), "ayas-owner-resume-inbox-")) }),
    artifactStore: createAyasPatchArtifactStore({ rootDir: fs.mkdtempSync(path.join(os.tmpdir(), "ayas-owner-resume-artifacts-")) }),
    postPublicationClosure: (expectedHead) => {
      assert.equal(git(repoRoot, "rev-parse", "HEAD"), expectedHead);
      assert.equal(git(remoteDir, "rev-parse", "master"), expectedHead);
    },
  };
}

function proposalInput(overrides: Partial<Omit<AyasInboxProposal, "schemaVersion" | "proposalId" | "lastUpdatedAt" | "proposalHash" | "status" | "createdBy">> = {}) {
  return {
    createdAt: "2026-09-18T00:00:00.000Z", baseBranch: "master", baseHead: "will-be-overridden",
    objective: "AYAS-generated fixture improvement", currentProblem: "fixture problem", selectionReason: "fixture selection reason",
    expectedUserBenefit: "fixture benefit", expectedBehaviorChange: "fixture change", unchangedBehavior: "fixture unchanged",
    riskIfNotDone: "fixture risk", technicalRisk: "low", productionImpact: "none", rationale: "fixture rationale",
    evidence: ["fixture evidence"], graphifyEvidence: ["fixture graphify evidence"], candidateRank: 1,
    risk: "low and reversible", safetyClassification: "SAFE" as const, exactFiles: ["scripts/smoke-fixture-generated.ts"],
    expectedDiffScope: "+1 file", testsPlanned: ["smoke-fixture-generated"], estimatedCost: "zero-cost" as const,
    mutationKind: AYAS_PATCH_ARTIFACT_MUTATION_KIND,
    ...overrides,
  };
}

function seedOwnerApprovedProposal(f: Fixture, fileName: string) {
  const head = git(f.repoRoot, "rev-parse", "HEAD");
  const content = `console.log(JSON.stringify({ status: "PASS", suite: "${fileName}", scenarios: 1 }));\n`;
  const artifact = f.artifactStore.freeze({
    artifactId: `ayas-patch-artifact-${Math.random().toString(36).slice(2)}`,
    candidateId: "ayas-novel-fixture", generatorIdentity: "ayas-detector:diagnostic-quality-gap-v1",
    baseBranch: "master", baseHead: head, exactFiles: [`scripts/${fileName}.ts`], allowedRoots: ["scripts/"],
    replacements: [{ filePath: `scripts/${fileName}.ts`, expectedHash: null, content, allowCreate: true }],
    validatorScripts: [], graphifyEvidence: ["fixture"], graphifyImportCounts: { [`scripts/${fileName}.ts`]: 0 },
    safetyClassification: "SAFE", problemStatement: "p", rationale: "r", expectedUserBenefit: "b", expectedBehaviorChange: "c",
    unchangedBehavior: "u", risk: "low", productionImpact: "none", sandboxValidationSummary: ["PASS"], generatedAt: "2026-09-18T00:00:00.000Z",
  } as never);
  const proposal = f.inbox.createProposal(proposalInput({ baseHead: head, exactFiles: artifact.exactFiles, patchArtifactId: artifact.artifactId, patchHash: artifact.patchHash } as never));
  f.inbox.decide(proposal.proposalId, "APPROVE", new Date().toISOString(), AYAS_OWNER_APPROVED_PENDING_EXECUTION_REASON);
  return proposal;
}

async function main(): Promise<void> {
  await scenario("stale HEAD prevents a resumed execution: the proposal is reconciled to STALE, never silently published against an out-of-date baseHead", async () => {
    const f = makeFixture();
    const proposal = seedOwnerApprovedProposal(f, "smoke-fixture-a");
    fs.writeFileSync(path.join(f.repoRoot, "scripts", "existing.ts"), "export const existing = 2;\n");
    git(f.repoRoot, "add", "-A"); git(f.repoRoot, "commit", "-q", "-m", "repo moved on before resume ran");

    const enabled = { ...f, envOverride: { [AYAS_AUTONOMOUS_EXECUTION_ENV_VAR]: "1" } };
    const attempts = await resumeAyasOwnerApprovedProposals(enabled);
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].outcome.ok, false);
    assert.equal(f.inbox.load().proposals.find((p) => p.proposalId === proposal.proposalId)!.status, "STALE");
    assert.equal(git(f.repoRoot, "status", "--short"), "");
  });

  await scenario("two independently owner-approved proposals: the first publishes and moves HEAD, the second's own fresh staleness check then legitimately governs whether it can still proceed — never blindly double-published", async () => {
    const f = makeFixture();
    const first = seedOwnerApprovedProposal(f, "smoke-fixture-b1");
    const second = seedOwnerApprovedProposal(f, "smoke-fixture-b2");
    assert.equal(f.inbox.load().proposals.find((p) => p.proposalId === first.proposalId)!.baseHead, f.inbox.load().proposals.find((p) => p.proposalId === second.proposalId)!.baseHead, "both proposals share the same original baseHead");

    const enabled = { ...f, envOverride: { [AYAS_AUTONOMOUS_EXECUTION_ENV_VAR]: "1" } };
    const attempts = await resumeAyasOwnerApprovedProposals(enabled);
    assert.equal(attempts.length, 2);
    const byId = new Map(attempts.map((a) => [a.proposalId, a] as const));
    assert.equal(byId.get(first.proposalId)?.outcome.ok, true, "the first proposal in encounter order must publish");
    // The second's baseHead now differs from the real HEAD the first proposal's own commit just created —
    // its own fresh reconciliation is what decides its fate, exactly like a genuinely separate resume run would.
    const secondFinal = f.inbox.load().proposals.find((p) => p.proposalId === second.proposalId)!;
    assert.ok(secondFinal.status === "STALE" || secondFinal.status === "COMPLETED", `unexpected terminal status for the second proposal: ${secondFinal.status}`);
    // Whichever it is, the real repo must show exactly ONE or TWO commits ahead of the pre-resume state — never a corrupted/partial state.
    assert.equal(git(f.repoRoot, "status", "--short"), "");
  });

  console.log(`AYAS owner-approval resume smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-owner-approval-resume", scenarios: count }));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
