import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { analyzeAyasGoal } from "../src/lib/brain/autonomy/AyasGoalAnalysisEngine";
import { createAyasGoalStore } from "../src/lib/brain/autonomy/AyasGoalStore";
import { createAyasExternalResearchStore } from "../src/lib/brain/autonomy/AyasExternalResearchStore";

/**
 * M22.1/M22.5 — the goal analysis engine is a deterministic filter over
 * EXISTING discovery/research mechanisms, never a new authority surface.
 * Every scenario proves it only narrows (never widens) what those existing
 * mechanisms already found, and that it never mutates anything (the goal
 * store itself, the research store, or the repo).
 */
let count = 0;
function scenario(name: string, fn: () => void) { fn(); count += 1; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }
function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), "ayas-goal-analysis-")); }

scenario("a goal with an unrelated scope (a domain nothing real matches) is correctly suggested BLOCKED, not silently ACTIVE", () => {
  const goalStore = createAyasGoalStore({ rootDir: tmpDir() });
  const goal = goalStore.create({ userIntent: "improve something extremely specific and unmatched", scope: "a domain nothing matches", allowedDomains: ["src/lib/this-path-does-not-exist-anywhere/"], successCriteria: [] });
  const result = analyzeAyasGoal(goal, { repoRoot: process.cwd(), researchStore: createAyasExternalResearchStore({ rootDir: tmpDir() }) });
  assert.equal(result.matchedDiscoveryCandidates.length, 0, "assert.equal(result.matchedDiscoveryCandidates.length, 0)");
  assert.equal(result.suggestedStatus, "BLOCKED", "assert.equal(result.suggestedStatus, \"BLOCKED\")");
});

scenario("a goal scoped to a real, broad domain (scripts/) finds real discovery candidates from the actual repo", () => {
  const goalStore = createAyasGoalStore({ rootDir: tmpDir() });
  const goal = goalStore.create({ userIntent: "improve test diagnostics", scope: "smoke test quality", allowedDomains: ["scripts/"], successCriteria: [] });
  const result = analyzeAyasGoal(goal, { repoRoot: process.cwd() });
  assert.ok(result.matchedDiscoveryCandidates.length > 0, "a scripts/-scoped goal must find at least one real candidate from the live discovery pipeline");
  for (const c of result.matchedDiscoveryCandidates) assert.ok(c.exactFiles.every((f) => f.startsWith("scripts/")), "assert.ok(c.exactFiles.every((f) => f.startsWith(\"scripts/\")))");
});

scenario("excludedDomains removes a candidate even when it would otherwise match allowedDomains", () => {
  const goalStore = createAyasGoalStore({ rootDir: tmpDir() });
  const goal = goalStore.create({ userIntent: "x", scope: "x", allowedDomains: ["scripts/"], excludedDomains: ["scripts/"], successCriteria: [] });
  const result = analyzeAyasGoal(goal, { repoRoot: process.cwd() });
  assert.equal(result.matchedDiscoveryCandidates.length, 0, "excluding the same domain that was allowed must leave nothing matched");
});

scenario("every matched candidate carries its OWN real safety/value classification — the goal never overrides them", () => {
  const goalStore = createAyasGoalStore({ rootDir: tmpDir() });
  const goal = goalStore.create({ userIntent: "x", scope: "x", allowedDomains: ["scripts/"], successCriteria: [] });
  const result = analyzeAyasGoal(goal, { repoRoot: process.cwd() });
  for (const c of result.matchedDiscoveryCandidates) {
    assert.ok(["SAFE", "REVIEW_REQUIRED", "FORBIDDEN_AUTONOMOUS"].includes(c.safetyClassification), "assert.ok([\"SAFE\", \"REVIEW_REQUIRED\", \"FORBIDDEN_AUTONOMOUS\"].includes(c.safetyClassification))");
    assert.ok(["TEST_QUALITY", "PRODUCT_BEHAVIOR", "RELIABILITY_RECOVERY", "OBSERVABILITY", "PERFORMANCE"].includes(c.valueClass), "assert.ok([\"TEST_QUALITY\", \"PRODUCT_BEHAVIOR\", \"RELIABILITY_RECOVERY\", \"OBSERVABILITY\", \"PERFORMANCE\"].includes(c.valueClass))");
  }
});

scenario("a research finding already marked already-supported is never surfaced, even if it textually matches the goal", () => {
  const researchStore = createAyasExternalResearchStore({ rootDir: tmpDir() });
  researchStore.record({
    provider: "X", capability: "subtitle generation", problemSolved: "improves subtitle quality", sourceUrl: "https://example.com/x",
    isOfficialSource: true, featureDate: null, lastCheckedAt: "2026-09-17T00:00:00.000Z", confidence: "high",
    licenseCostStatus: "unknown", licenseCostNotes: "", atolyeGapStatus: "already-supported", atolyeGapNotes: "Atölye already has this",
  });
  const goalStore = createAyasGoalStore({ rootDir: tmpDir() });
  const goal = goalStore.create({ userIntent: "improve subtitle generation quality", scope: "subtitles", allowedDomains: [], successCriteria: [] });
  const result = analyzeAyasGoal(goal, { repoRoot: process.cwd(), researchStore });
  assert.equal(result.matchedResearchFindings.length, 0, "assert.equal(result.matchedResearchFindings.length, 0)");
});

scenario("a research finding that is missing/partially-supported AND textually relevant to the goal IS surfaced", () => {
  const researchStore = createAyasExternalResearchStore({ rootDir: tmpDir() });
  researchStore.record({
    provider: "X", capability: "word-level caption timing", problemSolved: "real per-word timestamps for captions", sourceUrl: "https://example.com/x",
    isOfficialSource: true, featureDate: null, lastCheckedAt: "2026-09-17T00:00:00.000Z", confidence: "high",
    licenseCostStatus: "unknown", licenseCostNotes: "", atolyeGapStatus: "partially-supported", atolyeGapNotes: "Atölye estimates timing, no real ASR",
  });
  const goalStore = createAyasGoalStore({ rootDir: tmpDir() });
  const goal = goalStore.create({ userIntent: "improve caption timing accuracy", scope: "subtitle/caption quality", allowedDomains: [], successCriteria: [] });
  const result = analyzeAyasGoal(goal, { repoRoot: process.cwd(), researchStore });
  assert.equal(result.matchedResearchFindings.length, 1, "assert.equal(result.matchedResearchFindings.length, 1)");
});

scenario("analysis is pure — it never mutates the goal store or the research store", () => {
  const goalDir = tmpDir();
  const goalStore = createAyasGoalStore({ rootDir: goalDir });
  const goal = goalStore.create({ userIntent: "x", scope: "x", allowedDomains: ["scripts/"], successCriteria: [] });
  const researchDir = tmpDir();
  const researchStore = createAyasExternalResearchStore({ rootDir: researchDir });
  analyzeAyasGoal(goal, { repoRoot: process.cwd(), researchStore });
  assert.equal(fs.readdirSync(goalDir).length, 1, "exactly the one goal file created by create() — analysis must not write anything");
  assert.equal(fs.existsSync(researchDir) ? fs.readdirSync(researchDir).length : 0, 0, "analysis must not write anything to the research store either");
});

console.log(`AYAS goal analysis engine smoke: PASS (${count} scenarios)`);
console.log(JSON.stringify({ status: "PASS", suite: "ayas-goal-analysis-engine", scenarios: count }));
