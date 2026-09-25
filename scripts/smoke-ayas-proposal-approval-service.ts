import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { approveAndExecuteAyasProposal, publishAlreadyOwnerApprovedAyasProposal, AyasProposalApprovalError, type AyasProposalApprovalOutcome } from "../src/lib/brain/autonomy/AyasProposalApprovalService";
import { createAyasApprovalInboxStore, type AyasApprovalInboxHandle, type AyasInboxProposal } from "../src/lib/brain/autonomy/AyasApprovalInboxStore";
import { createAyasPatchArtifactStore, type AyasPatchArtifactStore } from "../src/lib/brain/autonomy/AyasPatchArtifact";
import { AYAS_PATCH_ARTIFACT_MUTATION_KIND } from "../src/lib/brain/autonomy/AyasNovelPatchDiscovery";
import { isolatedStabilityGuardDeps } from "./ayas-isolated-stability-guard";
import { closeAyasPostPublication, AyasPostPublicationClosureError } from "../src/lib/brain/autonomy/AyasPostPublicationClosure";
import { createAyasExecutionJournal, classifyExecutionRecovery } from "../src/lib/brain/autonomy/AyasExecutionJournal";
import { executeAyasApprovedProposalWith } from "../src/lib/brain/autonomy/AyasProposalExecutionService";
import { finalizeAyasDeferredPublication, AyasDeferredPublicationFinalizerError } from "../src/lib/brain/autonomy/AyasDeferredPublicationFinalizer";
import { ayasTraceStore } from "../src/lib/ayas/trace/AyasUnifiedTrace";
import { createAyasGraphifyEvidenceStore } from "../src/lib/brain/autonomy/AyasGraphifyEvidenceStore";

/**
 * M20.7 — "ONAYLA VE UYGULA" for an individual patch-artifact-backed
 * proposal. Same real-fixture-repo + real-bare-remote posture as
 * `smoke-ayas-micro-batch-approval-service.ts` (never the real Atölye repo,
 * never a network remote, push behavior exercised against real Git).
 */
let count = 0;
function scenario(name: string, fn: () => void | Promise<void>) { return Promise.resolve(fn()).then(() => { count += 1; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }); }
function root() { return fs.mkdtempSync(path.join(os.tmpdir(), "ayas-proposal-approval-")); }
function git(cwd: string, ...args: string[]) { return execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim(); }

interface Fixture {
  readonly repoRoot: string;
  readonly remoteDir: string;
  readonly gateRoot: string;
  readonly inbox: AyasApprovalInboxHandle;
  readonly artifactStore: AyasPatchArtifactStore;
  /** Every publication now runs under the Runtime Stability Guard; this keeps the guard's own observations isolated too, so no scenario's outcome can depend on the real scheduler state or the real :3000. */
  readonly stabilityGuard: ReturnType<typeof isolatedStabilityGuardDeps>;
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
  fs.symlinkSync(path.join(process.cwd(), "node_modules", "tsx"), path.join(repoRoot, "node_modules", "tsx"), process.platform === "win32" ? "junction" : "dir");
  fs.symlinkSync(path.join(process.cwd(), "node_modules", "typescript"), path.join(repoRoot, "node_modules", "typescript"), process.platform === "win32" ? "junction" : "dir");
  fs.symlinkSync(path.join(process.cwd(), "node_modules", "@types"), path.join(repoRoot, "node_modules", "@types"), process.platform === "win32" ? "junction" : "dir");

  return {
    repoRoot, remoteDir,
    stabilityGuard: isolatedStabilityGuardDeps(),
    gateRoot: fs.mkdtempSync(path.join(os.tmpdir(), "ayas-proposal-approval-gate-")),
    inbox: createAyasApprovalInboxStore({ rootDir: fs.mkdtempSync(path.join(os.tmpdir(), "ayas-proposal-approval-inbox-")) }),
    artifactStore: createAyasPatchArtifactStore({ rootDir: fs.mkdtempSync(path.join(os.tmpdir(), "ayas-proposal-approval-artifacts-")) }),
    postPublicationClosure: (expectedHead) => {
      assert.equal(git(repoRoot, "rev-parse", "HEAD"), expectedHead);
      assert.equal(git(remoteDir, "rev-parse", "master"), expectedHead);
    },
  };
}

function proposalInput(overrides: Partial<Omit<AyasInboxProposal, "schemaVersion" | "proposalId" | "lastUpdatedAt" | "proposalHash" | "status" | "createdBy">> = {}) {
  return {
    createdAt: "2026-09-16T09:00:00.000Z",
    baseBranch: "master",
    baseHead: "will-be-overridden",
    objective: "AYAS-generated patch artifact fixture",
    currentProblem: "fixture problem",
    selectionReason: "fixture selection reason",
    expectedUserBenefit: "fixture benefit",
    expectedBehaviorChange: "fixture change",
    unchangedBehavior: "fixture unchanged",
    riskIfNotDone: "fixture risk",
    technicalRisk: "low",
    productionImpact: "none",
    rationale: "fixture rationale",
    evidence: ["fixture evidence"],
    graphifyEvidence: ["fixture graphify evidence"],
    candidateRank: 1,
    risk: "low and reversible",
    safetyClassification: "SAFE" as const,
    exactFiles: ["scripts/smoke-fixture-generated.ts"],
    expectedDiffScope: "+1 file",
    testsPlanned: ["smoke-fixture-generated"],
    estimatedCost: "zero-cost" as const,
    mutationKind: AYAS_PATCH_ARTIFACT_MUTATION_KIND,
    ...overrides,
  };
}

/** A brand-new-file proposal (allowCreate: true) — the common case (mirrors error-code-contract-gap/-drift). */
function seedNewFileProposal(f: Fixture) {
  const head = git(f.repoRoot, "rev-parse", "HEAD");
  const content = 'console.log(JSON.stringify({ status: "PASS", suite: "fixture-generated", scenarios: 1 }));\n';
  const artifact = f.artifactStore.freeze({
    artifactId: `ayas-patch-artifact-${Math.random().toString(36).slice(2)}`,
    candidateId: "ayas-novel-fixture", generatorIdentity: "ayas-detector:diagnostic-quality-gap-v1",
    baseBranch: "master", baseHead: head, exactFiles: ["scripts/smoke-fixture-generated.ts"], allowedRoots: ["scripts/"],
    replacements: [{ filePath: "scripts/smoke-fixture-generated.ts", expectedHash: null, content, allowCreate: true }],
    validatorScripts: [], graphifyEvidence: ["fixture"], graphifyImportCounts: { "scripts/smoke-fixture-generated.ts": 0 },
    safetyClassification: "SAFE", problemStatement: "p", rationale: "r", expectedUserBenefit: "b", expectedBehaviorChange: "c",
    unchangedBehavior: "u", risk: "low", productionImpact: "none", sandboxValidationSummary: ["PASS"], generatedAt: "2026-09-16T00:00:00.000Z",
  } as never);
  const proposal = f.inbox.createProposal(proposalInput({ baseHead: head, exactFiles: artifact.exactFiles, patchArtifactId: artifact.artifactId, patchHash: artifact.patchHash } as never));
  return { proposal, artifact, head };
}

/** An EDIT proposal against a pre-existing, already-committed file — exercises the M19 `revertToHead` fix (a genuinely new file has no HEAD blob to restore; an edited one does). */
function seedEditProposal(f: Fixture, opts: { readonly newContent: string }) {
  const targetFile = "scripts/existing-editable.ts";
  const originalContent = "export const value = 1;\n";
  fs.writeFileSync(path.join(f.repoRoot, targetFile), originalContent, "utf8");
  git(f.repoRoot, "add", "--", targetFile);
  git(f.repoRoot, "commit", "-q", "-m", "add editable file");
  const head = git(f.repoRoot, "rev-parse", "HEAD");
  const expectedHash = crypto.createHash("sha256").update(originalContent, "utf8").digest("hex");
  const artifact = f.artifactStore.freeze({
    artifactId: `ayas-patch-artifact-${Math.random().toString(36).slice(2)}`,
    candidateId: "ayas-diagnostic-fixture", generatorIdentity: "ayas-detector:diagnostic-quality-gap-v1",
    baseBranch: "master", baseHead: head, exactFiles: [targetFile], allowedRoots: ["scripts/"],
    replacements: [{ filePath: targetFile, expectedHash, content: opts.newContent, allowCreate: false }],
    validatorScripts: [], graphifyEvidence: ["fixture"], graphifyImportCounts: { [targetFile]: 0 },
    safetyClassification: "SAFE", problemStatement: "p", rationale: "r", expectedUserBenefit: "b", expectedBehaviorChange: "c",
    unchangedBehavior: "u", risk: "low", productionImpact: "none", sandboxValidationSummary: ["PASS"], generatedAt: "2026-09-16T00:00:00.000Z",
  } as never);
  const proposal = f.inbox.createProposal(proposalInput({ baseHead: head, exactFiles: [targetFile], patchArtifactId: artifact.artifactId, patchHash: artifact.patchHash } as never));
  return { proposal, artifact, head, targetFile, originalContent };
}

/** A new-file proposal whose DECLARED graphifyImportCounts deliberately does not match what Graphify's own AST extraction will find in the real written content — proves the Graphify check actually blocks publication on mismatch for the individual-proposal lane (the batch lane's equivalent is already proven in smoke-ayas-micro-batch-approval-service.ts). */
function seedGraphifyMismatchProposal(f: Fixture, declaredImportCount = 2) {
  const head = git(f.repoRoot, "rev-parse", "HEAD");
  // Real content has exactly ONE import (node:path). The default declaration (TWO) is a stale, content-disagreeing
  // contract (Stage 10A: reconciled when the landed bytes are these bytes); 1 is the correct, content-derived one.
  const content = 'import path from "node:path";\nconsole.log(JSON.stringify({ status: "PASS", suite: "fixture-generated", scenarios: 1, sep: path.sep }));\n';
  const artifact = f.artifactStore.freeze({
    artifactId: `ayas-patch-artifact-${Math.random().toString(36).slice(2)}`,
    candidateId: "ayas-novel-mismatch-fixture", generatorIdentity: "ayas-detector:diagnostic-quality-gap-v1",
    baseBranch: "master", baseHead: head, exactFiles: ["scripts/smoke-fixture-generated.ts"], allowedRoots: ["scripts/"],
    replacements: [{ filePath: "scripts/smoke-fixture-generated.ts", expectedHash: null, content, allowCreate: true }],
    validatorScripts: [], graphifyEvidence: ["fixture"], graphifyImportCounts: { "scripts/smoke-fixture-generated.ts": declaredImportCount },
    safetyClassification: "SAFE", problemStatement: "p", rationale: "r", expectedUserBenefit: "b", expectedBehaviorChange: "c",
    unchangedBehavior: "u", risk: "low", productionImpact: "none", sandboxValidationSummary: ["PASS"], generatedAt: "2026-09-16T00:00:00.000Z",
  } as never);
  const proposal = f.inbox.createProposal(proposalInput({ baseHead: head, exactFiles: artifact.exactFiles, patchArtifactId: artifact.artifactId, patchHash: artifact.patchHash } as never));
  return { proposal, artifact, head };
}

async function main(): Promise<void> {
  await scenario("one authorization binds decide + Package C execution + Git publication: a single call produces ONE pushed commit", async () => {
    const f = makeFixture();
    const { proposal } = seedNewFileProposal(f);
    const result = await approveAndExecuteAyasProposal(proposal.proposalId, proposal.proposalHash, f);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.ok(fs.existsSync(path.join(f.repoRoot, "scripts/smoke-fixture-generated.ts")));
    const localHead = git(f.repoRoot, "rev-parse", "HEAD");
    const remoteHead = git(f.remoteDir, "rev-parse", "master");
    assert.equal(localHead, remoteHead, "local must equal the real bare remote after one call");
    assert.equal(localHead, result.commitSha);
    assert.equal(git(f.repoRoot, "status", "--short"), "");
    assert.equal(f.inbox.load().proposals.find((p) => p.proposalId === proposal.proposalId)!.status, "COMPLETED");
    const trace = ayasTraceStore.latest("operator");
    assert.equal(trace?.rootKind, "owner-approval");
    assert.equal(trace?.status, "ok");
    assert.deepEqual(trace?.spans.map((span) => [span.kind, span.status]), [["approval", "ok"], ["execution", "ok"]]);
    assert.ok(!JSON.stringify(trace).includes(proposal.proposalId), "trace must keep only safe correlation, never the proposal body or identifier");
  });

  await scenario("TRACE ON / OFF / BROKEN: every approval, refusal, stale, replay, publish-failure and resume outcome is identical — trace never decides, gates or widens authority", async () => {
    const failingStore = { put() { throw new Error("trace unavailable"); }, get() { throw new Error("trace unavailable"); }, latest() { throw new Error("trace unavailable"); } };
    const modes = { on: {}, off: { traceEnabled: false }, broken: { traceStore: failingStore } } as const;
    type Mode = keyof typeof modes;
    type Run = (f: Fixture, mode: Mode) => Promise<{ readonly proposalId: string; readonly call: () => Promise<AyasProposalApprovalOutcome> }>;
    const withMode = (f: Fixture, mode: Mode) => ({ ...f, ...modes[mode] });
    const cases: Record<string, Run> = {
      "approve-and-publish": async (f, mode) => { const { proposal } = seedNewFileProposal(f); return { proposalId: proposal.proposalId, call: () => approveAndExecuteAyasProposal(proposal.proposalId, proposal.proposalHash, withMode(f, mode)) }; },
      "stale-hash-refused": async (f, mode) => { const { proposal } = seedNewFileProposal(f); return { proposalId: proposal.proposalId, call: () => approveAndExecuteAyasProposal(proposal.proposalId, "stale-hash-value", withMode(f, mode)) }; },
      "not-safe-refused": async (f, mode) => {
        const proposal = f.inbox.createProposal(proposalInput({ baseHead: git(f.repoRoot, "rev-parse", "HEAD"), safetyClassification: "REVIEW_REQUIRED", mutationKind: undefined, exactFiles: ["src/lib/ayas/whatever.ts"] } as never));
        return { proposalId: proposal.proposalId, call: () => approveAndExecuteAyasProposal(proposal.proposalId, proposal.proposalHash, withMode(f, mode)) };
      },
      "head-drift-stale": async (f, mode) => {
        const { proposal } = seedNewFileProposal(f);
        fs.writeFileSync(path.join(f.repoRoot, "scripts", "existing.ts"), "export const existing = 2;\n");
        git(f.repoRoot, "add", "-A"); git(f.repoRoot, "commit", "-q", "-m", "moved on");
        return { proposalId: proposal.proposalId, call: () => approveAndExecuteAyasProposal(proposal.proposalId, proposal.proposalHash, withMode(f, mode)) };
      },
      "replay-refused": async (f, mode) => {
        const { proposal } = seedNewFileProposal(f);
        assert.equal((await approveAndExecuteAyasProposal(proposal.proposalId, proposal.proposalHash, withMode(f, mode))).ok, true);
        return { proposalId: proposal.proposalId, call: () => approveAndExecuteAyasProposal(proposal.proposalId, proposal.proposalHash, withMode(f, mode)) };
      },
      "push-failure": async (f, mode) => {
        const otherClone = root();
        git(otherClone, "clone", "-q", f.remoteDir, ".");
        git(otherClone, "config", "user.email", "g@example.com"); git(otherClone, "config", "user.name", "g");
        fs.writeFileSync(path.join(otherClone, "elsewhere.ts"), "export const elsewhere = 1;\n");
        git(otherClone, "add", "-A"); git(otherClone, "commit", "-q", "-m", "elsewhere");
        git(otherClone, "push", "-q", "origin", "master");
        const { proposal } = seedNewFileProposal(f);
        return { proposalId: proposal.proposalId, call: () => approveAndExecuteAyasProposal(proposal.proposalId, proposal.proposalHash, withMode(f, mode)) };
      },
      "resume-publish": async (f, mode) => {
        const { proposal } = seedNewFileProposal(f);
        f.inbox.decide(proposal.proposalId, "APPROVE", new Date().toISOString());
        return { proposalId: proposal.proposalId, call: () => publishAlreadyOwnerApprovedAyasProposal(proposal.proposalId, proposal.proposalHash, withMode(f, mode)) };
      },
      "resume-replay-refused": async (f, mode) => {
        const { proposal } = seedNewFileProposal(f);
        f.inbox.decide(proposal.proposalId, "APPROVE", new Date().toISOString());
        assert.equal((await publishAlreadyOwnerApprovedAyasProposal(proposal.proposalId, proposal.proposalHash, withMode(f, mode))).ok, true);
        return { proposalId: proposal.proposalId, call: () => publishAlreadyOwnerApprovedAyasProposal(proposal.proposalId, proposal.proposalHash, withMode(f, mode)) };
      },
    };

    for (const [name, run] of Object.entries(cases)) {
      const observed: Partial<Record<Mode, unknown>> = {};
      for (const mode of Object.keys(modes) as Mode[]) {
        const f = makeFixture();
        const { proposalId, call } = await run(f, mode);
        const localBefore = git(f.repoRoot, "rev-parse", "HEAD");
        const remoteBefore = git(f.remoteDir, "rev-parse", "master");
        const traceBefore = ayasTraceStore.latest("operator")?.traceId;
        let result: { readonly ok: boolean; readonly stage?: string; readonly code?: string; readonly changedFiles?: readonly string[] } | { readonly thrown: string; readonly refusal: boolean };
        try {
          const outcome = await call();
          result = outcome.ok ? { ok: true, changedFiles: outcome.changedFiles } : { ok: false, stage: outcome.stage, code: outcome.code };
        } catch (error) {
          result = error instanceof AyasProposalApprovalError
            ? { thrown: error.code, refusal: true }
            : { thrown: error instanceof Error ? error.name : String(error), refusal: false };
        }
        const state = f.inbox.load();
        const localAfter = git(f.repoRoot, "rev-parse", "HEAD");
        const remoteAfter = git(f.remoteDir, "rev-parse", "master");
        observed[mode] = {
          result,
          status: state.proposals.find((p) => p.proposalId === proposalId)?.status,
          approveDecisions: state.decisions.filter((d) => d.proposalId === proposalId && d.decision === "APPROVE").length,
          results: state.results.filter((r) => r.proposalId === proposalId).length,
          localMoved: localAfter !== localBefore,
          remoteMoved: remoteAfter !== remoteBefore,
          remoteEqualsLocal: remoteAfter === localAfter,
          clean: git(f.repoRoot, "status", "--short") === "",
        };

        const trace = ayasTraceStore.latest("operator");
        if (mode !== "on") {
          assert.equal(trace?.traceId, traceBefore, `${name}/${mode}: no trace is recorded when tracing is off or its store is broken`);
          continue;
        }
        assert.notEqual(trace?.traceId, traceBefore, `${name}: a new owner-approval trace exists`);
        assert.equal(trace?.rootKind, "owner-approval");
        const serialized = JSON.stringify(trace);
        assert.ok(!serialized.includes(proposalId), `${name}: the trace carries no proposal identifier or body`);
        const expected = "thrown" in result
          ? { status: result.refusal ? "denied" : "error", code: result.refusal ? result.thrown : undefined }
          : result.ok ? { status: "ok", code: undefined } : { status: result.stage === "APPROVAL" || result.stage === "STABILITY_GUARD" ? "denied" : "error", code: result.code };
        assert.equal(trace?.status, expected.status, `${name}: trace status mirrors the domain outcome`);
        assert.equal(trace?.events.at(-1)?.errorCode, expected.code, `${name}: the domain error code is preserved verbatim`);
        assert.equal(trace?.spans[0]?.kind, "approval");
        assert.equal(trace?.spans[0]?.operation, name.startsWith("resume") ? "resume" : "decide");
        assert.ok(trace?.spans.every((span) => span.status !== "running" && span.parentSpanId === null));
      }
      assert.deepEqual(observed.off, observed.on, `${name}: TRACE OFF changes no authority outcome`);
      assert.deepEqual(observed.broken, observed.on, `${name}: TRACE BROKEN changes no authority outcome`);
    }
  });

  await scenario("real publication order closes only after the new pushed HEAD: refresh, fresh metadata, integrity, then HEALTHY health", async () => {
    const f = makeFixture(); const { proposal } = seedNewFileProposal(f); const order: string[] = [];
    const result = await approveAndExecuteAyasProposal(proposal.proposalId, proposal.proposalHash, {
      ...f,
      postPublicationClosure: (head) => closeAyasPostPublication(head, {
        repoRoot: f.repoRoot,
        refreshGraphify: () => { assert.equal(git(f.remoteDir, "rev-parse", "master"), head); order.push("graphify-refresh"); },
        readGraphifyBranch: () => { order.push("graphify-freshness"); return { lastAnalyzedHead: head, stale: false }; },
        readIntegrity: () => { order.push("integrity"); return { duplicateIds: 0, danglingEdges: 0, selfLoops: 0 }; },
        runHealth: () => { order.push("health"); return { verdict: "HEALTHY", ownerActionRecommended: false }; },
      }),
    });
    assert.equal(result.ok, true);
    assert.deepEqual(order, ["graphify-refresh", "graphify-freshness", "integrity", "health"]);
  });

  await scenario("deferred receipt is durable and terminal success is absent until the closure callback returns", async () => {
    const f = makeFixture(); const { proposal } = seedNewFileProposal(f);
    const result = await approveAndExecuteAyasProposal(proposal.proposalId, proposal.proposalHash, {
      ...f, postPublicationClosure: () => {
        const state = f.inbox.load();
        assert.equal(state.proposals.find((p) => p.proposalId === proposal.proposalId)!.status, "RESERVED");
        assert.equal(state.decisions.find((d) => d.proposalId === proposal.proposalId)!.finalizationOutcome, undefined);
        const journal = createAyasExecutionJournal({ rootDir: f.gateRoot }).list().at(-1)!;
        assert.equal(journal.phase, "MUTATION_COMPLETED_PENDING_PUBLICATION");
        assert.ok(Array.isArray(journal.changedFiles));
      },
    });
    assert.equal(result.ok, true);
    const journal = createAyasExecutionJournal({ rootDir: f.gateRoot }).list().at(-1)!;
    assert.equal(journal.phase, "RESULT_RECORDED");
  });

  await scenario("a post-push Graphify closure failure preserves the published commit and becomes recovery-required, never a false success", async () => {
    const f = makeFixture(); const { proposal } = seedNewFileProposal(f); const before = git(f.repoRoot, "rev-parse", "HEAD");
    const result = await approveAndExecuteAyasProposal(proposal.proposalId, proposal.proposalHash, {
      ...f, postPublicationClosure: () => { throw new AyasPostPublicationClosureError("AYAS_POST_PUBLICATION_GRAPHIFY_STALE", "fixture stale graph"); },
    });
    assert.equal(result.ok, false); if (result.ok) return;
    assert.equal(result.stage, "POST_PUBLICATION_CLOSURE");
    assert.equal(result.code, "AYAS_POST_PUBLICATION_GRAPHIFY_STALE");
    const published = git(f.repoRoot, "rev-parse", "HEAD");
    assert.notEqual(published, before); assert.equal(git(f.remoteDir, "rev-parse", "master"), published);
    const state = f.inbox.load();
    assert.equal(state.proposals.find((entry) => entry.proposalId === proposal.proposalId)!.status, "RECOVERY_REQUIRED");
    assert.equal(state.decisions.find((entry) => entry.proposalId === proposal.proposalId)!.finalizationOutcome, "RECOVERY_REQUIRED");
    assert.equal(state.results.filter((entry) => entry.proposalId === proposal.proposalId).length, 0, "a failed closure must not synthesize a completed result");
    assert.equal(createAyasExecutionJournal({ rootDir: f.gateRoot }).list().at(-1)!.phase, "RECOVERY_REQUIRED");
    const transaction = f.stabilityGuard.store!.load().transactions.at(-1)!;
    assert.equal(transaction.state, "RECOVERY_REQUIRED");
  });

  await scenario("an interruption after mutation but before commit leaves a recovery-required durable receipt and never records terminal success", async () => {
    const f = makeFixture(); const { proposal } = seedNewFileProposal(f); const before = git(f.repoRoot, "rev-parse", "HEAD");
    const result = await approveAndExecuteAyasProposal(proposal.proposalId, proposal.proposalHash, {
      ...f, onBeforeCommit: () => { throw new Error("fixture interruption before commit"); },
    });
    assert.equal(result.ok, false); if (result.ok) return;
    assert.equal(result.stage, "COMMIT");
    assert.equal(git(f.repoRoot, "rev-parse", "HEAD"), before, "no commit is invented after interruption");
    const state = f.inbox.load();
    assert.equal(state.proposals.find((entry) => entry.proposalId === proposal.proposalId)!.status, "RECOVERY_REQUIRED");
    assert.equal(state.results.filter((entry) => entry.proposalId === proposal.proposalId).length, 0);
    assert.equal(createAyasExecutionJournal({ rootDir: f.gateRoot }).list().at(-1)!.phase, "RECOVERY_REQUIRED");
  });

  await scenario("an interruption after commit but before push preserves the local commit, keeps the remote unchanged, and never guesses success", async () => {
    const f = makeFixture(); const { proposal } = seedNewFileProposal(f); const before = git(f.repoRoot, "rev-parse", "HEAD");
    const result = await approveAndExecuteAyasProposal(proposal.proposalId, proposal.proposalHash, {
      ...f, onAfterCommitBeforePush: () => { throw new Error("fixture interruption before push"); },
    });
    assert.equal(result.ok, false); if (result.ok) return;
    assert.equal(result.stage, "PUSH");
    const local = git(f.repoRoot, "rev-parse", "HEAD");
    assert.notEqual(local, before, "the already-created local commit is preserved without rewrite");
    assert.equal(git(f.remoteDir, "rev-parse", "master"), before, "the remote was never falsely treated as published");
    const state = f.inbox.load();
    assert.equal(state.proposals.find((entry) => entry.proposalId === proposal.proposalId)!.status, "RECOVERY_REQUIRED");
    assert.equal(state.results.filter((entry) => entry.proposalId === proposal.proposalId).length, 0);
    assert.equal(createAyasExecutionJournal({ rootDir: f.gateRoot }).list().at(-1)!.phase, "RECOVERY_REQUIRED");
  });

  await scenario("the shared finalizer accepts only the durable receipt once: duplicate finalization cannot duplicate result, approval, or journal success", async () => {
    const f = makeFixture(); const { proposal } = seedNewFileProposal(f);
    f.inbox.decide(proposal.proposalId, "APPROVE", new Date().toISOString());
    const receipt = await executeAyasApprovedProposalWith(proposal.proposalId, {
      repoRoot: f.repoRoot, gateRoot: f.gateRoot, inbox: f.inbox, patchArtifactStore: f.artifactStore, deferredPublication: true,
    });
    assert.ok(receipt);
    if (!receipt) return;
    assert.equal(createAyasExecutionJournal({ rootDir: f.gateRoot }).read(receipt.executionId)!.phase, "MUTATION_COMPLETED_PENDING_PUBLICATION");
    git(f.repoRoot, "add", "--", ...receipt.exactFiles); git(f.repoRoot, "commit", "-q", "-m", "fixture deferred publish"); git(f.repoRoot, "push", "-q", "origin", "master");
    const head = git(f.repoRoot, "rev-parse", "HEAD");
    finalizeAyasDeferredPublication(receipt, { repoRoot: f.repoRoot, gateRoot: f.gateRoot, inbox: f.inbox, expectedHead: head });
    assert.throws(() => finalizeAyasDeferredPublication(receipt, { repoRoot: f.repoRoot, gateRoot: f.gateRoot, inbox: f.inbox, expectedHead: head }),
      (error: unknown) => error instanceof AyasDeferredPublicationFinalizerError && error.code === "AYAS_DEFERRED_RECEIPT_NOT_PENDING");
    const state = f.inbox.load();
    assert.equal(state.results.filter((entry) => entry.proposalId === proposal.proposalId).length, 1);
    assert.equal(state.decisions.filter((entry) => entry.proposalId === proposal.proposalId && entry.finalizationOutcome === "EXECUTED").length, 1);
    assert.equal(createAyasExecutionJournal({ rootDir: f.gateRoot }).read(receipt.executionId)!.phase, "RESULT_RECORDED");
  });

  await scenario("a crash after result persistence during finalization resumes the same receipt without replaying or duplicating the result", async () => {
    const f = makeFixture(); const { proposal } = seedNewFileProposal(f);
    f.inbox.decide(proposal.proposalId, "APPROVE", new Date().toISOString());
    const receipt = await executeAyasApprovedProposalWith(proposal.proposalId, {
      repoRoot: f.repoRoot, gateRoot: f.gateRoot, inbox: f.inbox, patchArtifactStore: f.artifactStore, deferredPublication: true,
    });
    assert.ok(receipt); if (!receipt) return;
    git(f.repoRoot, "add", "--", ...receipt.exactFiles); git(f.repoRoot, "commit", "-q", "-m", "fixture finalizer restart"); git(f.repoRoot, "push", "-q", "origin", "master");
    f.inbox.recordResult({ resultId: "interrupted-finalizer", proposalId: receipt.proposalId, authorizationId: receipt.authorizationId, startedAt: receipt.mutationCompletedAt, completedAt: new Date().toISOString(), changedFiles: receipt.changedFiles, diffFingerprint: receipt.diffFingerprint, testsRun: receipt.testsRun, testResults: receipt.testResults, outcome: "COMPLETED", gateAuditIdentity: receipt.authorizationId, operatorReviewStatus: "WAITING_REVIEW" }, "COMPLETED");
    const head = git(f.repoRoot, "rev-parse", "HEAD");
    finalizeAyasDeferredPublication(receipt, { repoRoot: f.repoRoot, gateRoot: f.gateRoot, inbox: f.inbox, expectedHead: head });
    const state = f.inbox.load();
    assert.equal(state.results.filter((entry) => entry.proposalId === proposal.proposalId).length, 1);
    assert.equal(state.decisions.find((entry) => entry.reservationId === receipt.reservationId)!.finalizationOutcome, "EXECUTED");
    assert.equal(createAyasExecutionJournal({ rootDir: f.gateRoot }).read(receipt.executionId)!.phase, "RESULT_RECORDED");
  });

  await scenario("crash window after push before finalizer reloads the receipt, fails closed, and never guesses terminal success or replays mutation", async () => {
    const f = makeFixture(); const { proposal } = seedNewFileProposal(f);
    f.inbox.decide(proposal.proposalId, "APPROVE", new Date().toISOString());
    const receipt = await executeAyasApprovedProposalWith(proposal.proposalId, {
      repoRoot: f.repoRoot, gateRoot: f.gateRoot, inbox: f.inbox, patchArtifactStore: f.artifactStore, deferredPublication: true,
    });
    assert.ok(receipt); if (!receipt) return;
    git(f.repoRoot, "add", "--", ...receipt.exactFiles); git(f.repoRoot, "commit", "-q", "-m", "fixture pushed before finalizer"); git(f.repoRoot, "push", "-q", "origin", "master");
    const published = git(f.repoRoot, "rev-parse", "HEAD");
    assert.equal(git(f.remoteDir, "rev-parse", "master"), published);
    const reloaded = createAyasExecutionJournal({ rootDir: f.gateRoot }).read(receipt.executionId)!;
    assert.equal(reloaded.phase, "MUTATION_COMPLETED_PENDING_PUBLICATION");
    assert.equal(classifyExecutionRecovery(reloaded).window, "E");
    const state = f.inbox.load();
    assert.equal(state.proposals.find((entry) => entry.proposalId === proposal.proposalId)!.status, "RESERVED");
    assert.equal(state.results.filter((entry) => entry.proposalId === proposal.proposalId).length, 0);
    await assert.rejects(executeAyasApprovedProposalWith(proposal.proposalId, {
      repoRoot: f.repoRoot, gateRoot: f.gateRoot, inbox: f.inbox, patchArtifactStore: f.artifactStore, deferredPublication: true,
    }), (error: unknown) => error instanceof Error && /status is RESERVED/i.test(error.message));
  });

  await scenario("stale Graphify metadata and unhealthy health are independently fail-closed by the canonical closure", () => {
    const f = makeFixture(); const head = git(f.repoRoot, "rev-parse", "HEAD");
    assert.throws(() => closeAyasPostPublication(head, {
      repoRoot: f.repoRoot, refreshGraphify: () => {}, readGraphifyBranch: () => ({ lastAnalyzedHead: "old-head", stale: false }),
      readIntegrity: () => ({ duplicateIds: 0, danglingEdges: 0, selfLoops: 0 }), runHealth: () => ({ verdict: "HEALTHY", ownerActionRecommended: false }),
    }), (error: unknown) => error instanceof AyasPostPublicationClosureError && error.code === "AYAS_POST_PUBLICATION_GRAPHIFY_STALE");
    assert.throws(() => closeAyasPostPublication(head, {
      repoRoot: f.repoRoot, refreshGraphify: () => {}, readGraphifyBranch: () => ({ lastAnalyzedHead: head, stale: false }),
      readIntegrity: () => ({ duplicateIds: 0, danglingEdges: 0, selfLoops: 0 }), runHealth: () => ({ verdict: "DEGRADED", ownerActionRecommended: true }),
    }), (error: unknown) => error instanceof AyasPostPublicationClosureError && error.code === "AYAS_POST_PUBLICATION_HEALTH_UNHEALTHY");
  });

  await scenario("Graphify metadata convergence polls a stale read until the published HEAD is authoritative", () => {
    const f = makeFixture(); const head = git(f.repoRoot, "rev-parse", "HEAD"); let reads = 0; let clock = 0;
    closeAyasPostPublication(head, {
      repoRoot: f.repoRoot, refreshGraphify: () => {}, nowMs: () => clock,
      sleepMs: (ms) => { clock += ms; },
      readGraphifyBranch: () => (++reads < 3 ? { lastAnalyzedHead: "old-head", stale: false } : { lastAnalyzedHead: head, stale: false }),
      readIntegrity: () => ({ duplicateIds: 0, danglingEdges: 0, selfLoops: 0 }),
      runHealth: () => ({ verdict: "HEALTHY", ownerActionRecommended: false }),
    });
    assert.equal(reads, 3);
  });

  await scenario("Graphify metadata convergence timeout is bounded and deterministic", () => {
    const f = makeFixture(); const head = git(f.repoRoot, "rev-parse", "HEAD"); let reads = 0; let clock = 0;
    assert.throws(() => closeAyasPostPublication(head, {
      repoRoot: f.repoRoot, refreshGraphify: () => {}, nowMs: () => clock,
      sleepMs: (ms) => { clock += ms; },
      readGraphifyBranch: () => { reads += 1; return { lastAnalyzedHead: "old-head", stale: false }; },
      readIntegrity: () => ({ duplicateIds: 0, danglingEdges: 0, selfLoops: 0 }),
      runHealth: () => ({ verdict: "HEALTHY", ownerActionRecommended: false }),
    }), (error: unknown) => error instanceof AyasPostPublicationClosureError && error.code === "AYAS_POST_PUBLICATION_GRAPHIFY_STALE");
    assert.equal(clock, 30_000, "the convergence deadline is independently bounded at 30 seconds");
    assert.equal(reads, 121, "initial read plus exactly 120 polls at the 250ms interval");
  });

  await scenario("a proposalHash that no longer matches the current proposal is refused before any decision or mutation", async () => {
    const f = makeFixture();
    const { proposal } = seedNewFileProposal(f);
    await assert.rejects(
      approveAndExecuteAyasProposal(proposal.proposalId, "stale-hash-value", f),
      (e: unknown) => e instanceof AyasProposalApprovalError && e.code === "PROPOSAL_HASH_MISMATCH",
    );
    assert.equal(f.inbox.load().proposals.find((p) => p.proposalId === proposal.proposalId)!.status, "PENDING", "no decision must be recorded");
    assert.equal(git(f.repoRoot, "status", "--short"), "");
    const trace = ayasTraceStore.latest("operator");
    assert.equal(trace?.status, "denied");
    assert.equal(trace?.spans[0]?.errorCode, "PROPOSAL_HASH_MISMATCH");
  });

  await scenario("a REVIEW_REQUIRED proposal is refused before any decision — never eligible for single-approval execution", async () => {
    const f = makeFixture();
    const head = git(f.repoRoot, "rev-parse", "HEAD");
    const proposal = f.inbox.createProposal(proposalInput({ baseHead: head, safetyClassification: "REVIEW_REQUIRED", mutationKind: undefined, exactFiles: ["src/lib/ayas/whatever.ts"] } as never));
    await assert.rejects(
      approveAndExecuteAyasProposal(proposal.proposalId, proposal.proposalHash, f),
      (e: unknown) => e instanceof AyasProposalApprovalError && e.code === "NOT_SAFE",
    );
    assert.equal(f.inbox.load().proposals.find((p) => p.proposalId === proposal.proposalId)!.status, "PENDING");
  });

  await scenario("a non-patch-artifact mutationKind is refused — single-approval execution is only wired for patch-artifact-backed proposals", async () => {
    const f = makeFixture();
    const head = git(f.repoRoot, "rev-parse", "HEAD");
    const proposal = f.inbox.createProposal(proposalInput({ baseHead: head, mutationKind: "some-static-registry-kind" } as never));
    await assert.rejects(
      approveAndExecuteAyasProposal(proposal.proposalId, proposal.proposalHash, f),
      (e: unknown) => e instanceof AyasProposalApprovalError && e.code === "NOT_PATCH_ARTIFACT",
    );
  });

  await scenario("HEAD drift since the proposal's baseHead invalidates the authorization — refused, proposal reconciled to STALE", async () => {
    const f = makeFixture();
    const { proposal } = seedNewFileProposal(f);
    fs.writeFileSync(path.join(f.repoRoot, "scripts", "existing.ts"), "export const existing = 2;\n");
    git(f.repoRoot, "add", "-A"); git(f.repoRoot, "commit", "-q", "-m", "moved on");
    const result = await approveAndExecuteAyasProposal(proposal.proposalId, proposal.proposalHash, f);
    assert.equal(result.ok, false);
    assert.equal(f.inbox.load().proposals.find((p) => p.proposalId === proposal.proposalId)!.status, "STALE");
  });

  await scenario("Stage 10A — a stale declared import count on byte-identical approved content is reconciled, not failed: publication proceeds and the durable Graphify evidence records STALE_EXPECTATION", async () => {
    const f = makeFixture();
    const { proposal } = seedGraphifyMismatchProposal(f);
    const result = await approveAndExecuteAyasProposal(proposal.proposalId, proposal.proposalHash, f);
    assert.equal(result.ok, true, "the landed file IS the approved artifact; a stale declaration must not revert it as RECOVERY_REQUIRED");
    const records = createAyasGraphifyEvidenceStore({ rootDir: path.join(f.gateRoot, "graphify-evidence") }).listForItem(proposal.proposalId);
    assert.ok(records.length >= 1, "the reconciliation is recorded, never silent");
    assert.ok(records.every((r) => r.outcome === "PASS" && r.verdict === "STALE_EXPECTATION" && r.expectedImportCount === 2 && r.actualImportCount === 1));
  });

  await scenario("M21.4 — a real import-count mismatch (an extra dependency lands AFTER Package C wrote the approved bytes, so Graphify's own AST extraction disagrees with the declared contract) blocks publication: no commit, no push, write rolled back", async () => {
    const f = makeFixture();
    const { proposal } = seedGraphifyMismatchProposal(f, 1);
    const target = path.join(f.repoRoot, "scripts/smoke-fixture-generated.ts");
    const beforeCount = Number(git(f.repoRoot, "rev-list", "--count", "HEAD"));
    const result = await approveAndExecuteAyasProposal(proposal.proposalId, proposal.proposalHash, {
      ...f,
      onJournalPhase: (phase) => { if (phase === "MUTATION_COMPLETED_PENDING_PUBLICATION") fs.appendFileSync(target, 'import os from "node:os";\nconsole.log(os.EOL.length);\n'); },
    });
    assert.equal(result.ok, false);
    if (!result.ok) { assert.equal(result.code, "AYAS_GRAPHIFY_UNEXPECTED_DEPENDENCY"); assert.match(result.message, /REAL_STRUCTURAL_REGRESSION/); }
    const afterCount = Number(git(f.repoRoot, "rev-list", "--count", "HEAD"));
    assert.equal(afterCount, beforeCount, "no commit must be created when Graphify's real check disagrees with the declared contract");
    assert.equal(fs.existsSync(path.join(f.repoRoot, "scripts/smoke-fixture-generated.ts")), false, "the write must be rolled back, not left half-applied");
    assert.equal(git(f.repoRoot, "status", "--short"), "");
  });

  await scenario("an edit to a pre-existing file that fails post-execution validation is reverted to its ORIGINAL content, never deleted (the M19 revertToHead fix)", async () => {
    const f = makeFixture();
    // Valid JS, but a real TypeScript type error — passes Package C (no declared validators) but fails the post-execution project-wide tsc --noEmit.
    const { proposal, targetFile } = seedEditProposal(f, { newContent: 'export const value: number = "not a number";\n' });
    const headBefore = git(f.repoRoot, "show", `HEAD:${targetFile}`); // ground truth: what git itself considers this file's content at HEAD (accounts for this machine's own autocrlf normalization)
    const result = await approveAndExecuteAyasProposal(proposal.proposalId, proposal.proposalHash, f);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.stage, "POST_VALIDATION");
    assert.ok(fs.existsSync(path.join(f.repoRoot, targetFile)), "the file must still exist — a pre-existing file must be RESTORED, never deleted");
    assert.equal(git(f.repoRoot, "show", `HEAD:${targetFile}`), headBefore, "HEAD itself must be untouched (no commit happened)");
    assert.equal(git(f.repoRoot, "status", "--short"), "", "working tree must be clean after the revert — restored content must exactly match HEAD, not just 'exist'");
  });

  await scenario("replay is refused: a second approval call on an already-COMPLETED proposal is rejected, never re-executed or re-pushed", async () => {
    const f = makeFixture();
    const { proposal } = seedNewFileProposal(f);
    const first = await approveAndExecuteAyasProposal(proposal.proposalId, proposal.proposalHash, f);
    assert.equal(first.ok, true);
    await assert.rejects(
      approveAndExecuteAyasProposal(proposal.proposalId, proposal.proposalHash, f),
      (e: unknown) => e instanceof AyasProposalApprovalError && e.code === "NOT_READY",
    );
  });

  await scenario("push failure (remote already moved on) is a distinct PUSH-stage failure — local commit preserved, never reset/rewritten", async () => {
    const f = makeFixture();
    const otherClone = root();
    git(otherClone, "clone", "-q", f.remoteDir, ".");
    git(otherClone, "config", "user.email", "g@example.com"); git(otherClone, "config", "user.name", "g");
    fs.writeFileSync(path.join(otherClone, "elsewhere.ts"), "export const elsewhere = 1;\n");
    git(otherClone, "add", "-A"); git(otherClone, "commit", "-q", "-m", "elsewhere");
    git(otherClone, "push", "-q", "origin", "master");

    const { proposal } = seedNewFileProposal(f);
    const beforeLocalHead = git(f.repoRoot, "rev-parse", "HEAD");
    const result = await approveAndExecuteAyasProposal(proposal.proposalId, proposal.proposalHash, f);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.stage, "PUSH");
    const afterLocalHead = git(f.repoRoot, "rev-parse", "HEAD");
    assert.notEqual(afterLocalHead, beforeLocalHead, "the local commit must still exist even though the push failed");
    assert.ok(fs.existsSync(path.join(f.repoRoot, "scripts/smoke-fixture-generated.ts")));
  });

  await scenario("exact-scope staging only: the commit contains ONLY the approved proposal's exactFiles", async () => {
    const f = makeFixture();
    const { proposal } = seedNewFileProposal(f);
    const result = await approveAndExecuteAyasProposal(proposal.proposalId, proposal.proposalHash, f);
    assert.equal(result.ok, true);
    const changedInCommit = git(f.repoRoot, "diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD").split("\n").filter(Boolean);
    assert.deepEqual(changedInCommit, ["scripts/smoke-fixture-generated.ts"]);
  });

  // --- publishAlreadyOwnerApprovedAyasProposal (Step 6 resume entrypoint) ---
  // Exercises the shared publish pipeline (`publishAyasApprovedProposal`)
  // through its SECOND entrypoint — the one `AyasOwnerApprovalResume.ts`
  // calls for a proposal that is already durably APPROVED, never PENDING.
  // `approveAndExecuteAyasProposal`'s own scenarios above already prove the
  // pipeline's mutation/Graphify/staging/commit/push behavior in depth; this
  // section only proves the two entrypoints share that ONE pipeline and
  // differ correctly on their precondition.

  await scenario("publishAlreadyOwnerApprovedAyasProposal refuses a still-PENDING proposal — it is only for an already-approved one", async () => {
    const f = makeFixture();
    const { proposal } = seedNewFileProposal(f);
    await assert.rejects(
      publishAlreadyOwnerApprovedAyasProposal(proposal.proposalId, proposal.proposalHash, f),
      (e: unknown) => e instanceof AyasProposalApprovalError && e.code === "NOT_READY",
    );
    assert.equal(f.inbox.load().proposals.find((p) => p.proposalId === proposal.proposalId)!.status, "PENDING", "must not have decided anything");
  });

  await scenario("publishAlreadyOwnerApprovedAyasProposal publishes an already-APPROVED proposal through the SAME one-commit pipeline, without deciding again", async () => {
    const f = makeFixture();
    const { proposal } = seedNewFileProposal(f);
    f.inbox.decide(proposal.proposalId, "APPROVE", new Date().toISOString());
    const decisionsBefore = f.inbox.load().decisions.filter((d) => d.proposalId === proposal.proposalId && d.decision === "APPROVE").length;
    const result = await publishAlreadyOwnerApprovedAyasProposal(proposal.proposalId, proposal.proposalHash, f);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const localHead = git(f.repoRoot, "rev-parse", "HEAD");
    const remoteHead = git(f.remoteDir, "rev-parse", "master");
    assert.equal(localHead, remoteHead);
    assert.equal(localHead, result.commitSha);
    assert.equal(f.inbox.load().proposals.find((p) => p.proposalId === proposal.proposalId)!.status, "COMPLETED");
    const decisionsAfter = f.inbox.load().decisions.filter((d) => d.proposalId === proposal.proposalId && d.decision === "APPROVE").length;
    assert.equal(decisionsAfter, decisionsBefore, "must not create a second APPROVE decision record — the approval already existed");
  });

  await scenario("publishAlreadyOwnerApprovedAyasProposal refuses a stale proposalHash exactly like the PENDING entrypoint does", async () => {
    const f = makeFixture();
    const { proposal } = seedNewFileProposal(f);
    f.inbox.decide(proposal.proposalId, "APPROVE", new Date().toISOString());
    await assert.rejects(
      publishAlreadyOwnerApprovedAyasProposal(proposal.proposalId, "stale-hash-value", f),
      (e: unknown) => e instanceof AyasProposalApprovalError && e.code === "PROPOSAL_HASH_MISMATCH",
    );
  });

  await scenario("publishAlreadyOwnerApprovedAyasProposal refuses to replay an already-COMPLETED proposal", async () => {
    const f = makeFixture();
    const { proposal } = seedNewFileProposal(f);
    f.inbox.decide(proposal.proposalId, "APPROVE", new Date().toISOString());
    const first = await publishAlreadyOwnerApprovedAyasProposal(proposal.proposalId, proposal.proposalHash, f);
    assert.equal(first.ok, true);
    await assert.rejects(
      publishAlreadyOwnerApprovedAyasProposal(proposal.proposalId, proposal.proposalHash, f),
      (e: unknown) => e instanceof AyasProposalApprovalError && e.code === "NOT_READY",
    );
  });

  await scenario("the module never stages via broad commands — source inspection proves no `add .` / `add -A` / `commit -a`", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src", "lib", "brain", "autonomy", "AyasProposalApprovalService.ts"), "utf8");
    assert.doesNotMatch(src, /git\(deps\.repoRoot,\s*\["add",\s*"-A"|git\(deps\.repoRoot,\s*\["add",\s*"\."|"commit",\s*"-a"/);
  });

  console.log(`AYAS proposal approval service smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-proposal-approval-service", scenarios: count }));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
