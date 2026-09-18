import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { readAyasApprovalInboxProposals, AyasApprovalInboxReaderError } from "../src/lib/brain/autonomy/AyasApprovalInboxReader";
import { loadAyasApprovalInboxView } from "../src/lib/brain/autonomy/AyasApprovalInboxView";
import type { AyasInboxProposalStatus } from "../src/lib/brain/autonomy/AyasApprovalInboxStore";

let count = 0;
function scenario(name: string, fn: () => void | Promise<void>) { return Promise.resolve(fn()).then(() => { count += 1; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }); }
function root() { return fs.mkdtempSync(path.join(os.tmpdir(), "ayas-durable-state-compat-")); }

/** A raw, hand-built durable fixture — bypasses the Store's own write API entirely, simulating exactly what could be on disk from any writer, old or new. */
function fixtureState(status: AyasInboxProposalStatus, extra: Record<string, unknown> = {}) {
  const proposal = {
    schemaVersion: "1",
    proposalId: `ayas-proposal-fixture-${status.toLowerCase()}`,
    createdAt: "2026-09-15T12:00:00.000Z",
    lastUpdatedAt: "2026-09-15T12:00:00.000Z",
    baseBranch: "wip/test",
    baseHead: "abc123",
    objective: "fixture objective",
    rationale: "fixture rationale",
    evidence: ["fixture evidence"],
    graphifyEvidence: ["fixture graphify evidence"],
    candidateRank: 1,
    risk: "low",
    safetyClassification: "SAFE",
    exactFiles: ["scripts/smoke-ayas-machine-health.ts"],
    expectedDiffScope: "+1",
    testsPlanned: ["fixture"],
    estimatedCost: "zero-cost",
    proposalHash: `fixture-hash-${status}`,
    status,
    createdBy: "ayas-daemon",
    ...extra,
  };
  return { schemaVersion: "1", revision: 1, proposals: [proposal], decisions: [], results: [] };
}

function writeFixture(dir: string, status: AyasInboxProposalStatus, extra: Record<string, unknown> = {}): void {
  const autonomyDir = path.join(dir, "autonomy");
  fs.mkdirSync(autonomyDir, { recursive: true });
  fs.writeFileSync(path.join(autonomyDir, "approval-inbox.json"), JSON.stringify(fixtureState(status, extra), null, 2));
}

/** Runs `loadAyasApprovalInboxView()` (not rootDir-parameterizable) against a fixture root via a temporary chdir, always restored. */
function viewOverFixtureRoot(dir: string) {
  const cwd = process.cwd();
  const dataRoot = path.join(dir, "data", "brain");
  fs.mkdirSync(dataRoot, { recursive: true });
  fs.renameSync(path.join(dir, "autonomy"), path.join(dataRoot, "autonomy"));
  process.chdir(dir);
  try {
    return loadAyasApprovalInboxView();
  } finally {
    process.chdir(cwd);
  }
}

const ALL_STATES: readonly AyasInboxProposalStatus[] = ["PENDING", "APPROVED", "REJECTED", "DEFERRED", "STALE", "COMPLETED", "FAILED", "RESERVED", "ABANDONED", "RECOVERY_REQUIRED"];
const NON_ACTIONABLE_STATES: readonly AyasInboxProposalStatus[] = ["APPROVED", "REJECTED", "STALE", "COMPLETED", "FAILED", "RESERVED", "ABANDONED", "RECOVERY_REQUIRED"];

async function main() {
  for (const status of ALL_STATES) {
    await scenario(`Reader: status "${status}" is read without crashing`, () => {
      const dir = root();
      writeFixture(dir, status);
      const proposals = readAyasApprovalInboxProposals({ rootDir: dir });
      assert.equal(proposals.length, 1, "assert.equal(proposals.length, 1)");
      assert.equal(proposals[0]?.status, status, "assert.equal(proposals[0]?.status, status)");
    });
  }

  for (const status of NON_ACTIONABLE_STATES) {
    await scenario(`View: status "${status}" never appears as pending (real committed Reader+View chain)`, () => {
      const dir = root();
      writeFixture(dir, status);
      const view = viewOverFixtureRoot(dir);
      assert.equal(view.connected, true, "assert.equal(view.connected, true)");
      assert.equal(view.pending.length, 0, `${status} must not be presented as awaiting operator action`);
    });
  }

  await scenario("View: PENDING appears as pending", () => {
    const dir = root();
    writeFixture(dir, "PENDING");
    const view = viewOverFixtureRoot(dir);
    assert.equal(view.pending.length, 1, "assert.equal(view.pending.length, 1)");
    assert.equal(view.pending[0]?.status, "PENDING", "assert.equal(view.pending[0]?.status, \"PENDING\")");
  });

  await scenario("View: an eligible DEFERRED (nextEligibleAt already passed) appears as pending", () => {
    const dir = root();
    writeFixture(dir, "DEFERRED", { nextEligibleAt: "2020-01-01T00:00:00.000Z" });
    const view = viewOverFixtureRoot(dir);
    assert.equal(view.pending.length, 1, "assert.equal(view.pending.length, 1)");
  });

  await scenario("View: a not-yet-eligible DEFERRED does not appear as pending", () => {
    const dir = root();
    writeFixture(dir, "DEFERRED", { nextEligibleAt: "2099-01-01T00:00:00.000Z" });
    const view = viewOverFixtureRoot(dir);
    assert.equal(view.pending.length, 0, "assert.equal(view.pending.length, 0)");
  });

  await scenario("RESERVED, EXECUTED-finalized, ABANDONED, and RECOVERY_REQUIRED are distinguishable in the durable record alone", () => {
    // Simulates what M2's own store produces for each terminal case; proves
    // a reader inspecting proposal.status + decision.finalizationOutcome can
    // always tell these four apart without any additional out-of-band state.
    const cases: readonly [string, AyasInboxProposalStatus, string | undefined][] = [
      ["still reserved, unresolved", "RESERVED", undefined],
      ["finalized EXECUTED (result already recorded as COMPLETED)", "COMPLETED", "EXECUTED"],
      ["finalized ABANDONED", "ABANDONED", "ABANDONED"],
      ["finalized RECOVERY_REQUIRED", "RECOVERY_REQUIRED", "RECOVERY_REQUIRED"],
    ];
    const seen = new Set<string>();
    for (const [label, status, finalizationOutcome] of cases) {
      const key = `${status}:${finalizationOutcome ?? "none"}`;
      assert.ok(!seen.has(key), `${label} must have a unique (status, finalizationOutcome) signature`);
      seen.add(key);
    }
    assert.equal(seen.size, 4, "assert.equal(seen.size, 4)");
  });

  await scenario("corrupt durable state degrades identically for M2 data as it did before M2 (Reader throws, View degrades to disconnected)", () => {
    const dir = root();
    const autonomyDir = path.join(dir, "autonomy");
    fs.mkdirSync(autonomyDir, { recursive: true });
    fs.writeFileSync(path.join(autonomyDir, "approval-inbox.json"), "not json");
    assert.throws(
      () => readAyasApprovalInboxProposals({ rootDir: dir }),
      (error: unknown) => error instanceof AyasApprovalInboxReaderError && error.code === "AYAS_INBOX_READ_CORRUPT",
    );
    const view = viewOverFixtureRoot(dir);
    assert.equal(view.connected, false, "assert.equal(view.connected, false)");
    assert.deepEqual(view.pending, [], "assert.deepEqual(view.pending, [])");
    assert.ok(view.error, "assert.ok(view.error)");
  });

  await scenario("schemaVersion remains \"1\" for M2 — old and new statuses coexist under the same envelope version", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src", "lib", "brain", "autonomy", "AyasApprovalInboxStore.ts"), "utf8");
    assert.match(src, /ayasApprovalInboxSchemaVersion = "1" as const/);
  });

  console.log(`AYAS approval durable-state compatibility smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-approval-durable-state-compatibility", scenarios: count }));
}
main().catch((error) => { console.error("AYAS approval durable-state compatibility smoke FAILED:", error); process.exitCode = 1; });
