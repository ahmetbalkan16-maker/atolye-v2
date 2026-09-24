import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { loadAyasResearchEngineStatusView } from "../src/lib/brain/autonomy/AyasResearchEngineStatusView";
import { createAyasResearchSchedulerStateStore } from "../src/lib/brain/autonomy/AyasResearchSchedulerStateStore";
import { createAyasResearchSourceStateStore } from "../src/lib/brain/autonomy/AyasResearchSourceStateStore";
import { createAyasExternalResearchStore } from "../src/lib/brain/autonomy/AyasExternalResearchStore";
import { resolveAyasResearchSourceRegistry } from "../src/lib/brain/autonomy/AyasResearchSourceRegistry";

/**
 * AYAS CONTINUOUS EXTERNAL INTELLIGENCE sprint, Part O — the read-only
 * "Araştırma Motoru" Gelişim Merkezi projection. Same `withTempCwd`
 * clean-room convention as `smoke-ayas-goal-development-view.ts`: every
 * scenario runs inside a temp `process.cwd()`, never the real repo's
 * durable data (the loader's default store constructors resolve relative
 * to `process.cwd()`, exactly like every sibling view loader).
 */
let count = 0;
function scenario(name: string, fn: () => void) { fn(); count += 1; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }

function withTempCwd<T>(fn: () => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-research-status-view-"));
  const prev = process.cwd();
  process.chdir(dir);
  try { return fn(); } finally { process.chdir(prev); }
}

const NOW = "2026-09-17T12:00:00.000Z";

scenario("an empty environment returns connected:true with the full registry listed as NEVER_CHECKED, never crashes", () => {
  const view = withTempCwd(() => loadAyasResearchEngineStatusView(NOW));
  assert.equal(view.connected, true);
  assert.equal(view.sources.length, resolveAyasResearchSourceRegistry().length);
  assert.ok(view.sources.every((s) => s.status === "NEVER_CHECKED"));
  assert.equal(view.digest.sourcesRegistered, resolveAyasResearchSourceRegistry().length);
});

scenario("a scheduler state file with a recorded cadence is reflected verbatim in the view", () => {
  const view = withTempCwd(() => {
    createAyasResearchSchedulerStateStore().write({
      schemaVersion: "1", nextLightAt: "2026-09-17T18:00:00.000Z", nextDeepAt: "2026-09-18T12:00:00.000Z",
      lastLightCompletedAt: NOW, consecutiveFailures: 0, lastSuccessfulResearchAt: NOW,
      lastScheduledFor: "2026-09-17T06:00:00.000Z", lastAttemptAt: NOW, lastExecutedAt: NOW,
      lastMissedCount: 2, totalMissedOccurrences: 7, totalAttempts: 3,
    });
    return loadAyasResearchEngineStatusView(NOW);
  });
  assert.equal(view.nextLightAt, "2026-09-17T18:00:00.000Z");
  assert.equal(view.nextDeepAt, "2026-09-18T12:00:00.000Z");
  assert.equal(view.lastSuccessfulResearchAt, NOW);
  assert.equal(view.lastScheduledFor, "2026-09-17T06:00:00.000Z");
  assert.equal(view.lastExecutedAt, NOW);
  assert.equal(view.lastMissedCount, 2);
  assert.equal(view.totalMissedOccurrences, 7);
  assert.equal(view.totalAttempts, 3);
  assert.equal(view.pendingGoalCatchUpCount, 0);
  assert.equal(view.awaitingOwnerGoalCount, 0);
});

scenario("a source's per-check state (OK/ERROR + failure count) is resolved into that source's own row", () => {
  const view = withTempCwd(() => {
    const [firstSource] = resolveAyasResearchSourceRegistry();
    createAyasResearchSourceStateStore().write({ sourceId: firstSource!.sourceId, lastCheckedAt: NOW, status: "ERROR", lastError: "AYAS_FETCH_TIMEOUT: x", consecutiveFailures: 3 });
    return loadAyasResearchEngineStatusView(NOW);
  });
  const [firstSource] = resolveAyasResearchSourceRegistry();
  const row = view.sources.find((s) => s.sourceId === firstSource!.sourceId);
  assert.ok(row);
  assert.equal(row!.status, "ERROR");
  assert.equal(row!.consecutiveFailures, 3);
  assert.equal(view.digest.sourcesFailingNow, 1);
});

scenario("a source changed within the last 24h counts toward sourcesChangedLast24h; one changed 3 days ago does not", () => {
  const view = withTempCwd(() => {
    const [a, b] = resolveAyasResearchSourceRegistry();
    const stateStore = createAyasResearchSourceStateStore();
    stateStore.write({ sourceId: a!.sourceId, lastCheckedAt: NOW, lastChangedAt: "2026-09-17T06:00:00.000Z", status: "OK", consecutiveFailures: 0 }); // 6h ago
    stateStore.write({ sourceId: b!.sourceId, lastCheckedAt: NOW, lastChangedAt: "2026-09-14T00:00:00.000Z", status: "OK", consecutiveFailures: 0 }); // 3 days ago
    return loadAyasResearchEngineStatusView(NOW);
  });
  assert.equal(view.digest.sourcesChangedLast24h, 1);
});

scenario("findings recorded in the last 24h are counted; an older finding is not", () => {
  const view = withTempCwd(() => {
    const store = createAyasExternalResearchStore();
    store.record({ provider: "Recent", capability: "x", problemSolved: "y", sourceUrl: "https://example.com/a", isOfficialSource: true, featureDate: null, lastCheckedAt: NOW, confidence: "high", licenseCostStatus: "open-source", licenseCostNotes: "", atolyeGapStatus: "missing", atolyeGapNotes: "" });
    return loadAyasResearchEngineStatusView(NOW);
  });
  assert.equal(view.digest.findingsLast24h, 1);
});

scenario("an uncertain recovery stays pending only until a later cycle completes; a running goal job is running, not uncertain", () => {
  const pending = withTempCwd(() => {
    createAyasResearchSchedulerStateStore().write({ schemaVersion: "1", consecutiveFailures: 1, lastUncertainRunId: "old-run", lastReconciledAt: "2026-09-17T11:00:00.000Z", lastExecutedAt: "2026-09-17T05:00:00.000Z" });
    return loadAyasResearchEngineStatusView(NOW);
  });
  assert.equal(pending.uncertainOutcomePendingReview, true);
  const settled = withTempCwd(() => {
    createAyasResearchSchedulerStateStore().write({ schemaVersion: "1", consecutiveFailures: 0, lastUncertainRunId: "old-run", lastReconciledAt: "2026-09-17T05:00:00.000Z", lastExecutedAt: "2026-09-17T11:00:00.000Z" });
    return loadAyasResearchEngineStatusView(NOW);
  });
  assert.equal(settled.uncertainOutcomePendingReview, false, "a later completed cycle settles the old uncertain run");
  const running = withTempCwd(() => {
    const jobId = "ayas-goal-research-00000000-0000-4000-8000-000000000001";
    const scheduledFor = "2026-09-17T11:00:00.000Z";
    createAyasResearchSchedulerStateStore().write({ schemaVersion: "1", consecutiveFailures: 0, currentRunId: "11111111-1111-4111-8111-111111111111", currentMode: "LIGHT", goalResearchJobs: [{
      jobId, goalId: "ayas-goal-00000000-0000-4000-8000-000000000002", goalFingerprint: "0".repeat(64), sourceIds: ["fixture-source"], scheduledFor,
      catchUpPolicy: "CATCH_UP_ONCE", maxLatenessMs: 0, status: "RUNNING", attempt: 1, runId: "22222222-2222-4222-8222-222222222222", startedAt: scheduledFor,
      occurrenceId: crypto.createHash("sha256").update(`ayas-goal-research:${jobId}:${scheduledFor}`).digest("hex"),
    }] });
    return loadAyasResearchEngineStatusView(NOW);
  });
  assert.equal(running.uncertainOutcomePendingReview, false, "an in-flight run is not an uncertain outcome");
  assert.equal(running.runningGoalCount, 1);
  assert.equal(running.uncertainGoalCount, 0);
});

console.log(`AYAS research engine status view smoke: PASS (${count} scenarios)`);
console.log(JSON.stringify({ status: "PASS", suite: "ayas-research-engine-status-view", scenarios: count }));
