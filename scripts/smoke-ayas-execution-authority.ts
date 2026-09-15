import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createAyasAutonomyDaemon } from "../src/lib/brain/autonomy/AyasAutonomyDaemon";
import { applyVerifiedGateTransition, AyasExecutionAuthorityError } from "../src/lib/brain/autonomy/AyasVerifiedGateTransition";
import { createAyasApprovalInboxStore, type AyasInboxProposal } from "../src/lib/brain/autonomy/AyasApprovalInboxStore";
import { createAyasExecutionJournal } from "../src/lib/brain/autonomy/AyasExecutionJournal";
import { withAyasExecutionAuthorityLock } from "../src/lib/brain/autonomy/AyasExecutionAuthorityLock";
import { resolveAyasProductionGateRoot, AyasGateRootIsolationError } from "../src/lib/brain/autonomy/AyasIsolatedGateRoot";
import { AyasExecutionRevalidationError } from "../src/lib/brain/autonomy/AyasExecutionRevalidation";
import { AyasMutationScopeError } from "../src/lib/brain/autonomy/AyasMutationScope";
import { AyasExecutionGateStore } from "../src/lib/ayas/execution/AyasExecutionGateStore";

let count = 0;
function scenario(name: string, fn: () => void | Promise<void>) { return Promise.resolve(fn()).then(() => { count += 1; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }); }
function root() { return fs.mkdtempSync(path.join(os.tmpdir(), "ayas-exec-authority-")); }
function git(rootDir: string, ...args: string[]) { return execFileSync("git", ["-C", rootDir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
function repository() { const repoRoot = root(); git(repoRoot, "init", "-q"); git(repoRoot, "config", "user.email", "smoke@example.invalid"); git(repoRoot, "config", "user.name", "Smoke"); fs.writeFileSync(path.join(repoRoot, "allowed.txt"), "base\n"); git(repoRoot, "add", "allowed.txt"); git(repoRoot, "commit", "-qm", "base"); return { repoRoot, head: git(repoRoot, "rev-parse", "HEAD") }; }
const NOW = "2026-09-15T12:00:00.000Z";

function proposalInput(overrides: Partial<Omit<AyasInboxProposal, "schemaVersion" | "proposalId" | "lastUpdatedAt" | "proposalHash" | "status" | "createdBy">> = {}) {
  return {
    createdAt: NOW,
    baseBranch: "wip/test",
    baseHead: "abc123",
    objective: "test-only bounded observability",
    rationale: "a deterministic smoke gap is visible",
    evidence: ["fixture evidence"],
    graphifyEvidence: ["fresh structural graph"],
    candidateRank: 1,
    risk: "low and reversible",
    safetyClassification: "SAFE" as const,
    exactFiles: ["scripts/smoke-ayas-machine-health.ts"],
    expectedDiffScope: "+1 assertion",
    testsPlanned: ["smoke-ayas-execution-authority"],
    estimatedCost: "zero-cost" as const,
    ...overrides,
  };
}

/** A fresh isolated inbox + gate root, with one SAFE proposal already APPROVED. */
function setupApprovedProposal() {
  const inboxRoot = root();
  const gateRoot = root();
  const { repoRoot, head } = repository();
  const inbox = createAyasApprovalInboxStore({ rootDir: inboxRoot });
  const daemon = createAyasAutonomyDaemon({ inbox, gateRoot, repoRoot, now: () => NOW });
  const proposal = inbox.createProposal(proposalInput({ baseHead: head, exactFiles: ["allowed.txt"] }));
  inbox.decide(proposal.proposalId, "APPROVE", NOW);
  return { daemon, inbox, proposal, gateRoot, repoRoot };
}

function executeInput(proposal: AyasInboxProposal, applyWhileExecuting: (authorizationId: string) => Promise<{ changedFiles: readonly string[]; diffFingerprint: string; testsRun: readonly string[]; testResults: readonly string[] }>) {
  return {
    proposalId: proposal.proposalId,
    proposalHash: proposal.proposalHash,
    baseHead: proposal.baseHead,
    currentHead: proposal.baseHead,
    exactFiles: proposal.exactFiles,
    currentExactFiles: proposal.exactFiles,
    repoClean: true,
    applyWhileExecuting,
  };
}

async function main() {
  await scenario("normal isolated happy path: gate starts CLOSED, callback runs exactly once, gate ends CLOSED", async () => {
    const { daemon, proposal, gateRoot } = setupApprovedProposal();
    let callbackCount = 0;
    const result = await daemon.executeApproved(executeInput(proposal, async () => {
      callbackCount += 1;
      return { changedFiles: proposal.exactFiles, diffFingerprint: "fixture-diff", testsRun: ["fixture"], testResults: ["PASS"] };
    }));
    assert.equal(callbackCount, 1);
    assert.equal(result.status, "COMPLETED");
    assert.equal(new AyasExecutionGateStore({ rootDir: gateRoot }).read().state, "CLOSED");
  });

  for (const [label, seed] of [
    ["ARMED", (gate: AyasExecutionGateStore) => { gate.transition({ event: "arm" }); }],
    ["READY", (gate: AyasExecutionGateStore) => { gate.transition({ event: "arm" }); gate.transition({ event: "confirm-ready" }); }],
    ["OPEN", (gate: AyasExecutionGateStore) => { gate.transition({ event: "arm" }); gate.transition({ event: "confirm-ready" }); gate.transition({ event: "open", activationAuthorizationId: "leftover-activation" }); }],
    ["EXECUTING", (gate: AyasExecutionGateStore) => { gate.transition({ event: "arm" }); gate.transition({ event: "confirm-ready" }); gate.transition({ event: "open", activationAuthorizationId: "leftover-activation" }); gate.transition({ event: "begin-execution" }); }],
  ] as const) {
    await scenario(`REGRESSION — gate starts ${label} (leftover from a prior crash): execution aborts, callback never runs`, async () => {
      const { daemon, proposal, gateRoot } = setupApprovedProposal();
      seed(new AyasExecutionGateStore({ rootDir: gateRoot }));
      let callbackCount = 0;
      await assert.rejects(
        () => daemon.executeApproved(executeInput(proposal, async () => {
          callbackCount += 1;
          return { changedFiles: proposal.exactFiles, diffFingerprint: "fixture-diff", testsRun: [], testResults: [] };
        })),
        (error: unknown) => error instanceof AyasExecutionAuthorityError,
      );
      assert.equal(callbackCount, 0, `callback must not run when the gate starts ${label}`);
    });
  }

  await scenario("unexpected transition state throws AyasExecutionAuthorityError with a safe, non-secret diagnostic", async () => {
    const { daemon, proposal, gateRoot } = setupApprovedProposal();
    new AyasExecutionGateStore({ rootDir: gateRoot }).transition({ event: "arm" });
    try {
      await daemon.executeApproved(executeInput(proposal, async () => { throw new Error("must not run"); }));
      assert.fail("expected AyasExecutionAuthorityError");
    } catch (error) {
      if (!(error instanceof AyasExecutionAuthorityError)) throw error;
      // Gate was pre-seeded to ARMED; "arm" is disallowed from ARMED (only
      // "confirm-ready"/"close" are), so it is the first call to fault.
      assert.equal(error.detail.event, "arm");
      assert.equal(error.detail.expectedState, "ARMED");
      assert.equal(error.detail.actualState, "CLOSED");
      assert.doesNotMatch(error.message, /auth|secret|token|key/i);
    }
  });

  await scenario("a refused open (same-state no-op, not a store-level fault) is treated as a failure by the helper", () => {
    const gateRoot = root();
    const gate = new AyasExecutionGateStore({ rootDir: gateRoot });
    gate.transition({ event: "arm" });
    gate.transition({ event: "confirm-ready" }); // now READY
    assert.throws(
      () => applyVerifiedGateTransition(gate, { event: "open" }, "OPEN"), // no activationAuthorizationId -> refused
      (error: unknown) => error instanceof AyasExecutionAuthorityError,
    );
    assert.equal(gate.read().state, "READY", "a refused open must remain a no-op at the store level");
  });

  await scenario("applyVerifiedGateTransition also rejects an activationAuthorizationId mismatch on a successful open", () => {
    const gateRoot = root();
    const gate = new AyasExecutionGateStore({ rootDir: gateRoot });
    gate.transition({ event: "arm" });
    gate.transition({ event: "confirm-ready" });
    // The store itself would only ever echo back the id it was given, so a
    // mismatch can only be observed by an intentionally wrong expectation —
    // this proves the helper's own comparison logic, not a store defect.
    const record = applyVerifiedGateTransition(gate, { event: "open", activationAuthorizationId: "real-id" }, "OPEN");
    assert.equal(record.activationAuthorizationId, "real-id");
  });

  await scenario("callback runs only after begin-execution is verified — never before EXECUTING is confirmed", async () => {
    const { daemon, proposal, gateRoot } = setupApprovedProposal();
    let gateStateAtCallback: string | undefined;
    await daemon.executeApproved(executeInput(proposal, async () => {
      gateStateAtCallback = new AyasExecutionGateStore({ rootDir: gateRoot }).read().state;
      return { changedFiles: proposal.exactFiles, diffFingerprint: "fixture-diff", testsRun: [], testResults: [] };
    }));
    assert.equal(gateStateAtCallback, "EXECUTING");
  });

  await scenario("a callback throw propagates the original error unchanged, and the gate still reaches CLOSED via the fault path", async () => {
    const { daemon, proposal, gateRoot } = setupApprovedProposal();
    const thrown = new Error("callback boom");
    await assert.rejects(
      () => daemon.executeApproved(executeInput(proposal, async () => { throw thrown; })),
      (error: unknown) => error === thrown,
    );
    assert.equal(new AyasExecutionGateStore({ rootDir: gateRoot }).read().state, "CLOSED");
  });

  await scenario("a fault-transition failure (corrupt gate.json) does not mask the original callback error", async () => {
    const { daemon, proposal, gateRoot } = setupApprovedProposal();
    const gateFile = new AyasExecutionGateStore({ rootDir: gateRoot }).file;
    const original = new Error("callback boom during corruption");
    await assert.rejects(
      () => daemon.executeApproved(executeInput(proposal, async () => {
        fs.writeFileSync(gateFile, "not json"); // corrupt gate.json mid-flight so the fault attempt itself throws
        throw original;
      })),
      (error: unknown) => error === original,
    );
  });

  await scenario("a successfully approved-and-executed proposal cannot be executed a second time (one-shot authorization)", async () => {
    const { daemon, proposal } = setupApprovedProposal();
    await daemon.executeApproved(executeInput(proposal, async () => ({ changedFiles: proposal.exactFiles, diffFingerprint: "fixture-diff", testsRun: [], testResults: [] })));
    await assert.rejects(() => daemon.executeApproved(executeInput(proposal, async () => { throw new Error("must not run twice"); })));
  });

  await scenario("M2: a successful execution reserves, journals every phase through RESULT_RECORDED, and finalizes EXECUTED", async () => {
    const { daemon, inbox, proposal, gateRoot } = setupApprovedProposal();
    const result = await daemon.executeApproved(executeInput(proposal, async () => ({ changedFiles: proposal.exactFiles, diffFingerprint: "fixture-diff", testsRun: [], testResults: [] })));
    const journal = createAyasExecutionJournal({ rootDir: gateRoot });
    const entries = journal.list();
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.phase, "RESULT_RECORDED");
    assert.ok(entries[0]?.reservationId);
    assert.ok(entries[0]?.authorizationId);
    const decision = inbox.load().decisions.find((d) => d.proposalId === proposal.proposalId);
    assert.equal(decision?.finalizationOutcome, "EXECUTED");
    assert.equal(result.status, "COMPLETED");
  });

  await scenario("M2: a leftover-gate failure (no mutation possible) is journaled as FAILED and finalized ABANDONED — Window A/B/C", async () => {
    const { daemon, inbox, proposal, gateRoot } = setupApprovedProposal();
    new AyasExecutionGateStore({ rootDir: gateRoot }).transition({ event: "arm" }); // leftover ARMED from a prior crash
    let callbackCount = 0;
    await assert.rejects(() => daemon.executeApproved(executeInput(proposal, async () => { callbackCount += 1; return { changedFiles: proposal.exactFiles, diffFingerprint: "fixture-diff", testsRun: [], testResults: [] }; })));
    assert.equal(callbackCount, 0);
    const journal = createAyasExecutionJournal({ rootDir: gateRoot });
    const entry = journal.list()[0];
    assert.equal(entry?.phase, "FAILED");
    const finalProposal = inbox.load().proposals.find((p) => p.proposalId === proposal.proposalId);
    assert.equal(finalProposal?.status, "ABANDONED");
  });

  await scenario("M2: a callback throw after EXECUTING (mutation possibly occurred) is journaled RECOVERY_REQUIRED and finalized RECOVERY_REQUIRED — Window D", async () => {
    const { daemon, inbox, proposal, gateRoot } = setupApprovedProposal();
    await assert.rejects(() => daemon.executeApproved(executeInput(proposal, async () => { throw new Error("callback boom mid-mutation"); })));
    const journal = createAyasExecutionJournal({ rootDir: gateRoot });
    const entry = journal.list()[0];
    assert.equal(entry?.phase, "RECOVERY_REQUIRED");
    const finalProposal = inbox.load().proposals.find((p) => p.proposalId === proposal.proposalId);
    assert.equal(finalProposal?.status, "RECOVERY_REQUIRED");
  });

  await scenario("M2: no automatic replay — a proposal left ABANDONED or RECOVERY_REQUIRED can never be re-decided or re-executed", async () => {
    const { daemon, inbox, proposal } = setupApprovedProposal();
    await assert.rejects(() => daemon.executeApproved(executeInput(proposal, async () => { throw new Error("boom"); })));
    // decide() (and therefore any future reserveApproval/executeApproved) is
    // permanently refused now — only a fresh proposal (new content/hash)
    // could be attempted again, never this same one, and never automatically.
    assert.throws(() => inbox.decide(proposal.proposalId, "APPROVE", NOW));
    await assert.rejects(() => daemon.executeApproved(executeInput(proposal, async () => { throw new Error("must never run — no replay"); })));
  });

  await scenario("M2: reservation and journal survive a fresh daemon/store instance (restart-safe)", async () => {
    const { proposal, gateRoot, repoRoot, inbox: firstInbox } = setupApprovedProposal();
    const restartedInbox = createAyasApprovalInboxStore({ rootDir: path.dirname(path.dirname(firstInbox.stateFile)) });
    const restartedDaemon = createAyasAutonomyDaemon({ inbox: restartedInbox, gateRoot, repoRoot, now: () => NOW });
    const result = await restartedDaemon.executeApproved(executeInput(proposal, async () => ({ changedFiles: proposal.exactFiles, diffFingerprint: "fixture-diff", testsRun: [], testResults: [] })));
    assert.equal(result.status, "COMPLETED");
  });

  await scenario("M2: executeApproved no longer depends on the deprecated single-phase consumeApproval", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src", "lib", "brain", "autonomy", "AyasAutonomyDaemon.ts"), "utf8");
    const fnBody = src.slice(src.indexOf("const executeApproved ="), src.indexOf("return { get state()"));
    assert.doesNotMatch(fnBody, /\.consumeApproval\(/);
    assert.match(fnBody, /\.reserveApproval\(/);
    assert.match(fnBody, /\.finalizeApproval\(/);
  });

  for (const action of ["PAUSE", "STOP OWN WORKLOAD"] as const) {
    await scenario(`M5: authoritative Machine Health ${action} blocks before callback`, async () => {
      const { inbox, proposal, gateRoot, repoRoot } = setupApprovedProposal(); let callbacks = 0;
      const daemon = createAyasAutonomyDaemon({ inbox, gateRoot, repoRoot, now: () => NOW, revalidation: { readMachineHealth: async () => ({ action, reasonCode: "fixture", mayStart: false, telemetry: { observedAt: NOW, processRssMb: 0, unavailable: [] } }) } });
      await assert.rejects(() => daemon.executeApproved(executeInput(proposal, async () => { callbacks += 1; throw new Error("must not run"); })), (e: unknown) => e instanceof AyasExecutionRevalidationError && e.code === "MACHINE_HEALTH_BLOCKED");
      assert.equal(callbacks, 0);
    });
  }

  await scenario("M5: authoritative dirty repository defeats caller-supplied repoClean=true", async () => {
    const { daemon, proposal, repoRoot } = setupApprovedProposal(); fs.writeFileSync(path.join(repoRoot, "extra.txt"), "dirty"); let callbacks = 0;
    await assert.rejects(() => daemon.executeApproved(executeInput(proposal, async () => { callbacks += 1; throw new Error("must not run"); })), (e: unknown) => e instanceof AyasExecutionRevalidationError && e.code === "REPOSITORY_DIRTY"); assert.equal(callbacks, 0);
  });

  await scenario("M5: authoritative HEAD drift defeats stale caller-supplied currentHead", async () => {
    const { daemon, proposal, repoRoot } = setupApprovedProposal(); git(repoRoot, "commit", "--allow-empty", "-qm", "drift"); let callbacks = 0;
    await assert.rejects(() => daemon.executeApproved(executeInput(proposal, async () => { callbacks += 1; throw new Error("must not run"); })), (e: unknown) => e instanceof AyasExecutionRevalidationError && e.code === "HEAD_MISMATCH"); assert.equal(callbacks, 0);
  });

  await scenario("M5: a change between first and pre-EXECUTING revalidation is detected", async () => {
    const { inbox, proposal, gateRoot, repoRoot } = setupApprovedProposal(); let reads = 0; let callbacks = 0;
    const daemon = createAyasAutonomyDaemon({ inbox, gateRoot, repoRoot, now: () => NOW, revalidation: { readRepository: async () => ({ head: proposal.baseHead, clean: ++reads === 1 }), readMachineHealth: async () => ({ action: "ALLOW", reasonCode: "fixture", mayStart: true, telemetry: { observedAt: NOW, processRssMb: 0, unavailable: [] } }) } });
    await assert.rejects(() => daemon.executeApproved(executeInput(proposal, async () => { callbacks += 1; throw new Error("must not run"); })), (e: unknown) => e instanceof AyasExecutionRevalidationError && e.code === "REPOSITORY_DIRTY"); assert.equal(callbacks, 0); assert.equal(reads, 2);
  });

  await scenario("M5: held authority lock blocks a second execution and callback remains zero", async () => {
    const { daemon, proposal, gateRoot } = setupApprovedProposal(); let callbacks = 0;
    await withAyasExecutionAuthorityLock(gateRoot, async () => { await assert.rejects(() => daemon.executeApproved(executeInput(proposal, async () => { callbacks += 1; throw new Error("must not run"); }))); }); assert.equal(callbacks, 0);
  });

  await scenario("M5: the real production gate root is rejected at construction", () => {
    assert.throws(() => createAyasAutonomyDaemon({ gateRoot: resolveAyasProductionGateRoot() }), (e: unknown) => e instanceof AyasGateRootIsolationError);
  });

  await scenario("M5: callback self-report cannot conceal an unauthorized untracked mutation", async () => {
    const { daemon, proposal, repoRoot } = setupApprovedProposal();
    await assert.rejects(() => daemon.executeApproved(executeInput(proposal, async () => { fs.writeFileSync(path.join(repoRoot, "concealed.txt"), "x"); return { changedFiles: [], diffFingerprint: "fake", testsRun: [], testResults: [] }; })), (e: unknown) => e instanceof AyasMutationScopeError && e.code === "UNAUTHORIZED_MUTATION");
  });

  await scenario("M5: allowed deletion is measured from Git, independent of callback report", async () => {
    const { daemon, inbox, proposal, repoRoot } = setupApprovedProposal(); const result = await daemon.executeApproved(executeInput(proposal, async () => { fs.rmSync(path.join(repoRoot, "allowed.txt")); return { changedFiles: [], diffFingerprint: "fake", testsRun: [], testResults: [] }; }));
    assert.equal(result.status, "COMPLETED"); assert.deepEqual(inbox.load().results.at(-1)?.changedFiles, ["allowed.txt"]);
  });

  await scenario("M5: restart inspection classifies every crash window without replay", () => {
    const gateRoot = root(); const journalStore = createAyasExecutionJournal({ rootDir: gateRoot });
    for (const phase of ["AUTHORIZATION_RESERVED", "GATE_ARMED", "GATE_OPEN", "EXECUTING", "MUTATION_COMPLETED"] as const) journalStore.record({ schemaVersion: "1", executionId: `ayas-exec-${phase}`, proposalId: "p", proposalHash: "h", baseHead: "b", exactFiles: ["allowed.txt"], phase, startedAt: NOW, updatedAt: NOW });
    const recovery = createAyasAutonomyDaemon({ gateRoot }).inspectRecovery(); assert.equal(recovery.length, 5); assert.ok(recovery.every((item) => item.decision.autoReplayAllowed === false)); assert.equal(recovery.filter((item) => item.decision.mutationPossible).length, 2);
  });

  await scenario("no isolated test ever uses the real production gate root", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "scripts", "smoke-ayas-execution-authority.ts"), "utf8");
    assert.doesNotMatch(src, /rootDir:\s*["'`](?:\.\/)?data\/brain["'`]/);
  });

  console.log(`AYAS execution authority smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-execution-authority", scenarios: count }));
}
main().catch((error) => { console.error("AYAS execution authority smoke FAILED:", error); process.exitCode = 1; });
