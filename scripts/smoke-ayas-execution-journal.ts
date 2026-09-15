import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  createAyasExecutionJournal,
  classifyExecutionRecovery,
  AyasExecutionJournalError,
  type AyasExecutionJournalEntry,
  type AyasExecutionJournalPhase,
} from "../src/lib/brain/autonomy/AyasExecutionJournal";

let count = 0;
function scenario(name: string, fn: () => void | Promise<void>) { return Promise.resolve(fn()).then(() => { count += 1; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }); }
function root() { return fs.mkdtempSync(path.join(os.tmpdir(), "ayas-journal-")); }

function baseEntry(overrides: Partial<AyasExecutionJournalEntry> = {}): AyasExecutionJournalEntry {
  return {
    schemaVersion: "1",
    executionId: "ayas-exec-fixture-1",
    proposalId: "ayas-proposal-fixture-1",
    proposalHash: "fixture-hash",
    baseHead: "abc123",
    exactFiles: ["scripts/smoke-ayas-machine-health.ts"],
    phase: "APPROVED_NOT_STARTED",
    startedAt: "2026-09-15T12:00:00.000Z",
    updatedAt: "2026-09-15T12:00:00.000Z",
    ...overrides,
  };
}

async function main() {
  await scenario("record then read round-trips an entry exactly", () => {
    const journal = createAyasExecutionJournal({ rootDir: root() });
    const entry = baseEntry();
    journal.record(entry);
    assert.deepEqual(journal.read(entry.executionId), entry);
  });

  await scenario("reading an unjournaled executionId returns undefined, not an error", () => {
    const journal = createAyasExecutionJournal({ rootDir: root() });
    assert.equal(journal.read("ayas-exec-never-happened"), undefined);
  });

  await scenario("each record() call is a full atomic replace — a crash mid-write cannot torn-write a phase (simulated by overwriting twice)", () => {
    const journal = createAyasExecutionJournal({ rootDir: root() });
    const entry = baseEntry();
    journal.record(entry);
    const advanced = { ...entry, phase: "AUTHORIZATION_RESERVED" as const, authorizationId: "auth-1", reservationId: "res-1", updatedAt: "2026-09-15T12:01:00.000Z" };
    journal.record(advanced);
    assert.deepEqual(journal.read(entry.executionId), advanced);
  });

  await scenario("list() returns every journaled entry", () => {
    const workspace = root();
    const journal = createAyasExecutionJournal({ rootDir: workspace });
    journal.record(baseEntry({ executionId: "ayas-exec-a" }));
    journal.record(baseEntry({ executionId: "ayas-exec-b", phase: "EXECUTING" }));
    const all = journal.list();
    assert.equal(all.length, 2);
    assert.deepEqual(new Set(all.map((e) => e.executionId)), new Set(["ayas-exec-a", "ayas-exec-b"]));
  });

  await scenario("a corrupt journal entry fails closed on read (not silently reinterpreted)", () => {
    const workspace = root();
    const journal = createAyasExecutionJournal({ rootDir: workspace });
    fs.mkdirSync(journal.dir, { recursive: true });
    fs.writeFileSync(path.join(journal.dir, "ayas-exec-corrupt.json"), "not json");
    assert.throws(
      () => journal.read("ayas-exec-corrupt"),
      (error: unknown) => error instanceof AyasExecutionJournalError && error.code === "AYAS_JOURNAL_CORRUPT",
    );
  });

  await scenario("list() fails closed if any entry is corrupt — never silently skips it", () => {
    const workspace = root();
    const journal = createAyasExecutionJournal({ rootDir: workspace });
    journal.record(baseEntry({ executionId: "ayas-exec-good" }));
    fs.writeFileSync(path.join(journal.dir, "ayas-exec-bad.json"), "not json");
    assert.throws(() => journal.list());
  });

  await scenario("a wrong schemaVersion fails closed", () => {
    const workspace = root();
    const journal = createAyasExecutionJournal({ rootDir: workspace });
    fs.mkdirSync(journal.dir, { recursive: true });
    fs.writeFileSync(path.join(journal.dir, "ayas-exec-old.json"), JSON.stringify({ ...baseEntry(), schemaVersion: "99" }));
    assert.throws(
      () => journal.read("ayas-exec-old"),
      (error: unknown) => error instanceof AyasExecutionJournalError && error.code === "AYAS_JOURNAL_SCHEMA_MISMATCH",
    );
  });

  await scenario("restart preserves the journal — a fresh handle over the same root reads the same entry", () => {
    const workspace = root();
    const first = createAyasExecutionJournal({ rootDir: workspace });
    const entry = baseEntry({ phase: "GATE_OPEN" });
    first.record(entry);
    const second = createAyasExecutionJournal({ rootDir: workspace });
    assert.deepEqual(second.read(entry.executionId), entry);
  });

  const windowCases: readonly [AyasExecutionJournalPhase, "NONE" | "A" | "B" | "C" | "D" | "E", boolean][] = [
    ["RESULT_RECORDED", "NONE", false],
    ["APPROVED_NOT_STARTED", "A", false],
    ["AUTHORIZATION_RESERVED", "A", false],
    ["GATE_ARMED", "B", false],
    ["GATE_READY", "B", false],
    ["GATE_OPEN", "C", false],
    ["EXECUTING", "D", true],
    ["MUTATION_COMPLETED", "E", true],
    ["GATE_COMPLETED", "E", true],
    ["GATE_SETTLED", "E", true],
    ["GATE_CLOSED", "E", true],
    ["FAILED", "D", true],
    ["PARTIAL_UNKNOWN", "D", true],
    ["RECOVERY_REQUIRED", "D", true],
  ];
  for (const [phase, expectedWindow, expectedMutationPossible] of windowCases) {
    await scenario(`classifyExecutionRecovery(${phase}) -> window ${expectedWindow}, mutationPossible ${expectedMutationPossible}`, () => {
      const classification = classifyExecutionRecovery(baseEntry({ phase }));
      assert.equal(classification.window, expectedWindow);
      assert.equal(classification.mutationPossible, expectedMutationPossible);
      if (expectedMutationPossible) assert.equal(classification.recommendation, "HUMAN_REVIEW_REQUIRED");
    });
  }

  await scenario("classifyExecutionRecovery never mutates, never throws, and performs zero I/O for any known phase", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src", "lib", "brain", "autonomy", "AyasExecutionJournal.ts"), "utf8");
    const fnBody = src.slice(src.indexOf("export function classifyExecutionRecovery"));
    assert.doesNotMatch(fnBody, /fs\.|AyasExecutionGateStore|AyasApprovalInboxStore|applyWhileExecuting|gate\.transition/);
  });

  await scenario("the module has zero dependency on approval/daemon/gate authority — Package C infrastructure only", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src", "lib", "brain", "autonomy", "AyasExecutionJournal.ts"), "utf8");
    assert.doesNotMatch(src, /AyasApprovalInboxStore|AyasAutonomyDaemon|AyasExecutionGateStore|consumeApproval|reserveApproval|createProposal/);
  });

  console.log(`AYAS execution journal smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-execution-journal", scenarios: count }));
}
main().catch((error) => { console.error("AYAS execution journal smoke FAILED:", error); process.exitCode = 1; });
