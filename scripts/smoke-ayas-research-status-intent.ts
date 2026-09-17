import assert from "node:assert/strict";

import { detectAyasResearchStatusIntent, buildAyasResearchStatusSpokenAnswer } from "../src/lib/brain/autonomy/AyasResearchStatusIntent";
import type { AyasGoalDevelopmentView } from "../src/lib/brain/autonomy/AyasGoalDevelopmentView";
import type { AyasResearchEngineStatusView } from "../src/lib/brain/autonomy/AyasResearchEngineStatusView";

/**
 * AYAS CONTINUOUS EXTERNAL INTELLIGENCE sprint — "Natural Language Status"
 * proof. Every scenario constructs its own in-memory view (never touches
 * the filesystem), matching `detectAyasReportIntent`'s own sibling smoke
 * coverage convention — pure, deterministic, no model, no durable state.
 */
let count = 0;
function scenario(name: string, fn: () => void) { fn(); count += 1; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }

const CONNECTED_RESEARCH: AyasResearchEngineStatusView = {
  connected: true,
  nextLightAt: "2026-09-17T16:23:53.865Z",
  nextDeepAt: "2026-09-18T10:23:53.865Z",
  consecutiveFailures: 0,
  sources: [],
  digest: { sourcesRegistered: 14, sourcesChangedLast24h: 1, sourcesFailingNow: 0, findingsLast24h: 3 },
};

const CONNECTED_GOALS: AyasGoalDevelopmentView = {
  connected: true,
  goals: [],
  research: [
    {
      schemaVersion: "1", findingId: "ayas-research-1", recordedAt: "2026-09-17T10:23:00.000Z", provider: "Ollama",
      capability: "CODING_AGENTS release", category: "CODING_AGENTS", problemSolved: "local model tooling improvements",
      sourceUrl: "https://github.com/ollama/ollama/releases/tag/v0.34.2", isOfficialSource: true, featureDate: null,
      lastCheckedAt: "2026-09-17T10:23:00.000Z", confidence: "medium", licenseCostStatus: "open-source", licenseCostNotes: "",
      atolyeGapStatus: "missing", atolyeGapNotes: "", treatedSourceAsUntrusted: true,
    },
  ],
};

scenario("plain conversational text never matches a research-status intent", () => {
  assert.equal(detectAyasResearchStatusIntent("bugün hava çok güzel"), null);
  assert.equal(detectAyasResearchStatusIntent(""), null);
});

scenario('"Son internette ne araştırdın?" is detected as a digest intent', () => {
  assert.deepEqual(detectAyasResearchStatusIntent("Son internette ne araştırdın?"), { kind: "digest" });
});

scenario('"Son 24 saatte hangi özellikleri keşfettin?" is detected as a digest intent', () => {
  assert.deepEqual(detectAyasResearchStatusIntent("Son 24 saatte hangi özellikleri keşfettin?"), { kind: "digest" });
});

scenario('"Sonraki araştırma ne zaman?" is detected as a next-schedule intent', () => {
  assert.deepEqual(detectAyasResearchStatusIntent("Sonraki araştırma ne zaman?"), { kind: "next-schedule" });
});

scenario('"Ollama tarafında yeni ne buldun?" is detected as a provider intent for "ollama"', () => {
  assert.deepEqual(detectAyasResearchStatusIntent("Ollama tarafında yeni ne buldun?"), { kind: "provider", providerQuery: "ollama" });
});

scenario("the digest answer states real numbers from the supplied view, never invented ones", () => {
  const answer = buildAyasResearchStatusSpokenAnswer(CONNECTED_GOALS, CONNECTED_RESEARCH, { kind: "digest" });
  assert.match(answer, /14 kaynak/);
  assert.match(answer, /1 tanesi değişti/);
  assert.match(answer, /3 yeni bulgu/);
});

scenario("the digest answer for a quiet 24h period says so plainly, without fabricating a number", () => {
  const quiet: AyasResearchEngineStatusView = { ...CONNECTED_RESEARCH, digest: { sourcesRegistered: 14, sourcesChangedLast24h: 0, sourcesFailingNow: 0, findingsLast24h: 0 } };
  const answer = buildAyasResearchStatusSpokenAnswer(CONNECTED_GOALS, quiet, { kind: "digest" });
  assert.match(answer, /yeni bir değişiklik ya da bulgu yoktu/);
});

scenario("the next-schedule answer reflects the real nextLightAt/nextDeepAt timestamps", () => {
  const answer = buildAyasResearchStatusSpokenAnswer(CONNECTED_GOALS, CONNECTED_RESEARCH, { kind: "next-schedule" });
  assert.match(answer, /hafif tarama/);
  assert.match(answer, /derin analiz/);
});

scenario("the provider answer surfaces the real matching finding's capability/problemSolved, never a fabricated one", () => {
  const answer = buildAyasResearchStatusSpokenAnswer(CONNECTED_GOALS, CONNECTED_RESEARCH, { kind: "provider", providerQuery: "ollama" });
  assert.match(answer, /CODING_AGENTS release/);
  assert.match(answer, /local model tooling improvements/);
});

scenario("the provider answer for a provider with zero findings says so honestly, never invents one", () => {
  const answer = buildAyasResearchStatusSpokenAnswer(CONNECTED_GOALS, CONNECTED_RESEARCH, { kind: "provider", providerQuery: "capcut" });
  assert.match(answer, /henüz kaydedilmiş bir bulgu yok/);
});

scenario("a disconnected research view yields an honest 'cannot read' answer instead of crashing or fabricating", () => {
  const disconnected: AyasResearchEngineStatusView = { connected: false, consecutiveFailures: 0, sources: [], digest: { sourcesRegistered: 0, sourcesChangedLast24h: 0, sourcesFailingNow: 0, findingsLast24h: 0 } };
  const answer = buildAyasResearchStatusSpokenAnswer(CONNECTED_GOALS, disconnected, { kind: "digest" });
  assert.match(answer, /okunamıyor/);
});

scenario("a null intent yields an empty answer (the caller falls through to the model), never a crash", () => {
  assert.equal(buildAyasResearchStatusSpokenAnswer(CONNECTED_GOALS, CONNECTED_RESEARCH, null), "");
});

console.log(`AYAS research status intent smoke: PASS (${count} scenarios)`);
console.log(JSON.stringify({ status: "PASS", suite: "ayas-research-status-intent", scenarios: count }));
