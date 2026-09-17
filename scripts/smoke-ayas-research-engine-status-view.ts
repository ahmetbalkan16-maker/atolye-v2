import assert from "node:assert/strict";
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
    });
    return loadAyasResearchEngineStatusView(NOW);
  });
  assert.equal(view.nextLightAt, "2026-09-17T18:00:00.000Z");
  assert.equal(view.nextDeepAt, "2026-09-18T12:00:00.000Z");
  assert.equal(view.lastSuccessfulResearchAt, NOW);
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

console.log(`AYAS research engine status view smoke: PASS (${count} scenarios)`);
console.log(JSON.stringify({ status: "PASS", suite: "ayas-research-engine-status-view", scenarios: count }));
