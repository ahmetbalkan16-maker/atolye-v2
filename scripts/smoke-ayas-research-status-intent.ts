import assert from "node:assert/strict";

import { detectAyasResearchStatusIntent, buildAyasResearchStatusSpokenAnswer, buildAyasUpdateRadarSpokenSummary } from "../src/lib/brain/autonomy/AyasResearchStatusIntent";
import type { AyasGoalDevelopmentView } from "../src/lib/brain/autonomy/AyasGoalDevelopmentView";
import type { AyasResearchEngineStatusView } from "../src/lib/brain/autonomy/AyasResearchEngineStatusView";
import type { AyasResearchHealth, AyasUpdateRadarItem } from "../src/lib/brain/autonomy/AyasUpdateRadar";

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
  assert.equal(detectAyasResearchStatusIntent("bugün hava çok güzel"), null, "assert.equal(detectAyasResearchStatusIntent(\"bugün hava çok güzel\"), null)");
  assert.equal(detectAyasResearchStatusIntent(""), null, "assert.equal(detectAyasResearchStatusIntent(\"\"), null)");
});

scenario('"Son internette ne araştırdın?" is detected as a digest intent', () => {
  assert.deepEqual(detectAyasResearchStatusIntent("Son internette ne araştırdın?"), { kind: "digest" }, "assert.deepEqual(detectAyasResearchStatusIntent(\"Son internette ne araştırdın?\"), { kind: \"digest\" })");
});

scenario('"Son 24 saatte hangi özellikleri keşfettin?" is detected as a digest intent', () => {
  assert.deepEqual(detectAyasResearchStatusIntent("Son 24 saatte hangi özellikleri keşfettin?"), { kind: "digest" }, "assert.deepEqual(detectAyasResearchStatusIntent(\"Son 24 saatte hangi özellikleri keşfettin?\"), { kind: \"digest\" })");
});

scenario('"Sonraki araştırma ne zaman?" is detected as a next-schedule intent', () => {
  assert.deepEqual(detectAyasResearchStatusIntent("Sonraki araştırma ne zaman?"), { kind: "next-schedule" }, "assert.deepEqual(detectAyasResearchStatusIntent(\"Sonraki araştırma ne zaman?\"), { kind: \"next-schedule\" })");
});

scenario('"Ollama tarafında yeni ne buldun?" is detected as a provider intent for "ollama"', () => {
  assert.deepEqual(detectAyasResearchStatusIntent("Ollama tarafında yeni ne buldun?"), { kind: "provider", providerQuery: "ollama" }, "assert.deepEqual(detectAyasResearchStatusIntent(\"Ollama tarafında yeni ne buldun?\"), { kind: \"provider\", providerQuery: \"ollama\" })");
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
  assert.equal(buildAyasResearchStatusSpokenAnswer(CONNECTED_GOALS, CONNECTED_RESEARCH, null), "", "assert.equal(buildAyasResearchStatusSpokenAnswer(CONNECTED_GOALS, CONNECTED_RESEARCH, null), \"\")");
});

// Research integration (owner request 2026-10-15): the update radar in the spoken research answer.
const radarItem = (sourceId: string, toolName: string, installedVersion: string, latestVersion: string, bump: AyasUpdateRadarItem["bump"],
  applyChannel: AyasUpdateRadarItem["applyChannel"] = "DEVELOPMENT_SESSION"): AyasUpdateRadarItem => ({
  sourceId, provider: "Vendor", toolName, target: `npm:${sourceId}`, installedVersion, latestVersion, bump, newerStableReleases: 1,
  latestUrl: "https://example.test", lastSeenAt: "2026-10-15T06:00:00.000Z", applyChannel, evidence: [],
  brief: { summary: "", affectedFileCount: 0, affectedFiles: [], validation: [], risk: "" }, itemHash: "0".repeat(64),
});
const RADAR = [radarItem("eslint", "ESLint", "9.39.4", "10.11.0", "MAJOR"), radarItem("typescript", "TypeScript", "5.9.3", "7.0.2", "MAJOR"),
  radarItem("nodejs", "Node.js", "24.18.0", "24.22.0", "MINOR", "OWNER_PINNED_RUNTIME")];
const HEALTHY: AyasResearchHealth = { status: "HEALTHY", reasons: [], findingsLast7d: 4, groundedFindingsLast7d: 2, trackedToolsWithUpdates: 3 };
const WITH_RADAR: AyasResearchEngineStatusView = { ...CONNECTED_RESEARCH, updateRadar: RADAR, researchHealth: HEALTHY };

scenario('"AYAS, araştırma ne durumda?" and its variants are digest intents; a project\'s research is not', () => {
  for (const text of ["AYAS, araştırma ne durumda?", "Araştırmaların durumu ne?", "Dış araştırma nasıl gidiyor?", "araştırmanın durumu"]) {
    assert.deepEqual(detectAyasResearchStatusIntent(text), { kind: "digest" }, text);
  }
  assert.equal(detectAyasResearchStatusIntent("İstanbul'un Fethi araştırması ne durumda?"), null, "assert.equal(detectAyasResearchStatusIntent(\"İstanbul'un Fethi araştırması ne durumda?\"), null)");
});

scenario("tool update questions are update intents; commands and project updates are not", () => {
  for (const text of ["Güncelleme var mı?", "Hangi güncellemeler var?", "Yeni sürüm çıktı mı?", "Güncelleme radarında ne var?", "Güncellemeler ne durumda?"]) {
    assert.deepEqual(detectAyasResearchStatusIntent(text), { kind: "updates" }, text);
  }
  for (const text of ["Next.js'i güncelle", "Projede güncelleme var mı?", "Bu dosyayı güncelle"]) assert.equal(detectAyasResearchStatusIntent(text), null, text);
});

scenario("the digest answer adds the radar with tool names and versions from the view, and says nothing extra when healthy", () => {
  const answer = buildAyasResearchStatusSpokenAnswer(CONNECTED_GOALS, WITH_RADAR, { kind: "digest" });
  assert.match(answer, /14 kaynak/); assert.match(answer, /3 araç için yeni sürüm var/);
  assert.match(answer, /ESLint 9\.39\.4 yerine 10\.11\.0 \(ana sürüm\)/); assert.match(answer, /TypeScript 5\.9\.3 yerine 7\.0\.2/);
  assert.match(answer, /Node\.js 24\.18\.0 yerine 24\.22\.0 \(kurulumu sen yaparsın\)/); assert.match(answer, /kendiliğinden uygulanmaz/);
  assert.doesNotMatch(answer, /Vendor|sorun var/);
});

scenario("a degraded research engine is said aloud with its recorded reason", () => {
  const degraded: AyasResearchEngineStatusView = { ...WITH_RADAR, researchHealth: { ...HEALTHY, status: "DEGRADED", reasons: ["Araştırma art arda 2 kez başarısız oldu."] } };
  assert.match(buildAyasResearchStatusSpokenAnswer(CONNECTED_GOALS, degraded, { kind: "digest" }), /Araştırmada sorun var: Araştırma art arda 2 kez başarısız oldu\./);
});

scenario("the update answer is honest when the radar is empty or unreadable, and caps the spoken list", () => {
  assert.match(buildAyasResearchStatusSpokenAnswer(CONNECTED_GOALS, { ...CONNECTED_RESEARCH, updateRadar: [] }, { kind: "updates" }), /bekleyen yeni sürüm yok/);
  assert.match(buildAyasResearchStatusSpokenAnswer(CONNECTED_GOALS, CONNECTED_RESEARCH, { kind: "updates" }), /radarı şu an okunamıyor/);
  assert.match(buildAyasResearchStatusSpokenAnswer(CONNECTED_GOALS, { ...CONNECTED_RESEARCH, connected: false }, { kind: "updates" }), /okunamıyor/);
  const six = [...RADAR, radarItem("react", "React", "19.2.4", "19.3.0", "MINOR"), radarItem("wrangler", "Wrangler", "4.131.0", "4.140.0", "MINOR"), radarItem("next", "Next.js", "16.4.1", "16.4.2", "PATCH")];
  const answer = buildAyasUpdateRadarSpokenSummary(six);
  assert.match(answer, /6 araç için yeni sürüm var/); assert.match(answer, /ve 2 araç daha/); assert.doesNotMatch(answer, /Wrangler|Next\.js/);
});

console.log(`AYAS research status intent smoke: PASS (${count} scenarios)`);
console.log(JSON.stringify({ status: "PASS", suite: "ayas-research-status-intent", scenarios: count }));
