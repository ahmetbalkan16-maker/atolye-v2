import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { approveAndExecuteAyasProposal, publishAlreadyOwnerApprovedAyasProposal, AyasProposalApprovalError, type AyasProposalApprovalDeps } from "../src/lib/brain/autonomy/AyasProposalApprovalService";
import { createAyasApprovalInboxStore, type AyasApprovalInboxHandle, type AyasInboxProposal } from "../src/lib/brain/autonomy/AyasApprovalInboxStore";
import { createAyasPatchArtifactStore, type AyasPatchArtifactStore } from "../src/lib/brain/autonomy/AyasPatchArtifact";
import { AYAS_PATCH_ARTIFACT_MUTATION_KIND } from "../src/lib/brain/autonomy/AyasNovelPatchDiscovery";
import { createAyasStabilityTransactionStore, recoverInterruptedAyasStabilityTransactions, type AyasStabilityTransaction, type AyasStabilityTransactionStore } from "../src/lib/brain/autonomy/AyasRuntimeStabilityTransaction";
import { createAyasResearchSchedulerStateStore, ayasResearchSchedulerStateSchemaVersion, type AyasResearchSchedulerStateStore } from "../src/lib/brain/autonomy/AyasResearchSchedulerStateStore";
import { createAyasExecutionJournal, ayasExecutionJournalSchemaVersion } from "../src/lib/brain/autonomy/AyasExecutionJournal";
import { ayasPublicationOperationName, findUnresolvedAyasPublicationState, type AyasGuardedPublicationGuardDeps } from "../src/lib/brain/autonomy/AyasGuardedPublication";
import { classifyAyasRuntimeImpact, classifyAyasRuntimeImpactFile } from "../src/lib/brain/autonomy/AyasProposalRuntimeImpact";

/**
 * AYAS RUNTIME STABILITY GUARD — PIPELINE INTEGRATION regression suite.
 *
 * The gap this suite pins shut: before this integration, a proposal could be
 * approved, executed, tested, committed and pushed while leaving behind NO
 * stability transaction, snapshot or health decision — the guard existed as a
 * library nobody called. Every scenario below therefore asserts against the
 * DURABLE guard record, not merely against a return value: a publication that
 * silently skipped the guard would leave an empty transaction log and fail
 * here even if its own outcome looked perfect.
 *
 * Isolation posture, identical to `smoke-ayas-proposal-approval-service.ts`
 * and `smoke-ayas-runtime-stability-guard.ts`: a real temp Git repo and a
 * real bare remote (so commit/push behaviour is exercised against real Git),
 * a temp approval inbox, a temp gate root, a temp stability transaction
 * store, a temp scheduler state store, an injected environment, and injected
 * port/command probes. Nothing here reads or writes `data/brain`, touches the
 * real working tree, observes the real :3000, kills any process, or approves
 * or executes a real proposal.
 */
let count = 0;
function scenario(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve(fn()).then(
    () => { count += 1; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); },
    (error: unknown) => { console.error(`FAIL: ${name}`); throw error; },
  );
}
function root() { return fs.mkdtempSync(path.join(os.tmpdir(), "ayas-guarded-pub-")); }
function git(cwd: string, ...args: string[]) { return execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim(); }

/** The fake listener table. Deliberately NOT the real machine's ports: no scenario may depend on, or disturb, a real dev server. */
const FIXTURE_SERVICE_PORT = 3000;
const FIXTURE_UNRELATED_PORT = 3101;

interface Fixture extends AyasProposalApprovalDeps {
  readonly repoRoot: string;
  readonly remoteDir: string;
  readonly gateRoot: string;
  readonly inbox: AyasApprovalInboxHandle;
  readonly artifactStore: AyasPatchArtifactStore;
  readonly transactionStore: AyasStabilityTransactionStore;
  readonly schedulerStore: AyasResearchSchedulerStateStore;
  readonly listeners: Map<number, number>;
  readonly stabilityGuard: AyasGuardedPublicationGuardDeps;
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
  for (const dependency of ["tsx", "typescript", "@types"]) {
    fs.symlinkSync(path.join(process.cwd(), "node_modules", dependency), path.join(repoRoot, "node_modules", dependency), process.platform === "win32" ? "junction" : "dir");
  }

  const gateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-guarded-pub-gate-"));
  const transactionStore = createAyasStabilityTransactionStore({ rootDir: fs.mkdtempSync(path.join(os.tmpdir(), "ayas-guarded-pub-tx-")) });

  // A scheduler with a real cadence, so the scheduler health check is ACTIVE
  // rather than skipped in every scenario below.
  const schedulerStore = createAyasResearchSchedulerStateStore({ rootDir: fs.mkdtempSync(path.join(os.tmpdir(), "ayas-guarded-pub-sched-")) });
  schedulerStore.write({
    schemaVersion: ayasResearchSchedulerStateSchemaVersion,
    nextLightAt: "2026-09-18T17:00:00.000Z",
    nextDeepAt: "2026-09-19T11:00:00.000Z",
    lastSuccessfulResearchAt: "2026-09-18T11:00:00.000Z",
    consecutiveFailures: 0,
  });

  const listeners = new Map<number, number>([[FIXTURE_SERVICE_PORT, 15844], [FIXTURE_UNRELATED_PORT, 4242]]);

  return {
    repoRoot, remoteDir, gateRoot, listeners, transactionStore, schedulerStore,
    // This suite proves the guard's durable lifecycle. Publication closure is
    // independently covered by the proposal-approval service suite; keeping
    // it isolated here avoids requiring a real Graphify installation inside
    // this deliberately minimal Git fixture.
    postPublicationClosure: () => {},
    inbox: createAyasApprovalInboxStore({ rootDir: fs.mkdtempSync(path.join(os.tmpdir(), "ayas-guarded-pub-inbox-")) }),
    artifactStore: createAyasPatchArtifactStore({ rootDir: fs.mkdtempSync(path.join(os.tmpdir(), "ayas-guarded-pub-artifacts-")) }),
    stabilityGuard: {
      store: transactionStore,
      observedPorts: [FIXTURE_SERVICE_PORT, FIXTURE_UNRELATED_PORT],
      snapshot: {
        schedulerStore,
        env: { AYAS_AUTONOMOUS_EXECUTION_ENABLED: "1", NODE_ENV: "test" },
        portProbe: (port: number) => listeners.get(port),
        commandProbe: () => "node fixture-server",
      },
    },
  };
}

function transactionsFor(f: Fixture, proposalId: string): readonly AyasStabilityTransaction[] {
  return f.transactionStore.load().transactions.filter((t) => t.operation === ayasPublicationOperationName("proposal", proposalId));
}

function proposalInput(overrides: Partial<Omit<AyasInboxProposal, "schemaVersion" | "proposalId" | "lastUpdatedAt" | "proposalHash" | "status" | "createdBy">> = {}) {
  return {
    createdAt: "2026-09-18T09:00:00.000Z",
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

/** A TEST_ONLY proposal: one brand-new `scripts/smoke-*.ts` file — the exact shape M19's generators produce. */
function seedTestOnlyProposal(f: Fixture) {
  const head = git(f.repoRoot, "rev-parse", "HEAD");
  const content = 'console.log(JSON.stringify({ status: "PASS", suite: "fixture-generated", scenarios: 1 }));\n';
  const artifact = f.artifactStore.freeze({
    artifactId: `ayas-patch-artifact-${crypto.randomUUID()}`,
    candidateId: "ayas-novel-fixture", generatorIdentity: "ayas-detector:diagnostic-quality-gap-v1",
    baseBranch: "master", baseHead: head, exactFiles: ["scripts/smoke-fixture-generated.ts"], allowedRoots: ["scripts/"],
    replacements: [{ filePath: "scripts/smoke-fixture-generated.ts", expectedHash: null, content, allowCreate: true }],
    validatorScripts: [], graphifyEvidence: ["fixture"], graphifyImportCounts: { "scripts/smoke-fixture-generated.ts": 0 },
    safetyClassification: "SAFE", problemStatement: "p", rationale: "r", expectedUserBenefit: "b", expectedBehaviorChange: "c",
    unchangedBehavior: "u", risk: "low", productionImpact: "none", sandboxValidationSummary: ["PASS"], generatedAt: "2026-09-18T00:00:00.000Z",
  } as never);
  const proposal = f.inbox.createProposal(proposalInput({ baseHead: head, exactFiles: artifact.exactFiles, patchArtifactId: artifact.artifactId, patchHash: artifact.patchHash } as never));
  return { proposal, artifact, head };
}

/** A SOURCE_ONLY proposal: an edit to a pre-existing, non-smoke `scripts/` file. */
function seedSourceOnlyProposal(f: Fixture, opts: { readonly newContent: string }) {
  const targetFile = "scripts/existing-editable.ts";
  const originalContent = "export const value = 1;\n";
  fs.writeFileSync(path.join(f.repoRoot, targetFile), originalContent, "utf8");
  git(f.repoRoot, "add", "--", targetFile);
  git(f.repoRoot, "commit", "-q", "-m", "add editable file");
  const head = git(f.repoRoot, "rev-parse", "HEAD");
  const expectedHash = crypto.createHash("sha256").update(originalContent, "utf8").digest("hex");
  const artifact = f.artifactStore.freeze({
    artifactId: `ayas-patch-artifact-${crypto.randomUUID()}`,
    candidateId: "ayas-diagnostic-fixture", generatorIdentity: "ayas-detector:diagnostic-quality-gap-v1",
    baseBranch: "master", baseHead: head, exactFiles: [targetFile], allowedRoots: ["scripts/"],
    replacements: [{ filePath: targetFile, expectedHash, content: opts.newContent, allowCreate: false }],
    validatorScripts: [], graphifyEvidence: ["fixture"], graphifyImportCounts: { [targetFile]: 0 },
    safetyClassification: "SAFE", problemStatement: "p", rationale: "r", expectedUserBenefit: "b", expectedBehaviorChange: "c",
    unchangedBehavior: "u", risk: "low", productionImpact: "none", sandboxValidationSummary: ["PASS"], generatedAt: "2026-09-18T00:00:00.000Z",
  } as never);
  const proposal = f.inbox.createProposal(proposalInput({ baseHead: head, exactFiles: [targetFile], patchArtifactId: artifact.artifactId, patchHash: artifact.patchHash } as never));
  return { proposal, artifact, head, targetFile };
}

/** A proposal whose declared file scope reaches the storage/execution authority — never eligible for one-click publication. */
function seedAuthorityImpactProposal(f: Fixture, file = "src/lib/runtime/RuntimeStoragePaths.ts") {
  const head = git(f.repoRoot, "rev-parse", "HEAD");
  const artifact = f.artifactStore.freeze({
    artifactId: `ayas-patch-artifact-${crypto.randomUUID()}`,
    candidateId: "ayas-novel-authority-fixture", generatorIdentity: "ayas-detector:diagnostic-quality-gap-v1",
    baseBranch: "master", baseHead: head, exactFiles: [file], allowedRoots: ["src/"],
    replacements: [{ filePath: file, expectedHash: null, content: "export const moved = 1;\n", allowCreate: true }],
    validatorScripts: [], graphifyEvidence: ["fixture"], graphifyImportCounts: { [file]: 0 },
    safetyClassification: "SAFE", problemStatement: "p", rationale: "r", expectedUserBenefit: "b", expectedBehaviorChange: "c",
    unchangedBehavior: "u", risk: "low", productionImpact: "none", sandboxValidationSummary: ["PASS"], generatedAt: "2026-09-18T00:00:00.000Z",
  } as never);
  const proposal = f.inbox.createProposal(proposalInput({ baseHead: head, exactFiles: [file], patchArtifactId: artifact.artifactId, patchHash: artifact.patchHash } as never));
  return { proposal, artifact, head };
}

async function main(): Promise<void> {
  // ---------------------------------------------------------------------
  // Part A — the impact classification model (pure, no I/O).
  // ---------------------------------------------------------------------

  await scenario("a smoke-test file classifies TEST_ONLY and declares that restart checks are not applicable", () => {
    const decision = classifyAyasRuntimeImpact(["scripts/smoke-ayas-thing.ts"]);
    assert.equal(decision.impactClass, "TEST_ONLY");
    assert.equal(decision.publishable, true);
    assert.equal(decision.serviceRestartApplicable, false);
    assert.ok(decision.notApplicable.some((entry) => entry.startsWith("service-restart:")), "the record must state WHY the heavy restart checks did not run");
  });

  await scenario("ordinary source classifies SOURCE_ONLY and is publishable", () => {
    for (const file of ["src/lib/ai/AIManager.ts", "app/brain/page.tsx", "scripts/run-something.ts", "docs/Architecture.md", "README.md"]) {
      const decision = classifyAyasRuntimeImpact([file]);
      assert.equal(decision.impactClass, "SOURCE_ONLY", file);
      assert.equal(decision.publishable, true, file);
    }
  });

  await scenario("runtime config, scheduler, service entry and storage/execution authority each classify to their own non-publishable class", () => {
    const expected: ReadonlyArray<readonly [string, string]> = [
      [".env.local", "RUNTIME_CONFIG"],
      ["next.config.ts", "RUNTIME_CONFIG"],
      ["package.json", "RUNTIME_CONFIG"],
      ["tsconfig.json", "RUNTIME_CONFIG"],
      ["src/lib/brain/autonomy/AyasResearchScheduler.ts", "SCHEDULER"],
      ["scripts/ayas-research-tick.ts", "SCHEDULER"],
      ["middleware.ts", "SERVICE_RUNTIME"],
      ["src/instrumentation.ts", "SERVICE_RUNTIME"],
      ["data/brain/self-improvement/inbox.json", "AUTHORITY_OR_STORAGE"],
      ["src/lib/runtime/RuntimeStoragePaths.ts", "AUTHORITY_OR_STORAGE"],
      ["src/lib/storage/FileStorage.ts", "AUTHORITY_OR_STORAGE"],
      ["src/lib/production/ProductionDependencyGraph.ts", "AUTHORITY_OR_STORAGE"],
      ["src/lib/brain/autonomy/AyasAutonomousExecutionGate.ts", "AUTHORITY_OR_STORAGE"],
      ["src/lib/brain/autonomy/AyasRuntimeStabilityGuard.ts", "AUTHORITY_OR_STORAGE"],
    ];
    for (const [file, impactClass] of expected) {
      const decision = classifyAyasRuntimeImpact([file]);
      assert.equal(decision.impactClass, impactClass, file);
      assert.equal(decision.publishable, false, file);
      assert.deepEqual(decision.notApplicable, [], `${file}: a non-publishable class must not claim any check is inapplicable`);
      assert.equal(decision.serviceRestartApplicable, true, file);
    }
  });

  await scenario("the most restrictive file decides the whole publication, never the first one or an average", () => {
    assert.equal(classifyAyasRuntimeImpact(["scripts/smoke-a.ts", "scripts/smoke-b.ts"]).impactClass, "TEST_ONLY");
    assert.equal(classifyAyasRuntimeImpact(["scripts/smoke-a.ts", "src/lib/ai/AIManager.ts"]).impactClass, "SOURCE_ONLY");
    assert.equal(classifyAyasRuntimeImpact(["scripts/smoke-a.ts", "src/lib/runtime/RuntimeStoragePaths.ts"]).impactClass, "AUTHORITY_OR_STORAGE");
    assert.equal(classifyAyasRuntimeImpact(["src/lib/ai/AIManager.ts", "middleware.ts"]).impactClass, "SERVICE_RUNTIME");
  });

  await scenario("an unknown, traversing, absolute or empty path is UNKNOWN — the most restrictive class, never a favourable default", () => {
    for (const file of ["weird-thing.bin", "../escape.ts", "/etc/passwd", "C:/Windows/system32/x.ts", "", "src//double.ts"]) {
      assert.equal(classifyAyasRuntimeImpactFile(file).impactClass, "UNKNOWN", file);
    }
    assert.equal(classifyAyasRuntimeImpact([]).impactClass, "UNKNOWN", "a publication that declares no files has no provable runtime impact");
    assert.equal(classifyAyasRuntimeImpact([]).publishable, false);
  });

  await scenario("a src/lib/runtime path is classified by the authority rule, not by the broader src/ rule that also matches it", () => {
    assert.equal(classifyAyasRuntimeImpactFile("src/lib/runtime/RuntimeStoragePaths.ts").impactClass, "AUTHORITY_OR_STORAGE");
    assert.equal(classifyAyasRuntimeImpactFile("SRC/LIB/RUNTIME/RuntimeStoragePaths.ts").impactClass, "AUTHORITY_OR_STORAGE", "Windows path casing must not defeat the restrictive rule");
    assert.equal(classifyAyasRuntimeImpactFile("src\\lib\\runtime\\RuntimeStoragePaths.ts").impactClass, "AUTHORITY_OR_STORAGE", "a backslash spelling must not defeat the restrictive rule");
  });

  // ---------------------------------------------------------------------
  // Part B — the canonical execution path now necessarily emits a guard record.
  // ---------------------------------------------------------------------

  await scenario("END-TO-END: an owner-approved TEST_ONLY proposal is published through approval -> guard PREPARED -> mutation -> tests -> commit -> push -> guard COMPLETED, with the result recorded", async () => {
    const f = makeFixture();
    const { proposal } = seedTestOnlyProposal(f);
    const headBefore = git(f.repoRoot, "rev-parse", "HEAD");

    const result = await approveAndExecuteAyasProposal(proposal.proposalId, proposal.proposalHash, f);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    // the publication itself
    const localHead = git(f.repoRoot, "rev-parse", "HEAD");
    assert.equal(localHead, result.commitSha);
    assert.equal(localHead, git(f.remoteDir, "rev-parse", "master"), "local must equal the real bare remote");
    assert.notEqual(localHead, headBefore);
    assert.equal(git(f.repoRoot, "status", "--short"), "");
    assert.equal(f.inbox.load().proposals.find((p) => p.proposalId === proposal.proposalId)!.status, "COMPLETED", "the result must be recorded");

    // the guard record — this is what did not exist before this integration
    const transactions = transactionsFor(f, proposal.proposalId);
    assert.equal(transactions.length, 1, "exactly ONE stability transaction must exist for this publication");
    const transaction = transactions[0]!;
    assert.equal(transaction.state, "COMPLETED");
    assert.deepEqual(transaction.history.map((event) => event.state), ["PREPARED", "APPLYING", "VERIFYING", "COMPLETED"], "the durable record must show the full lifecycle, in order");
    assert.deepEqual(transaction.violations, [], "a COMPLETED record must durably assert zero out-of-scope changes");
    assert.deepEqual(transaction.healthFailures, [], "a COMPLETED record must durably assert zero health failures");
    assert.equal(transaction.before.repo.head, headBefore);
    assert.equal(transaction.after?.repo.head, localHead, "the after-snapshot must prove which commit this transaction produced");
    assert.deepEqual(transaction.before.gaps, [], "an incomplete snapshot could not certify anything");
    assert.deepEqual(transaction.after?.gaps, []);
  });

  await scenario("the durable record states the declared impact class and the checks that class rules out — a lightweight decision, never a silent absence", async () => {
    const f = makeFixture();
    const { proposal } = seedTestOnlyProposal(f);
    assert.equal((await approveAndExecuteAyasProposal(proposal.proposalId, proposal.proposalHash, f)).ok, true);

    const { scope } = transactionsFor(f, proposal.proposalId)[0]!;
    assert.equal(scope.impactClass, "TEST_ONLY");
    assert.ok((scope.notApplicable ?? []).some((entry) => entry.startsWith("service-restart:")));
    assert.ok((scope.notApplicable ?? []).some((entry) => entry.startsWith("runtime-config-reload:")));
    assert.ok((scope.notApplicable ?? []).some((entry) => entry.startsWith("process-identity-fingerprint:")));
    assert.deepEqual([...scope.allowed].sort(), ["git-history", "proposal-state", "research-scheduler", "source"], "a publication may move exactly these dimensions and no others");
    assert.deepEqual(scope.allowedPorts, [], "a publication may never take a port's ownership");
  });

  await scenario("a SOURCE_ONLY proposal uses the same lightweight guard scope, declaring SOURCE_ONLY rather than TEST_ONLY", async () => {
    const f = makeFixture();
    const { proposal } = seedSourceOnlyProposal(f, { newContent: "export const value = 2;\n" });
    const result = await approveAndExecuteAyasProposal(proposal.proposalId, proposal.proposalHash, f);
    assert.equal(result.ok, true);

    const transaction = transactionsFor(f, proposal.proposalId)[0]!;
    assert.equal(transaction.state, "COMPLETED");
    assert.equal(transaction.scope.impactClass, "SOURCE_ONLY");
    // "Lightweight" is a real, checked property: for a class that can never
    // restart a service, process-identity fingerprinting is skipped outright
    // and — crucially — skipping it records no snapshot gap.
    assert.equal(transaction.before.services.find((s) => s.port === FIXTURE_SERVICE_PORT)?.commandFingerprint, undefined);
    assert.deepEqual(transaction.before.gaps, []);
  });

  await scenario("a TEST_ONLY publication restarts nothing: the observed service keeps its pid, and an unrelated listener is untouched", async () => {
    const f = makeFixture();
    const { proposal } = seedTestOnlyProposal(f);
    assert.equal((await approveAndExecuteAyasProposal(proposal.proposalId, proposal.proposalHash, f)).ok, true);

    const transaction = transactionsFor(f, proposal.proposalId)[0]!;
    for (const port of [FIXTURE_SERVICE_PORT, FIXTURE_UNRELATED_PORT]) {
      const before = transaction.before.services.find((s) => s.port === port);
      const after = transaction.after?.services.find((s) => s.port === port);
      assert.equal(before?.listening, true, `port ${port} must have been observed listening beforehand`);
      assert.equal(after?.listening, true, `port ${port} must still be listening afterwards`);
      assert.equal(after?.pid, before?.pid, `port ${port} must keep the exact same owning pid — nothing may be restarted`);
    }
    assert.equal(f.listeners.get(FIXTURE_SERVICE_PORT), 15844, "the fixture listener table proves no process was signalled");
  });

  await scenario("the research scheduler is untouched by an unrelated publication, and its health is verified rather than assumed", async () => {
    const f = makeFixture();
    const stateBefore = fs.readFileSync(f.schedulerStore.file, "utf8");
    const { proposal } = seedTestOnlyProposal(f);
    assert.equal((await approveAndExecuteAyasProposal(proposal.proposalId, proposal.proposalHash, f)).ok, true);

    assert.equal(fs.readFileSync(f.schedulerStore.file, "utf8"), stateBefore, "the scheduler state file must be byte-identical");
    const transaction = transactionsFor(f, proposal.proposalId)[0]!;
    assert.deepEqual(transaction.after?.scheduler, transaction.before.scheduler);
    assert.deepEqual(transaction.healthFailures, [], "the scheduler health check was active (a cadence was present) and passed");
  });

  await scenario("the execution gate and the mandatory-owner-approval invariant are snapshotted before and after, and neither may move", async () => {
    const f = makeFixture();
    const { proposal } = seedTestOnlyProposal(f);
    assert.equal((await approveAndExecuteAyasProposal(proposal.proposalId, proposal.proposalHash, f)).ok, true);

    const transaction = transactionsFor(f, proposal.proposalId)[0]!;
    assert.equal(transaction.before.gate.autonomousExecutionEnabled, true);
    assert.equal(transaction.after?.gate.autonomousExecutionEnabled, true, "a publication that flipped the gate would have changed the rules it was authorised under");
    assert.equal(transaction.before.gate.ownerApprovalRequired, true);
    assert.equal(transaction.after?.gate.ownerApprovalRequired, true);
  });

  await scenario("the owner-approval resume entrypoint is guarded by the SAME single integration — one pipeline, one guard, two entrypoints", async () => {
    const f = makeFixture();
    const { proposal } = seedTestOnlyProposal(f);
    f.inbox.decide(proposal.proposalId, "APPROVE", new Date().toISOString());
    const result = await publishAlreadyOwnerApprovedAyasProposal(proposal.proposalId, proposal.proposalHash, f);
    assert.equal(result.ok, true);

    const transactions = transactionsFor(f, proposal.proposalId);
    assert.equal(transactions.length, 1);
    assert.equal(transactions[0]!.state, "COMPLETED");
  });

  // ---------------------------------------------------------------------
  // Part C — fail-closed: refusals that happen BEFORE any mutation.
  // ---------------------------------------------------------------------

  await scenario("a proposal whose declared scope reaches the storage/execution authority is refused before any decision, mutation or guard transaction", async () => {
    const f = makeFixture();
    const { proposal } = seedAuthorityImpactProposal(f);
    await assert.rejects(
      approveAndExecuteAyasProposal(proposal.proposalId, proposal.proposalHash, f),
      (e: unknown) => e instanceof AyasProposalApprovalError && e.code === "RUNTIME_IMPACT_NOT_PUBLISHABLE",
    );
    assert.equal(f.inbox.load().proposals.find((p) => p.proposalId === proposal.proposalId)!.status, "PENDING", "no approval may be minted for a proposal this lane can never publish");
    assert.equal(transactionsFor(f, proposal.proposalId).length, 0);
    assert.equal(git(f.repoRoot, "status", "--short"), "");
  });

  await scenario("a service-entry proposal is refused the same way — an impact class that would need a restart never reaches a lane that cannot perform one", async () => {
    const f = makeFixture();
    const { proposal } = seedAuthorityImpactProposal(f, "middleware.ts");
    await assert.rejects(
      approveAndExecuteAyasProposal(proposal.proposalId, proposal.proposalHash, f),
      (e: unknown) => e instanceof AyasProposalApprovalError && e.code === "RUNTIME_IMPACT_NOT_PUBLISHABLE",
    );
    assert.equal(transactionsFor(f, proposal.proposalId).length, 0);
  });

  await scenario("a dirty working tree fail-closes at the guard precondition: refused, nothing mutated, nothing committed", async () => {
    const f = makeFixture();
    const { proposal } = seedTestOnlyProposal(f);
    const headBefore = git(f.repoRoot, "rev-parse", "HEAD");
    fs.writeFileSync(path.join(f.repoRoot, "scripts", "unrelated-in-flight-work.ts"), "export const wip = 1;\n");

    const result = await approveAndExecuteAyasProposal(proposal.proposalId, proposal.proposalHash, f);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "AYAS_PROPOSAL_STABILITY_GUARD_REFUSED");
    assert.equal(result.stage, "STABILITY_GUARD");
    assert.match(result.message, /dirty/);
    assert.equal(git(f.repoRoot, "rev-parse", "HEAD"), headBefore, "no commit may be created");
    assert.equal(fs.existsSync(path.join(f.repoRoot, "scripts/smoke-fixture-generated.ts")), false, "the mutation must never have run");
    assert.ok(fs.existsSync(path.join(f.repoRoot, "scripts", "unrelated-in-flight-work.ts")), "the unrelated in-flight work must be left exactly as it was");
    assert.equal(transactionsFor(f, proposal.proposalId).length, 0, "a refusal happens before the transaction is opened — nothing was attempted");
  });

  await scenario("a proposalHash that no longer matches is refused before the guard is ever consulted — no decision, no transaction, no mutation", async () => {
    const f = makeFixture();
    const { proposal } = seedTestOnlyProposal(f);
    await assert.rejects(
      approveAndExecuteAyasProposal(proposal.proposalId, "stale-hash-value", f),
      (e: unknown) => e instanceof AyasProposalApprovalError && e.code === "PROPOSAL_HASH_MISMATCH",
    );
    assert.equal(f.inbox.load().proposals.find((p) => p.proposalId === proposal.proposalId)!.status, "PENDING");
    assert.equal(transactionsFor(f, proposal.proposalId).length, 0);
    assert.equal(git(f.repoRoot, "status", "--short"), "");
  });

  await scenario("the guard can neither approve a proposal nor be entered without an approval: a still-PENDING proposal is refused with no transaction", async () => {
    const f = makeFixture();
    const { proposal } = seedTestOnlyProposal(f);
    await assert.rejects(
      publishAlreadyOwnerApprovedAyasProposal(proposal.proposalId, proposal.proposalHash, f),
      (e: unknown) => e instanceof AyasProposalApprovalError && e.code === "NOT_READY",
    );
    assert.equal(f.inbox.load().proposals.find((p) => p.proposalId === proposal.proposalId)!.status, "PENDING", "the guard integration must never mint an approval");
    assert.equal(transactionsFor(f, proposal.proposalId).length, 0);
  });

  await scenario("source inspection: the guarded-publication module contains no approval, decision or process-termination primitive", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src", "lib", "brain", "autonomy", "AyasGuardedPublication.ts"), "utf8");
    assert.doesNotMatch(src, /\.decide\(/, "the guard must never record a decision");
    assert.doesNotMatch(src, /process\.kill|taskkill|SIGTERM|restartAyasOwnedService/, "the guard must never terminate or restart a process");
    assert.doesNotMatch(src, /"reset"|"revert"|"checkout"|--force|--hard/, "the guard must never mutate Git history or the working tree");
    // The only git invocations it may make are read-only observations.
    const gitCalls = [...src.matchAll(/git\(repoRoot, \[([^\]]*)\]/g)].map((match) => match[1]);
    assert.deepEqual(gitCalls, ['"rev-parse", "HEAD"', '"status", "--porcelain"'], "the guard reads HEAD and status, and nothing else");
  });

  // ---------------------------------------------------------------------
  // Part D — failure paths: rollback verification and honest escalation.
  // ---------------------------------------------------------------------

  await scenario("a stale proposal is recorded by the guard but mutates nothing: ROLLED_BACK with HEAD and the tree exactly as found", async () => {
    const f = makeFixture();
    const { proposal } = seedTestOnlyProposal(f);
    fs.writeFileSync(path.join(f.repoRoot, "scripts", "existing.ts"), "export const existing = 2;\n");
    git(f.repoRoot, "add", "-A"); git(f.repoRoot, "commit", "-q", "-m", "moved on");
    const headBefore = git(f.repoRoot, "rev-parse", "HEAD");

    const result = await approveAndExecuteAyasProposal(proposal.proposalId, proposal.proposalHash, f);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.stage, "EXECUTION", "HEAD-drift stays Package C's own staleness authority, reported at the EXECUTION stage exactly as before");
    assert.equal(f.inbox.load().proposals.find((p) => p.proposalId === proposal.proposalId)!.status, "STALE");

    const transaction = transactionsFor(f, proposal.proposalId)[0]!;
    assert.equal(transaction.state, "ROLLED_BACK", "the guard PROVED the baseline was restored");
    assert.equal(transaction.rollbackPerformed, true);
    assert.equal(git(f.repoRoot, "rev-parse", "HEAD"), headBefore);
    assert.equal(git(f.repoRoot, "status", "--short"), "");
  });

  await scenario("a post-execution validation failure is ROLLED_BACK with its ORIGINAL code and stage preserved — the guard reports the lane's truth, it does not relabel it", async () => {
    const f = makeFixture();
    // Valid JS, a real TypeScript error: passes Package C, fails the project-wide tsc.
    const { proposal, targetFile } = seedSourceOnlyProposal(f, { newContent: 'export const value: number = "not a number";\n' });
    const headBefore = git(f.repoRoot, "rev-parse", "HEAD");
    const contentAtHead = git(f.repoRoot, "show", `HEAD:${targetFile}`);

    const result = await approveAndExecuteAyasProposal(proposal.proposalId, proposal.proposalHash, f);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.stage, "POST_VALIDATION");
    assert.equal(result.code, "POST_EXECUTION_VALIDATION_FAILED");
    assert.doesNotMatch(result.message, /RECOVERY_REQUIRED/, "a proven rollback must not be annotated as unresolved");

    assert.equal(git(f.repoRoot, "rev-parse", "HEAD"), headBefore);
    assert.equal(git(f.repoRoot, "show", `HEAD:${targetFile}`), contentAtHead);
    assert.equal(git(f.repoRoot, "status", "--short"), "", "the lane's own revert must have restored the baseline exactly");
    assert.equal(transactionsFor(f, proposal.proposalId)[0]!.state, "ROLLED_BACK");
  });

  await scenario("a commit failure leaves staged content for a human and escalates to RECOVERY_REQUIRED — the guard proves it could NOT prove a clean baseline", async () => {
    const f = makeFixture();
    const { proposal } = seedTestOnlyProposal(f);
    const headBefore = git(f.repoRoot, "rev-parse", "HEAD");
    const hooksDir = path.join(f.repoRoot, ".git", "hooks");
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(path.join(hooksDir, "pre-commit"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });

    const result = await approveAndExecuteAyasProposal(proposal.proposalId, proposal.proposalHash, f);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.stage, "COMMIT");
    assert.equal(result.code, "AYAS_PROPOSAL_COMMIT_FAILED", "the lane's own code is preserved");
    assert.match(result.message, /runtime stability guard: RECOVERY_REQUIRED/, "the unresolved guard state must be surfaced, not swallowed");

    assert.equal(git(f.repoRoot, "rev-parse", "HEAD"), headBefore, "no commit was created");
    assert.notEqual(git(f.repoRoot, "status", "--short"), "", "the staged content is deliberately left for human inspection, never auto-reset");
    const transaction = transactionsFor(f, proposal.proposalId)[0]!;
    assert.equal(transaction.state, "RECOVERY_REQUIRED");
    assert.notEqual(transaction.rollbackPerformed, true);
    assert.match(String(transaction.reason), /uncommitted/);
  });

  await scenario("a push failure preserves the local commit and escalates to RECOVERY_REQUIRED — the guard never rewrites a real commit to satisfy a probe", async () => {
    const f = makeFixture();
    const otherClone = root();
    git(otherClone, "clone", "-q", f.remoteDir, ".");
    git(otherClone, "config", "user.email", "g@example.com"); git(otherClone, "config", "user.name", "g");
    fs.writeFileSync(path.join(otherClone, "elsewhere.ts"), "export const elsewhere = 1;\n");
    git(otherClone, "add", "-A"); git(otherClone, "commit", "-q", "-m", "elsewhere");
    git(otherClone, "push", "-q", "origin", "master");

    const { proposal } = seedTestOnlyProposal(f);
    const headBefore = git(f.repoRoot, "rev-parse", "HEAD");
    const result = await approveAndExecuteAyasProposal(proposal.proposalId, proposal.proposalHash, f);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.stage, "PUSH");
    assert.match(result.message, /runtime stability guard: RECOVERY_REQUIRED/);

    assert.notEqual(git(f.repoRoot, "rev-parse", "HEAD"), headBefore, "the local commit must survive — a guard probe never justifies rewriting history");
    const transaction = transactionsFor(f, proposal.proposalId)[0]!;
    assert.equal(transaction.state, "RECOVERY_REQUIRED");
    assert.match(String(transaction.reason), /HEAD moved/);
  });

  await scenario("a postcondition failure after a successful push is reported and escalated, and the published commit is still never rewritten", async () => {
    const f = makeFixture();
    const { proposal } = seedTestOnlyProposal(f);
    // An unrelated listener disappears WHILE the publication runs. `service`
    // is not a declared dimension, so this is an out-of-scope violation —
    // exactly the "my change took an unrelated process down with it" case.
    const deps: Fixture = { ...f, onAfterCommitBeforePush: () => { f.listeners.delete(FIXTURE_UNRELATED_PORT); } };

    const result = await approveAndExecuteAyasProposal(proposal.proposalId, proposal.proposalHash, deps);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "AYAS_PROPOSAL_STABILITY_POSTCONDITION_FAILED");
    assert.equal(result.stage, "STABILITY_GUARD");
    assert.match(result.message, new RegExp(String(FIXTURE_UNRELATED_PORT)), "the refusal must name the disturbed port");

    const transaction = transactionsFor(f, proposal.proposalId)[0]!;
    assert.equal(transaction.state, "RECOVERY_REQUIRED");
    assert.ok((transaction.violations ?? []).some((entry) => entry.includes("DIMENSION_NOT_DECLARED")), "the durable record must name the undeclared dimension that moved");
    assert.equal(git(f.repoRoot, "rev-parse", "HEAD"), git(f.remoteDir, "rev-parse", "master"), "the commit was genuinely published and is left exactly as-is");
  });

  // ---------------------------------------------------------------------
  // Part E — durability, recovery, and guard/journal reconciliation.
  // ---------------------------------------------------------------------

  await scenario("replay is impossible: a second call on a COMPLETED proposal is refused, leaving exactly one commit and exactly one guard transaction", async () => {
    const f = makeFixture();
    const { proposal } = seedTestOnlyProposal(f);
    const first = await approveAndExecuteAyasProposal(proposal.proposalId, proposal.proposalHash, f);
    assert.equal(first.ok, true);
    const commitsAfterFirst = Number(git(f.repoRoot, "rev-list", "--count", "HEAD"));

    await assert.rejects(
      approveAndExecuteAyasProposal(proposal.proposalId, proposal.proposalHash, f),
      (e: unknown) => e instanceof AyasProposalApprovalError && e.code === "NOT_READY",
    );
    await assert.rejects(
      publishAlreadyOwnerApprovedAyasProposal(proposal.proposalId, proposal.proposalHash, f),
      (e: unknown) => e instanceof AyasProposalApprovalError && e.code === "NOT_READY",
    );
    assert.equal(Number(git(f.repoRoot, "rev-list", "--count", "HEAD")), commitsAfterFirst, "the same mutation must never be committed twice");
    assert.equal(git(f.repoRoot, "rev-parse", "HEAD"), git(f.remoteDir, "rev-parse", "master"), "and never pushed twice");
    assert.equal(transactionsFor(f, proposal.proposalId).length, 1);
  });

  await scenario("a publication already in flight for the same proposal under a LIVE process blocks a duplicate — no second mutation is attempted", async () => {
    const f = makeFixture();
    const { proposal } = seedTestOnlyProposal(f);
    // A transaction owned by THIS (alive) process: the crash-recovery sweep
    // correctly leaves it alone, so reconciliation is what must refuse.
    const inFlight = f.transactionStore.begin(
      ayasPublicationOperationName("proposal", proposal.proposalId),
      { operation: "x", allowed: [], allowedPorts: [] },
      { schemaVersion: "1", capturedAt: "2026-09-18T00:00:00.000Z", repo: { branch: "master", head: "0".repeat(40), clean: true, dirtyEntryCount: 0 }, services: [], gate: { autonomousExecutionEnabled: true, ownerApprovalRequired: true }, scheduler: { consecutiveFailures: 0, runInFlight: false, stateFilePresent: false }, proposals: { statusCounts: {}, pendingProposalIds: [], approvedProposalIds: [], decisionCount: 0, resultCount: 0 }, env: [], gaps: [] },
    );
    f.transactionStore.transition(inFlight.transactionId, "APPLYING");

    const result = await approveAndExecuteAyasProposal(proposal.proposalId, proposal.proposalHash, f);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "AYAS_PROPOSAL_STABILITY_GUARD_REFUSED");
    assert.match(result.message, /still APPLYING/);
    assert.equal(fs.existsSync(path.join(f.repoRoot, "scripts/smoke-fixture-generated.ts")), false, "no second mutation may be attempted");
  });

  await scenario("an interrupted transaction recovers deterministically — PREPARED is provably untouched (ABANDONED), anything later is RECOVERY_REQUIRED and then blocks the next attempt", async () => {
    const f = makeFixture();
    const { proposal } = seedTestOnlyProposal(f);
    const snapshot = { schemaVersion: "1" as const, capturedAt: "2026-09-18T00:00:00.000Z", repo: { branch: "master", head: "0".repeat(40), clean: true, dirtyEntryCount: 0 }, services: [], gate: { autonomousExecutionEnabled: true, ownerApprovalRequired: true }, scheduler: { consecutiveFailures: 0, runInFlight: false, stateFilePresent: false }, proposals: { statusCounts: {}, pendingProposalIds: [], approvedProposalIds: [], decisionCount: 0, resultCount: 0 }, env: [], gaps: [] };
    const scope = { operation: "x", allowed: [], allowedPorts: [] };

    // Two orphaned transactions from a dead process, one in each class.
    const dead = createAyasStabilityTransactionStore({ rootDir: path.dirname(f.transactionStore.file), pid: 999_999 });
    const prepared = dead.begin(ayasPublicationOperationName("proposal", "other-proposal"), scope, snapshot);
    const applying = dead.begin(ayasPublicationOperationName("proposal", proposal.proposalId), scope, snapshot);
    dead.transition(applying.transactionId, "APPLYING");

    const outcomes = recoverInterruptedAyasStabilityTransactions({ store: f.transactionStore, isProcessAlive: () => false });
    assert.deepEqual(
      outcomes.map((o) => [o.transactionId, o.recoveredState]).sort(),
      [[applying.transactionId, "RECOVERY_REQUIRED"], [prepared.transactionId, "ABANDONED"]].sort(),
      "recovery is decided by WHERE the process died, with no timeout and no 'probably fine' branch",
    );
    // Same input ledger, same output: a second sweep changes nothing.
    assert.deepEqual(recoverInterruptedAyasStabilityTransactions({ store: f.transactionStore, isProcessAlive: () => false }), []);

    const result = await approveAndExecuteAyasProposal(proposal.proposalId, proposal.proposalHash, f);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "AYAS_PROPOSAL_STABILITY_GUARD_REFUSED");
    assert.match(result.message, /RECOVERY_REQUIRED and must be resolved by a human/);
    assert.equal(fs.existsSync(path.join(f.repoRoot, "scripts/smoke-fixture-generated.ts")), false);
  });

  await scenario("guard state and the execution journal reconcile: an interrupted journal entry blocks a publication even when the guard's own log is clean", async () => {
    const f = makeFixture();
    const { proposal } = seedTestOnlyProposal(f);
    createAyasExecutionJournal({ rootDir: f.gateRoot }).record({
      schemaVersion: ayasExecutionJournalSchemaVersion,
      executionId: "ayas-exec-interrupted",
      proposalId: proposal.proposalId,
      proposalHash: proposal.proposalHash,
      baseHead: proposal.baseHead,
      exactFiles: proposal.exactFiles,
      phase: "EXECUTING",
      startedAt: "2026-09-18T00:00:00.000Z",
      updatedAt: "2026-09-18T00:00:00.000Z",
    });
    assert.equal(f.transactionStore.load().transactions.length, 0, "the guard's own log is clean — only the journal knows");

    const result = await approveAndExecuteAyasProposal(proposal.proposalId, proposal.proposalHash, f);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "AYAS_PROPOSAL_STABILITY_GUARD_REFUSED");
    assert.match(result.message, /MUTATION_UNCERTAIN/);
    assert.equal(fs.existsSync(path.join(f.repoRoot, "scripts/smoke-fixture-generated.ts")), false);
  });

  await scenario("an unreadable durable ledger is a refusal, never an empty history — a corrupt store can not make an interrupted transaction disappear", () => {
    const f = makeFixture();
    fs.writeFileSync(f.transactionStore.file, "{ not json", "utf8");
    const reasons = findUnresolvedAyasPublicationState("proposal", "any-proposal", { transactionStore: f.transactionStore, gateRoot: f.gateRoot });
    assert.ok(reasons.some((reason) => reason.includes("unreadable")), "fail closed on a corrupt ledger");
  });

  await scenario("a completed execution journal does NOT block a later publication — reconciliation refuses only genuinely unresolved attempts", () => {
    const f = makeFixture();
    createAyasExecutionJournal({ rootDir: f.gateRoot }).record({
      schemaVersion: ayasExecutionJournalSchemaVersion,
      executionId: "ayas-exec-done",
      proposalId: "settled-proposal",
      proposalHash: "h",
      baseHead: "0".repeat(40),
      exactFiles: ["scripts/smoke-x.ts"],
      phase: "RESULT_RECORDED",
      startedAt: "2026-09-18T00:00:00.000Z",
      updatedAt: "2026-09-18T00:00:00.000Z",
    });
    assert.deepEqual(findUnresolvedAyasPublicationState("proposal", "settled-proposal", { transactionStore: f.transactionStore, gateRoot: f.gateRoot }), []);
  });

  await scenario("a transaction for a DIFFERENT proposal never blocks this one — reconciliation is bound to the exact subject id", () => {
    const f = makeFixture();
    const snapshot = { schemaVersion: "1" as const, capturedAt: "2026-09-18T00:00:00.000Z", repo: { branch: "master", head: "0".repeat(40), clean: true, dirtyEntryCount: 0 }, services: [], gate: { autonomousExecutionEnabled: true, ownerApprovalRequired: true }, scheduler: { consecutiveFailures: 0, runInFlight: false, stateFilePresent: false }, proposals: { statusCounts: {}, pendingProposalIds: [], approvedProposalIds: [], decisionCount: 0, resultCount: 0 }, env: [], gaps: [] };
    const other = f.transactionStore.begin(ayasPublicationOperationName("proposal", "someone-else"), { operation: "x", allowed: [], allowedPorts: [] }, snapshot);
    f.transactionStore.transition(other.transactionId, "APPLYING");
    assert.deepEqual(findUnresolvedAyasPublicationState("proposal", "mine", { transactionStore: f.transactionStore, gateRoot: f.gateRoot }), []);
    assert.equal(findUnresolvedAyasPublicationState("proposal", "someone-else", { transactionStore: f.transactionStore, gateRoot: f.gateRoot }).length, 1);
  });

  await scenario("source inspection: the canonical publish boundary cannot be reached except through the guard", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src", "lib", "brain", "autonomy", "AyasProposalApprovalService.ts"), "utf8");
    // Prose that merely NAMES the pipeline is not a path to it, so comments
    // are stripped before counting — otherwise this check would fail the
    // moment someone documented the boundary it exists to protect.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    assert.doesNotMatch(code, /export .*runAyasProposalPublishPipeline/, "the unguarded pipeline must never be exported");
    assert.equal((code.match(/runAyasProposalPublishPipeline/g) ?? []).length, 2, "exactly one declaration and exactly one call site — the guard's");
    assert.match(code, /publish: \(\) => runAyasProposalPublishPipeline\(approved, deps\)/);
  });

  console.log(`AYAS guarded publication integration smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-guarded-publication", scenarios: count }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
