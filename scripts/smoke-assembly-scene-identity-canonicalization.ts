import assert from "node:assert/strict";
import { AssemblyManager } from "../src/lib/assembly/AssemblyManager";
import type { AIProvider, AIProviderResult } from "../src/lib/ai/providers";
import type { AnimationData } from "../src/types/animation";
import type { AudioData } from "../src/types/audio";
import type { Project } from "../src/types/project";
import type { SceneData } from "../src/types/scene";
import type { ScriptData } from "../src/types/script";
import type { VideoData } from "../src/types/video";
import type { VisualData } from "../src/types/visual";

/**
 * Covers the mapScenes() identity-hardening fix in AssemblyManager.ts: AI-echoed
 * sceneId/chapterId must never be trusted for downstream identity -- the canonical
 * scenes[]-derived fallbackScene value must always win, exactly like
 * animationAssetId/videoAssetId/audioAssetId already do.
 *
 * Pure unit/mapping level: a stub AIProvider returns a controlled JSON string
 * (no network call, no OpenAI). generateAssemblyPlan() is called directly with a
 * 5-scene fixture mirroring the real project's shape. No render/FFmpeg/production
 * execution of any kind.
 */

const timestamp = "2026-08-25T00:00:00.000Z";
let passed = 0;
function pass(label: string) {
  passed += 1;
  console.log(`PASS ${passed}: ${label}`);
}

function fixtures(): {
  script: ScriptData;
  scenes: SceneData;
  visuals: VisualData;
  audio: AudioData;
  project: Project;
  animation: AnimationData;
  video: VideoData;
} {
  const script: ScriptData = {
    topic: "Identity hardening", title: "Identity hardening", subtitle: "Regression",
    hook: "Hook", introduction: "Introduction",
    chapters: [1, 2, 3, 4, 5].map((id) => ({
      id, title: `Chapter ${id}`, narration: `Narration ${id}.`, duration: 20,
      visualGoal: "Documentary", emotion: "serious", transition: "fade",
    })),
    conclusion: "Conclusion", callToAction: "Subscribe", estimatedDuration: 100,
    narrationWordCount: 10, targetAudience: "general", language: "tr",
    voiceStyle: "documentary", musicStyle: "cinematic", thumbnailIdea: "Documentary",
    seoKeywords: ["identity"], createdAt: timestamp,
  };
  const scenes: SceneData = {
    scenes: [1, 2, 3, 4, 5].map((id) => ({
      id, chapterId: id, title: `Scene ${id}`, description: `Canonical scene ${id}.`, duration: 20,
    })),
    createdAt: timestamp,
  };
  const visuals: VisualData = {
    projectId: "identity-hardening",
    scenes: [1, 2, 3, 4, 5].map((sceneId) => ({
      sceneId, visualPrompt: `Historical scene ${sceneId}.`, animationPrompt: "Slow zoom.",
      style: "documentary",
    })),
    thumbnail: { title: "Assembly", prompt: "Documentary thumbnail.", composition: "Centered", mood: "serious" },
    createdAt: timestamp,
  };
  const audio: AudioData = {
    narrator: { style: "documentary", tone: "serious", language: "tr" },
    sections: [1, 2, 3, 4, 5].map((chapterId) => ({
      chapterId, title: `Chapter ${chapterId}`, duration: "00:20", emotion: "serious",
      emphasis: ["canonical"], narrationNotes: "Clear narration.", pacing: "medium",
      sourceText: `Canonical narration ${chapterId}.`, outputAssetId: `audio-chapter-${chapterId}`,
    })),
    music: { mood: "cinematic", suggestion: "orchestral", intensity: "medium" },
    production: { targetFormat: "wav", sampleRate: 44100, estimatedTotalDuration: "01:40", generationStatus: "generated" },
    outputAssetId: "audio-mix",
    createdAt: timestamp,
  };
  const project: Project = {
    id: "project-identity-hardening", slug: "identity-hardening", title: "Identity hardening",
    status: "assembly", createdAt: timestamp, updatedAt: timestamp,
  };
  const animation: AnimationData = {
    projectId: project.id,
    scenes: [1, 2, 3, 4, 5].map((sceneId) => ({
      sceneId, animationPrompt: `Motion ${sceneId}.`, status: "generated",
      outputAssetId: `animation-canonical-${sceneId}`,
    })),
    createdAt: timestamp,
  };
  const video: VideoData = {
    projectId: project.id, status: "generated", createdAt: timestamp,
    scenes: [1, 2, 3, 4, 5].map((sceneId) => ({
      sceneId, sourceAnimationAssetId: `animation-canonical-${sceneId}`,
      outputAssetId: `video-canonical-${sceneId}`, status: "generated" as const,
    })),
  };
  return { script, scenes, visuals, audio, project, animation, video };
}

function fakeProvider(content: string): AIProvider {
  return {
    async generate(): Promise<AIProviderResult> {
      return { content, finishReason: "stop", refused: false, complete: true, truncated: false };
    },
  };
}

async function generate(aiScenes: unknown[]) {
  const { script, scenes, visuals, audio, project, animation, video } = fixtures();
  const responseJson = JSON.stringify({ scenes: aiScenes });
  return AssemblyManager.generateAssemblyPlan(
    script, scenes, visuals, audio, { project, animation, video },
    { projectSlug: project.slug, stage: "assembly", operation: "assembly-plan-unit-test" },
    { aiProvider: fakeProvider(responseJson) },
  );
}

async function run() {
  // Test A: normal AI output (correct sceneId/chapterId) -> result unchanged.
  {
    const plan = await generate([1, 2, 3, 4, 5].map((id) => ({ sceneId: id, chapterId: id, duration: "00:20" })));
    for (let i = 0; i < 5; i += 1) {
      assert.equal(plan.scenes[i].sceneId, i + 1);
      assert.equal(plan.scenes[i].chapterId, i + 1);
    }
  }
  pass("Test A: normal AI sceneId/chapterId output leaves canonical identity unchanged");

  // Test B: AI returns reversed sceneId at each position -> canonical wins by position.
  {
    const plan = await generate([5, 4, 3, 2, 1].map((wrongId, index) => ({
      sceneId: wrongId, chapterId: index + 1, duration: "00:20",
    })));
    for (let i = 0; i < 5; i += 1) {
      assert.equal(plan.scenes[i].sceneId, i + 1,
        `position ${i}: expected canonical sceneId ${i + 1}, AI said ${5 - i}`);
    }
  }
  pass("Test B: reversed AI sceneId is overridden by canonical scenes[]-derived identity");

  // Test C: AI returns duplicate sceneId=1 for every position -> canonical wins.
  {
    const plan = await generate([1, 2, 3, 4, 5].map(() => ({ sceneId: 1, chapterId: 1, duration: "00:20" })));
    const ids = plan.scenes.map((s) => s.sceneId);
    assert.deepEqual(ids, [1, 2, 3, 4, 5]);
    assert.equal(new Set(ids).size, 5, "no duplicate sceneId should survive canonicalization");
  }
  pass("Test C: duplicate AI sceneId (all 1) is overridden, canonical identity is unique and ordered");

  // Test D: AI returns correct sceneId but wrong chapterId -> canonical chapterId wins.
  {
    const plan = await generate([1, 2, 3, 4, 5].map((id) => ({ sceneId: id, chapterId: 99, duration: "00:20" })));
    for (let i = 0; i < 5; i += 1) {
      assert.equal(plan.scenes[i].chapterId, i + 1,
        `position ${i}: expected canonical chapterId ${i + 1}, AI said 99`);
    }
  }
  pass("Test D: wrong AI chapterId (99) is overridden by canonical chapterId");

  // Test E: AI returns non-numeric / missing sceneId -> canonical wins (already worked
  // pre-fix via the typeof-number fallback, but must remain true post-fix).
  {
    const plan = await generate([
      { sceneId: "1", chapterId: "1", duration: "00:20" },
      { chapterId: 2, duration: "00:20" }, // sceneId missing entirely
      { sceneId: null, chapterId: 3, duration: "00:20" },
      { sceneId: 4, chapterId: null, duration: "00:20" },
      { sceneId: 5, chapterId: 5, duration: "00:20" },
    ]);
    for (let i = 0; i < 5; i += 1) {
      assert.equal(plan.scenes[i].sceneId, i + 1);
      assert.equal(plan.scenes[i].chapterId, i + 1);
    }
  }
  pass("Test E: non-numeric / missing AI identity values resolve to canonical identity");

  // Test F: asset fallback regression -- animationAssetId/videoAssetId/audioAssetId
  // must stay canonical even when the AI echoes bogus values for them, and even
  // under the sceneId/chapterId-hardened path.
  {
    const plan = await generate([1, 2, 3, 4, 5].map((id) => ({
      sceneId: id, chapterId: id, duration: "00:20",
      animationAssetId: "bogus-ai-animation-id",
      videoAssetId: "bogus-ai-video-id",
      audioAssetId: "bogus-ai-audio-id",
    })));
    for (let i = 0; i < 5; i += 1) {
      const sceneId = i + 1;
      assert.equal(plan.scenes[i].animationAssetId, `animation-canonical-${sceneId}`);
      assert.equal(plan.scenes[i].videoAssetId, `video-canonical-${sceneId}`);
      assert.equal(plan.scenes[i].audioAssetId, `audio-chapter-${sceneId}`);
    }
  }
  pass("Test F: animationAssetId/videoAssetId/audioAssetId canonical fallback regression is intact");

  console.log(`\nPASS (${passed} scenarios)`);
}

void run().catch((error) => {
  console.error("SMOKE_FAILED", error);
  process.exitCode = 1;
});
