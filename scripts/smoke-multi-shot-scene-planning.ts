/**
 * Documentary pipeline V2 (Faz 2a): multi-shot scene planning.
 *
 * Multi-shot is implemented WITHOUT a schema change: a "shot" is one short
 * scene, and the pipeline already groups multiple scenes under a chapter
 * (validateProductionAcceptancePreflight, allocateProductionSceneAudioSegments,
 * VideoAssemblyManager) and slices that chapter's real narration across them.
 * This suite proves the existing machinery accepts and correctly allocates a
 * 3-shots-per-chapter plan, that the strict scene validator still fails closed
 * on the ways a multi-shot plan can be wrong, and that the single-scene path is
 * unchanged. No API call is made.
 */
import assert from "node:assert/strict";
import type { ScriptData } from "../src/types/script";
import type { SceneData } from "../src/types/scene";
import {
  createScenesPrompt,
  validateProviderScenes,
} from "../src/lib/ai/SceneStructuredOutput";
import {
  getSceneMaxTokens,
  SceneAIConfigError,
  sceneTokenBudget,
} from "../src/lib/ai/SceneAIConfig";
import {
  allocateProductionSceneAudioSegments,
  validateProductionAcceptancePreflight,
} from "../src/lib/production/ProductionAcceptancePreflight";

let count = 0;
function scenario(name: string, test: () => void) {
  test();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

/** 5 chapters x 18s = 90s. */
function script(): ScriptData {
  const chapters = [1, 2, 3, 4, 5].map((id) => ({
    id,
    title: `Bölüm ${id}`,
    narration: "x".repeat(254),
    duration: 18,
    visualGoal: "g",
    emotion: "e",
    transition: "t",
  }));
  return {
    topic: "t",
    title: "t",
    subtitle: "s",
    hook: "h",
    introduction: "i",
    chapters,
    conclusion: "c",
    callToAction: "cta",
    estimatedDuration: 90,
    narrationWordCount: 100,
    targetAudience: "a",
    language: "tr",
    voiceStyle: "v",
    musicStyle: "m",
    thumbnailIdea: "ti",
    seoKeywords: ["k"],
    createdAt: "2026-08-29T00:00:00.000Z",
  };
}

/** shotsPerChapter shots per chapter, durations summing to the chapter's 18s. */
function multiShotScenes(shotsPerChapter: number): SceneData {
  const scenes: SceneData["scenes"] = [];
  let id = 1;
  for (let chapterId = 1; chapterId <= 5; chapterId += 1) {
    const per = 18 / shotsPerChapter;
    for (let shot = 0; shot < shotsPerChapter; shot += 1) {
      scenes.push({
        id,
        chapterId,
        title: `Bölüm ${chapterId} çekim ${shot + 1}`,
        description: "d".repeat(20),
        visualPrompt: `Sahne ${id} tek kare kompozisyon`,
        duration:
          shot === shotsPerChapter - 1
            ? 18 - per * (shotsPerChapter - 1)
            : per,
      });
      id += 1;
    }
  }
  return { scenes, createdAt: "2026-08-29T00:00:00.000Z" };
}


function run() {
  scenario("createScenesPrompt carries multi-shot rhythm + compactness guidance", () => {
    const prompt = createScenesPrompt(script());
    assert.match(prompt, /Break every chapter into 2 to 4 shots/);
    assert.match(prompt, /roughly 10 to 18 scenes/);
    assert.match(prompt, /Never exceed 30 scenes/);
    assert.match(prompt, /genuinely different images/);
    assert.match(prompt, /ONE single cinematic frame/);
    // compactness guidance keeps a 10-18 scene response inside the token budget
    assert.match(prompt, /whole response stays compact/);
  });

  scenario("scenes stage has its own generous token budget (fixes the truncation that broke the first V2 run)", () => {
    // default is script-sized, not the tiny generic 1200 default
    assert.equal(getSceneMaxTokens({} as NodeJS.ProcessEnv), sceneTokenBudget.defaultTokens);
    assert.ok(sceneTokenBudget.defaultTokens >= 4000, "18 compact scenes need >= ~4000 completion tokens");
    // env override, fail-closed on garbage (same contract as OPENAI_SCRIPT_MAX_TOKENS)
    assert.equal(
      getSceneMaxTokens({ OPENAI_SCENES_MAX_TOKENS: "6000" } as unknown as NodeJS.ProcessEnv),
      6000,
    );
    assert.throws(
      () => getSceneMaxTokens({ OPENAI_SCENES_MAX_TOKENS: "9999999" } as unknown as NodeJS.ProcessEnv),
      SceneAIConfigError,
    );
    assert.throws(
      () => getSceneMaxTokens({ OPENAI_SCENES_MAX_TOKENS: "abc" } as unknown as NodeJS.ProcessEnv),
      SceneAIConfigError,
    );
  });

  scenario("strict validator accepts a 15-scene 3-shots-per-chapter plan", () => {
    const evidence = validateProviderScenes(
      { scenes: multiShotScenes(3).scenes },
      script(),
    );
    assert.equal(evidence, undefined);
  });

  scenario("strict validator accepts the maximum 6-shots-per-chapter (30) plan", () => {
    const evidence = validateProviderScenes(
      { scenes: multiShotScenes(6).scenes },
      script(),
    );
    assert.equal(evidence, undefined);
  });

  scenario("strict validator still fails closed past 30 scenes", () => {
    const scenes = multiShotScenes(6).scenes.concat({
      id: 31,
      chapterId: 5,
      title: "fazla",
      description: "d".repeat(20),
      visualPrompt: "p",
      duration: 1,
    });
    // renumber chapter 5 durations so only the count is wrong
    const evidence = validateProviderScenes({ scenes }, script());
    assert.ok(evidence, "expected a schema violation");
    assert.ok(
      evidence!.issues.some((i) => i.reason === "MAX_ITEMS"),
      JSON.stringify(evidence),
    );
  });

  scenario("strict validator fails closed when a chapter has no shot", () => {
    // 3 shots for chapters 1-4, none for chapter 5
    const scenes = multiShotScenes(3).scenes.filter((s) => s.chapterId !== 5);
    const evidence = validateProviderScenes({ scenes }, script());
    assert.ok(evidence);
  });

  scenario("strict validator fails closed when a chapter's shot durations do not sum", () => {
    const scenes = multiShotScenes(3).scenes.map((s) =>
      s.chapterId === 2 ? { ...s, duration: 2 } : s,
    );
    const evidence = validateProviderScenes({ scenes }, script());
    assert.ok(evidence);
    assert.ok(evidence!.issues.some((i) => i.reason === "INVALID_DURATION"));
  });

  scenario("audio segments slice a chapter's real narration across its 3 shots, contiguous, remainder-safe", () => {
    const durations = new Map([1, 2, 3, 4, 5].map((c) => [c, 17.4])); // real WAV != planned 18
    const segments = allocateProductionSceneAudioSegments(multiShotScenes(3), durations);
    assert.equal(segments.size, 15);
    // chapter 2 = scene ids 4,5,6
    const c2 = [4, 5, 6].map((id) => segments.get(id)!);
    assert.ok(c2.every((s) => s.chapterId === 2));
    assert.equal(c2[0].startSeconds, 0);
    assert.ok(Math.abs(c2[0].startSeconds + c2[0].durationSeconds - c2[1].startSeconds) < 1e-9);
    assert.ok(Math.abs(c2[1].startSeconds + c2[1].durationSeconds - c2[2].startSeconds) < 1e-9);
    const total = c2.reduce((s, seg) => s + seg.durationSeconds, 0);
    assert.ok(Math.abs(total - 17.4) < 1e-9, `chapter narration must be fully covered, got ${total}`);
  });

  scenario("acceptance preflight passes for a multi-shot script + scenes (gates unchanged)", () => {
    const groups = validateProductionAcceptancePreflight(script(), multiShotScenes(3));
    assert.equal(groups.length, 5);
    assert.ok(groups.every((g) => g.sceneIds.length === 3));
    assert.ok(groups.every((g) => Math.abs(g.durationSeconds - 18) < 1e-6));
  });

  scenario("single-scene-per-chapter plan is still valid (backward compatible)", () => {
    const evidence = validateProviderScenes(
      { scenes: multiShotScenes(1).scenes },
      script(),
    );
    assert.equal(evidence, undefined);
    const groups = validateProductionAcceptancePreflight(script(), multiShotScenes(1));
    assert.equal(groups.length, 5);
    assert.ok(groups.every((g) => g.sceneIds.length === 1));
  });

  console.log(`Multi-shot scene planning smoke: PASS (${count} scenarios)`);
  console.log(
    JSON.stringify({ status: "PASS", suite: "multi-shot-scene-planning", scenarios: count }),
  );
}

try {
  run();
} catch (error) {
  console.error("Multi-shot scene planning smoke FAILED:", error);
  process.exitCode = 1;
}
