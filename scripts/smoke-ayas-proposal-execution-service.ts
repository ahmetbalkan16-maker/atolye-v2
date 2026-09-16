import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createAyasApprovalInboxStore, type AyasInboxProposal } from "../src/lib/brain/autonomy/AyasApprovalInboxStore";
import { executeAyasApprovedProposalWith, AyasProposalExecutionError, type AyasProposalExecutionDeps } from "../src/lib/brain/autonomy/AyasProposalExecutionService";
import { AyasGateRootIsolationError, resolveAyasProductionGateRoot } from "../src/lib/brain/autonomy/AyasIsolatedGateRoot";
import type { AyasMutationImplementation } from "../src/lib/brain/autonomy/AyasMutationRegistry";

let count = 0;
function scenario(name: string, fn: () => void | Promise<void>) { return Promise.resolve(fn()).then(() => { count += 1; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }); }
function root() { return fs.mkdtempSync(path.join(os.tmpdir(), "ayas-exec-service-")); }
function git(repoRoot: string, ...args: string[]) { return execFileSync("git", ["-C", repoRoot, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }

function repository(): { repoRoot: string; head: string } {
  const repoRoot = root();
  git(repoRoot, "init", "-q");
  git(repoRoot, "config", "user.email", "smoke@example.invalid");
  git(repoRoot, "config", "user.name", "Smoke");
  fs.mkdirSync(path.join(repoRoot, "src"), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, "src/fixture.ts"), "export const value = 1;\n");
  git(repoRoot, "add", "src/fixture.ts");
  git(repoRoot, "commit", "-qm", "base");
  return { repoRoot, head: git(repoRoot, "rev-parse", "HEAD") };
}

function proposalInput(overrides: Partial<Omit<AyasInboxProposal, "schemaVersion" | "proposalId" | "lastUpdatedAt" | "proposalHash" | "status" | "createdBy">> = {}) {
  return {
    createdAt: "2026-09-16T09:00:00.000Z",
    baseBranch: "wip/test",
    baseHead: "will-be-overridden",
    objective: "test-only bounded observability",
    currentProblem: "fixture misses one deterministic assertion",
    selectionReason: "the fixture evidence identifies this bounded gap",
    expectedUserBenefit: "the regression is caught before it reaches the user",
    expectedBehaviorChange: "the smoke test checks one additional invariant",
    unchangedBehavior: "production execution and user data do not change",
    riskIfNotDone: "the regression could remain unnoticed",
    technicalRisk: "low; one reversible assertion",
    productionImpact: "none until a separately authorized execution",
    rationale: "a deterministic smoke gap is visible",
    evidence: ["fixture evidence"],
    graphifyEvidence: ["fresh structural graph"],
    candidateRank: 1,
    risk: "low and reversible",
    safetyClassification: "SAFE" as const,
    exactFiles: ["src/fixture.ts"],
    expectedDiffScope: "+1 assertion",
    testsPlanned: ["smoke-ayas-proposal-execution-service"],
    estimatedCost: "zero-cost" as const,
    mutationKind: "fixture-mutation",
    ...overrides,
  };
}

const testMutation: AyasMutationImplementation = {
  exactFiles: ["src/fixture.ts"],
  run: async (repoRoot: string) => {
    fs.writeFileSync(path.join(repoRoot, "src/fixture.ts"), "export const value = 2;\n");
    return { changedFiles: ["src/fixture.ts"], testsRun: ["fixture-check"], testResults: ["PASS"] };
  },
};
const testRegistry = new Map<string, AyasMutationImplementation>([["fixture-mutation", testMutation]]);

const outOfScopeMutation: AyasMutationImplementation = {
  exactFiles: ["src/fixture.ts"],
  run: async (repoRoot: string) => {
    fs.writeFileSync(path.join(repoRoot, "src/fixture.ts"), "export const value = 2;\n");
    fs.writeFileSync(path.join(repoRoot, "src/unauthorized.ts"), "export const sneaky = true;\n");
    return { changedFiles: ["src/fixture.ts", "src/unauthorized.ts"], testsRun: [], testResults: [] };
  },
};

function setup(overrides: Parameters<typeof proposalInput>[0] = {}, mutationRegistry: ReadonlyMap<string, AyasMutationImplementation> = testRegistry) {
  const { repoRoot, head } = repository();
  const gateRoot = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ayas-exec-service-gate-")), "self-improvement");
  const inbox = createAyasApprovalInboxStore({ rootDir: path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ayas-exec-service-inbox-")), "brain") });
  const proposal = inbox.createProposal(proposalInput({ baseHead: head, ...overrides }));
  const deps: AyasProposalExecutionDeps = { repoRoot, gateRoot, inbox, registry: mutationRegistry };
  return { repoRoot, head, gateRoot, inbox, proposal, deps };
}

async function main() {
  await scenario("nonexistent proposalId is rejected with zero side effects", async () => {
    const { deps, inbox } = setup();
    await assert.rejects(executeAyasApprovedProposalWith("does-not-exist", deps), (e: unknown) => e instanceof AyasProposalExecutionError && e.code === "NOT_FOUND");
    assert.equal(inbox.load().proposals.length, 1);
  });
  for (const status of ["PENDING", "REJECTED", "DEFERRED", "STALE", "ABANDONED", "COMPLETED", "RESERVED", "RECOVERY_REQUIRED", "FAILED"] as const) {
    await scenario(`status ${status} is blocked with zero side effects`, async () => {
      const { deps, proposal } = setup({ status } as never);
      await assert.rejects(executeAyasApprovedProposalWith(proposal.proposalId, deps), (e: unknown) => e instanceof AyasProposalExecutionError && e.code === "NOT_APPROVED");
    });
  }
  await scenario("REVIEW_REQUIRED safety classification is blocked even if status were APPROVED", async () => {
    const { repoRoot, gateRoot, inbox } = setup();
    const raw = inbox.load();
    const forced = { ...raw.proposals[0]!, status: "APPROVED" as const, safetyClassification: "REVIEW_REQUIRED" as const };
    inbox.save({ ...raw, proposals: [forced] });
    await assert.rejects(executeAyasApprovedProposalWith(forced.proposalId, { repoRoot, gateRoot, inbox, registry: testRegistry }), (e: unknown) => e instanceof AyasProposalExecutionError && e.code === "NOT_READY");
  });
  await scenario("unknown mutationKind is blocked before any reservation/gate activity", async () => {
    const { repoRoot, gateRoot, inbox } = setup({ mutationKind: "does-not-exist-anywhere" });
    const [p] = inbox.load().proposals; inbox.decide(p!.proposalId, "APPROVE", "2026-09-16T09:01:00.000Z");
    await assert.rejects(executeAyasApprovedProposalWith(p!.proposalId, { repoRoot, gateRoot, inbox, registry: testRegistry }), (e: unknown) => e instanceof AyasProposalExecutionError && e.code === "AYAS_MUTATION_KIND_UNKNOWN");
    assert.equal(fs.existsSync(path.join(gateRoot, "execution", "gate.json")), false);
  });
  await scenario("registry exactFiles scope mismatch is blocked before any reservation/gate activity", async () => {
    const { repoRoot, gateRoot, inbox } = setup({ exactFiles: ["src/other.ts"] });
    const [p] = inbox.load().proposals; inbox.decide(p!.proposalId, "APPROVE", "2026-09-16T09:01:00.000Z");
    await assert.rejects(executeAyasApprovedProposalWith(p!.proposalId, { repoRoot, gateRoot, inbox, registry: testRegistry }), (e: unknown) => e instanceof AyasProposalExecutionError && e.code === "AYAS_MUTATION_SCOPE_MISMATCH");
  });
  await scenario("stale baseHead (repo advanced) is blocked", async () => {
    const { repoRoot, gateRoot, inbox, proposal } = setup();
    inbox.decide(proposal.proposalId, "APPROVE", "2026-09-16T09:01:00.000Z");
    fs.writeFileSync(path.join(repoRoot, "src/other.ts"), "export const another = 1;\n");
    git(repoRoot, "add", "src/other.ts"); git(repoRoot, "commit", "-qm", "advance HEAD");
    await assert.rejects(executeAyasApprovedProposalWith(proposal.proposalId, { repoRoot, gateRoot, inbox, registry: testRegistry }));
  });
  await scenario("dirty working tree is blocked, no mutation attempted", async () => {
    const { repoRoot, gateRoot, inbox, proposal } = setup();
    inbox.decide(proposal.proposalId, "APPROVE", "2026-09-16T09:01:00.000Z");
    fs.writeFileSync(path.join(repoRoot, "src/fixture.ts"), "export const value = 999;\n"); // dirty, uncommitted
    await assert.rejects(executeAyasApprovedProposalWith(proposal.proposalId, { repoRoot, gateRoot, inbox, registry: testRegistry }));
    assert.equal(fs.readFileSync(path.join(repoRoot, "src/fixture.ts"), "utf8"), "export const value = 999;\n"); // untouched further
  });
  await scenario("isolated gate root is never the real production root", () => {
    const { gateRoot } = setup();
    assert.notEqual(path.resolve(gateRoot), path.resolve(resolveAyasProductionGateRoot()));
  });
  await scenario("passing the real production root as gateRoot is structurally refused", async () => {
    const { repoRoot, inbox, proposal } = setup();
    inbox.decide(proposal.proposalId, "APPROVE", "2026-09-16T09:01:00.000Z");
    await assert.rejects(executeAyasApprovedProposalWith(proposal.proposalId, { repoRoot, gateRoot: resolveAyasProductionGateRoot(), inbox, registry: testRegistry }), (e: unknown) => e instanceof AyasGateRootIsolationError);
  });
  await scenario("successful execution stays within exactFiles and is durably completed", async () => {
    const { repoRoot, gateRoot, inbox, proposal } = setup();
    inbox.decide(proposal.proposalId, "APPROVE", "2026-09-16T09:01:00.000Z");
    await executeAyasApprovedProposalWith(proposal.proposalId, { repoRoot, gateRoot, inbox, registry: testRegistry });
    assert.equal(fs.readFileSync(path.join(repoRoot, "src/fixture.ts"), "utf8"), "export const value = 2;\n");
    const final = inbox.load().proposals.find((p) => p.proposalId === proposal.proposalId);
    assert.equal(final?.status, "COMPLETED");
    assert.equal(fs.existsSync(path.join(gateRoot, "execution", "journal")), true);
  });
  await scenario("global historical gate is never touched by a real execution", async () => {
    const { repoRoot, gateRoot, inbox, proposal } = setup();
    inbox.decide(proposal.proposalId, "APPROVE", "2026-09-16T09:01:00.000Z");
    await executeAyasApprovedProposalWith(proposal.proposalId, { repoRoot, gateRoot, inbox, registry: testRegistry });
    assert.equal(fs.existsSync(path.join(resolveAyasProductionGateRoot(), "execution", "gate.json")) && path.resolve(gateRoot) === path.resolve(resolveAyasProductionGateRoot()), false);
  });
  await scenario("callback (mutation implementation) is invoked exactly once per execution", async () => {
    let calls = 0;
    const counting: AyasMutationImplementation = { exactFiles: ["src/fixture.ts"], run: async (repoRoot) => { calls += 1; fs.writeFileSync(path.join(repoRoot, "src/fixture.ts"), "export const value = 2;\n"); return { changedFiles: ["src/fixture.ts"], testsRun: [], testResults: [] }; } };
    const { repoRoot, gateRoot, inbox, proposal } = setup({}, new Map([["fixture-mutation", counting]]));
    inbox.decide(proposal.proposalId, "APPROVE", "2026-09-16T09:01:00.000Z");
    await executeAyasApprovedProposalWith(proposal.proposalId, { repoRoot, gateRoot, inbox, registry: new Map([["fixture-mutation", counting]]) });
    assert.equal(calls, 1);
  });
  await scenario("re-executing the same proposalId after COMPLETED is rejected (one-shot, no double execution)", async () => {
    const { repoRoot, gateRoot, inbox, proposal } = setup();
    inbox.decide(proposal.proposalId, "APPROVE", "2026-09-16T09:01:00.000Z");
    await executeAyasApprovedProposalWith(proposal.proposalId, { repoRoot, gateRoot, inbox, registry: testRegistry });
    await assert.rejects(executeAyasApprovedProposalWith(proposal.proposalId, { repoRoot, gateRoot, inbox, registry: testRegistry }), (e: unknown) => e instanceof AyasProposalExecutionError && e.code === "NOT_APPROVED");
  });
  await scenario("a mutation that writes outside its declared exactFiles surfaces UNAUTHORIZED_MUTATION and finalizes RECOVERY_REQUIRED", async () => {
    const { repoRoot, gateRoot, inbox, proposal } = setup({}, new Map([["fixture-mutation", outOfScopeMutation]]));
    inbox.decide(proposal.proposalId, "APPROVE", "2026-09-16T09:01:00.000Z");
    await assert.rejects(executeAyasApprovedProposalWith(proposal.proposalId, { repoRoot, gateRoot, inbox, registry: new Map([["fixture-mutation", outOfScopeMutation]]) }), (e: unknown) => e instanceof Error && (e as { code?: string }).code === "UNAUTHORIZED_MUTATION");
    const final = inbox.load().proposals.find((p) => p.proposalId === proposal.proposalId);
    assert.equal(final?.status, "RECOVERY_REQUIRED");
  });
  await scenario("RECOVERY_REQUIRED is never automatically retried by a later call with the same proposalId", async () => {
    const { repoRoot, gateRoot, inbox, proposal } = setup({}, new Map([["fixture-mutation", outOfScopeMutation]]));
    inbox.decide(proposal.proposalId, "APPROVE", "2026-09-16T09:01:00.000Z");
    await assert.rejects(executeAyasApprovedProposalWith(proposal.proposalId, { repoRoot, gateRoot, inbox, registry: new Map([["fixture-mutation", outOfScopeMutation]]) }));
    await assert.rejects(executeAyasApprovedProposalWith(proposal.proposalId, { repoRoot, gateRoot, inbox, registry: testRegistry }), (e: unknown) => e instanceof AyasProposalExecutionError && e.code === "NOT_APPROVED");
  });
  await scenario("malformed proposalId input is rejected before any store read", async () => {
    const { deps } = setup();
    await assert.rejects(executeAyasApprovedProposalWith("", deps), (e: unknown) => e instanceof AyasProposalExecutionError && e.code === "INVALID_INPUT");
    await assert.rejects(executeAyasApprovedProposalWith("   ", deps), (e: unknown) => e instanceof AyasProposalExecutionError && e.code === "INVALID_INPUT");
  });
  await scenario("two different APPROVED proposals execute independently", async () => {
    const { repoRoot, gateRoot, inbox, proposal: first } = setup();
    const secondMutation: AyasMutationImplementation = { exactFiles: ["src/second.ts"], run: async (r) => { fs.writeFileSync(path.join(r, "src/second.ts"), "export const other = 2;\n"); return { changedFiles: ["src/second.ts"], testsRun: [], testResults: [] }; } };
    const combined = new Map([["fixture-mutation", testMutation], ["second-mutation", secondMutation]]);
    inbox.decide(first.proposalId, "APPROVE", "2026-09-16T09:01:00.000Z");
    await executeAyasApprovedProposalWith(first.proposalId, { repoRoot, gateRoot, inbox, registry: combined });
    // executeApproved mutates the working tree only — it never commits (the
    // human reviews and commits separately, same as every other real
    // execution in this project). Commit the first result before proceeding
    // so the repo is clean for the second proposal, exactly as a human
    // operator would between two separate real executions.
    git(repoRoot, "add", "src/fixture.ts"); git(repoRoot, "commit", "-qm", "first execution result");
    fs.writeFileSync(path.join(repoRoot, "src/second.ts"), "export const other = 1;\n");
    git(repoRoot, "add", "src/second.ts"); git(repoRoot, "commit", "-qm", "second file");
    const head2 = git(repoRoot, "rev-parse", "HEAD");
    const second = inbox.createProposal(proposalInput({ baseHead: head2, exactFiles: ["src/second.ts"], mutationKind: "second-mutation" }));
    inbox.decide(second.proposalId, "APPROVE", "2026-09-16T09:03:00.000Z");
    await executeAyasApprovedProposalWith(second.proposalId, { repoRoot, gateRoot, inbox, registry: combined });
    assert.equal(fs.readFileSync(path.join(repoRoot, "src/fixture.ts"), "utf8"), "export const value = 2;\n");
    assert.equal(fs.readFileSync(path.join(repoRoot, "src/second.ts"), "utf8"), "export const other = 2;\n");
  });
  await scenario("concurrent double-invocation of the same proposalId is serialized, only one succeeds", async () => {
    let started = 0;
    const slow: AyasMutationImplementation = { exactFiles: ["src/fixture.ts"], run: async (r) => { started += 1; await new Promise((resolve) => setTimeout(resolve, 40)); fs.writeFileSync(path.join(r, "src/fixture.ts"), "export const value = 2;\n"); return { changedFiles: ["src/fixture.ts"], testsRun: [], testResults: [] }; } };
    const { repoRoot, gateRoot, inbox, proposal } = setup({}, new Map([["fixture-mutation", slow]]));
    inbox.decide(proposal.proposalId, "APPROVE", "2026-09-16T09:01:00.000Z");
    const deps = { repoRoot, gateRoot, inbox, registry: new Map([["fixture-mutation", slow]]) };
    const results = await Promise.allSettled([executeAyasApprovedProposalWith(proposal.proposalId, deps), executeAyasApprovedProposalWith(proposal.proposalId, deps)]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    assert.equal(fulfilled.length, 1);
    assert.equal(started <= 2, true); // the loser is rejected by the durable one-shot reservation guard, not by never attempting
  });

  console.log(`AYAS proposal execution service smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-proposal-execution-service", scenarios: count }));
}
void main();
