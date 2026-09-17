import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { loadAyasGoalDevelopmentView } from "../src/lib/brain/autonomy/AyasGoalDevelopmentView";
import { createAyasGoalStore } from "../src/lib/brain/autonomy/AyasGoalStore";
import { createAyasExternalResearchStore } from "../src/lib/brain/autonomy/AyasExternalResearchStore";

/**
 * M22.14 — the read-only Gelişim Merkezi projection of goal + external-
 * research state. Since the loader reads from `process.cwd()`-relative
 * default store locations (matching every other AYAS view loader's
 * convention), these scenarios run inside a temp `process.cwd()` — never
 * the real repo's durable data.
 */
let count = 0;
function scenario(name: string, fn: () => void) { fn(); count += 1; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }

function withTempCwd<T>(fn: () => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-goal-view-"));
  const prev = process.cwd();
  process.chdir(dir);
  try { return fn(); } finally { process.chdir(prev); }
}

scenario("an empty environment returns connected:true with empty goals/research — never crashes", () => {
  const view = withTempCwd(() => loadAyasGoalDevelopmentView());
  assert.equal(view.connected, true);
  assert.deepEqual(view.goals, []);
  assert.deepEqual(view.research, []);
});

scenario("a goal's candidate is resolved to its real referenced research finding", () => {
  const view = withTempCwd(() => {
    const goalStore = createAyasGoalStore();
    const researchStore = createAyasExternalResearchStore();
    const finding = researchStore.record({
      provider: "TestProvider", capability: "test capability", problemSolved: "x", sourceUrl: "https://example.com/x",
      isOfficialSource: true, featureDate: null, lastCheckedAt: "2026-09-17T00:00:00.000Z", confidence: "high",
      licenseCostStatus: "open-source", licenseCostNotes: "", atolyeGapStatus: "missing", atolyeGapNotes: "x",
    });
    const goal = goalStore.create({ userIntent: "x", scope: "x", allowedDomains: [], successCriteria: [] });
    goalStore.addCandidate(goal.goalId, { reference: finding.findingId, note: "test note" }, "2026-09-17T00:00:01.000Z");
    return loadAyasGoalDevelopmentView();
  });
  assert.equal(view.goals.length, 1);
  assert.equal(view.goals[0]!.candidates.length, 1);
  assert.ok(view.goals[0]!.resolvedCandidateFindings[0], "the candidate's referenced finding must resolve");
  assert.equal(view.goals[0]!.resolvedCandidateFindings[0]!.provider, "TestProvider");
});

scenario("a candidate referencing a finding that no longer exists resolves to undefined, never crashes the view", () => {
  const view = withTempCwd(() => {
    const goalStore = createAyasGoalStore();
    const goal = goalStore.create({ userIntent: "x", scope: "x", allowedDomains: [], successCriteria: [] });
    goalStore.addCandidate(goal.goalId, { reference: "ayas-research-does-not-exist", note: "x" }, "2026-09-17T00:00:01.000Z");
    return loadAyasGoalDevelopmentView();
  });
  assert.equal(view.goals[0]!.resolvedCandidateFindings[0], undefined);
});

scenario("goals are sorted newest-updated first", () => {
  const view = withTempCwd(() => {
    const goalStore = createAyasGoalStore();
    const older = goalStore.create({ userIntent: "older", scope: "x", allowedDomains: [], successCriteria: [] });
    const newer = goalStore.create({ userIntent: "newer", scope: "x", allowedDomains: [], successCriteria: [] });
    goalStore.addProgress(newer.goalId, "bump", "2030-01-01T00:00:00.000Z"); // guaranteed later than any real "now" this create() call used internally
    void older;
    return loadAyasGoalDevelopmentView();
  });
  assert.equal(view.goals[0]!.userIntent, "newer");
});

console.log(`AYAS goal development view smoke: PASS (${count} scenarios)`);
console.log(JSON.stringify({ status: "PASS", suite: "ayas-goal-development-view", scenarios: count }));
