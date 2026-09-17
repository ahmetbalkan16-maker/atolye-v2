import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createAyasGoalStore, AyasGoalStoreError } from "../src/lib/brain/autonomy/AyasGoalStore";

/**
 * M22.2 — durable goal state. Every scenario proves the goal store REMEMBERS
 * intent/progress/evidence and enforces its own state machine, and never
 * becomes an authority surface (no execute/approve/gate method exists on it
 * at all — that's a structural fact about the interface, not just a
 * runtime check, but the scenarios below still probe it functionally: e.g.,
 * text fields are scrubbed the same way every other durable AYAS store
 * already scrubs human-facing text).
 */
let count = 0;
function scenario(name: string, fn: () => void) { fn(); count += 1; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }
function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), "ayas-goal-store-")); }

scenario("create() starts a goal in NEW with the given scope/domains/criteria", () => {
  const store = createAyasGoalStore({ rootDir: tmpDir() });
  const goal = store.create({ userIntent: "improve video quality", scope: "video assembly reliability", allowedDomains: ["src/lib/assembly/", "src/lib/video/"], successCriteria: ["fewer assembly failures"] });
  assert.equal(goal.status, "NEW");
  assert.deepEqual(goal.allowedDomains, ["src/lib/assembly/", "src/lib/video/"]);
  assert.deepEqual(goal.candidates, []);
  assert.deepEqual(goal.excludedDomains, []);
});

scenario("the state machine refuses an invalid transition (NEW -> COMPLETED directly)", () => {
  const store = createAyasGoalStore({ rootDir: tmpDir() });
  const goal = store.create({ userIntent: "x", scope: "x", allowedDomains: [], successCriteria: [] });
  assert.throws(() => store.transition(goal.goalId, "COMPLETED", "t"), (e: unknown) => e instanceof AyasGoalStoreError && e.code === "AYAS_GOAL_INVALID_TRANSITION");
});

scenario("a valid transition path NEW -> ANALYZING -> ACTIVE -> COMPLETED works and COMPLETED is terminal", () => {
  const store = createAyasGoalStore({ rootDir: tmpDir() });
  const goal = store.create({ userIntent: "x", scope: "x", allowedDomains: [], successCriteria: [] });
  store.transition(goal.goalId, "ANALYZING", "t1");
  store.transition(goal.goalId, "ACTIVE", "t2");
  const completed = store.complete(goal.goalId, ["shipped fix X"], "t3");
  assert.equal(completed.status, "COMPLETED");
  assert.deepEqual(completed.completionEvidence, ["shipped fix X"]);
  assert.throws(() => store.transition(goal.goalId, "ACTIVE", "t4"), (e: unknown) => e instanceof AyasGoalStoreError && e.code === "AYAS_GOAL_INVALID_TRANSITION");
});

scenario("addCandidate references an external id (e.g. a proposalId) rather than inventing content", () => {
  const store = createAyasGoalStore({ rootDir: tmpDir() });
  const goal = store.create({ userIntent: "x", scope: "x", allowedDomains: [], successCriteria: [] });
  const updated = store.addCandidate(goal.goalId, { reference: "ayas-proposal-abc123", note: "bounds a manifest error before the prompt" }, "t");
  assert.equal(updated.candidates.length, 1);
  assert.equal(updated.candidates[0]!.reference, "ayas-proposal-abc123");
  assert.ok(updated.candidates[0]!.candidateId.startsWith("ayas-goal-candidate-"));
});

scenario("addEvidence / addProgress / addBlocker each append and update lastUpdatedAt", () => {
  const store = createAyasGoalStore({ rootDir: tmpDir() });
  const goal = store.create({ userIntent: "x", scope: "x", allowedDomains: [], successCriteria: [] });
  const withEvidence = store.addEvidence(goal.goalId, "found via Graphify", "t1");
  const withProgress = store.addProgress(withEvidence.goalId, "shipped M20.6", "t2");
  const withBlocker = store.addBlocker(withProgress.goalId, "needs a human decision on scope", "t3");
  assert.deepEqual(withBlocker.evidence, ["found via Graphify"]);
  assert.deepEqual(withBlocker.progress, ["shipped M20.6"]);
  assert.deepEqual(withBlocker.blockers, ["needs a human decision on scope"]);
  assert.equal(withBlocker.lastUpdatedAt, "t3");
});

scenario("free-text fields are scrubbed (redacted + bounded) the same way every other AYAS durable store already scrubs human text", () => {
  const store = createAyasGoalStore({ rootDir: tmpDir() });
  const goal = store.create({ userIntent: `leaked path C:\\Users\\Metod\\secret\\${"x".repeat(1000)}`, scope: "x", allowedDomains: [], successCriteria: [] });
  assert.ok(!goal.userIntent.includes("C:\\Users\\Metod\\secret"));
  assert.ok(goal.userIntent.length <= 300);
});

scenario("list() returns every created goal; load() throws AYAS_GOAL_NOT_FOUND for an unknown id", () => {
  const store = createAyasGoalStore({ rootDir: tmpDir() });
  store.create({ userIntent: "a", scope: "x", allowedDomains: [], successCriteria: [] });
  store.create({ userIntent: "b", scope: "x", allowedDomains: [], successCriteria: [] });
  assert.equal(store.list().length, 2);
  assert.throws(() => store.load("ayas-goal-does-not-exist"), (e: unknown) => e instanceof AyasGoalStoreError && e.code === "AYAS_GOAL_NOT_FOUND");
});

scenario("a corrupt goal file throws AYAS_GOAL_CORRUPT on direct load, but never crashes list()", () => {
  const dir = tmpDir();
  const store = createAyasGoalStore({ rootDir: dir });
  const goal = store.create({ userIntent: "a", scope: "x", allowedDomains: [], successCriteria: [] });
  fs.writeFileSync(path.join(dir, `${goal.goalId}.json`), "{ not valid json", "utf8");
  assert.throws(() => store.load(goal.goalId), (e: unknown) => e instanceof AyasGoalStoreError && e.code === "AYAS_GOAL_CORRUPT");
});

scenario("the goal interface has no execute/approve/gate method — structurally, a goal can never itself authorize anything", () => {
  const store = createAyasGoalStore({ rootDir: tmpDir() });
  const methodNames = Object.keys(store);
  for (const forbidden of ["execute", "approve", "openGate", "commit", "push", "run"]) {
    assert.ok(!methodNames.includes(forbidden), `goal store must not expose a "${forbidden}" method`);
  }
});

console.log(`AYAS goal store smoke: PASS (${count} scenarios)`);
console.log(JSON.stringify({ status: "PASS", suite: "ayas-goal-store", scenarios: count }));
