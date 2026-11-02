import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { planCharacterScene } from "../src/lib/animation/character/CharacterScenePlanner";
import { renderCharacterSceneAssetFrame, CHARACTER_SCENE_ASSET_SCHEMA_VERSION, CHARACTER_SCENE_FONT_FAMILY } from "../src/lib/animation/character/CharacterSceneAsset";
import { renderCharacterSceneSvg, renderCharacterSceneFrameSvg } from "../src/lib/character/SvgSceneRenderer";
import { findCharacterSceneRequestProblems } from "../src/lib/character/CharacterSceneManifest";
import { planAutomaticLocalRepair, isAutomaticRepairLocalBackend } from "../src/lib/pipeline/PipelineAutomaticLocalRepair";
import { SpawnRunner, type VideoAssemblyChildProcess } from "../src/lib/assembly/providers/FFmpegVideoAssemblyProvider";
import { resolveAyasResearchSourceRegistry } from "../src/lib/brain/autonomy/AyasResearchSourceRegistry";
import { EDITORIAL_RENDER_STYLE } from "../src/lib/character/SvgSceneRenderer";
import { characterAnimationFrame } from "../src/lib/animation/character/CharacterAnimation";

async function main() {
  const scenes = [
    ["Yapay zeka ve bilgisayar yazılımı nasıl çalışır?", "TECHNOLOGY", "MONITOR"],
    ["Enflasyon, faiz ve bankacılık ilişkisi", "ECONOMY", "CHART"],
    ["Demokrasi ve seçim nedir?", "POLITICS", "MICROPHONE"],
  ] as const;
  for (const [text, kind, prop] of scenes) {
    const p = planCharacterScene({ sceneId: 1, text });
    assert.equal(p.kind, kind, "assert.equal(p.kind, kind)"); assert(p.request.blocking.props.some(x => x.prop === prop));
    assert.deepEqual(findCharacterSceneRequestProblems(p.request), [], "assert.deepEqual(findCharacterSceneRequestProblems(p.request), [])");
    const payload = { schemaVersion: CHARACTER_SCENE_ASSET_SCHEMA_VERSION, request: p.request, animation: p.animation, fontFamily: CHARACTER_SCENE_FONT_FAMILY, renderStyle: EDITORIAL_RENDER_STYLE };
    const svg = renderCharacterSceneAssetFrame(payload, 0);
    assert.match(svg, /data-mascot="yellow-scarf-v1"/); assert.match(svg, /CANLANDIRMA/);
    assert.doesNotMatch(svg, /<image|<script|href=|filter=/);
    assert.notEqual(svg, renderCharacterSceneAssetFrame(payload, 0.4));
    assert.equal(svg, renderCharacterSceneAssetFrame(payload, 0), "assert.equal(svg, renderCharacterSceneAssetFrame(payload, 0))");
    assert.match(svg, /data-art-environment=/);
    assert.match(svg, /data-art-identity="0"/); assert.match(svg, /data-art-identity="1"/);
    assert.equal(renderCharacterSceneAssetFrame({ ...payload, renderStyle: undefined }, 0), renderCharacterSceneFrameSvg(p.request.blocking, characterAnimationFrame(p.request.blocking, p.animation, 0), { reenactmentLabel: "tr", fontFamily: CHARACTER_SCENE_FONT_FAMILY }), "assert.equal(renderCharacterSceneAssetFrame({ ...payload, renderStyle: undefined }, 0), renderCharacterSceneFrameSvg(p.request.blocking, characterAnimationFrame(p.request.blocking, p.animation, 0), { reenactmentLabel: \"tr\", fontFamily: CHARACTER_SCENE_FONT_FAMILY }))");
    const old = renderCharacterSceneSvg(p.request.blocking, { reenactmentLabel: "tr" });
    assert.equal(old, renderCharacterSceneFrameSvg(p.request.blocking, {}, { reenactmentLabel: "tr" }), "assert.equal(old, renderCharacterSceneFrameSvg(p.request.blocking, {}, { reenactmentLabel: \"tr\" }))");
    assert.doesNotMatch(old, /data-mascot/);
  }
  assert.equal(planCharacterScene({ sceneId: 1, text: "1453 Osmanlı top teknolojisi" }).kind, "SCHOLAR", "assert.equal(planCharacterScene({ sceneId: 1, text: \"1453 Osmanlı top teknolojisi\" }).kind, \"SCHOLAR\")");
  const good = { stage: "script" as const, provider: "ollama", errorCode: "AI_RESPONSE_INVALID_JSON", status: "failed", attempts: 0, enabled: true, freshRun: true, hasProviderOverrides: false, localBackend: true };
  assert(isAutomaticRepairLocalBackend({ baseUrl: "http://127.0.0.1:11434", model: "qwen2.5:3b" }));
  assert(!isAutomaticRepairLocalBackend({ baseUrl: "https://remote.example", model: "qwen2.5:3b" }));
  assert(!isAutomaticRepairLocalBackend({ baseUrl: "http://127.0.0.1:11434", model: "qwen-cloud" }));
  assert(!isAutomaticRepairLocalBackend({ baseUrl: "http://user:password@localhost:11434", model: "qwen2.5:3b" }));
  assert.equal(planAutomaticLocalRepair({ ...good, localBackend: false }).allowed, false, "assert.equal(planAutomaticLocalRepair({ ...good, localBackend: false }).allowed, false)");
  assert.deepEqual(planAutomaticLocalRepair(good), { allowed: true, delayMs: 60000 }, "assert.deepEqual(planAutomaticLocalRepair(good), { allowed: true, delayMs: 60000 })");
  for (const change of [{ provider: "openai" }, { errorCode: "AI_COST_BUDGET_EXCEEDED" }, { errorCode: "AI_USAGE_PERSISTENCE_FAILED" }, { errorCode: "MACHINE_HEALTH_CRITICAL_PRESSURE" }, { attempts: 2 }, { attempts: 3 }, { attempts: -1 }, { freshRun: false }, { hasProviderOverrides: true }, { enabled: false }, { status: "running" }, { stage: "audio" as const }]) assert.equal(planAutomaticLocalRepair({ ...good, ...change }).allowed, false, "assert.equal(planAutomaticLocalRepair({ ...good, ...change }).allowed, false)");
  const youtube = resolveAyasResearchSourceRegistry().find(x => x.sourceId === "youtube-official-blog");
  assert.equal(youtube?.url, "https://blog.youtube/rss/", "assert.equal(youtube?.url, \"https://blog.youtube/rss/\")"); assert.equal(youtube?.officialSource, true, "assert.equal(youtube?.officialSource, true)");
  assert.match(resolveAyasResearchSourceRegistry().find(x => x.sourceId === "piper-tts")!.url, /OHF-Voice\/piper1-gpl/);
  class Child extends EventEmitter {
    stdout = new PassThrough(); stderr = new PassThrough(); killed = 0;
    kill() { this.killed++; this.emit("close", null, "SIGKILL"); return true; }
    unref() {}
  }
  const child = new Child(); let checks = 0;
  // A short owned child survives until its real five-second health poll refuses.
  const result = await new SpawnRunner(() => child as unknown as VideoAssemblyChildProcess, 20).run("fixture", [], {
    timeoutMs: 8000, maxOutputBytes: 1024, healthCheck: async () => { checks++; throw new Error("MACHINE_HEALTH_CRITICAL_PRESSURE"); },
  });
  assert.equal(child.killed, 1, "assert.equal(child.killed, 1)"); assert.equal(checks, 1, "assert.equal(checks, 1)"); assert.equal(result.failed, true, "assert.equal(result.failed, true)"); assert.equal(result.timedOut, false, "assert.equal(result.timedOut, false)");
  await new Promise(resolve => setTimeout(resolve, 35)); assert.equal(child.killed, 1, "assert.equal(child.killed, 1)");
  console.log("Owner video profile: PASS (modern topics, mascot compatibility, bounded local repair, sources, owned process health stop)");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
