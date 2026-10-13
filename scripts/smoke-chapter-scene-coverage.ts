import assert from "node:assert/strict";
import { AIManager } from "../src/lib/ai/AIManager";
import { createChapterSceneFallback, requireChapterSceneCoverage } from "../src/lib/ai/ChapterSceneCoverage";
import { GenerationFallbackBlockedError } from "../src/lib/ai/GenerationExecutionPolicy";
import { allocateProductionSceneAudioSegments } from "../src/lib/production/ProductionAcceptancePreflight";
import { withCanonicalSmokeRuntime } from "./lib/CanonicalSmokeRuntime";
import type { ScriptData } from "../src/types/script";

const script: ScriptData = {
  topic: "1480 Osmanlı yeniçerileri", title: "Günlük hayat", subtitle: "", hook: "", introduction: "",
  chapters: Array.from({ length: 7 }, (_, index) => ({
    id: index + 1, title: `Bölüm ${index + 1}`, narration: `Kaynak senaryo ${index + 1}`,
    duration: 10, visualGoal: `Bölüm ortamı ${index + 1}`, emotion: "normal", transition: "cut",
  })),
  conclusion: "", callToAction: "", estimatedDuration: 70, narrationWordCount: 21,
  targetAudience: "genel", language: "tr", voiceStyle: "normal", musicStyle: "historical",
  thumbnailIdea: "", seoKeywords: [], createdAt: new Date().toISOString(),
};
let scenarios = 0;
const pass = () => { scenarios += 1; };

async function main() {
  const fallback = createChapterSceneFallback(script);
  assert.deepEqual(fallback.scenes.map(s => s.chapterId), script.chapters.map(c => c.id));
  assert(fallback.scenes.every((s, i) => s.description === script.chapters[i].narration)); pass();
  const durations = new Map(script.chapters.map(c => [c.id, 8]));
  const segments = allocateProductionSceneAudioSegments(fallback, durations);
  assert.equal(segments.size, 7); assert.equal([...segments.values()].reduce((sum, s) => sum + s.durationSeconds, 0), 56); pass();
  assert.throws(() => createChapterSceneFallback({ ...script, chapters: [script.chapters[0], script.chapters[0]] })); pass();
  assert.deepEqual(requireChapterSceneCoverage([fallback.scenes[0]], script, fallback), fallback.scenes); pass();
  assert.deepEqual(requireChapterSceneCoverage([...fallback.scenes].reverse(), script, fallback), fallback.scenes); pass();
  assert.deepEqual(requireChapterSceneCoverage(fallback.scenes.map(s => ({ ...s, chapterId: 999 })), script, fallback), fallback.scenes); pass();
  assert.equal(requireChapterSceneCoverage(fallback.scenes.map(s => ({ ...s, chapterId: undefined })), script, fallback)[6].chapterId, 7); pass();
  await withCanonicalSmokeRuntime({ name: "chapter-scene-coverage", projectSlug: "chapter-scene-coverage", operationType: "pipeline.run" }, async () => {
    const context = { projectSlug: "chapter-scene-coverage", stage: "scenes", operation: "scenes" } as const;
    const provider = { async generate() { return ""; } };
    const current = await AIManager.runScenes(script, context, provider, undefined, undefined, { requireChapterCoverage: true });
    assert.equal(current.scenes.length, 7); assert.equal(current.scenes[6].chapterId, 7); pass();
    const old = await AIManager.runScenes(script, context, provider);
    assert.equal(old.scenes.length, 1); assert.equal(old.scenes[0].chapterId, undefined); pass();
    await assert.rejects(() => AIManager.runScenes(script, context, provider, { failClosed: true }, undefined, { requireChapterCoverage: true }), GenerationFallbackBlockedError); pass();
    const partial = await AIManager.runScenes(script, context, { async generate() { return JSON.stringify({ scenes: [fallback.scenes[0]], createdAt: script.createdAt }); } }, undefined, undefined, { requireChapterCoverage: true });
    assert.deepEqual(partial.scenes, fallback.scenes); pass();
    const complete = await AIManager.runScenes(script, context, { async generate() { return JSON.stringify(fallback); } }, undefined, undefined, { requireChapterCoverage: true });
    assert.equal(complete.scenes.length, 7); assert.equal(allocateProductionSceneAudioSegments(complete, durations).size, 7); pass();
  });
  console.log(JSON.stringify({ status: "PASS", scenarios, paidCalls: 0 }));
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
